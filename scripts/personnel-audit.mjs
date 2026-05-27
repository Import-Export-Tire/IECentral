// Audit Book2.xlsx against current Convex personnel. Read-only.
//   set -a && source .env.prod && set +a
//   node scripts/personnel-audit.mjs
//
// Reports:
//  - XLSX rows with no matching Convex record (truly missing)
//  - XLSX rows with hireDate or location disagreements
//  - Active Convex records absent from XLSX (potential mis-terminations / contractors)
//  - Convex records with suspicious data (empty key fields, location-code suffixes, weird casing)
//  - Duplicate names still present
//  - Termination-data quality red flags
//
// Goal: a concise list of things to fix manually.

import XLSX from "xlsx";
import { ConvexHttpClient } from "convex/browser";

const XLSX_PATH = "/Users/andybarrows/Downloads/Book2.xlsx";

const CLASS_TO_LOCATION_NAME = {
  "301-Admin": "Corporate",
  "R10-Everson": "Everson",
  "W07-Uniontown": "Uniontown",
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

function splitName(raw) {
  const s = String(raw || "").trim().replace(/\s+/g, " ");
  if (!s) return { firstName: "", lastName: "" };
  if (s.includes(",")) {
    let [lastPart, restPart = ""] = s.split(/,\s*/, 2);
    lastPart = lastPart.replace(/\s*\([^)]+\)\s*/g, " ").replace(/\s+/g, " ").trim();
    const lastName = lastPart;
    const restTokens = restPart.trim().split(" ").filter(Boolean);
    const suffixRe = /^(jr|sr|ii|iii|iv|v)\.?$/i;
    const cleaned = restTokens.filter((t) => !suffixRe.test(t));
    return { firstName: cleaned[0] || "", lastName };
  }
  const tokens = s.split(" ").filter(Boolean);
  if (tokens.length === 1) return { firstName: tokens[0], lastName: "" };
  return { firstName: tokens[0], lastName: tokens[tokens.length - 1] };
}

function lev(a, b) {
  if (!a) return (b || "").length;
  if (!b) return a.length;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  }
  return dp[m][n];
}

const norm = (s) => (s || "").toLowerCase().replace(/\s*\([^)]+\)\s*/g, " ").trim().replace(/\s+/g, " ");
const stripSuffix = (s) => (s || "").replace(/\s+(jr|sr|ii|iii|iv|v)\.?\s*$/i, "").trim();
const nameKey = (fn, ln) => `${norm(fn)}|${norm(stripSuffix(ln))}`;

