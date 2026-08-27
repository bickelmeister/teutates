import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSortSpec, sortSpecFor, sortTasksBy } from "../../src/taskwarrior/sortspec";
import { build } from "../../src/taskwarrior/config";
import type { Config } from "../../src/taskwarrior/config";
import type { Task } from "../../src/taskwarrior/tasks";

const defaultSortSpec = "urgency-";

/** A task carrying only the fields a sort clause reads. */
function task(fields: Partial<Task> & { id: number }): Task {
  return {
    uuid: "", description: "", status: "pending", urgency: 0,
    ...fields,
  };
}

function ids(tasks: Task[]): number[] {
  return tasks.map((entry) => entry.id);
}

function configWith(settings: Record<string, string>): Config {
  return build(new Map(Object.entries(settings)), new Map(), "", "", [], []);
}

test("parseSortSpec reads direction per clause", () => {
  const { keys, unsupported } = parseSortSpec("start-,due+,project+,urgency-");
  assert.deepEqual(keys, [
    { attribute: "start", descending: true },
    { attribute: "due", descending: false },
    { attribute: "project", descending: false },
    { attribute: "urgency", descending: true },
  ]);
  assert.deepEqual(unsupported, []);
});

// A trailing "/" marks a visual break in Taskwarrior's reports and must not
// be read as part of the attribute name.
test("parseSortSpec strips the break marker", () => {
  const { keys, unsupported } = parseSortSpec("project+/,description+");
  assert.equal(keys.length, 2);
  assert.deepEqual(keys[0], { attribute: "project", descending: false });
  assert.deepEqual(unsupported, []);
});

// An attribute teutates cannot sort by is reported instead of silently
// changing the order.
test("parseSortSpec reports unsupported attributes", () => {
  const { keys, unsupported } = parseSortSpec("due+,depends-,urgency-");
  assert.equal(keys.length, 2);
  assert.deepEqual(unsupported, ["depends"]);
});

test("parseSortSpec ignores empty clauses", () => {
  const { keys } = parseSortSpec(" , due+ ,, ");
  assert.deepEqual(keys, [{ attribute: "due", descending: false }]);
});

// A clause without an explicit direction is ascending.
test("parseSortSpec defaults to ascending", () => {
  const { keys } = parseSortSpec("project");
  assert.deepEqual(keys, [{ attribute: "project", descending: false }]);
});

// Taskwarrior sorts tasks without the date last whichever way the clause
// points, so an undated task never leads the list.
test("missing dates sort last in both directions", () => {
  for (const spec of ["due+", "due-"]) {
    const tasks = [
      task({ id: 1 }),
      task({ id: 2, due: "2026-08-23T00:00:00Z" }),
      task({ id: 3, due: "2026-08-20T00:00:00Z" }),
    ];
    sortTasksBy(tasks, parseSortSpec(spec).keys);
    assert.equal(tasks[2]?.id, 1, `${spec}: undated task should be last`);
  }
});

// Text is different: an empty project sorts first ascending, which is how
// `project+` behaves in Taskwarrior.
test("missing text sorts naturally", () => {
  const tasks = [
    task({ id: 1, project: "diaro" }),
    task({ id: 2 }),
    task({ id: 3, project: "portio" }),
  ];

  sortTasksBy(tasks, parseSortSpec("project+").keys);
  assert.equal(tasks[0]?.id, 2, `order = ${ids(tasks)}`);

  sortTasksBy(tasks, parseSortSpec("project-").keys);
  assert.equal(tasks[2]?.id, 2, `order = ${ids(tasks)}`);
});

// A task without a priority ranks below L.
test("priority orders H, M, L and then the unprioritised", () => {
  const tasks = [
    task({ id: 1, priority: "L" }),
    task({ id: 2 }),
    task({ id: 3, priority: "H" }),
    task({ id: 4, priority: "M" }),
  ];
  sortTasksBy(tasks, parseSortSpec("priority-").keys);
  assert.deepEqual(ids(tasks), [3, 4, 1, 2]);
});

// Completed tasks all export an id of 0, so the uuid has to break the tie
// for the order to be stable across requests.
test("ties break on id then uuid", () => {
  const tasks = [
    task({ id: 0, uuid: "b", urgency: 5 }),
    task({ id: 0, uuid: "a", urgency: 5 }),
    task({ id: 7, uuid: "z", urgency: 5 }),
  ];
  sortTasksBy(tasks, parseSortSpec("urgency-").keys);
  assert.deepEqual(tasks.map((entry) => entry.uuid), ["a", "b", "z"]);
});

test("sortSpecFor reads the list report", () => {
  const config = configWith({
    "report.next.sort": "urgency-",
    "report.list.sort": "start-,due+,project+,urgency-",
  });
  assert.equal(sortSpecFor(config), "start-,due+,project+,urgency-");
});

// The bare `sort` key is not a Taskwarrior setting; it must not be picked up
// in place of the report's order.
test("sortSpecFor ignores the bare sort key", () => {
  assert.equal(sortSpecFor(configWith({ sort: "priority-,due+" })), defaultSortSpec);
});

