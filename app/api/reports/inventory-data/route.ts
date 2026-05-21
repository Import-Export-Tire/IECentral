import { NextRequest, NextResponse } from "next/server";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { brandCodeToName } from "@/lib/brandMapping";

export const maxDuration = 90;

const BUCKET = "ietires-dunlop-jmk-uploads";
// XLSX is now stream-parsed via exceljs (constant memory regardless
// of workbook size); CSV streams line-by-line. The cap is mostly to
// guard against runaway files filling /tmp during download — 300MB
// is plenty for the foreseeable OEIVAL exports.
const MAX_FILE_BYTES = 300 * 1024 * 1024;

const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }
    : {}),
});

function decodeDclass(raw: string): string {
  const map: Record<string, string> = {
    "Blank": "", "Dash": "Dash", "colon": "Colon", "Open Bracket": "Bracket",
    ".": "Dot", "^": "Caret", "[": "Bracket", ":": "Colon", "-": "Dash",
    "~": "Tilde", "*": "Star", "#": "Hash", "!": "Bang",
  };
  return map[raw] ?? raw;
}

/**
 * GET /api/reports/inventory-data
 *
 * Reads the latest OEIVAL XLSX from S3, parses it, returns filtered JSON.
 * Query params: location, brand, productType, dclass
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const filterLocation = searchParams.get("location");
    const filterBrand = searchParams.get("brand");
    const filterProductType = searchParams.get("productType");
    const filterDclass = searchParams.get("dclass");

    // Find latest OEIVAL file — check organized folder first, then legacy paths
    let allOeivalFiles: { Key?: string; LastModified?: Date; Size?: number }[] = [];
    for (const prefix of ["jmk-uploads/oeival/", "jmk-uploads/"]) {
      const listRes = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000 }));
      const found = (listRes.Contents || [])
        .filter((o) => o.Key?.toLowerCase().includes("oeival") && (o.Key?.endsWith(".xlsx") || o.Key?.endsWith(".csv")));
      if (found.length > 0) { allOeivalFiles = found; break; }
    }
    allOeivalFiles.sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0));

    // The newest file's date — always returned so the UI can show it
    // even if we can't actually parse the file because it's too big.
    const newestDate = allOeivalFiles[0]?.LastModified?.toISOString() ?? null;
    const newestSize = allOeivalFiles[0]?.Size;

    // Only parse files within the size cap — anything larger gets skipped
    // so the function doesn't OOM. We surface a staleWarning so the UI
    // can tell the user instead of silently displaying stale data.
    const oeivalFiles = allOeivalFiles.filter((o) => !o.Size || o.Size < MAX_FILE_BYTES);

    if (oeivalFiles.length === 0) {
      return NextResponse.json({
        items: [], filters: { locations: [], brands: [], productTypes: [], dclasses: [] },
        fileDate: newestDate, // surface the date even when we couldn't parse
        staleWarning: allOeivalFiles.length > 0
          ? `Latest upload is ${Math.round((newestSize ?? 0) / 1024 / 1024)}MB — exceeds the ${MAX_FILE_BYTES / 1024 / 1024}MB parse limit. No data shown.`
          : undefined,
      });
    }

    const fileKey = oeivalFiles[0].Key!;
    const fileDate = oeivalFiles[0].LastModified?.toISOString();
    // If we had to drop the newest file because it was too big, tell the UI.
    const staleWarning = allOeivalFiles[0].Key !== fileKey
      ? `Most recent upload (${Math.round((newestSize ?? 0) / 1024 / 1024)}MB) is too large to display. Showing data from ${new Date(fileDate ?? Date.now()).toLocaleDateString()}.`
      : undefined;

    // Download from S3
    const getRes = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: fileKey }));

    let rawData: unknown[][];
    if (fileKey.toLowerCase().endsWith(".csv")) {
      // CSV \u2014 stream-parse line by line. Buffering 163MB into a string
      // peaked memory near 1GB and OOMed during downstream parsing.
      const body = getRes.Body as unknown as NodeJS.ReadableStream | null;
      if (!body) return NextResponse.json({ items: [], filters: { locations: [], brands: [], productTypes: [], dclasses: [] }, fileDate });
      const readline = await import("readline");
      const rl = readline.createInterface({ input: body as unknown as NodeJS.ReadableStream, crlfDelay: Infinity });
      const parseCsvLine = (line: string): string[] => {
        const fields: string[] = [];
        let field = "", inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (inQuotes) {
            if (ch === '"') { if (line[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
            else field += ch;
          } else {
            if (ch === '"') inQuotes = true;
            else if (ch === ",") { fields.push(field.trim()); field = ""; }
            else field += ch;
          }
        }
        fields.push(field.trim());
        return fields;
      };
      const rows: string[][] = [];
      let first = true;
      for await (const rawLine of rl) {
        // Strip BOM from very first line, ignore any embedded NULs
        const line = first ? rawLine.replace(/^\uFEFF/, "").replace(/\0/g, "") : rawLine.replace(/\0/g, "");
        first = false;
        if (!line) continue;
        const fields = parseCsvLine(line);
        if (fields.some((f) => f)) rows.push(fields);
      }
      rawData = rows;
    } else {
      // XLSX \u2014 stream-parse via exceljs so a 200MB workbook doesn't
      // OOM. Reads one row at a time from the S3 byte stream.
      const ExcelJS = (await import("exceljs")).default;
      const body = getRes.Body;
      if (!body) return NextResponse.json({ items: [], filters: { locations: [], brands: [], productTypes: [], dclasses: [] }, fileDate });
      // ExcelJS accepts any Node Readable at runtime; its types insist on
      // node:stream.Stream so we cast through unknown to avoid the false
      // structural-incompatibility error from the AWS SDK stream typing.
      const reader = new ExcelJS.stream.xlsx.WorkbookReader(body as unknown as import("stream").Stream, { worksheets: "emit", entries: "emit", sharedStrings: "cache" });
      const rows: unknown[][] = [];
      for await (const ws of reader) {
        for await (const row of ws) {
          // exceljs row.values is a sparse array with a leading undefined at
          // index 0 (1-based) \u2014 strip it so downstream code can treat the
          // row as a normal 0-based array, matching the old XLSX shape.
          const vals = (row.values as unknown[]) || [];
          rows.push(vals.slice(1).map((v) => {
            if (v && typeof v === "object") {
              // Hyperlink cells come back as { text, hyperlink, ... };
              // rich text comes back as { richText: [...] }. Coerce to text.
              const obj = v as { text?: string; richText?: { text: string }[] };
              if (obj.richText) return obj.richText.map((r) => r.text).join("");
              if (obj.text !== undefined) return obj.text;
            }
            return v;
          }));
        }
        // First worksheet is enough \u2014 the OEIVAL data is always on sheet 1
        break;
      }
      rawData = rows;
    }

    if (rawData.length < 2) {
      return NextResponse.json({ items: [], filters: { locations: [], brands: [], productTypes: [], dclasses: [] }, fileDate });
    }

    const num = (val: unknown) => parseFloat(String(val ?? "0")) || 0;

    // Auto-detect columns from header row
    const headerRow = (rawData[0] as string[]).map((h) => String(h || "").replace(/"/g, "").trim().toLowerCase());

    // Map header names to field keys — use exact matches to avoid ambiguity
    const headerMap: Record<string, string[]> = {
      location: ["location", "loc id"],
      productType: ["product type"],
      stockType: ["stock type"],
      dclass: ["d class", "d-class", "dclass"],
      manufacturerCode: ["manufacturer code", "mfg code"],
      manufacturerName: ["manufacturer name", "mfg name", "mfg's name"],
      model: ["model"],
      itemId: ["item id"],
      mfgItemId: ["manufacturer's item id", "mfg's item id", "mfg item id"],
      description: ["description", "item description"],
      sidewall: ["sidewall or bolt circle", "sidewall"],
      reorderPoint: ["reorder point"],
      qtyOnHand: ["qty on hand"],
      qtyCommitted: ["qty committed"],
      qtyAvailable: ["qty available"],
      priceRetail: ["o/e 'retail'", "retail"],
      priceCommercial: ["o/e 'commercial'", "commercial"],
      priceWholesale: ["o/e 'wholesale'", "wholesale"],
      priceBase: ["o/e 'base'", "base"],
      priceList: ["o/e 'list'", "list"],
      priceAdj: ["o/e 'adj'", "adj"],
      lastCost: ["last cost"],
      avgCost: ["avg cost"],
      stdCost: ["std cost"],
      fet: ["fet"],
      extendedValue: ["extended value"],
    };

    // Find column index for each field — use exact equality first, then includes
    const col: Record<string, number> = {};
    for (const [field, aliases] of Object.entries(headerMap)) {
      let idx = headerRow.findIndex((h) => aliases.some((a) => h === a));
      if (idx < 0) idx = headerRow.findIndex((h) => aliases.some((a) => h.includes(a)));
      if (idx >= 0) col[field] = idx;
    }
    // Fix: "qty on hand" must NOT match "qty on hand indicator"
    const qohExact = headerRow.findIndex((h) => h === "qty on hand");
    if (qohExact >= 0) col.qtyOnHand = qohExact;
    // Fix: "avg cost" must NOT match "avg cost indicator"
    const avgExact = headerRow.findIndex((h) => h === "avg cost");
    if (avgExact >= 0) col.avgCost = avgExact;

    // Fallback to positional mapping if no header matches (XLSX format)
    const hasHeaders = Object.keys(col).length > 5;
    if (!hasHeaders) {
      Object.assign(col, {
        location: 0, productType: 1, stockType: 2, dclass: 3,
        manufacturerCode: 4, manufacturerName: 5, model: 6, itemId: 7,
        mfgItemId: 8, description: 9, reorderPoint: 10, qtyOnHand: 11,
        qtyCommitted: 12, qtyAvailable: 13, priceRetail: 14, priceCommercial: 15,
        priceWholesale: 16, priceBase: 17, priceList: 18, priceAdj: 19,
        lastCost: 20, avgCost: 21, stdCost: 22, fet: 23, extendedValue: 24,
      });
    }
    const g = (row: unknown[], field: string) => col[field] !== undefined ? String((row as any)[col[field]] ?? "") : "";
    const gn = (row: unknown[], field: string) => col[field] !== undefined ? num((row as any)[col[field]]) : 0;

    // Parse all rows
    let items = [];
    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i] as (string | number | undefined)[];
      if (!row[0] && !row[1]) continue;

      items.push({
        location: g(row, "location"),
        productType: g(row, "productType"),
        stockType: gn(row, "stockType"),
        dclass: col.dclass !== undefined ? decodeDclass(g(row, "dclass") || "Blank") : (() => { const id = g(row, "itemId"); const last = id.slice(-1); const dm: Record<string,string> = {".":"Dot","^":"Caret","[":"Bracket",":":"Colon","-":"Dash","~":"Tilde","*":"Star","#":"Hash"}; return dm[last] || ""; })(),
        manufacturerCode: g(row, "manufacturerCode"),
        manufacturerName: brandCodeToName(g(row, "manufacturerName")),
        model: g(row, "model"),
        itemId: g(row, "itemId"),
        mfgItemId: g(row, "mfgItemId"),
        description: g(row, "description"),
        reorderPoint: gn(row, "reorderPoint"),
        qtyOnHand: gn(row, "qtyOnHand"),
        qtyCommitted: gn(row, "qtyCommitted"),
        qtyAvailable: gn(row, "qtyAvailable"),
        priceRetail: gn(row, "priceRetail"),
        priceCommercial: gn(row, "priceCommercial"),
        priceWholesale: gn(row, "priceWholesale"),
        priceBase: gn(row, "priceBase"),
        priceList: gn(row, "priceList"),
        priceAdj: gn(row, "priceAdj"),
        lastCost: gn(row, "lastCost"),
        avgCost: gn(row, "avgCost"),
        stdCost: gn(row, "stdCost"),
        fet: gn(row, "fet"),
        extendedValue: gn(row, "extendedValue") || (gn(row, "qtyOnHand") * gn(row, "avgCost")),
      });
    }

    // Collect filter options from full data
    const locations = [...new Set(items.map((i) => i.location))].sort();
    const brands = [...new Set(items.map((i) => i.manufacturerName))].sort();
    const productTypes = [...new Set(items.map((i) => i.productType))].sort();
    const dclasses = [...new Set(items.map((i) => i.dclass))].sort();

    // Apply filters
    if (filterLocation) items = items.filter((i) => i.location === filterLocation);
    if (filterBrand) items = items.filter((i) => i.manufacturerName === filterBrand);
    if (filterProductType) items = items.filter((i) => i.productType === filterProductType);
    if (filterDclass) items = items.filter((i) => i.dclass === filterDclass);

    return NextResponse.json({
      items,
      filters: { locations, brands, productTypes, dclasses },
      fileDate,
      fileName: fileKey.split("/").pop(),
      totalRows: items.length,
      staleWarning,
    });
  } catch (err) {
    console.error("Inventory data error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load inventory data" }, { status: 500 });
  }
}
