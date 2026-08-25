import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import type { TaskList } from "../src/api";
import { tasksView } from "../src/tasks";
import { click, createHarness, mount, search, stubFetch, type Harness } from "./harness";

const now = Date.now();
const inDays = (days: number) =>
  new Date(now + days * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");

const fixture: TaskList = {
  status: "pending",
  counts: {
    total: 3,
    pending: 2,
    completed: 1,
    waiting: 0,
    recurring: 0,
    deleted: 0,
    active: 1,
    overdue: 1,
  },
  udaLabels: { pom: "Pomodoris" },
  tasks: [
    {
      id: 19,
      uuid: "46df3135-ff84-496a-891c-b1bf79991a67",
      description: "Flaschenvertrag fertigstellen",
      status: "pending",
      project: "privat.vertrag",
      tags: ["privat"],
      priority: "H",
      urgency: 24.4096,
      due: inDays(-2),
      udas: { pom: "1" },
    },
    {
      id: 4,
      uuid: "3618ff3a-a4d9-4336-b413-08faf4a2e708",
      description: "PROD-1140",
      status: "pending",
      tags: ["beruflich"],
      priority: "M",
      urgency: 21.781,
      due: inDays(3),
      start: inDays(-1),
    },
    {
      id: 0,
      uuid: "1cb582cd-218c-4d2a-8be7-87e45cb66a33",
      description: "Ordnungssystem entwickeln",
      status: "completed",
      urgency: 13.7452,
      annotations: [{ entry: inDays(-3), description: "scanner ready" }],
    },
  ],
};

let harness: Harness;

function rows(): Element[] {
  return harness.rows("data-task");
}

function columns(row: Element): (string | null)[] {
  return [...row.children].map((cell) => cell.textContent);
}

describe("tasks view", () => {
  before(async () => {
    harness = createHarness();
    stubFetch(fixture);
    await mount(harness, tasksView());
  });
  after(() => harness.close());

  test("renders one row per task, in the order the backend sent", () => {
    assert.deepEqual(
      rows().map((row) => row.getAttribute("data-task")),
      fixture.tasks.map((task) => task.uuid),
    );
  });

  test("shows a placeholder instead of the fake id 0 on completed tasks", () => {
    const completed = rows()[2];
    assert.ok(completed);
    assert.equal(columns(completed)[0], "—");
    // The working id of a pending task is real and worth showing.
    assert.equal(columns(rows()[0] as Element)[0], "19");
  });

  test("renders a past due date as overdue and a future one plainly", () => {
    const overdue = rows()[0] as Element;
    const upcoming = rows()[1] as Element;

    const overdueCell = overdue.children[3] as HTMLElement;
    const upcomingCell = upcoming.children[3] as HTMLElement;

    assert.match(overdueCell.textContent ?? "", /ago/);
    assert.ok(overdueCell.className.includes("text-accent"));
    assert.match(upcomingCell.textContent ?? "", /^in 3 days$/);
    assert.ok(!upcomingCell.className.includes("text-accent"));
  });

  test("a task without a due date shows a placeholder", () => {
    const completed = rows()[2] as Element;
    assert.equal((completed.children[3] as HTMLElement).textContent, "—");
  });

  test("urgency is rounded to one decimal", () => {
    assert.equal(columns(rows()[0] as Element)[1], "24.4");
  });

  test("marks a started task with the active indicator", () => {
    const started = rows()[1] as Element;
    assert.match(started.textContent ?? "", /^\s*4\s*21\.8\s*M/);
    assert.ok(started.querySelector(".text-accent"));
  });

  test("renders tags and resolves uda labels", () => {
    const first = rows()[0] as Element;
    assert.match(first.textContent ?? "", /#privat/);
    assert.match(first.textContent ?? "", /Pomodoris: 1/);
  });

  test("summarises annotations rather than dumping them into the row", () => {
    const completed = rows()[2] as Element;
    assert.match(completed.textContent ?? "", /1 note/);
    assert.doesNotMatch(completed.textContent ?? "", /scanner ready/);
  });

  test("meta line reports the counts that matter", () => {
    const meta = harness.text("meta");
    assert.match(meta, /3 shown/);
    assert.match(meta, /1 overdue/);
    assert.match(meta, /1 active/);
  });

  test("search matches description, project, tags and working id", () => {
    search(harness, "vertrag");
    assert.equal(rows().length, 1, "project and description both match");

    search(harness, "beruflich");
    assert.deepEqual(
      rows().map((row) => row.getAttribute("data-task")),
      ["3618ff3a-a4d9-4336-b413-08faf4a2e708"],
    );

    search(harness, "19");
    assert.deepEqual(
      rows().map((row) => row.getAttribute("data-task")),
      ["46df3135-ff84-496a-891c-b1bf79991a67"],
    );
  });

  test("an empty result set explains itself", () => {
    search(harness, "zzz-nothing");
    assert.equal(rows().length, 0);
    assert.match(harness.text("content"), /No tasks match/);
  });
});

describe("tasks view status filter", () => {
  before(() => {
    harness = createHarness();
  });
  after(() => harness.close());

  test("switching status refetches with the new filter", async () => {
    const requested: string[] = [];
    globalThis.fetch = (async (input: string) => {
      requested.push(String(input));
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await mount(harness, tasksView());
    assert.deepEqual(requested, ["/api/tasks?status=pending"]);

    const buttons = [
      ...harness.dom.window.document.querySelectorAll("#view-controls button"),
    ];
    assert.deepEqual(
      buttons.map((button) => button.textContent),
      ["Pending", "Completed", "All"],
    );

    click(buttons[2] as Element);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(requested, [
      "/api/tasks?status=pending",
      "/api/tasks?status=all",
    ]);
    assert.equal(buttons[2]?.getAttribute("aria-checked"), "true");
    assert.equal(buttons[0]?.getAttribute("aria-checked"), "false");
  });
});

describe("tasks view errors", () => {
  before(() => {
    harness = createHarness();
  });
  after(() => harness.close());

  test("a backend failure renders the server's message and hint", async () => {
    stubFetch({ error: "`task` binary not found", hint: "Install Taskwarrior." }, 503);
    await mount(harness, tasksView());

    assert.match(harness.text("content"), /task` binary not found/);
    assert.match(harness.text("content"), /Install Taskwarrior\./);
    assert.equal(harness.text("meta"), "");
  });
});
