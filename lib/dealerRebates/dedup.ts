// lib/dealerRebates/dedup.ts
// Build deduped per-(program, dealer) monthly rows from a set of OEA07V files.
// Dedups matched invoice-lines by SKU/ProductCode + dealer-id + invoice + date
// (newest file wins on an amended qty), keeping only lines in the target month.
import { aggregate, activityMonth, type RebateDealer } from "./aggregate";

export interface MonthlyRow {
  program: string; jmk: string; name: string;
  fanaticId?: number; dealerNumber?: string; qty: number; rowCount: number;
}

function lineKey(program: string, r: Record<string, string | number>): string {
  if (program === "falken")
    return `f|${r.SKU}|${r.FANATIC_Dealer_Account_Number}|${r.Invoice_Number}|${r.Date}`;
  return `m|${r.ProductCode}|${r.DealerNumber}|${r.InvoiceNumber}|${r.InvoiceDate}`;
}
function lineDate(program: string, r: Record<string, string | number>): string {
  return String(program === "falken" ? r.Date : r.InvoiceDate);
}

// files: oldest→newest (newest wins on a duplicate key).
export function buildMonthlyRows(
  files: { csvText: string }[],
  dealers: RebateDealer[],
  targetMonth: string, // "YYYY-MM"
): MonthlyRow[] {
  const seen = new Map<string, { program: string; qty: number; jmk: string; name: string; fanaticId?: number; dealerNumber?: string }>();
  for (const f of files) {
    const res = aggregate(f.csvText, dealers);
    for (const prog of ["falken", "milestar"] as const) {
      const pr = res[prog];
      const metaById = new Map<string, { jmk: string; name: string; fanaticId?: number; dealerNumber?: string }>();
      for (const b of pr.breakdown) {
        const id = prog === "falken" ? String(b.fanaticId ?? "") : String(b.dealerNumber ?? "");
        metaById.set(id, { jmk: b.jmk, name: b.name, fanaticId: b.fanaticId, dealerNumber: b.dealerNumber });
      }
      for (const row of pr.outRows) {
        if (activityMonth(lineDate(prog, row)) !== targetMonth) continue;
        const id = String(prog === "falken" ? row.FANATIC_Dealer_Account_Number : row.DealerNumber);
        const meta = metaById.get(id);
        if (!meta) continue;
        const qty = parseFloat(String(row.Quantity)) || 0;
        seen.set(lineKey(prog, row), { program: prog, qty, ...meta }); // last (newest) wins
      }
    }
  }
  const agg = new Map<string, MonthlyRow>();
  for (const v of seen.values()) {
    const k = `${v.program}|${v.jmk}|${v.fanaticId ?? v.dealerNumber ?? ""}`;
    const cur = agg.get(k) ?? { program: v.program, jmk: v.jmk, name: v.name, fanaticId: v.fanaticId, dealerNumber: v.dealerNumber, qty: 0, rowCount: 0 };
    cur.qty += v.qty; cur.rowCount += 1;
    agg.set(k, cur);
  }
  return [...agg.values()];
}