test("sortSpecFor falls back without a configuration", () => {
  assert.equal(sortSpecFor(undefined), defaultSortSpec);
});

// The order teutates produces must match what `task list` prints. Anything
// else means the interface and the command line disagree about the same data.
test("the order matches real `task list` output", () => {
  // Captured from a real Taskwarrior 3.5.0 installation together with the
  // output of `task list`, so the expected order below is ground truth rather
  // than a restatement of the implementation.
  const tasks = [
    task({ id: 1, uuid: "057205d5", due: "2027-07-30T22:00:00Z", urgency: 7.22192 }),
    task({ id: 2, uuid: "dcde27a7", due: "2026-08-31T21:59:59Z", project: "fincheck.ios", urgency: 9.58289 }),
    task({ id: 3, uuid: "52a93642", project: "portio", urgency: 5.72192 }),
    task({ id: 4, uuid: "3618ff3a", start: "2026-08-21T17:01:14Z", due: "2026-08-20T22:00:00Z", urgency: 21.8115 }),
    task({ id: 5, uuid: "160b8dce", due: "2026-08-31T21:59:59Z", project: "fincheck.ios", urgency: 9.58289 }),
    task({ id: 6, uuid: "7c8f4b91", due: "2026-08-31T21:59:59Z", project: "fincheck.ios", urgency: 11.6829 }),
    task({ id: 7, uuid: "95c9e7c1", due: "2026-08-31T21:59:59Z", project: "jobrad.devex.kavator", urgency: 11.6829 }),
    task({ id: 8, uuid: "90700966", due: "2026-08-31T21:59:59Z", project: "jobrad.devex.kavator", urgency: 13.7829 }),
    task({ id: 9, uuid: "f609f15d", due: "2026-08-31T21:59:59Z", project: "jobrad.devex.kavator", urgency: 11.6829 }),
    task({ id: 10, uuid: "85d4f703", due: "2026-09-10T22:00:00Z", project: "jobrad.devex.kavator", urgency: 8.12192 }),
    task({ id: 11, uuid: "1acfe336", due: "2026-09-03T22:00:00Z", project: "jobrad.devex.kavator", urgency: 10.3115 }),
    task({ id: 12, uuid: "13f32377", due: "2026-09-03T22:00:00Z", project: "jobrad.devex.kavator", urgency: 10.3115 }),
    task({ id: 14, uuid: "e75d8cfc", due: "2026-08-31T21:59:59Z", project: "jobrad", urgency: 13.7829 }),
    task({ id: 15, uuid: "64a334fd", project: "diaro", urgency: 5.72192 }),
    task({ id: 16, uuid: "8596aee3", project: "diaro.ios", urgency: 5.72192 }),
    task({ id: 17, uuid: "7b5e2df3", project: "diaro.ios", urgency: 5.72192 }),
    task({ id: 18, uuid: "b9ad9769", due: "2026-08-30T21:59:59Z", urgency: 8.24003 }),
    task({ id: 19, uuid: "46df3135", due: "2026-08-23T21:59:59Z", urgency: 24.44 }),
    task({ id: 20, uuid: "ae03da31", due: "2026-08-31T21:59:59Z", urgency: 12.7829 }),
    task({ id: 21, uuid: "a30df783", start: "2026-08-22T13:04:53Z", due: "2026-08-23T21:59:59Z", project: "digitaleablage", urgency: 19.3346 }),
    task({ id: 22, uuid: "070ae6e4", due: "2026-08-31T21:59:59Z", project: "digitaleablage", urgency: 11.6774 }),
    task({ id: 23, uuid: "39e43dd5", due: "2026-08-31T21:59:59Z", project: "digitaleablage", urgency: 11.6774 }),
    task({ id: 24, uuid: "cc649b1a", due: "2026-08-31T21:59:59Z", project: "digitaleablage", urgency: 11.6774 }),
    task({ id: 25, uuid: "3e4886e1", due: "2026-09-04T19:29:25Z", project: "digitaleablage", urgency: 9.89664 }),
    task({ id: 26, uuid: "d4ddaf61", due: "2026-09-04T19:29:36Z", project: "digitaleablage", urgency: 9.89658 }),
    task({ id: 27, uuid: "ccce8c2e", due: "2026-09-04T19:29:52Z", project: "digitaleablage", urgency: 9.8965 }),
    task({ id: 28, uuid: "5313a9b5", due: "2026-08-23T22:00:00Z", urgency: 16.4291 }),
    task({ id: 29, uuid: "7183a448", urgency: 2.60548 }),
  ];

  const { keys, unsupported } = parseSortSpec("start-,due+,project+,urgency-");
  assert.deepEqual(unsupported, []);
  sortTasksBy(tasks, keys);

  assert.deepEqual(ids(tasks), [
    21, 4, 19, 28, 18, 20, 22, 23, 24, 6, 2, 5, 14, 8, 7, 9,
    11, 12, 25, 26, 27, 10, 1, 29, 15, 16, 17, 3,
  ]);
});
