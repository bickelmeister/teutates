/** Reads configuration from a local Taskwarrior installation. Taskwarrior
 *  3.x keeps its task data in a TaskChampion SQLite database, so
 *  configuration is obtained by invoking the `task` binary rather than by
 *  parsing data files directly. */

import type { Origin } from "./taskrc";

/** A single effective configuration entry. */
export interface Setting {
  key: string;
  value: string;
  /** Set only when the value written in the rc files differs from the value
   *  Taskwarrior actually reports. This happens for TTY-dependent keys such
   *  as `color`, which resolves to `off` when Taskwarrior runs without a
   *  terminal. */
  configuredValue?: string;
  group: string;
  /** "default" for built-in values, "taskrc" for values set in the main rc
   *  file, or "include:<name>" for values from an included file. */
  source: string;
  isOverride: boolean;
  /** Marks a key that is present in the rc files but that Taskwarrior does
   *  not know, so setting it has no effect. */
  unrecognized?: boolean;
}

/** A namespace of settings, derived from the key prefix. */
export interface Group {
  name: string;
  count: number;
}

/** The configuration the settings view renders. */
export interface Config {
  taskVersion: string;
  taskrcPath: string;
  groups: Group[];
  settings: Setting[];
  /** `include` directives whose target file could not be located. Values from
   *  those files still appear, but as defaults. */
  unresolvedIncludes?: string[];
  /** rc entries Taskwarrior does not know. They are almost always typos or
   *  settings that never existed. */
  unrecognizedKeys?: string[];
}

/** generalGroup collects keys that carry no dotted prefix. */
const generalGroup = "general";

/** Reads the `key=value` lines emitted by `task _show`. */
export function parseShow(output: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const line of output.split("\n")) {
    const at = line.indexOf("=");
    // `_show` emits nothing but key=value pairs; anything else is skipped
    // rather than treated as a fatal error.
    if (at === -1) continue;
    const key = line.slice(0, at).trim();
    if (key === "") continue;
    values.set(key, line.slice(at + 1).trim());
  }
  return values;
}

/** Derives a settings group from a configuration key. */
export function groupOf(key: string): string {
  const at = key.indexOf(".");
  if (at <= 0) return generalGroup;
  return key.slice(0, at);
}

/** Orders groups alphabetically but keeps `general` first, since those are
 *  the keys a user is most likely looking for. */
export function compareGroups(a: string, b: string): number {
  if (a === b) return 0;
  if (a === generalGroup) return -1;
  if (b === generalGroup) return 1;
  return a < b ? -1 : 1;
}

/** Merges the effective configuration with the origins parsed from the rc
 *  files into the configuration the interface renders. */
export function build(
  effective: Map<string, string>,
  origins: Map<string, Origin>,
  taskrcPath: string,
  version: string,
  unresolved: string[],
  unrecognized: string[],
): Config {
  const unknown = new Set(unrecognized);
  const counts = new Map<string, number>();
  const settings: Setting[] = [];

  for (const [key, value] of effective) {
    const group = groupOf(key);
    counts.set(group, (counts.get(group) ?? 0) + 1);

    const setting: Setting = {
      key,
      value,
      group,
      source: "default",
      isOverride: false,
    };

    const origin = origins.get(key);
    if (origin !== undefined) {
      setting.source = origin.source;
      setting.isOverride = true;
      if (origin.value !== value) setting.configuredValue = origin.value;
    }
    if (unknown.has(key)) setting.unrecognized = true;

    settings.push(setting);
  }

  settings.sort((a, b) => {
    if (a.group !== b.group) return compareGroups(a.group, b.group);
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  const groups = [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => compareGroups(a.name, b.name));

  const config: Config = { taskVersion: version, taskrcPath, groups, settings };
  if (unresolved.length > 0) config.unresolvedIncludes = unresolved;
  if (unrecognized.length > 0) config.unrecognizedKeys = unrecognized;
  return config;
}

/** Extracts the version from `task --version` output. */
export function parseVersion(output: string): string {
  return (output.trim().split("\n", 1)[0] ?? "").trim();
}

/** Extracts `uda.<name>.label` entries from the configuration. */
export function udaLabels(config: Config): Record<string, string> | undefined {
  const labels: Record<string, string> = {};

  for (const setting of config.settings) {
    if (!setting.key.startsWith("uda.") || !setting.key.endsWith(".label")) continue;
    const name = setting.key.slice("uda.".length, -".label".length);
    if (name === "" || setting.value === "") continue;
    labels[name] = setting.value;
  }

  return Object.keys(labels).length === 0 ? undefined : labels;
}
