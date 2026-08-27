#!/usr/bin/env node
// teutates serves a local web interface for Taskwarrior.
//
// The server is deliberately thin: it runs the `task` binary, reads rc files
// and serves the interface. Everything that could be called understanding of
// Taskwarrior — parsing, ordering, grouping — lives in the interface, which
// is the only place it needs to exist.
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// commandTimeout bounds every invocation of `task` so a hung or interactive
// Taskwarrior cannot stall a request.
const commandTimeout = 3000;

// maxOutput caps what a single `task` invocation may print. A full export of
// a large task database is the realistic upper bound.
const maxOutput = 32 * 1024 * 1024;

// maxRequestBody caps a POST body. Nothing legitimate comes close.
const maxRequestBody = 64 * 1024;

// maxRCSize caps an rc file. Configuration files are kilobytes.
const maxRCSize = 1024 * 1024;

// readCommands answer questions; writeCommands change the task database.
// One of these must appear in a request, and it is taken to be the command.
const readCommands = new Set(["export", "_show", "show", "_get", "--version"]);
const writeCommands = new Set([
  "add", "modify", "done", "start", "stop",
  "delete", "annotate", "denotate", "undo",
]);

// freeTextCommands take everything after the command word as text a user
// typed, so those arguments are not read as Taskwarrior syntax.
const freeTextCommands = new Set(["add", "modify", "annotate", "denotate"]);

// deniedCommands must never appear where Taskwarrior would read them as a
// command. They rewrite the configuration, run programs, replace the task
// database or open an editor — none of which a web interface should reach.
const deniedCommands = new Set([
  "config", "execute", "import", "synchronize", "sync", "purge", "edit", "context",
]);

// allowedOverrides are the `rc.` overrides the interface may set. The others
// are refused because they redirect Taskwarrior itself: `rc.hooks` runs
// scripts, `rc.data.location` picks a different database.
const allowedOverrides = ["rc.verbose=", "rc.confirmation="];

// loopbackHosts are the names a browser may use to reach this server. They
// gate both the Host header, against DNS rebinding, and the Origin header,
// against a page elsewhere posting a write.
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function usage() {
  return [
    "usage: teutates [--addr host:port] [--ui dir]",
    "",
    "  --addr  address to listen on (default 127.0.0.1:8080)",
    "  --ui    serve the interface from this directory (default: dist/ next to this file)",
  ].join("\n");
}

function parseFlags(argv) {
  const flags = { addr: "127.0.0.1:8080", ui: "" };
  for (let i = 0; i < argv.length; i++) {
    const [name, inline] = splitOnce(argv[i], "=");
    if (name === "--help" || name === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (name !== "--addr" && name !== "--ui") {
      console.error(`teutates: unknown flag ${argv[i]}\n\n${usage()}`);
      process.exit(2);
    }
    const value = inline !== null ? inline : argv[++i];
    if (value === undefined || value === "") {
      console.error(`teutates: ${name} needs a value\n\n${usage()}`);
      process.exit(2);
    }
    if (name === "--addr") flags.addr = value;
    else flags.ui = value;
  }
  return flags;
}

// splitOnce cuts at the first separator, returning a null remainder when the
// separator is absent — the shape Go's strings.Cut has.
function splitOnce(text, separator) {
  const at = text.indexOf(separator);
  if (at === -1) return [text, null];
  return [text.slice(0, at), text.slice(at + separator.length)];
}

// splitAddr separates a listen address into host and port. A bare port and a
// bracketed IPv6 host are both accepted.
function splitAddr(addr) {
  const at = addr.lastIndexOf(":");
  if (at === -1) return { host: "127.0.0.1", port: Number(addr) };
  return { host: addr.slice(0, at) || "127.0.0.1", port: Number(addr.slice(at + 1)) };
}

// expandHome resolves a leading `~/` against the current user's home.
function expandHome(target) {
  if (target !== "~" && !target.startsWith("~/")) return target;
  return path.join(homedir(), target.replace(/^~\/?/, ""));
}

// expandEnv substitutes $VAR and ${VAR}, matching what Taskwarrior accepts in
// an include directive. An unset variable expands to nothing, as in a shell.
function expandEnv(target) {
  return target.replace(/\$(\w+)|\$\{([^}]*)\}/g, (_, bare, braced) =>
    process.env[bare ?? braced] ?? "");
}

// taskrcPath returns the rc file Taskwarrior would use: $TASKRC if set,
// otherwise ~/.taskrc.
function taskrcPath() {
  const configured = (process.env.TASKRC ?? "").trim();
  if (configured !== "") return expandHome(configured);
  return path.join(homedir(), ".taskrc");
}

// lookPath finds an executable on PATH, the way exec.LookPath does.
async function lookPath(name) {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir === "") continue;
    const candidate = path.join(dir, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return "";
}

