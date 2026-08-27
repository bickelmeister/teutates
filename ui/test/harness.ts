import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";

import { ConfigError } from "../src/api";
import type { View, ViewContext } from "../src/view";

/** A jsdom instance loaded with the real app shell, so the tests exercise
 *  the markup that actually ships rather than a hand-built stand-in. */
export interface Harness {
  dom: JSDOM;
  context: ViewContext;
  abort: AbortController;
  /** Elements the views render into. */
  element<T>(id: string): T;
  /** All rows currently rendered, by their data attribute. */
  rows(attribute: string): Element[];
  text(id: string): string;
  close(): void;
}

const GLOBALS = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "HTMLElement",
  "HTMLInputElement",
  "Element",
  "DOMException",
  "Event",
  "Node",
  // jsdom validates addEventListener's signal against its own realm, so the
  // abort primitives must come from the window too, not from Node.
  "AbortController",
  "AbortSignal",
] as const;

export function createHarness(): Harness {
  const dom = new JSDOM(
    readFileSync(resolve(process.cwd(), "index.html"), "utf8"),
    { url: "http://localhost:8080", runScripts: "dangerously" },
  );

  for (const name of GLOBALS) {
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

  // jsdom has no layout, so scrollIntoView is not implemented.
  dom.window.Element.prototype.scrollIntoView = () => {};

  function element<T>(id: string): T {
    const found = dom.window.document.getElementById(id);
    if (found === null) throw new Error(`missing #${id}`);
    return found as unknown as T;
  }

  const abort = new AbortController();

  return {
    dom,
    abort,
    element,
    rows: (attribute) => [
      ...dom.window.document.querySelectorAll(`[${attribute}]`),
    ],
    text: (id) => element<{ textContent: string | null }>(id).textContent ?? "",
    context: {
      content: element<HTMLElement>("content"),
      title: element<HTMLElement>("view-title"),
      meta: element<HTMLElement>("meta"),
      controls: element<HTMLElement>("view-controls"),
      subnav: element<HTMLElement>("subnav"),
      search: element<HTMLInputElement>("search"),
      signal: abort.signal,
    },
    close: () => dom.window.close(),
  };
}

/** A loader that answers with a fixed payload, so a view can be rendered
 *  without a server behind it. */
export function serves<T>(payload: T): (...args: unknown[]) => Promise<T> {
  return async () => payload;
}

/** A loader that fails the way an unreachable or unhappy server does. */
export function fails(
  message: string,
  hint?: string,
): (...args: unknown[]) => Promise<never> {
  return async () => {
    throw new ConfigError(message, hint);
  };
}

export async function mount(harness: Harness, view: View): Promise<void> {
  await view.mount(harness.context);
}

/** Types into the shared filter field and lets the view re-render. */
export function search(harness: Harness, query: string): void {
  harness.context.search.value = query;
  harness.context.search.dispatchEvent(new harness.dom.window.Event("input"));
}

export function click(element: Element): void {
  (element as unknown as HTMLElement).click();
}
