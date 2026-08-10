/**
 * Which OEA07V `ReS` rows are not really customer returns.
 *
 * JMK books inbound stock receipts as `ReS` (return-to-stock) when they come
 * from an IET house entity or a wholesale/consignment partner. Those are not
 * customers handing tires back, so they must never land in the returns series
 * or net against sales.
 *
 * The Customer Name column (index 19) is TRUNCATED TO 12 CHARACTERS in the
 * feed — "IMPORT EXPOR", "AMERICAN TIR", "NORTH GATEWA". That is why the
 * matches below are prefixes rather than equalities. Names shorter than 12
 * chars ("REDRUM", "AOT") arrive complete.
 *
 * AOT and REDRUM added 2026-08-10 per Andy. Evidence: R10 was reporting 13,226
 * returns against 16,119 sales — an 82% return rate. Its ReS rows were
 * essentially all REDRUM (6,874 rows / 25,358 units across R10+W08) and AOT
 * (205 rows / 14,070 units at R10). REDRUM also buys via lump-sum MISC
 * invoices at W08, so it trades in both directions — consignment, not returns.
 *
 * This applies to `ReS` rows ONLY. REDRUM's `Sld` rows (the ~$1.28M/month of
 * MISC wholesale at W08) are real sales and are deliberately untouched.
 *
 * Still-open candidates, NOT filtered without Andy's say-so: "WTD" / "WTD - IET"
 * (55 + 32 rows, 8,984 units at W08), "ATTURO" (2,437 units), "TURBO TIRE"
 * (1,102 units). WTD also appears as a paying customer on MISC sales, so it is
 * genuinely ambiguous.
 */

/** Customer-name prefixes whose ReS rows are stock receipts, not returns. */
const HOUSE_RETURN_PREFIXES = [
  "IMPORT EXPOR",
  "IMPORT/EXPORT",
  "I.E.T",
  "EXPORT TIRE",
  "ESSEY TIRE",
  "KINGS SUPER",
  "KINGS TIRE",
  "REDRUM",
];

/**
 * True when a `ReS` row's customer is an IET house entity or wholesale partner,
 * meaning the row is an inbound stock receipt rather than a customer return.
 * Pass the raw Customer Name cell (column 19).
 */
export function isHouseReturn(rawCustomerName: string | undefined): boolean {
  const customer = (rawCustomerName || "").replace(/"/g, "").toUpperCase().trim();
  if (!customer) return false;
  // Exact-match short codes — too short to prefix-match safely.
  if (customer === "IET" || customer === "AOT") return true;
  if (customer.startsWith("IET ") || customer.startsWith("AOT ")) return true;
  return HOUSE_RETURN_PREFIXES.some((p) => customer.startsWith(p));
}
