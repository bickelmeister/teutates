import { ConfigError } from "./client";
import type { SortSpec } from "./sortspec";

/** Taskwarrior's export format: ISO 8601 basic, always UTC. It is not what
 *  `Date` parses, so every date field is converted before it is rendered. */
const taskDateFormat = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

/** Selects which tasks to export. */
export type StatusFilter = "pending" | "completed" | "all";

/** Validates a filter coming from the URL. Only known values are accepted;
 *  the value is never passed through to the `task` command line as free
 *  text. */
export function parseStatusFilter(raw: string): StatusFilter {
  switch (raw.trim()) {
    case "":
    case "pending": return "pending";
    case "completed": return "completed";
    case "all": return "all";
    default:
      throw new ConfigError(
        `taskwarrior: unknown status filter "${raw}"`,
        "Supported values are pending, completed and all.",
      );
  }
}

/** The fixed command-line filter for a selection. */
export function statusFilterArgs(filter: StatusFilter): string[] {
  switch (filter) {
    case "completed": return ["status:completed"];
    case "all": return [];
    default: return ["status:pending"];
  }
}

/** A timestamped note attached to a task. */
export interface Annotation {
  entry: string;
  description: string;
}

export interface Task {
  /** Taskwarrior's short working id. Only pending tasks get one; completed
   *  tasks export as 0, so `uuid` is the stable identity. */
  id: number;
  uuid: string;
  description: string;
  status: string;
  project?: string;
  tags?: string[];
  priority?: string;
  urgency: number;
  due?: string;
  scheduled?: string;
  wait?: string;
  entry?: string;
  start?: string;
  end?: string;
  modified?: string;
  recur?: string;
  depends?: string[];
  annotations?: Annotation[];
  /** User-defined attributes, which differ per installation and would be
   *  silently dropped by a fixed schema. */
  udas?: Record<string, string>;
}

/** Summarises a task list by status. */
export interface Counts {
  total: number;
  pending: number;
  completed: number;
  waiting: number;
  recurring: number;
  deleted: number;
  active: number;
  overdue: number;
}

export interface TaskList {
  status: StatusFilter;
  counts: Counts;
  tasks: Task[];
  /** The order applied, so the interface can name it. */
  sort: SortSpec;
  /** Maps a UDA name to its configured human-readable label. */
  udaLabels?: Record<string, string>;
}

/** The attributes mapped onto Task. Anything else that Taskwarrior exports
 *  is treated as a user-defined attribute. */
const knownFields = new Set([
  "id", "uuid", "description", "status",
  "project", "tags", "priority", "urgency",
  "due", "scheduled", "wait", "entry",
  "start", "end", "modified", "recur",
  "depends", "annotations",
  // Recurrence bookkeeping that is meaningless in a task list.
  "rtype", "mask", "imask", "parent",
]);

/** Converts a Taskwarrior timestamp to RFC 3339 so it can be compared and
 *  formatted. Unparseable values are passed through unchanged rather than
 *  discarded, so a surprising format stays visible instead of vanishing. */
export function parseTaskDate(raw: string): string {
  if (raw === "") return "";

  const match = taskDateFormat.exec(raw);
  if (match === null) return raw;

  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] =
    match.slice(1).map(Number);
  const stamp = Date.UTC(year, month - 1, day, hour, minute, second);
  const parsed = new Date(stamp);
  // Date.UTC rolls an impossible date over into the next month rather than
  // rejecting it, so the round trip is what actually validates the input.
  if (
    parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day || parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute || parsed.getUTCSeconds() !== second
  ) {
    return raw;
  }
  // toISOString always carries milliseconds, which Taskwarrior never has.
  return parsed.toISOString().replace(".000Z", "Z");
}

// The decode helpers are deliberately forgiving: a task with one unexpected
// field type should still be listed, with that field empty, rather than
// failing the whole request.

