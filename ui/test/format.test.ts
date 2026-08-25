import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { formatDue, formatUrgency } from "../src/format";

const now = new Date("2026-08-25T12:00:00Z");
const at = (iso: string) => formatDue(iso, now);

describe("formatDue", () => {
  test("renders near future and past relative", () => {
    assert.deepEqual(at("2026-08-25T12:30:00Z"), { text: "in 30 min", past: false });
    assert.deepEqual(at("2026-08-25T11:30:00Z"), { text: "30 min ago", past: true });
    assert.deepEqual(at("2026-08-25T18:00:00Z"), { text: "in 6 h", past: false });
    assert.deepEqual(at("2026-08-28T12:00:00Z"), { text: "in 3 days", past: false });
    assert.deepEqual(at("2026-08-24T12:00:00Z"), { text: "1 day ago", past: true });
  });

  // The absolute form follows the viewer's locale, so the assertion checks
  // the behaviour (no longer relative, carries the day) rather than wording.
  test("switches to an absolute date beyond a week", () => {
    const far = at("2026-10-01T12:00:00Z");
    assert.ok(far);
    assert.equal(far.past, false);
    assert.doesNotMatch(far.text, /\bin\b|\bago\b/);
    assert.match(far.text, /\b0?1\b/);
  });

  test("omits the year for dates inside the current year", () => {
    const thisYear = at("2026-10-01T12:00:00Z");
    const nextYear = at("2027-10-01T12:00:00Z");
    assert.ok(thisYear && nextYear);
    assert.doesNotMatch(thisYear.text, /2026/);
    assert.match(nextYear.text, /2027/);
  });

  test("returns null for an absent or unparseable value", () => {
    assert.equal(at(""), null);
    assert.equal(at("20260831T215959Z"), null);
  });

  test("never rounds a due date down to zero", () => {
    // A task due in seconds must not read "in 0 min".
    assert.deepEqual(at("2026-08-25T12:00:10Z"), { text: "in 1 min", past: false });
  });
});

describe("formatUrgency", () => {
  test("matches the single decimal Taskwarrior shows", () => {
    assert.equal(formatUrgency(24.4096), "24.4");
    assert.equal(formatUrgency(0), "0.0");
    assert.equal(formatUrgency(-1.25), "-1.3");
  });
});
