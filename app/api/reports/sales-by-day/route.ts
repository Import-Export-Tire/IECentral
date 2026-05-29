import { NextRequest, NextResponse } from "next/server";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";

const BUCKET = "ietires-dunlop-jmk-uploads";

const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }
    : {}),
});

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { current.push(field.trim()); field = ""; }
      else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
        current.push(field.trim()); field = "";
        if (current.some(f => f)) rows.push(current);
        current = [];
        if (ch === "\r") i++;
      } else if (ch === "\r") {
        current.push(field.trim()); field = "";
        if (current.some(f => f)) rows.push(current);
        current = [];
      } else field += ch;
    }
  }
  if (field || current.length > 0) {
    current.push(field.trim());
    if (current.some(f => f)) rows.push(current);
  }
  return rows;
}

function parseActivityDate(dateStr: string): { iso: string; month: string } | null {
  const clean = dateStr.replace(/"/g, "").trim();
  const m = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, mm, dd, yy] = m;
  let y = parseInt(yy);
  if (y < 100) y += 2000;
  const mNum = parseInt(mm);
  const dNum = parseInt(dd);
  if (mNum < 1 || mNum > 12 || dNum < 1 || dNum > 31) return null;
  const iso = `${y}-${String(mNum).padStart(2, "0")}-${String(dNum).padStart(2, "0")}`;
  return { iso, month: `${y}-${String(mNum).padStart(2, "0")}` };
}

// OEA07V columns we use here:
//   0  ItemId           4  Brand          8  Location       9  Transaction
//  10  Qty             12  ExtCost       15  Account       16  Invoice
//   3  ProductType     18  ActivityDate
type Cell = number; // qty or dollars

interface BucketKey {
  date: string;     // ISO YYYY-MM-DD or week/month bucket key
  location: string; // store code, uppercase
}

