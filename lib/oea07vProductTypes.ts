/**
 * What counts as a sellable line in the JMK OEA07V feed.
 *
 * The reports used to keep only product types starting with "T" (tires),
 * excluding bare "T". That silently dropped every non-tire thing the stores
 * actually sell — TPMS sensors, lug nuts, tubes, balance beads, valve stems,
 * protection plans, disposal fees — and, at W08, the whole dropship business.
 *
 * What the July 2026 data actually contains (verified against prod via
 * /api/reports/sales-by-day?diagnoseLocation=...):
 *
 *   Tires          TP TL TS TST TM TF TP* TL* ...  and lowercase t / tM,
 *                  which are RETREADS ("11R24.5 LDD RETREAD"). The old
 *                  case-sensitive startsWith("T") dropped those outright.
 *   Dropship       T   — "TH DROPSHIP", "SHIP TO HOME", "NGT DROPSHIP".
 *                  ~$478K at W08 in July alone. Real revenue; counted.
 *   Merchandise    A   TPMS sensors + lug nuts
 *                  P   TPMS valve stems, outside-purchase parts
 *                  AX  truck valves
 *                  PWB Counteract balance beads
 *                  I IF IFR IM IP IS D  tubes
 *   Services/fees  ZRI tire protection plan, PBP nitrogen fill,
 *                  ZS  freight / ship revenue, F disposal & recycling fees,
 *                  FX  PA tire tax
 *   Deductions     CT  instant rebates and coupons (negative revenue)
 *
 * Everything above counts, per Andy 2026-08-10: fees and plans count in both
 * dollars AND units.
 *
 * EXCLUDED — these are not sales:
 *   G, VXX   General-ledger expense lines. Descriptions are "~"-prefixed:
 *            ~EBAY FEES, ~BANK WIRE FEES, ~ADMIN PAYROLL ALLOCATION,
 *            ~PTTY: LUNCH / FUEL / ADMIN EXPENSE, ~PTTY: MISC VEH EXP.
 *   XA       "=ENTER ITEM/SZ/MFG/MODEL" placeholder lines.
 *   Z        "=ENTER THE DETAILS" placeholder lines. NOTE: at W08 these carry
 *            $1.34M across 38 rows in July — under review with Andy. Excluded
 *            for now (status quo); inspect them with
 *            ?diagnoseLocation=W08&inspectProductType=Z
 *
 * Case matters: bare "T" is dropship (counted) while lowercase "t" is a
 * retread (counted) — but the exclusion list is matched case-INSENSITIVELY,
 * since no excluded code has a meaningful case variant.
 */

/** Product-type codes that are never a sale. */
export const NON_SALES_PRODUCT_TYPES = new Set(["G", "VXX", "XA", "Z"]);

/**
 * True when an OEA07V row's product type represents something sold to a
 * customer. Pass the raw cell (column 3); quoting and whitespace are handled.
 */
export function isSalesProductType(raw: string | undefined): boolean {
  const pt = (raw || "").replace(/"/g, "").trim();
  if (!pt) return false;
  return !NON_SALES_PRODUCT_TYPES.has(pt.toUpperCase());
}

/**
 * Why a product type was rejected, for the debug/diagnostic endpoints.
 * Returns null when the row is counted.
 */
export function productTypeRejectReason(raw: string | undefined): string | null {
  const pt = (raw || "").replace(/"/g, "").trim();
  if (!pt) return "productType=(empty)";
  if (NON_SALES_PRODUCT_TYPES.has(pt.toUpperCase())) return `productType=${pt} (not a sale)`;
  return null;
}
