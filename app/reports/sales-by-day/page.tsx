"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import Link from "next/link";
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

type Granularity = "day" | "week" | "month";
type Metric = "dollars" | "tires";
type ChartKind = "line" | "bar" | "area";

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
  granularity: Granularity;
  bucketCount: number;
}

// iOS-ish accent palette — distinct hues for up to ~10 locations.
const PALETTE = [
  "#007AFF", "#34C759", "#FF9500", "#AF52DE", "#FF3B30",
  "#5AC8FA", "#FFCC00", "#FF2D55", "#5856D6", "#A2845E",
];

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatBucketLabel(bucket: string, gran: Granularity): string {
  if (gran === "month") {
    const [y, m] = bucket.split("-");
    return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m) - 1]} ${y.slice(2)}`;
  }
  const d = new Date(bucket + "T00:00:00");
  if (gran === "week") {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatCurrency(v: number): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatNum(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function SalesByDayContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [startDate, setStartDate] = useState<string>(isoDaysAgo(30));
  const [endDate, setEndDate] = useState<string>(isoToday());
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [metric, setMetric] = useState<Metric>("dollars");
  const [chartKind, setChartKind] = useState<ChartKind>("area");
  const [selectedLocations, setSelectedLocations] = useState<Set<string>>(new Set());
  const [stacked, setStacked] = useState<boolean>(true);

  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("startDate", startDate);
      params.set("endDate", endDate);
      params.set("granularity", granularity);
      if (selectedLocations.size > 0) {
        params.set("locations", [...selectedLocations].join(","));
      }
      const res = await fetch(`/api/reports/sales-by-day?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiResp;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, granularity, selectedLocations]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Build per-location colors keyed off the seen list (stable across renders
  // as long as the underlying location list is stable).
  const colorByLocation = useMemo(() => {
    const map: Record<string, string> = {};
    (data?.locations || []).forEach((loc, i) => { map[loc] = PALETTE[i % PALETTE.length]; });
    return map;
  }, [data?.locations]);

  // The locations actually plotted in the current report response.
  const reportedLocations = useMemo(() => {
    if (!data) return [] as string[];
    return data.perLocation.map(p => p.location);
  }, [data]);

  const toggleLocation = (loc: string) => {
    setSelectedLocations(prev => {
      const next = new Set(prev);
      if (next.has(loc)) next.delete(loc);
      else next.add(loc);
      return next;
    });
  };
  const clearLocations = () => setSelectedLocations(new Set());
  const selectAllLocations = () => {
    if (!data) return;
    setSelectedLocations(new Set(data.locations));
  };

  // Quick date-range presets
  const presets: { label: string; days: number }[] = [
    { label: "7d", days: 7 },
    { label: "30d", days: 30 },
    { label: "90d", days: 90 },
    { label: "YTD", days: -1 }, // sentinel
    { label: "12mo", days: 365 },
  ];
  const applyPreset = (p: { label: string; days: number }) => {
    setEndDate(isoToday());
    if (p.label === "YTD") {
      const y = new Date().getFullYear();
      setStartDate(`${y}-01-01`);
    } else {
      setStartDate(isoDaysAgo(p.days));
    }
  };

  const downloadCSV = () => {
    if (!data) return;
    const locs = reportedLocations;
    const header = ["Date", ...locs.flatMap(l => [`${l} Tires`, `${l} Dollars`]), "Total Tires", "Total Dollars"];
    const rows = data.series.map(r => [
      r.bucket,
      ...locs.flatMap(l => [String(r[`tires_${l}`] ?? 0), String(r[`dollars_${l}`] ?? 0)]),
      String(r.totalTires),
      String(r.totalDollars),
    ]);
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales_${metric}_${granularity}_${startDate}_to_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Summary metrics
  const totalDollars = data?.totals.dollars || 0;
  const totalTires = data?.totals.tires || 0;
  const bucketCount = data?.bucketCount || 0;
  const avgPerBucketDollars = bucketCount ? totalDollars / bucketCount : 0;
  const avgPerBucketTires = bucketCount ? totalTires / bucketCount : 0;
  const topLoc = data?.perLocation[0];

  const labelClass = `block text-xs font-medium ${isDark ? "text-slate-400" : "text-gray-500"} mb-1`;
  const cardClass = `rounded-2xl border p-4 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"} shadow-sm`;
  const inputClass = `w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 ${
    isDark ? "bg-slate-900 border-slate-700 text-white" : "bg-white border-gray-300 text-gray-900"
  }`;

  const valueKey = metric === "dollars" ? "dollars_" : "tires_";
  const totalKey = metric === "dollars" ? "totalDollars" : "totalTires";
  const yFormatter = (v: number) => metric === "dollars" ? formatCurrency(v) : formatNum(v);

  const chartTooltipFormatter = (value: unknown, name: unknown): [string, string] => {
    const n = Number(value) || 0;
    const nm = String(name ?? "");
    const cleanName = nm.replace(/^(tires_|dollars_|totalTires|totalDollars)/, "") || nm;
    return [metric === "dollars" ? `$${formatNum(n)}` : formatNum(n), cleanName === "totalTires" || cleanName === "totalDollars" ? "Total" : cleanName];
  };

  const xTickFormatter = (b: unknown) => formatBucketLabel(String(b ?? ""), granularity);
  const tooltipLabelFormatter = (b: unknown) => formatBucketLabel(String(b ?? ""), granularity);

  // Render the right chart kind. We always plot per-location series; the
  // user can switch metric without re-fetching.
  const renderChart = () => {
    if (!data || data.series.length === 0) {
      return (
        <div className={`flex items-center justify-center h-80 text-sm ${isDark ? "text-slate-500" : "text-gray-500"}`}>
          {loading ? "Loading…" : "No sales in this range. Try widening the date range or selecting different locations."}
        </div>
      );
    }
    const tickColor = isDark ? "#94A3B8" : "#6B7280";
    const gridColor = isDark ? "#334155" : "#E5E7EB";

    if (chartKind === "line") {
      return (
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={data.series} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
            <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fill: tickColor, fontSize: 11 }} tickFormatter={xTickFormatter} />
            <YAxis tick={{ fill: tickColor, fontSize: 11 }} tickFormatter={yFormatter} />
            <Tooltip formatter={chartTooltipFormatter} labelFormatter={tooltipLabelFormatter}
              contentStyle={{ background: isDark ? "#0F172A" : "#FFFFFF", border: `1px solid ${gridColor}`, borderRadius: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {reportedLocations.map(loc => (
              <Line key={loc} type="monotone" dataKey={`${valueKey}${loc}`} name={loc}
                stroke={colorByLocation[loc] || "#007AFF"} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      );
    }

    if (chartKind === "bar") {
      return (
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={data.series} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
            <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fill: tickColor, fontSize: 11 }} tickFormatter={xTickFormatter} />
            <YAxis tick={{ fill: tickColor, fontSize: 11 }} tickFormatter={yFormatter} />
            <Tooltip formatter={chartTooltipFormatter} labelFormatter={tooltipLabelFormatter}
              contentStyle={{ background: isDark ? "#0F172A" : "#FFFFFF", border: `1px solid ${gridColor}`, borderRadius: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {reportedLocations.map(loc => (
              <Bar key={loc} dataKey={`${valueKey}${loc}`} name={loc}
                stackId={stacked ? "a" : undefined}
                fill={colorByLocation[loc] || "#007AFF"} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      );
    }

    // area (default)
    return (
      <ResponsiveContainer width="100%" height={400}>
        <AreaChart data={data.series} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
          <XAxis dataKey="bucket" tick={{ fill: tickColor, fontSize: 11 }} tickFormatter={xTickFormatter} />
          <YAxis tick={{ fill: tickColor, fontSize: 11 }} tickFormatter={yFormatter} />
          <Tooltip formatter={chartTooltipFormatter} labelFormatter={xTickFormatter}
            contentStyle={{ background: isDark ? "#0F172A" : "#FFFFFF", border: `1px solid ${gridColor}`, borderRadius: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {reportedLocations.map(loc => (
            <Area key={loc} type="monotone" dataKey={`${valueKey}${loc}`} name={loc}
              stackId={stacked ? "a" : undefined}
              stroke={colorByLocation[loc] || "#007AFF"}
              fill={colorByLocation[loc] || "#007AFF"} fillOpacity={0.25} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        <header className={`sticky top-0 z-10 backdrop-blur-md border-b px-6 sm:px-8 py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/85 border-gray-200"}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Link href="/reports" className={`p-2 rounded-lg ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div className="min-w-0">
                <h1 className="text-xl font-semibold theme-text-primary tracking-tight truncate">Sales by Day &amp; Location</h1>
                <p className="text-xs theme-text-tertiary truncate">Customer sales totals by store, bucketed by day, week, or month</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchData()}
                disabled={loading}
                className="px-3 py-1.5 rounded-full text-xs font-medium theme-bg-card theme-text-primary border theme-border-primary theme-bg-hover disabled:opacity-50"
              >
                {loading ? "Loading…" : "Refresh"}
              </button>
              <button
                onClick={downloadCSV}
                disabled={!data || data.series.length === 0}
                className="px-3 py-1.5 rounded-full text-xs font-medium text-white bg-[#007AFF] hover:bg-[#0063CC] shadow-sm disabled:opacity-50"
              >
                Export CSV
              </button>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-5">
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm p-3">{error}</div>
          )}

          {/* Controls */}
          <div className={cardClass}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className={labelClass}>Start date</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>End date</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Granularity</label>
                <div className="inline-flex items-center gap-1 rounded-full p-1 theme-bg-secondary border theme-border-primary w-full">
                  {(["day","week","month"] as Granularity[]).map(g => (
                    <button key={g} onClick={() => setGranularity(g)}
                      className={`flex-1 px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                        granularity === g ? "bg-[#007AFF] text-white" : "theme-text-secondary"
                      }`}>
                      {g === "day" ? "Day" : g === "week" ? "Week" : "Month"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelClass}>Metric</label>
                <div className="inline-flex items-center gap-1 rounded-full p-1 theme-bg-secondary border theme-border-primary w-full">
                  {(["dollars","tires"] as Metric[]).map(m => (
                    <button key={m} onClick={() => setMetric(m)}
                      className={`flex-1 px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                        metric === m ? "bg-[#007AFF] text-white" : "theme-text-secondary"
                      }`}>
                      {m === "dollars" ? "Dollars" : "Tires"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Preset chips + chart kind + stacking */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] theme-text-tertiary">Quick:</span>
                {presets.map(p => (
                  <button key={p.label} onClick={() => applyPreset(p)}
                    className="px-2.5 py-1 text-[11px] font-medium rounded-full theme-bg-secondary theme-text-secondary theme-bg-hover">
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="inline-flex items-center gap-1 rounded-full p-1 theme-bg-secondary border theme-border-primary">
                  {(["area","line","bar"] as ChartKind[]).map(k => (
                    <button key={k} onClick={() => setChartKind(k)}
                      className={`px-3 py-1 text-[11px] font-medium rounded-full ${
                        chartKind === k ? "bg-[#007AFF] text-white" : "theme-text-secondary"
                      }`}>
                      {k.charAt(0).toUpperCase() + k.slice(1)}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-xs theme-text-secondary">
                  <input type="checkbox" checked={stacked} onChange={(e) => setStacked(e.target.checked)}
                    className="rounded text-[#007AFF] focus:ring-[#007AFF]/40" />
                  Stacked
                </label>
              </div>
            </div>

            {/* Location chips */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <label className={labelClass}>Locations</label>
                <div className="flex items-center gap-2">
                  <button onClick={selectAllLocations} className="text-[11px] text-[#007AFF] hover:underline">Select all</button>
                  <span className="theme-text-muted text-[11px]">·</span>
                  <button onClick={clearLocations} className="text-[11px] theme-text-tertiary hover:theme-text-primary">Clear</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(data?.locations || []).map(loc => {
                  const active = selectedLocations.size === 0 || selectedLocations.has(loc);
                  const color = colorByLocation[loc] || "#007AFF";
                  return (
                    <button key={loc} onClick={() => toggleLocation(loc)}
                      className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                        active
                          ? "border-transparent text-white"
                          : "theme-bg-card theme-text-tertiary theme-border-primary"
                      }`}
                      style={active ? { backgroundColor: color } : {}}>
                      {loc}
                    </button>
                  );
                })}
                {(!data || data.locations.length === 0) && (
                  <span className="text-xs theme-text-muted">No locations found in this range.</span>
                )}
              </div>
              <p className="text-[11px] theme-text-muted mt-1.5">
                {selectedLocations.size === 0 ? "All locations shown" : `${selectedLocations.size} selected`}
              </p>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={cardClass}>
              <p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Total Dollars</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{formatCurrency(totalDollars)}</p>
              <p className="text-[11px] theme-text-muted mt-0.5">{formatCurrency(avgPerBucketDollars)} / {granularity}</p>
            </div>
            <div className={cardClass}>
              <p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Total Tires</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{formatNum(totalTires)}</p>
              <p className="text-[11px] theme-text-muted mt-0.5">{formatNum(Math.round(avgPerBucketTires))} / {granularity}</p>
            </div>
            <div className={cardClass}>
              <p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Buckets</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{bucketCount}</p>
              <p className="text-[11px] theme-text-muted mt-0.5">{granularity} buckets in range</p>
            </div>
            <div className={cardClass}>
              <p className="text-[11px] theme-text-tertiary uppercase tracking-wider">Top Location</p>
              <p className="text-2xl font-semibold theme-text-primary mt-1">{topLoc?.location || "—"}</p>
              <p className="text-[11px] theme-text-muted mt-0.5">{topLoc ? formatCurrency(topLoc.dollars) : "—"}</p>
            </div>
          </div>

          {/* Chart */}
          <div className={cardClass}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold theme-text-primary">
                {metric === "dollars" ? "Dollars" : "Tires"} by {granularity === "day" ? "day" : granularity === "week" ? "week" : "month"}, per location
              </h2>
              {totalTires < 0 && metric === "tires" && (
                <span className="text-[11px] text-amber-600">Range is net of returns — negative values mean more returns than sales.</span>
              )}
            </div>
            {renderChart()}
          </div>

          {/* Per-location table */}
          <div className={cardClass}>
            <h2 className="text-sm font-semibold theme-text-primary mb-3">Totals by location</h2>
            {data && data.perLocation.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={isDark ? "text-slate-400" : "text-gray-600"}>
                    <tr className="border-b theme-border-secondary">
                      <th className="text-left py-2 font-medium">Location</th>
                      <th className="text-right py-2 font-medium">Tires</th>
                      <th className="text-right py-2 font-medium">Dollars</th>
                      <th className="text-right py-2 font-medium">$/tire avg</th>
                      <th className="text-right py-2 font-medium">% of total $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perLocation.map(p => {
                      const pct = totalDollars !== 0 ? (p.dollars / totalDollars) * 100 : 0;
                      const perTire = p.tires !== 0 ? p.dollars / p.tires : 0;
                      return (
                        <tr key={p.location} className="border-b theme-border-secondary">
                          <td className="py-2">
                            <span className="inline-flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorByLocation[p.location] || "#007AFF" }} />
                              <span className="theme-text-primary font-medium">{p.location}</span>
                            </span>
                          </td>
                          <td className="py-2 text-right theme-text-primary tabular-nums">{formatNum(p.tires)}</td>
                          <td className="py-2 text-right theme-text-primary tabular-nums">${formatNum(p.dollars)}</td>
                          <td className="py-2 text-right theme-text-secondary tabular-nums">${perTire.toFixed(0)}</td>
                          <td className="py-2 text-right theme-text-secondary tabular-nums">{pct.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="theme-bg-secondary">
                      <td className="py-2 px-1 font-semibold theme-text-primary">Total</td>
                      <td className="py-2 text-right font-semibold theme-text-primary tabular-nums">{formatNum(totalTires)}</td>
                      <td className="py-2 text-right font-semibold theme-text-primary tabular-nums">${formatNum(totalDollars)}</td>
                      <td className="py-2 text-right font-semibold theme-text-secondary tabular-nums">
                        ${totalTires !== 0 ? (totalDollars / totalTires).toFixed(0) : "—"}
                      </td>
                      <td className="py-2 text-right font-semibold theme-text-secondary tabular-nums">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="text-sm theme-text-muted">No location totals in this range.</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function SalesByDayPage() {
  return (
    <Protected minTier={3}>
      <SalesByDayContent />
    </Protected>
  );
}
