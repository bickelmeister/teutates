import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { startRouter } from "../src/router";
import type { View, ViewContext } from "../src/view";
import { createHarness, type Harness } from "./harness";

let harness: Harness;

function stubView(title: string, onMount?: (context: ViewContext) => void): View {
  return {
    title,
    searchPlaceholder: `filter ${title}`,
    async mount(context) {
      const marker = document.createElement("p");
      marker.dataset["view"] = title;
      context.content.append(marker);
      onMount?.(context);
    },
  };
}

describe("router", () => {
  before(() => {
    harness = createHarness();
  });
  after(() => harness.close());

  test("mounts the first route when the hash is unknown", () => {
    harness.dom.window.location.hash = "#/nonsense";

    startRouter(
      {
        content: harness.context.content,
        title: harness.context.title,
        meta: harness.context.meta,
        controls: harness.context.controls,
        subnav: harness.context.subnav,
        search: harness.context.search,
      },
      [
        { path: "/tasks", label: "Tasks", view: () => stubView("Tasks") },
        { path: "/settings", label: "Settings", view: () => stubView("Settings") },
      ],
      new Map([
        ["/tasks", harness.element<HTMLElement>("nav-tasks")],
        ["/settings", harness.element<HTMLElement>("nav-settings")],
      ]),
    );

    assert.equal(harness.dom.window.location.hash, "#/tasks");
    assert.equal(harness.text("view-title"), "Tasks");
    assert.equal(harness.context.search.placeholder, "filter Tasks");
  });

  test("marks the active nav entry", () => {
    const tasks = harness.element<HTMLElement>("nav-tasks");
    assert.ok(tasks.className.includes("bg-raised"));
    assert.equal(tasks.getAttribute("aria-current"), "page");
    assert.equal(
      harness.element<HTMLElement>("nav-settings").getAttribute("aria-current"),
      null,
    );
  });
});

describe("router navigation", () => {
  before(() => {
    harness = createHarness();
  });
  after(() => harness.close());

  test("leaving a view clears the chrome and aborts its listeners", async () => {
    let leftSignal: AbortSignal | undefined;

    startRouter(
      {
        content: harness.context.content,
        title: harness.context.title,
        meta: harness.context.meta,
        controls: harness.context.controls,
        subnav: harness.context.subnav,
        search: harness.context.search,
      },
      [
        {
          path: "/tasks",
          label: "Tasks",
          view: () =>
            stubView("Tasks", (context) => {
              leftSignal = context.signal;
              context.meta.textContent = "28 pending";
              context.controls.append(document.createElement("button"));
              context.search.value = "leftover";
            }),
        },
        { path: "/settings", label: "Settings", view: () => stubView("Settings") },
      ],
      new Map([
        ["/tasks", harness.element<HTMLElement>("nav-tasks")],
        ["/settings", harness.element<HTMLElement>("nav-settings")],
      ]),
    );

    assert.equal(leftSignal?.aborted, false);
    assert.equal(harness.text("meta"), "28 pending");

    harness.dom.window.location.hash = "#/settings";
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(harness.text("view-title"), "Settings");
    // Everything the previous view left behind is gone.
    assert.equal(leftSignal?.aborted, true);
    assert.equal(harness.text("meta"), "");
    assert.equal(harness.context.search.value, "");
    assert.equal(harness.context.controls.childElementCount, 0);
    assert.equal(
      harness.dom.window.document.querySelectorAll('[data-view="Tasks"]').length,
      0,
    );
  });
});
