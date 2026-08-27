import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { request as httpRequest } from "node:http";
import { after, before, test } from "node:test";

// A home directory, an rc file and a stub `task` are set up before the server
// module is imported, because it reads the environment once at startup.
const home = mkdtempSync(path.join(tmpdir(), "teutates-home-"));
const binDir = mkdtempSync(path.join(tmpdir(), "teutates-bin-"));
const uiDir = mkdtempSync(path.join(tmpdir(), "teutates-ui-"));

writeFileSync(path.join(home, ".taskrc"), "color=on\ninclude colors.theme\n");
writeFileSync(path.join(home, "colors.theme"), "color.due=red\n");

// The stub prints its own arguments, so a test can assert on the command line
// the server built, and fails on a marker argument to exercise a non-zero exit.
writeFileSync(path.join(binDir, "task"), `#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "boom" ]; then echo "stub failed" >&2; exit 2; fi
done
echo "$@"
`);
chmodSync(path.join(binDir, "task"), 0o755);

mkdirSync(path.join(uiDir, "assets"), { recursive: true });
writeFileSync(path.join(uiDir, "index.html"), "<h1>teutates</h1>");
writeFileSync(path.join(uiDir, "assets", "app.js"), "export const ok = 1;\n");

const realPath = process.env.PATH;
process.env.HOME = home;
process.env.TASKRC = path.join(home, ".taskrc");
process.env.PATH = `${binDir}${path.delimiter}${realPath}`;

const { createTeutates } = await import("../teutates.mjs");

let base = "";
let server;

before(async () => {
  server = createTeutates({ uiDir, listen: { host: "127.0.0.1", port: 0 } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

/** Posts to /api/task the way the interface does. */
function runTask(args, init = {}) {
  return fetch(`${base}/api/task`, {
    method: "POST",
    body: JSON.stringify({ args }),
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

test("runs an allowed command and returns its output", async () => {
  const response = await runTask(["rc.verbose=nothing", "status:pending", "export"]);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.code, 0);
  // Taskwarrior puts the filter before the command, which must survive the
  // allowlist rather than being read as the command itself.
  assert.equal(body.stdout.trim(), "rc.verbose=nothing status:pending export");
});

test("a non-zero exit is an answer, not a transport failure", async () => {
  const response = await runTask(["boom", "export"]);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.code, 2);
  assert.match(body.stderr, /stub failed/);
});

test("refuses a command that is not on the allowlist", async () => {
  for (const args of [["config", "x", "y"], ["status:pending", "config", "x"], ["nonsense"]]) {
    const response = await runTask(args);
    assert.equal(response.status, 400, JSON.stringify(args));
    assert.match((await response.json()).error, /command/);
  }
});

test("refuses overrides that redirect Taskwarrior itself", async () => {
  for (const args of [
    ["rc.hooks=off", "export"],
    ["rc.data.location=/tmp", "export"],
    ["rc:/tmp/evil.rc", "export"],
    // An override hidden behind a free-text command is still an override.
    ["add", "buy milk", "rc.data.location=/tmp"],
  ]) {
    const response = await runTask(args);
    assert.equal(response.status, 400, JSON.stringify(args));
    assert.match((await response.json()).error, /not allowed/);
  }
});

test("a free-text description may contain command words", async () => {
  const response = await runTask(["add", "write the export config docs"]);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).code, 0);
});

test("rejects a body that is not JSON, and one that is too large", async () => {
  const plain = await fetch(`${base}/api/task`, {
    method: "POST",
    body: JSON.stringify({ args: ["export"] }),
  });
  // Without a JSON content type a browser would not preflight the request,
  // so the endpoint refuses it outright.
  assert.equal(plain.status, 415);

  const broken = await fetch(`${base}/api/task`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "not json",
  });
  assert.equal(broken.status, 400);

  const huge = await runTask(["export"], { body: JSON.stringify({ args: ["x".repeat(70_000)] }) });
  assert.equal(huge.status, 413);
});

test("refuses a write requested from another origin", async () => {
  const foreign = await runTask(["add", "x"], { headers: { origin: "https://evil.example" } });
  assert.equal(foreign.status, 403);

  const own = await runTask(["export"], { headers: { origin: base } });
  assert.equal(own.status, 200);
});

test("refuses a request addressed to another host name", async () => {
  // fetch will not let a caller set Host, and that is the point: only
  // something outside a browser can, which is what the check is for.
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port: server.address().port,
      path: "/api/env",
      headers: { host: "evil.example" },
    }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(status, 421);
});

test("reports the environment the interface needs", async () => {
  const body = await (await fetch(`${base}/api/env`)).json();
  assert.equal(body.taskrcPath, path.join(home, ".taskrc"));
  assert.equal(body.home, home);
  assert.equal(typeof body.taskrcMtime, "number");
});

test("reads an rc file and resolves an include against its directory", async () => {
  const rc = await (await fetch(`${base}/api/rc?path=${encodeURIComponent(path.join(home, ".taskrc"))}`)).json();
  assert.match(rc.content, /color=on/);

  const included = await (await fetch(
    `${base}/api/rc?path=colors.theme&base=${encodeURIComponent(home)}`,
  )).json();
  assert.match(included.content, /color\.due=red/);
});

test("refuses to read outside the directories rc files live in", async () => {
  const outside = await fetch(`${base}/api/rc?path=/etc/passwd`);
  assert.equal(outside.status, 403);

  // The same file reached the long way round, so the guard cannot be walked
  // past with a relative include.
  const traversal = await fetch(
    `${base}/api/rc?path=${encodeURIComponent(path.relative(home, "/etc/passwd"))}` +
    `&base=${encodeURIComponent(home)}`,
  );
  assert.equal(traversal.status, 403);
});

test("an include that points nowhere is a 404, not an error", async () => {
  const response = await fetch(`${base}/api/rc?path=missing.theme&base=${encodeURIComponent(home)}`);
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /No rc file/);
});

