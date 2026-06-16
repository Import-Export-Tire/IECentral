import { NextRequest, NextResponse } from "next/server";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { createGunzip } from "zlib";
import { createInterface } from "readline";
import { brandCodeToName } from "@/lib/brandMapping";
import { buildTireDescription } from "@/lib/tireDescriptions";

// Trailing D-class suffix characters on JMK item IDs (e.g. "AV1951340404[").
const stripIdSuffix = (id: string) => id.replace(/[.\^\[:\-]$/, "");

// Pre-processed OEIVAL inventory cache (gzipped NDJSON, one item per line) built
// by the dunlop-oeival-processor Lambda on every new OEIVAL upload. Same source
// the /api/reports/inventory-data route uses.
const OEIVAL_META_KEY = "jmk-uploads/oeival/_cache/latest.meta.json";
const OEIVAL_ITEMS_KEY = "jmk-uploads/oeival/_cache/latest.items.ndjson.gz";

/** Load tires catalog from S3 and build a lookup map by itemId */
async function loadTireCatalogLookup(): Promise<Map<string, Record<string, string>>> {
  const map = new Map<string, Record<string, string>>();
  try {
    const listRes = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: "jmk-uploads/tires/", MaxKeys: 100 }));
    const files = (listRes.Contents || [])
      .filter(o => o.Key?.toLowerCase().endsWith(".csv") && o.Key?.includes("tires-"))
      .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0));
    if (files.length === 0) return map;

    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: files[0].Key! }));
    const text = await res.Body?.transformToString("utf-8") || "";
    if (!text) return map;

    const lines = text.replace(/^\uFEFF/, "").split("\n");
    const headers = lines[0].split(",").map(h => h.replace(/"/g, "").trim().toLowerCase());

    // Find column indices
    const find = (names: string[]) => headers.findIndex(h => names.some(n => h.includes(n)));
    const cols = {
      itemId: find(["item id", "itemid"]),
      mfgName: find(["mfg name", "brand", "manufacturer"]),
      model: find(["model"]),
      size: find(["size", "tire size"]),
      loadIndex: find(["load index"]),
      speedRating: find(["speed rating"]),
      sidewall: find(["sidewall"]),
      xlrf: find(["xl/rf", "xlrf"]),
      plyRating: find(["ply rating", "load range"]),
    };

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(",").map(c => c.replace(/"/g, "").trim());
      const itemId = cols.itemId >= 0 ? row[cols.itemId] : "";
      if (!itemId) continue;

      const tire: Record<string, string> = {};
      if (cols.mfgName >= 0) tire.mfgName = row[cols.mfgName] || "";
      if (cols.model >= 0) tire.model = row[cols.model] || "";
      if (cols.size >= 0) tire.size = row[cols.size] || "";
      if (cols.loadIndex >= 0) tire.loadIndex = row[cols.loadIndex] || "";
      if (cols.speedRating >= 0) tire.speedRating = row[cols.speedRating] || "";
      if (cols.sidewall >= 0) tire.sidewall = row[cols.sidewall] || "";
      if (cols.xlrf >= 0) tire.xlrf = row[cols.xlrf] || "";
      if (cols.plyRating >= 0) tire.plyRating = row[cols.plyRating] || "";
      tire.computedDescription = buildTireDescription(tire);

      // Store by itemId and stripped version
      map.set(itemId, tire);
      map.set(itemId.replace(/[.\^\[:\-~*#]$/, ""), tire);
    }
  } catch { /* catalog unavailable */ }
  return map;
}

const BUCKET = "ietires-dunlop-jmk-uploads";

/**
 * Standard OEA07V row filter — excludes non-tire types, warehouse transfers, and internal accounts.
 * Row must have: product type col at index 3, account ID at index 15.
 */
function isValidOEA07VRow(row: string[]): boolean {
  // Product type must start with T but not be T alone
  const pt = (row[3] || "").replace(/"/g, "").trim();
  if (!pt.startsWith("T") || pt === "T") return false;

  // Keep only real sales (Sld) and customer returns (ReS). Exclude warehouse
  // transfers (TrI/TrO), receives (Rcv) and inventory adjustments (Adj/*) so the
  // export's quantities match the sales reports.
  const trn = (row[9] || "").replace(/"/g, "").trim();
  if (trn !== "Sld" && trn !== "ReS") return false;

  // Exclude internal accounts
  const acct = (row[15] || "").replace(/"/g, "").trim().toUpperCase();
  if (["700", "7001", "7002"].includes(acct)) return false;

  // Exclude warehouse transfers — two location codes joined (W##W##, R##W##, W##R##, R##R##)
  if (/^[WR]\d{2}[WR]\d{2}$/i.test(acct)) return false;

  // Exclude standalone warehouse/store codes used as account (W07, W08, W09, R10-R35)
  if (/^[WR]\d{2}$/i.test(acct)) return false;

  // Exclude inventory/adjustment accounts
  if (acct.startsWith("INV") || acct.startsWith("99-")) return false;

  return true;
}

const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }
    : {}),
});

// Column definitions per report type
const COLUMN_DEFS: Record<string, { index: number; name: string; key: string }[]> = {
  OEA07V: [
    { index: 0, name: "Item ID", key: "itemId" },
    { index: 1, name: "Description", key: "description" },
    { index: 2, name: "Sidewall", key: "sidewall" },
    { index: 3, name: "Product Type", key: "productType" },
    { index: 4, name: "Brand", key: "brand" },
    { index: 5, name: "MFG Item ID", key: "mfgItemId" },
    { index: 8, name: "Location", key: "location" },
    { index: 9, name: "Transaction", key: "transaction" },
    { index: 10, name: "Qty", key: "qty" },
    { index: 11, name: "Unit Cost", key: "unitCost" },
    { index: 12, name: "Ext Cost", key: "extCost" },
    { index: 13, name: "Unit Sell", key: "unitSell" },
    { index: 14, name: "Ext Sell", key: "extSell" },
    { index: 15, name: "Account ID", key: "accountId" },
    { index: 16, name: "Invoice ID", key: "invoiceId" },
    { index: 18, name: "Activity Date", key: "activityDate" },
    { index: 19, name: "Customer Name", key: "customerName" },
  ],
  ART24T: [
    { index: 0, name: "A/R Account ID", key: "arAccountId" },
    { index: 1, name: "Invoice ID", key: "invoiceId" },
    { index: 4, name: "Trans Date", key: "transDate" },
    { index: 5, name: "Location", key: "location" },
    { index: 6, name: "Product Type", key: "productType" },
    { index: 7, name: "Brand", key: "brand" },
    { index: 9, name: "Item ID", key: "itemId" },
    { index: 10, name: "Description", key: "description" },
    { index: 13, name: "Qty Delivered", key: "qty" },
    { index: 14, name: "Total Amount", key: "totalAmt" },
    { index: 15, name: "Total Cost", key: "totalCost" },
    { index: 16, name: "Gross Profit", key: "grossProfit" },
    { index: 17, name: "Unit Price", key: "unitPrice" },
    { index: 19, name: "Unit COGS", key: "unitCogs" },
    { index: 20, name: "Profit %", key: "profitPct" },
    { index: 31, name: "Customer Name", key: "customerName" },
  ],
  oeival: [
    { index: 0, name: "Location", key: "location" },
    { index: 1, name: "Product Type", key: "productType" },
    { index: 3, name: "D-Class", key: "dclass" },
    { index: 4, name: "Manufacturer Code", key: "manufacturerCode" },
    { index: 5, name: "Brand", key: "manufacturerName" },
    { index: 6, name: "Model", key: "model" },
    { index: 7, name: "Item ID", key: "itemId" },
    { index: 8, name: "MFG Item ID", key: "mfgItemId" },
    { index: 9, name: "Description", key: "description" },
    { index: 11, name: "Qty On Hand", key: "qtyOnHand" },
    { index: 13, name: "Qty Available", key: "qtyAvailable" },
    { index: 20, name: "Last Cost", key: "lastCost" },
    { index: 21, name: "Avg Cost", key: "avgCost" },
    { index: 24, name: "Extended Value", key: "extendedValue" },
  ],
  tires: [
    { index: 2, name: "Item ID", key: "itemId" },
    { index: 3, name: "MFG Item ID", key: "mfgItemId" },
    { index: 4, name: "Brand", key: "mfgName" },
    { index: 5, name: "Model", key: "model" },
    { index: 9, name: "Load Index", key: "loadIndex" },
    { index: 10, name: "Speed Rating", key: "speedRating" },
    { index: 15, name: "Product Type", key: "productType" },
    { index: 16, name: "Sidewall", key: "sidewall" },
    { index: 19, name: "XL/RF", key: "xlrf" },
    { index: 8, name: "Weight", key: "weight" },
    { index: 17, name: "Warranty Miles", key: "warrantyMiles" },
    { index: 18, name: "Tread Depth", key: "treadDepth" },
  ],
};

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
      else if (ch === ",") { current.push(field); field = ""; }
      else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
        current.push(field); field = "";
        if (current.some(f => f.trim())) rows.push(current);
        current = [];
        if (ch === "\r") i++;
      } else if (ch === "\r") {
        current.push(field); field = "";
        if (current.some(f => f.trim())) rows.push(current);
        current = [];
      } else field += ch;
    }
  }
  if (field || current.length > 0) {
    current.push(field);
    if (current.some(f => f.trim())) rows.push(current);
  }
  return rows;
}

