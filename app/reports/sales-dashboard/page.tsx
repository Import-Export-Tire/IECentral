"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import Link from "next/link";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
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
  perLocation: { location: string; tires: number; dollars: number }[];
  totals: { tires: number; dollars: number };
  startDate: string;
  endDate: string;
}

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

function SalesDashboardContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const today = useMemo(() => new Date(), []);
  const ytdStart = useMemo(() => `${today.getFullYear()}-01-01`, [today]);

  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [metric, setMetric] = useState<"tires" | "dollars">("tires");

  const fetchData = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({
        startDate: ytdStart,
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
  }, [ytdStart, today]);

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

  const thisMonth     = sumRange(startOfMonth(today), endOfMonth(today));
  const lastMonthDate = addMonths(today, -1);
  const lastMonth     = sumRange(startOfMonth(lastMonthDate), endOfMonth(lastMonthDate));
  const thisWeek      = sumRange(startOfWeek(today), endOfWeek(today));
  const lastWeekDate  = new Date(today); lastWeekDate.setDate(lastWeekDate.getDate() - 7);
  const lastWeek      = sumRange(startOfWeek(lastWeekDate), endOfWeek(lastWeekDate));
  const ytd           = sumRange(new Date(today.getFullYear(), 0, 1), today);
  const ytdPrev       = sumRange(new Date(today.getFullYear() - 1, 0, 1), new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()));

  // Per-month aggregation for the YTD bar chart
  const byMonth = useMemo(() => {
    if (!data) return [] as { month: string; label: string; total: number; perLoc: Record<string, number> }[];
    const map = new Map<string, { total: number; perLoc: Record<string, number> }>();
    const keyMetric = metric === "tires" ? "tires_" : "dollars_";
    for (const row of data.series) {
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
  }, [data, locations, metric]);

  const fmt = metric === "tires" ? fmtNum : fmtCurrency;

  const monthlySeries = useMemo(() => {
    return byMonth.map(m => {
      const row: Record<string, number | string> = { month: m.label };
      for (const loc of locations) row[loc] = m.perLoc[loc] || 0;
      row.total = m.total;
      return row;
    });
  }, [byMonth, locations]);

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

  const cardClass = `rounded-2xl border p-4 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"} shadow-sm`;

  const deltaPill = (pct: number | null) => {
    if (pct == null) return <span className="text-xs theme-text-muted">—</span>;
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
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        <header className={`sticky top-0 z-10 backdrop-blur-md border-b px-6 sm:px-8 py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/85 border-gray-200"}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link href="/reports" className={`p-2 rounded-lg ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </Link>
              <div>
                <h1 className="text-xl font-semibold theme-text-primary tracking-tight">Sales Dashboard</h1>
                <p className="text-xs theme-text-tertiary">Tires sold by location · WoW / MoM / YTD</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-1 rounded-full p-1 theme-bg-card border theme-border-primary">
                {(["tires", "dollars"] as const).map(m => (
                  <button key={m} onClick={() => setMetric(m)}
                    className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                      metric === m ? "bg-[#007AFF] text-white" : "theme-text-secondary"
                    }`}>
                    {m === "tires" ? "Tires" : "Dollars"}
                  </button>
                ))}
              </div>
              <button onClick={fetchData} disabled={loading}
                className="px-3 py-1.5 rounded-full text-xs font-medium theme-bg-card theme-text-primary border theme-border-primary theme-bg-hover disabled:opacity-50">
                {loading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-5">
          {error && <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm p-3">{error}</div>}

          {/* Big KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={cardClass}>
              <p className="text-[11px] theme-text-tertiary uppercase tracking-wider">This Week</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{fmt(thisWeek.total)}</p>
              <div className="mt-1 flex items-center gap-2 text-[11px] theme-text-muted">
                <span>vs last week {fmt(lastWeek.total)}</span>{deltaPill(deltaPct(thisWeek.total, lastWeek.total))}
              </div>
            </div>
            <div className={cardClass}>
              <p className="text-[11px] theme-text-tertiary uppercase tracking-wider">This Month</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{fmt(thisMonth.total)}</p>
              <div className="mt-1 flex items-center gap-2 text-[11px] theme-text-muted">
                <span>vs last month {fmt(lastMonth.total)}</span>{deltaPill(deltaPct(thisMonth.total, lastMonth.total))}
              </div>
            </div>
            <div className={cardClass}>
              <p className="text-[11px] theme-text-tertiary uppercase tracking-wider">YTD</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{fmt(ytd.total)}</p>
              <div className="mt-1 flex items-center gap-2 text-[11px] theme-text-muted">
                <span>vs same period last yr {fmt(ytdPrev.total)}</span>{deltaPill(deltaPct(ytd.total, ytdPrev.total))}
              </div>
            </div>
            <div className={cardClass}>
              <p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Locations</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{locations.length}</p>
              <p className="text-[11px] theme-text-muted mt-1">selling tires YTD</p>
            </div>
          </div>

          {/* Per-location table — the headline view */}
          <div className={cardClass}>
            <h2 className="text-sm font-semibold theme-text-primary mb-3">
              This month — by location <span className="theme-text-muted font-normal text-xs ml-1">({metric})</span>
            </h2>
            {locations.length === 0 ? (
              <p className="text-sm theme-text-muted py-6 text-center">No data in the year-to-date window.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={isDark ? "text-slate-400" : "text-gray-600"}>
                    <tr className="border-b theme-border-secondary">
                      <th className="text-left py-2 px-2 font-medium">Location</th>
                      <th className="text-right py-2 px-2 font-medium">This week</th>
                      <th className="text-right py-2 px-2 font-medium">Last week</th>
                      <th className="text-right py-2 px-2 font-medium">WoW</th>
                      <th className="text-right py-2 px-2 font-medium">This month</th>
                      <th className="text-right py-2 px-2 font-medium">Last month</th>
                      <th className="text-right py-2 px-2 font-medium">MoM</th>
                      <th className="text-right py-2 px-2 font-medium">YTD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perLocationStats.map(s => (
                      <tr key={s.loc} className="border-b theme-border-secondary">
                        <td className="py-2 px-2">
                          <span className="inline-flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                            <span className="theme-text-primary font-medium">{s.loc}</span>
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right theme-text-primary tabular-nums">{fmt(s.thisWeek)}</td>
                        <td className="py-2 px-2 text-right theme-text-secondary tabular-nums">{fmt(s.lastWeek)}</td>
                        <td className="py-2 px-2 text-right">{deltaPill(s.wow)}</td>
                        <td className="py-2 px-2 text-right theme-text-primary tabular-nums font-semibold">{fmt(s.thisMonth)}</td>
                        <td className="py-2 px-2 text-right theme-text-secondary tabular-nums">{fmt(s.lastMonth)}</td>
                        <td className="py-2 px-2 text-right">{deltaPill(s.mom)}</td>
                        <td className="py-2 px-2 text-right theme-text-primary tabular-nums">{fmt(s.ytd)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="theme-bg-secondary">
                      <td className="py-2 px-2 font-semibold theme-text-primary">Total</td>
                      <td className="py-2 px-2 text-right font-semibold theme-text-primary tabular-nums">{fmt(thisWeek.total)}</td>
                      <td className="py-2 px-2 text-right font-semibold theme-text-secondary tabular-nums">{fmt(lastWeek.total)}</td>
                      <td className="py-2 px-2 text-right">{deltaPill(deltaPct(thisWeek.total, lastWeek.total))}</td>
                      <td className="py-2 px-2 text-right font-semibold theme-text-primary tabular-nums">{fmt(thisMonth.total)}</td>
                      <td className="py-2 px-2 text-right font-semibold theme-text-secondary tabular-nums">{fmt(lastMonth.total)}</td>
                      <td className="py-2 px-2 text-right">{deltaPill(deltaPct(thisMonth.total, lastMonth.total))}</td>
                      <td className="py-2 px-2 text-right font-semibold theme-text-primary tabular-nums">{fmt(ytd.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* YTD by month chart */}
          <div className={cardClass}>
            <h2 className="text-sm font-semibold theme-text-primary mb-3">
              YTD by month (stacked by location)
            </h2>
            {monthlySeries.length === 0 ? (
              <p className="text-sm theme-text-muted py-6 text-center">No data.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlySeries} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke={isDark ? "#334155" : "#E5E7EB"} strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }} />
                  <YAxis tick={{ fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }} tickFormatter={(v: unknown) => fmt(Number(v))} />
                  <Tooltip
                    formatter={(value: unknown, name: unknown): [string, string] => [fmt(Number(value) || 0), String(name)]}
                    contentStyle={{ background: isDark ? "#0F172A" : "#FFFFFF", border: `1px solid ${isDark ? "#334155" : "#E5E7EB"}`, borderRadius: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {locations.map(loc => (
                    <Bar key={loc} dataKey={loc} stackId="a" fill={colorByLoc[loc] || "#007AFF"} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* WoW & MoM combined trend */}
          <div className={cardClass}>
            <h2 className="text-sm font-semibold theme-text-primary mb-3">
              Weekly trend, last 12 weeks
            </h2>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart
                data={(() => {
                  // Build a 12-week series of totals per week (Mon-Sun)
                  const out: { week: string; total: number }[] = [];
                  if (!data) return out;
                  for (let i = 11; i >= 0; i--) {
                    const refDate = new Date(today); refDate.setDate(refDate.getDate() - i * 7);
                    const r = sumRange(startOfWeek(refDate), endOfWeek(refDate));
                    out.push({ week: iso(startOfWeek(refDate)).slice(5), total: r.total });
                  }
                  return out;
                })()}
                margin={{ top: 8, right: 16, left: 8, bottom: 4 }}
              >
                <CartesianGrid stroke={isDark ? "#334155" : "#E5E7EB"} strokeDasharray="3 3" />
                <XAxis dataKey="week" tick={{ fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }} />
                <YAxis tick={{ fill: isDark ? "#94A3B8" : "#6B7280", fontSize: 11 }} tickFormatter={(v: unknown) => fmt(Number(v))} />
                <Tooltip
                  formatter={(value: unknown): [string, string] => [fmt(Number(value) || 0), metric === "tires" ? "Tires" : "Dollars"]}
                  contentStyle={{ background: isDark ? "#0F172A" : "#FFFFFF", border: `1px solid ${isDark ? "#334155" : "#E5E7EB"}`, borderRadius: 12 }}
                />
                <Line type="monotone" dataKey="total" stroke="#007AFF" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <p className="text-[11px] theme-text-muted text-center pb-4">
            Source: OEA07V daily uploads. Sales-only rows (Sld + customer returns) counted; warehouse transfers, vendor returns, and adjustments excluded.
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
