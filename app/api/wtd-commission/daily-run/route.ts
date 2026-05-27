import { NextRequest, NextResponse } from "next/server";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { bestBrandLabel } from "@/lib/brandMapping";
import { buildTireDescription } from "@/lib/tireDescriptions";

const S3_BUCKET = "ietires-dunlop-jmk-uploads";
const S3_PREFIX = "jmk-uploads";
const SALES_BUCKET = "ietires-sales-data";
const CRON_SECRET = process.env.CRON_SECRET;
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";

const COL = {
  ITEM_ID: 0,
  DESCRIPTION: 1,
  PRODUCT_TYPE: 3,
  BRAND: 4,
  MFG_ITEM_ID: 5,
  QTY: 10,
  UNIT_COST: 11,
  EXT_COST: 12,
  UNIT_SELL: 13,
  ACCOUNT_ID: 15,
  INV_ID: 16,
  ACTIVITY_DATE: 18,
  CUSTOMER_NAME: 19,
} as const;

const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});

function parseActivityDate(dateStr: string): Date | null {
  const clean = dateStr.replace(/"/g, "").trim();
  const parts = clean.split("/");
  if (parts.length !== 3) return null;
  let [m, d, y] = parts.map(Number);
  if (isNaN(m) || isNaN(d) || isNaN(y) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 100) y += 2000;
  return new Date(y, m - 1, d);
}

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

interface CustomerConfig {
  _id: string;
  customerName: string;
  customerNumber: string;
  qualifyingDclasses: string[];
  qualifyingBrands: string[];
  commissionType: string;
  commissionValue: number;
}

/**
 * GET /api/wtd-commission/daily-run
 *
 * Automated daily job (4 AM EST via Vercel cron):
 * 1. Fetches yesterday's OEA07V data from S3
 * 2. For each active customer config, generates a commission report
 * 3. Saves reports to Convex + S3
 * 4. If no data for a customer, saves a "no data" marker
 */
export async function GET(request: NextRequest) {
  // Verify cron secret
  if (CRON_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    // Yesterday's date
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const targetDate = yesterday.toISOString().split("T")[0];
    const targetMonth = `${yesterday.getFullYear()}${String(yesterday.getMonth() + 1).padStart(2, "0")}`;

    // Find latest OEA07V file — check current month, then previous month
    // (OEA07V files are cumulative and may contain cross-month data)
    const prevMonth = new Date(yesterday);
    prevMonth.setMonth(prevMonth.getMonth() - 1);
    const prevMonthStr = `${prevMonth.getFullYear()}${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;

    let matches: { Key?: string; LastModified?: Date }[] = [];
    for (const month of [targetMonth, prevMonthStr]) {
      const prefix = `${S3_PREFIX}/${month}/`;
      const listRes = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix }));
      const found = (listRes.Contents || [])
        .filter(obj => obj.Key?.toLowerCase().includes("iet-oea07v") && obj.Key?.toLowerCase().endsWith(".csv"));
      if (found.length > 0) {
        matches = found.sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0));
        break;
      }
    }

    if (matches.length === 0) {
      // No OEA07V file — save "no data" for all customers
      const convex = new ConvexHttpClient(CONVEX_URL);
      const customers = await convex.query(api.wtdCommission.getActiveCustomers) as CustomerConfig[];

      for (const config of customers) {
        await convex.mutation(api.wtdCommission.saveReport, {
          customerName: config.customerName,
          customerNumber: config.customerNumber,
          startDate: targetDate,
          endDate: targetDate,
          commissionType: config.commissionType,
          commissionValue: config.commissionValue,
          lineItems: [],
          grandTotal: 0,
          // generatedBy omitted for automated runs
          generatedByName: "Automated Daily Run",
        });
      }

      return NextResponse.json({
        status: "no_data",
        message: `No OEA07V file found for ${targetMonth}`,
        date: targetDate,
        customersProcessed: customers.length,
      });
    }

    // Download and parse ALL OEA07V files (not just latest), deduplicating rows
    const rowsByDate = new Map<string, string[][]>();
    const seenRows = new Set<string>();
    let totalFilesProcessed = 0;

    for (const match of matches.filter(m => !(m as any).Size || (m as any).Size < 50 * 1024 * 1024)) { // Skip >50MB
      const fileKey = match.Key!;
      try {
        const getRes = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: fileKey }));
        const body = await getRes.Body?.transformToString("utf-8");
        if (!body) continue;

        const allRows = parseCSV(body.replace(/^\uFEFF/, "").replace(/\0/g, ""));
        const dataRows = allRows.slice(1);
        totalFilesProcessed++;

        for (const row of dataRows) {
          if (row.length <= COL.ACTIVITY_DATE) continue;
          const d = parseActivityDate(row[COL.ACTIVITY_DATE]?.trim() || "");
          if (!d) continue;
          const dateKey = d.toISOString().split("T")[0];

          // Deduplicate: same date + invoice + item + qty = same transaction
          const dedupKey = `${dateKey}|${(row[COL.INV_ID] || "").trim()}|${(row[COL.ITEM_ID] || "").trim()}|${(row[COL.QTY] || "").trim()}`;
          if (!seenRows.has(dedupKey)) {
            seenRows.add(dedupKey);
            if (!rowsByDate.has(dateKey)) rowsByDate.set(dateKey, []);
            rowsByDate.get(dateKey)!.push(row);
          }
        }
      } catch { /* skip unreadable files */ }
    }

    const uniqueDates = [...rowsByDate.keys()].sort();

    // Load tire catalog for enriched descriptions + per-unit FET
    const tireLookup = new Map<string, { mfgName: string; model: string; desc: string; fet: number }>();
    try {
      const tireList = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: "jmk-uploads/tires/", MaxKeys: 100 }));
      const tireFiles = (tireList.Contents || []).filter(o => o.Key?.includes("tires-") && o.Key?.endsWith(".csv")).sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0));
      if (tireFiles.length > 0) {
        const tireRes = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: tireFiles[0].Key! }));
        const tireText = await tireRes.Body?.transformToString("utf-8") || "";
        const tireLines = tireText.replace(/^\uFEFF/, "").split("\n");
        const th = tireLines[0].split(",").map(h => h.replace(/"/g, "").trim().toLowerCase());
        const ti = { itemId: th.findIndex(h => h.includes("item id") || h.includes("itemid") || h === "sku"), mfgName: th.findIndex(h => h.includes("brand") || h.includes("mfg name") || h.includes("manufacturer")), model: th.findIndex(h => h === "model"), size: th.findIndex(h => h.includes("size")), li: th.findIndex(h => h.includes("load index")), sr: th.findIndex(h => h.includes("speed rating")), sw: th.findIndex(h => h.includes("sidewall")), xl: th.findIndex(h => h.includes("xl/rf") || h.includes("xlrf")), ply: th.findIndex(h => h.includes("ply rating") || h.includes("load range")), fet: th.findIndex(h => h === "fet") };
        for (let i = 1; i < tireLines.length; i++) {
          const c = tireLines[i].split(",").map(v => v.replace(/"/g, "").trim());
          const id = ti.itemId >= 0 ? c[ti.itemId] : "";
          if (!id) continue;
          const tire = { mfgName: ti.mfgName >= 0 ? c[ti.mfgName] : "", model: ti.model >= 0 ? c[ti.model] : "", size: ti.size >= 0 ? c[ti.size] : "", loadIndex: ti.li >= 0 ? c[ti.li] : "", speedRating: ti.sr >= 0 ? c[ti.sr] : "", sidewall: ti.sw >= 0 ? c[ti.sw] : "", xlrf: ti.xl >= 0 ? c[ti.xl] : "", plyRating: ti.ply >= 0 ? c[ti.ply] : "" };
          const fet = ti.fet >= 0 ? (parseFloat(c[ti.fet]) || 0) : 0;
          const desc = buildTireDescription(tire);
          tireLookup.set(id, { mfgName: tire.mfgName, model: tire.model, desc, fet });
          tireLookup.set(id.replace(/[.\^\[:\-~*#]$/, ""), { mfgName: tire.mfgName, model: tire.model, desc, fet });
        }
      }
    } catch { /* best effort */ }

    // Get active customer configs from Convex
    const convex = new ConvexHttpClient(CONVEX_URL);
    const customers = await convex.query(api.wtdCommission.getActiveCustomers) as CustomerConfig[];

    // Check existing reports to avoid duplicates
    const existingReports = await convex.query(api.wtdCommission.listReports) as { startDate: string; customerNumber: string }[];
    const existingKeys = new Set(existingReports.map(r => `${r.startDate}:${r.customerNumber}`));

    const results = [];

    // Generate a separate report for each date × each customer
    for (const dateKey of uniqueDates) {
      const dateRows = rowsByDate.get(dateKey)!;

      for (const config of customers) {
        // Skip if report already exists for this date+customer
        if (existingKeys.has(`${dateKey}:${config.customerNumber}`)) continue;

        // Filter qualifying rows for this customer
        const qualifying = dateRows.filter(row => {
          const itemId = row[COL.ITEM_ID]?.replace(/"/g, "").trim() || "";
          const accountId = row[COL.ACCOUNT_ID]?.replace(/"/g, "").trim() || "";
          const brand = row[COL.BRAND]?.replace(/"/g, "").trim() || "";

          if (accountId.toUpperCase() !== config.customerNumber.toUpperCase()) return false;

          // Only tire product types (starts with T but not T alone)
          const pt = row[COL.PRODUCT_TYPE]?.replace(/"/g, "").trim() || "";
          if (!pt.startsWith("T") || pt === "T") return false;

          // Exclude warehouse transfers and internal accounts
          if (["700", "7001", "7002"].includes(accountId.toUpperCase())) return false;
          if (/^[WR]\d{2}[WR]\d{2}$/i.test(accountId)) return false;
          if (/^[WR]\d{2}$/i.test(accountId)) return false;

          if (config.qualifyingDclasses.length > 0) {
            if (!config.qualifyingDclasses.some(suffix => itemId.endsWith(suffix))) return false;
          }

          if (!config.qualifyingBrands.includes("ALL")) {
            if (!config.qualifyingBrands.some(b => b.toUpperCase() === brand.toUpperCase())) return false;
          }

          return true;
        });

        // Calculate commission for each line
        // Sales (Sld) have negative qty/cost, returns (Adj/RS) have positive
        // Negate so sales = positive commission, returns = negative commission
        const lineItems = qualifying.map(row => {
          const rawQty = parseFloat(row[COL.QTY]?.replace(/"/g, "").trim() || "0") || 0;
          const rawExtCost = parseFloat(row[COL.EXT_COST]?.replace(/"/g, "").trim() || "0") || 0;
          const unitCost = Math.abs(parseFloat(row[COL.UNIT_COST]?.replace(/"/g, "").trim() || "0") || 0);
          const qty = -rawQty;           // Negate: sold=-8 → display 8, return=2 → display -2
          const extCost = -rawExtCost;   // Negate: sold=-1202 → 1202, return=80 → -80

          // OEA07V cost columns are FET-included (header literally says "FET In").
          // Look up per-unit FET from the tire catalog and back it out before the
          // commission calc, so we don't pay commission on tax. Items not in the
          // catalog default to fet=0 (no adjustment).
          const itemIdForFet = row[COL.ITEM_ID]?.replace(/"/g, "").trim() || "";
          const tireForFet = tireLookup.get(itemIdForFet) || tireLookup.get(itemIdForFet.replace(/[.\^\[:\-~*#]$/, ""));
          const perUnitFet = tireForFet?.fet ?? 0;
          const extCostExFet = extCost - perUnitFet * qty;

          let commissionAmount: number;
          if (config.commissionType === "percentage") {
            commissionAmount = extCostExFet * (config.commissionValue / 100);
          } else {
            commissionAmount = qty * config.commissionValue;
          }

          // $2.50 per-line minimum charge. Symmetric: a sale that calculates
          // below the floor is bumped to $2.50, and the matching return claws
          // back $2.50 too — so the return matches exactly what was credited
          // when the item was sold under the new rule.
          const MIN_COMMISSION = 2.5;
          if (commissionAmount > 0 && commissionAmount < MIN_COMMISSION) {
            commissionAmount = MIN_COMMISSION;
          } else if (commissionAmount < 0 && commissionAmount > -MIN_COMMISSION) {
            commissionAmount = -MIN_COMMISSION;
          }

          const itemId = row[COL.ITEM_ID]?.replace(/"/g, "").trim() || "";
          const tire = tireLookup.get(itemId) || tireLookup.get(itemId.replace(/[.\^\[:\-~*#]$/, ""));
          const rawBrand = row[COL.BRAND]?.replace(/"/g, "").trim() || "";

          return {
            orderNo: row[COL.INV_ID]?.replace(/"/g, "").trim() || "",
            brand: bestBrandLabel(rawBrand, tire?.mfgName),
            mfgItemId: row[COL.MFG_ITEM_ID]?.replace(/"/g, "").trim() || "",
            description: tire?.desc || row[COL.DESCRIPTION]?.replace(/"/g, "").trim() || "",
            qty,
            unitCost,
            commissionAmount: Math.round(commissionAmount * 100) / 100,
          };
        });

        const grandTotal = Math.round(lineItems.reduce((sum, li) => sum + li.commissionAmount, 0) * 100) / 100;

        // Save to Convex
        await convex.mutation(api.wtdCommission.saveReport, {
          customerName: config.customerName,
          customerNumber: config.customerNumber,
          startDate: dateKey,
          endDate: dateKey,
          commissionType: config.commissionType,
          commissionValue: config.commissionValue,
          lineItems,
          grandTotal,
          generatedByName: "Automated Daily Run",
        });

        // Save to S3
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const s3Key = `wtd-commission-reports/${config.customerNumber}/${dateKey}_${timestamp}.json`;
        await s3.send(new PutObjectCommand({
          Bucket: SALES_BUCKET,
          Key: s3Key,
          Body: JSON.stringify({
            customerName: config.customerName,
            customerNumber: config.customerNumber,
            date: dateKey,
            lineItems,
            grandTotal,
            generatedAt: new Date().toISOString(),
          }, null, 2),
          ContentType: "application/json",
        }));

        results.push({
          date: dateKey,
          customer: config.customerName,
          lineItemCount: lineItems.length,
          grandTotal,
          hasData: lineItems.length > 0,
        });
      }
    }

    return NextResponse.json({
      status: "success",
      dates: uniqueDates,
      filesProcessed: totalFilesProcessed,
      reportsGenerated: results.length,
      reports: results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("WTD daily run error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
