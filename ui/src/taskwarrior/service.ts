import type { Env } from "./client";
import { fetchEnv, readRC, runTask } from "./client";
import type { Config } from "./config";
import { build, parseShow, parseVersion, udaLabels } from "./config";
import { parseSortSpec, sortReport, sortSpecFor, sortTasksBy } from "./sortspec";
import type { Origin } from "./taskrc";
import { parseTaskrc } from "./taskrc";
import type { StatusFilter, TaskList } from "./tasks";
import { countTasks, parseTasks, statusFilterArgs } from "./tasks";
import { parseUnrecognized } from "./unrecognized";

/** The configuration is cached until the rc file changes, which covers the
 *  common case of the user editing ~/.taskrc while the server runs. Edits to
 *  included files are not detected; the settings view is read-only, so a
 *  stale include is a cosmetic staleness at worst. */
let cached: Config | undefined;
let cachedMtime: number | null | undefined;

/** Drops the cached configuration. Used by the tests, and by anything that
 *  knows the configuration has just changed. */
export function invalidateConfig(): void {
  cached = undefined;
  cachedMtime = undefined;
}

/** Returns the effective Taskwarrior configuration, reading it on the first
 *  call and whenever the rc file changed. */
export async function loadConfig(signal?: AbortSignal): Promise<Config> {
  const env = await fetchEnv(signal);

  if (cached !== undefined && cachedMtime === env.taskrcMtime) return cached;

  const config = await load(env, signal);
  cached = config;
  cachedMtime = env.taskrcMtime;
  return config;
}

async function load(env: Env, signal?: AbortSignal): Promise<Config> {
  const effective = parseShow(await runTask(["_show"], signal));

  // Neither the version nor the origins nor the footnote is worth failing
  // the whole read over: without them the settings view still renders, just
  // with less to say about where a value came from.
  let version = "";
  try {
    version = parseVersion(await runTask(["--version"], signal));
  } catch (error) {
    rethrowAbort(error);
  }

  let origins = new Map<string, Origin>();
  let unresolved: string[] = [];
  try {
    const parsed = await parseTaskrc(
      env.taskrcPath,
      (path, base) => readRC(path, base, signal),
    );
    origins = parsed.origins;
    unresolved = parsed.unresolved;
  } catch (error) {
    rethrowAbort(error);
  }

  // Only `task show` knows which keys Taskwarrior recognises, and it reports
  // them in a footnote. rc.verbose is forced so the footnote does not depend
  // on the user's own verbosity setting.
  let unrecognized: string[] = [];
  try {
    unrecognized = parseUnrecognized(await runTask(["rc.verbose=footnote", "show"], signal));
  } catch (error) {
    rethrowAbort(error);
  }

  return build(effective, origins, env.taskrcPath, version, unresolved, unrecognized);
}

/** A cancelled request must not be swallowed by a tolerant catch: it means
 *  the view was replaced, not that Taskwarrior said nothing useful. */
function rethrowAbort(error: unknown): void {
  if (error instanceof DOMException && error.name === "AbortError") throw error;
}

/** Returns the tasks matching the given status filter.
 *
 *  Unlike the configuration, tasks change while the page is open, so this is
 *  read fresh every time; `task export` on a normal task list is fast enough
 *  that caching would trade correctness for nothing. */
export async function loadTasks(
  filter: StatusFilter,
  signal?: AbortSignal,
): Promise<TaskList> {
  // rc.verbose=nothing keeps informational banners such as the release note
  // out of stdout, which would otherwise not be valid JSON.
  const args = ["rc.verbose=nothing", ...statusFilterArgs(filter), "export"];
  const tasks = parseTasks(await runTask(args, signal));

  // The configuration supplies both the sort order and the UDA labels. It is
  // cached separately, and neither is worth failing the request over: without
  // it the list still renders, in the default order.
  let config: Config | undefined;
  try {
    config = await loadConfig(signal);
  } catch (error) {
    rethrowAbort(error);
  }

  const spec = sortSpecFor(config);
  const { keys, unsupported } = parseSortSpec(spec);
  sortTasksBy(tasks, keys);

  const list: TaskList = {
    status: filter,
    counts: countTasks(tasks, new Date()),
    tasks,
    sort: { report: sortReport, spec },
  };
  if (unsupported.length > 0) list.sort.unsupported = unsupported;
  if (config !== undefined) {
    const labels = udaLabels(config);
    if (labels !== undefined) list.udaLabels = labels;
  }

  return list;
}
