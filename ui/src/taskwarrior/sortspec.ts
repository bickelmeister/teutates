import type { Config } from "./config";
import type { Task } from "./tasks";

/** Used when the configuration carries no sort order for the report,
 *  matching Taskwarrior's `next` report. */
const defaultSortSpec = "urgency-";

/** The report whose sort order the task list follows. `list` is the report
 *  `task list` uses, so the interface and the command line agree. */
export const sortReport = "list";

/** Describes the ordering applied to a task list. */
export interface SortSpec {
  /** The Taskwarrior report the order was taken from, e.g. "list". */
  report: string;
  /** The raw configuration value, e.g. "start-,due+,project+,urgency-". */
  spec: string;
  /** Attributes teutates cannot sort by; they are skipped rather than
   *  silently changing the order. */
  unsupported?: string[];
}

/** One clause of a sort specification. */
export interface SortKey {
  attribute: string;
  descending: boolean;
}

/** How missing values are treated.
 *
 *  - `date`: Taskwarrior sorts tasks without the date last in both
 *    directions, so an undated task never leads the list.
 *  - `text`: compares lexicographically, which puts an empty value first
 *    ascending and last descending — how `project+` behaves.
 *  - `number`: treats a missing value as zero.
 *  - `priority`: an ordered enum where "no priority" ranks below L. */
type AttributeKind = "date" | "text" | "number" | "priority";

/** An attribute and how to read the field it compares. Numeric attributes
 *  read a number; every other kind reads text. */
type Attribute =
  | { kind: Exclude<AttributeKind, "number">; read: (task: Task) => string }
  | { kind: "number"; read: (task: Task) => number };

/** Maps the attribute names a sort spec may use onto the task field they
 *  read. Anything absent here is reported as unsupported. */
const sortableAttributes: Record<string, Attribute> = {
  due: { kind: "date", read: (t) => t.due ?? "" },
  start: { kind: "date", read: (t) => t.start ?? "" },
  end: { kind: "date", read: (t) => t.end ?? "" },
  entry: { kind: "date", read: (t) => t.entry ?? "" },
  modified: { kind: "date", read: (t) => t.modified ?? "" },
  scheduled: { kind: "date", read: (t) => t.scheduled ?? "" },
  wait: { kind: "date", read: (t) => t.wait ?? "" },
  project: { kind: "text", read: (t) => t.project ?? "" },
  description: { kind: "text", read: (t) => t.description },
  status: { kind: "text", read: (t) => t.status },
  uuid: { kind: "text", read: (t) => t.uuid },
  urgency: { kind: "number", read: (t) => t.urgency },
  id: { kind: "number", read: (t) => t.id },
  priority: { kind: "priority", read: (t) => t.priority ?? "" },
};

/** Orders priorities. A task without a priority ranks lowest, so `priority-`
 *  lists H, M, L and then the unprioritised ones. */
const priorityRank: Record<string, number> = { L: 1, M: 2, H: 3 };

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Reads a Taskwarrior sort specification such as
 *  "start-,due+,project+,urgency-". A trailing "/" marks a visual break in
 *  Taskwarrior's reports and has no effect on the order, so it is stripped. */
export function parseSortSpec(spec: string): {
  keys: SortKey[];
  unsupported: string[];
} {
  const keys: SortKey[] = [];
  const unsupported: string[] = [];

  for (const raw of spec.split(",")) {
    let clause = raw.trim().replace(/\/$/, "");
    if (clause === "") continue;

    let descending = false;
    const last = clause[clause.length - 1];
    if (last === "-") {
      descending = true;
      clause = clause.slice(0, -1);
    } else if (last === "+") {
      clause = clause.slice(0, -1);
    }
    if (clause === "") continue;

    if (!Object.hasOwn(sortableAttributes, clause)) {
      unsupported.push(clause);
      continue;
    }
    keys.push({ attribute: clause, descending });
  }

  return { keys, unsupported };
}

/** Returns -1, 0 or 1 for a single sort clause. */
export function compareBy(a: Task, b: Task, key: SortKey): number {
  const attribute = sortableAttributes[key.attribute];
  // parseSortSpec drops clauses naming an attribute that is not here, so
  // this only guards a key assembled some other way.
  if (attribute === undefined) return 0;

  let result = 0;
  switch (attribute.kind) {
    case "date": {
      const left = attribute.read(a);
      const right = attribute.read(b);
      // A missing date sorts last whichever way the clause points, so the
      // comparison is returned before the direction is applied.
      if (left === "" && right === "") return 0;
      if (left === "") return 1;
      if (right === "") return -1;
      // Dates are RFC 3339 in UTC and therefore fixed width, which makes
      // lexicographic order the same as chronological order.
      result = compareText(left, right);
      break;
    }

    case "priority": {
      const left = priorityRank[attribute.read(a)] ?? 0;
      const right = priorityRank[attribute.read(b)] ?? 0;
      result = left < right ? -1 : left > right ? 1 : 0;
      break;
    }

    case "number": {
      const left = attribute.read(a);
      const right = attribute.read(b);
      result = left < right ? -1 : left > right ? 1 : 0;
      break;
    }

    default:
      result = compareText(attribute.read(a), attribute.read(b));
  }

  return key.descending ? -result : result;
}

/** Orders tasks by the given clauses. Ties fall back to the working id and
 *  then the uuid, so the order is stable across requests even for completed
 *  tasks, which all export an id of 0. */
export function sortTasksBy(tasks: Task[], keys: SortKey[]): void {
  tasks.sort((a, b) => {
    for (const key of keys) {
      const result = compareBy(a, b, key);
      if (result !== 0) return result;
    }
    if (a.id !== b.id) return a.id - b.id;
    return compareText(a.uuid, b.uuid);
  });
}

/** Reads the sort order configured for the report teutates follows, falling
 *  back to the default when it is not configured. */
export function sortSpecFor(config: Config | undefined): string {
  if (config === undefined) return defaultSortSpec;

  const key = `report.${sortReport}.sort`;
  for (const setting of config.settings) {
    if (setting.key === key && setting.value !== "") return setting.value;
  }
  return defaultSortSpec;
}