// themeDirs returns the directories Taskwarrior searches for included rc
// fragments, derived from the location of the `task` binary
// (e.g. /opt/homebrew/bin/task -> /opt/homebrew/share/doc/task/rc).
async function themeDirs() {
  let found = await lookPath("task");
  if (found === "") return [];
  try {
    found = await realpath(found);
  } catch {}
  const prefix = path.dirname(path.dirname(found));
  return [path.join(prefix, "share", "doc", "task", "rc")];
}

// --- responses ---------------------------------------------------------

function send(res, status, body, type) {
  res.writeHead(status, {
    "content-type": type,
    "content-length": Buffer.byteLength(body),
    // The interface reads live task state; a cached answer would show a task
    // list that no longer exists.
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendJSON(res, status, payload) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

// fail answers in the one error shape the interface understands, so it can
// show something a reader can act on instead of a bare status code.
function fail(res, status, error, hint) {
  sendJSON(res, status, hint === undefined ? { error } : { error, hint });
}

// contentType covers the handful of types the interface ships.
function contentType(name) {
  switch (path.extname(name)) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".json": return "application/json; charset=utf-8";
    default: return "application/octet-stream";
  }
}

// --- request guards ----------------------------------------------------

// hostAllowed checks a Host or Origin authority against the address this
// server answers on. A name that resolves to loopback but is not one of these
// is refused, which is what stops DNS rebinding.
//
// The port is taken from the connection rather than from the flags, because
// `--addr 127.0.0.1:0` asks the operating system to pick one.
function hostAllowed(authority, listen) {
  if (authority === undefined || authority === "") return false;
  const [host, port] = splitAuthority(authority);
  if (port !== "" && Number(port) !== listen.port) return false;
  return loopbackHosts.has(host) || host === listen.host;
}

function splitAuthority(authority) {
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    if (close === -1) return [authority, ""];
    const rest = authority.slice(close + 1);
    return [authority.slice(0, close + 1), rest.startsWith(":") ? rest.slice(1) : ""];
  }
  const [host, port] = splitOnce(authority, ":");
  return [host, port ?? ""];
}

// originAllowed guards the write endpoint against a page on another origin.
// A missing Origin is accepted: curl and other non-browser clients do not
// send one, and a browser always does for a cross-origin request.
function originAllowed(origin, listen) {
  if (origin === undefined || origin === "") return true;
  if (origin === "null") return false;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return hostAllowed(url.host, listen);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxRequestBody) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// --- /api/task ---------------------------------------------------------

// checkArgs enforces the allowlist. It returns an explanation when the
// arguments are refused, and undefined when they may run.
//
// Taskwarrior's command line is `task [filter] <command> [arguments]`, so the
// command is not simply the first word: `task status:pending export` puts a
// filter in front of it. The first argument naming a command teutates knows
// is therefore taken to be the command, and what surrounds it is checked
// against what Taskwarrior would still read as syntax there.
function checkArgs(args) {
  if (!Array.isArray(args) || args.length === 0) {
    return "The request needs a non-empty `args` array.";
  }
  if (args.length > 64) {
    return "Too many arguments for one `task` invocation.";
  }
  for (const arg of args) {
    if (typeof arg !== "string") return "Every argument must be a string.";
    if (arg.includes("\0")) return "An argument contains a null byte.";
    // `rc:<file>` makes Taskwarrior read a different rc file, which would
    // move the data location out from under every other check here.
    if (arg.startsWith("rc:")) return `The override ${arg} is not allowed.`;
  }

  const at = args.findIndex((arg) => readCommands.has(arg) || writeCommands.has(arg));
  if (at === -1) {
    return "The arguments name no command teutates may run.";
  }

  // After a command that takes free text, the rest is a description the user
  // typed; before it, and after a read command, every word is still syntax.
  const syntax = freeTextCommands.has(args[at]) ? args.slice(0, at) : args;
  for (const arg of syntax) {
    if (arg !== args[at] && deniedCommands.has(arg)) {
      return `\`task ${arg}\` is not one of the commands teutates may run.`;
    }
  }
  // A `rc.` override is read as an override wherever it stands, free text
  // included, so those are checked across the whole command line.
  for (const arg of args) {
    if (arg.startsWith("rc.") && !allowedOverrides.some((prefix) => arg.startsWith(prefix))) {
      return `The override ${arg} is not allowed.`;
    }
  }
  return undefined;
}

// runTask executes the `task` binary. Arguments are never passed through a
// shell, and stdin is closed at once so a Taskwarrior that decides to prompt
// fails immediately instead of hanging until the timeout.
function runTask(args) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "task", args,
      { timeout: commandTimeout, maxBuffer: maxOutput, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout, stderr, code: 0 });
          return;
        }
        if (error.code === "ENOENT") {
          reject(Object.assign(new Error("`task` binary not found on PATH"), { kind: "missing" }));
          return;
        }
        if (error.killed === true) {
          reject(Object.assign(
            new Error(`\`task ${args.join(" ")}\` timed out after ${commandTimeout}ms`),
            { kind: "timeout" },
          ));
          return;
        }
        // A non-zero exit is an answer, not a transport failure: `task add`
        // rejecting an argument is something the interface should show.
        if (typeof error.code === "number") {
          resolve({ stdout, stderr, code: error.code });
          return;
        }
        reject(Object.assign(error, { kind: "failed" }));
      },
    );
    child.stdin?.end();
  });
}

