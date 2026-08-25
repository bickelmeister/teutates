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

export async function fetchConfig(signal?: AbortSignal): Promise<Config> {
  let response: Response;
  try {
    response = await fetch("/api/config", { signal });
  } catch {
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

  return (await response.json()) as Config;
}
