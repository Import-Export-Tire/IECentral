// Targeted personnel corrections from Andy's 5/27 review:
// reactivate, relocate, and merge duplicate-name pairs that the prior
// XLSX-sync (firstName+lastName exact match) didn't catch.
//
// Usage: DRY_RUN=1 node scripts/personnel-corrections-2.mjs

import { ConvexHttpClient } from "convex/browser";

const DRY_RUN = !!process.env.DRY_RUN;
const ANDY = "jd711szqxd2fb870qa5cr92nts7xdxxh";

// (Name variants the user might use), target location name
// `insertIfMissing` → create the record if no match is found at all
const targets = [
  { names: ["Joshua Collier"],                       loc: "Kings Tire" },
  { names: ["Zachary Drexler", "Zach Drexler"],     loc: "Latrobe" },
  { names: ["Andrea Evans", "Annie Evans"],         loc: "Corporate" },
  { names: ["Theresa Lesofsky", "Teri Lesofsky"],   loc: "Corporate" },
  { names: ["Teddy Long"],                           loc: "Everson" },
  { names: ["Emerson Long IV", "Emerson Long"],     loc: "Corporate" },
  { names: ["Greg Mohrhang", "Greg Mohrong"],       loc: "Latrobe",   insertIfMissing: true },
  { names: ["Timothy Myers"],                       loc: "Jeanette - Retail" },
  { names: ["Terry Myers"],                         loc: "Corporate" },
  { names: ["Debbie Myers"],                        loc: "Corporate" },
  { names: ["Nicholas Quinn", "Nick Quinn"],        loc: "Latrobe" },
  { names: ["Brittney Spitznogle"],                 loc: "Latrobe" },
  { names: ["Chase Stouffer"],                      loc: "Latrobe" },
  { names: ["Robert Waldron", "Rob Waldron"],       loc: "Latrobe" },
  { names: ["Jonathon Weimer", "Jonathan Weimer", "Johnathan Weimer"], loc: "Export Tire", insertIfMissing: true },
];

function nameMatches(p, candidates) {
  return candidates.some((c) => {
    const [tf, ...tlParts] = c.toLowerCase().split(" ");
    const tl = tlParts.join(" ");
    return (
      (p.firstName || "").toLowerCase().startsWith(tf) &&
      (p.lastName || "").toLowerCase().includes(tl)
    );
  });
}

function dataScore(p) {
  const fields = ["email", "phone", "department", "position", "hireDate"];
  let s = 0;
  for (const f of fields) if (p[f] && String(p[f]).trim()) s++;
  if (p.locationId) s++;
  if (p.hourlyRate != null) s++;
  if (p.notes) s++;
  return s;
}

async function main() {
  const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE WRITES"}`);
  console.log();

  const [personnel, locations] = await Promise.all([
    c.query("personnel:list", {}),
    c.query("locations:list"),
  ]);
  const locByName = new Map(locations.map((l) => [l.name.toLowerCase().trim(), l]));

  const plan = []; // { kind: 'merge'|'reactivate'|'patch-loc'|'insert', ...details }

  for (const t of targets) {
    const locId = locByName.get(t.loc.toLowerCase().trim())?._id;
    if (!locId) { console.log(`⚠️  Location "${t.loc}" not found — skipping ${t.names[0]}`); continue; }
    const matches = personnel.filter((p) => nameMatches(p, t.names));

    if (matches.length === 0) {
      if (t.insertIfMissing) {
        plan.push({ kind: "insert", name: t.names[0], locId, locName: t.loc });
      } else {
        plan.push({ kind: "missing", name: t.names[0], locName: t.loc });
      }
      continue;
    }

    if (matches.length === 1) {
      const p = matches[0];
      const needsReactivate = p.status === "terminated";
      const needsLoc = p.locationId !== locId;
      if (needsReactivate || needsLoc) {
        plan.push({ kind: "patch", id: p._id, name: `${p.firstName} ${p.lastName}`, reactivate: needsReactivate, locId, locName: t.loc });
      }
      continue;
    }

    // Multiple matches → merge: keep highest data score, tiebreak oldest createdAt
    const sorted = [...matches].sort((a, b) => {
      const ds = dataScore(b) - dataScore(a);
      if (ds !== 0) return ds;
      return a.createdAt - b.createdAt;
    });
    const keeper = sorted[0];
    const losers = sorted.slice(1);
    plan.push({
      kind: "merge",
      keeperId: keeper._id,
      keeperName: `${keeper.firstName} ${keeper.lastName} (${keeper.status})`,
      loserIds: losers.map((l) => l._id),
      loserNames: losers.map((l) => `${l.firstName} ${l.lastName} (${l.status})`),
      reactivate: keeper.status === "terminated",
      locId,
      locName: t.loc,
    });
  }

  console.log("PLAN:");
  for (const step of plan) {
    if (step.kind === "missing") console.log(`  ⚠️  Not found, will skip:  ${step.name} (would be → ${step.locName})`);
    else if (step.kind === "insert") console.log(`  +   INSERT new record:     ${step.name} → ${step.locName}`);
    else if (step.kind === "patch") console.log(`      PATCH ${step.id}: ${step.name} → ${step.locName}${step.reactivate ? " + reactivate" : ""}`);
    else if (step.kind === "merge") {
      console.log(`      MERGE ${step.keeperName.padEnd(40)} → ${step.locName}${step.reactivate ? " + reactivate" : ""}`);
      for (let i = 0; i < step.loserIds.length; i++) {
        console.log(`        del ${step.loserIds[i]} | ${step.loserNames[i]}`);
      }
    }
  }

  if (DRY_RUN) {
    console.log();
    console.log("DRY RUN — no writes performed.");
    return;
  }

  console.log();
  console.log("Applying…");
  let merged = 0, patched = 0, inserted = 0, errors = 0;
  for (const step of plan) {
    try {
      if (step.kind === "missing") continue;
      if (step.kind === "insert") {
        await c.mutation("personnel:create", {
          firstName: step.name.split(" ")[0],
          lastName: step.name.split(" ").slice(1).join(" "),
          email: "",
          phone: "",
          position: "",
          department: "",
          employeeType: "full_time",
          hireDate: new Date().toISOString().slice(0, 10),
          locationId: step.locId,
          userId: ANDY,
          requestingUserId: ANDY,
        });
        inserted++;
      } else if (step.kind === "patch") {
        const upd = { personnelId: step.id, locationId: step.locId, requestingUserId: ANDY };
        if (step.reactivate) upd.status = "active";
        await c.mutation("personnel:update", upd);
        patched++;
      } else if (step.kind === "merge") {
        const upd = { personnelId: step.keeperId, locationId: step.locId, requestingUserId: ANDY };
        if (step.reactivate) upd.status = "active";
        await c.mutation("personnel:update", upd);
        for (const id of step.loserIds) {
          await c.mutation("personnel:remove", { personnelId: id, requestingUserId: ANDY });
        }
        merged++;
      }
    } catch (e) {
      errors++;
      console.error(`  ✗ ${step.kind}:`, e.message);
    }
  }

  console.log();
  console.log(`DONE — merged=${merged} patched=${patched} inserted=${inserted} errors=${errors}`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
