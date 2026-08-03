// lib/dealerRebates/dedup.ts
// Build deduped per-(program, dealer) monthly rows from a set of OEA07V files.
//
// Dedup is resolved per ACTIVITY DAY at the FILE level, not per invoice-line.
// For each day, the newest file that reports that day supplies ALL of its rows
// for it; older files' rows for the same day are discarded wholesale.
//
// Why not a row-level key: it cannot work. The previous implementation keyed on
// SKU + dealer-id + invoice + date and did `seen.set(key, row)`, which silently
// dropped legitimate repeat invoice lines — a dealer buying the same SKU twice on
// one invoice (e.g. a 3-tire line and a 2-tire line) collapsed to one line, so
// tires went unreported to Falken. In July 2026 that lost 6 tires (1004 reported
// vs 1010 actual). Measured against the real July feed, 627 key-collision groups
// existed and NO available column separates them: ITEM_ID is byte-identical for
// 565 of them, and ITEM_ID + SELL_PRICE together resolve only 97 of 627. A
// genuine second line and a re-uploaded copy of the first are the same bytes, so
// the only thing that distinguishes them is which file they came from — which is
// what this file-and-day resolution uses.
import { aggregate, activityMonth, activityYMD, type RebateDealer, type OutputRow } from "./aggregate";

export interface MonthlyRow {
  program: string; jmk: string; name: string;
  fanaticId?: number; dealerNumber?: string; qty: number; rowCount: number;
}

type DealerMeta = { jmk: string; name: string; fanaticId?: number; dealerNumber?: string };
type Resolved = { row: OutputRow; meta?: DealerMeta };

function lineDate(program: string, r: Record<string, string | number>): string {
  return String(program === "falken" ? r.Date : r.InvoiceDate);
}

/**
 * Resolve which rows count for each activity day, given files ordered oldest→newest.
 *
 * A day present in a newer file replaces that day entirely. A day the newer file
 * does not mention is left alone — silence about a day is not a statement that the
 * day is empty (a July 30 daily file says nothing about July 1).
 */
function resolveByDay(
  files: { csvText: string }[],
  dealers: RebateDealer[],
  targetMonth: string,
): Record<"falken" | "milestar", Map<string, Resolved[]>> {
  const out = {
    falken: new Map<string, Resolved[]>(),
    milestar: new Map<string, Resolved[]>(),
  };

  for (const f of files) {
    const res = aggregate(f.csvText, dealers);

    for (const prog of ["falken", "milestar"] as const) {
      const pr = res[prog];

      const metaById = new Map<string, DealerMeta>();
      for (const b of pr.breakdown) {
        const id = prog === "falken" ? String(b.fanaticId ?? "") : String(b.dealerNumber ?? "");
        metaById.set(id, { jmk: b.jmk, name: b.name, fanaticId: b.fanaticId, dealerNumber: b.dealerNumber });
      }

      // Bucket this file's rows by day first, so a day is replaced as a whole unit.
      const perDay = new Map<string, Resolved[]>();
      for (const row of pr.outRows) {
        const raw = lineDate(prog, row);
        if (activityMonth(raw) !== targetMonth) continue;
        const day = activityYMD(raw);
        if (!day) continue;
        const id = String(prog === "falken" ? row.FANATIC_Dealer_Account_Number : row.DealerNumber);
        const entry: Resolved = { row, meta: metaById.get(id) };
        const bucket = perDay.get(day);
        if (bucket) bucket.push(entry);
        else perDay.set(day, [entry]);
      }

      for (const [day, rows] of perDay) out[prog].set(day, rows);
    }
  }

  return out;
}

// files: oldest→newest (newest wins on a duplicate key).
export function buildMonthlyRows(
  files: { csvText: string }[],
  dealers: RebateDealer[],
  targetMonth: string, // "YYYY-MM"
): MonthlyRow[] {
  const byDay = resolveByDay(files, dealers, targetMonth);
  const agg = new Map<string, MonthlyRow>();

  for (const prog of ["falken", "milestar"] as const) {
    for (const rows of byDay[prog].values()) {
      for (const { row, meta } of rows) {
        if (!meta) continue;
        const qty = parseFloat(String(row.Quantity)) || 0;
        const k = `${prog}|${meta.jmk}|${meta.fanaticId ?? meta.dealerNumber ?? ""}`;
        const cur = agg.get(k) ?? {
          program: prog, jmk: meta.jmk, name: meta.name,
          fanaticId: meta.fanaticId, dealerNumber: meta.dealerNumber, qty: 0, rowCount: 0,
        };
        cur.qty += qty; cur.rowCount += 1;
        agg.set(k, cur);
      }
    }
  }

  return [...agg.values()];
}

// Deduped matched OUTPUT rows for a target month, per program — used to regenerate the
// daily portal-submission CSVs. Same dedup as buildMonthlyRows (newest file wins), returns rows.
export function buildDedupedLines(
  files: { csvText: string }[],
  dealers: RebateDealer[],
  targetMonth: string,
): { falken: OutputRow[]; milestar: OutputRow[] } {
  const byDay = resolveByDay(files, dealers, targetMonth);
  const falken: OutputRow[] = [], milestar: OutputRow[] = [];

  for (const prog of ["falken", "milestar"] as const) {
    const sink = prog === "falken" ? falken : milestar;
    // Emit days in calendar order so regenerated CSVs are stable across runs.
    for (const day of [...byDay[prog].keys()].sort()) {
      for (const { row } of byDay[prog].get(day)!) sink.push(row);
    }
  }

  return { falken, milestar };
}