function bucketDate(iso: string, granularity: "day" | "week" | "month"): string {
  if (granularity === "day") return iso;
  if (granularity === "month") return iso.slice(0, 7);
  // week: ISO Monday-based week start label as YYYY-MM-DD
  const d = new Date(iso + "T00:00:00");
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * GET /api/reports/sales-by-day
 *
 * Aggregates OEA07V daily CSVs into per-day-per-location sales totals.
 * Returns parallel series for tires (qty) and dollars (extCost).
 *
 * Query params:
 *   startDate    YYYY-MM-DD (inclusive) — optional, defaults to 30 days ago
 *   endDate      YYYY-MM-DD (inclusive) — optional, defaults to today
 *   locations    comma-separated location codes, or empty for all
 *   brand        single brand code filter (optional)
 *   granularity  "day" | "week" | "month" (default "day")
 *   includeVendorReturns  "true" to include W4490/R1234-style supplier RAs
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const today = new Date();
    const fmtIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const defaultEnd = fmtIso(today);
    const ago = new Date(today); ago.setDate(ago.getDate() - 30);
    const defaultStart = fmtIso(ago);

    const startDate = (searchParams.get("startDate") || defaultStart).slice(0, 10);
    const endDate = (searchParams.get("endDate") || defaultEnd).slice(0, 10);
    const locationsParam = (searchParams.get("locations") || "").trim();
    const filterLocations = new Set(
      locationsParam ? locationsParam.split(",").map(s => s.trim().toUpperCase()).filter(Boolean) : []
    );
    const filterBrand = (searchParams.get("brand") || "").trim().toUpperCase();
    const granularity = ((searchParams.get("granularity") || "day").toLowerCase()) as "day" | "week" | "month";
    const includeVendorReturns = searchParams.get("includeVendorReturns") === "true";
    // Default true: bare R20 / INV-* / 99-* Sld rows are real store sales
    // (per Andy 5/27). Pass ?includeInternalAccounts=false to revert.
    const includeInternalAccounts = (searchParams.get("includeInternalAccounts") ?? "true") !== "false";
    // Diagnostic mode: when set to a location code (e.g. ?diagnoseLocation=R20),
    // return an unfiltered breakdown of transaction codes + qty signs at that
    // location instead of the normal aggregated series. Use for debugging
    // unexpected net negatives or missing sales.
    const diagnoseLocation = (searchParams.get("diagnoseLocation") || "").trim().toUpperCase();

    // Identify month folders that overlap the date range so we only download
    // CSVs we actually need.
    const startMonth = startDate.slice(0, 7);
    const endMonth = endDate.slice(0, 7);

    const allFiles: { key: string; month: string; lastModified: Date }[] = [];
    const listRes = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: "jmk-uploads/", MaxKeys: 1000 }));
    for (const obj of listRes.Contents || []) {
      if (!obj.Key || !obj.LastModified) continue;
      const keyLower = obj.Key.toLowerCase();
      if (!keyLower.includes("iet-oea07v") || !keyLower.endsWith(".csv")) continue;
      const monthMatch = obj.Key.match(/jmk-uploads\/(\d{6})\//);
      if (!monthMatch) continue;
      const yyyymm = monthMatch[1];
      const month = `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}`;
      if (month < startMonth || month > endMonth) continue;
      allFiles.push({ key: obj.Key, month, lastModified: obj.LastModified });
    }

    if (allFiles.length === 0) {
      return NextResponse.json({
        series: [],
        locations: [],
        totals: { dollars: 0, tires: 0 },
        perLocation: [],
        startDate, endDate, granularity,
      });
    }

    // Per-month: prefer the monthly-combined / named-month file if present.
    const monthName = (yyyymm: string) =>
      ["january","february","march","april","may","june","july","august","september","october","november","december"][parseInt(yyyymm.split("-")[1], 10) - 1];
    const isMonthlyForMonth = (key: string, monthFolder: string) => {
      // Check the BASENAME only — earlier versions checked the full path,
      // which always matched the YYYYMM folder name (e.g. "202605"), so
      // every daily file looked like the monthly-combined and only the
      // most-recently-uploaded one got processed. That dropped 25+ daily
      // files for any month with a Michael-style named summary or just
      // routine daily uploads.
      const basename = (key.split("/").pop() || "").toLowerCase();
      if (basename.includes("monthly-combined")) return true;
      const name = monthName(monthFolder);
      const abbr = name.slice(0, 3);
      // Match a named monthly file like "may 2026.csv" but NOT a daily
      // file like "iet-oea07v_051526.csv" — require the month name to be
      // surrounded by non-digit boundaries.
      const nameRe = new RegExp(`(^|[^a-z])${name}([^a-z]|$)`);
      return nameRe.test(basename);
    };
    const filesByMonthFolder = new Map<string, typeof allFiles>();
    for (const f of allFiles) {
      const list = filesByMonthFolder.get(f.month) || [];
      list.push(f);
      filesByMonthFolder.set(f.month, list);
    }
    const workingFiles: typeof allFiles = [];
    for (const [folder, group] of filesByMonthFolder) {
      const monthly = group.filter((f) => isMonthlyForMonth(f.key, folder)).sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
      if (monthly[0]) workingFiles.push(monthly[0]);
      else workingFiles.push(...group);
    }
    workingFiles.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

    // Aggregation buckets.
    const tireMap = new Map<string, number>();     // `${bucket}|${loc}` → tires
    const dollarMap = new Map<string, number>();   // `${bucket}|${loc}` → dollars
    const seenLocations = new Set<string>();
    const seenBuckets = new Set<string>();
    const seenDedup = new Set<string>();
    let totalDollars = 0;
    let totalTires = 0;

    // Per-location running totals — for the picker + summary
    const locTotalsTires = new Map<string, number>();
    const locTotalsDollars = new Map<string, number>();

    // Diagnostic accumulator (only populated when diagnoseLocation is set).
    // Records the raw transaction-code + qty-sign mix at the target location
    // BEFORE any filters are applied, so we can see exactly what's there.
    const diag = {
      enabled: !!diagnoseLocation,
      rowsAtLoc: 0,
      byTrn: new Map<string, { rows: number; sumQty: number; sumExtCost: number }>(),
      byTrnAndSign: new Map<string, { positive: number; negative: number; zero: number }>(),
      byBrandAtLoc: new Map<string, { rows: number; sumQty: number }>(),
      byBrandAndTrn: new Map<string, { rows: number; sumQty: number }>(),
      acctPatterns: new Map<string, number>(),
      productTypes: new Map<string, number>(),
      sampleRowsAfterFilter: [] as { activityDate: string; transaction: string; brand: string; qty: number; extCost: number; acct: string }[],
    };

    const CONCURRENCY = 8;
    for (let i = 0; i < workingFiles.length; i += CONCURRENCY) {
      const batch = workingFiles.slice(i, i + CONCURRENCY);
      const fetched = await Promise.all(batch.map(async (f) => {
        try {
          const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: f.key }));
          const b = await r.Body?.transformToString("utf-8");
          return { file: f, body: b || "" };
        } catch { return { file: f, body: "" }; }
      }));

      for (const { body } of fetched) {
        if (!body) continue;
        const rows = parseCSV(body.replace(/^﻿/, "").replace(/\0/g, ""));
        for (let j = 1; j < rows.length; j++) {
          const row = rows[j];
          if (!row || row.length < 19) continue;

          const itemId = (row[0] || "").replace(/"/g, "").trim();
          if (!itemId) continue;

          // Diagnostic capture — accumulate everything at the target location
          // BEFORE filters so we can see what's there raw.
          if (diag.enabled) {
            const rowLoc = (row[8] || "").replace(/"/g, "").trim().toUpperCase();
            if (rowLoc === diagnoseLocation) {
              diag.rowsAtLoc++;
              const trn = (row[9] || "").replace(/"/g, "").trim();
              const brand = (row[4] || "").replace(/"/g, "").trim().toUpperCase();
              const pt = (row[3] || "").replace(/"/g, "").trim();
              const rawQty = parseFloat((row[10] || "0").replace(/"/g, "").trim()) || 0;
              const rawExt = parseFloat((row[12] || "0").replace(/"/g, "").trim()) || 0;
              const acct = (row[15] || "").replace(/"/g, "").trim().toUpperCase();

              const trnCell = diag.byTrn.get(trn) || { rows: 0, sumQty: 0, sumExtCost: 0 };
              trnCell.rows++;
              trnCell.sumQty += rawQty;
              trnCell.sumExtCost += rawExt;
              diag.byTrn.set(trn, trnCell);

              const sign = rawQty > 0 ? "positive" : rawQty < 0 ? "negative" : "zero";
              const signCell = diag.byTrnAndSign.get(trn) || { positive: 0, negative: 0, zero: 0 };
              signCell[sign]++;
              diag.byTrnAndSign.set(trn, signCell);

              const brandCell = diag.byBrandAtLoc.get(brand) || { rows: 0, sumQty: 0 };
              brandCell.rows++;
              brandCell.sumQty += rawQty;
              diag.byBrandAtLoc.set(brand, brandCell);

              // Brand × transaction breakdown — surfaces the "where do the 417
              // Falken come from" question. Sld gross = -sum(Sld.qty) since Sld
              // qty is stored negative.
              const btKey = `${brand}|${trn}`;
              const btCell = diag.byBrandAndTrn.get(btKey) || { rows: 0, sumQty: 0 };
              btCell.rows++;
              btCell.sumQty += rawQty;
              diag.byBrandAndTrn.set(btKey, btCell);

              // Classify account pattern
              let acctPattern = "other";
              if (["700", "7001", "7002"].includes(acct)) acctPattern = "700-vendor";
              else if (/^[WR]\d{2}[WR]\d{2}$/.test(acct)) acctPattern = "warehouse-transfer";
              else if (/^[WR]\d{2}$/.test(acct)) acctPattern = "bare-location";
              else if (acct.startsWith("INV")) acctPattern = `INV-${/^INV[WR]\d{2}$/.test(acct) ? "till" : "other"}`;
              else if (acct.startsWith("99-")) acctPattern = `99--${/^99-[WR]\d{2}$/.test(acct) ? "till" : "other"}`;
              else if (/^[WR]\d{4,}$/.test(acct)) acctPattern = "vendor-4digit";
              else if (/^\d+$/.test(acct)) acctPattern = "customer-numeric";
              diag.acctPatterns.set(acctPattern, (diag.acctPatterns.get(acctPattern) || 0) + 1);

              diag.productTypes.set(pt || "(empty)", (diag.productTypes.get(pt || "(empty)") || 0) + 1);
            }
          }

          const transaction = (row[9] || "").replace(/"/g, "").trim();
          // Sales (Sld) + customer returns (ReS) only — same as sales-history.
          if (transaction === "TrI" || transaction === "TrO" || transaction === "Rcv") continue;
          if (transaction.startsWith("Adj")) continue;

          const productType = (row[3] || "").replace(/"/g, "").trim();
          if (!productType.startsWith("T") || productType === "T") continue;

          const acct = (row[15] || "").replace(/"/g, "").trim().toUpperCase();
          if (["700", "7001", "7002"].includes(acct)) continue;
          if (/^[WR]\d{2}[WR]\d{2}$/i.test(acct)) continue;
          if (!includeInternalAccounts) {
            if (/^[WR]\d{2}$/i.test(acct)) continue;
            if (acct.startsWith("INV") && !/^INV[WR]\d{2}$/i.test(acct)) continue;
            if (acct.startsWith("99-") && !/^99-[WR]\d{2}$/i.test(acct)) continue;
          }
          if (!includeVendorReturns && /^[WR]\d{4,}$/i.test(acct)) continue;

          if (filterBrand) {
            const b = (row[4] || "").replace(/"/g, "").trim().toUpperCase();
            if (b !== filterBrand) continue;
          }

          const dateRaw = (row[18] || "").replace(/"/g, "").trim();
          const parsed = parseActivityDate(dateRaw);
          if (!parsed) continue;
          if (parsed.iso < startDate || parsed.iso > endDate) continue;

          const location = (row[8] || "").replace(/"/g, "").trim().toUpperCase();
          if (location) seenLocations.add(location);
          if (filterLocations.size > 0 && !filterLocations.has(location)) continue;

          const invoiceId = (row[16] || "").replace(/"/g, "").trim();
          const dedupKey = `${dateRaw}|${invoiceId}|${itemId}|${row[10]}|${location}|${acct}`;
          if (seenDedup.has(dedupKey)) continue;
          seenDedup.add(dedupKey);

          const rawQty = parseFloat((row[10] || "0").replace(/"/g, "").trim()) || 0;
          const rawExt = parseFloat((row[12] || "0").replace(/"/g, "").trim()) || 0;
          // Sales are negative in OEA07V — negate so sales positive, returns negative.
          const qty = -rawQty;
          const dollars = -rawExt;

          const bucket = bucketDate(parsed.iso, granularity);
          seenBuckets.add(bucket);
          const k: Cell = 0; void k; // (placate ts noUnusedLocals if type alias unused)
          const key = `${bucket}|${location}`;
          tireMap.set(key, (tireMap.get(key) || 0) + qty);
          dollarMap.set(key, (dollarMap.get(key) || 0) + dollars);
          totalTires += qty;
          totalDollars += dollars;
          locTotalsTires.set(location, (locTotalsTires.get(location) || 0) + qty);
          locTotalsDollars.set(location, (locTotalsDollars.get(location) || 0) + dollars);
        }
      }
    }

    // Diagnostic short-circuit: return the breakdown for the target location
    // instead of the normal aggregated payload.
    if (diag.enabled) {
      const sortMapDesc = <V extends { rows?: number; sumQty?: number } | number>(
        m: Map<string, V>,
        scoreFn?: (v: V) => number,
      ) => [...m].sort((a, b) => {
        const va = scoreFn ? scoreFn(a[1]) : (a[1] as unknown as number);
        const vb = scoreFn ? scoreFn(b[1]) : (b[1] as unknown as number);
        return vb - va;
      });
      return NextResponse.json({
        diagnoseLocation,
        startDate, endDate,
        rowsAtLocation: diag.rowsAtLoc,
        byTransaction: sortMapDesc(diag.byTrn, (v) => v.rows).map(([trn, v]) => ({
          transaction: trn,
          rows: v.rows,
          sumQty: Math.round(v.sumQty * 100) / 100,
          sumExtCost: Math.round(v.sumExtCost * 100) / 100,
          signs: diag.byTrnAndSign.get(trn),
        })),
        byBrand: sortMapDesc(diag.byBrandAtLoc, (v) => v.rows).map(([brand, v]) => ({
          brand,
          rows: v.rows,
          sumQty: Math.round(v.sumQty * 100) / 100,
        })),
        // Per-brand per-transaction breakdown. Sld qty is stored negative;
        // |sum(Sld.qty)| = gross tires sold for that brand.
        byBrandAndTrn: sortMapDesc(diag.byBrandAndTrn, (v) => v.rows).slice(0, 80).map(([key, v]) => {
          const [brand, trn] = key.split("|");
          return { brand, transaction: trn, rows: v.rows, sumQty: Math.round(v.sumQty * 100) / 100 };
        }),
        accountPatterns: sortMapDesc(diag.acctPatterns).map(([k, v]) => ({ pattern: k, rows: v })),
        productTypes: sortMapDesc(diag.productTypes).map(([k, v]) => ({ productType: k, rows: v })),
        note: "Counts are PRE-filter — every row at this location regardless of transaction/account/productType filters.",
      });
    }

    // Build series: one entry per bucket, with a tires/dollars value per
    // location, plus totals across selected locations.
    const buckets = [...seenBuckets].sort();
    const locations = [...seenLocations].sort();
    const reportedLocations = filterLocations.size > 0
      ? locations.filter(l => filterLocations.has(l))
      : locations;

    const series = buckets.map(bucket => {
      const row: Record<string, string | number> = { bucket };
      let bucketTires = 0;
      let bucketDollars = 0;
      for (const loc of reportedLocations) {
        const t = tireMap.get(`${bucket}|${loc}`) || 0;
        const d = dollarMap.get(`${bucket}|${loc}`) || 0;
        row[`tires_${loc}`] = Math.round(t * 100) / 100;
        row[`dollars_${loc}`] = Math.round(d * 100) / 100;
        bucketTires += t;
        bucketDollars += d;
      }
      row.totalTires = Math.round(bucketTires * 100) / 100;
      row.totalDollars = Math.round(bucketDollars * 100) / 100;
      return row;
    });

    const perLocation = reportedLocations.map(loc => ({
      location: loc,
      tires: Math.round((locTotalsTires.get(loc) || 0) * 100) / 100,
      dollars: Math.round((locTotalsDollars.get(loc) || 0) * 100) / 100,
    })).sort((a, b) => b.dollars - a.dollars);

    return NextResponse.json({
      series,
      locations,         // every location seen in the source data
      perLocation,       // totals per selected location
      totals: {
        tires: Math.round(totalTires * 100) / 100,
        dollars: Math.round(totalDollars * 100) / 100,
      },
      startDate, endDate, granularity,
      bucketCount: buckets.length,
    });
  } catch (err) {
    console.error("Sales-by-day error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load sales by day" }, { status: 500 });
  }
}
