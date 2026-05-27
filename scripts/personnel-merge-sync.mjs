// One-shot personnel cleanup against Andy's Book2.xlsx.
//
// Usage:
//   set -a && source .env.prod && set +a
//   DRY_RUN=1 node scripts/personnel-merge-sync.mjs   # preview only
//   node scripts/personnel-merge-sync.mjs              # actually apply
//
// What it does:
//  1) Ensures a "Uniontown" location exists (creates if missing).
//  2) For every duplicate name group (same first+last, case-insensitive),
//     keeps the record with the most populated fields (tiebreak: oldest
//     createdAt). Hard-deletes the others via personnel.remove.
//  3) For each XLSX row, finds the surviving personnel record by name and
//     patches its hireDate + locationId from the spreadsheet.
//  4) Any ACTIVE personnel (after dedup) NOT present in the XLSX gets
//     terminated with today's date and reason "Not in 5/27 personnel sync".
//
// Requires super_admin requestingUserId (Andy: jd711szqxd2fb870qa5cr92nts7xdxxh).

import XLSX from "xlsx";
import { ConvexHttpClient } from "convex/browser";

const DRY_RUN = !!process.env.DRY_RUN;
const XLSX_PATH = "/Users/andybarrows/Downloads/Book2.xlsx";
const REQUESTING_USER_ID = "jd711szqxd2fb870qa5cr92nts7xdxxh";

const CLASS_TO_LOCATION_NAME = {
  "301-Admin": "Corporate",
  "R10-Everson": "Everson",
  "W07-Uniontown": "Uniontown",     // will be auto-created if missing
  "W08-Wholesale": "Latrobe",
  "WAR-Fastlane": "Latrobe",
  "WAR-Warehouse": "Latrobe",
};

function isoFromCell(v) {
  if (v == null) return "";
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let [, mo, da, yr] = m;
    let y = parseInt(yr); if (y < 100) y += 2000;
    return `${y}-${String(parseInt(mo)).padStart(2, "0")}-${String(parseInt(da)).padStart(2, "0")}`;
  }
  return s;
}

// "Last (W07), First MI" / "Last, First MI" / "Last, First" → { firstName, lastName }
function splitName(raw) {
  const s = String(raw || "").trim().replace(/\s+/g, " ");
  if (!s) return { firstName: "", lastName: "" };
  if (s.includes(",")) {
    let [lastPart, restPart = ""] = s.split(/,\s*/, 2);
    // Strip parenthesized location hints embedded in last name: "Clark (W07)"
    lastPart = lastPart.replace(/\s*\([^)]+\)\s*/g, " ").replace(/\s+/g, " ").trim();
    const lastName = lastPart;
    const restTokens = restPart.trim().split(" ").filter(Boolean);
    const suffixRe = /^(jr|sr|ii|iii|iv|v)\.?$/i;
    const cleaned = restTokens.filter((t) => !suffixRe.test(t));
    const firstName = cleaned[0] || "";
    return { firstName, lastName };
  }
  const tokens = s.split(" ").filter(Boolean);
  if (tokens.length === 1) return { firstName: tokens[0], lastName: "" };
  return { firstName: tokens[0], lastName: tokens[tokens.length - 1] };
}

function nameKey(firstName, lastName) {
  return `${(firstName || "").trim().toLowerCase()}|${(lastName || "").trim().toLowerCase()}`;
}

// Score how "filled in" a personnel record is — used to pick the keeper.
function dataScore(p) {
  const fields = ["email", "phone", "department", "position", "hireDate"];
  let s = 0;
  for (const f of fields) if (p[f] && String(p[f]).trim()) s++;
  if (p.locationId) s++;
  if (p.hourlyRate != null) s++;
  return s;
}

