import assert from "node:assert/strict";
import { test } from "node:test";

import {
  build,
  compareGroups,
  groupOf,
  parseShow,
  parseVersion,
  udaLabels,
} from "../../src/taskwarrior/config";
import type { Config, Setting } from "../../src/taskwarrior/config";
import type { Origin } from "../../src/taskwarrior/taskrc";

const generalGroup = "general";

function origins(entries: Record<string, Origin>): Map<string, Origin> {
  return new Map(Object.entries(entries));
}

function byKey(config: Config): Map<string, Setting> {
  return new Map(config.settings.map((setting) => [setting.key, setting]));
}

test("parseShow reads key=value lines", () => {
  const values = parseShow([
    "_forcecolor=0",
    "color=off",
    "sort=priority-,due+",
    "report.list.labels=ID,Start,Fällig",
    "empty=",
    "garbage line without separator",
    "",
  ].join("\n"));

  assert.equal(values.size, 5);
  assert.equal(values.get("_forcecolor"), "0");
  assert.equal(values.get("color"), "off");
  assert.equal(values.get("sort"), "priority-,due+");
  assert.equal(values.get("report.list.labels"), "ID,Start,Fällig");
  assert.equal(values.get("empty"), "");
});

// A value containing '=' must keep everything after the first separator.
test("parseShow keeps everything after the first separator", () => {
  const values = parseShow("alias.x=rc.verbose=nothing");
  assert.equal(values.get("alias.x"), "rc.verbose=nothing");
});

test("groupOf derives the group from the key prefix", () => {
  assert.equal(groupOf("color.active"), "color");
  assert.equal(groupOf("report.list.labels"), "report");
  assert.equal(groupOf("sort"), generalGroup);
  assert.equal(groupOf("_forcecolor"), generalGroup);
  assert.equal(groupOf(".leading"), generalGroup);
});

test("compareGroups keeps general first", () => {
  assert.ok(compareGroups(generalGroup, "alias") < 0);
  assert.ok(compareGroups("alias", generalGroup) > 0);
  assert.ok(compareGroups("alias", "color") < 0);
});

test("build marks origins and divergence", () => {
  const effective = new Map([
    ["color", "off"], // resolved to off without a TTY
    ["sort", "priority-,due+"],
    ["color.due", "red"],
    ["bulk", "3"], // untouched default
  ]);

  const config = build(
    effective,
    origins({
      color: { source: "taskrc", value: "on" },
      sort: { source: "taskrc", value: "priority-,due+" },
      "color.due": { source: "include:colors.theme", value: "red" },
    }),
    "/home/user/.taskrc", "3.5.0", [], [],
  );

  const settings = byKey(config);

  // A TTY-dependent key keeps both the effective and the configured value.
  assert.deepEqual(
    { value: settings.get("color")?.value, configured: settings.get("color")?.configuredValue },
    { value: "off", configured: "on" },
  );
  assert.equal(settings.get("color")?.isOverride, true);
  // Matching values must not report a spurious divergence.
  assert.equal(settings.get("sort")?.configuredValue, undefined);
  assert.equal(settings.get("color.due")?.source, "include:colors.theme");
  assert.equal(settings.get("bulk")?.isOverride, false);
  assert.equal(settings.get("bulk")?.source, "default");

  // general first, then alphabetical.
  assert.equal(config.groups[0]?.name, generalGroup);
  assert.equal(config.groups[0]?.count, 3);
});

test("build sorts settings by group then key", () => {
  const config = build(
    new Map([
      ["color.due", "red"],
      ["color.active", "blue"],
      ["zebra", "1"],
      ["alias.rm", "delete"],
    ]),
    new Map(), "", "", [], [],
  );

  assert.deepEqual(
    config.settings.map((setting) => setting.key),
    ["zebra", "alias.rm", "color.active", "color.due"],
  );
});

test("parseVersion takes the first line", () => {
  assert.equal(parseVersion("3.5.0\n\nsome trailing notice\n"), "3.5.0");
});

// A key present in the rc file but unknown to Taskwarrior has no effect, so
// the interface needs to be able to say so.
test("build marks unrecognized keys", () => {
  const config = build(
    new Map([["sort", "priority-,due+"], ["bulk", "3"]]),
    origins({ sort: { source: "taskrc", value: "priority-,due+" } }),
    "/home/user/.taskrc", "3.5.0", [], ["sort"],
  );

  const settings = byKey(config);
  assert.equal(settings.get("sort")?.unrecognized, true);
  assert.equal(settings.get("bulk")?.unrecognized, undefined);
  assert.deepEqual(config.unrecognizedKeys, ["sort"]);
});

test("udaLabels reads only uda.<name>.label entries", () => {
  const config = build(
    new Map([
      ["uda.pom.label", "Pomodoris"],
      ["uda.pom.type", "numeric"],
      ["uda.empty.label", ""],
      ["report.list.labels", "ID,Description"],
    ]),
    new Map(), "", "", [], [],
  );

  assert.deepEqual(udaLabels(config), { pom: "Pomodoris" });
});
