/** unrecognizedMarker introduces the block `task show` prints for rc entries
 *  Taskwarrior does not know. There is no machine-readable equivalent, so
 *  this footnote is the only source for it. */
const unrecognizedMarker = "unrecognized variables:";

/** Reads the trailing block of `task show`:
 *
 *      Your .taskrc file contains these unrecognized variables:
 *        sort
 *
 *  An absent block simply means every configured key is known. */
export function parseUnrecognized(output: string): string[] {
  const lines = output.split("\n");

  const marker = lines.findIndex((line) => line.includes(unrecognizedMarker));
  if (marker === -1) return [];

  const keys: string[] = [];
  for (const line of lines.slice(marker + 1)) {
    // The block is indented and ends at the first blank line.
    if (line.trim() === "") break;
    if (!line.startsWith(" ")) break;
    keys.push(line.trim());
  }
  return keys;
}
