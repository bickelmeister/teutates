import assert from "node:assert/strict";
import { test } from "node:test";

import {
  countTasks,
  parseStatusFilter,
  parseTaskDate,
  parseTasks,
  statusFilterArgs,
} from "../../src/taskwarrior/tasks";
import type { Task } from "../../src/taskwarrior/tasks";
import { ConfigError } from "../../src/taskwarrior/client";

/** A trimmed but realistic slice of `task export` output, including a
 *  user-defined attribute, a completed task without a working id, and a
 *  recurrence field that must not surface as a UDA. */
const exportFixture = `[
  {"id":19,"description":"Flaschenvertrag fertigstellen","due":"20260823T215959Z",
   "entry":"20260820T200007Z","modified":"20260824T094830Z","pom":1,"priority":"H",
   "status":"pending","uuid":"46df3135-ff84-496a-891c-b1bf79991a67","tags":["privat"],
   "urgency":24.4096},
  {"id":4,"description":"PROD-1140","due":"20260820T220000Z","entry":"20260820T185526Z",
   "start":"20260821T170114Z","modified":"20260821T170114Z","priority":"H",
   "status":"pending","uuid":"3618ff3a-a4d9-4336-b413-08faf4a2e708","tags":["beruflich"],
   "urgency":21.781},
  {"id":0,"description":"Ordnungssystem entwickeln","end":"20260822T130438Z",
   "entry":"20260821T170733Z","modified":"20260822T130438Z","priority":"H",
   "status":"completed","uuid":"1cb582cd-218c-4d2a-8be7-87e45cb66a33","tags":[],
   "estimate":"PT2H","urgency":13.7452,
   "annotations":[{"entry":"20260822T120000Z","description":"scanner ready"}]},
  {"id":30,"description":"Wochenrueckblick","entry":"20260801T090000Z",
   "modified":"20260801T090000Z","status":"recurring","recur":"weekly","rtype":"periodic",
   "mask":"++","uuid":"7f0b6a41-1d0e-4c33-9a1f-2b6c5d0e9a12","urgency":3.2,
   "depends":["46df3135-ff84-496a-891c-b1bf79991a67"]}
]`;

function fixture(): Task[] {
  const tasks = parseTasks(exportFixture);
  assert.equal(tasks.length, 4);
  return tasks;
}

function byUUID(tasks: Task[], uuid: string): Task {
  const found = tasks.find((task) => task.uuid === uuid);
  assert.ok(found !== undefined, `no task ${uuid}`);
  return found;
}

test("parseTasks converts dates to RFC 3339", () => {
  const task = byUUID(fixture(), "46df3135-ff84-496a-891c-b1bf79991a67");
  assert.equal(task.due, "2026-08-23T21:59:59Z");
  assert.equal(task.entry, "2026-08-20T20:00:07Z");
  // The converted value must be what the browser's Date can parse.
  assert.ok(!Number.isNaN(new Date(task.due!).valueOf()));
});

test("parseTaskDate leaves unknown formats intact", () => {
  assert.equal(parseTaskDate("not-a-date"), "not-a-date");
  assert.equal(parseTaskDate(""), "");
  // Well-shaped but impossible: Date.UTC would roll this into March.
  assert.equal(parseTaskDate("20260230T000000Z"), "20260230T000000Z");
});

test("parseTasks captures UDAs and skips recurrence bookkeeping", () => {
  const tasks = fixture();

  const numeric = byUUID(tasks, "46df3135-ff84-496a-891c-b1bf79991a67");
  assert.equal(numeric.udas?.pom, "1", "want \"1\" without a decimal tail");

  const duration = byUUID(tasks, "1cb582cd-218c-4d2a-8be7-87e45cb66a33");
  assert.equal(duration.udas?.estimate, "PT2H");

  // rtype, mask and parent are recurrence bookkeeping, not user attributes.
  const recurring = byUUID(tasks, "7f0b6a41-1d0e-4c33-9a1f-2b6c5d0e9a12");
  assert.equal(recurring.udas, undefined);
  assert.equal(recurring.recur, "weekly");
  assert.deepEqual(recurring.depends, ["46df3135-ff84-496a-891c-b1bf79991a67"]);
});

test("parseTasks reads annotations", () => {
  const task = byUUID(fixture(), "1cb582cd-218c-4d2a-8be7-87e45cb66a33");
  assert.equal(task.annotations?.length, 1);
  assert.equal(task.annotations?.[0]?.entry, "2026-08-22T12:00:00Z");
  assert.equal(task.annotations?.[0]?.description, "scanner ready");
});

// Completed tasks export as id 0, so the interface must not use the id as
// identity.
test("completed tasks have no working id", () => {
  const task = byUUID(fixture(), "1cb582cd-218c-4d2a-8be7-87e45cb66a33");
  assert.equal(task.id, 0);
  assert.notEqual(task.uuid, "");
});

test("countTasks summarises by status", () => {
  // Between the fixture's two due dates, so exactly one is overdue.
  const counts = countTasks(fixture(), new Date("2026-08-22T00:00:00Z"));
  assert.deepEqual(counts, {
    total: 4, pending: 2, completed: 1, waiting: 0,
    recurring: 1, deleted: 0, active: 1, overdue: 1,
  });
});

// A completed task with a due date in the past is finished, not overdue.
test("countTasks ignores overdue on finished tasks", () => {
  const tasks: Task[] = [
    { id: 0, uuid: "x", description: "", status: "completed", urgency: 0, due: "2020-01-01T00:00:00Z" },
  ];
  assert.equal(countTasks(tasks, new Date()).overdue, 0);
});

test("parseStatusFilter accepts only known values", () => {
  assert.equal(parseStatusFilter(""), "pending");
  assert.equal(parseStatusFilter("pending"), "pending");
  assert.equal(parseStatusFilter("completed"), "completed");
  assert.equal(parseStatusFilter("all"), "all");

  // Anything else is rejected before it can reach the command line.
  for (const input of ["deleted", "pending; rm -rf /", "rc.data.location=/tmp"]) {
    assert.throws(() => parseStatusFilter(input), ConfigError, input);
  }
});

test("statusFilterArgs maps a filter onto the command line", () => {
  assert.deepEqual(statusFilterArgs("pending"), ["status:pending"]);
  assert.deepEqual(statusFilterArgs("completed"), ["status:completed"]);
  assert.deepEqual(statusFilterArgs("all"), []);
});

test("a UDA of any type renders as text", () => {
  const tasks = parseTasks(JSON.stringify([{
    uuid: "x", text: "PT2H", whole: 3, fractional: 3.5,
    flag: true, nothing: null, list: ["a", "b"],
  }]));
  assert.deepEqual(tasks[0]?.udas, {
    text: "PT2H", whole: "3", fractional: "3.5",
    flag: "true", nothing: "", list: '["a","b"]',
  });
});

// A single malformed field must not take the whole list down.
test("decoding tolerates wrong types", () => {
  const tasks = parseTasks(
    '[{"uuid":"x","description":"ok","urgency":"not-a-number","tags":"privat"}]',
  );
  assert.equal(tasks[0]?.description, "ok");
  assert.equal(tasks[0]?.urgency, 0);
  // A comma-separated string is how older versions exported lists.
  assert.deepEqual(tasks[0]?.tags, ["privat"]);
});

test("parseTasks rejects output that is not a task list", () => {
  assert.throws(() => parseTasks("not json"), ConfigError);
  assert.throws(() => parseTasks('{"id":1}'), ConfigError);
});
