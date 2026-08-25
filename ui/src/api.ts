export interface Setting {
  key: string;
  value: string;
  /** Present only when the rc files say something different from the
   *  value Taskwarrior actually resolves (e.g. `color` without a TTY). */
  configuredValue?: string;
  group: string;
  /** "default", "taskrc", or "include:<file>". */
  source: string;
  isOverride: boolean;
  /** Present in the rc files but unknown to Taskwarrior, so it has no effect. */
  unrecognized?: boolean;
}

export interface Group {
  name: string;
  count: number;
}

export interface Config {
  taskVersion: string;
  taskrcPath: string;
  groups: Group[];
  settings: Setting[];
  unresolvedIncludes?: string[];
  unrecognizedKeys?: string[];
}

export interface ApiError {
  error: string;
  hint?: string;
}

/** Thrown for any non-OK response, carrying the server's explanation. */
export class ConfigError extends Error {
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "ConfigError";
    this.hint = hint;
  }
}

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
  /** User-defined attributes, which differ per installation. */
  udas?: Record<string, string>;
}

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

export type StatusFilter = "pending" | "completed" | "all";

/** The Taskwarrior report order the list follows. */
export interface SortSpec {
  /** Report the order was taken from, e.g. "list". */
  report: string;
  /** Raw configuration value, e.g. "start-,due+,project+,urgency-". */
  spec: string;
  /** Attributes the backend cannot sort by; they were skipped. */
  unsupported?: string[];
}

export interface TaskList {
  status: StatusFilter;
  sort: SortSpec;
  counts: Counts;
  tasks: Task[];
  udaLabels?: Record<string, string>;
}

/** Performs a request against the local API and unwraps its error shape. */
async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { signal });
  } catch (error) {
    // An aborted request is a navigation, not a failure to report.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ConfigError(
      "Could not reach the teutates server.",
      "Make sure the backend is running and reload the page.",
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    throw new ConfigError(
      body?.error ?? `Request failed with status ${response.status}.`,
      body?.hint,
    );
  }

  return (await response.json()) as T;
}

export function fetchConfig(signal?: AbortSignal): Promise<Config> {
  return request<Config>("/api/config", signal);
}

export function fetchTasks(
  status: StatusFilter,
  signal?: AbortSignal,
): Promise<TaskList> {
  return request<TaskList>(
    `/api/tasks?status=${encodeURIComponent(status)}`,
    signal,
  );
}
