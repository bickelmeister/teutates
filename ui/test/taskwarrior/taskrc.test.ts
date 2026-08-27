import assert from "node:assert/strict";
import { realpathSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { ReadRC } from "../../src/taskwarrior/client";
import { includeTarget, parseTaskrc } from "../../src/taskwarrior/taskrc";

const testdata = path.resolve(process.cwd(), "test", "testdata");

/** Stands in for the server's /api/rc, resolving the way it does: relative to
 *  the including file first, then in the theme directories. */
function reader(themeDirs: string[] = []): ReadRC {
  return async (target, base) => {
    const candidates = path.isAbsolute(target)
      ? [target]
      : [base === "" ? path.join(testdata, target) : path.join(base, target),
         ...themeDirs.map((dir) => path.join(dir, target))];

    for (const candidate of candidates) {
      try {
        if (!statSync(candidate).isFile()) continue;
      } catch {
        continue;
      }
      const resolved = realpathSync(candidate);
      return { path: resolved, content: readFileSync(resolved, "utf8") };
    }
    return null;
  };
}

test("parseTaskrc resolves includes and records origins", async () => {
  const { origins, unresolved } = await parseTaskrc("base.taskrc", reader());

  const cases: Record<string, { source: string; value: string }> = {
    "data.location": { source: "taskrc", value: "/home/user/.task" },
    color: { source: "taskrc", value: "on" },
    // Whitespace around `=` must be stripped from key and value.
    sort: { source: "taskrc", value: "priority-,due+" },
    // Values from an included file are attributed to that file.
    "color.active": { source: "include:colors.theme", value: "rgb555 on rgb410" },
    "color.due": { source: "include:colors.theme", value: "red" },
    // A key that merely starts with "include" is an ordinary setting.
    "includes.notadirective": { source: "taskrc", value: "1" },
  };
  for (const [key, want] of Object.entries(cases)) {
    assert.deepEqual(origins.get(key), want, key);
  }

  assert.equal(origins.has("A comment line"), false);

  // An include that cannot be located is reported, not fatal.
  assert.deepEqual(unresolved, ["/nonexistent/missing.theme"]);
});

test("parseTaskrc terminates on an include cycle", async () => {
  const { origins } = await parseTaskrc("cycle-a.taskrc", reader());
  assert.equal(origins.get("a")?.value, "1");
  assert.equal(origins.get("b")?.value, "2");
});

// Where the Go backend treated a missing rc file as an error the caller then
// discarded, the interface simply reports no origins: every value is a
// Taskwarrior default, which is exactly what a missing rc file means.
test("parseTaskrc reports no origins for a missing rc file", async () => {
  const { origins, unresolved } = await parseTaskrc("does-not-exist", reader());
  assert.equal(origins.size, 0);
  assert.deepEqual(unresolved, []);
});

test("parseTaskrc falls back to the theme directories", async () => {
  const read = reader([testdata]);
  const { origins, unresolved } = await parseTaskrc(
    path.join(testdata, "base.taskrc"),
    async (target, base) => read(target, base === testdata ? "/nonexistent" : base),
  );
  assert.equal(origins.get("color.due")?.source, "include:colors.theme");
  assert.deepEqual(unresolved, ["/nonexistent/missing.theme"]);
});

test("includeTarget recognises the include directive", () => {
  const cases: [string, string | undefined][] = [
    ["include default.theme", "default.theme"],
    ["include=default.theme", "default.theme"],
    ["include   spaced.theme", "spaced.theme"],
    ["includes.foo=1", undefined],
    ["include", undefined],
    ["include ", undefined],
    ["color=on", undefined],
  ];
  for (const [line, want] of cases) {
    assert.equal(includeTarget(line), want, line);
  }
});
