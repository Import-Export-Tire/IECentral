import { NextRequest, NextResponse } from "next/server";
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { buildDedupedLines } from "@/lib/dealerRebates/dedup";
import type { RebateDealer, OutputRow } from "@/lib/dealerRebates/aggregate";

const BUCKET = "ietires-dunlop-jmk-uploads";
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const FALKEN_HEADERS = ["Falken_Distributor_Account_Number", "FANATIC_Dealer_Account_Number", "Distributor_Center_Address", "Distributor_Center_City", "Distributor_Center_State", "Distributor_Center_Postal_Code", "Invoice_Number", "SKU", "Date", "Quantity", "Price_Per_Tire"];
const MILESTAR_HEADERS = ["ParentDistributorNumber", "DistributorCenterNumber", "DealerNumber", "InvoiceNumber", "InvoiceDate", "ProductCode", "Quantity", "SellPricePerTire"];

const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } } : {}),
});

function nextMonth(yyyymm: string): string {
  const y = +yyyymm.slice(0, 4), m = +yyyymm.slice(4, 6);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function csvEscape(v: string | number): string {
  const s = String(v ?? "");
  return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCSV(headers: string[], rows: OutputRow[]): string {
  return [headers.join(","), ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(","))].join("\n");
}
// "M/D/YY" -> "YYYY-MM-DD" (for the per-day filename), or null.
function ymd(dateRaw: string): string | null {
  const m = String(dateRaw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let y = parseInt(m[3], 10); if (y < 100) y += 2000;
  return `${y}-${String(+m[1]).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
}

/**
 * POST /api/dealer-rebates/regenerate-outputs  { month: "YYYYMM", cleanupLegacy?: boolean }
 * Rebuilds the daily portal-submission CSVs for a month from DEDUPED source lines:
 * one file per brand per ACTIVITY DAY, named dealer-rebates/<program>/<Name>_YYYY-MM-DD.csv.
 * With cleanupLegacy, deletes the old run-date-named files (NNNNNNNN.csv, 8 digits).
 */
export async function POST(request: NextRequest) {
  try {
    const { month, cleanupLegacy } = await request.json();
    if (!month || !/^\d{6}$/.test(month)) return NextResponse.json({ error: "month YYYYMM required" }, { status: 400 });
    const targetMonth = `${month.slice(0, 4)}-${month.slice(4, 6)}`;

    const convex = new ConvexHttpClient(CONVEX_URL);
    const dealers = (await convex.query(api.dealerRebates.listDealers, {})) as RebateDealer[];

    // Gather source files (this month + next, for boundary activity).
    const objs: { Key: string; Size?: number; LastModified?: Date }[] = [];
    for (const Prefix of [`jmk-uploads/${month}/`, `jmk-uploads/${nextMonth(month)}/`]) {
      let token: string | undefined;
      do {
        const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix, ContinuationToken: token }));
        for (const o of r.Contents || []) {
          const k = (o.Key || "").toLowerCase();
          if (k.includes("iet-oea07v") && k.endsWith(".csv")) objs.push({ Key: o.Key!, Size: o.Size, LastModified: o.LastModified });
        }
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
    }
    objs.sort((a, b) => (a.LastModified?.getTime() ?? 0) - (b.LastModified?.getTime() ?? 0));
    const files: { csvText: string }[] = [];
    for (const o of objs) {
      if ((o.Size ?? 0) > MAX_FILE_BYTES) continue;
      const body = await (await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: o.Key }))).Body?.transformToString("utf-8");
      if (body) files.push({ csvText: body });
    }

    const { falken, milestar } = buildDedupedLines(files, dealers, targetMonth);

    const written: string[] = [];
    const writeDaily = async (program: "falken" | "milestar", rows: OutputRow[], headers: string[], dateField: string, label: string) => {
      const byDay = new Map<string, OutputRow[]>();
      for (const r of rows) {
        const day = ymd(r[dateField] as string);
        if (!day) continue;
        (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(r);
      }
      for (const [day, dayRows] of byDay) {
        const key = `dealer-rebates/${program}/${label}_${day}.csv`;
        await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: toCSV(headers, dayRows), ContentType: "text/csv" }));
        written.push(key);
      }
    };
    await writeDaily("falken", falken, FALKEN_HEADERS, "Date", "Falken_Fanatic");
    await writeDaily("milestar", milestar, MILESTAR_HEADERS, "InvoiceDate", "Milestar_Momentum");

    // Cleanup: delete legacy run-date-named files (8 consecutive digits, e.g. _06032026.csv).
    const deleted: string[] = [];
    if (cleanupLegacy) {
      for (const program of ["falken", "milestar"]) {
        const Prefix = `dealer-rebates/${program}/`;
        let token: string | undefined;
        const toDelete: { Key: string }[] = [];
        do {
          const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix, ContinuationToken: token }));
          for (const o of r.Contents || []) {
            if (o.Key && /_\d{8}\.csv$/.test(o.Key)) toDelete.push({ Key: o.Key });
          }
          token = r.IsTruncated ? r.NextContinuationToken : undefined;
        } while (token);
        for (let i = 0; i < toDelete.length; i += 1000) {
          const batch = toDelete.slice(i, i + 1000);
          if (batch.length) {
            await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: batch } }));
            deleted.push(...batch.map((b) => b.Key));
          }
        }
      }
    }

    return NextResponse.json({
      status: "success", month: targetMonth,
      filesRead: files.length, dailyFilesWritten: written.length, written,
      legacyDeleted: deleted.length,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "regenerate failed" }, { status: 500 });
  }
}
