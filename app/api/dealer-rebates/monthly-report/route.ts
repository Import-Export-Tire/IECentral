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
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Daily submission files are named <Label>_YYYY-MM-DD.csv. Match those (not the
// consolidated <Label>_<Quarter>.csv files this endpoint generates).
const dailyRe = (label: string) => new RegExp(`^${label}_(\\d{4})-(\\d{2})-\\d{2}\\.csv$`);

// "2026-04" -> "2026-Q2"
function monthToQuarter(month: string): string {
  const [y, m] = month.split("-");
  return `${y}-Q${Math.floor((+m - 1) / 3) + 1}`;
}
// "2026-Q2" -> ["2026-04","2026-05","2026-06"]
function quarterMonths(quarter: string): string[] {
  const [y, qStr] = quarter.split("-Q");
  const q = +qStr;
  const start = (q - 1) * 3 + 1;
  return [start, start + 1, start + 2].map((m) => `${y}-${String(m).padStart(2, "0")}`);
}
function quarterFileName(label: string, quarter: string): string {
  return `${label}_${quarter}.csv`; // e.g. Falken_Fanatic_2026-Q2.csv
}
function quarterRange(quarter: string): string {
  const [y, qStr] = quarter.split("-Q");
  const start = (+qStr - 1) * 3;
  return `${MONTH_ABBR[start]}–${MONTH_ABBR[start + 2]} ${y}`;
}

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

/**
 * GET /api/dealer-rebates/monthly-report
 *   ?list=1                          → JSON: available { program, display, quarter, range, label, fileName, days, months }
 *   ?program=falken&quarter=2026-Q2  → streams ONE consolidated CSV for the whole quarter (all months, all dealers)
 *
 * One report per program per quarter — matches how the Fanatic/Momentum portals track
 * submissions (e.g. 2026Q2). Consolidates the quarter's daily files (header once + all
 * rows) on the fly from current S3 data, so it's always fresh with no stored artifacts.
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;

    // ── List mode ──
    if (sp.get("list") === "1" || (!sp.get("program") && !sp.get("quarter"))) {
      const reports: { program: string; display: string; quarter: string; range: string; label: string; fileName: string; days: number; months: number }[] = [];
      for (const [program, { label, display }] of Object.entries(PROGRAMS)) {
        const daily = await listDailyKeys(program, label);
        const byQuarter = new Map<string, { days: number; months: Set<string> }>();
        for (const d of daily) {
          const q = monthToQuarter(d.month);
          const e = byQuarter.get(q) ?? { days: 0, months: new Set<string>() };
          e.days += 1; e.months.add(d.month);
          byQuarter.set(q, e);
        }
        for (const [quarter, e] of byQuarter) {
          reports.push({ program, display, quarter, range: quarterRange(quarter), label, fileName: quarterFileName(label, quarter), days: e.days, months: e.months.size });
        }
      }
      reports.sort((a, b) => b.quarter.localeCompare(a.quarter) || a.program.localeCompare(b.program));
      return NextResponse.json({ reports });
    }

    // ── Download mode ──
    const program = (sp.get("program") || "").toLowerCase();
    const quarter = sp.get("quarter") || "";
    const prog = PROGRAMS[program];
    if (!prog) return NextResponse.json({ error: "program must be falken or milestar" }, { status: 400 });
    if (!/^\d{4}-Q[1-4]$/.test(quarter)) return NextResponse.json({ error: "quarter must be YYYY-Qn (e.g. 2026-Q2)" }, { status: 400 });

    const months = new Set(quarterMonths(quarter));
    const daily = (await listDailyKeys(program, prog.label)).filter((d) => months.has(d.month));
    if (daily.length === 0) return NextResponse.json({ error: `no daily files for ${program} ${quarter}` }, { status: 404 });
    daily.sort((a, b) => a.key.localeCompare(b.key)); // chronological (keys are date-named)

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
    const fileName = quarterFileName(prog.label, quarter);
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
