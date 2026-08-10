"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeader from "@/components/ui/SectionHeader";
import { locationLabel } from "@/lib/locationLabels";
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
// Which of the API's three independent series to plot. Sold, customer returns,
// and transfers out are never netted together, so this is a switch, not a sum.
type SeriesKind = "sales" | "transfersOut";

interface SeriesRow {
  bucket: string;
  totalTires: number;
  totalDollars: number;
  [k: string]: string | number;
}

interface PerLocation {
  location: string;
  tires: number;
  dollars: number;
  transfersOut?: number;
  transfersOutDollars?: number;
  other?: number;
  otherDollars?: number;
}

interface SalesCategory {
  key: string;
  label: string;
  units: number;
  dollars: number;
}

interface TransferLane {
  lane: string;   // "W08>R20"
  from: string;
  to: string;
  tires: number;
  dollars: number;
}

interface ApiResp {
  series: SeriesRow[];
  locations: string[];
  perLocation: PerLocation[];
  transferLanes?: TransferLane[];
  categories?: SalesCategory[];
  totals: { tires: number; dollars: number; transfersOut?: number; transfersOutDollars?: number; other?: number; otherDollars?: number };
  unfiltered?: boolean;
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
// Monday of the ISO week N weeks back — the anchor for the 8-week comparison.
function isoWeekStartWeeksAgo(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - n * 7);
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

