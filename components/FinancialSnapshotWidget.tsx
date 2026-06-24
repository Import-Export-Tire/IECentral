"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/app/theme-context";

interface KPIs {
  totalRevenue: number;
  totalUnits: number;
  avgPrice: number;
  uniqueCustomers: number;
}

interface LocationData {
  name: string;
  units: number;
  revenue: number;
}

interface SalesData {
  current: {
    kpis: KPIs;
    byLocation: LocationData[];
  };
  prevMonth?: {
    data: { kpis: KPIs } | null;
  };
}

function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatYm(ym: string): string {
  if (!/^\d{6}$/.test(ym)) return ym;
  return `${MONTH_NAMES[parseInt(ym.slice(4, 6), 10) - 1]} ${ym.slice(0, 4)}`;
}

function ChangeBadge({ current, previous, isDark }: { current: number; previous: number; isDark: boolean }) {
  if (!previous) return null;
  const pct = ((current - previous) / previous) * 100;
  const isUp = pct > 0;
  const isFlat = Math.abs(pct) < 0.1;

  if (isFlat) return <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>0%</span>;

  return (
    <span className={`text-xs font-medium ${isUp ? "text-emerald-400" : "text-red-400"}`}>
      {isUp ? "+" : ""}{pct.toFixed(1)}%
    </span>
  );
}

export default function FinancialSnapshotWidget() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [data, setData] = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [monthLabel, setMonthLabel] = useState<string>("");

  useEffect(() => {
    async function fetchData() {
      try {
        // Get available months first
        const listRes = await fetch("/api/sales");
        const listData = await listRes.json();
        const months = listData.available;
        if (!months || months.length === 0) {
          setLoading(false);
          return;
        }

        // Use the latest COMPLETE month — skip the in-progress current calendar
        // month (whose partial data made the snapshot read as a huge drop) and any
        // malformed entries. Keeps the headline accurate and stable.
        const now = new Date();
        const currentYm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
        const ymList = (months as string[]).filter((m) => /^\d{6}$/.test(m));
        const latestMonth = ymList.find((m) => m < currentYm) || ymList[0] || months[0];
        setMonthLabel(formatYm(latestMonth));
        const res = await fetch(`/api/sales?months=${latestMonth}&compare=true`);
        const salesData = await res.json();
        setData(salesData);
      } catch (err) {
        console.error("Financial snapshot fetch error:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className={`border rounded-xl p-4 sm:p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
        <div className="flex items-center gap-2 mb-4">
          <svg className={`w-5 h-5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Financial Snapshot</h3>
        </div>
        <div className={`text-sm animate-pulse ${isDark ? "text-slate-500" : "text-gray-400"}`}>Loading...</div>
      </div>
    );
  }

  if (!data?.current) {
    return (
      <div className={`border rounded-xl p-4 sm:p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
        <div className="flex items-center gap-2 mb-4">
          <svg className={`w-5 h-5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Financial Snapshot</h3>
        </div>
        <p className={`text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>No sales data available.</p>
      </div>
    );
  }

  const kpis = data.current.kpis;
  const prevKpis = data.prevMonth?.data?.kpis;
  const topLocations = (data.current.byLocation || []).slice(0, 4);

  return (
    <div className={`border rounded-xl p-4 sm:p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <svg className={`w-5 h-5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
            Financial Snapshot
            {monthLabel && <span className={`ml-2 text-xs font-normal ${isDark ? "text-slate-400" : "text-gray-400"}`}>{monthLabel}</span>}
          </h3>
        </div>
        <a
          href="/reports"
          className={`text-xs font-medium transition-colors ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}
        >
          View Full Report
        </a>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Revenue */}
        <div className={`rounded-lg p-3 ${isDark ? "bg-slate-900/50" : "bg-gray-50"}`}>
          <p className={`text-[10px] font-medium uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>Revenue</p>
          <p className={`text-lg font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{fmtCurrency(kpis.totalRevenue)}</p>
          {prevKpis && <ChangeBadge current={kpis.totalRevenue} previous={prevKpis.totalRevenue} isDark={isDark} />}
        </div>

        {/* Units */}
        <div className={`rounded-lg p-3 ${isDark ? "bg-slate-900/50" : "bg-gray-50"}`}>
          <p className={`text-[10px] font-medium uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>Units Sold</p>
          <p className={`text-lg font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{kpis.totalUnits.toLocaleString()}</p>
          {prevKpis && <ChangeBadge current={kpis.totalUnits} previous={prevKpis.totalUnits} isDark={isDark} />}
        </div>

        {/* Avg Price */}
        <div className={`rounded-lg p-3 ${isDark ? "bg-slate-900/50" : "bg-gray-50"}`}>
          <p className={`text-[10px] font-medium uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>Avg Price</p>
          <p className={`text-lg font-bold ${isDark ? "text-white" : "text-gray-900"}`}>${kpis.avgPrice.toFixed(2)}</p>
          {prevKpis && <ChangeBadge current={kpis.avgPrice} previous={prevKpis.avgPrice} isDark={isDark} />}
        </div>

        {/* Customers */}
        <div className={`rounded-lg p-3 ${isDark ? "bg-slate-900/50" : "bg-gray-50"}`}>
          <p className={`text-[10px] font-medium uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>Customers</p>
          <p className={`text-lg font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{kpis.uniqueCustomers}</p>
          {prevKpis && <ChangeBadge current={kpis.uniqueCustomers} previous={prevKpis.uniqueCustomers} isDark={isDark} />}
        </div>
      </div>

      {/* Location Breakdown (mini bar chart) */}
      {topLocations.length > 0 && (
        <div>
          <p className={`text-[10px] font-medium uppercase tracking-wider mb-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Revenue by Location</p>
          <div className="space-y-1.5">
            {topLocations.map((loc) => {
              const pct = kpis.totalRevenue > 0 ? (loc.revenue / kpis.totalRevenue) * 100 : 0;
              return (
                <div key={loc.name} className="flex items-center gap-2">
                  <span className={`text-[11px] font-mono w-8 flex-shrink-0 ${isDark ? "text-slate-400" : "text-gray-500"}`}>{loc.name}</span>
                  <div className={`flex-1 h-4 rounded-full overflow-hidden ${isDark ? "bg-slate-900" : "bg-gray-200"}`}>
                    <div
                      className="h-full rounded-full bg-emerald-500/70"
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                  <span className={`text-[11px] font-medium w-16 text-right ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    {fmtCurrency(loc.revenue)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
