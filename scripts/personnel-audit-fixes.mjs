// Apply the audit-flagged fixes Andy authorized 5/27:
//  - Clear stale terminationDate / terminationReason on active reactivated records
//  - Patch David Allgood + Emerson Long hireDate to XLSX values
//  - Send all "(none)" locationId records to Latrobe
//
// Run: set -a && source .env.prod && set +a
//      DRY_RUN=1 node scripts/personnel-audit-fixes.mjs   # preview
//      node scripts/personnel-audit-fixes.mjs              # live

import { ConvexHttpClient } from "convex/browser";

const DRY_RUN = !!process.env.DRY_RUN;
const ANDY = "jd711szqxd2fb870qa5cr92nts7xdxxh";

async function main() {
  const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
  const [personnel, locations] = await Promise.all([
    c.query("personnel:list", {}),
    c.query("locations:list"),
  ]);
  const locByName = new Map(locations.map((l) => [l.name.toLowerCase().trim(), l]));
  const latrobeId = locByName.get("latrobe")._id;

  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE WRITES"}`);
  console.log();

  // 1. Records with stale termination fields on active records
  const stale = personnel.filter(
    (p) => p.status === "active" && (p.terminationDate || p.terminationReason)
  );

  // 2. David Allgood hireDate fix
  const davidA = personnel.find((p) => p.firstName === "David" && /allgood/i.test(p.lastName));

  // 3. Emerson Long hireDate fix
  const emersonL = personnel.find((p) => p.firstName === "Emerson" && /long/i.test(p.lastName));

  // 4. Records with no location → Latrobe
  const noLoc = personnel.filter((p) => !p.locationId);

  console.log("PLAN");
  console.log(`  Clear stale terminationDate/Reason on ${stale.length} active records`);
  console.log(`  Patch David Allgood hireDate → 2025-08-01 (${davidA ? `id=${davidA._id}, currently ${davidA.hireDate}` : "NOT FOUND"})`);
  console.log(`  Patch Emerson Long hireDate → 2021-10-06 (${emersonL ? `id=${emersonL._id}, currently ${emersonL.hireDate}` : "NOT FOUND"})`);
  console.log(`  Set locationId → Latrobe on ${noLoc.length} records (${noLoc.filter(p=>p.status==="active").length} active, ${noLoc.filter(p=>p.status==="terminated").length} terminated)`);

  if (DRY_RUN) {
    console.log();
    console.log("DRY RUN — no writes performed.");
    return;
  }

  console.log();
  console.log("Applying…");
  let cleared = 0, patched = 0, located = 0, errors = 0;

  // Pass 1: clear stale termination fields (set to empty string — schema allows v.optional(v.string()))
  for (const p of stale) {
    try {
      await c.mutation("personnel:update", {
        personnelId: p._id,
        terminationDate: "",
        terminationReason: "",
        requestingUserId: ANDY,
      });
      cleared++;
    } catch (e) { errors++; console.error(`  clear ${p._id} (${p.firstName} ${p.lastName}):`, e.message); }
  }
  console.log(`  ✓ cleared stale termination fields on ${cleared}/${stale.length}`);

  // Pass 2: David Allgood hireDate
  if (davidA) {
    try {
      await c.mutation("personnel:update", {
        personnelId: davidA._id,
        hireDate: "2025-08-01",
        requestingUserId: ANDY,
      });
      patched++;
      console.log("  ✓ David Allgood hireDate → 2025-08-01");
    } catch (e) { errors++; console.error("  David Allgood:", e.message); }
  }

  // Pass 3: Emerson Long hireDate (location stays Corporate per Andy)
  if (emersonL) {
    try {
      await c.mutation("personnel:update", {
        personnelId: emersonL._id,
        hireDate: "2021-10-06",
        requestingUserId: ANDY,
      });
      patched++;
      console.log("  ✓ Emerson Long hireDate → 2021-10-06");
    } catch (e) { errors++; console.error("  Emerson Long:", e.message); }
  }

  // Pass 4: no-location records → Latrobe
  for (const p of noLoc) {
    try {
      await c.mutation("personnel:update", {
        personnelId: p._id,
        locationId: latrobeId,
        requestingUserId: ANDY,
      });
      located++;
    } catch (e) { errors++; console.error(`  loc ${p._id} (${p.firstName} ${p.lastName}):`, e.message); }
  }
  console.log(`  ✓ Latrobe assigned to ${located}/${noLoc.length} unlocated records`);

  console.log();
  console.log(`DONE — cleared=${cleared} patched=${patched} located=${located} errors=${errors}`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
