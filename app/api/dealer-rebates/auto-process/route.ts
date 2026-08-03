import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { aggregate, activityYMD, type RebateDealer, type OutputRow } from "@/lib/dealerRebates/aggregate";

const BUCKET = "ietires-dunlop-jmk-uploads";
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";

const FALKEN_HEADERS = [
  "Falken_Distributor_Account_Number", "FANATIC_Dealer_Account_Number", "Distributor_Center_Address",
  "Distributor_Center_City", "Distributor_Center_State", "Distributor_Center_Postal_Code",
  "Invoice_Number", "SKU", "Date", "Quantity", "Price_Per_Tire",
];
const MILESTAR_HEADERS = [
  "ParentDistributorNumber", "DistributorCenterNumber", "DealerNumber", "InvoiceNumber",
  "InvoiceDate", "ProductCode", "Quantity", "SellPricePerTire",
];

const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }
    : {}),
});

function csvEscape(val: string | number): string {
  const s = String(val ?? "");
  return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(headers: string[], rows: OutputRow[]): string {
  return [headers.join(","), ...rows.map(r => headers.map(h => csvEscape(r[h])).join(","))].join("\n");
}

/**
 * POST /api/dealer-rebates/auto-process
 * Processes a daily OEA07V file: writes Falken/Milestar upload CSVs to S3 AND records
 * the run to dealerRebateUploads (so the Stats dashboard reflects automated ingestion).
 * Body: { s3Key }
 */
export async function POST(request: NextRequest) {
  try {
    const { s3Key } = await request.json();
    if (!s3Key) return NextResponse.json({ error: "s3Key required" }, { status: 400 });

    // 1. Download CSV from S3
    const getRes = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }));
    const body = await getRes.Body?.transformToString("utf-8");
    if (!body) return NextResponse.json({ error: "Empty file" }, { status: 400 });

    // 2. Load dealers and aggregate (shared logic — identical to the client uploader)
    const convex = new ConvexHttpClient(CONVEX_URL);
    const dealers = (await convex.query(api.dealerRebates.listDealers, {})) as RebateDealer[];
    const result = aggregate(body, dealers);

    const fileName = s3Key.split("/").pop() || s3Key;

    // Outputs are written one file per ACTIVITY DAY, keyed by each row's own date —
    // matching /api/dealer-rebates/regenerate-outputs, which is the source of truth
    // for this naming scheme.
    //
    // This previously named ONE file after `dateRangeStart` (the earliest date in the
    // upload) and wrote every row into it. That was fine for a single-day file, but a
    // month-spanning upload wrote the whole month into `<Name>_<first-day>.csv` and
    // silently overwrote that day's real submission. It happened twice: the June
    // monthly clobbered Falken_Fanatic_2026-06-01.csv, and the July monthly clobbered
    // Falken_Fanatic_2026-07-01.csv. Grouping by day makes daily and month-spanning
    // uploads converge on the same per-day keys instead of colliding.
    const writeDaily = async (
      program: "falken" | "milestar",
      rows: OutputRow[],
      headers: string[],
      dateField: string,
      label: string,
    ): Promise<string[]> => {
      const byDay = new Map<string, OutputRow[]>();
      for (const r of rows) {
        const day = activityYMD(String(r[dateField] ?? ""));
        if (!day) continue;
        const bucket = byDay.get(day);
        if (bucket) bucket.push(r);
        else byDay.set(day, [r]);
      }
      const keys: string[] = [];
      for (const [day, dayRows] of byDay) {
        const key = `dealer-rebates/${program}/${label}_${day}.csv`;
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET, Key: key, Body: toCSV(headers, dayRows), ContentType: "text/csv",
        }));
        keys.push(key);
      }
      return keys;
    };

    const results: { type: string; rows: number; qty: number; dealers: number; s3Key?: string }[] = [];

    // 3. Falken: write CSV to S3 + record stats
    if (result.falken.outRows.length > 0) {
      const csv = toCSV(FALKEN_HEADERS, result.falken.outRows);
      const keys = await writeDaily("falken", result.falken.outRows, FALKEN_HEADERS, "Date", "Falken_Fanatic");
      await convex.mutation(api.dealerRebates.saveUploadAuto, {
        fileName, program: "falken",
        totalInputRows: result.totalInputRows, filteredRows: result.filteredRows,
        matchedRows: result.falken.matchedRows, matchedQty: result.falken.matchedQty,
        dealersMatched: result.falken.dealersMatched, resultData: csv,
        dealerBreakdown: result.falken.breakdown,
        dateRangeStart: result.dateRangeStart, dateRangeEnd: result.dateRangeEnd, s3Key,
      });
      results.push({ type: "Falken", rows: result.falken.matchedRows, qty: result.falken.matchedQty, dealers: result.falken.dealersMatched, s3Key: keys.join(", ") });
    } else {
      results.push({ type: "Falken", rows: 0, qty: 0, dealers: 0 });
    }

    // 4. Milestar: write CSV to S3 + record stats
    if (result.milestar.outRows.length > 0) {
      const csv = toCSV(MILESTAR_HEADERS, result.milestar.outRows);
      const keys = await writeDaily("milestar", result.milestar.outRows, MILESTAR_HEADERS, "InvoiceDate", "Milestar_Momentum");
      await convex.mutation(api.dealerRebates.saveUploadAuto, {
        fileName, program: "milestar",
        totalInputRows: result.totalInputRows, filteredRows: result.filteredRows,
        matchedRows: result.milestar.matchedRows, matchedQty: result.milestar.matchedQty,
        dealersMatched: result.milestar.dealersMatched, resultData: csv,
        dealerBreakdown: result.milestar.breakdown,
        dateRangeStart: result.dateRangeStart, dateRangeEnd: result.dateRangeEnd, s3Key,
      });
      results.push({ type: "Milestar", rows: result.milestar.matchedRows, qty: result.milestar.matchedQty, dealers: result.milestar.dealersMatched, s3Key: keys.join(", ") });
    } else {
      results.push({ type: "Milestar", rows: 0, qty: 0, dealers: 0 });
    }

    return NextResponse.json({
      status: "success",
      totalInputRows: result.totalInputRows,
      tireRows: result.filteredRows,
      results,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Processing failed" }, { status: 500 });
  }
}
