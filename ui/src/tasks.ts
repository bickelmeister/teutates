import type { StatusFilter, Task, TaskList } from "./api";
import { ConfigError, fetchTasks } from "./api";
import { formatAbsolute, formatDue, formatUrgency } from "./format";
import { copyToClipboard, notice, segmented } from "./ui";
import type { View, ViewContext } from "./view";

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
] as const satisfies ReadonlyArray<{ value: StatusFilter; label: string }>;

const PRIORITY_STYLES: Record<string, string> = {
  H: "text-accent",
  M: "text-fg",
  L: "text-muted",
};

function matches(task: Task, query: string): boolean {
  if (query === "") return true;
  const needle = query.toLowerCase();
  return (
    task.description.toLowerCase().includes(needle) ||
    (task.project ?? "").toLowerCase().includes(needle) ||
    (task.tags ?? []).some((tag) => tag.toLowerCase().includes(needle)) ||
    String(task.id) === needle
  );
}

function cell(className: string, text: string): HTMLElement {
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  return div;
}

/** Renders the due column, muted when absent and highlighted when passed. */
function dueCell(task: Task): HTMLElement {
  const due = task.due === undefined ? null : formatDue(task.due);
  if (due === null) return cell("text-muted", "—");

  // Only an unfinished task can still be late.
  const late = due.past && task.status === "pending";
  const div = cell(late ? "text-accent" : "text-muted", due.text);
  if (task.due !== undefined) div.title = formatAbsolute(task.due);
  return div;
}

function descriptionCell(task: Task, udaLabels: Record<string, string>): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "min-w-0";

  const line = document.createElement("div");
  line.className = "flex min-w-0 items-baseline gap-1.5";

  if (task.start !== undefined) {
    // Matches Taskwarrior's active indicator.
    const active = document.createElement("span");
    active.className = "text-accent";
    active.textContent = "*";
    active.title = `Started ${formatAbsolute(task.start)}`;
    line.append(active);
  }

  const text = document.createElement("span");
  text.className = "min-w-0 truncate";
  if (task.status === "completed") text.classList.add("text-muted", "line-through");
  text.textContent = task.description;
  text.title = task.description;
  line.append(text);
  wrapper.append(line);

  const badges = document.createElement("div");
  badges.className = "mt-0.5 flex flex-wrap items-center gap-1";

  for (const tag of task.tags ?? []) {
    const badge = document.createElement("span");
    badge.className = "text-xs text-muted";
    badge.textContent = `#${tag}`;
    badges.append(badge);
  }

  for (const [name, value] of Object.entries(task.udas ?? {})) {
    const badge = document.createElement("span");
    badge.className = "rounded bg-raised px-1.5 py-0.5 text-[10px] text-muted";
    badge.textContent = `${udaLabels[name] ?? name}: ${value}`;
    badges.append(badge);
  }

  if (task.recur !== undefined) {
    const badge = document.createElement("span");
    badge.className = "rounded bg-raised px-1.5 py-0.5 text-[10px] text-muted";
    badge.textContent = `recurs ${task.recur}`;
    badges.append(badge);
  }

  const annotations = task.annotations ?? [];
  if (annotations.length > 0) {
    const badge = document.createElement("span");
    badge.className = "rounded bg-raised px-1.5 py-0.5 text-[10px] text-muted";
    badge.textContent = `${annotations.length} note${annotations.length === 1 ? "" : "s"}`;
    badge.title = annotations.map((note) => note.description).join("\n");
    badges.append(badge);
  }

  if (badges.childElementCount > 0) wrapper.append(badges);
  return wrapper;
}

const ROW_COLUMNS =
  "grid-cols-[3rem_3.5rem_1.5rem_minmax(5rem,7rem)_minmax(0,9rem)_minmax(0,1fr)]";

function renderRow(task: Task, udaLabels: Record<string, string>): HTMLElement {
  const row = document.createElement("div");
  row.dataset["task"] = task.uuid;
  row.tabIndex = 0;
  row.role = "row";
  row.title = "Copy the task uuid";
  row.className = `grid ${ROW_COLUMNS} cursor-pointer items-baseline gap-x-3 px-3 py-2 font-mono text-[13px] hover:bg-raised`;

  // Completed tasks export as id 0; showing that would be a lie.
  row.append(cell("text-muted", task.id > 0 ? String(task.id) : "—"));
  row.append(cell("text-muted tabular-nums", formatUrgency(task.urgency)));
  row.append(
    cell(PRIORITY_STYLES[task.priority ?? ""] ?? "text-muted", task.priority ?? "—"),
  );
  row.append(dueCell(task));
  row.append(cell("truncate text-muted", task.project ?? "—"));
  row.append(descriptionCell(task, udaLabels));

  const copy = () => void copyToClipboard(task.uuid, row);
  row.addEventListener("click", copy);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      copy();
    }
  });

  return row;
}

function renderHeader(): HTMLElement {
  const header = document.createElement("div");
  header.role = "row";
  header.className = `grid ${ROW_COLUMNS} gap-x-3 border-b border-line px-3 py-2 text-[10px] uppercase tracking-wide text-muted`;
  for (const label of ["Id", "Urg", "P", "Due", "Project", "Description"]) {
    header.append(cell("", label));
  }
  return header;
}

export function tasksView(): View {
  return {
    title: "Tasks",
    searchPlaceholder: "Filter description, project, tags…",

    async mount(context: ViewContext): Promise<void> {
      let status: StatusFilter = "pending";
      let list: TaskList | undefined;

      const setActive = segmented<StatusFilter>(
        context.controls,
        STATUS_OPTIONS,
        (value) => {
          if (value === status) return;
          status = value;
          setActive(status);
          void load();
        },
        context.signal,
      );
      setActive(status);

      function renderMeta(): void {
        if (list === undefined) return;
        const { counts } = list;
        const parts = [`${list.tasks.length} shown`];
        if (counts.overdue > 0) parts.push(`${counts.overdue} overdue`);
        if (counts.active > 0) parts.push(`${counts.active} active`);
        parts.push(`${counts.pending} pending`, `${counts.completed} completed`);
        context.meta.textContent = parts.join(" · ");
      }

      function render(): void {
        if (list === undefined) return;
        const query = context.search.value.trim();
        const visible = list.tasks.filter((task) => matches(task, query));

        if (visible.length === 0) {
          context.content.replaceChildren(
            notice(
              "No tasks match this filter.",
              query === ""
                ? `Taskwarrior reports no ${status === "all" ? "" : status + " "}tasks.`
                : `Nothing matches “${query}”.`,
            ),
          );
          return;
        }

        const table = document.createElement("div");
        table.role = "table";
        table.className = "overflow-x-auto rounded-lg border border-line bg-surface";

        const body = document.createElement("div");
        body.className = "min-w-[48rem] divide-y divide-line";
        for (const task of visible) {
          body.append(renderRow(task, list.udaLabels ?? {}));
        }

        table.append(renderHeader(), body);
        context.content.replaceChildren(table);
      }

      async function load(): Promise<void> {
        context.content.replaceChildren(notice("Loading tasks…"));
        try {
          list = await fetchTasks(status, context.signal);
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          const message =
            error instanceof ConfigError ? error.message : "Unexpected error.";
          const hint = error instanceof ConfigError ? error.hint : undefined;
          context.meta.textContent = "";
          context.content.replaceChildren(notice(message, hint));
          return;
        }
        renderMeta();
        render();
      }

      context.search.addEventListener("input", render, { signal: context.signal });
      await load();
    },
  };
}