  // Defaults land on the 8-week comparison: eight full ISO weeks, bucketed by
  // week, drawn as one line per location.
  const [startDate, setStartDate] = useState<string>(isoWeekStartWeeksAgo(7));
  const [endDate, setEndDate] = useState<string>(isoToday());
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [metric, setMetric] = useState<Metric>("dollars");
  const [chartKind, setChartKind] = useState<ChartKind>("line");
  const [seriesKind, setSeriesKind] = useState<SeriesKind>("sales");
  // Show the raw feed: no transaction / account / product-type / house-return
  // exclusions. Off by default so the normal numbers are never affected.
  const [unfiltered, setUnfiltered] = useState<boolean>(false);
  const [selectedLocations, setSelectedLocations] = useState<Set<string>>(new Set());
  const [stacked, setStacked] = useState<boolean>(false);

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
      if (unfiltered) params.set("unfiltered", "true");
      const res = await fetch(`/api/reports/sales-by-day?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiResp;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, granularity, selectedLocations, unfiltered]);

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

  // Quick date-range presets. "8wk" also snaps granularity to week so the
  // eight points line up on ISO week boundaries instead of arbitrary days.
  const presets: { label: string; days: number }[] = [
    { label: "7d", days: 7 },
    { label: "30d", days: 30 },
    { label: "8wk", days: -2 }, // sentinel
    { label: "90d", days: 90 },
    { label: "YTD", days: -1 }, // sentinel
    { label: "12mo", days: 365 },
  ];
  const applyPreset = (p: { label: string; days: number }) => {
    setEndDate(isoToday());
    if (p.label === "YTD") {
      const y = new Date().getFullYear();
      setStartDate(`${y}-01-01`);
    } else if (p.label === "8wk") {
      setStartDate(isoWeekStartWeeksAgo(7));
      setGranularity("week");
    } else {
      setStartDate(isoDaysAgo(p.days));
    }
  };

  const downloadCSV = () => {
    if (!data) return;
    const locs = reportedLocations;
    const header = [
      "Date",
      ...locs.flatMap(l => [`${l} Units`, `${l} Dollars`, `${l} Transfers Out`, `${l} Transfers Out $Cost`]),
      "Total Units", "Total Dollars", "Total Transfers Out", "Total Transfers Out $Cost",
    ];
    const rows = data.series.map(r => [
      r.bucket,
      ...locs.flatMap(l => [
        String(r[`tires_${l}`] ?? 0),
        String(r[`dollars_${l}`] ?? 0),
        String(r[`transfersOut_${l}`] ?? 0),
        String(r[`transfersOutDollars_${l}`] ?? 0),
      ]),
      String(r.totalTires),
      String(r.totalDollars),
      String(r.totalTransfersOut ?? 0),
      String(r.totalTransfersOutDollars ?? 0),
    ]);
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales_${granularity}_${startDate}_to_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Summary metrics
  const totalDollars = data?.totals.dollars || 0;
  const totalTires = data?.totals.tires || 0;
  const totalTransfersOut = data?.totals.transfersOut || 0;
  const totalTransfersOutDollars = data?.totals.transfersOutDollars || 0;
  const bucketCount = data?.bucketCount || 0;
  const avgPerBucketDollars = bucketCount ? totalDollars / bucketCount : 0;
  const avgPerBucketTires = bucketCount ? totalTires / bucketCount : 0;
  const topLoc = data?.perLocation[0];

  // Sold split by product category. Sums back to totalDollars / totalTires.
  const categoryRows = useMemo(() => data?.categories ?? [], [data]);

  // Transfer lanes ("W08>R20"). Sorted biggest-first by the API.
  const laneRows = useMemo(() => data?.transferLanes ?? [], [data]);
  const laneTotalUnits = useMemo(() => laneRows.reduce((a, l) => a + l.tires, 0), [laneRows]);
  const laneTotalDollars = useMemo(() => laneRows.reduce((a, l) => a + l.dollars, 0), [laneRows]);

  const valueKey = seriesKind === "sales"
    ? (metric === "dollars" ? "dollars_" : "tires_")
    : (metric === "dollars" ? "transfersOutDollars_" : "transfersOut_");
  const yFormatter = (v: number) => metric === "dollars" ? formatCurrency(v) : formatNum(v);

  const chartTooltipFormatter = (value: unknown, name: unknown): [string, string] => {
    const n = Number(value) || 0;
    const nm = String(name ?? "");
    const cleanName = nm.replace(/^(tires_|dollars_|transfersOut_|transfersOutDollars_|totalTires|totalDollars)/, "") || nm;
    return [metric === "dollars" ? `$${formatNum(n)}` : formatNum(n), cleanName === "totalTires" || cleanName === "totalDollars" ? "Total" : cleanName];
  };

  const xTickFormatter = (b: unknown) => formatBucketLabel(String(b ?? ""), granularity);
  const tooltipLabelFormatter = (b: unknown) => formatBucketLabel(String(b ?? ""), granularity);

  // Render the right chart kind. We always plot per-location series; the
  // user can switch metric without re-fetching.
  const renderChart = () => {
    if (!data || data.series.length === 0) {
      return (
        <div className="flex items-center justify-center h-80 text-sm theme-text-tertiary">
          {loading
            ? "Loading…"
            : `No ${seriesKind === "sales" ? "sales" : "transfers out"} in this range. Try widening the date range or selecting different locations.`}
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
    <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Sticky iOS-style page header */}
        <header className={`sticky top-0 z-10 border-b px-4 sm:px-6 py-3 sm:py-4 backdrop-blur-sm ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <div className="flex items-center justify-between gap-3">
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
                <h1 className="text-xl font-bold theme-text-primary truncate">Sales by Day &amp; Location</h1>
                <p className="text-xs mt-0.5 theme-text-tertiary truncate">Customer sales totals by store, bucketed by day, week, or month</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchData()}
                disabled={loading}
              >
                {loading ? "Loading…" : "Refresh"}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={downloadCSV}
                disabled={!data || data.series.length === 0}
              >
                Export CSV
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