async function handleTask(req, res, listen) {
  if (!originAllowed(req.headers.origin, listen)) {
    fail(res, 403,
      "This request did not come from the teutates interface.",
      "teutates only answers requests from the page it serves itself.");
    return;
  }
  // A JSON content type is not a simple request, so a browser must preflight
  // it. Since this server sends no CORS headers, that preflight fails and a
  // page on another origin never reaches this handler at all.
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim();
  if (type !== "application/json") {
    fail(res, 415,
      "This endpoint expects a JSON body.",
      "Send the request with `content-type: application/json`.");
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    fail(res, 413, "The request body is too large.");
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    fail(res, 400, "The request body is not valid JSON.",
      'Send {"args": ["export"]}.');
    return;
  }

  const refusal = checkArgs(parsed?.args);
  if (refusal !== undefined) {
    fail(res, 400, refusal,
      "teutates runs a fixed set of Taskwarrior commands; see the allowlist in the server.");
    return;
  }

  try {
    sendJSON(res, 200, await runTask(parsed.args));
  } catch (error) {
    if (error.kind === "missing") {
      fail(res, 503, "taskwarrior: `task` binary not found on PATH",
        "Install Taskwarrior and make sure `task` is on the PATH of the process running teutates.");
      return;
    }
    if (error.kind === "timeout") {
      fail(res, 504, `taskwarrior: ${error.message}`,
        "Taskwarrior did not respond. Run `task _show` in a terminal to check for a prompt or a lock.");
      return;
    }
    fail(res, 500, `taskwarrior: ${error.message}`);
  }
}

// --- /api/rc -----------------------------------------------------------

// resolveRC locates an rc file the way Taskwarrior locates an include:
// relative to the including file first, then in the shipped rc directories.
async function resolveRC(target, base, dirs) {
  target = expandHome(expandEnv(target));

  let candidates = [target];
  if (!path.isAbsolute(target)) {
    candidates = base === "" ? [] : [path.join(base, target)];
    for (const dir of dirs) candidates.push(path.join(dir, target));
  }

  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {}
  }
  return "";
}

// within reports whether a resolved path sits inside one of the directories
// the interface is allowed to read from.
function within(target, roots) {
  return roots.some((root) => target === root || target.startsWith(root + path.sep));
}

async function handleRC(req, res, url, env) {
  const target = url.searchParams.get("path") ?? "";
  const base = url.searchParams.get("base") ?? "";
  if (target === "") {
    fail(res, 400, "The request needs a `path` parameter.");
    return;
  }

  const found = await resolveRC(target, base, env.themeDirs);
  if (found === "") {
    fail(res, 404, `No rc file was found for ${target}.`);
    return;
  }

  // The interface only ever asks for the rc file and what it includes, so the
  // reachable set is bounded here rather than trusted from the request.
  let resolved;
  try {
    resolved = await realpath(found);
  } catch {
    fail(res, 404, `No rc file was found for ${target}.`);
    return;
  }
  if (!within(resolved, env.roots)) {
    fail(res, 403, `Reading ${target} is not allowed.`,
      "teutates reads rc files from your home directory and Taskwarrior's own rc directories.");
    return;
  }

  let info;
  try {
    info = await stat(resolved);
  } catch {
    fail(res, 404, `No rc file was found for ${target}.`);
    return;
  }
  if (info.size > maxRCSize) {
    fail(res, 413, `${found} is too large to be an rc file.`);
    return;
  }

  // The canonical path is what the interface sees, so two includes naming
  // the same file the long way and the short way are recognised as one and
  // an include cycle terminates.
  sendJSON(res, 200, { path: resolved, content: await readFile(resolved, "utf8") });
}

// --- static files ------------------------------------------------------

// assetPath maps a requested asset name into the assets directory, or returns
// "" when the name does not denote a file. Taking the base name drops any
// directory part, and "." and ".." are rejected outright because joining
// either would walk back out of the assets directory.
function assetPath(name) {
  const base = path.basename(name);
  if (base === "." || base === ".." || base === "/" || base === "") return "";
  return path.join("assets", base);
}

