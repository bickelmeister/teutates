import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import type { Config } from "../src/api";
import { settingsView } from "../src/settings";
import { click, createHarness, mount, search, stubFetch, type Harness } from "./harness";

const fixture: Config = {
  taskVersion: "3.5.0",
  taskrcPath: "/home/user/.taskrc",
  groups: [
    { name: "general", count: 2 },
    { name: "color", count: 2 },
  ],
  settings: [
    { key: "color", value: "off", configuredValue: "on", group: "general", source: "taskrc", isOverride: true },
    { key: "bulk", value: "3", group: "general", source: "default", isOverride: false },
    { key: "color.due", value: "red", group: "color", source: "include:default.theme", isOverride: true },
    { key: "color.tagged", value: "green", group: "color", source: "default", isOverride: false },
  ],
};

let harness: Harness;

function keys(): (string | null | undefined)[] {
  return harness.rows("data-setting").map((row) => row.firstElementChild?.textContent);
}

describe("settings view", () => {
  before(async () => {
    harness = createHarness();
    stubFetch(fixture);
    await mount(harness, settingsView());
  });
  after(() => harness.close());

  test("renders one section per group, in backend order", () => {
    const headings = [
      ...harness.dom.window.document.querySelectorAll("#content h2"),
    ].map((heading) => heading.firstChild?.textContent);
    assert.deepEqual(headings, ["general", "color"]);
  });

  test("lists the groups in the sidebar submenu", () => {
    const labels = [
      ...harness.dom.window.document.querySelectorAll("#subnav a"),
    ].map((link) => link.textContent);
    assert.deepEqual(labels, ["general", "color"]);
    assert.ok(harness.dom.window.document.getElementById("group-general"));
  });

  test("shows the effective and the configured value when they diverge", () => {
    const row = harness
      .rows("data-setting")
      .find((candidate) => candidate.firstElementChild?.textContent === "color");
    assert.ok(row, "color row missing");
    assert.match(row.textContent ?? "", /off/);
    assert.match(row.textContent ?? "", /configured: on/);
  });

  test("marks hand-written overrides differently from theme includes", () => {
    const rows = harness.rows("data-setting");
    const find = (key: string) =>
      rows.find((row) => row.firstElementChild?.textContent === key);

    assert.ok(find("color")?.className.includes("border-l-accent"));
    assert.ok(find("color.due")?.className.includes("border-l-line"));
    assert.ok(find("bulk")?.className.includes("border-l-transparent"));
    assert.match(find("color.due")?.textContent ?? "", /default\.theme/);
  });

  test("meta line reports version, totals and rc path", () => {
    const meta = harness.text("meta");
    assert.match(meta, /Taskwarrior 3\.5\.0/);
    assert.match(meta, /4 settings, 2 changed/);
    assert.match(meta, /\/home\/user\/\.taskrc/);
  });

  test("search filters on key and on value", () => {
    search(harness, "red");
    assert.deepEqual(keys(), ["color.due"]);
  });

  test("an empty result set explains itself instead of blanking", () => {
    search(harness, "zzzz-no-such-key");
    assert.equal(harness.rows("data-setting").length, 0);
    assert.match(harness.text("content"), /No settings match/);
  });

  test("'changed only' hides defaults", () => {
    search(harness, "");
    const checkbox = harness.element<HTMLInputElement>("only-changed");
    checkbox.checked = true;
    checkbox.dispatchEvent(new harness.dom.window.Event("change"));
    assert.deepEqual(keys(), ["color", "color.due"]);
  });
});

describe("settings view errors", () => {
  before(() => {
    harness = createHarness();
  });
  after(() => harness.close());

  test("a backend failure renders the server's message and hint", async () => {
    stubFetch({ error: "`task` binary not found", hint: "Install Taskwarrior." }, 503);
    await mount(harness, settingsView());

    const content = harness.text("content");
    assert.match(content, /task` binary not found/);
    assert.match(content, /Install Taskwarrior\./);
  });
});

describe("settings view navigation", () => {
  before(async () => {
    harness = createHarness();
    stubFetch(fixture);
    await mount(harness, settingsView());
  });
  after(() => harness.close());

  // The router owns the hash; a submenu link must scroll, not navigate.
  test("submenu links scroll instead of changing the route", () => {
    harness.dom.window.location.hash = "#/settings";
    let scrolled: string | undefined;
    harness.dom.window.Element.prototype.scrollIntoView = function () {
      scrolled = (this as Element).id;
    };

    const link = harness.dom.window.document.querySelector("#subnav a");
    assert.ok(link);
    click(link);

    assert.equal(scrolled, "group-general");
    assert.equal(harness.dom.window.location.hash, "#/settings");
  });
});
