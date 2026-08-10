import { NextRequest, NextResponse } from "next/server";
import { isSalesProductType, productTypeRejectReason } from "@/lib/oea07vProductTypes";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { brandCodeToName } from "@/lib/brandMapping";
import { buildTireDescription } from "@/lib/tireDescriptions";

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

/**
 * GET /api/reports/sales-history-data
 *
 * Aggregates OEA07V daily CSVs from S3 into monthly sales totals per item.
 * Falls back to XLSX sales history format if available.
 * Query params: brand, productType, dclass, startMonth, endMonth
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const filterBrand = searchParams.get("brand");
    const filterProductType = searchParams.get("productType");
    const filterDclass = searchParams.get("dclass");
    const filterLocation = (searchParams.get("location") || "").trim().toUpperCase();
    const includeVendorReturns = searchParams.get("includeVendorReturns") === "true";
    // Relaxes the internal-account filters (bare R20, W08W08, INV-* without
    // the per-store till pattern, 99-* without per-store pattern). Some
    // legit Sld rows land with these account formats — surface them here.
    const includeInternalAccounts = searchParams.get("includeInternalAccounts") === "true";
    // Optional: return raw row diagnostics for a specific itemId instead of
    // the normal aggregated payload. Useful for tracing why a sale is or
    // isn't being counted.
    const debugItemId = (searchParams.get("debugItemId") || "").trim().toUpperCase();
    const startMonth = searchParams.get("startMonth");
    const endMonth = searchParams.get("endMonth");

    // Find all OEA07V CSV files across month folders
    const allFiles: { key: string; month: string; lastModified: Date }[] = [];
    const listRes = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: "jmk-uploads/", MaxKeys: 1000 }));
    for (const obj of listRes.Contents || []) {
      if (!obj.Key || !obj.LastModified) continue;
      const keyLower = obj.Key.toLowerCase();
      if (!keyLower.includes("iet-oea07v") || !keyLower.endsWith(".csv")) continue;
      // Extract month from folder path: jmk-uploads/202604/file.csv
      const monthMatch = obj.Key.match(/jmk-uploads\/(\d{6})\//);
      if (!monthMatch) continue;
      const yyyymm = monthMatch[1];
      const month = `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}`;
      allFiles.push({ key: obj.Key, month, lastModified: obj.LastModified });
    }

    if (allFiles.length === 0) {
      return NextResponse.json({ items: [], monthColumns: [], filters: { brands: [], productTypes: [], dclasses: [], locations: [] }, fileDate: null });
    }

    // Honor the start/end month picker — skip folders entirely outside the
    // requested range. Folder month is YYYY-MM.
    const inRange = (m: string) => (!startMonth || m >= startMonth) && (!endMonth || m <= endMonth);
    let workingFiles = allFiles.filter((f) => inRange(f.month));

    // Per month folder, if one of the files is a monthly-combined (cron-built)
    // OR a Michael-style "<Month> YYYY.csv", use ONLY that file for the month
    // and skip the 20+ daily uploads. Cuts request size dramatically.
    const monthName = (yyyymm: string) => ["january","february","march","april","may","june","july","august","september","october","november","december"][parseInt(yyyymm.split("-")[1], 10) - 1];
    const isMonthlyForMonth = (key: string, monthFolder: string) => {
      // Check the BASENAME only — earlier versions checked the full path,
      // which always matched the YYYYMM folder name (e.g. "202605"), so
      // every daily file looked like the monthly-combined and only the
      // most-recently-uploaded one got processed. That dropped 25+ daily
      // files and severely under-counted month totals.
      const basename = (key.split("/").pop() || "").toLowerCase();
      if (basename.includes("monthly-combined")) return true;
      const name = monthName(monthFolder);
      // Match a named monthly file like "may 2026.csv" but NOT a daily
      // file like "iet-oea07v_051526.csv" — require the month name to be
      // surrounded by non-letter boundaries.
      const nameRe = new RegExp(`(^|[^a-z])${name}([^a-z]|$)`);
      return nameRe.test(basename);
    };
    const filesByMonthFolder = new Map<string, typeof workingFiles>();
    for (const f of workingFiles) (filesByMonthFolder.get(f.month) || filesByMonthFolder.set(f.month, []).get(f.month)!).push(f);
    const trimmed: typeof workingFiles = [];
    for (const [folder, group] of filesByMonthFolder) {
      const monthly = group.filter((f) => isMonthlyForMonth(f.key, folder)).sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
      if (monthly[0]) trimmed.push(monthly[0]);
      else trimmed.push(...group);
    }
    workingFiles = trimmed.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

    const months = [...new Set(workingFiles.map((f) => f.month))].sort();
    // Dedup key: activity date + invoice id + item id + qty + location.
    // Same row appearing in overlapping daily / monthly files is counted once.
    const seenDedupKeys = new Set<string>();

    // Aggregate: itemId -> { info, monthlySales: { month -> totalQty } }
    const itemMap = new Map<string, {
      itemId: string; description: string; brand: string; productType: string;
      dclass: string; model: string; mfgItemId: string;
      monthlySales: Record<string, number>;
    }>();
    // Track every location we encounter (before applying the location filter)
    // so the picker shows all available stores, not just the currently-selected one.
    const seenLocations = new Set<string>();

    // Load tires catalog for description/model enrichment
    const tireLookup = new Map<string, { mfgName: string; model: string; desc: string }>();
    try {
      const tireList = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: "jmk-uploads/tires/", MaxKeys: 100 }));
      const tireFiles = (tireList.Contents || []).filter(o => o.Key?.includes("tires-") && o.Key?.endsWith(".csv")).sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0));
      if (tireFiles.length > 0) {
        const tireRes = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: tireFiles[0].Key! }));
        const tireText = await tireRes.Body?.transformToString("utf-8") || "";
        const tireLines = tireText.replace(/^\uFEFF/, "").split("\n");
        const th = tireLines[0].split(",").map(h => h.replace(/"/g, "").trim().toLowerCase());
        const ti = { itemId: th.findIndex(h => h.includes("item id") || h.includes("itemid") || h === "sku"), mfgName: th.findIndex(h => h.includes("brand") || h.includes("mfg name") || h.includes("manufacturer")), model: th.findIndex(h => h === "model"), size: th.findIndex(h => h.includes("size")), li: th.findIndex(h => h.includes("load index")), sr: th.findIndex(h => h.includes("speed rating")), sw: th.findIndex(h => h.includes("sidewall")), xl: th.findIndex(h => h.includes("xl/rf") || h.includes("xlrf")), ply: th.findIndex(h => h.includes("ply rating") || h.includes("load range")) };
        for (let i = 1; i < tireLines.length; i++) {
          const c = tireLines[i].split(",").map(v => v.replace(/"/g, "").trim());
          const id = ti.itemId >= 0 ? c[ti.itemId] : "";
          if (!id) continue;
          const tire = { mfgName: ti.mfgName >= 0 ? c[ti.mfgName] : "", model: ti.model >= 0 ? c[ti.model] : "", size: ti.size >= 0 ? c[ti.size] : "", loadIndex: ti.li >= 0 ? c[ti.li] : "", speedRating: ti.sr >= 0 ? c[ti.sr] : "", sidewall: ti.sw >= 0 ? c[ti.sw] : "", xlrf: ti.xl >= 0 ? c[ti.xl] : "", plyRating: ti.ply >= 0 ? c[ti.ply] : "" };
          const desc = buildTireDescription(tire);
          tireLookup.set(id, { mfgName: tire.mfgName, model: tire.model, desc });
          tireLookup.set(id.replace(/[.\^\[:\-~*#]$/, ""), { mfgName: tire.mfgName, model: tire.model, desc });
        }
      }
    } catch { /* best effort */ }

    let latestFileDate: string | null = null;

    // Debug-mode capture: every row matching debugItemId, with the would-be
    // filter status so the caller can see why a row was/wasn't counted.
    const debugRows: {
      file: string;
      transaction: string;
      productType: string;
      account: string;
      location: string;
      qty: number;
      extCost: number;
      activityDate: string;
      invoiceId: string;
      filterStatus: string;
    }[] = [];
    const filterStatusFor = (row: string[]): string => {
      const trn = (row[9] || "").replace(/"/g, "").trim();
      if (trn === "TrI" || trn === "TrO" || trn === "Rcv") return `skipped:transaction=${trn}`;
      if (trn.startsWith("Adj")) return `skipped:transaction=${trn}`;
      const pt = (row[3] || "").replace(/"/g, "").trim();
      const ptReject = productTypeRejectReason(pt);
      if (ptReject) return `skipped:${ptReject}`;
      const a = (row[15] || "").replace(/"/g, "").trim().toUpperCase();
      if (["700", "7001", "7002"].includes(a)) return `skipped:account=return-to-vendor(${a})`;
      if (/^[WR]\d{2}[WR]\d{2}$/i.test(a)) return `skipped:account=warehouse-transfer(${a})`;
      if (!includeInternalAccounts) {
        if (/^[WR]\d{2}$/i.test(a)) return `skipped:account=internal-location(${a}); try includeInternalAccounts=true`;
        if (a.startsWith("INV") && !/^INV[WR]\d{2}$/i.test(a)) return `skipped:account=internal-INV(${a}); try includeInternalAccounts=true`;
        if (a.startsWith("99-") && !/^99-[WR]\d{2}$/i.test(a)) return `skipped:account=internal-99(${a}); try includeInternalAccounts=true`;
      }
      if (!includeVendorReturns && /^[WR]\d{4,}$/i.test(a)) return `skipped:account=vendor(${a}); try includeVendorReturns=true`;
      return "counted";
    };

    // Download all surviving files in parallel batches so total wall-clock is
    // bounded by the slowest single download instead of summing all of them.
    const CONCURRENCY = 8;
    const fileBodies: { file: typeof workingFiles[number]; body: string }[] = [];
    for (let i = 0; i < workingFiles.length; i += CONCURRENCY) {
      const batch = workingFiles.slice(i, i + CONCURRENCY);
      const fetched = await Promise.all(batch.map(async (f) => {
        try {
          const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: f.key }));
          const b = await r.Body?.transformToString("utf-8");
          return { file: f, body: b || "" };
        } catch { return { file: f, body: "" }; }
      }));
      fileBodies.push(...fetched);
    }

    for (const { file, body } of fileBodies) {
      if (!latestFileDate || file.lastModified.toISOString() > latestFileDate) {
        latestFileDate = file.lastModified.toISOString();
      }
      if (!body) continue;

      const rows = parseCSV(body.replace(/^\uFEFF/, "").replace(/\0/g, ""));
      // OEA07V columns: 0=ItemId, 1=Description, 2=Sidewall, 3=ProductType, 4=Brand, 5=MfgItemId, 8=Location, 9=Transaction, 10=Qty, 18=ActivityDate
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 11) continue;

        const itemId = (row[0] || "").replace(/"/g, "").trim();
        if (!itemId) continue;

        // Debug-item capture: log this row with would-be filter status,
        // independent of whether it actually counts.
        if (debugItemId && itemId.toUpperCase() === debugItemId) {
          debugRows.push({
            file: file.key,
            transaction: (row[9] || "").replace(/"/g, "").trim(),
            productType: (row[3] || "").replace(/"/g, "").trim(),
            account: (row[15] || "").replace(/"/g, "").trim().toUpperCase(),
            location: (row[8] || "").replace(/"/g, "").trim().toUpperCase(),
            qty: parseFloat((row[10] || "0").replace(/"/g, "").trim()) || 0,
            extCost: parseFloat((row[12] || "0").replace(/"/g, "").trim()) || 0,
            activityDate: (row[18] || "").replace(/"/g, "").trim(),
            invoiceId: (row[16] || "").replace(/"/g, "").trim(),
            filterStatus: filterStatusFor(row),
          });
        }

        // Keep only real sales (Sld) and customer returns (ReS).
        // Skip transfers (TrI/TrO), receives (Rcv), and any inventory
        // adjustment (Adj/D damage, Adj/ZZ other, Adj/RS adjustment-return).
        // Adjustments aren't sales or customer returns — they're stocking
        // corrections that bury legit numbers (esp. for new stores).
        const transaction = (row[9] || "").replace(/"/g, "").trim();
        if (transaction === "TrI" || transaction === "TrO" || transaction === "Rcv") continue;
        if (transaction.startsWith("Adj")) continue;

        // ReS rows from IET house entities (Import Export Tire, IET, etc.)
        // are internal stock receipts mislabeled as returns. Don't net them
        // against sales.
        if (transaction === "ReS") {
          const customer = (row[19] || "").replace(/"/g, "").toUpperCase().trim();
          if (
            customer.startsWith("IMPORT EXPOR") ||
            customer.startsWith("IMPORT/EXPORT") ||
            customer === "IET" ||
            customer.startsWith("IET ") ||
            customer.startsWith("I.E.T") ||
            customer.startsWith("EXPORT TIRE") ||
            customer.startsWith("ESSEY TIRE") ||
            customer.startsWith("KINGS SUPER") ||
            customer.startsWith("KINGS TIRE")
          ) continue;
        }

        // Standard filters: sellable product types only (tires, retreads,
        // dropship, TPMS, lug nuts, tubes, plans, fees — everything except GL
        // expense lines and "=ENTER ..." placeholders), no warehouse
        // transfers, no internal accounts. See lib/oea07vProductTypes.
        const productType = (row[3] || "").replace(/"/g, "").trim();
        if (!isSalesProductType(productType)) continue;
        const acct = (row[15] || "").replace(/"/g, "").trim().toUpperCase();
        if (["700", "7001", "7002"].includes(acct)) continue;
        if (/^[WR]\d{2}[WR]\d{2}$/i.test(acct)) continue;
        // The remaining filters drop accounts that LOOK like internal
        // bookkeeping (bare R20, INV-* without per-store pattern, etc.).
        // Sometimes a real Sld lands with one of these — toggle them off
        // with ?includeInternalAccounts=true to surface those sales.
        if (!includeInternalAccounts) {
          if (/^[WR]\d{2}$/i.test(acct)) continue;
          // Keep "INV{LOCATION}" and "99-{LOCATION}" per-store till accounts
          // (real sales) while still dropping other INV-/99-prefix internal
          // bookkeeping accounts. Locations vary in which pattern they use:
          // R30 hits 99-R30, R15/R20/R25/W07/W08 hit INV{LOC}.
          if (acct.startsWith("INV") && !/^INV[WR]\d{2}$/i.test(acct)) continue;
          if (acct.startsWith("99-") && !/^99-[WR]\d{2}$/i.test(acct)) continue;
        }
        // Vendor accounts look like W4490 / R1234 (W or R + 4+ digits) —
        // distinct from store codes which are exactly 2 digits. Default to
        // excluding so a single 230-unit supplier RA doesn't dwarf real
        // customer activity. Toggle re-includes them.
        if (!includeVendorReturns && /^[WR]\d{4,}$/i.test(acct)) continue;

        // Capture the row's location and apply the location filter (if any) at
        // parse time so per-item monthly totals only reflect the chosen store.
        const rowLocation = (row[8] || "").replace(/"/g, "").trim().toUpperCase();
        if (rowLocation) seenLocations.add(rowLocation);
        if (filterLocation && rowLocation !== filterLocation) continue;

        const qty = parseFloat(row[10] || "0") || 0;
        // Parse activity date to get the month (MM/DD/YY)
        const dateRaw = (row[18] || "").replace(/"/g, "").trim();
        const dateMatch = dateRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
        let rowMonth = file.month;
        if (dateMatch) {
          let y = parseInt(dateMatch[3]);
          if (y < 100) y += 2000;
          rowMonth = `${y}-${String(parseInt(dateMatch[1])).padStart(2, "0")}`;
        }

        // Filter by requested date range
        if (startMonth && rowMonth < startMonth) continue;
        if (endMonth && rowMonth > endMonth) continue;

        // Dedup across overlapping daily/monthly uploads.
        const invoiceId = (row[16] || "").replace(/"/g, "").trim();
        // No qty in the key: an invoice line is unique by date+invoice+item+location+account,
        // so a re-exported line with a corrected qty dedups instead of double-counting.
        const dedupKey = `${dateRaw}|${invoiceId}|${itemId}|${rowLocation}|${acct}`;
        if (seenDedupKeys.has(dedupKey)) continue;
        seenDedupKeys.add(dedupKey);

        let entry = itemMap.get(itemId);
        if (!entry) {
          // D-class is the trailing suffix character on Item ID — spell out
          const lastChar = itemId.slice(-1);
          const dclassMap: Record<string, string> = { ".": "Dot", "^": "Caret", "[": "Bracket", ":": "Colon", "-": "Dash", "~": "Tilde", "*": "Star", "#": "Hash" };
          const dclass = dclassMap[lastChar] || "";
          // Enrich from tire catalog if available
          const tire = tireLookup.get(itemId) || tireLookup.get(itemId.replace(/[.\^\[:\-~*#]$/, ""));
          entry = {
            itemId,
            description: tire?.desc || (row[1] || "").replace(/"/g, "").trim(),
            brand: tire?.mfgName || brandCodeToName((row[4] || "").replace(/"/g, "").trim()),
            productType: (row[3] || "").replace(/"/g, "").trim(),
            dclass,
            model: tire?.model || "",
            mfgItemId: (row[5] || "").replace(/"/g, "").trim(),
            monthlySales: {},
          };
          itemMap.set(itemId, entry);
        }
        // Negate qty (sales are negative in OEA07V)
        entry.monthlySales[rowMonth] = (entry.monthlySales[rowMonth] || 0) + (-qty);
      }
    }

    // Debug mode: return raw row dump for the requested item instead of the
    // normal aggregated payload.
    if (debugItemId) {
      const counted = debugRows.filter(r => r.filterStatus === "counted");
      const summary = {
        rowsFound: debugRows.length,
        countedRows: counted.length,
        sumQty: counted.reduce((s, r) => s + (-r.qty), 0),     // negate so sales positive
        sumExtCost: counted.reduce((s, r) => s + (-r.extCost), 0),
        byFilterStatus: debugRows.reduce<Record<string, number>>((acc, r) => {
          acc[r.filterStatus] = (acc[r.filterStatus] || 0) + 1;
          return acc;
        }, {}),
      };
      return NextResponse.json({
        debugItemId,
        summary,
        rows: debugRows.sort((a, b) => a.activityDate.localeCompare(b.activityDate)),
        flags: { includeInternalAccounts, includeVendorReturns, filterLocation },
      });
    }

    // Build result
    const allMonths = [...new Set([...months, ...Array.from(itemMap.values()).flatMap((e) => Object.keys(e.monthlySales))])].sort();

    let items = Array.from(itemMap.values()).map((entry) => {
      const total = Object.values(entry.monthlySales).reduce((sum, v) => sum + v, 0);
      return { ...entry, total };
    });

    // Collect filter options
    const brands = [...new Set(items.map((i) => i.brand).filter(Boolean))].sort();
    const productTypes = [...new Set(items.map((i) => i.productType).filter(Boolean))].sort();
    const dclasses = [...new Set(items.map((i) => i.dclass).filter(Boolean))].sort();
    const locations = [...seenLocations].sort();

    // Apply filters
    if (filterBrand) items = items.filter((i) => i.brand === filterBrand);
    if (filterProductType) items = items.filter((i) => i.productType === filterProductType);
    if (filterDclass) items = items.filter((i) => i.dclass === filterDclass);

    // Sort by total descending
    items.sort((a, b) => b.total - a.total);

    return NextResponse.json({
      items: items.slice(0, 10000),
      monthColumns: allMonths,
      allAvailableMonths: allMonths,
      filters: { brands, productTypes, dclasses, locations },
      fileDate: latestFileDate,
      totalRows: items.length,
      truncated: items.length > 10000,
    });
  } catch (err) {
    console.error("Sales history data error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load sales data" }, { status: 500 });
  }
}
