import { NextRequest, NextResponse } from "next/server";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { activityYMD, parseCSVRow } from "@/lib/dealerRebates/aggregate";
import { sendPipelineAlert } from "@/lib/pipelineAlert";

/**
 * GET /api/dealer-rebates/verify?month=YYYYMM
 *
 * Audits the Falken/Milestar submission files already sitting in S3 for a month.
 * These are the two checks that actually caught the 2026-08-03 damage when run by
 * hand; running them by hand is not a control, so they live here.
 *
 * SCOPING — every <Name>_YYYY-MM-DD.csv must contain only rows dated that day.
 *   Caught: auto-process named one file after the earliest activity date in the
 *   upload and wrote the whole month into it, so Falken_Fanatic_2026-07-01.csv held
 *   330 rows spanning 23 dates and had overwritten July 1's real submission. The
 *   bucket had no versioning, so the original was unrecoverable.
 *
 * RECONCILIATION — submitted quantity must equal the source quantity recorded on
 * the upload record.
 *   Caught: dedup keyed on SKU|dealer|invoice|date and overwrote, collapsing two
 *   legitimate lines for the same SKU on one invoice. July shipped 1004 tires
 *   against 1010 actual, with nothing anywhere reporting a discrepancy.
 *
 * Deliberately audits the ARTIFACTS rather than asserting inside the writer, so it
 * also catches drift from any other writer, a manual S3 edit, or a future bug in a
 * path that does not exist yet.
 *
 * Returns 200 when both pass, 409 when either fails, and alerts on failure.
 */

const BUCKET = "ietires-dunlop-jmk-uploads";
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";
const CRON_SECRET = process.env.CRON_SECRET;

const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }
    : {}),
});

const PROGRAMS = [
  { program: "falken" as const, label: "Falken_Fanatic", dateCol: "Date", qtyCol: "Quantity" },
  { program: "milestar" as const, label: "Milestar_Momentum", dateCol: "InvoiceDate", qtyCol: "Quantity" },
];

/** Parse a submission CSV into header-keyed rows using the shared quoted-CSV splitter. */
function readRows(csv: string): Record<string, string>[] {
  const lines = csv.replace(/^﻿/, "").trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCSVRow(lines[0]).map((h) => h.trim());
  return lines.slice(1).filter((l) => l.trim()).map((l) => {
    const cells = parseCSVRow(l);
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = (cells[i] ?? "").trim(); });
    return o;
  });
}

export async function GET(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Default to the prior month, matching the cadence the monthly submissions run on.
  const qMonth = request.nextUrl.searchParams.get("month");
  let month = qMonth ?? "";
  if (!month) {
    const now = new Date();
    const prior = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    month = `${prior.getFullYear()}${String(prior.getMonth() + 1).padStart(2, "0")}`;
  }
  if (!/^\d{6}$/.test(month)) {
    return NextResponse.json({ error: "month must be YYYYMM" }, { status: 400 });
  }
  const monthPrefix = `${month.slice(0, 4)}-${month.slice(4, 6)}`;

  try {
    const convex = new ConvexHttpClient(CONVEX_URL);
    const uploads = (await convex.query(api.dealerRebates.getUploads, {})) as Array<Record<string, unknown>>;

    const failures: string[] = [];
    const report: Record<string, unknown> = { month: monthPrefix };

    for (const { program, label, dateCol, qtyCol } of PROGRAMS) {
      // --- gather this month's submission files -----------------------------
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const res = await s3.send(new ListObjectsV2Command({
          Bucket: BUCKET, Prefix: `dealer-rebates/${program}/${label}_${monthPrefix}-`, ContinuationToken: token,
        }));
        for (const o of res.Contents || []) if (o.Key?.endsWith(".csv")) keys.push(o.Key);
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);

      let rowCount = 0;
      let qty = 0;
      const misScoped: { file: string; expected: string; found: string[] }[] = [];

      for (const key of keys) {
        const body = await (await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))).Body
          ?.transformToString("utf-8");
        if (!body) continue;
        const rows = readRows(body);
        rowCount += rows.length;

        const fileDay = key.slice(key.lastIndexOf("_") + 1, key.length - 4); // YYYY-MM-DD
        const days = new Set<string>();
        for (const r of rows) {
          qty += parseFloat(r[qtyCol] || "0") || 0;
          const d = activityYMD(r[dateCol] || "");
          if (d) days.add(d);
        }
        if (days.size > 0 && (days.size > 1 || !days.has(fileDay))) {
          misScoped.push({ file: key, expected: fileDay, found: [...days].sort().slice(0, 5) });
        }
      }

      // --- reconcile against the source upload record -----------------------
      // Newest record for this program whose breakdown covers the target month.
      const rec = uploads.find((u) => {
        if (u.program !== program) return false;
        const bd = (u.dealerBreakdown as Array<{ month?: string }> | undefined) ?? [];
        return bd.some((b) => b.month === monthPrefix);
      });
      const expectedQty = rec
        ? ((rec.dealerBreakdown as Array<{ month?: string; qty?: number }>)
            .filter((b) => b.month === monthPrefix)
            .reduce((s, b) => s + (b.qty ?? 0), 0))
        : null;

      report[program] = {
        files: keys.length, rows: rowCount, submittedQty: qty,
        expectedQty, sourceFile: rec?.fileName ?? null,
        misScopedFiles: misScoped.length, misScoped: misScoped.slice(0, 5),
      };

      if (misScoped.length > 0) {
        failures.push(
          `${program}: ${misScoped.length} file(s) contain rows outside their filename day ` +
          `(e.g. ${misScoped[0].file} expects ${misScoped[0].expected}, found ${misScoped[0].found.join(", ")})`,
        );
      }
      if (expectedQty === null) {
        // Not a failure: a month may legitimately have no upload record to compare to.
        report[`${program}Note`] = "no upload record covers this month — reconciliation skipped";
      } else if (Math.abs(qty - expectedQty) > 0.001) {
        failures.push(
          `${program}: submitted ${qty} tires but source records ${expectedQty} ` +
          `(delta ${qty - expectedQty}) from ${rec?.fileName}`,
        );
      }
    }

    const ok = failures.length === 0;
    if (!ok) {
      await sendPipelineAlert({
        subject: `Dealer-rebate submission check FAILED for ${monthPrefix}`,
        lines: [
          `Month: ${monthPrefix}`,
          "",
          ...failures.map((f) => `- ${f}`),
          "",
          "Rebuild with: POST /api/dealer-rebates/regenerate-outputs {\"month\":\"" + month + "\"}",
          JSON.stringify(report, null, 2),
        ],
      });
    }

    return NextResponse.json({ ok, failures, ...report }, { status: ok ? 200 : 409 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sendPipelineAlert({
      subject: `Dealer-rebate submission check ERRORED for ${monthPrefix}`,
      lines: [`The check itself failed, so the submissions are UNVERIFIED.`, "", message],
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
