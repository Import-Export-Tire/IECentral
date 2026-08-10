"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

interface SeriesRow {
  bucket: string;
  totalTires: number;
  totalDollars: number;
  [k: string]: string | number;
}

interface ApiResp {
  series: SeriesRow[];
  locations: string[];
  perLocation: { location: string; tires: number; dollars: number; transfersOut?: number; transfersOutDollars?: number }[];
  totals: { tires: number; dollars: number; transfersOut?: number; transfersOutDollars?: number };
  startDate: string;
  endDate: string;
}

// Every "last 8 weeks" chart on this page shares one window so the X axes align.
const WEEKS = 8;

const PALETTE = ["#007AFF", "#34C759", "#FF9500", "#AF52DE", "#FF3B30", "#5AC8FA", "#FFCC00", "#FF2D55", "#5856D6", "#A2845E"];
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function startOfMonth(d: Date): Date { const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }
function endOfMonth(d: Date): Date   { const x = new Date(d.getFullYear(), d.getMonth() + 1, 0); x.setHours(0,0,0,0); return x; }
function startOfWeek(d: Date): Date {
  // ISO week (Monday-based)
  const x = new Date(d); x.setHours(0,0,0,0);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}
function endOfWeek(d: Date): Date {
  const s = startOfWeek(d);
  const x = new Date(s); x.setDate(s.getDate() + 6);
  return x;
}
function addMonths(d: Date, n: number): Date { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
function fmtNum(v: number): string { return v.toLocaleString(undefined, { maximumFractionDigits: 0 }); }
function fmtCurrency(v: number): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
function deltaPct(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}
function dayLabel(iso8601: string): string {
  const [, m, d] = iso8601.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}
// Drop dead lines: a location with nothing in the window is a flat row of
// zeros that just crowds the legend. Applied per chart, because the sales set
// and the transfers-out set differ — a warehouse ships a lot and barely sells.
function nonZero(rows: Record<string, string | number>[], locs: string[]): string[] {
  return locs.filter(l => rows.some(r => Number(r[l] || 0) !== 0));
}

/**
 * One line per location over a shared X axis. Every chart on this page uses
 * this so colors, tooltips, and axis formatting stay identical between the
 * daily, weekly, monthly, and transfers-out views.
 */
function LocationLineChart({
  rows, xKey, locations, colorByLoc, isDark, fmt, height = 300, xTickFormatter,
}: {
  rows: Record<string, string | number>[];
  xKey: string;
  locations: string[];
  colorByLoc: Record<string, string>;
  isDark: boolean;
  fmt: (v: number) => string;
  height?: number;
  xTickFormatter?: (v: unknown) => string;
}) {
  if (rows.length === 0 || locations.length === 0) {
    return <p className="text-sm theme-text-tertiary py-12 text-center">No data in this window.</p>;
  }
  const tickColor = isDark ? "#94A3B8" : "#6B7280";
  const gridColor = isDark ? "#334155" : "#E5E7EB";
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
        <XAxis
          dataKey={xKey}
          tick={{ fill: tickColor, fontSize: 11 }}
          tickFormatter={xTickFormatter}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis tick={{ fill: tickColor, fontSize: 11 }} tickFormatter={(v: unknown) => fmt(Number(v))} />
        <Tooltip
          formatter={(value: unknown, name: unknown): [string, string] => [fmt(Number(value) || 0), String(name)]}
          labelFormatter={(v: unknown) => (xTickFormatter ? xTickFormatter(v) : String(v ?? ""))}
          contentStyle={{ background: isDark ? "#0F172A" : "#FFFFFF", border: `1px solid ${gridColor}`, borderRadius: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {locations.map(loc => (
          <Line
            key={loc}
            type="monotone"
            dataKey={loc}
            name={loc}
            stroke={colorByLoc[loc] || "#007AFF"}
            strokeWidth={2}
            // Dots only when the points are sparse enough to read — 56 daily
            // points per location turns into noise otherwise.
            dot={rows.length <= 14 ? { r: 2.5 } : false}
            activeDot={{ r: 4 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function SalesDashboardContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const today = useMemo(() => new Date(), []);
  const ytdStart = useMemo(() => `${today.getFullYear()}-01-01`, [today]);

  // The 8-week charts need eight full ISO weeks of history. In January and
  // February that reaches back past Jan 1, so widen the FETCH window rather
  // than silently truncating the charts. YTD figures still slice from Jan 1.
  // Ten weeks of slack, not eight: the OEA07V feed lags a day or two, so the
  // anchor week can sit behind the current one.
  const fetchStart = useMemo(() => {
    const back = startOfWeek(today);
    back.setDate(back.getDate() - 10 * 7);
    const backIso = iso(back);
    return backIso < ytdStart ? backIso : ytdStart;
  }, [today, ytdStart]);

  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [metric, setMetric] = useState<"tires" | "dollars">("tires");
  // No category selector: the metric toggle already carries the distinction.
  // "Tires" counts the tire category only (the API's tires_* fields), while
  // "Dollars" is every dollar taken across all categories.
  const [hiddenLocs, setHiddenLocs] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({
        startDate: fetchStart,
        endDate: iso(today),
        granularity: "day",
      });
      const res = await fetch(`/api/reports/sales-by-day?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [fetchStart, today]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const locations = data?.locations || [];
  const colorByLoc = useMemo(() => {
    const m: Record<string, string> = {};
    locations.forEach((l, i) => { m[l] = PALETTE[i % PALETTE.length]; });
    return m;
  }, [locations]);

  // Sum the requested metric across a date range, per location and total
  const sumRange = useCallback((startDate: Date, endDate: Date) => {
    if (!data) return { total: 0, perLoc: new Map<string, number>() };
    const keyMetric = metric === "tires" ? "tires_" : "dollars_";
    const start = iso(startDate);
    const end = iso(endDate);
    let total = 0;
    const perLoc = new Map<string, number>();
    for (const row of data.series) {
      if (row.bucket < start || row.bucket > end) continue;
      for (const loc of locations) {
        const v = Number(row[`${keyMetric}${loc}`] || 0);
        perLoc.set(loc, (perLoc.get(loc) || 0) + v);
        total += v;
      }
    }
    return { total, perLoc };
  }, [data, locations, metric]);

  // Sum the requested metric over a specific SET of dates (business-day aligned).
  const sumDates = useCallback((dates: string[]) => {
    if (!data || dates.length === 0) return { total: 0, perLoc: new Map<string, number>() };
    const set = new Set(dates);
    const keyMetric = metric === "tires" ? "tires_" : "dollars_";
    let total = 0;
    const perLoc = new Map<string, number>();
    for (const row of data.series) {
      if (!set.has(row.bucket)) continue;
      for (const loc of locations) {
        const v = Number(row[`${keyMetric}${loc}`] || 0);
        perLoc.set(loc, (perLoc.get(loc) || 0) + v);
        total += v;
      }
    }
    return { total, perLoc };
  }, [data, locations, metric]);

  // A "business day" = a date the company actually sold on (any activity). Defining
  // it empirically handles weekends, holidays, and Saturday-selling retail stores
  // without a hard-coded Mon-Fri rule; the feed also lags a day or two, so the latest
  // business day (not today) is the anchor.
  const bizDates = useMemo(() => {
    if (!data) return [] as string[];
    return data.series
      .filter((r) => (Number(r.totalTires) || 0) > 0 || (Number(r.totalDollars) || 0) > 0)
      .map((r) => r.bucket)
      .sort();
  }, [data]);
  const asOf = useMemo(
    () => (bizDates.length ? new Date(`${bizDates[bizDates.length - 1]}T00:00:00`) : today),
    [bizDates, today]
  );
  const bizIn = useCallback(
    (start: Date, end: Date) => {
      const s = iso(start), e = iso(end);
      return bizDates.filter((d) => d >= s && d <= e);
    },
    [bizDates]
  );

  // Business-day aligned: each period compares the SAME NUMBER of selling days —
  // week/month-to-date vs the prior week/month "through business day N".
  const thisMonthDates = bizIn(startOfMonth(asOf), asOf);
  const lastMonthStart = new Date(asOf.getFullYear(), asOf.getMonth() - 1, 1);
  const lastMonthDates = bizIn(lastMonthStart, endOfMonth(lastMonthStart)).slice(0, thisMonthDates.length);
  const thisWeekDates = bizIn(startOfWeek(asOf), asOf);
  const lastWeekAnchor = new Date(asOf); lastWeekAnchor.setDate(lastWeekAnchor.getDate() - 7);
  const lastWeekDates = bizIn(startOfWeek(lastWeekAnchor), endOfWeek(lastWeekAnchor)).slice(0, thisWeekDates.length);

  const thisMonth = sumDates(thisMonthDates);
  const lastMonth = sumDates(lastMonthDates);
  const thisWeek  = sumDates(thisWeekDates);
  const lastWeek  = sumDates(lastWeekDates);
  const ytd       = sumRange(new Date(asOf.getFullYear(), 0, 1), asOf);
  const ytdPrev   = sumRange(new Date(asOf.getFullYear() - 1, 0, 1), new Date(asOf.getFullYear() - 1, asOf.getMonth(), asOf.getDate()));

  // Per-month aggregation for the YTD bar chart
  const byMonth = useMemo(() => {
    if (!data) return [] as { month: string; label: string; total: number; perLoc: Record<string, number> }[];
    const map = new Map<string, { total: number; perLoc: Record<string, number> }>();
    const keyMetric = metric === "tires" ? "tires_" : "dollars_";
    for (const row of data.series) {
      // fetchStart can reach into last year to feed the 8-week charts; the
      // YTD-by-month chart must stay inside the current year.
      if (row.bucket < ytdStart) continue;
      const m = row.bucket.slice(0, 7); // YYYY-MM
      if (!map.has(m)) map.set(m, { total: 0, perLoc: {} });
      const cell = map.get(m)!;
      for (const loc of locations) {
        const v = Number(row[`${keyMetric}${loc}`] || 0);
        cell.perLoc[loc] = (cell.perLoc[loc] || 0) + v;
        cell.total += v;
      }
    }
    return [...map].sort().map(([m, v]) => {
      const [, mo] = m.split("-");
      return { month: m, label: MONTH_NAMES[parseInt(mo) - 1], ...v };
    });
  }, [data, locations, metric, ytdStart]);

  const fmt = metric === "tires" ? fmtNum : fmtCurrency;
  // The "tires" metric key still names the tires_* API fields, but the units it
  // counts now include parts, fees, dropship and wholesale — so show "units".
  const metricLabel = metric === "tires" ? "tires" : "dollars";

  const monthlySeries = useMemo(() => {
    return byMonth.map(m => {
      const row: Record<string, number | string> = { month: m.label };
      for (const loc of locations) row[loc] = m.perLoc[loc] || 0;
      row.total = m.total;
      return row;
    });
  }, [byMonth, locations]);

  // ── The shared 8-week window ──────────────────────────────────────────────
  // Eight ISO (Monday-based) weeks ending with the week that contains the
  // latest business day. Anchoring on asOf rather than today keeps the last
  // point from looking like a collapse when the feed is a day or two behind.
  const weekWindow = useMemo(() => {
    const out: { label: string; start: string; end: string }[] = [];
    for (let i = WEEKS - 1; i >= 0; i--) {
      const ref = new Date(asOf);
      ref.setDate(ref.getDate() - i * 7);
      const s = startOfWeek(ref);
      out.push({ label: dayLabel(iso(s)), start: iso(s), end: iso(endOfWeek(ref)) });
    }
    return out;
  }, [asOf]);

  // date → week index, so bucketing the daily series is a single pass.
  const weekIndexByDate = useMemo(() => {
    const m = new Map<string, number>();
    weekWindow.forEach((w, i) => {
      const d = new Date(`${w.start}T00:00:00`);
      for (let k = 0; k < 7; k++) { m.set(iso(d), i); d.setDate(d.getDate() + 1); }
    });
    return m;
  }, [weekWindow]);

  // Per-location weekly totals for a field prefix (sales or transfers out).
  const weeklyByLocation = useCallback((prefix: string) => {
    const rows = weekWindow.map(w => {
      const row: Record<string, string | number> = { week: w.label };
      for (const loc of locations) row[loc] = 0;
      return row;
    });
    if (!data) return rows;
    for (const r of data.series) {
      const wi = weekIndexByDate.get(r.bucket);
      if (wi === undefined) continue;
      for (const loc of locations) {
        rows[wi][loc] = (rows[wi][loc] as number) + Number(r[`${prefix}${loc}`] || 0);
      }
    }
    for (const row of rows) {
      for (const loc of locations) row[loc] = Math.round((row[loc] as number) * 100) / 100;
    }
    return rows;
  }, [data, locations, weekWindow, weekIndexByDate]);

  // Per-location daily rows across the same 8-week window.
  const dailyByLocation = useCallback((prefix: string) => {
    const out: Record<string, string | number>[] = [];
    if (!data || weekWindow.length === 0) return out;
    const from = weekWindow[0].start;
    const to = weekWindow[weekWindow.length - 1].end;
    for (const r of data.series) {
      if (r.bucket < from || r.bucket > to) continue;
      const row: Record<string, string | number> = { day: r.bucket };
      let any = false;
      for (const loc of locations) {
        const v = Number(r[`${prefix}${loc}`] || 0);
        row[loc] = v;
        if (v !== 0) any = true;
      }
      // Skip days with no activity in THIS series. A bucket exists if anything
      // happened that day, so a Sunday with only a warehouse transfer would
      // otherwise plot a hard 0 on the sales line (and vice versa) instead of
      // reading as a gap.
      if (!any) continue;
      out.push(row);
    }
    return out;
  }, [data, locations, weekWindow]);

  const salesPrefix = metric === "tires" ? "tires_" : "dollars_";
  const transferPrefix = metric === "tires" ? "transfersOut_" : "transfersOutDollars_";

  const salesByWeek = useMemo(() => weeklyByLocation(salesPrefix), [weeklyByLocation, salesPrefix]);
  const salesByDay = useMemo(() => dailyByLocation(salesPrefix), [dailyByLocation, salesPrefix]);
  const transfersByWeek = useMemo(() => weeklyByLocation(transferPrefix), [weeklyByLocation, transferPrefix]);
  const transfersByDay = useMemo(() => dailyByLocation(transferPrefix), [dailyByLocation, transferPrefix]);

  // Legend/chip toggle shared by every chart on the page.
  const visibleLocations = useMemo(
    () => locations.filter(l => !hiddenLocs.has(l)),
    [locations, hiddenLocs]
  );
  const toggleLoc = (loc: string) =>
    setHiddenLocs(prev => {
      const next = new Set(prev);
      if (next.has(loc)) next.delete(loc); else next.add(loc);
      return next;
    });

  const salesWeekLocs = useMemo(() => nonZero(salesByWeek, visibleLocations), [salesByWeek, visibleLocations]);
  const salesDayLocs = useMemo(() => nonZero(salesByDay, visibleLocations), [salesByDay, visibleLocations]);
  const transferWeekLocs = useMemo(() => nonZero(transfersByWeek, visibleLocations), [transfersByWeek, visibleLocations]);
  const transferDayLocs = useMemo(() => nonZero(transfersByDay, visibleLocations), [transfersByDay, visibleLocations]);
  const monthLocs = useMemo(() => nonZero(monthlySeries, visibleLocations), [monthlySeries, visibleLocations]);

  const windowLabel = weekWindow.length
    ? `${weekWindow[0].label} – ${dayLabel(iso(asOf))}`
    : "";

  // Per-location current-month with WoW/MoM deltas
  const perLocationStats = useMemo(() => {
    return locations.map(loc => {
      const tm = thisMonth.perLoc.get(loc) || 0;
      const lm = lastMonth.perLoc.get(loc) || 0;
      const tw = thisWeek.perLoc.get(loc) || 0;
      const lw = lastWeek.perLoc.get(loc) || 0;
      const y = ytd.perLoc.get(loc) || 0;
      const mom = deltaPct(tm, lm);
      const wow = deltaPct(tw, lw);
      return { loc, color: colorByLoc[loc], thisMonth: tm, lastMonth: lm, mom, thisWeek: tw, lastWeek: lw, wow, ytd: y };
    }).sort((a, b) => b.thisMonth - a.thisMonth);
  }, [locations, thisMonth, lastMonth, thisWeek, lastWeek, ytd, colorByLoc]);

  const deltaPill = (pct: number | null) => {
    if (pct == null) return <span className="text-xs theme-text-tertiary">—</span>;
    const positive = pct >= 0;
    const cls = positive ? "text-green-700 bg-green-100" : "text-red-700 bg-red-100";
    const sign = positive ? "+" : "";
    return (
      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full tabular-nums ${cls}`}>
        {sign}{pct.toFixed(0)}%
      </span>
    );
  };

  return (
    <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Sticky iOS-style page header */}
        <header className={`sticky top-0 z-10 border-b px-4 sm:px-6 py-3 sm:py-4 backdrop-blur-sm ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Link
                href="/reports"
                className="p-2 rounded-lg transition-colors theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5 flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <div className="min-w-0">
                <h1 className="text-xl font-bold theme-text-primary tracking-tight">Sales Dashboard</h1>
                <p className="text-xs mt-0.5 theme-text-tertiary">
                  {metric === "tires" ? "Tires sold" : "Revenue"} by location · WoW / MoM / YTD
                  {bizDates.length > 0 && (
                    <> · <span title="The OEA07V feed lags a day or two, so every figure is anchored to the latest day with sales — not today.">
                      as of {new Date(`${bizDates[bizDates.length - 1]}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span></>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className={`inline-flex items-center gap-1 rounded-full p-1 border ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-gray-100 border-gray-200"}`}>
                {(["tires", "dollars"] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setMetric(m)}
                    className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                      metric === m ? "bg-[#007AFF] text-white" : "theme-text-secondary"
                    }`}
                  >
                    {m === "tires" ? "Tires" : "Dollars"}
                  </button>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchData}
                disabled={loading}
              >
                {loading ? "Loading…" : "Refresh"}
              </Button>
            </div>
          </div>
        </header>

        <div className="px-4 sm:px-6 py-5 max-w-7xl mx-auto space-y-4">

          {/* Error banner */}
          {error && (
            <Card tone="red" padding="sm">
              <p className="text-sm theme-text-primary">{error}</p>
            </Card>
          )}

          {/* Big KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card padding="sm">
              <div className="ui-section-label">This Week</div>
              <div className="text-2xl font-semibold theme-text-primary mt-1">{fmt(thisWeek.total)}</div>
              <div className="mt-1 flex items-center gap-2 text-[11px] theme-text-tertiary">
                <span>vs last week {fmt(lastWeek.total)}</span>
                {deltaPill(deltaPct(thisWeek.total, lastWeek.total))}
              </div>
            </Card>
            <Card padding="sm">
              <div className="ui-section-label">This Month</div>
              <div className="text-2xl font-semibold theme-text-primary mt-1">{fmt(thisMonth.total)}</div>
              <div className="mt-1 flex items-center gap-2 text-[11px] theme-text-tertiary">
                <span>vs last month {fmt(lastMonth.total)}</span>
                {deltaPill(deltaPct(thisMonth.total, lastMonth.total))}
              </div>
            </Card>
            <Card padding="sm">
              <div className="ui-section-label">YTD</div>
              <div className="text-2xl font-semibold theme-text-primary mt-1">{fmt(ytd.total)}</div>
              <div className="mt-1 flex items-center gap-2 text-[11px] theme-text-tertiary">
                {/* A prior year with no uploads is NOT a year with zero sales.
                    Rendering fmt(0) here read as "last year sold nothing" —
                    and the fetch window starts at Jan 1 of the CURRENT year,
                    so prior-year rows were never even loaded. Say so instead. */}
                {ytdPrev.total !== 0 ? (
                  <>
                    <span>vs same period last yr {fmt(ytdPrev.total)}</span>
                    {deltaPill(deltaPct(ytd.total, ytdPrev.total))}
                  </>
                ) : (
                  <span title="No prior-year OEA07V data has been uploaded, so a year-over-year comparison isn't possible yet.">
                    no prior-year data
                  </span>
                )}
              </div>
            </Card>
            <Card padding="sm">
              <div className="ui-section-label">Locations</div>
              <div className="text-2xl font-semibold theme-text-primary mt-1">{locations.length}</div>
              <div className="text-[11px] theme-text-tertiary mt-1">selling YTD</div>
            </Card>
          </div>

          {/* Per-location table — the headline view */}
          <div className="theme-card overflow-hidden p-0">
            <div className="px-5 py-3 border-b theme-border-secondary">
              <h2 className="text-[15px] font-semibold theme-text-primary">
                This month — by location <span className="theme-text-tertiary font-normal text-xs ml-1">({metricLabel})</span>
              </h2>
              <p className="text-xs mt-0.5 theme-text-tertiary">
                Business-day aligned: WoW compares this week&apos;s {thisWeekDates.length} selling day{thisWeekDates.length === 1 ? "" : "s"} vs last week&apos;s first {thisWeekDates.length}; MoM compares this month&apos;s {thisMonthDates.length} vs last month&apos;s first {thisMonthDates.length}. Weekends/holidays excluded (a &ldquo;selling day&rdquo; = a day the company sold). Data through {MONTH_NAMES[asOf.getMonth()]} {asOf.getDate()}.
              </p>
            </div>
            {locations.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm theme-text-tertiary">No data in the year-to-date window.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={isDark ? "bg-slate-800/80" : "bg-gray-50"}>
                    <tr className="border-b theme-border-secondary">
                      <th className="text-left py-2.5 px-4 font-semibold text-xs theme-text-tertiary">Location</th>
                      <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">This week</th>
                      <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">Last week</th>
                      <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">WoW</th>
                      <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">This month</th>
                      <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">Last month</th>
                      <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">MoM</th>
                      <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">YTD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perLocationStats.map(s => (
                      <tr key={s.loc} className={`border-b theme-border-secondary transition-colors ${isDark ? "hover:bg-slate-700/20" : "hover:bg-gray-50"}`}>
                        <td className="py-2.5 px-4">
                          <span className="inline-flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                            <span className="theme-text-primary font-medium">{s.loc}</span>
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right theme-text-primary tabular-nums">{fmt(s.thisWeek)}</td>
                        <td className="py-2.5 px-4 text-right theme-text-secondary tabular-nums">{fmt(s.lastWeek)}</td>
                        <td className="py-2.5 px-4 text-right">{deltaPill(s.wow)}</td>
                        <td className="py-2.5 px-4 text-right theme-text-primary tabular-nums font-semibold">{fmt(s.thisMonth)}</td>
                        <td className="py-2.5 px-4 text-right theme-text-secondary tabular-nums">{fmt(s.lastMonth)}</td>
                        <td className="py-2.5 px-4 text-right">{deltaPill(s.mom)}</td>
                        <td className="py-2.5 px-4 text-right theme-text-primary tabular-nums">{fmt(s.ytd)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className={isDark ? "bg-slate-800/50" : "bg-gray-50"}>
                      <td className="py-2.5 px-4 font-semibold theme-text-primary">Total</td>
                      <td className="py-2.5 px-4 text-right font-semibold theme-text-primary tabular-nums">{fmt(thisWeek.total)}</td>
                      <td className="py-2.5 px-4 text-right font-semibold theme-text-secondary tabular-nums">{fmt(lastWeek.total)}</td>
                      <td className="py-2.5 px-4 text-right">{deltaPill(deltaPct(thisWeek.total, lastWeek.total))}</td>
                      <td className="py-2.5 px-4 text-right font-semibold theme-text-primary tabular-nums">{fmt(thisMonth.total)}</td>
                      <td className="py-2.5 px-4 text-right font-semibold theme-text-secondary tabular-nums">{fmt(lastMonth.total)}</td>
                      <td className="py-2.5 px-4 text-right">{deltaPill(deltaPct(thisMonth.total, lastMonth.total))}</td>
                      <td className="py-2.5 px-4 text-right font-semibold theme-text-primary tabular-nums">{fmt(ytd.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Shared line-chart legend filter */}
          {locations.length > 0 && (
            <Card padding="sm">
              <div className="flex items-center justify-between mb-2">
                <span className="ui-section-label">Locations shown in the charts below</span>
                {hiddenLocs.size > 0 && (
                  <button onClick={() => setHiddenLocs(new Set())} className="text-[11px] text-[#007AFF] hover:underline">
                    Show all
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {locations.map(loc => {
                  const on = !hiddenLocs.has(loc);
                  return (
                    <button
                      key={loc}
                      onClick={() => toggleLoc(loc)}
                      className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                        on ? "border-transparent text-white" : "theme-text-tertiary theme-border-secondary"
                      }`}
                      style={on ? { backgroundColor: colorByLoc[loc] } : {}}
                    >
                      {loc}
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Sales by day — 8-week window */}
          <Card padding="sm">
            <h2 className="text-[15px] font-semibold theme-text-primary">
              Sales by day, last {WEEKS} weeks <span className="theme-text-tertiary font-normal text-xs ml-1">({metricLabel})</span>
            </h2>
            <p className="text-xs mt-0.5 mb-3 theme-text-tertiary">
              One line per location, {windowLabel}. Gaps are days with no selling activity.
            </p>
            <LocationLineChart
              rows={salesByDay}
              xKey="day"
              locations={salesDayLocs}
              colorByLoc={colorByLoc}
              isDark={isDark}
              fmt={fmt}
              height={320}
              xTickFormatter={(v) => dayLabel(String(v ?? ""))}
            />
          </Card>

          {/* Sales by week — 8-week window */}
          <Card padding="sm">
            <h2 className="text-[15px] font-semibold theme-text-primary">
              Sales by week, last {WEEKS} weeks <span className="theme-text-tertiary font-normal text-xs ml-1">({metricLabel})</span>
            </h2>
            <p className="text-xs mt-0.5 mb-3 theme-text-tertiary">
              Each point is a full Monday–Sunday week, labelled by its Monday. The last week is partial — it runs through {MONTH_NAMES[asOf.getMonth()]} {asOf.getDate()}.
            </p>
            <LocationLineChart
              rows={salesByWeek}
              xKey="week"
              locations={salesWeekLocs}
              colorByLoc={colorByLoc}
              isDark={isDark}
              fmt={fmt}
              height={300}
            />
          </Card>

          {/* Transfers out by week — 8-week window */}
          <Card padding="sm">
            <h2 className="text-[15px] font-semibold theme-text-primary">
              Transfers out by location, last {WEEKS} weeks <span className="theme-text-tertiary font-normal text-xs ml-1">({metricLabel})</span>
            </h2>
            <p className="text-xs mt-0.5 mb-3 theme-text-tertiary">
              Units leaving each location for another IET location (TrO rows). Not sales — this series is
              tracked separately and never nets against the sold numbers above.
              {metric === "dollars" && " Dollars here are extended COST, since an inter-location transfer has no sell price."}
            </p>
            <LocationLineChart
              rows={transfersByWeek}
              xKey="week"
              locations={transferWeekLocs}
              colorByLoc={colorByLoc}
              isDark={isDark}
              fmt={fmt}
              height={300}
            />
          </Card>

          {/* Transfers out by day — 8-week window */}
          <Card padding="sm">
            <h2 className="text-[15px] font-semibold theme-text-primary">
              Transfers out by day, last {WEEKS} weeks <span className="theme-text-tertiary font-normal text-xs ml-1">({metricLabel})</span>
            </h2>
            <p className="text-xs mt-0.5 mb-3 theme-text-tertiary">
              Same {WEEKS}-week window, day by day — surfaces the individual big pushes a weekly total hides.
            </p>
            <LocationLineChart
              rows={transfersByDay}
              xKey="day"
              locations={transferDayLocs}
              colorByLoc={colorByLoc}
              isDark={isDark}
              fmt={fmt}
              height={300}
              xTickFormatter={(v) => dayLabel(String(v ?? ""))}
            />
          </Card>

          {/* YTD by month */}
          <Card padding="sm">
            <h2 className="text-[15px] font-semibold theme-text-primary">
              YTD by month <span className="theme-text-tertiary font-normal text-xs ml-1">({metricLabel})</span>
            </h2>
            <p className="text-xs mt-0.5 mb-3 theme-text-tertiary">
              One line per location for the full year to date — the long-run view behind the {WEEKS}-week charts.
            </p>
            <LocationLineChart
              rows={monthlySeries}
              xKey="month"
              locations={monthLocs}
              colorByLoc={colorByLoc}
              isDark={isDark}
              fmt={fmt}
              height={300}
            />
          </Card>

          <p className="text-[11px] theme-text-tertiary text-center pb-4">
            Source: OEA07V daily uploads. Sold = Sld rows; customer returns (ReS) and transfers out (TrO) are
            tracked as their own series and never netted against sold. Inbound transfers (TrI), receipts (Rcv),
            vendor returns, and inventory adjustments are excluded.
            Per-location internal-account sales (bare R20, INVR20, 99-R20) included by default.
          </p>

        </div>
      </main>
    </div>
  );
}

export default function SalesDashboardPage() {
  return (
    <Protected minTier={3}>
      <SalesDashboardContent />
    </Protected>
  );
}