async function main() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    console.error("Set NEXT_PUBLIC_CONVEX_URL (source .env.prod first).");
    process.exit(1);
  }
  const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);

  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE WRITES"}`);
  console.log();

  // ─── 1. Ensure Uniontown location ────────────────────────────────────────
  let locations = await c.query("locations:list");
  const locByName = new Map(locations.map((l) => [l.name.toLowerCase().trim(), l]));
  if (!locByName.has("uniontown")) {
    if (DRY_RUN) {
      console.log("• Uniontown location missing — would create (simulating for plan).");
      // Simulate a Uniontown entry so the plan reflects what the live run will do.
      locByName.set("uniontown", { _id: "(would-be-created)", name: "Uniontown" });
    } else {
      console.log("• Uniontown location missing — creating.");
      const newId = await c.mutation("locations:create", {
        name: "Uniontown",
        locationType: "warehouse",
        requestingUserId: REQUESTING_USER_ID,
      });
      console.log(`  ✓ Created Uniontown (${newId})`);
      locations = await c.query("locations:list");
      locByName.clear();
      for (const l of locations) locByName.set(l.name.toLowerCase().trim(), l);
    }
  } else {
    console.log("• Uniontown location already exists.");
  }

  // class → locationId
  const classToLocId = {};
  for (const [cls, locName] of Object.entries(CLASS_TO_LOCATION_NAME)) {
    const loc = locByName.get(locName.toLowerCase().trim());
    classToLocId[cls] = loc ? loc._id : null;
    if (!loc) console.log(`  ⚠️  Class "${cls}" → location "${locName}" not found, will be skipped`);
  }

  // ─── 2. Parse XLSX ───────────────────────────────────────────────────────
  const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
  const ws = wb.Sheets["Sheet1"];
  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true, header: 1 });
  const xlsxEntries = [];
  for (let i = 1; i < rawRows.length; i++) {
    const r = rawRows[i];
    if (!r || !String(r[0] || "").trim()) continue;
    const { firstName, lastName } = splitName(r[0]);
    if (!firstName || !lastName) continue;
    const hireDate = isoFromCell(r[2]);
    const cls = String(r[4] || "").trim();
    const locationId = classToLocId[cls] || null;
    xlsxEntries.push({ firstName, lastName, key: nameKey(firstName, lastName), hireDate, cls, locationId });
  }
  console.log(`• XLSX: ${xlsxEntries.length} employee rows parsed`);

  const xlsxByKey = new Map(xlsxEntries.map((e) => [e.key, e]));

  // ─── 3. Load personnel and group by name ──────────────────────────────────
  const allPersonnel = await c.query("personnel:list", {});
  console.log(`• Personnel in Convex: ${allPersonnel.length}`);
  const byKey = new Map();
  for (const p of allPersonnel) {
    const k = nameKey(p.firstName, p.lastName);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(p);
  }

  // ─── 4. Dedup ────────────────────────────────────────────────────────────
  const toDelete = [];
  const survivors = new Map();
  for (const [k, list] of byKey) {
    if (list.length === 1) { survivors.set(k, list[0]); continue; }
    const sorted = [...list].sort((a, b) => {
      const ds = dataScore(b) - dataScore(a);
      if (ds !== 0) return ds;
      return a.createdAt - b.createdAt;
    });
    survivors.set(k, sorted[0]);
    for (const loser of sorted.slice(1)) toDelete.push(loser);
  }

  // ─── 5. Plan backfills from XLSX ─────────────────────────────────────────
  const backfills = [];
  const xlsxNotMatched = [];
  for (const e of xlsxEntries) {
    const survivor = survivors.get(e.key);
    if (!survivor) { xlsxNotMatched.push(e); continue; }
    const patch = {};
    if (e.hireDate && e.hireDate !== survivor.hireDate) patch.hireDate = e.hireDate;
    if (e.locationId && e.locationId !== survivor.locationId) patch.locationId = e.locationId;
    if (Object.keys(patch).length > 0) backfills.push({ id: survivor._id, patch });
  }

  // ─── 6. Plan terminations ────────────────────────────────────────────────
  const todayIso = new Date().toISOString().slice(0, 10);
  const toTerminate = [];
  for (const [k, p] of survivors) {
    if (p.status === "terminated") continue;
    if (!xlsxByKey.has(k)) toTerminate.push(p);
  }

  // ─── 7. Summary ──────────────────────────────────────────────────────────
  console.log();
  console.log("PLAN");
  console.log(`  Duplicate stubs to hard-delete:               ${toDelete.length}`);
  console.log(`  Records to backfill (hireDate / locationId): ${backfills.length}`);
  console.log(`  New records to insert (in XLSX, not in DB):  ${xlsxNotMatched.length}`);
  console.log(`  Active records to terminate (not in XLSX):   ${toTerminate.length}`);
  if (xlsxNotMatched.length > 0) {
    console.log("  New inserts:");
    for (const e of xlsxNotMatched) {
      console.log(`      • ${e.firstName} ${e.lastName} (${e.cls}, hire=${e.hireDate || "?"})`);
    }
  }

  if (DRY_RUN) {
    console.log();
    console.log("DRY RUN — no writes performed. Set DRY_RUN= (empty) to apply.");
    return;
  }

  // ─── 8. Apply ────────────────────────────────────────────────────────────
  console.log();
  console.log("Applying changes…");
  let deleted = 0, patched = 0, terminated = 0, errors = 0;

  for (const p of toDelete) {
    try {
      await c.mutation("personnel:remove", { personnelId: p._id, requestingUserId: REQUESTING_USER_ID });
      deleted++;
    } catch (e) {
      errors++;
      console.error(`  delete ${p._id} failed: ${e.message}`);
    }
  }
  console.log(`  ✓ Deleted ${deleted}/${toDelete.length} duplicates`);

  for (const b of backfills) {
    try {
      await c.mutation("personnel:update", { personnelId: b.id, ...b.patch, requestingUserId: REQUESTING_USER_ID });
      patched++;
    } catch (e) {
      errors++;
      console.error(`  patch ${b.id} failed: ${e.message}`);
    }
  }
  console.log(`  ✓ Backfilled ${patched}/${backfills.length} records`);

  // Insert XLSX rows that have no existing Convex match (new hires).
  let inserted = 0;
  for (const e of xlsxNotMatched) {
    try {
      await c.mutation("personnel:create", {
        firstName: e.firstName,
        lastName: e.lastName,
        email: "",
        phone: "",
        position: "",
        department: "",
        employeeType: "full_time",
        hireDate: e.hireDate || todayIso,
        ...(e.locationId ? { locationId: e.locationId } : {}),
        userId: REQUESTING_USER_ID,
        requestingUserId: REQUESTING_USER_ID,
      });
      inserted++;
    } catch (err) {
      errors++;
      console.error(`  insert ${e.firstName} ${e.lastName} failed: ${err.message}`);
    }
  }
  console.log(`  ✓ Inserted ${inserted}/${xlsxNotMatched.length} new records`);

  for (const p of toTerminate) {
    try {
      await c.mutation("personnel:terminate", {
        personnelId: p._id,
        terminationDate: todayIso,
        terminationReason: "Not in 5/27 personnel sync",
        userId: REQUESTING_USER_ID,
        requestingUserId: REQUESTING_USER_ID,
      });
      terminated++;
    } catch (e) {
      errors++;
      console.error(`  terminate ${p._id} failed: ${e.message}`);
    }
  }
  console.log(`  ✓ Terminated ${terminated}/${toTerminate.length} not-in-XLSX active records`);

  console.log();
  console.log(`DONE — deleted=${deleted} patched=${patched} terminated=${terminated} errors=${errors}`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