/**
 * POST /api/reports/custom-data
 *
 * Accepts: { reportType, months[], selectedColumns[] }
 * Returns: { columns, rows, totalRows, dateRange }
 */
async function fetchSourceData(reportType: string, months: string[], selectedColumns: string[]) {
  const colDefs = COLUMN_DEFS[reportType];
  if (!colDefs) return { columns: [], rows: [] };

  const activeCols = selectedColumns?.length
    ? colDefs.filter((c) => selectedColumns.includes(c.key))
    : colDefs;

    // Find and download files for each month
    const allRows: Record<string, string>[] = [];

    for (const month of months as string[]) {
      const prefix = `jmk-uploads/${month}/`;
      const listRes = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }));
      if (!listRes.Contents?.length) continue;

      // Find matching file by report type pattern
      const pattern = reportType === "OEA07V" ? "iet-oea07v" : reportType === "ART24T" ? "iet-art24t" : reportType.toLowerCase();
      const matches = listRes.Contents
        .filter((o) => o.Key?.toLowerCase().includes(pattern) && o.Key?.toLowerCase().endsWith(".csv"))
        .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0));

      if (matches.length === 0) continue;

      const fileKey = matches[0].Key!;
      const getRes = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: fileKey }));
      const body = await getRes.Body?.transformToString("utf-8");
      if (!body) continue;

      const csvRows = parseCSV(body.replace(/^\uFEFF/, "").replace(/\0/g, ""));
      // Skip header
      for (let i = 1; i < csvRows.length; i++) {
        const row = csvRows[i];
        // Standard OEA07V filters: tire types only, no warehouse transfers
        if (reportType === "OEA07V" && !isValidOEA07VRow(row)) continue;
        const record: Record<string, string> = {};
        for (const col of activeCols) {
          let val = (row[col.index] || "").replace(/"/g, "").trim();
          // Map brand codes to full names
          if (col.key === "brand" && reportType === "OEA07V") val = brandCodeToName(val);
          record[col.key] = val;
        }
        allRows.push(record);
      }
    }

    return {
      columns: activeCols.map((c) => ({ key: c.key, name: c.name })),
      rows: allRows,
    };
}

