// Run: npx tsx lib/dealerRebates/dedup.test.ts
import { buildMonthlyRows } from "./dedup";
import type { RebateDealer } from "./aggregate";
import assert from "node:assert";

const dealers: RebateDealer[] = [
  { jmk: "125", name: "D1", fanaticId: 31489, programs: ["falken"], isActive: true },
];
const pad = (o: Record<number, string>) => { const a = Array(19).fill(""); for (const k in o) a[+k] = o[k]; return a.join(","); };
const sale = (sku: string, qty: string, inv: string, date: string) =>
  pad({ 3: "T1", 4: "FAL", 5: sku, 10: qty, 15: "125", 16: inv, 18: date });

// Same invoice line in two files (daily + re-export) → counted ONCE.
const fileA = ["H", sale("SKU1", "-4", "INV1", "05/07/26")].join("\n");
const fileB = ["H", sale("SKU1", "-4", "INV1", "05/07/26"), sale("SKU2", "-2", "INV2", "05/08/26")].join("\n");
let rows = buildMonthlyRows([{ csvText: fileA }, { csvText: fileB }], dealers, "2026-05");
let d1 = rows.find((r) => r.program === "falken")!;
assert.equal(d1.qty, 6, "dedup: 4 (INV1 once) + 2 (INV2) = 6"); // not 10

// Amended qty: same key, newer file wins.
const f1 = ["H", sale("SKU1", "-4", "INV1", "05/07/26")].join("\n");
const f2 = ["H", sale("SKU1", "-2", "INV1", "05/07/26")].join("\n");
rows = buildMonthlyRows([{ csvText: f1 }, { csvText: f2 }], dealers, "2026-05");
assert.equal(rows[0].qty, 2, "amendment: newest wins -> 2");

// Out-of-month lines excluded.
rows = buildMonthlyRows([{ csvText: ["H", sale("S", "-4", "I", "04/30/26")].join("\n") }], dealers, "2026-05");
assert.equal(rows.length, 0, "april line excluded from may");

console.log("OK: dedup.test.ts passed");
