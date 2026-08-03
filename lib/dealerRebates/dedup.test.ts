// Run: npx tsx lib/dealerRebates/dedup.test.ts
import { buildMonthlyRows, buildDedupedLines } from "./dedup";
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

// --- file/day-level dedup --------------------------------------------------
// Regression: dedup used to key on SKU|dealer|invoice|date and overwrite, which
// collapsed two legitimate lines for the same SKU on one invoice into one and
// under-reported tires. No column separates those rows, so resolution is per
// activity DAY at the file level instead: newest file reporting a day supplies
// all of its rows for that day.

// 1. Two identical lines in ONE file are both real and must both survive.
const twoLines = [sale("SKU1", "-3", "INV1", "07/01/26"), sale("SKU1", "-2", "INV1", "07/01/26")];
const oneFile = [{ csvText: ["H", ...twoLines].join("\n") }];
const r1 = buildDedupedLines(oneFile, dealers, "2026-07");
assert.equal(r1.falken.length, 2, "both same-SKU lines on one invoice survive");
assert.equal(
  r1.falken.reduce((s, x) => s + Number(x.Quantity), 0), 5,
  "quantity is 3+2, not collapsed to one line",
);
const m1 = buildMonthlyRows(oneFile, dealers, "2026-07");
assert.equal(m1[0].qty, 5, "monthly qty keeps both lines");
assert.equal(m1[0].rowCount, 2);

// 2. The SAME day re-reported by a newer file replaces it wholesale — no double count.
const older = { csvText: ["H", sale("SKU1", "-3", "INV1", "07/01/26")].join("\n") };
const newer = { csvText: ["H", sale("SKU1", "-4", "INV1", "07/01/26")].join("\n") };
const r2 = buildDedupedLines([older, newer], dealers, "2026-07");
assert.equal(r2.falken.length, 1, "one line, not two");
assert.equal(Number(r2.falken[0].Quantity), 4, "newest file's amended qty wins");

// 3. A day the newer file never mentions must NOT be erased.
const julyFirst = { csvText: ["H", sale("SKU1", "-3", "INV1", "07/01/26")].join("\n") };
const julyThirty = { csvText: ["H", sale("SKU9", "-1", "INV9", "07/30/26")].join("\n") };
const r3 = buildDedupedLines([julyFirst, julyThirty], dealers, "2026-07");
assert.equal(r3.falken.length, 2, "July 1 survives a later July 30 daily file");
assert.deepEqual(r3.falken.map(x => x.Date), ["07/01/26", "07/30/26"], "emitted in calendar order");

// 4. Out-of-month rows stay excluded.
const withJune = [{ csvText: ["H", sale("SKU1", "-3", "INV1", "06/12/26"), sale("SKU2", "-1", "INV2", "07/05/26")].join("\n") }];
const r4 = buildDedupedLines(withJune, dealers, "2026-07");
assert.equal(r4.falken.length, 1, "June row excluded from a July rebuild");
assert.equal(r4.falken[0].Date, "07/05/26");

console.log("OK: file/day dedup tests passed");