/**
 * Scan an OEIVAL CSV's date columns to determine what year/period the data covers.
 * Reads first 50 rows and checks "date last sale" (col 42) or "last purchase date" (col 36).
 */
async function detectFilePeriod(key: string): Promise<string | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    // Only read first 20KB to check dates
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const reader = res.Body as any;
    if (!reader) return null;
    const text = await res.Body?.transformToString("utf-8") || "";
    const lines = text.slice(0, 30000).split("\n");
    if (lines.length < 2) return null;

    // Find date columns from header
    const headers = lines[0].toLowerCase().split(",").map(h => h.replace(/"/g, "").trim());
    const dateColIdx = headers.findIndex(h => h === "date last sale");
    const purchDateIdx = headers.findIndex(h => h === "last purchase date");
    const soldFromIdx = headers.findIndex(h => h.includes("sold from"));
    const checkIdx = dateColIdx >= 0 ? dateColIdx : purchDateIdx >= 0 ? purchDateIdx : soldFromIdx;
    if (checkIdx < 0) return null;

    // Sample dates from first 50 data rows
    const years = new Map<number, number>();
    for (let i = 1; i < Math.min(lines.length, 50); i++) {
      const cols = lines[i].split(",");
      const val = (cols[checkIdx] || "").replace(/"/g, "").trim();
      if (!val || val === "0") continue;
      // Try YYMMDD format (common in JMK)
      let year: number | null = null;
      if (/^\d{6}$/.test(val)) {
        year = parseInt(val.slice(0, 2));
        if (year < 100) year += 2000;
      } else {
        const d = new Date(val);
        if (!isNaN(d.getTime())) year = d.getFullYear();
      }
      if (year && year > 2000) years.set(year, (years.get(year) || 0) + 1);
    }

    if (years.size === 0) return null;
    // Return the most common year as YYYY
    const sorted = [...years.entries()].sort((a, b) => b[1] - a[1]);
    return String(sorted[0][0]);
  } catch {
    return null;
  }
}

async function fetchXlsxData(reportType: string, selectedColumns: string[], months?: string[]) {
  // For OEIVAL and similar sources, find all candidate files
  const basePrefixes = reportType === "oeival" ? ["jmk-uploads/oeival/", "jmk-uploads/"] : ["jmk-uploads/oea07v-sales/", "jmk-uploads/"];

  // Requested year from months (e.g., months=["202604"] → year "2026")
  const requestedYear = months?.[0]?.slice(0, 4) || String(new Date().getFullYear());

  for (const prefix of basePrefixes) {
    const listRes = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000 }));
    const matches = (listRes.Contents || [])
      .filter((o) => {
        const key = o.Key?.toLowerCase() || "";
        if (reportType === "oeival") return key.includes("oeival") && (key.endsWith(".xlsx") || key.endsWith(".csv"));
        if (reportType === "tires") return key.includes("tires") && key.endsWith(".csv");
        return false;
      })
      .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0));

    if (matches.length === 0) continue;

    // For OEIVAL with multiple files, scan dates to pick the right one
    let bestMatch = matches[0];
    if (reportType === "oeival" && matches.length > 1) {
      for (const candidate of matches) {
        const period = await detectFilePeriod(candidate.Key!);
        if (period === requestedYear) {
          bestMatch = candidate;
          break; // Found a match for the requested year
        }
      }
    }

    const fileKey = bestMatch.Key!;
    const fileKeyLower = fileKey.toLowerCase();
    const getRes = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: fileKey }));

    if (reportType === "oeival") {
      let rawData: unknown[][];
      if (fileKeyLower.endsWith(".csv")) {
        const text = await getRes.Body?.transformToString("utf-8") || "";
        if (!text) continue;
        rawData = parseCSV(text.replace(/^\uFEFF/, "").replace(/\0/g, ""));
      } else {
        const buffer = await getRes.Body?.transformToByteArray();
        if (!buffer) continue;
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buffer, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rawData = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
      }

      // Auto-detect columns from header
      const headerRow = (rawData[0] as string[]).map((h) => String(h || "").replace(/"/g, "").trim().toLowerCase());
      const headerAliases: Record<string, string[]> = {
        location: ["location", "loc id"], productType: ["product type"],
        dclass: ["d class", "d-class", "dclass"],
        manufacturerCode: ["manufacturer code", "mfg code"],
        manufacturerName: ["manufacturer name", "mfg name", "mfg's name"],
        model: ["model"], itemId: ["item id"],
        mfgItemId: ["manufacturer's item id", "mfg's item id", "mfg item id"],
        description: ["description", "item description"],
        qtyOnHand: ["qty on hand"], qtyAvailable: ["qty available"],
        lastCost: ["last cost"], avgCost: ["avg cost"],
        extendedValue: ["extended value"],
      };
      const colMap: Record<string, number> = {};
      for (const [field, aliases] of Object.entries(headerAliases)) {
        let idx = headerRow.findIndex((h) => aliases.some((a) => h === a));
        if (idx < 0) idx = headerRow.findIndex((h) => aliases.some((a) => h.includes(a)));
        if (idx >= 0) colMap[field] = idx;
      }
      // Fix exact matches for ambiguous headers
      const qohExact = headerRow.findIndex((h) => h === "qty on hand");
      if (qohExact >= 0) colMap.qtyOnHand = qohExact;
      const avgExact = headerRow.findIndex((h) => h === "avg cost");
      if (avgExact >= 0) colMap.avgCost = avgExact;
      // Fallback to positional if no headers detected
      if (Object.keys(colMap).length < 5) {
        Object.assign(colMap, {
          location: 0, productType: 1, dclass: 3, manufacturerCode: 4, manufacturerName: 5,
          model: 6, itemId: 7, mfgItemId: 8, description: 9, qtyOnHand: 11,
          qtyAvailable: 13, lastCost: 20, avgCost: 21, extendedValue: 24,
        });
      }

      const rows: Record<string, string>[] = [];
      for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i] as (string | number | undefined)[];
        if (!row[0] && !row[1]) continue;
        const record: Record<string, string> = {};
        for (const key of selectedColumns) {
          if (colMap[key] !== undefined) {
            record[key] = String(row[colMap[key]] ?? "").replace(/"/g, "").trim();
          }
        }
        rows.push(record);
      }

      const cols = selectedColumns
        .filter((k) => colMap[k] !== undefined)
        .map((k) => ({ key: k, name: k }));
      return { columns: cols, rows };
    }

    if (reportType === "tires") {
      const tiresRes = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: matches[0].Key! }));
      const text = await tiresRes.Body?.transformToString("utf-8") || "";
      const lines = text.replace(/^\uFEFF/, "").split("\n");
      const rawHeaders = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());

      // Auto-detect columns by header name
      const headerAliases: Record<string, string[]> = {
        itemId: ["item id", "itemid", "sku", "part number", "part_number"],
        mfgItemId: ["mfg item id", "manufacturer item id", "mfg's item id", "vendor part"],
        mfgName: ["mfg name", "brand", "manufacturer", "vendor"],
        model: ["model", "model name", "pattern"],
        loadIndex: ["load index", "load", "load_index"],
        speedRating: ["speed rating", "speed", "speed_rating"],
        productType: ["product type", "type", "category"],
        sidewall: ["sidewall", "construction"],
        xlrf: ["xl/rf", "xlrf", "reinforced", "extra load"],
        weight: ["weight", "tire weight"],
        warrantyMiles: ["warranty miles", "warranty", "treadwear warranty"],
        treadDepth: ["tread depth", "tread"],
        size: ["size", "tire size"],
        plyRating: ["ply rating", "ply", "load range"],
      };

      const lowerHeaders = rawHeaders.map(h => h.toLowerCase());
      const colMap: Record<string, number> = {};
      for (const [field, aliases] of Object.entries(headerAliases)) {
        let idx = lowerHeaders.findIndex(h => aliases.some(a => h === a));
        if (idx < 0) idx = lowerHeaders.findIndex(h => aliases.some(a => h.includes(a)));
        if (idx >= 0) colMap[field] = idx;
      }

      const rows: Record<string, string>[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.replace(/"/g, "").trim());
        if (cols.length < 3) continue;
        const record: Record<string, string> = {};
        for (const key of selectedColumns) {
          if (colMap[key] !== undefined) record[key] = cols[colMap[key]] || "";
        }
        rows.push(record);
      }
      return {
        columns: selectedColumns.filter(k => colMap[k] !== undefined).map((k) => ({ key: k, name: k })),
        rows,
      };
    }
  }

  return { columns: [], rows: [] };
}