async function main() {
  const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
  const [personnel, locations] = await Promise.all([
    c.query("personnel:list", {}),
    c.query("locations:list"),
  ]);
  const locById = new Map(locations.map((l) => [l._id, l]));
  const locByName = new Map(locations.map((l) => [l.name.toLowerCase().trim(), l]));

  // Parse XLSX
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
    const locName = CLASS_TO_LOCATION_NAME[cls];
    const locId = locName ? locByName.get(locName.toLowerCase())?._id : null;
    xlsxEntries.push({ firstName, lastName, key: nameKey(firstName, lastName), hireDate, cls, locName: locName || "(?)", locId, rawName: r[0] });
  }

  const xlsxByKey = new Map(xlsxEntries.map((e) => [e.key, e]));

  // Build personnel index by relaxed key (strip suffixes, normalize)
  const pByKey = new Map();
  for (const p of personnel) {
    const k = nameKey(p.firstName, p.lastName);
    if (!pByKey.has(k)) pByKey.set(k, []);
    pByKey.get(k).push(p);
  }

  // ── Section 1: XLSX rows with no Convex match (truly missing employees) ─
  const xlsxNoMatch = [];
  for (const e of xlsxEntries) {
    const list = pByKey.get(e.key) || [];
    if (list.length === 0) xlsxNoMatch.push(e);
  }

  // ── Section 2: XLSX rows with mismatched hireDate or location vs Convex ─
  const mismatches = [];
  for (const e of xlsxEntries) {
    const list = pByKey.get(e.key) || [];
    if (list.length === 0) continue;
    const p = list[0];
    const issues = [];
    if (e.hireDate && p.hireDate && e.hireDate !== p.hireDate) {
      issues.push(`hireDate: XLSX=${e.hireDate} vs DB=${p.hireDate}`);
    }
    if (e.locId && p.locationId && e.locId !== p.locationId) {
      issues.push(`location: XLSX=${e.locName} vs DB=${locById.get(p.locationId)?.name || "?"}`);
    }
    if (e.locId && !p.locationId) issues.push(`location: XLSX=${e.locName} vs DB=(none)`);
    if (e.hireDate && !p.hireDate) issues.push(`hireDate: XLSX=${e.hireDate} vs DB=(none)`);
    if (issues.length > 0) mismatches.push({ name: `${p.firstName} ${p.lastName}`, status: p.status, issues });
  }

  // ── Section 3: Active Convex records absent from XLSX ────────────────────
  const activeNotInXLSX = [];
  for (const p of personnel) {
    if (p.status !== "active") continue;
    const k = nameKey(p.firstName, p.lastName);
    if (!xlsxByKey.has(k)) activeNotInXLSX.push(p);
  }

  // ── Section 4: Convex records with suspicious data ───────────────────────
  const suspicious = [];
  for (const p of personnel) {
    const flags = [];
    if (!p.firstName || !p.lastName) flags.push("missing-name");
    if (p.status === "active" && !p.hireDate) flags.push("active-no-hireDate");
    if (p.status === "active" && !p.locationId) flags.push("active-no-location");
    if (/\([^)]+\)/.test(p.lastName || "")) flags.push("location-code-in-lastName");
    if (/\d/.test(p.firstName || "")) flags.push("digit-in-firstName");
    if (/[A-Z]{2,}/.test((p.firstName || "").slice(1) + (p.lastName || "").slice(1))) flags.push("internal-caps");
    if (p.status === "active" && p.terminationDate) flags.push("active-but-has-terminationDate");
    if (p.status === "active" && p.terminationReason) flags.push("active-but-has-terminationReason");
    if (flags.length > 0) suspicious.push({ id: p._id, name: `${p.firstName} ${p.lastName}`, status: p.status, flags });
  }

  // ── Section 5: Remaining duplicates by exact normalized key ──────────────
  const dupes = [];
  for (const [k, list] of pByKey) {
    if (list.length > 1) dupes.push({ key: k, count: list.length, names: list.map((p) => `${p.firstName} ${p.lastName} (${p.status})`) });
  }

  // ── Section 6: Fuzzy near-duplicate pairs not yet merged ─────────────────
  const fuzzyPairs = [];
  const all = personnel;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const af = norm(a.firstName), al = norm(stripSuffix(a.lastName));
      const bf = norm(b.firstName), bl = norm(stripSuffix(b.lastName));
      if (af === bf && al === bl) continue; // already in dupes
      const fdist = lev(af, bf);
      const ldist = lev(al, bl);
      if (fdist <= 1 && ldist <= 1 && fdist + ldist > 0) {
        fuzzyPairs.push(`${a.firstName} ${a.lastName} (${a.status}) ↔ ${b.firstName} ${b.lastName} (${b.status})`);
      } else if (af === bf && (al.startsWith(bl + " ") || bl.startsWith(al + " "))) {
        fuzzyPairs.push(`${a.firstName} ${a.lastName} (${a.status}) ↔ ${b.firstName} ${b.lastName} (${b.status})`);
      }
    }
  }

  // ── Section 7: Terminated records data quality ───────────────────────────
  const terms = personnel.filter((p) => p.status === "terminated");
  const termDateYears = new Map();
  let termsNoReason = 0, termsNoDate = 0, termsBadReason = 0;
  for (const t of terms) {
    const yr = (t.terminationDate || "").slice(0, 4) || "(none)";
    termDateYears.set(yr, (termDateYears.get(yr) || 0) + 1);
    if (!t.terminationReason) termsNoReason++;
    if (!t.terminationDate) termsNoDate++;
    if (t.terminationReason && /^\.+$|^[\s.]+$/.test(t.terminationReason)) termsBadReason++;
  }

  // ── Print report ─────────────────────────────────────────────────────────
  console.log("════════════════════════════════════════════════════════════════");
  console.log("PERSONNEL AUDIT — Book2.xlsx vs Convex");
  console.log("════════════════════════════════════════════════════════════════");
  console.log();
  console.log(`Convex: ${personnel.length} records (${personnel.filter(p=>p.status==="active").length} active, ${terms.length} terminated)`);
  console.log(`XLSX:   ${xlsxEntries.length} employee rows`);
  console.log();

  console.log(`─── XLSX rows with NO Convex match (${xlsxNoMatch.length}) ───────────`);
  if (xlsxNoMatch.length === 0) console.log("  (none)");
  for (const e of xlsxNoMatch) console.log(`  • ${e.firstName} ${e.lastName}  | hire=${e.hireDate || "?"}  | ${e.locName}`);
  console.log();

  console.log(`─── HireDate / Location mismatches (${mismatches.length}) ──────────`);
  if (mismatches.length === 0) console.log("  (none)");
  for (const m of mismatches) console.log(`  • ${m.name} (${m.status}): ${m.issues.join("; ")}`);
  console.log();

  console.log(`─── Active Convex records NOT in XLSX (${activeNotInXLSX.length}) ──`);
  if (activeNotInXLSX.length === 0) console.log("  (none)");
  for (const p of activeNotInXLSX) {
    const loc = p.locationId ? locById.get(p.locationId)?.name || "?" : "(none)";
    console.log(`  • ${p.firstName} ${p.lastName}  | hire=${p.hireDate || "?"}  | ${loc}`);
  }
  console.log();

  console.log(`─── Suspicious data flags (${suspicious.length}) ───────────────────`);
  if (suspicious.length === 0) console.log("  (none)");
  for (const s of suspicious.slice(0, 60)) console.log(`  • ${s.name} (${s.status})  [${s.flags.join(", ")}]`);
  if (suspicious.length > 60) console.log(`  … and ${suspicious.length - 60} more`);
  console.log();

  console.log(`─── Exact-name duplicates remaining (${dupes.length}) ──────────────`);
  if (dupes.length === 0) console.log("  (none)");
  for (const d of dupes) console.log(`  • ${d.names.join(" | ")}`);
  console.log();

  console.log(`─── Fuzzy near-duplicate pairs (${fuzzyPairs.length}) ──────────────`);
  if (fuzzyPairs.length === 0) console.log("  (none)");
  for (const p of fuzzyPairs) console.log(`  • ${p}`);
  console.log();

  console.log(`─── Termination data quality (${terms.length} terminated) ─────────`);
  console.log(`  Missing terminationReason: ${termsNoReason}`);
  console.log(`  Missing terminationDate:   ${termsNoDate}`);
  console.log(`  Junk terminationReason ("..." etc): ${termsBadReason}`);
  console.log(`  terminationDate by year:`);
  for (const [y, n] of [...termDateYears].sort()) console.log(`    ${y}: ${n}`);
  console.log();

  // ── Section 8: Terminations by location ─────────────────────────────────
  console.log(`─── Terminations by location (${terms.length} total) ──────────────`);
  const termsByLoc = new Map();
  const activeByLoc = new Map();
  for (const t of terms) {
    const lk = t.locationId ? locById.get(t.locationId)?.name || "?" : "(none)";
    termsByLoc.set(lk, (termsByLoc.get(lk) || 0) + 1);
  }
  for (const p of personnel.filter(x => x.status === "active")) {
    const lk = p.locationId ? locById.get(p.locationId)?.name || "?" : "(none)";
    activeByLoc.set(lk, (activeByLoc.get(lk) || 0) + 1);
  }
  const allLocs = new Set([...termsByLoc.keys(), ...activeByLoc.keys()]);
  const locStats = [];
  for (const loc of allLocs) {
    const t = termsByLoc.get(loc) || 0;
    const a = activeByLoc.get(loc) || 0;
    const tot = t + a;
    const rate = tot > 0 ? (t / tot) * 100 : 0;
    locStats.push({ loc, terms: t, active: a, total: tot, rate });
  }
  locStats.sort((a, b) => b.terms - a.terms);
  console.log("  " + "Location".padEnd(22) + "Terms  Active  Total  Term %");
  console.log("  " + "─".repeat(22) + "─────  ──────  ─────  ──────");
  for (const s of locStats) {
    console.log(`  ${s.loc.padEnd(22)}${String(s.terms).padStart(5)}${String(s.active).padStart(8)}${String(s.total).padStart(7)}${s.rate.toFixed(0).padStart(7)}%`);
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
