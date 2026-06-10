import { NextRequest, NextResponse } from "next/server";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";

const BUCKET = "ietires-dunlop-jmk-uploads";

const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }
    : {}),
});

export const maxDuration = 60;

const PROGRAMS: Record<string, { label: string; display: string }> = {
  falken: { label: "Falken_Fanatic", display: "Falken Fanatic" },
  milestar: { label: "Milestar_Momentum", display: "Milestar Momentum" },
};
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Daily submission files are named <Label>_YYYY-MM-DD.csv. Match those (not the
// consolidated <Label>_<MonthName>_YYYY.csv files, which have no leading digit after the label_).
const dailyRe = (label: string) => new RegExp(`^${label}_(\\d{4})-(\\d{2})-\\d{2}\\.csv$`);

async function listDailyKeys(program: string, label: string): Promise<{ key: string; month: string }[]> {
  const prefix = `dealer-rebates/${program}/`;
  const re = dailyRe(label);
  const out: { key: string; month: string }[] = [];
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents || []) {
      const fn = (o.Key || "").split("/").pop() || "";
      const m = fn.match(re);
      if (m) out.push({ key: o.Key!, month: `${m[1]}-${m[2]}` });
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

function monthlyFileName(label: string, month: string): string {
  const [y, m] = month.split("-");
  return `${label}_${MONTH_NAMES[+m - 1]}_${y}.csv`;
}

/**
 * GET /api/dealer-rebates/monthly-report
 *   ?list=1                       → JSON: available { program, display, month, label, fileName } reports
 *   ?program=falken&month=2026-04 → streams the consolidated monthly CSV as a download
 *
 * Consolidates a month's daily submission CSVs (header once + all rows) on the fly from
 * the current files in S3 — always fresh, no stored/expiring artifacts.
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;

    // ── List mode ──
    if (sp.get("list") === "1" || (!sp.get("program") && !sp.get("month"))) {
      const reports: { program: string; display: string; month: string; label: string; fileName: string; days: number }[] = [];
      for (const [program, { label, display }] of Object.entries(PROGRAMS)) {
        const daily = await listDailyKeys(program, label);
        const byMonth = new Map<string, number>();
        for (const d of daily) byMonth.set(d.month, (byMonth.get(d.month) ?? 0) + 1);
        for (const [month, days] of byMonth) {
          reports.push({ program, display, month, label, fileName: monthlyFileName(label, month), days });
        }
      }
      reports.sort((a, b) => b.month.localeCompare(a.month) || a.program.localeCompare(b.program));
      return NextResponse.json({ reports });
    }

    // ── Download mode ──
    const program = (sp.get("program") || "").toLowerCase();
    const month = sp.get("month") || "";
    const prog = PROGRAMS[program];
    if (!prog) return NextResponse.json({ error: "program must be falken or milestar" }, { status: 400 });
    if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });

    const daily = (await listDailyKeys(program, prog.label)).filter((d) => d.month === month);
    if (daily.length === 0) return NextResponse.json({ error: `no daily files for ${program} ${month}` }, { status: 404 });
    daily.sort((a, b) => a.key.localeCompare(b.key));

    let header = "";
    const lines: string[] = [];
    for (const { key } of daily) {
      const body = await (await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))).Body?.transformToString("utf-8");
      if (!body) continue;
      const rows = body.replace(/^﻿/, "").trim().split(/\r?\n/);
      if (rows.length === 0) continue;
      if (!header) header = rows[0];
      lines.push(...rows.slice(1).filter((l) => l.trim()));
    }
    const csv = [header, ...lines].join("\r\n");
    const fileName = monthlyFileName(prog.label, month);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "monthly-report failed" }, { status: 500 });
  }
}
