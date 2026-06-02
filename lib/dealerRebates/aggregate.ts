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

function parseCSVRow(line: string): string[] {
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
export function activityMonth(dateRaw: string): string {
  const m = dateRaw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return "";
  const mm = String(parseInt(m[1], 10)).padStart(2, "0");
  let yr = parseInt(m[3], 10);
  if (yr < 100) yr += 2000;
  return `${yr}-${mm}`;
}

export function aggregate(csvText: string, dealers: RebateDealer[]): AggregateResult {
  const allRows = parsePositionalCSV(csvText);

  const filtered = allRows.filter(cols => {
    const pt = (cols[COL.PRODUCT_TYPE] ?? "").trim();
    if (!pt.startsWith("T") || pt === "T") return false;
    const brand = (cols[COL.MFG_ID] ?? "").trim().toUpperCase();
    return brand === "FAL" || brand === "MIL";
  });

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
    const brand = (cols[COL.MFG_ID] ?? "").trim().toUpperCase();
    const mfrPartNumber = (cols[COL.MFG_ITEM_ID] ?? "").trim();
    const rawAcct = (cols[COL.ACCOUNT_ID] ?? "").trim().toLowerCase();
    const isReturn = /^r\d{2}w\d{2}$/.test(rawAcct);
    const rawQty = parseFloat((cols[COL.QTY] ?? "0").trim()) || 0;
    const signedQty = isReturn ? rawQty : rawQty * -1;
    const qty = String(signedQty);
    const price = (cols[COL.SELL_PRICE] ?? "").trim();

    if (brand === "FAL" && falkenByJmk[jmk]) {
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
    if (brand === "MIL" && milestarByJmk[jmk]) {
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

  const allDates = filtered.map(c => (c[COL.ACTIVITY_DATE] ?? "").trim()).filter(Boolean).sort();
  return {
    falken: toProgram(falkenOut, falkenAgg),
    milestar: toProgram(milestarOut, milestarAgg),
    totalInputRows: allRows.length,
    filteredRows: filtered.length,
    dateRangeStart: allDates[0],
    dateRangeEnd: allDates[allDates.length - 1],
  };
}