test("serves the interface with the right content types", async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(await page.text(), /teutates/);

  const script = await fetch(`${base}/assets/app.js`);
  assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");
});

test("an asset name cannot walk out of the assets directory", async () => {
  const response = await fetch(`${base}/assets/${encodeURIComponent("../index.html")}`);
  // The name is reduced to its last segment, so this asks for a file that is
  // simply not there rather than reaching the page above.
  assert.equal(response.status, 404);
});

test("unknown routes and wrong methods answer in the error shape", async () => {
  const unknownAPI = await fetch(`${base}/api/nope`);
  assert.equal(unknownAPI.status, 404);
  assert.match((await unknownAPI.json()).error, /Unknown API endpoint/);

  const unknownPage = await fetch(`${base}/somewhere`);
  assert.equal(unknownPage.status, 404);
  assert.match((await unknownPage.json()).hint, /npm run build/);

  const wrongMethod = await fetch(`${base}/api/env`, { method: "POST" });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "GET");
});

test("a missing interface build says so", async () => {
  const bare = createTeutates({
    uiDir: path.join(uiDir, "nothing-here"),
    listen: { host: "127.0.0.1", port: 0 },
  });
  await new Promise((resolve) => bare.listen(0, "127.0.0.1", resolve));
  const response = await fetch(`http://127.0.0.1:${bare.address().port}/`);
  assert.equal(response.status, 404);
  assert.match((await response.json()).hint, /npm run build/);
  bare.close();
});

test("a missing `task` binary is reported with a way out", async () => {
  process.env.PATH = uiDir; // no `task` here
  try {
    const response = await runTask(["export"]);
    assert.equal(response.status, 503);
    assert.match((await response.json()).hint, /PATH/);
  } finally {
    process.env.PATH = `${binDir}${path.delimiter}${realPath}`;
  }
});
