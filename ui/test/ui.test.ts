import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { JSDOM } from "jsdom";

import type { Config } from "../src/api";

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

let dom: JSDOM;

function setup(): void {
  dom = new JSDOM(readFileSync(resolve(process.cwd(), "index.html"), "utf8"), {
    url: "http://localhost:8080",
    runScripts: "dangerously",
  });

  const globals = ["window", "document", "navigator", "localStorage", "HTMLElement", "HTMLInputElement", "Element"] as const;
  for (const name of globals) {
    Object.defineProperty(globalThis, name, {
      value: (dom.window as unknown as Record<string, unknown>)[name],
      configurable: true,
    });
  }
  // jsdom implements neither matchMedia nor the async clipboard API.
  dom.window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

function element<T>(id: string): T {
  const found = dom.window.document.getElementById(id);
  assert.ok(found, `missing #${id}`);
  return found as unknown as T;
}

async function renderSettings(): Promise<void> {
  const { initSettings } = await import("../src/settings");
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  await initSettings({
    content: element("content"),
    groupNav: element("group-nav"),
    meta: element("meta"),
    search: element("search"),
    onlyChanged: element("only-changed"),
  });
}

describe("settings view", () => {
  before(setup);
  after(() => dom.window.close());

  test("renders one section per group, in backend order", async () => {
    await renderSettings();
    const headings = [...dom.window.document.querySelectorAll("#content h2")].map((h) =>
      h.firstChild?.textContent,
    );
    assert.deepEqual(headings, ["general", "color"]);
  });

  test("fills the sidebar submenu with anchors to each group", () => {
    const links = [...dom.window.document.querySelectorAll("#group-nav a")].map((a) =>
      a.getAttribute("href"),
    );
    assert.deepEqual(links, ["#group-general", "#group-color"]);
    assert.ok(dom.window.document.getElementById("group-general"));
  });

  test("shows the effective and the configured value when they diverge", () => {
    const rows = [...dom.window.document.querySelectorAll("[data-setting]")];
    const target = rows.find((row) => row.firstElementChild?.textContent === "color");
    assert.ok(target, "color row missing");
    assert.match(target.textContent ?? "", /off/);
    assert.match(target.textContent ?? "", /configured: on/);
  });

  test("marks hand-written overrides differently from theme includes", () => {
    const rows = [...dom.window.document.querySelectorAll("[data-setting]")];
    const userSet = rows.find((row) => row.firstElementChild?.textContent === "color");
    const themeSet = rows.find((row) => row.firstElementChild?.textContent === "color.due");
    const untouched = rows.find((row) => row.firstElementChild?.textContent === "bulk");

    assert.ok(userSet?.className.includes("border-l-accent"));
    assert.ok(themeSet?.className.includes("border-l-line"));
    assert.ok(untouched?.className.includes("border-l-transparent"));
    assert.match(themeSet?.textContent ?? "", /default\.theme/);
  });

  test("meta line reports version, totals and rc path", () => {
    const meta = element<{ textContent: string }>("meta").textContent;
    assert.match(meta, /Taskwarrior 3\.5\.0/);
    assert.match(meta, /4 settings, 2 changed/);
    assert.match(meta, /\/home\/user\/\.taskrc/);
  });

  test("search filters on key and on value", () => {
    const search = element<HTMLInputElement>("search");
    search.value = "red";
    search.dispatchEvent(new dom.window.Event("input"));

    const keys = [...dom.window.document.querySelectorAll("[data-setting]")].map(
      (row) => row.firstElementChild?.textContent,
    );
    assert.deepEqual(keys, ["color.due"]);
  });

  test("an empty result set explains itself instead of blanking", () => {
    const search = element<HTMLInputElement>("search");
    search.value = "zzzz-no-such-key";
    search.dispatchEvent(new dom.window.Event("input"));

    assert.equal(dom.window.document.querySelectorAll("[data-setting]").length, 0);
    assert.match(element<{ textContent: string }>("content").textContent, /No settings match/);
  });

  test("'changed only' hides defaults", () => {
    const search = element<HTMLInputElement>("search");
    search.value = "";
    const onlyChanged = element<HTMLInputElement>("only-changed");
    onlyChanged.checked = true;
    onlyChanged.dispatchEvent(new dom.window.Event("change"));

    const keys = [...dom.window.document.querySelectorAll("[data-setting]")].map(
      (row) => row.firstElementChild?.textContent,
    );
    assert.deepEqual(keys, ["color", "color.due"]);
  });
});

describe("error handling", () => {
  before(setup);
  after(() => dom.window.close());

  test("a backend failure renders the server's message and hint", async () => {
    const { initSettings } = await import("../src/settings");
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ error: "`task` binary not found", hint: "Install Taskwarrior." }),
        { status: 503, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    await initSettings({
      content: element("content"),
      groupNav: element("group-nav"),
      meta: element("meta"),
      search: element("search"),
      onlyChanged: element("only-changed"),
    });

    const content = element<{ textContent: string }>("content").textContent;
    assert.match(content, /task` binary not found/);
    assert.match(content, /Install Taskwarrior\./);
  });
});

describe("theme", () => {
  before(setup);
  after(() => dom.window.close());

  test("switching to dark sets the class the stylesheet keys off", async () => {
    const { initTheme } = await import("../src/theme");
    initTheme(element("theme-switch"));

    const buttons = [...dom.window.document.querySelectorAll("#theme-switch button")];
    assert.deepEqual(buttons.map((b) => b.textContent), ["Light", "Dark", "System"]);

    // System, with matchMedia reporting light.
    assert.equal(dom.window.document.documentElement.classList.contains("dark"), false);

    (buttons[1] as HTMLElement).click();
    assert.equal(dom.window.document.documentElement.classList.contains("dark"), true);
    assert.equal(buttons[1]?.getAttribute("aria-checked"), "true");
    assert.equal(dom.window.localStorage.getItem("teutates.theme"), "dark");

    (buttons[0] as HTMLElement).click();
    assert.equal(dom.window.document.documentElement.classList.contains("dark"), false);
    assert.equal(dom.window.localStorage.getItem("teutates.theme"), "light");
  });
});
