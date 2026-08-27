import assert from "node:assert/strict";
import { test } from "node:test";

import { parseUnrecognized } from "../../src/taskwarrior/unrecognized";

/** The exact shape of the footnote `task show` prints, blank lines included. */
const showFootnote = `weekstart                          sunday
xterm.title                        0

Some of your .taskrc variables differ from the default values.
Your .taskrc file contains these unrecognized variables:
  sort
  colour.due

`;

test("parseUnrecognized reads the footnote block", () => {
  assert.deepEqual(parseUnrecognized(showFootnote), ["sort", "colour.due"]);
});

// A configuration without mistakes prints no footnote at all.
test("parseUnrecognized returns nothing without a footnote", () => {
  assert.deepEqual(parseUnrecognized("weekstart  sunday\nxterm.title  0\n"), []);
});

// The block ends at the first blank line; whatever follows is not a key.
test("parseUnrecognized stops at the block end", () => {
  const input =
    "Your .taskrc file contains these unrecognized variables:\n  sort\n\nSomething else entirely\n";
  assert.deepEqual(parseUnrecognized(input), ["sort"]);
});

// An unindented line ends the block too, in case the trailing newline is gone.
test("parseUnrecognized stops at an unindented line", () => {
  const input = "Your .taskrc file contains these unrecognized variables:\n  sort\nNot a key\n";
  assert.deepEqual(parseUnrecognized(input), ["sort"]);
});
