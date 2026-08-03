// lib/dunlopSchedule.ts
// When the Dunlop monthly submission attempts happen. Lives here rather than in the
// route so it can be unit-tested — every date bug found on 2026-08-03 was date logic
// with no test behind it.

/**
 * Which days of `month` (0-indexed) this month's submission attempts land on.
 *
 * Nominally the 1st, 4th and 8th. Any that falls on a Saturday or Sunday moves
 * forward to the following Monday, because nobody is uploading the monthly file
 * on a weekend and an attempt then would only nag into an empty office.
 *
 * The cron fires every day from the 1st to the 12th and this decides whether today
 * is actually an attempt day, since cron cannot express "next business day".
 *
 * Aug 2026: the 1st is a Saturday and the 8th is a Saturday -> attempts on 3, 4, 10.
 * Nov 2026: the 1st is a Sunday and the 8th is a Sunday    -> attempts on 2, 4, 9.
 */
export function scheduledAttemptDays(year: number, month: number): number[] {
  const shift = (day: number) => {
    const d = new Date(year, month, day);
    const dow = d.getDay();                       // 0 Sun ... 6 Sat
    if (dow === 6) d.setDate(d.getDate() + 2);    // Sat -> Mon
    else if (dow === 0) d.setDate(d.getDate() + 1); // Sun -> Mon
    return d.getDate();
  };
  return [...new Set([1, 4, 8].map(shift))].sort((a, b) => a - b);
}
