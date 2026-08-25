import type { Config, Setting } from "./api";
import { ConfigError, fetchConfig } from "./api";

interface Filters {
  query: string;
  onlyChanged: boolean;
}

interface Elements {
  content: HTMLElement;
  groupNav: HTMLElement;
  meta: HTMLElement;
  search: HTMLInputElement;
  onlyChanged: HTMLInputElement;
}

/** Values written by hand in the rc file, as opposed to pulled in by a theme. */
function isUserSet(setting: Setting): boolean {
  return setting.source === "taskrc";
}

function sourceLabel(setting: Setting): string {
  if (setting.source === "taskrc") return "taskrc";
  if (setting.source.startsWith("include:")) return setting.source.slice(8);
  return "default";
}

function matches(setting: Setting, filters: Filters): boolean {
  if (filters.onlyChanged && !setting.isOverride) return false;
  if (filters.query === "") return true;
  const needle = filters.query.toLowerCase();
  return (
    setting.key.toLowerCase().includes(needle) ||
    setting.value.toLowerCase().includes(needle)
  );
}

/** Copies `key=value` and briefly confirms it on the row itself. */
async function copySetting(setting: Setting, row: HTMLElement): Promise<void> {
  const text = `${setting.key}=${setting.value}`;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return; // Clipboard access can be denied; the row simply does nothing.
  }
  row.dataset["copied"] = "true";
  window.setTimeout(() => delete row.dataset["copied"], 900);
}

function renderRow(setting: Setting): HTMLElement {
  const row = document.createElement("div");
  row.dataset["setting"] = "";
  row.tabIndex = 0;
  row.role = "button";
  row.title = "Copy key=value";

  const accent = isUserSet(setting)
    ? "border-l-accent bg-accent-soft/40"
    : setting.isOverride
      ? "border-l-line"
      : "border-l-transparent";
  row.className = `group grid cursor-pointer grid-cols-1 gap-x-6 gap-y-0.5 border-l-2 px-3 py-2 hover:bg-raised sm:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] ${accent}`;

  const key = document.createElement("div");
  key.className = "min-w-0 truncate font-mono text-[13px]";
  key.textContent = setting.key;

  const values = document.createElement("div");
  values.className = "min-w-0";

  const value = document.createElement("div");
  value.className = "break-words font-mono text-[13px] text-muted";
  // An empty value would collapse the row; show it as explicitly unset.
  if (setting.value === "") {
    value.textContent = "(empty)";
    value.classList.add("italic");
  } else {
    value.textContent = setting.value;
  }
  values.append(value);

  if (setting.configuredValue !== undefined) {
    const configured = document.createElement("div");
    configured.className = "mt-0.5 font-mono text-xs text-muted";
    configured.textContent = `configured: ${setting.configuredValue}`;
    configured.title =
      "Taskwarrior resolves this key differently at runtime than the rc file states.";
    values.append(configured);
  }

  if (setting.isOverride) {
    const badge = document.createElement("span");
    badge.className =
      "mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide " +
      (isUserSet(setting)
        ? "bg-accent-soft text-accent"
        : "bg-raised text-muted");
    badge.textContent = sourceLabel(setting);
    values.append(badge);
  }

  row.append(key, values);

  const copy = () => void copySetting(setting, row);
  row.addEventListener("click", copy);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      copy();
    }
  });

  return row;
}

function renderSection(group: string, settings: Setting[]): HTMLElement {
  const section = document.createElement("section");
  section.id = `group-${group}`;
  section.className = "mb-8 scroll-mt-32";

  const heading = document.createElement("h2");
  heading.className =
    "mb-2 flex items-baseline gap-2 text-sm font-semibold tracking-tight";
  heading.textContent = group;

  const count = document.createElement("span");
  count.className = "text-xs font-normal text-muted";
  count.textContent = String(settings.length);
  heading.append(count);

  const list = document.createElement("div");
  list.className = "divide-y divide-line rounded-lg border border-line bg-surface";
  for (const setting of settings) list.append(renderRow(setting));

  section.append(heading, list);
  return section;
}

function renderNotice(title: string, detail?: string): HTMLElement {
  const box = document.createElement("div");
  box.className =
    "rounded-lg border border-line bg-surface px-5 py-8 text-center";

  const heading = document.createElement("p");
  heading.className = "text-sm font-medium";
  heading.textContent = title;
  box.append(heading);

  if (detail !== undefined) {
    const body = document.createElement("p");
    body.className = "mx-auto mt-1.5 max-w-md text-sm text-muted";
    body.textContent = detail;
    box.append(body);
  }
  return box;
}

function renderNav(elements: Elements, groups: string[]): void {
  elements.groupNav.replaceChildren();
  for (const group of groups) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `#group-${group}`;
    link.className =
      "block truncate rounded px-2 py-1 text-xs text-muted hover:bg-raised hover:text-fg";
    link.textContent = group;
    item.append(link);
    elements.groupNav.append(item);
  }
}

/** Loads the configuration and wires the search and filter controls to it. */
export async function initSettings(elements: Elements): Promise<void> {
  elements.content.replaceChildren(renderNotice("Loading settings…"));

  let config: Config;
  try {
    config = await fetchConfig();
  } catch (error) {
    const message =
      error instanceof ConfigError ? error.message : "Unexpected error.";
    const hint = error instanceof ConfigError ? error.hint : undefined;
    elements.content.replaceChildren(renderNotice(message, hint));
    return;
  }

  const changed = config.settings.filter((setting) => setting.isOverride).length;
  elements.meta.textContent = `Taskwarrior ${config.taskVersion} · ${config.settings.length} settings, ${changed} changed · ${config.taskrcPath}`;

  function render(): void {
    const filters: Filters = {
      query: elements.search.value.trim(),
      onlyChanged: elements.onlyChanged.checked,
    };

    const visible = config.settings.filter((setting) =>
      matches(setting, filters),
    );

    if (visible.length === 0) {
      elements.groupNav.replaceChildren();
      elements.content.replaceChildren(
        renderNotice(
          "No settings match this filter.",
          filters.query === ""
            ? "Every setting is at its Taskwarrior default."
            : `Nothing matches “${filters.query}”.`,
        ),
      );
      return;
    }

    // Settings arrive grouped and sorted from the backend, so a single pass
    // preserves that order without re-sorting in the browser.
    const sections: Array<[string, Setting[]]> = [];
    for (const setting of visible) {
      const last = sections.at(-1);
      if (last !== undefined && last[0] === setting.group) last[1].push(setting);
      else sections.push([setting.group, [setting]]);
    }

    renderNav(
      elements,
      sections.map(([group]) => group),
    );

    const fragment = document.createDocumentFragment();
    if (config.unresolvedIncludes?.length) {
      fragment.append(
        renderNotice(
          "Some included rc files could not be found.",
          `Values from ${config.unresolvedIncludes.join(", ")} are shown as defaults.`,
        ),
      );
    }
    for (const [group, settings] of sections) {
      fragment.append(renderSection(group, settings));
    }
    elements.content.replaceChildren(fragment);
  }

  elements.search.addEventListener("input", render);
  elements.onlyChanged.addEventListener("change", render);
  render();
}
