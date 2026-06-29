"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { LOCATION_LABELS } from "@/lib/locationLabels";
import { tireSizeMatchesQuery } from "@/lib/tireSearch";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import Link from "next/link";

const PAGE_SIZES = [25, 50, 100];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtMonth(m: string): string { const [y, mo] = m.split("-"); return `${MONTH_NAMES[parseInt(mo) - 1]} ${y?.slice(2)}`; }

interface SalesItem {
  itemId: string; dclass: string; mfgItemId: string; brand: string;
  manufacturerName?: string; model: string; description: string; productType: string;
  monthlySales: Record<string, number>; total: number; availableStock?: number;
  isColonRow?: boolean; [key: string]: unknown;
}

interface Filters { brands: string[]; productTypes: string[]; dclasses: string[]; locations: string[] }

export default function SalesHistoryReportPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [showInfo, setShowInfo] = useState(false);
  const [brand, setBrand] = useState("");
  const [productType, setProductType] = useState("");
  const [dclass, setDclass] = useState("");
  const [location, setLocation] = useState("");
  const [includeVendorReturns, setIncludeVendorReturns] = useState(false);
  // Default ON per Andy 5/27: bare-R20 / INV-* / 99-* Sld rows are real
  // store sales (same-day receive-and-sell at a retail location lands here).
  const [includeInternalAccounts, setIncludeInternalAccounts] = useState(true);
  const [startMonth, setStartMonth] = useState(() => `${new Date().getFullYear()}-01`);
  const [endMonth, setEndMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [showAllRows, setShowAllRows] = useState(false);
  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({});
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);
  const [filterSearch, setFilterSearch] = useState("");
  const hideSpecial = true; // Always filter non-product items
  const [sortCol, setSortCol] = useState("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<SalesItem[]>([]);
  const [monthColumns, setMonthColumns] = useState<string[]>([]);
  const [allMonths, setAllMonths] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>({ brands: [], productTypes: [], dclasses: [], locations: [] });
  const [fileDate, setFileDate] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (brand) params.set("brand", brand);
    if (productType) params.set("productType", productType);
    if (dclass) params.set("dclass", dclass);
    if (location) params.set("location", location);
    if (includeVendorReturns) params.set("includeVendorReturns", "true");
    if (includeInternalAccounts) params.set("includeInternalAccounts", "true");
    if (startMonth) params.set("startMonth", startMonth);
    if (endMonth) params.set("endMonth", endMonth);
    if (showAllRows) params.set("showAllRows", "true");

    fetch(`/api/reports/sales-history-data?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return; }
        setItems(data.items || []);
        setMonthColumns(data.monthColumns || []);
        setAllMonths(data.allAvailableMonths || []);
        setFilters((prev) => ({
          brands: data.filters?.brands || [],
          productTypes: data.filters?.productTypes || [],
          dclasses: data.filters?.dclasses || [],
          // Preserve the locations list across filter changes — the API only
          // returns locations *seen after* the location filter was applied,
          // so once you pick a location the others would disappear otherwise.
          locations: (data.filters?.locations || []).length > 0 ? data.filters.locations : prev.locations,
        }));
        setFileDate(data.fileDate);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [startMonth, endMonth, location, includeVendorReturns, includeInternalAccounts]);

  // Filter month columns to selected range
  const visibleMonths = useMemo((): string[] => {
    let cols = monthColumns;
    if (startMonth) cols = cols.filter((m: string) => m >= startMonth);
    if (endMonth) cols = cols.filter((m: string) => m <= endMonth);
    return cols;
  }, [monthColumns, startMonth, endMonth]);

  const filtered = useMemo(() => {
    let result = items;
    if (hideSpecial) result = result.filter((i) => !/^[=~$*#]/.test(i.description));
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((i) =>
        i.itemId.toLowerCase().includes(q) || i.description.toLowerCase().includes(q) ||
        (i.brand || i.manufacturerName || "").toLowerCase().includes(q) ||
        i.mfgItemId.toLowerCase().includes(q) ||
        tireSizeMatchesQuery(i.description, search)
      );
    }
    if (brand) result = result.filter((i) => (i.brand || i.manufacturerName) === brand);
    if (productType) result = result.filter((i) => i.productType === productType);
    if (dclass) result = result.filter((i) => i.dclass === dclass);
    // Column filters
    for (const [colKey, allowedValues] of Object.entries(columnFilters)) {
      if (allowedValues.size === 0) continue;
      result = result.filter((row) => allowedValues.has(String((row as any)[colKey] || "")));
    }
    return result;
  }, [items, hideSpecial, search, brand, productType, dclass, columnFilters]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortCol]; const bv = b[sortCol];
      const cmp = String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir]);

  const paged = useMemo(() => sorted.slice(page * pageSize, (page + 1) * pageSize), [sorted, page, pageSize]);
  const totalPages = Math.ceil(sorted.length / pageSize);

  const handleSort = useCallback((col: string) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
    setPage(0);
  }, [sortCol]);

  const handleExportCSV = useCallback(() => {
    if (sorted.length === 0) return;
    const headers = ["Description", "Brand", "Model", "Item ID", "Type", "D-Class", ...visibleMonths.map(fmtMonth), "Total"];
    const csv = [headers.join(","), ...sorted.map((r) => [
      `"${r.description}"`, r.manufacturerName, r.model, r.itemId, r.productType, r.dclass,
      ...visibleMonths.map((m) => r.monthlySales[m] || 0), r.total,
    ].join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `sales-history-${new Date().toISOString().split("T")[0]}.csv`; link.click();
  }, [sorted, visibleMonths]);

  const handleExportExcel = useCallback(async () => {
    if (sorted.length === 0) return;
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const headers = ["Description", "Brand", "Model", "Item ID", "Type", "D-Class", ...visibleMonths.map(fmtMonth), "Total"];
    const data = [headers, ...sorted.map((r) => [r.description, r.manufacturerName, r.model, r.itemId, r.productType, r.dclass, ...visibleMonths.map((m) => r.monthlySales[m] || 0), r.total])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), "Sales History");
    XLSX.writeFile(wb, `sales-history-${new Date().toISOString().split("T")[0]}.xlsx`);
  }, [sorted, visibleMonths]);

  return (
    <Protected>
      <div className="flex h-screen theme-bg-primary">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <MobileHeader />
          <header className={`sticky top-0 z-10 border-b px-4 sm:px-6 py-4 ${isDark ? "bg-slate-900/95 backdrop-blur border-slate-700" : "bg-white/95 backdrop-blur border-gray-200"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <Link href="/reports" className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-gray-200 text-gray-500"}`}>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                </Link>
                <div>
                  <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Sales History</h1>
                  <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    {fileDate ? `Data from ${new Date(fileDate).toLocaleDateString()}` : loading ? "Loading..." : "No data — upload an OEA07V Sales History report"}
                    {sorted.length > 0 && ` — ${sorted.length} items, ${visibleMonths.length} months`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setShowInfo(true)} className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-gray-200 text-gray-500"}`} title="About this report">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
                <button onClick={handleExportCSV} disabled={sorted.length === 0} className={`px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700"}`}>CSV</button>
                <button onClick={handleExportExcel} disabled={sorted.length === 0} className={`px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${isDark ? "bg-blue-500/20 text-blue-400" : "bg-blue-100 text-blue-700"}`}>Excel</button>
              </div>
            </div>
          </header>

          <div className="px-4 sm:px-6 py-4">
            {error && <div className={`rounded-xl border p-4 mb-4 ${isDark ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-red-50 border-red-200 text-red-700"}`}>{error}</div>}

            {/* Filters */}
            <div className={`space-y-3 mb-4 p-4 rounded-xl border ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className="flex flex-wrap items-center gap-3">
                <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  placeholder="Search item ID, description, brand..."
                  className={`px-3 py-1.5 rounded-lg border text-sm w-full sm:w-56 ${isDark ? "bg-slate-900 border-slate-600 text-white placeholder:text-slate-500" : "bg-white border-gray-300 placeholder:text-gray-400"}`} />
                <select value={brand} onChange={(e) => { setBrand(e.target.value); setPage(0); }} className={`px-3 py-1.5 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300"}`}>
                  <option value="">All Brands</option>
                  {filters.brands.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                <select value={productType} onChange={(e) => { setProductType(e.target.value); setPage(0); }} className={`px-3 py-1.5 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300"}`}>
                  <option value="">All Types</option>
                  {filters.productTypes.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <select value={dclass} onChange={(e) => { setDclass(e.target.value); setPage(0); }} className={`px-3 py-1.5 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300"}`}>
                  <option value="">All D-Classes</option>
                  {filters.dclasses.map((d) => <option key={d} value={d}>{d || "(blank)"}</option>)}
                </select>
                <select value={location} onChange={(e) => { setLocation(e.target.value); setPage(0); }} className={`px-3 py-1.5 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300"}`}>
                  <option value="">All Locations</option>
                  {filters.locations.map((l) => <option key={l} value={l}>{LOCATION_LABELS[l] ? `${l} — ${LOCATION_LABELS[l]}` : l}</option>)}
                </select>
                <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs cursor-pointer ${isDark ? "bg-slate-900 border-slate-600 text-slate-300 hover:border-slate-500" : "bg-white border-gray-300 text-gray-700 hover:border-gray-400"}`} title="Include returns to vendors (e.g. acct W4490). Off by default — these can be 100+ units in one row.">
                  <input type="checkbox" checked={includeVendorReturns} onChange={(e) => { setIncludeVendorReturns(e.target.checked); setPage(0); }} className="rounded w-3.5 h-3.5" />
                  Include vendor returns
                </label>
                <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs cursor-pointer ${isDark ? "bg-slate-900 border-slate-600 text-slate-300 hover:border-slate-500" : "bg-white border-gray-300 text-gray-700 hover:border-gray-400"}`} title="Include sales recorded under bare location-shaped accounts (e.g. R20) and other internal-looking account codes. Surfaces sales that would otherwise be filtered as transfers.">
                  <input type="checkbox" checked={includeInternalAccounts} onChange={(e) => { setIncludeInternalAccounts(e.target.checked); setPage(0); }} className="rounded w-3.5 h-3.5" />
                  Include internal-account sales
                </label>

                <div className={`h-6 w-px ${isDark ? "bg-slate-700" : "bg-gray-200"}`} />

                <select value={startMonth} onChange={(e) => { setStartMonth(e.target.value); setPage(0); }} className={`px-3 py-1.5 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300"}`}>
                  <option value="">Start Month</option>
                  {allMonths.map((m) => <option key={m} value={m}>{fmtMonth(m)}</option>)}
                </select>
                <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>to</span>
                <select value={endMonth} onChange={(e) => { setEndMonth(e.target.value); setPage(0); }} className={`px-3 py-1.5 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300"}`}>
                  <option value="">End Month</option>
                  {allMonths.map((m) => <option key={m} value={m}>{fmtMonth(m)}</option>)}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {(brand || productType || dclass || location || search) && (
                  <button onClick={() => { setBrand(""); setProductType(""); setDclass(""); setLocation(""); setSearch(""); setPage(0); }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium ${isDark ? "text-red-400 hover:bg-red-500/10" : "text-red-600 hover:bg-red-50"}`}>Clear All</button>
                )}
                {filtered.length !== items.length && (
                  <span className={`text-[10px] ${isDark ? "text-cyan-400" : "text-blue-600"}`}>{filtered.length.toLocaleString()} of {items.length.toLocaleString()} items</span>
                )}
              </div>
            </div>

            {/* Table */}
            <div className={`rounded-xl border overflow-hidden ${isDark ? "border-slate-700" : "border-gray-200"}`}>
              {loading ? (
                <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>
              ) : !fileDate && items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <svg className={`w-14 h-14 mb-4 ${isDark ? "text-slate-700" : "text-gray-300"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className={`text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>No sales history data available</p>
                  <p className={`text-xs text-center max-w-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Upload OEA07V daily sales reports through{" "}
                    <Link href="/reports/upload" className={`underline ${isDark ? "text-cyan-400" : "text-blue-600"}`}>Upload Reports</Link>{" "}
                    to see monthly sales totals here.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className={`sticky top-0 z-10 ${isDark ? "bg-slate-800" : "bg-gray-50"}`}>
                      <tr>
                        {[
                          { key: "description", label: "Description", filterable: true },
                          { key: "brand", label: "Brand", filterable: true },
                          { key: "model", label: "Model", filterable: false },
                          { key: "itemId", label: "Item ID", filterable: true },
                          { key: "productType", label: "Type", filterable: true },
                          { key: "dclass", label: "D-Class", filterable: true },
                          ...visibleMonths.map((m) => ({ key: `m_${m}`, label: fmtMonth(m), filterable: false })),
                          { key: "total", label: "Total", filterable: false },
                        ].map((col) => {
                          const isNumCol = col.key.startsWith("m_") || col.key === "total";
                          const hasFilter = columnFilters[col.key]?.size > 0;
                          const isOpen = openFilterCol === col.key;
                          const uniqueVals = col.filterable ? [...new Set(filtered.map((r) => String((r as any)[col.key] || "")))].sort() : [];

                          return (
                            <th key={col.key} className={`relative px-3 py-2.5 font-semibold whitespace-nowrap ${isNumCol ? "text-right" : "text-left"} ${isDark ? "text-slate-300 border-b border-slate-700" : "text-gray-600 border-b border-gray-200"}`}>
                              <div className="flex items-center gap-1">
                                <span className={`${!col.key.startsWith("m_") ? "cursor-pointer select-none" : ""}`}
                                  onClick={() => !col.key.startsWith("m_") && handleSort(col.key)}>
                                  {col.label}{sortCol === col.key && <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>}
                                </span>
                                {col.filterable && (
                                  <button onClick={(e) => { e.stopPropagation(); setOpenFilterCol(isOpen ? null : col.key); setFilterSearch(""); }}
                                    className={`p-0.5 rounded ${hasFilter ? (isDark ? "text-cyan-400" : "text-blue-600") : isDark ? "text-slate-600 hover:text-slate-400" : "text-gray-300 hover:text-gray-500"}`}>
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                              {isOpen && (() => {
                                const searched = filterSearch ? uniqueVals.filter((v) => v.toLowerCase().includes(filterSearch.toLowerCase())) : uniqueVals;
                                return (
                                  <div className={`absolute left-0 top-full mt-1 w-[calc(100vw-2rem)] sm:w-56 rounded-lg border shadow-xl z-20 ${isDark ? "bg-slate-800 border-slate-600" : "bg-white border-gray-200"}`}
                                    onClick={(e) => e.stopPropagation()}>
                                    <div className={`px-2 pt-2 pb-1 border-b ${isDark ? "border-slate-700" : "border-gray-100"}`}>
                                      <input type="text" value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)}
                                        placeholder="Search..." autoFocus
                                        className={`w-full px-2 py-1 rounded border text-xs ${isDark ? "bg-slate-900 border-slate-600 text-white placeholder:text-slate-500" : "bg-white border-gray-300"}`} />
                                      <div className="flex items-center justify-between mt-1">
                                        <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>{searched.length} values</span>
                                        <div className="flex gap-1">
                                          <button onClick={() => setColumnFilters((f) => ({ ...f, [col.key]: new Set(searched) }))}
                                            className={`text-[10px] px-1 ${isDark ? "text-cyan-400" : "text-blue-600"}`}>Select shown</button>
                                          <button onClick={() => setColumnFilters((f) => { const n = { ...f }; delete n[col.key]; return n; })}
                                            className={`text-[10px] px-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Clear</button>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="max-h-52 overflow-y-auto p-1">
                                      {searched.slice(0, 200).map((val) => {
                                        const checked = !columnFilters[col.key] || columnFilters[col.key].size === 0 || columnFilters[col.key].has(val);
                                        return (
                                          <label key={val} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs ${isDark ? "hover:bg-slate-700 text-slate-300" : "hover:bg-gray-50 text-gray-700"}`}>
                                            <input type="checkbox" checked={checked} onChange={() => {
                                              setColumnFilters((prev) => {
                                                const current = prev[col.key] ? new Set(prev[col.key]) : new Set(uniqueVals);
                                                if (current.has(val)) current.delete(val); else current.add(val);
                                                return { ...prev, [col.key]: current };
                                              });
                                            }} className="rounded w-3 h-3" />
                                            <span className="truncate">{val || "(blank)"}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })()}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {paged.length === 0 ? (
                        <tr><td colSpan={6 + visibleMonths.length + 2} className={`px-3 py-8 text-center ${isDark ? "text-slate-500" : "text-gray-400"}`}>No data</td></tr>
                      ) : paged.map((item, i) => (
                        <tr key={i} className={`border-b ${i % 2 ? isDark ? "bg-slate-800/30" : "bg-gray-50/50" : ""} ${isDark ? "border-slate-700/30 hover:bg-slate-700/20" : "border-gray-100 hover:bg-gray-50"}`}>
                          <td className={`px-3 py-1.5 font-medium min-w-[220px] ${isDark ? "text-white" : "text-gray-900"}`}>{item.description}</td>
                          <td className={`px-3 py-1.5 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{item.brand || item.manufacturerName}</td>
                          <td className={`px-3 py-1.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>{item.model}</td>
                          <td className={`px-3 py-1.5 font-mono text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>{item.itemId}</td>
                          <td className={`px-3 py-1.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>{item.productType}</td>
                          <td className={`px-3 py-1.5 font-mono ${isDark ? "text-slate-400" : "text-gray-500"}`}>{item.dclass || "—"}</td>
                          {visibleMonths.map((m) => {
                            const val = item.monthlySales[m];
                            return (
                              <td key={m} className={`px-3 py-1.5 text-right ${val ? (val < 0 ? "text-red-400" : isDark ? "text-emerald-400" : "text-emerald-600") : isDark ? "text-slate-700" : "text-gray-200"}`}>
                                {val || "—"}
                              </td>
                            );
                          })}
                          <td className={`px-3 py-1.5 text-right font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{item.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {sorted.length > 0 && (
                <div className={`flex items-center justify-between px-4 py-3 border-t ${isDark ? "bg-slate-800 border-slate-700" : "bg-gray-50 border-gray-200"}`}>
                  <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sorted.length)} of {sorted.length}</span>
                  <div className="flex items-center gap-2">
                    <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} className={`px-2 py-1 rounded border text-xs ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300"}`}>
                      {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}/page</option>)}
                    </select>
                    <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className={`px-2 py-1 rounded text-xs disabled:opacity-30 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Prev</button>
                    <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>{page + 1}/{totalPages || 1}</span>
                    <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className={`px-2 py-1 rounded text-xs disabled:opacity-30 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Next</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Info Modal */}
      {showInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowInfo(false)}>
          <div className={`w-full max-w-lg rounded-xl shadow-2xl ${isDark ? "bg-slate-800" : "bg-white"}`} onClick={(e) => e.stopPropagation()}>
            <div className={`px-6 py-4 border-b flex items-center justify-between ${isDark ? "border-slate-700" : "border-gray-200"}`}>
              <h3 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>About Sales History</h3>
              <button onClick={() => setShowInfo(false)} className={`p-1 rounded-lg ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className={`px-6 py-5 space-y-4 text-sm ${isDark ? "text-slate-300" : "text-gray-600"}`}>
              <div>
                <h4 className={`font-semibold mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>What is this report?</h4>
                <p>Monthly sales aggregation by item. Shows net quantity sold per month for each tire product, sorted by total volume.</p>
              </div>
              <div>
                <h4 className={`font-semibold mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>Data Source</h4>
                <p>Aggregated from daily <strong>OEA07V</strong> reports uploaded by the PH team. Each daily file contains item-level sales and return transactions.</p>
              </div>
              <div>
                <h4 className={`font-semibold mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>Understanding the Numbers</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong className={isDark ? "text-emerald-400" : "text-emerald-600"}>Positive numbers</strong> = net units sold in that month</li>
                  <li><strong className={isDark ? "text-red-400" : "text-red-600"}>Negative numbers</strong> = net returns exceeded sales (more came back than went out)</li>
                  <li><strong>Total</strong> = sum across all visible months</li>
                </ul>
              </div>
              <div>
                <h4 className={`font-semibold mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>Descriptions & Brands</h4>
                <p>Enriched from the <strong>Tires Catalog</strong> (FTP hourly sync). Brand codes are mapped to full manufacturer names. Descriptions include size, load index, speed rating, and sidewall from the catalog.</p>
              </div>
              <div>
                <h4 className={`font-semibold mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>Filters Applied</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li>Tire products only (type starts with T, excludes T alone)</li>
                  <li>Customer sales only (excludes warehouse transfers, internal accounts 700/7001/7002)</li>
                  <li>Excludes non-sale transactions (transfers, receives)</li>
                  <li>Non-product items filtered (descriptions starting with =, ~, $, *, #)</li>
                </ul>
              </div>
              <div>
                <h4 className={`font-semibold mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>D-Class</h4>
                <p>Extracted from the trailing character on the Item ID. Dot, Caret, Bracket, Colon, Dash, Tilde, Star, Hash.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </Protected>
  );
}
