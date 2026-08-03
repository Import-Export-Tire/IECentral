// lib/dunlopSchedule.ts
// When the Dunlop monthly submission attempts happen. Lives here rather than in the
// route so it can be unit-tested — every date bug found on 2026-08-03 was date logic
// with no test behind it.

/** Dunlop's cutoff for the prior month's sellout report. */
export const DUNLOP_DEADLINE_DAY = 10;

/**
 * Latest day an attempt may land on: one clear day before the deadline, so a final
 * "still not uploaded" alert leaves time to actually act on it.
 */
const LATEST_ATTEMPT_DAY = DUNLOP_DEADLINE_DAY - 1;

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/**
 * Which days of `month` (0-indexed) this month's submission attempts land on.
 *
 * Nominally the 1st, 4th and 8th. Any that falls on a Saturday or Sunday moves
 * forward to the following Monday, because nobody uploads the monthly file on a
 * weekend and an attempt then would only nag into an empty office.
 *
 * A forward shift is capped at LATEST_ATTEMPT_DAY; past that it moves BACKWARD to the
 * preceding weekday instead. Without the cap a Saturday 8th shifts to Monday the 10th
 * — Dunlop's own deadline — so the last warning would arrive with no time left to do
 * anything. August 2026 is exactly that case.
 *
 * Cron fires the 1st-12th and the route uses this to decide whether today is really an
 * attempt day, since cron cannot express "next business day".
 *
 * Aug 2026: 1st Sat -> Mon 3; 8th Sat -> Mon 10 is past the cap -> back to Fri 7.
 * Nov 2026: 1st Sun -> Mon 2; 8th Sun -> Mon 9, inside the cap.
 */
export function scheduledAttemptDays(year: number, month: number): number[] {
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const cap = Math.min(LATEST_ATTEMPT_DAY, lastDayOfMonth);

  const resolve = (nominal: number) => {
    const d = new Date(year, month, nominal);
    while (isWeekend(d)) d.setDate(d.getDate() + 1);   // forward off a weekend
    if (d.getDate() > cap) {                            // overshot the deadline buffer
      d.setDate(cap);
      while (isWeekend(d)) d.setDate(d.getDate() - 1);  // back to the preceding weekday
    }
    return d.getDate();
  };

  return [...new Set([1, 4, 8].map(resolve))].sort((a, b) => a - b);
}

/** Days from `day` to the deadline. Negative once the deadline has passed. */
export function daysUntilDeadline(day: number): number {
  return DUNLOP_DEADLINE_DAY - day;
}
