import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.iecentral.com";
const BUCKET = "ietires-dunlop-jmk-uploads";
const OEA07V_HEADER_COLS = ["Item Id", "Product Type", "MFG Id"];

const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }
    : {}),
});

function prevMonthOf(yyyymm: string): string {
  const y = +yyyymm.slice(0, 4), m = +yyyymm.slice(4, 6);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function POST(request: NextRequest) {
  try {
    const { uploadId, reportType, s3Key, month } = await request.json();

    if (!uploadId || !reportType || !s3Key) {
      return NextResponse.json({ error: "uploadId, reportType, s3Key required" }, { status: 400 });
    }

    const convex = new ConvexHttpClient(CONVEX_URL);
    const results: { trigger: string; status: string; message?: string; completedAt?: number }[] = [];

    // Update status to processing
    await convex.mutation(api.jmkUploads.updateProcessing, {
      uploadId: uploadId as Id<"jmkUploadHistory">,
      processingStatus: "processing",
    });

    // Process based on report type triggers
    if (reportType === "OEA07V") {
      // ─── Fail-safe: reject + notify if the file isn't a valid OEA07V ───
      const fileBody = (await (await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }))).Body?.transformToString("utf-8")) || "";
      const lines = fileBody.replace(/^﻿/, "").replace(/\0/g, "").split(/\r?\n/).filter((l) => l.trim());
      const header = (lines[0] || "").toLowerCase();
      const headersOk = OEA07V_HEADER_COLS.every((c) => header.includes(c.toLowerCase()));
      const hasDate = lines.slice(1, 2000).some((l) => {
        const cols = l.split(",");
        return /^\s*"?\d{1,2}\/\d{1,2}\/\d{2,4}"?\s*$/.test(cols[18] ?? "") || /(?:^|,)\s*"?\d{1,2}\/\d{1,2}\/\d{2,4}"?(?:,|$)/.test(l);
      });
      const reason = lines.length < 2 ? "File is empty or not a CSV"
        : !headersOk ? "Missing expected OEA07V columns (Item Id / Product Type / MFG Id)"
        : !hasDate ? "No rows with a parseable Activity Date (column S, MM/DD/YY)"
        : null;
      if (reason) {
        const upload = await convex.query(api.jmkUploads.getUpload, { uploadId: uploadId as Id<"jmkUploadHistory"> });
        await convex.mutation(api.jmkUploads.updateProcessing, {
          uploadId: uploadId as Id<"jmkUploadHistory">,
          processingStatus: "rejected",
          processingResults: [{ trigger: "validation", status: "failed", message: reason, completedAt: Date.now() }],
        });
        if (upload?.uploadedBy) {
          await convex.mutation(api.notifications.create, {
            userId: upload.uploadedBy,
            type: "report_rejected",
            title: "OEA07V upload rejected",
            message: `${upload.fileName || s3Key}: ${reason}`,
            link: "/reports/upload",
          });
        }
        return NextResponse.json({ status: "rejected", reason }, { status: 422 });
      }

      // Run all 3 triggers in parallel
      const [salesResult, wtdResult, rebateResult] = await Promise.allSettled([
        // Trigger 1: Sales refresh
        fetch(`${APP_URL}/api/sales/refresh`, {
          headers: { Authorization: `Bearer ${process.env.CRON_SECRET || ""}` },
        }).then(async (r) => ({ ok: r.ok, data: await r.json() })),

        // Trigger 2: WTD Commission
        fetch(`${APP_URL}/api/wtd-commission/daily-run`, {
          headers: { Authorization: `Bearer ${process.env.CRON_SECRET || ""}` },
        }).then(async (r) => ({ ok: r.ok, data: await r.json() })),

        // Trigger 3: Dealer Rebates
        fetch(`${APP_URL}/api/dealer-rebates/auto-process`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ s3Key }),
        }).then(async (r) => ({ ok: r.ok, data: await r.json() })),
      ]);

      // Sales refresh result
      if (salesResult.status === "fulfilled") {
        const { ok, data } = salesResult.value;
        results.push({ trigger: "sales-refresh", status: ok ? "success" : "failed", message: ok ? `Processed ${data.rowCount || 0} rows` : data.error, completedAt: Date.now() });
      } else {
        results.push({ trigger: "sales-refresh", status: "failed", message: salesResult.reason?.message || "Failed", completedAt: Date.now() });
      }

      // WTD Commission result
      if (wtdResult.status === "fulfilled") {
        const { ok, data } = wtdResult.value;
        results.push({ trigger: "wtd-commission", status: ok ? "success" : "failed", message: ok ? `Generated ${data.reportsGenerated || 0} reports` : data.error, completedAt: Date.now() });
      } else {
        results.push({ trigger: "wtd-commission", status: "failed", message: wtdResult.reason?.message || "Failed", completedAt: Date.now() });
      }

      // Dealer Rebates result
      if (rebateResult.status === "fulfilled") {
        const { ok, data } = rebateResult.value;
        const summary = ok ? (data.results || []).map((r: any) => `${r.type}: ${r.rows} rows, ${r.dealers} dealers`).join("; ") : data.error;
        results.push({ trigger: "dealer-rebates", status: ok ? "success" : "failed", message: summary || "No qualifying transactions", completedAt: Date.now() });
      } else {
        results.push({ trigger: "dealer-rebates", status: "failed", message: rebateResult.reason?.message || "Failed", completedAt: Date.now() });
      }

      // Refresh the deduped monthly rebate stats for the affected month(s) — absorbs
      // generic-named days and collapses overlapping re-exports. Fire-and-forget.
      if (month && /^\d{6}$/.test(month)) {
        await Promise.allSettled([month, prevMonthOf(month)].map((mm) =>
          fetch(`${APP_URL}/api/dealer-rebates/rebuild-month`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: mm }),
          }),
        ));
      }
    }

    // Update with results
    const allSuccess = results.every((r) => r.status === "success");
    await convex.mutation(api.jmkUploads.updateProcessing, {
      uploadId: uploadId as Id<"jmkUploadHistory">,
      processingStatus: allSuccess ? "complete" : "failed",
      processingResults: results,
    });

    return NextResponse.json({ status: allSuccess ? "complete" : "partial", results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Processing error" }, { status: 500 });
  }
}
