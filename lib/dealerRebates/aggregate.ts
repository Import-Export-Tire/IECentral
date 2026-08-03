// lib/dealerRebates/aggregate.ts
// Shared, pure OEA07V → dealer-rebate aggregator.
// Used by: app/dealer-rebates/page.tsx (client), app/api/dealer-rebates/auto-process (server),
// and convex/dealerRebatesBackfill (backfill). No React / Convex / Node-only APIs.

export const COL = {
  ITEM_ID: 0, PRODUCT_TYPE: 3, MFG_ID: 4, MFG_ITEM_ID: 5,
  LOC_ID: 8, QTY: 10, SELL_PRICE: 13, ACCOUNT_ID: 15,
  INV_ID: 16, ACTIVITY_DATE: 18,
} as const;

export const IE_FALKEN = { distributorAccount: "20118", address: "400 Unity St.  STE. 100", city: "Latrobe", state: "PA", zip: "15650" };
export const IE_MILESTAR = { parentDistributor: "119662", distributorCenter: "119662:0" };

const STORE_ACCOUNTS: Record<string, string> = {
  "w08r20": "w08r20", "r20w08": "w08r20",
  "w08r25": "w08r25", "r25w08": "w08r25",
  "w08r35": "w08r35", "r35w08": "w08r35",
};

export interface RebateDealer {
  jmk: string; name: string; fanaticId?: number; dealerNumber?: string;
  programs: string[]; isActive: boolean;
}

export interface OutputRow { [k: string]: string | number; }

// One normalized aggregate per (dealer, activity-month) within a single file.
export interface DealerMonthAgg {
  jmk: string; name: string; fanaticId?: number; dealerNumber?: string;
  month: string;      // "YYYY-MM" from ACTIVITY_DATE
  qty: number;        // NET tires (sales positive, returns negative)
  rowCount: number;   // invoice lines (kept for reference/debugging)
}

export interface ProgramResult {
  outRows: OutputRow[];          // exact CSV rows for the program upload file
  breakdown: DealerMonthAgg[];   // per (dealer, month)
  matchedQty: number;            // sum of breakdown.qty
  matchedRows: number;           // sum of breakdown.rowCount
  dealersMatched: number;        // distinct dealers
}

export interface AggregateResult {
  falken: ProgramResult;
  milestar: ProgramResult;
  totalInputRows: number;
  filteredRows: number;
  dateRangeStart?: string;       // earliest ACTIVITY_DATE (MM/DD/YY)
  dateRangeEnd?: string;         // latest ACTIVITY_DATE (MM/DD/YY)
}

export function parseCSVRow(line: string): string[] {
  const fields: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) { fields.push(cur); cur = ""; }
    else cur += c;
  }
  fields.push(cur);
  return fields;
}

export function parsePositionalCSV(text: string): string[][] {
  const cleaned = text.replace(/^﻿/, "").replace(/\0/g, "");
  const lines = cleaned.trim().split(/\r?\n/);
  return lines.slice(1).filter(l => l.trim()).map(parseCSVRow);
}

export function normalizeAcct(raw: string): string {
  let s = raw.trim().toLowerCase();
  if (!s) return "xxx";
  if (s.match(/^e\d/)) return "xxx";
  if (STORE_ACCOUNTS[s]) return STORE_ACCOUNTS[s];
  s = s.replace(/^\s+/, '').replace(/^0+/, '') || 'xxx';
  return s;
}