/**
 * Stream the pre-processed OEIVAL cache line-by-line and invoke `onRow` for each
 * item with only the requested keys. Avoids XLSX.read of the full workbook, which
 * materializes the whole sheet in memory and OOM-kills the 2048MB (Hobby-cap)
 * function. Returns false if the cache is unavailable.
 */
async function streamOeivalCache(
  neededKeys: string[],
  onRow: (rec: Record<string, string>) => void
): Promise<boolean> {
  let itemsKey = OEIVAL_ITEMS_KEY;
  try {
    const metaRes = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: OEIVAL_META_KEY }));
    const metaText = await metaRes.Body?.transformToString("utf-8");
    if (metaText) {
      const meta = JSON.parse(metaText) as { itemsKey?: string };
      if (meta.itemsKey) itemsKey = meta.itemsKey;
    }
  } catch { /* fall back to the default items key */ }

  let itemsRes;
  try {
    itemsRes = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: itemsKey }));
  } catch {
    return false;
  }
  const bodyStream = itemsRes.Body as unknown as NodeJS.ReadableStream | null;
  if (!bodyStream) return false;

  const gunzip = createGunzip();
  bodyStream.pipe(gunzip as unknown as NodeJS.WritableStream);
  const rl = createInterface({ input: gunzip as unknown as NodeJS.ReadableStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line) continue;
    let it: Record<string, unknown>;
    try { it = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    const rec: Record<string, string> = {};
    for (const k of neededKeys) {
      const v = it[k];
      if (v !== undefined && v !== null) rec[k] = String(v);
    }
    onRow(rec);
  }
  return true;
}

