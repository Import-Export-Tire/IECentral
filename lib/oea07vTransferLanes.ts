/**
 * Inter-location transfer lanes in the JMK OEA07V feed.
 *
 * A TrO (transfer out) row carries the lane in its Account ID as SOURCE+DEST:
 * "W08R20" is W08 -> R20, "R25W08" is R25 -> W08. Verified against prod for
 * July 2026 — every TrO account at W08, R20 and R25 matched that shape, and
 * JMK independently writes the same thing into the Customer Name column as
 * "TRANS W08>R10", which is the display format Andy asked for.
 *
 * Deriving from the account rather than parsing the customer-name string keeps
 * this robust: the account is a structured code, the name is free text.
 */

/** A parsed transfer lane. */
export interface TransferLane {
  from: string;
  to: string;
  /** Display label, e.g. "W08>R20". */
  label: string;
}

/** Two location codes joined, e.g. W08R20 / R25W08 / R20R35. */
const LANE_ACCOUNT = /^([WR]\d{2})([WR]\d{2})$/i;

/**
 * Parse a transfer lane from an OEA07V account ID.
 *
 * `fallbackFrom` is the row's own location. When the account parses, its
 * source segment is used (and normally equals the row location). When it
 * doesn't parse — a transfer booked against some other account shape — we
 * fall back to "<location>>?" so the volume still shows up attributed to the
 * right origin instead of vanishing.
 */
export function parseTransferLane(
  account: string | undefined,
  fallbackFrom: string,
): TransferLane {
  const acct = (account || "").replace(/"/g, "").trim().toUpperCase();
  const from = (fallbackFrom || "").trim().toUpperCase();
  const m = acct.match(LANE_ACCOUNT);
  if (!m) return { from, to: "?", label: `${from}>?` };
  const [, a, b] = m;
  const src = a.toUpperCase();
  const dest = b.toUpperCase();
  return { from: src, to: dest, label: `${src}>${dest}` };
}
