// Run: npx tsx lib/dunlopSchedule.test.ts
import { scheduledAttemptDays } from "./dunlopSchedule";
import assert from "node:assert";

// month is 0-indexed, matching Date.
const JAN = 0, FEB = 1, MAR = 2, MAY = 4, JUL = 6, AUG = 7, SEP = 8, NOV = 10;

// Sanity: the calendars these expectations rest on.
assert.equal(new Date(2026, AUG, 1).getDay(), 6, "Aug 1 2026 is a Saturday");
assert.equal(new Date(2026, AUG, 8).getDay(), 6, "Aug 8 2026 is a Saturday");
assert.equal(new Date(2026, NOV, 1).getDay(), 0, "Nov 1 2026 is a Sunday");
assert.equal(new Date(2026, NOV, 8).getDay(), 0, "Nov 8 2026 is a Sunday");
assert.equal(new Date(2026, SEP, 1).getDay(), 2, "Sep 1 2026 is a Tuesday");

// Saturday 1st and Saturday 8th both move to the following Monday.
assert.deepEqual(scheduledAttemptDays(2026, AUG), [3, 4, 10]);

// Sunday 1st and Sunday 8th both move to the following Monday.
assert.deepEqual(scheduledAttemptDays(2026, NOV), [2, 4, 9]);

// All three already weekdays — untouched.
assert.deepEqual(scheduledAttemptDays(2026, SEP), [1, 4, 8]);

// The 4th landing on a weekend shifts on its own.
assert.equal(new Date(2026, JUL, 4).getDay(), 6, "Jul 4 2026 is a Saturday");
assert.deepEqual(scheduledAttemptDays(2026, JUL), [1, 6, 8], "Sat 4th -> Mon 6th");

assert.equal(new Date(2026, JAN, 4).getDay(), 0, "Jan 4 2026 is a Sunday");
assert.deepEqual(scheduledAttemptDays(2026, JAN), [1, 5, 8], "Sun 4th -> Mon 5th");

// Collapse: when a shift lands on a day already in the list, it must not duplicate.
// Mar 2026 — 1st is a Sunday, shifting to Mon 2nd; 4th and 8th are weekdays.
assert.equal(new Date(2026, MAR, 1).getDay(), 0, "Mar 1 2026 is a Sunday");
const mar = scheduledAttemptDays(2026, MAR);
assert.equal(new Set(mar).size, mar.length, "no duplicate attempt days");
assert.deepEqual(mar, [2, 4, 9], "Sun 1st -> Mon 2nd; Sun 8th -> Mon 9th");

// Always ascending, always 1-3 entries, never outside the month.
for (const y of [2025, 2026, 2027]) {
  for (let m = 0; m < 12; m++) {
    const days = scheduledAttemptDays(y, m);
    const lastDay = new Date(y, m + 1, 0).getDate();
    assert.ok(days.length >= 1 && days.length <= 3, `${y}-${m + 1}: 1-3 attempts`);
    assert.deepEqual([...days].sort((a, b) => a - b), days, `${y}-${m + 1}: ascending`);
    assert.equal(new Set(days).size, days.length, `${y}-${m + 1}: deduped`);
    for (const d of days) {
      assert.ok(d >= 1 && d <= lastDay, `${y}-${m + 1}: day ${d} within month`);
      const dow = new Date(y, m, d).getDay();
      assert.ok(dow !== 0 && dow !== 6, `${y}-${m + 1}: day ${d} is a weekday`);
      // Must stay inside the cron window (fires the 1st-12th) or it never runs.
      assert.ok(d <= 12, `${y}-${m + 1}: day ${d} inside the 1-12 cron window`);
    }
  }
}

// FEB is included above by the loop; assert one explicitly for the short-month case.
assert.ok(scheduledAttemptDays(2026, FEB).every((d) => d <= 28));
assert.ok(scheduledAttemptDays(2026, MAY).length > 0);

console.log("OK: dunlopSchedule.test.ts passed");