function decodeString(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

function decodeNumber(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function decodeStrings(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    if (!raw.every((entry) => typeof entry === "string")) return undefined;
    return raw.length === 0 ? undefined : (raw as string[]);
  }
  // Older Taskwarrior versions export dependencies as a comma-separated
  // string rather than a list.
  const single = decodeString(raw);
  return single === "" ? undefined : single.split(",");
}

function decodeAnnotations(raw: unknown): Annotation[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const annotations: Annotation[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") return undefined;
    const record = entry as Record<string, unknown>;
    annotations.push({
      entry: parseTaskDate(decodeString(record.entry)),
      description: decodeString(record.description),
    });
  }
  return annotations;
}

/** Renders a user-defined attribute of unknown type as text. */
function decodeScalar(raw: unknown): string {
  switch (typeof raw) {
    case "string": return raw;
    case "boolean": return String(raw);
    // UDAs of type numeric are frequently whole numbers; 3 reads better
    // than 3.000000.
    case "number": return String(raw);
    case "undefined": return "";
    default:
      if (raw === null) return "";
      // Arrays and objects have no sensible flat rendering; keep the JSON.
      try {
        return JSON.stringify(raw) ?? "";
      } catch {
        return "";
      }
  }
}

/** Sets a field only when it carries something, so an absent attribute stays
 *  absent instead of becoming an empty string. */
function assign<T>(task: Task, key: keyof Task, value: T | undefined): void {
  if (value === undefined || value === "") return;
  (task as unknown as Record<string, unknown>)[key] = value;
}

function decodeTask(entry: Record<string, unknown>): Task {
  const task: Task = {
    id: decodeNumber(entry.id),
    uuid: decodeString(entry.uuid),
    description: decodeString(entry.description),
    status: decodeString(entry.status),
    urgency: decodeNumber(entry.urgency),
  };

  assign(task, "project", decodeString(entry.project));
  assign(task, "tags", decodeStrings(entry.tags));
  assign(task, "priority", decodeString(entry.priority));
  assign(task, "due", parseTaskDate(decodeString(entry.due)));
  assign(task, "scheduled", parseTaskDate(decodeString(entry.scheduled)));
  assign(task, "wait", parseTaskDate(decodeString(entry.wait)));
  assign(task, "entry", parseTaskDate(decodeString(entry.entry)));
  assign(task, "start", parseTaskDate(decodeString(entry.start)));
  assign(task, "end", parseTaskDate(decodeString(entry.end)));
  assign(task, "modified", parseTaskDate(decodeString(entry.modified)));
  assign(task, "recur", decodeString(entry.recur));
  assign(task, "depends", decodeStrings(entry.depends));
  assign(task, "annotations", decodeAnnotations(entry.annotations));

  const udas: Record<string, string> = {};
  for (const [name, value] of Object.entries(entry)) {
    if (knownFields.has(name)) continue;
    udas[name] = decodeScalar(value);
  }
  if (Object.keys(udas).length > 0) task.udas = udas;

  return task;
}

/** Decodes `task export` output. */
export function parseTasks(output: string): Task[] {
  let raw: unknown;
  try {
    raw = JSON.parse(output);
  } catch (error) {
    throw new ConfigError(
      `taskwarrior: decoding task export: ${(error as Error).message}`,
      "Run `task export` in a terminal to see what Taskwarrior printed.",
    );
  }
  if (!Array.isArray(raw)) {
    throw new ConfigError("taskwarrior: decoding task export: expected a list of tasks");
  }

  return raw.map((entry) =>
    decodeTask(
      entry !== null && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : {},
    ),
  );
}

export function countTasks(tasks: Task[], now: Date): Counts {
  const counts: Counts = {
    total: tasks.length,
    pending: 0, completed: 0, waiting: 0,
    recurring: 0, deleted: 0, active: 0, overdue: 0,
  };

  for (const task of tasks) {
    switch (task.status) {
      case "pending": counts.pending++; break;
      case "completed": counts.completed++; break;
      case "waiting": counts.waiting++; break;
      case "recurring": counts.recurring++; break;
      case "deleted": counts.deleted++; break;
    }
    if (task.start !== undefined) counts.active++;
    // A completed task with a past due date is not overdue any more.
    if (task.status === "pending" && task.due !== undefined) {
      const due = new Date(task.due);
      if (!Number.isNaN(due.valueOf()) && due < now) counts.overdue++;
    }
  }
  return counts;
}