/**
 * Build an OEIVAL data set ({columns, rows}) from the streamed cache for the
 * given selected columns. When `joinFilter` is supplied (fusion), only inventory
 * rows whose join key matches the primary side are retained — this keeps memory
 * bounded to the items that can actually join, well under the 2048MB cap.
 */
async function fetchOeivalFromCache(
  selectedColumns: string[],
  joinFilter?: { keys: string[]; values: Set<string> }
) {
  const colDefs = (COLUMN_DEFS.oeival || []).filter((c) => selectedColumns.includes(c.key));
  const fetchKeys = new Set(colDefs.map((c) => c.key));
  if (joinFilter) joinFilter.keys.forEach((k) => fetchKeys.add(k));

  const rows: Record<string, string>[] = [];
  const ok = await streamOeivalCache([...fetchKeys], (rec) => {
    if (joinFilter) {
      const match = joinFilter.keys.some((k) => {
        const v = rec[k];
        return !!v && (joinFilter.values.has(v) || joinFilter.values.has(stripIdSuffix(v)));
      });
      if (!match) return;
    }
    rows.push(rec);
  });
  if (!ok) {
    throw new Error("OEIVAL inventory cache is unavailable — upload a new OEIVAL or run the dunlop-oeival-processor Lambda");
  }
  return { columns: colDefs.map((c) => ({ key: c.key, name: c.name })), rows };
}

