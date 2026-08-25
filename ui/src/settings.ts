import type { Config, Setting } from "./api";
import { ConfigError, fetchConfig } from "./api";
import { copyToClipboard, notice } from "./ui";
import type { View, ViewContext } from "./view";

interface Filters {
  query: string;
  onlyChanged: boolean;
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
      (isUserSet(setting) ? "bg-accent-soft text-accent" : "bg-raised text-muted");
    badge.textContent = sourceLabel(setting);
    values.append(badge);
  }

  row.append(key, values);

  const copy = () => void copyToClipboard(`${setting.key}=${setting.value}`, row);
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

function renderSubnav(subnav: HTMLElement, groups: string[]): void {
  const list = document.createElement("ul");
  list.className = "mt-1 ml-2.5 space-y-px border-l border-line pl-3";
  for (const group of groups) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `#/settings`;
    link.className =
      "block truncate rounded px-2 py-1 text-xs text-muted hover:bg-raised hover:text-fg";
    link.textContent = group;
    // The router owns the hash, so scrolling is done directly rather than
    // through a fragment link that would trigger a navigation.
    link.addEventListener("click", (event) => {
      event.preventDefault();
      document
        .getElementById(`group-${group}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    item.append(link);
    list.append(item);
  }
  subnav.replaceChildren(list);
}

/** Groups an already grouped-and-sorted list in a single pass. */
function sectionsOf(settings: Setting[]): Array<[string, Setting[]]> {
  const sections: Array<[string, Setting[]]> = [];
  for (const setting of settings) {
    const last = sections.at(-1);
    if (last !== undefined && last[0] === setting.group) last[1].push(setting);
    else sections.push([setting.group, [setting]]);
  }
  return sections;
}

export function settingsView(): View {
  return {
    title: "Settings",
    searchPlaceholder: "Filter keys and values…",

    async mount(context: ViewContext): Promise<void> {
      const toggle = document.createElement("label");
      toggle.className =
        "flex cursor-pointer select-none items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm text-muted has-checked:border-accent has-checked:text-fg";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = "only-changed";
      checkbox.className = "accent-accent";
      toggle.append(checkbox, document.createTextNode("Changed only"));
      context.controls.append(toggle);

      context.content.replaceChildren(notice("Loading settings…"));

      let config: Config;
      try {
        config = await fetchConfig(context.signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const message =
          error instanceof ConfigError ? error.message : "Unexpected error.";
        const hint = error instanceof ConfigError ? error.hint : undefined;
        context.content.replaceChildren(notice(message, hint));
        return;
      }

      const changed = config.settings.filter((setting) => setting.isOverride).length;
      context.meta.textContent = `Taskwarrior ${config.taskVersion} · ${config.settings.length} settings, ${changed} changed · ${config.taskrcPath}`;

      function render(): void {
        const filters: Filters = {
          query: context.search.value.trim(),
          onlyChanged: checkbox.checked,
        };
        const visible = config.settings.filter((setting) => matches(setting, filters));

        if (visible.length === 0) {
          context.subnav.replaceChildren();
          context.content.replaceChildren(
            notice(
              "No settings match this filter.",
              filters.query === ""
                ? "Every setting is at its Taskwarrior default."
                : `Nothing matches “${filters.query}”.`,
            ),
          );
          return;
        }

        const sections = sectionsOf(visible);
        renderSubnav(
          context.subnav,
          sections.map(([group]) => group),
        );

        const fragment = document.createDocumentFragment();
        if (config.unresolvedIncludes?.length) {
          fragment.append(
            notice(
              "Some included rc files could not be found.",
              `Values from ${config.unresolvedIncludes.join(", ")} are shown as defaults.`,
            ),
          );
        }
        for (const [group, settings] of sections) {
          fragment.append(renderSection(group, settings));
        }
        context.content.replaceChildren(fragment);
      }

      context.search.addEventListener("input", render, { signal: context.signal });
      checkbox.addEventListener("change", render, { signal: context.signal });
      render();
    },
  };
}
