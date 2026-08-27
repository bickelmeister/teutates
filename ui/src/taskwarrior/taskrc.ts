import type { ReadRC } from "./client";

/** Guards against rc files that include each other. */
const maxIncludeDepth = 10;

/** Records where a configured value came from and what it literally says,
 *  which may differ from the value Taskwarrior resolves at runtime. */
export interface Origin {
  source: string;
  value: string;
}

export interface TaskrcOrigins {
  origins: Map<string, Origin>;
  /** Include targets that could not be located. */
  unresolved: string[];
}

/** Recognises Taskwarrior's `include <file>` directive, which is also
 *  accepted as `include=<file>`. Keys that merely start with the word, such
 *  as `includes.foo=1`, are not directives. */
export function includeTarget(line: string): string | undefined {
  if (!line.startsWith("include")) return undefined;
  let rest = line.slice("include".length);
  if (rest === "" || (rest[0] !== " " && rest[0] !== "\t" && rest[0] !== "=")) {
    return undefined;
  }
  rest = rest.trim();
  if (rest.startsWith("=")) rest = rest.slice(1).trim();
  return rest === "" ? undefined : rest;
}

/** The last path segment, used to name the file a value came from. */
function baseName(path: string): string {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at === -1 ? path : path.slice(at + 1);
}

/** The directory a file sits in, which is where its includes are looked for
 *  first. */
function dirName(path: string): string {
  const at = path.lastIndexOf("/");
  return at <= 0 ? "/" : path.slice(0, at);
}

/** Reads an rc file and every file it includes, returning the origin of each
 *  configured key. Later definitions win, matching Taskwarrior's own
 *  precedence. Includes that cannot be located are collected separately
 *  rather than failing the whole read. */
export async function parseTaskrc(
  path: string,
  read: ReadRC,
): Promise<TaskrcOrigins> {
  const result: TaskrcOrigins = { origins: new Map(), unresolved: [] };
  await readRCFile(path, "", "taskrc", 0, read, result, new Set());
  return result;
}

async function readRCFile(
  path: string,
  base: string,
  source: string | undefined,
  depth: number,
  read: ReadRC,
  result: TaskrcOrigins,
  visited: Set<string>,
): Promise<void> {
  if (depth > maxIncludeDepth) return;

  const file = await read(path, base);
  // A missing or unreadable file is not fatal: at the top it means every
  // value is a Taskwarrior default, and inside it means an unresolved
  // include, which the caller reports separately.
  if (file === null) {
    if (depth > 0) result.unresolved.push(path);
    return;
  }

  // A file included twice contributes nothing new and may be a cycle.
  if (visited.has(file.path)) return;
  visited.add(file.path);

  // Values keep the name of the file that actually defines them, which is
  // known only once the include has been resolved to a real path.
  const label = source ?? `include:${baseName(file.path)}`;

  for (const raw of file.content.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    const target = includeTarget(line);
    if (target !== undefined) {
      await readRCFile(
        target,
        dirName(file.path),
        undefined,
        depth + 1,
        read,
        result,
        visited,
      );
      continue;
    }

    const at = line.indexOf("=");
    if (at === -1) continue;
    const key = line.slice(0, at).trim();
    if (key === "") continue;
    result.origins.set(key, { source: label, value: line.slice(at + 1).trim() });
  }
}
