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
 *   XA       "=ENTER ITEM/SZ/MFG/MODEL" lines. Almost all are Adj/RS, which the
 *            transaction filter already drops; the residual Sld portion was
 *            ~$377 at R20 in July. Excluded per Andy 2026-08-10.
 *
 * Z IS COUNTED, despite the "=ENTER THE DETAILS" description. Inspecting all 38
 * W08 rows for July 2026 showed real sales: item ID "MISC", transaction Sld,
 * booked to numeric customer accounts — REDRUM PURCH (acct 3901) alone was 27
 * lines and ~$1.28M of the $1.34M, plus WTD (4800) and COMMERCIAL T (4538).
 * Lump-sum wholesale billing, ~1.4% margin. Excluding it hid ~$1.3M/month.
 * (Re-inspect any code with ?diagnoseLocation=W08&inspectProductType=Z.)
 *
 * Case matters: bare "T" is dropship (counted) while lowercase "t" is a
 * retread (counted) — but the exclusion list is matched case-INSENSITIVELY,
 * since no excluded code has a meaningful case variant.
 */

/** Product-type codes that are never a sale. */
export const NON_SALES_PRODUCT_TYPES = new Set(["G", "VXX", "XA"]);

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
 * Sales categories.
 *
 * A single blended sales figure is misleading now that everything sellable
 * counts: July 2026 jumped 57.6% and most of that was MISC wholesale and
 * dropship, not retail tire sales. Splitting by category lets a reader see
 * composition instead of one number that moved for invisible reasons.
 *
 * Derived from the product-type code only — no account or customer heuristics,
 * so a row lands in exactly one bucket and the buckets always sum to the total.
 */
export type SalesCategoryKey =
  | "tires" | "dropship" | "wholesale" | "parts"
  | "services" | "fees" | "discounts" | "other";

/** Display order, most-retail-like first. */
export const SALES_CATEGORY_ORDER: SalesCategoryKey[] = [
  "tires", "parts", "services", "fees", "discounts", "dropship", "wholesale", "other",
];

export const SALES_CATEGORY_LABELS: Record<SalesCategoryKey, string> = {
  tires: "Tires",
  parts: "Parts & merchandise",
  services: "Services & plans",
  fees: "Fees & taxes",
  discounts: "Rebates & discounts",
  dropship: "Dropship",
  wholesale: "Wholesale (MISC)",
  other: "Other / unclassified",
};

/** Exact-code assignments. Anything else starting with T/t is a tire. */
const CATEGORY_BY_CODE: Record<string, SalesCategoryKey> = {
  // Bare "T" is TH DROPSHIP / SHIP TO HOME / NGT DROPSHIP at W08.
  // (Lowercase "t" is a retread and falls through to "tires" below.)
  Z: "wholesale",       // "MISC" lump-sum wholesale invoices
  A: "parts",           // TPMS sensors + lug nuts
  P: "parts",           // TPMS valve stems, outside-purchase parts
  AX: "parts",          // truck valves
  PWB: "parts",         // Counteract balance beads
  I: "parts", IF: "parts", IFR: "parts", IM: "parts",
  IP: "parts", IS: "parts", D: "parts",   // tubes
  ZRI: "services",      // tire protection plan
  PBP: "services",      // nitrogen fill
  ZS: "services",       // freight / ship revenue
  F: "fees",            // disposal & recycling fees
  FX: "fees",           // PA tire tax / new tire fee
  CT: "discounts",      // instant rebates and coupons (negative revenue)
};

/**
 * Which sales category a row belongs to. Pass the raw product-type cell.
 * Callers should only use this on rows that passed isSalesProductType().
 */
export function salesCategory(raw: string | undefined): SalesCategoryKey {
  const pt = (raw || "").replace(/"/g, "").trim();
  if (!pt) return "other";
  // Case-sensitive on purpose: "T" is dropship, "t" is a retread.
  if (pt === "T") return "dropship";
  const mapped = CATEGORY_BY_CODE[pt.toUpperCase()];
  if (mapped) return mapped;
  // TP, TL, TST, TM, TF, TP*, T2M, TSG, TO ... plus lowercase t / tM retreads.
  if (pt.toUpperCase().startsWith("T")) return "tires";
  return "other";
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
