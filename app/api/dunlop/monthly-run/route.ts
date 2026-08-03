import { NextRequest, NextResponse } from "next/server";
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const BUCKET = "ietires-dunlop-jmk-uploads";
const API_GATEWAY_URL = process.env.DUNLOP_API_GATEWAY_URL || "https://jzdhz2de88.execute-api.us-east-1.amazonaws.com/prod";
const CRON_SECRET = process.env.CRON_SECRET;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.iecentral.com";

const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }
    : {}),
});

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else {
      if (ch === '"') inQ = true;
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
  if (field || current.length) { current.push(field); if (current.some(f => f.trim())) rows.push(current); }
  return rows;
}

/**
 * GET /api/dunlop/monthly-run
 *
 * Runs on the 1st of each month at 5 AM EST.
 * Combines all OEA07V daily files from the prior month,
 * deduplicates, uploads combined file to S3, and triggers Dunlop SFTP.
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
    // Calculate prior month, plus the current month folder where a monthly
    // upload may have landed if /reports/upload bucketed by today's date.
    const now = new Date();
    const priorMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthStr = `${priorMonth.getFullYear()}${String(priorMonth.getMonth() + 1).padStart(2, "0")}`;
    const currentMonthStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthLabel = `${priorMonth.getFullYear()}-${String(priorMonth.getMonth() + 1).padStart(2, "0")}`;
    const monthNames = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];
    const priorMonthName = monthNames[priorMonth.getMonth()];
    const priorMonthAbbr = priorMonthName.slice(0, 3);

    // Idempotency guard: never submit a month Dunlop has already accepted.
    //
    // Two paths can submit the same month. /reports/upload posts to /api/dunlop/run
    // the moment Michael uploads the monthly file (that is how June 2026 went out),
    // and this cron fires on the 1st at 14:00 UTC. The cron runs BEFORE the monthly
    // file exists — July's was uploaded on Aug 3 — so it falls through to combining
    // the prior month's dailies. That combine now succeeds, which means without this
    // check the cron would submit the dailies and the later upload would submit the
    // monthly file: two accepted submissions for one month, double-counting sellout.
    //
    // Treated as advisory: if history is unreachable we proceed rather than skip a
    // month, since a missed submission is worse than a duplicate we can see and
    // delete. A skip is reported as status "skipped" so it is visible, not silent.
    try {
      const histRes = await fetch(`${API_GATEWAY_URL}/dunlop/history`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (histRes.ok) {
        const hist = await histRes.json();
        const runs: Array<Record<string, unknown>> = Array.isArray(hist)
          ? hist
          : (hist.runs ?? hist.history ?? []);
        const already = runs.find(
          (r) => String(r.month) === monthStr &&
                 String(r.sftpStatus) === "success" &&
                 String(r.env) === "prod",
        );
        if (already) {
          return NextResponse.json({
            status: "skipped",
            reason: `${monthLabel} already submitted successfully`,
            month: monthStr,
            existingRun: {
              fileName: already.fileName, rows: already.rows,
              runBy: already.runBy, timestamp: already.timestamp,
            },
          });
        }
      } else {
        console.warn(`dunlop/monthly-run: history check returned ${histRes.status}; proceeding`);
      }
    } catch (e) {
      console.warn("dunlop/monthly-run: history check failed; proceeding", e);
    }

    // 0. Look in both folders for an explicit monthly file (FILENAME mentions the
    //    prior month name/abbr/key). If found, use it directly and skip the
    //    daily-combine step.
    //
    // The month tokens must be matched against the FILENAME, not the full S3 key.
    // Every object here lives under `jmk-uploads/<monthStr>/`, so testing the key
    // made `includes(monthStr)` always true — every daily file qualified as "an
    // explicit monthly file", and the newest-first sort then picked whichever
    // daily was uploaded last. On 2026-08-01 that was IET-oea07v_073026.csv, so
    // July's Dunlop sellout ran off a single day (25 rows) instead of the month,
    // and the SFTP submission failed. June only worked by luck: the real monthly
    // file happened to be the newest object at the time.
    //
    // With filename matching, a run on the 1st (before the monthly file is
    // uploaded) finds nothing here and correctly falls through to combining the
    // prior month's dailies below.
    let monthlyFileKey: string | null = null;
    for (const prefix of [`jmk-uploads/${monthStr}/`, `jmk-uploads/${currentMonthStr}/`]) {
      const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000 }));
      const hit = (list.Contents || [])
        .filter((o) => {
          if (!o.Key) return false;
          const k = o.Key.toLowerCase();
          if (!k.includes("iet-oea07v") || !k.endsWith(".csv")) return false;
          const base = k.slice(k.lastIndexOf("/") + 1);
          if (base.includes("monthly-combined")) return true;
          return base.includes(priorMonthName.toLowerCase()) ||
                 base.includes(priorMonthAbbr.toLowerCase()) ||
                 base.includes(monthStr);
        })
        .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0))[0];
      if (hit?.Key) { monthlyFileKey = hit.Key; break; }
    }

    // 1. Find all OEA07V files in the prior month folder (used either as the
    //    daily-combine input, or — if a monthlyFileKey was found above — only
    //    so we can report how many dailies existed).
    const prefix = `jmk-uploads/${monthStr}/`;
    const listRes = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000 }));
    const oea07vFiles = (listRes.Contents || [])
      .filter(o => o.Key?.toLowerCase().includes("iet-oea07v") && o.Key?.toLowerCase().endsWith(".csv"))
      .sort((a, b) => (a.LastModified?.getTime() ?? 0) - (b.LastModified?.getTime() ?? 0));

    // If we found an explicit monthly file, skip the combine step and use it directly.
    if (monthlyFileKey) {
      let fanaticJmks: string[];
      try {
        const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud");
        const dealers = await convex.query(api.dealerRebates.listDealers, { program: "falken", activeOnly: true });
        fanaticJmks = (dealers as any[])
          .filter((d) => d.fanaticId)
          .map((d) => d.jmk.toLowerCase().trim())
          .filter((jmk) => jmk && jmk !== "0");
      } catch (err) {
        // Do NOT submit to Dunlop without the Falken Fanatic exclusion list —
        // proceeding with no exclusions would over-report sellout. Abort instead.
        return NextResponse.json({
          status: "aborted", month: monthLabel,
          reason: "Could not load Falken Fanatic exclusion list from Convex; refusing to submit to Dunlop without it",
          error: err instanceof Error ? err.message : String(err),
        }, { status: 502 });
      }

      let dunlopResult: any = null;
      try {
        const res = await fetch(`${API_GATEWAY_URL}/dunlop/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            s3_key: monthlyFileKey, month: monthStr, env: "prod",
            runBy: "Monthly Auto-Run (explicit monthly file)", fanaticJmks,
          }),
        });
        dunlopResult = await res.json();
      } catch (err) {
        dunlopResult = { error: err instanceof Error ? err.message : "Lambda call failed" };
      }
      return NextResponse.json({
        status: "success",
        month: monthLabel,
        usedExplicitMonthly: monthlyFileKey,
        dailiesAvailable: oea07vFiles.length,
        dunlopResult,
      });
    }

    if (oea07vFiles.length === 0) {
      return NextResponse.json({
        status: "skipped",
        month: monthLabel,
        reason: "No OEA07V files found for prior month",
      });
    }

    // 2. Download and parse all files (oldest\u2192newest), deduping by invoice line.
    let header: string | null = null;
    // Key = itemId|accountId|invoiceId|activityDate (NO qty): if a later daily file
    // re-exports the same line with a corrected quantity, the newest value wins
    // (files are sorted oldest\u2192newest, so Map last-write keeps the latest).
    const rowByKey = new Map<string, string>();

    for (const obj of oea07vFiles) {
      if (!obj.Key) continue;
      const getRes = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
      const body = await getRes.Body?.transformToString("utf-8");
      if (!body) continue;

      const lines = body.replace(/^\uFEFF/, "").replace(/\0/g, "").split(/\r?\n/);

      // Keep header from first file
      if (!header && lines[0]) {
        header = lines[0];
      }

      // Parse rows; last (newest) occurrence of a line supersedes earlier ones.
      const rows = parseCSV(body.replace(/^\uFEFF/, "").replace(/\0/g, ""));
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 19) continue;

        const dedupKey = `${(row[0] || "").trim()}|${(row[15] || "").trim()}|${(row[16] || "").trim()}|${(row[18] || "").trim()}`;

        // Reconstruct the CSV line with proper escaping
        const csvLine = row.map(field => {
          const f = field.trim();
          return f.includes(",") || f.includes('"') ? `"${f.replace(/"/g, '""')}"` : f;
        }).join(",");
        rowByKey.set(dedupKey, csvLine);
      }
    }

    const allDataRows = [...rowByKey.values()];

    if (allDataRows.length === 0) {
      return NextResponse.json({
        status: "skipped",
        month: monthLabel,
        filesFound: oea07vFiles.length,
        reason: "No data rows after parsing",
      });
    }

    // 3. Upload combined file to S3
    const combinedCsv = [header, ...allDataRows].join("\n");
    const combinedKey = `jmk-uploads/${monthStr}/IET-oea07v-monthly-combined.csv`;
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: combinedKey,
      Body: combinedCsv,
      ContentType: "text/csv",
    }));

    // 4. Get Falken exclusion list
    let fanaticJmks: string[];
    try {
      const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud");
      const dealers = await convex.query(api.dealerRebates.listDealers, {
        program: "falken",
        activeOnly: true,
      });
      fanaticJmks = (dealers as any[])
        .filter((d) => d.fanaticId)
        .map((d) => d.jmk.toLowerCase().trim())
        .filter((jmk) => jmk && jmk !== "0");
    } catch (err) {
      // Do NOT submit to Dunlop without the Falken Fanatic exclusion list —
      // proceeding with no exclusions would over-report sellout. Abort instead.
      return NextResponse.json({
        status: "aborted", month: monthLabel,
        reason: "Could not load Falken Fanatic exclusion list from Convex; refusing to submit to Dunlop without it",
        error: err instanceof Error ? err.message : String(err),
      }, { status: 502 });
    }

    // 5. Trigger Dunlop Lambda
    let dunlopResult: any = null;
    try {
      const res = await fetch(`${API_GATEWAY_URL}/dunlop/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          s3_key: combinedKey,
          month: monthStr, // Lambda expects YYYYMM (parses month[:4]/month[4:6]); NOT monthLabel (YYYY-MM)
          env: "prod",
          runBy: "Monthly Auto-Run",
          fanaticJmks,
        }),
      });
      dunlopResult = await res.json();
    } catch (err) {
      dunlopResult = { error: err instanceof Error ? err.message : "Lambda call failed" };
    }

    return NextResponse.json({
      status: "success",
      month: monthLabel,
      filesProcessed: oea07vFiles.length,
      totalRows: allDataRows.length,
      deduplicated: rowByKey.size,
      combinedS3Key: combinedKey,
      dunlopResult,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Monthly run failed" }, { status: 500 });
  }
}