          {/* Controls panel */}
          <Card padding="sm">
            <SectionHeader label="Filters" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block ui-section-label mb-1">Start date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block ui-section-label mb-1">End date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block ui-section-label mb-1">Granularity</label>
                <div className={`inline-flex items-center gap-1 rounded-full p-1 border w-full ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-gray-100 border-gray-200"}`}>
                  {(["day","week","month"] as Granularity[]).map(g => (
                    <button
                      key={g}
                      onClick={() => setGranularity(g)}
                      className={`flex-1 px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                        granularity === g ? "bg-[#007AFF] text-white" : "theme-text-secondary"
                      }`}
                    >
                      {g === "day" ? "Day" : g === "week" ? "Week" : "Month"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block ui-section-label mb-1">Metric</label>
                <div className={`inline-flex items-center gap-1 rounded-full p-1 border w-full ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-gray-100 border-gray-200"}`}>
                  {(["dollars","tires"] as Metric[]).map(m => (
                    <button
                      key={m}
                      onClick={() => setMetric(m)}
                      className={`flex-1 px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                        metric === m ? "bg-[#007AFF] text-white" : "theme-text-secondary"
                      }`}
                    >
                      {m === "dollars" ? "Dollars" : "Tires"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Preset chips + chart kind + stacking */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="ui-section-label">Quick:</span>
                {presets.map(p => (
                  <button
                    key={p.label}
                    onClick={() => applyPreset(p)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-colors ${
                      isDark
                        ? "bg-slate-800/50 text-slate-400 border-slate-700 hover:border-slate-500"
                        : "bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className={`inline-flex items-center gap-1 rounded-full p-1 border ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-gray-100 border-gray-200"}`}>
                  {([["sales","Sales"],["transfersOut","Transfers out"]] as [SeriesKind, string][]).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setSeriesKind(k)}
                      className={`px-3 py-1 text-[11px] font-medium rounded-full transition-colors ${
                        seriesKind === k ? "bg-[#007AFF] text-white" : "theme-text-secondary"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setUnfiltered(v => !v)}
                  title="Show every row in the feed — including inbound transfers, receives, adjustments, internal/vendor accounts, GL expense lines and house returns. Totals are NOT comparable to the normal view."
                  className={`px-3 py-1.5 text-[11px] font-medium rounded-full border transition-colors ${
                    unfiltered
                      ? "bg-amber-500 text-white border-amber-500"
                      : isDark
                        ? "bg-slate-800/50 border-slate-700 theme-text-secondary"
                        : "bg-gray-100 border-gray-200 theme-text-secondary"
                  }`}
                >
                  {unfiltered ? "Unfiltered: ON" : "Unfiltered"}
                </button>
                <div className={`inline-flex items-center gap-1 rounded-full p-1 border ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-gray-100 border-gray-200"}`}>
                  {(["line","area","bar"] as ChartKind[]).map(k => (
                    <button
                      key={k}
                      onClick={() => setChartKind(k)}
                      className={`px-3 py-1 text-[11px] font-medium rounded-full transition-colors ${
                        chartKind === k ? "bg-[#007AFF] text-white" : "theme-text-secondary"
                      }`}
                    >
                      {k.charAt(0).toUpperCase() + k.slice(1)}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-xs theme-text-secondary">
                  <input
                    type="checkbox"
                    checked={stacked}
                    onChange={(e) => setStacked(e.target.checked)}
                    className="rounded text-[#007AFF] focus:ring-[#007AFF]/40"
                  />
                  Stacked
                </label>
              </div>
            </div>

            {/* Location chips */}
            <div className="mt-4 pt-3 border-t theme-border-secondary">
              <div className="flex items-center justify-between mb-2">
                <span className="ui-section-label">Locations</span>
                <div className="flex items-center gap-2">
                  <button onClick={selectAllLocations} className="text-[11px] text-[#007AFF] hover:underline">Select all</button>
                  <span className="theme-text-tertiary text-[11px]">·</span>
                  <button onClick={clearLocations} className="text-[11px] theme-text-tertiary hover:theme-text-primary">Clear</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(data?.locations || []).map(loc => {
                  const active = selectedLocations.size === 0 || selectedLocations.has(loc);
                  const color = colorByLocation[loc] || "#007AFF";
                  return (
                    <button
                      key={loc}
                      onClick={() => toggleLocation(loc)}
                      className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                        active
                          ? "border-transparent text-white"
                          : "theme-text-tertiary theme-border-secondary"
                      }`}
                      style={active ? { backgroundColor: color } : {}}
                    >
                      {loc}
                    </button>
                  );
                })}
                {(!data || data.locations.length === 0) && (
                  <span className="text-xs theme-text-tertiary">No locations found in this range.</span>
                )}
              </div>
              <p className="text-[11px] theme-text-tertiary mt-1.5">
                {selectedLocations.size === 0 ? "All locations shown" : `${selectedLocations.size} selected`}
              </p>
            </div>
          </Card>

          {/* Unfiltered warning — these totals mix non-sales activity into the
              numbers, so they must never be read as a sales figure. */}
          {unfiltered && (
            <Card tone="amber" padding="sm">
              <p className="text-sm theme-text-primary font-medium">Unfiltered — showing every row in the feed</p>
              <p className="text-xs theme-text-secondary mt-1">
                No exclusions are applied: inbound transfers (TrI), receives (Rcv) and adjustments (Adj/*) appear in
                their own &ldquo;Other activity&rdquo; total; internal, vendor and warehouse-transfer accounts are kept;
                GL expense lines (G, VXX) and &ldquo;=ENTER&rdquo; placeholders (XA) are counted; and house/wholesale
                returns (IET, AOT, REDRUM) are no longer removed. <strong>These totals are not comparable to the normal
                view and should not be reported as sales.</strong>
              </p>
            </Card>
          )}

          {/* Summary KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card padding="sm">
              <div className="ui-section-label">Total Dollars</div>
              <div className="text-2xl font-semibold theme-text-primary mt-1">{formatCurrency(totalDollars)}</div>
              <div className="text-[11px] theme-text-tertiary mt-0.5">{formatCurrency(avgPerBucketDollars)} / {granularity}</div>
            </Card>
            <Card padding="sm">
              <div className="ui-section-label">Total Units</div>
              <div className="text-2xl font-semibold theme-text-primary mt-1">{formatNum(totalTires)}</div>
              <div className="text-[11px] theme-text-tertiary mt-0.5">{formatNum(Math.round(avgPerBucketTires))} / {granularity}</div>
            </Card>
            <Card padding="sm">
              <div className="ui-section-label">Transfers Out</div>
              <div className="text-2xl font-semibold theme-text-primary mt-1">{formatNum(totalTransfersOut)}</div>
              <div className="text-[11px] theme-text-tertiary mt-0.5">units · {formatCurrency(totalTransfersOutDollars)} at cost</div>
            </Card>
            {unfiltered && (
              <Card padding="sm">
                <div className="ui-section-label">Other Activity</div>
                <div className="text-2xl font-semibold theme-text-primary mt-1">{formatNum(data?.totals.other || 0)}</div>
                <div className="text-[11px] theme-text-tertiary mt-0.5">
                  TrI · Rcv · Adj units · {formatCurrency(data?.totals.otherDollars || 0)} at cost
                </div>
              </Card>
            )}
            <Card padding="sm">
              <div className="ui-section-label">Top Location</div>
              <div className="text-2xl font-semibold theme-text-primary mt-1">{topLoc?.location || "—"}</div>
              <div className="text-[11px] theme-text-tertiary mt-0.5">{topLoc ? formatCurrency(topLoc.dollars) : "—"} · {bucketCount} {granularity} buckets</div>
            </Card>
          </div>

          {/* Chart */}
          <Card padding="sm">
            <SectionHeader
              title={`${seriesKind === "sales" ? "Sales" : "Transfers out"} — ${metric === "dollars" ? "dollars" : "units"} by ${granularity === "day" ? "day" : granularity === "week" ? "week" : "month"}, per location`}
              actions={
                seriesKind === "transfersOut" && metric === "dollars" ? (
                  <span className="text-[11px] theme-text-tertiary">Transfer dollars are extended cost — an inter-location transfer has no sell price.</span>
                ) : totalTires < 0 && metric === "tires" ? (
                  <span className="text-[11px] text-amber-600">Range is net of returns — negative values mean more returns than sales.</span>
                ) : undefined
              }
            />
            {renderChart()}
          </Card>

          {/* Sales by category — the composition behind the headline number.
              A single blended total hides that dropship and MISC wholesale are
              different business lines from retail tire sales. */}
          {seriesKind === "sales" && (
            <div className="theme-card overflow-hidden p-0">
              <div className="px-5 py-3 border-b theme-border-secondary">
                <h2 className="text-[15px] font-semibold theme-text-primary">Sales by category</h2>
                <p className="text-[11px] theme-text-tertiary mt-0.5">
                  Every counted sale lands in exactly one category, so these sum to the totals above.
                </p>
              </div>
              {categoryRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className={`${isDark ? "bg-slate-800/80" : "bg-gray-50"}`}>
                      <tr className="border-b theme-border-secondary">
                        <th className="text-left py-2.5 px-4 font-semibold text-xs theme-text-tertiary">Category</th>
                        <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">Units</th>
                        <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">Dollars</th>
                        <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">$/unit avg</th>
                        <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">% of total $</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryRows.map(c => {
                        const pct = totalDollars !== 0 ? (c.dollars / totalDollars) * 100 : 0;
                        const per = c.units !== 0 ? c.dollars / c.units : 0;
                        return (
                          <tr key={c.key} className="border-b theme-border-secondary">
                            <td className="py-2.5 px-4 theme-text-primary font-medium">{c.label}</td>
                            <td className="py-2.5 px-4 text-right theme-text-primary tabular-nums">{formatNum(c.units)}</td>
                            <td className="py-2.5 px-4 text-right theme-text-primary tabular-nums">${formatNum(c.dollars)}</td>
                            <td className="py-2.5 px-4 text-right theme-text-secondary tabular-nums">
                              {c.units !== 0 ? `$${per.toFixed(0)}` : "—"}
                            </td>
                            <td className="py-2.5 px-4 text-right theme-text-secondary tabular-nums">{pct.toFixed(1)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className={isDark ? "bg-slate-800/50" : "bg-gray-50"}>
                        <td className="py-2.5 px-4 font-semibold theme-text-primary">Total</td>
                        <td className="py-2.5 px-4 text-right font-semibold theme-text-primary tabular-nums">{formatNum(totalTires)}</td>
                        <td className="py-2.5 px-4 text-right font-semibold theme-text-primary tabular-nums">${formatNum(totalDollars)}</td>
                        <td className="py-2.5 px-4 text-right font-semibold theme-text-secondary tabular-nums">
                          {totalTires !== 0 ? `$${(totalDollars / totalTires).toFixed(0)}` : "—"}
                        </td>
                        <td className="py-2.5 px-4 text-right font-semibold theme-text-secondary tabular-nums">100%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="p-5">
                  <p className="text-sm theme-text-tertiary">No sales in this range.</p>
                </div>
              )}
            </div>
          )}

          {/* Transfer lanes — only meaningful on the transfers-out view. The
              per-location table answers "how much left W08"; this answers
              "left W08 for WHERE". Lane comes from the TrO account code. */}
          {seriesKind === "transfersOut" && (
            <div className="theme-card overflow-hidden p-0">
              <div className="px-5 py-3 border-b theme-border-secondary">
                <h2 className="text-[15px] font-semibold theme-text-primary">Transfers out by lane</h2>
                <p className="text-[11px] theme-text-tertiary mt-0.5">
                  Source &rarr; destination, from the transfer&rsquo;s account code. Dollars are extended cost.
                </p>
              </div>
              {laneRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className={`${isDark ? "bg-slate-800/80" : "bg-gray-50"}`}>
                      <tr className="border-b theme-border-secondary">
                        <th className="text-left py-2.5 px-4 font-semibold text-xs theme-text-tertiary">Lane</th>
                        <th className="text-left py-2.5 px-4 font-semibold text-xs theme-text-tertiary">From</th>
                        <th className="text-left py-2.5 px-4 font-semibold text-xs theme-text-tertiary">To</th>
                        <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">Units</th>
                        <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">$ Cost</th>
                        <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">% of units</th>
                      </tr>
                    </thead>
                    <tbody>
                      {laneRows.map(l => {
                        const pct = laneTotalUnits !== 0 ? (l.tires / laneTotalUnits) * 100 : 0;
                        return (
                          <tr key={l.lane} className="border-b theme-border-secondary">
                            <td className="py-2.5 px-4">
                              <span className="inline-flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorByLocation[l.from] || "#007AFF" }} />
                                <span className="theme-text-primary font-medium tabular-nums">{l.lane}</span>
                              </span>
                            </td>
                            <td className="py-2.5 px-4 theme-text-secondary">{locationLabel(l.from)}</td>
                            <td className="py-2.5 px-4 theme-text-secondary">{locationLabel(l.to)}</td>
                            <td className="py-2.5 px-4 text-right theme-text-primary tabular-nums">{formatNum(l.tires)}</td>
                            <td className="py-2.5 px-4 text-right theme-text-primary tabular-nums">${formatNum(l.dollars)}</td>
                            <td className="py-2.5 px-4 text-right theme-text-secondary tabular-nums">{pct.toFixed(1)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className={isDark ? "bg-slate-800/50" : "bg-gray-50"}>
                        <td className="py-2.5 px-4 font-semibold theme-text-primary" colSpan={3}>Total</td>
                        <td className="py-2.5 px-4 text-right font-semibold theme-text-primary tabular-nums">{formatNum(laneTotalUnits)}</td>
                        <td className="py-2.5 px-4 text-right font-semibold theme-text-primary tabular-nums">${formatNum(laneTotalDollars)}</td>
                        <td className="py-2.5 px-4 text-right font-semibold theme-text-secondary tabular-nums">100%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="p-5">
                  <p className="text-sm theme-text-tertiary">No transfers out in this range.</p>
                </div>
              )}
            </div>
          )}

          {/* Per-location table */}
          <div className="theme-card overflow-hidden p-0">
            <div className="px-5 py-3 border-b theme-border-secondary">
              <h2 className="text-[15px] font-semibold theme-text-primary">Totals by location</h2>
            </div>
            {data && data.perLocation.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={`${isDark ? "bg-slate-800/80" : "bg-gray-50"}`}>
                    <tr className="border-b theme-border-secondary">
                      <th className="text-left py-2.5 px-4 font-semibold text-xs theme-text-tertiary">Location</th>
                      <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">Units</th>
                      <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">Dollars</th>
                      <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">$/unit avg</th>
                      <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">% of total $</th>
                      <th className="text-right py-2.5 px-4 font-semibold text-xs theme-text-tertiary">Transfers out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perLocation.map(p => {
                      const pct = totalDollars !== 0 ? (p.dollars / totalDollars) * 100 : 0;
                      const perTire = p.tires !== 0 ? p.dollars / p.tires : 0;
                      return (
                        <tr key={p.location} className="border-b theme-border-secondary">
                          <td className="py-2.5 px-4">
                            <span className="inline-flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorByLocation[p.location] || "#007AFF" }} />
                              <span className="theme-text-primary font-medium">{p.location}</span>
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right theme-text-primary tabular-nums">{formatNum(p.tires)}</td>
                          <td className="py-2.5 px-4 text-right theme-text-primary tabular-nums">${formatNum(p.dollars)}</td>
                          <td className="py-2.5 px-4 text-right theme-text-secondary tabular-nums">${perTire.toFixed(0)}</td>
                          <td className="py-2.5 px-4 text-right theme-text-secondary tabular-nums">{pct.toFixed(1)}%</td>
                          <td className="py-2.5 px-4 text-right theme-text-secondary tabular-nums">{formatNum(p.transfersOut || 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className={isDark ? "bg-slate-800/50" : "bg-gray-50"}>
                      <td className="py-2.5 px-4 font-semibold theme-text-primary">Total</td>
                      <td className="py-2.5 px-4 text-right font-semibold theme-text-primary tabular-nums">{formatNum(totalTires)}</td>
                      <td className="py-2.5 px-4 text-right font-semibold theme-text-primary tabular-nums">${formatNum(totalDollars)}</td>
                      <td className="py-2.5 px-4 text-right font-semibold theme-text-secondary tabular-nums">
                        ${totalTires !== 0 ? (totalDollars / totalTires).toFixed(0) : "—"}
                      </td>
                      <td className="py-2.5 px-4 text-right font-semibold theme-text-secondary tabular-nums">100%</td>
                      <td className="py-2.5 px-4 text-right font-semibold theme-text-secondary tabular-nums">{formatNum(totalTransfersOut)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="p-5">
                <p className="text-sm theme-text-tertiary">No location totals in this range.</p>
              </div>
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