// "MM/DD/YY" (or M/D/YY) -> "YYYY-MM". Returns "" if unparseable.
// "M/D/YY" or "MM/DD/YYYY" -> "YYYY-MM-DD", or null when unparseable.
// Use this (never a string sort) whenever ACTIVITY_DATE values are compared or
// ordered: the raw MM/DD/YY form sorts wrong lexicographically. "6/12/26" sorts
// after "07/01/26" because "6" > "0", and any range crossing a year boundary
// inverts ("01/05/26" < "12/15/25"). A wrong ordering used to propagate into the
// S3 output filename, silently overwriting a previously submitted file.
export function activityYMD(dateRaw: string): string | null {
  const m = String(dateRaw ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let yr = parseInt(m[3], 10);
  if (yr < 100) yr += 2000;
  return `${yr}-${String(+m[1]).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
}

export function activityMonth(dateRaw: string): string {
  const m = dateRaw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return "";
  const mm = String(parseInt(m[1], 10)).padStart(2, "0");
  let yr = parseInt(m[3], 10);
  if (yr < 100) yr += 2000;
  return `${yr}-${mm}`;
}

// Dunlop BLUE RESPONSE A/S is reported under the Falken Fanatic program even though
// JMK codes it brand "DUN". Match the specific MFG part numbers (OEA07V COL.MFG_ITEM_ID)
// for this line — 80 SKUs as of 2026-06-16. Other DUN tires are unaffected (they continue
// to the Dunlop sellout report only). New BLUE RESPONSE A/S sizes must be added here.
export const BLUE_RESPONSE_AS_FALKEN_PARTS = new Set<string>([
  "10021117", "10021123", "10021144", "10021159", "10021169", "10021207", "10021219",
  "10021237", "10021247", "10021274", "10021282", "10021301", "10021329", "10021373",
  "10021484", "10021552", "10021567", "10021569", "10021596", "10021606", "10021622",
  "10021639", "10021676", "10021721", "10021726", "10021735", "10021764", "10021875",
  "10021879", "10021909", "10021923", "10021954", "10021965", "10021969", "10022130",
  "10022147", "10022158", "10022207", "10022209", "10022254", "10022265", "10022267",
  "10022270", "10022278", "10022280", "10022288", "10022327", "10022379", "10022420",
  "10022453", "10022461", "10022502", "10022507", "10022513", "10022565", "10022577",
  "10022597", "10022637", "10022659", "10022750", "10022754", "10022756", "10022818",
  "10022847", "10022853", "10022856", "10022870", "10022889", "10022894", "10022899",
  "10022917", "10022931", "10022945", "10022974", "10022979", "10022997", "10024576",
  "10024617", "10024848", "10024980",
]);

// Which rebate program a row counts toward ("FAL" | "MIL"), or null if it is not a
// rebate-eligible tire row. Single source of truth for the brand rule so the live
// aggregate() and the client-side preview filter stay in sync.
export function rebateBrand(cols: string[]): "FAL" | "MIL" | null {
  const pt = (cols[COL.PRODUCT_TYPE] ?? "").trim();
  if (!pt.startsWith("T") || pt === "T") return null;
  const brand = (cols[COL.MFG_ID] ?? "").trim().toUpperCase();
  if (brand === "FAL") return "FAL";
  if (brand === "MIL") return "MIL";
  if (brand === "DUN" && BLUE_RESPONSE_AS_FALKEN_PARTS.has((cols[COL.MFG_ITEM_ID] ?? "").trim())) return "FAL";
  return null;
}

export function aggregate(csvText: string, dealers: RebateDealer[]): AggregateResult {
  const allRows = parsePositionalCSV(csvText);

  const filtered = allRows.filter(cols => rebateBrand(cols) !== null);

  const falkenByJmk: Record<string, RebateDealer[]> = {};
  const milestarByJmk: Record<string, RebateDealer> = {};
  for (const d of dealers) {
    if (!d.isActive) continue;
    const key = d.jmk.toLowerCase().trim();
    if (!key || key === "0" || key === "xxx") continue;
    if (d.programs.includes("falken")) (falkenByJmk[key] ??= []).push(d);
    if (d.programs.includes("milestar")) milestarByJmk[key] = d;
  }

  const falkenOut: OutputRow[] = [];
  const milestarOut: OutputRow[] = [];
  // key = `${jmk}|${id}|${month}`
  const falkenAgg = new Map<string, DealerMonthAgg>();
  const milestarAgg = new Map<string, DealerMonthAgg>();

  const bump = (map: Map<string, DealerMonthAgg>, base: Omit<DealerMonthAgg, "qty" | "rowCount">, qty: number) => {
    const k = `${base.jmk}|${base.fanaticId ?? base.dealerNumber ?? ""}|${base.month}`;
    const cur = map.get(k) ?? { ...base, qty: 0, rowCount: 0 };
    cur.qty += qty; cur.rowCount += 1;
    map.set(k, cur);
  };

  for (const cols of filtered) {
    const jmk = normalizeAcct(cols[COL.ACCOUNT_ID] ?? "");
    const invoice = (cols[COL.INV_ID] ?? "").trim();
    const dateRaw = (cols[COL.ACTIVITY_DATE] ?? "").trim();
    const month = activityMonth(dateRaw);
    const prog = rebateBrand(cols);
    const mfrPartNumber = (cols[COL.MFG_ITEM_ID] ?? "").trim();
    const rawAcct = (cols[COL.ACCOUNT_ID] ?? "").trim().toLowerCase();
    const isReturn = /^r\d{2}w\d{2}$/.test(rawAcct);
    const rawQty = parseFloat((cols[COL.QTY] ?? "0").trim()) || 0;
    const signedQty = isReturn ? rawQty : rawQty * -1;
    const qty = String(signedQty);
    const price = (cols[COL.SELL_PRICE] ?? "").trim();

    if (prog === "FAL" && falkenByJmk[jmk]) {
      for (const dealer of falkenByJmk[jmk]) {
        if (!dealer.fanaticId) continue;
        falkenOut.push({
          Falken_Distributor_Account_Number: IE_FALKEN.distributorAccount,
          FANATIC_Dealer_Account_Number: dealer.fanaticId,
          Distributor_Center_Address: IE_FALKEN.address, Distributor_Center_City: IE_FALKEN.city,
          Distributor_Center_State: IE_FALKEN.state, Distributor_Center_Postal_Code: IE_FALKEN.zip,
          Invoice_Number: invoice, SKU: mfrPartNumber, Date: dateRaw, Quantity: qty, Price_Per_Tire: price,
        });
        bump(falkenAgg, { jmk: dealer.jmk, name: dealer.name, fanaticId: dealer.fanaticId, month }, signedQty);
      }
    }
    if (prog === "MIL" && milestarByJmk[jmk]) {
      const dealer = milestarByJmk[jmk];
      if (dealer.dealerNumber) {
        milestarOut.push({
          ParentDistributorNumber: IE_MILESTAR.parentDistributor, DistributorCenterNumber: IE_MILESTAR.distributorCenter,
          DealerNumber: dealer.dealerNumber, InvoiceNumber: invoice, InvoiceDate: dateRaw,
          ProductCode: mfrPartNumber, Quantity: qty, SellPricePerTire: price,
        });
        bump(milestarAgg, { jmk: dealer.jmk, name: dealer.name, dealerNumber: dealer.dealerNumber, month }, signedQty);
      }
    }
  }

  const toProgram = (out: OutputRow[], agg: Map<string, DealerMonthAgg>): ProgramResult => {
    const breakdown = [...agg.values()];
    return {
      outRows: out, breakdown,
      matchedQty: breakdown.reduce((s, b) => s + b.qty, 0),
      matchedRows: breakdown.reduce((s, b) => s + b.rowCount, 0),
      dealersMatched: new Set(breakdown.map(b => b.jmk)).size,
    };
  };

  // Order by parsed calendar date, not by the raw MM/DD/YY string — see activityYMD.
  const dated = filtered
    .map(c => {
      const raw = (c[COL.ACTIVITY_DATE] ?? "").trim();
      return { raw, ymd: activityYMD(raw) };
    })
    .filter((d): d is { raw: string; ymd: string } => d.ymd !== null)
    .sort((a, b) => a.ymd.localeCompare(b.ymd));

  return {
    falken: toProgram(falkenOut, falkenAgg),
    milestar: toProgram(milestarOut, milestarAgg),
    totalInputRows: allRows.length,
    filteredRows: filtered.length,
    dateRangeStart: dated[0]?.raw,
    dateRangeEnd: dated[dated.length - 1]?.raw,
  };
}