async function serveUIFile(res, uiDir, name) {
  let data;
  try {
    data = await readFile(path.join(uiDir, name));
  } catch {
    fail(res, 404, `The interface file ${name} is missing.`,
      "Build it with `npm run build` in the ui directory, then reload.");
    return;
  }
  send(res, 200, data, contentType(name));
}

// --- routing -----------------------------------------------------------

function notFound(res, pathname) {
  if (!pathname.startsWith("/api/")) {
    fail(res, 404, `Nothing is served at ${pathname}.`,
      "The interface is served at /. If it is missing, build it with `npm run build` in the ui directory.");
    return;
  }
  fail(res, 404, `Unknown API endpoint ${pathname}.`,
    "If this endpoint was added recently, restart the server — a running process does not pick up newly added routes.");
}

function methodNotAllowed(res, method, pathname, allowed) {
  res.setHeader("allow", allowed);
  fail(res, 405, `${method} is not supported on ${pathname}.`,
    `${pathname} answers ${allowed}.`);
}

export function createTeutates({ uiDir, listen }) {
  // The environment is read once: the rc path and the theme directories do
  // not change while the server runs, and the interface asks for them on
  // every reload of its configuration.
  const environment = (async () => {
    const rc = taskrcPath();
    const dirs = await themeDirs();
    return {
      taskrcPath: rc,
      themeDirs: dirs,
      home: homedir(),
      // An rc file may legitimately live outside the home directory when
      // $TASKRC points elsewhere, so its own directory is reachable too.
      //
      // The roots are canonicalised because the files they are compared
      // against are: a home directory reached through a symlink would
      // otherwise never contain its own rc file.
      roots: await canonical([homedir(), path.dirname(rc), ...dirs]),
    };
  })();

  return createServer(async (req, res) => {
    try {
      // The port a request actually arrived on is what a Host or Origin
      // header has to match, so a server started on port 0 is checked
      // against the port it was given rather than against the flag.
      const reached = { host: listen.host, port: req.socket.localPort ?? listen.port };

      if (!hostAllowed(req.headers.host, reached)) {
        fail(res, 421, "teutates does not answer for this host name.",
          `Reach it at http://127.0.0.1:${reached.port}/.`);
        return;
      }

      const url = new URL(req.url, "http://localhost");
      const env = await environment;

      switch (url.pathname) {
        case "/api/task":
          if (req.method !== "POST") { methodNotAllowed(res, req.method, url.pathname, "POST"); return; }
          await handleTask(req, res, reached);
          return;

        case "/api/rc":
          if (req.method !== "GET") { methodNotAllowed(res, req.method, url.pathname, "GET"); return; }
          await handleRC(req, res, url, env);
          return;

        case "/api/env":
          if (req.method !== "GET") { methodNotAllowed(res, req.method, url.pathname, "GET"); return; }
          sendJSON(res, 200, {
            taskrcPath: env.taskrcPath,
            taskrcMtime: await mtimeOf(env.taskrcPath),
            home: env.home,
            themeDirs: env.themeDirs,
          });
          return;

        case "/":
          if (req.method !== "GET") { methodNotAllowed(res, req.method, url.pathname, "GET"); return; }
          await serveUIFile(res, uiDir, "index.html");
          return;
      }

      if (url.pathname.startsWith("/assets/")) {
        if (req.method !== "GET") { methodNotAllowed(res, req.method, url.pathname, "GET"); return; }
        const name = assetPath(url.pathname.slice("/assets/".length));
        if (name === "") { notFound(res, url.pathname); return; }
        await serveUIFile(res, uiDir, name);
        return;
      }

      notFound(res, url.pathname);
    } catch (error) {
      if (!res.headersSent) fail(res, 500, `teutates: ${error.message}`);
      else res.end();
    }
  });
}

// canonical resolves each directory through any symlinks, dropping the ones
// that do not exist.
async function canonical(dirs) {
  const resolved = [];
  for (const dir of dirs) {
    try {
      resolved.push(await realpath(dir));
    } catch {}
  }
  return resolved;
}

// mtimeOf reports the rc file's modification time, which the interface uses
// to decide whether its cached configuration is still current. A missing rc
// file is not an error: every value is then simply a Taskwarrior default.
async function mtimeOf(target) {
  try {
    return (await stat(target)).mtimeMs;
  } catch {
    return null;
  }
}

// Running the file starts a server; importing it does not, so the tests can
// bind their own port.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags = parseFlags(process.argv.slice(2));
  const listen = splitAddr(flags.addr);
  const uiDir = flags.ui !== ""
    ? path.resolve(flags.ui)
    : path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");

  createTeutates({ uiDir, listen }).listen(listen.port, listen.host, () => {
    // Binding to loopback by default keeps a user's task configuration off
    // the network; teutates has no authentication.
    console.log(`teutates listening on http://${flags.addr} (ui: ${uiDir})`);
  });
}
