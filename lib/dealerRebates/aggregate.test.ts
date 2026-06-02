// lib/dealerRebates/aggregate.test.ts
// Run: npx tsx lib/dealerRebates/aggregate.test.ts
import { aggregate, activityMonth, type RebateDealer } from "./aggregate";
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
