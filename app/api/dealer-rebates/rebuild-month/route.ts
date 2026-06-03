import { NextRequest, NextResponse } from "next/server";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { buildMonthlyRows } from "@/lib/dealerRebates/dedup";
import type { RebateDealer } from "@/lib/dealerRebates/aggregate";

const BUCKET = "ietires-dunlop-jmk-uploads";
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";
const MAX_FILE_BYTES = 50 * 1024 * 1024; // skip full-year dumps (~400k rows); month filter would drop them anyway

const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }
    : {}),
});

function nextMonth(yyyymm: string): string {
  const y = +yyyymm.slice(0, 4), m = +yyyymm.slice(4, 6);
  const d = new Date(y, m, 1); // m (1-based) as Date month index = next month
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * POST /api/dealer-rebates/rebuild-month  { month: "YYYYMM" }
 * Reads ALL OEA07V files for the month (and the next month, for boundary activity),
 * dedups matched invoice-lines, and writes the deduped per-(dealer,month) aggregates
 * to dealerRebateMonthly (the stats source of truth). Idempotent.
 */
export async function POST(request: NextRequest) {
  try {
    const { month } = await request.json();
    if (!month || !/^\d{6}$/.test(month)) return NextResponse.json({ error: "month YYYYMM required" }, { status: 400 });
    const targetMonth = `${month.slice(0, 4)}-${month.slice(4, 6)}`;

    const convex = new ConvexHttpClient(CONVEX_URL);
    const dealers = (await convex.query(api.dealerRebates.listDealers, {})) as RebateDealer[];

    const prefixes = [`jmk-uploads/${month}/`, `jmk-uploads/${nextMonth(month)}/`];
    const objs: { Key: string; LastModified?: Date; Size?: number }[] = [];
    for (const Prefix of prefixes) {
      let token: string | undefined;
      do {
        const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix, ContinuationToken: token }));
        for (const o of r.Contents || []) {
          const k = (o.Key || "").toLowerCase();
          if (k.includes("iet-oea07v") && k.endsWith(".csv")) objs.push({ Key: o.Key!, LastModified: o.LastModified, Size: o.Size });
        }
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
    }
    objs.sort((a, b) => (a.LastModified?.getTime() ?? 0) - (b.LastModified?.getTime() ?? 0));

    const files: { csvText: string }[] = [];
    const skipped: string[] = [];
    for (const o of objs) {
      if ((o.Size ?? 0) > MAX_FILE_BYTES) { skipped.push(o.Key); continue; }
      const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: o.Key }));
      const body = await res.Body?.transformToString("utf-8");
      if (body) files.push({ csvText: body });
    }

    const rows = buildMonthlyRows(files, dealers, targetMonth);
    await convex.mutation(api.dealerRebates.setRebateMonthly, { month: targetMonth, rows });

    return NextResponse.json({
      status: "success",
      month: targetMonth,
      filesProcessed: files.length,
      filesSkipped: skipped,
      dealerRows: rows.length,
      totalQty: rows.reduce((s, r) => s + r.qty, 0),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "rebuild failed" }, { status: 500 });
  }
}