export async function POST(request: NextRequest) {
  let stage = "parse-request";
  try {
    const { reportType, months, selectedColumns, secondSource, fusionJoinKey, fusionColumns } = await request.json();

    if (!reportType || !months?.length) {
      return NextResponse.json({ error: "reportType and months required" }, { status: 400 });
    }

    // Ensure the fusion join key is always fetched from the primary source
    const primaryColumns = [...selectedColumns];
    if (secondSource && fusionJoinKey && !primaryColumns.includes(fusionJoinKey)) {
      primaryColumns.push(fusionJoinKey);
    }

    // Fetch primary source
    stage = `fetch-primary:${reportType}`;
    let primaryData;
    if (reportType === "oeival") {
      // Stream the cache instead of parsing the raw workbook (avoids OOM).
      primaryData = await fetchOeivalFromCache(primaryColumns);
    } else if (reportType === "tires") {
      primaryData = await fetchXlsxData(reportType, primaryColumns, months);
    } else {
      primaryData = await fetchSourceData(reportType, months, primaryColumns);
    }

    let finalRows = primaryData.rows;
    let finalColumns = primaryData.columns;

    // Enrich OEA07V rows with tire catalog descriptions
    if (reportType === "OEA07V" && finalRows.length > 0) {
      stage = "tire-enrich";
      try {
        const tireLookup = await loadTireCatalogLookup();
        if (tireLookup.size > 0) {
          finalRows = finalRows.map((row) => {
            const itemId = row.itemId || "";
            const tire = tireLookup.get(itemId) || tireLookup.get(itemId.replace(/[.\^\[:\-~*#]$/, ""));
            if (!tire) return row;
            const enriched = { ...row };
            // Replace description with computed tire description
            if (tire.computedDescription) enriched.description = tire.computedDescription;
            // Replace brand code with full name from catalog
            if (tire.mfgName && enriched.brand) enriched.brand = tire.mfgName;
            // Populate model from catalog
            if (tire.model && !enriched.model) enriched.model = tire.model;
            return enriched;
          });
        }
      } catch { /* catalog enrichment is best-effort */ }
    }

    // Fusion — fetch second source and join
    if (secondSource && fusionJoinKey) {
      stage = `fetch-second:${secondSource}`;
      let secondData;
      // Only fetch needed columns: join key + selected fusion columns + mfgItemId for auto-join
      const neededKeys = new Set(["mfgItemId", "itemId", fusionJoinKey, ...(fusionColumns as string[] || [])]);
      if (secondSource === "oeival") {
        // Build the set of join values present on the primary side, so the cache
        // stream only retains inventory items that can actually join — keeping
        // the function's memory well under the 2048MB Hobby cap.
        const joinValues = new Set<string>();
        for (const row of finalRows) {
          for (const k of ["mfgItemId", "itemId", fusionJoinKey]) {
            const v = row[k];
            if (v) { joinValues.add(v); joinValues.add(stripIdSuffix(v)); }
          }
        }
        const secondCols = (COLUMN_DEFS.oeival || []).filter((c) => neededKeys.has(c.key) || !fusionColumns);
        secondData = await fetchOeivalFromCache(
          secondCols.map((c) => c.key),
          { keys: ["mfgItemId", "itemId"], values: joinValues }
        );
      } else if (secondSource === "tires") {
        const secondCols = (COLUMN_DEFS[secondSource] || []).filter((c) => neededKeys.has(c.key) || !fusionColumns);
        secondData = await fetchXlsxData(secondSource, secondCols.map((c) => c.key), months);
      } else {
        const secondCols = (COLUMN_DEFS[secondSource] || []).filter((c) => neededKeys.has(c.key) || !fusionColumns);
        secondData = await fetchSourceData(secondSource, months, secondCols.map((c) => c.key));
      }

      stage = "join";
      // Strip D-class suffix from item IDs for matching
      const stripDclass = (id: string) => id.replace(/[.\^\[:\-]$/, "");

      // Try mfgItemId first (best match), then fall back to requested join key
      const joinKeys = fusionJoinKey === "mfgItemId" ? ["mfgItemId"] : ["mfgItemId", fusionJoinKey];

      // Build lookup maps for each potential join key
      const secondMaps = new Map<string, Map<string, Record<string, string>>>();
      for (const jk of joinKeys) {
        const map = new Map<string, Record<string, string>>();
        for (const row of secondData.rows) {
          const key = row[jk];
          if (key) {
            map.set(key, row);
            map.set(stripDclass(key), row);
          }
        }
        secondMaps.set(jk, map);
      }

      // Pick the join key with the most matches
      let bestJoinKey = joinKeys[0];
      let bestMap = secondMaps.get(bestJoinKey)!;
      for (const jk of joinKeys) {
        const map = secondMaps.get(jk)!;
        let matches = 0;
        for (const row of finalRows) {
          const k = row[jk];
          if (k && (map.has(k) || map.has(stripDclass(k)))) matches++;
        }
        const bestMatches = (() => {
          let c = 0;
          const bm = secondMaps.get(bestJoinKey)!;
          for (const row of finalRows) {
            const k = row[bestJoinKey];
            if (k && (bm.has(k) || bm.has(stripDclass(k)))) c++;
          }
          return c;
        })();
        if (matches > bestMatches) {
          bestJoinKey = jk;
          bestMap = map;
        }
      }

      // Merge columns (add second source columns that don't overlap)
      const primaryKeys = new Set(finalColumns.map((c) => c.key));
      const fusionColSet = fusionColumns ? new Set(fusionColumns as string[]) : null;
      const newCols = secondData.columns.filter((c) =>
        !primaryKeys.has(c.key) && c.key !== bestJoinKey && (!fusionColSet || fusionColSet.has(c.key))
      );
      finalColumns = [...finalColumns, ...newCols.map((c) => ({ key: `fusion_${c.key}`, name: `${c.name} (${secondSource})` }))];

      // Join rows using the best join key
      finalRows = finalRows.map((row) => {
        const joinKey = row[bestJoinKey];
        const secondRow = joinKey ? (bestMap.get(joinKey) || bestMap.get(stripDclass(joinKey))) : undefined;
        if (!secondRow) return row;
        const merged = { ...row };
        for (const col of newCols) {
          merged[`fusion_${col.key}`] = secondRow[col.key] || "";
        }
        return merged;
      });
    }

    stage = "serialize";
    const payload = {
      columns: finalColumns,
      rows: finalRows.slice(0, 50000),
      totalRows: finalRows.length,
      truncated: finalRows.length > 50000,
    };
    const json = JSON.stringify(payload);
    const sizeMB = json.length / (1024 * 1024);
    console.log(
      `Custom data ok: type=${reportType} second=${secondSource || "none"} rows=${payload.totalRows} returned=${payload.rows.length} size=${sizeMB.toFixed(2)}MB`
    );
    return new NextResponse(json, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(`Custom data error [stage=${stage}]:`, err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      {
        error: `[${stage}] ${msg}`,
        diag: { stage, message: msg, stack: err instanceof Error ? err.stack : undefined },
      },
      { status: 500 }
    );
  }
}
