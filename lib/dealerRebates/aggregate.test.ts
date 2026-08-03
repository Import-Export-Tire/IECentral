// lib/dealerRebates/aggregate.test.ts
// Run: npx tsx lib/dealerRebates/aggregate.test.ts
import { aggregate, activityMonth, activityYMD, type RebateDealer } from "./aggregate";
import assert from "node:assert";

assert.equal(activityMonth("03/31/26"), "2026-03");
assert.equal(activityMonth("4/1/2026"), "2026-04");
assert.equal(activityMonth(""), "");

const dealers: RebateDealer[] = [
  { jmk: "125", name: "Test Falken", fanaticId: 31489, programs: ["falken"], isActive: true },
  { jmk: "r20", name: "Test Milestar", dealerNumber: "21008", programs: ["milestar"], isActive: true },
];
// header row + 3 data rows. Columns padded to index 18 (ACTIVITY_DATE).
const pad = (o: Record<number, string>) => { const a = Array(19).fill(""); for (const k in o) a[+k] = o[k]; return a.join(","); };
const csv = [
  "HEADER",
  pad({ 3: "T1", 4: "FAL", 5: "SKU1", 10: "-4", 15: "125", 16: "INV1", 18: "03/15/26" }), // sale 4 tires
  pad({ 3: "T1", 4: "FAL", 5: "SKU2", 10: "-2", 15: "0125", 16: "INV2", 18: "04/02/26" }), // leading-zero acct, April
  pad({ 3: "T1", 4: "MIL", 5: "SKU3", 10: "-8", 15: "r20", 16: "INV3", 18: "04/05/26" }), // milestar 8 tires
].join("\n");

const r = aggregate(csv, dealers);
assert.equal(r.falken.matchedQty, 6, "falken qty 4+2");
assert.equal(r.falken.matchedRows, 2, "falken 2 lines");
assert.equal(r.milestar.matchedQty, 8, "milestar qty");
const marchFal = r.falken.breakdown.find(b => b.month === "2026-03");
const aprFal = r.falken.breakdown.find(b => b.month === "2026-04");
assert.equal(marchFal?.qty, 4); assert.equal(aprFal?.qty, 2);
console.log("OK: aggregate.test.ts passed");

// --- activityYMD -----------------------------------------------------------
assert.equal(activityYMD("03/15/26"), "2026-03-15");
assert.equal(activityYMD("6/12/26"), "2026-06-12", "unpadded month/day");
assert.equal(activityYMD("12/31/2025"), "2025-12-31", "4-digit year");
assert.equal(activityYMD(""), null);
assert.equal(activityYMD("not a date"), null);

// --- dateRange must order chronologically, not lexicographically -----------
// Regression: a raw MM/DD/YY string sort put "6/12/26" AFTER "07/01/26" (because
// "6" > "0") and inverted any range crossing a year boundary. The bad ordering fed
// the S3 output filename, so a month-spanning upload silently overwrote the
// submission file for whichever day sorted first.
const rangeDealers: RebateDealer[] = [
  { jmk: "125", name: "Test Falken", fanaticId: 31489, programs: ["falken"], isActive: true },
];
const rangeCSV = (dates: string[]) =>
  ["HEADER", ...dates.map((d, i) =>
    pad({ 3: "T1", 4: "FAL", 5: `SKU${i}`, 10: "-1", 15: "125", 16: `INV${i}`, 18: d }),
  )].join("\n");

// Unpadded month sorts wrong as a string; must still report Jun 12 -> Jul 31.
const unpadded = aggregate(rangeCSV(["07/01/26", "6/12/26", "07/31/26"]), rangeDealers);
assert.equal(unpadded.dateRangeStart, "6/12/26", "earliest is June 12, not July 1");
assert.equal(unpadded.dateRangeEnd, "07/31/26", "latest is July 31");

// Crossing a year boundary must not invert.
const crossYear = aggregate(rangeCSV(["01/05/26", "12/15/25"]), rangeDealers);
assert.equal(crossYear.dateRangeStart, "12/15/25", "Dec 2025 precedes Jan 2026");
assert.equal(crossYear.dateRangeEnd, "01/05/26");

// Single-day file: start === end.
const oneDay = aggregate(rangeCSV(["07/30/26", "07/30/26"]), rangeDealers);
assert.equal(oneDay.dateRangeStart, "07/30/26");
assert.equal(oneDay.dateRangeEnd, "07/30/26");

console.log("OK: activityYMD + dateRange ordering tests passed");
