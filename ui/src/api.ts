/** The interface's view of Taskwarrior.
 *
 *  Everything below this module runs in the browser: the server is asked only
 *  to run `task` and to read rc files, and this is where that raw output
 *  becomes a configuration and a task list. */

export { ConfigError } from "./taskwarrior/client";
export type { Config, Group, Setting } from "./taskwarrior/config";
export type { SortSpec } from "./taskwarrior/sortspec";
export type {
  Annotation,
  Counts,
  StatusFilter,
  Task,
  TaskList,
} from "./taskwarrior/tasks";

export { loadConfig as fetchConfig, loadTasks as fetchTasks } from "./taskwarrior/service";
