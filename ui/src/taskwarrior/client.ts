/** The transport to the local teutates server. It offers exactly what a
 *  browser cannot do for itself — run `task` and read rc files — and knows
 *  nothing about what Taskwarrior's output means. */

/** The shape of every error the server answers with. */
interface ApiError {
  error: string;
  hint?: string;
}

/** Thrown for anything the interface cannot recover from, carrying the
 *  server's explanation. */
export class ConfigError extends Error {
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "ConfigError";
    this.hint = hint;
  }
}

/** What the server knows about the machine it runs on. */
export interface Env {
  taskrcPath: string;
  /** Modification time of the rc file, or null when it does not exist.
   *  Used to decide whether a cached configuration is still current. */
  taskrcMtime: number | null;
  home: string;
  themeDirs: string[];
}

/** One rc file, as it sits on disk. */
export interface RCFile {
  path: string;
  content: string;
}

/** Reads an rc file, resolving a relative name against `base` and the theme
 *  directories. Returns null when no such file exists, which is a normal
 *  answer for an include that points nowhere. */
export type ReadRC = (path: string, base: string) => Promise<RCFile | null>;

async function request<T>(
  path: string,
  init: RequestInit,
  allowNotFound = false,
): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    // An aborted request is a navigation, not a failure to report.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ConfigError(
      "Could not reach the teutates server.",
      "Make sure the backend is running and reload the page.",
    );
  }

  if (allowNotFound && response.status === 404) return null;

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    throw new ConfigError(
      body?.error ?? `Request failed with status ${response.status}.`,
      body?.hint,
    );
  }

  return (await response.json()) as T;
}

export function fetchEnv(signal?: AbortSignal): Promise<Env> {
  return request<Env>("/api/env", { signal }) as Promise<Env>;
}

/** What one `task` invocation produced. */
interface TaskResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Runs `task` with the given arguments and returns its output.
 *
 *  A non-zero exit is reported by the server as an ordinary result, because
 *  it is an answer rather than a transport failure — but for the callers here
 *  it is still a failed read, so it is raised with Taskwarrior's own message. */
export async function runTask(
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  const result = (await request<TaskResult>("/api/task", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args }),
    signal,
  })) as TaskResult;

  if (result.code !== 0) {
    const message = result.stderr.trim() !== ""
      ? result.stderr.trim()
      : `exited with status ${result.code}`;
    throw new ConfigError(
      `taskwarrior: \`task ${args.join(" ")}\` failed: ${message}`,
    );
  }
  return result.stdout;
}

export function readRC(
  path: string,
  base: string,
  signal?: AbortSignal,
): Promise<RCFile | null> {
  const query = new URLSearchParams({ path, base });
  return request<RCFile>(`/api/rc?${query}`, { signal }, true);
}
