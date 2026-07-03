"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { LOCATION_LABELS } from "@/lib/locationLabels";
import { tireSizeMatchesQuery } from "@/lib/tireSearch";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeader from "@/components/ui/SectionHeader";

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
  void theme;

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
      <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <MobileHeader />
          <header className="sticky top-0 z-10 border-b px-4 sm:px-6 py-3 sm:py-4 backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <Link href="/reports" className="p-2 rounded-lg transition-colors theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5 flex-shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                </Link>
                <div className="min-w-0">
                  <h1 className="text-xl font-bold theme-text-primary">Sales History</h1>
                  <p className="text-xs mt-0.5 theme-text-tertiary">
                    {fileDate ? `Data from ${new Date(fileDate).toLocaleDateString()}` : loading ? "Loading..." : "No data — upload an OEA07V Sales History report"}
                    {sorted.length > 0 && ` — ${sorted.length} items, ${visibleMonths.length} months`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 flex-shrink-0">
                <button onClick={() => setShowInfo(true)} className="p-2 rounded-lg transition-colors theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5" title="About this report">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
                <Button variant="ghost" onClick={handleExportCSV} disabled={sorted.length === 0}>CSV</Button>
                <Button variant="secondary" onClick={handleExportExcel} disabled={sorted.length === 0}>Excel</Button>
              </div>
            </div>
          </header>

          <div className="px-4 sm:px-6 py-5 space-y-4">
            {error && (
              <Card tone="red" padding="sm">
                <p className="text-sm theme-text-primary">{error}</p>
              </Card>
            )}

            {/* Filters */}
            <Card padding="sm">
              <SectionHeader label="Filters" />
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  placeholder="Search item ID, description, brand..."
                  className="theme-input px-3 py-1.5 text-sm w-full sm:w-56" />
                <select value={brand} onChange={(e) => { setBrand(e.target.value); setPage(0); }} className="theme-input px-3 py-1.5 text-sm">
                  <option value="">All Brands</option>
                  {filters.brands.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                <select value={productType} onChange={(e) => { setProductType(e.target.value); setPage(0); }} className="theme-input px-3 py-1.5 text-sm">
                  <option value="">All Types</option>
                  {filters.productTypes.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <select value={dclass} onChange={(e) => { setDclass(e.target.value); setPage(0); }} className="theme-input px-3 py-1.5 text-sm">
                  <option value="">All D-Classes</option>
                  {filters.dclasses.map((d) => <option key={d} value={d}>{d || "(blank)"}</option>)}
                </select>
                <select value={location} onChange={(e) => { setLocation(e.target.value); setPage(0); }} className="theme-input px-3 py-1.5 text-sm">
                  <option value="">All Locations</option>
                  {filters.locations.map((l) => <option key={l} value={l}>{LOCATION_LABELS[l] ? `${l} — ${LOCATION_LABELS[l]}` : l}</option>)}
                </select>
                <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border theme-input text-xs cursor-pointer" title="Include returns to vendors (e.g. acct W4490). Off by default — these can be 100+ units in one row.">
                  <input type="checkbox" checked={includeVendorReturns} onChange={(e) => { setIncludeVendorReturns(e.target.checked); setPage(0); }} className="rounded w-3.5 h-3.5" />
                  Include vendor returns
                </label>
                <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border theme-input text-xs cursor-pointer" title="Include sales recorded under bare location-shaped accounts (e.g. R20) and other internal-looking account codes. Surfaces sales that would otherwise be filtered as transfers.">
                  <input type="checkbox" checked={includeInternalAccounts} onChange={(e) => { setIncludeInternalAccounts(e.target.checked); setPage(0); }} className="rounded w-3.5 h-3.5" />
                  Include internal-account sales
                </label>

                <div className="h-6 w-px bg-black/10 dark:bg-white/10" />

                <select value={startMonth} onChange={(e) => { setStartMonth(e.target.value); setPage(0); }} className="theme-input px-3 py-1.5 text-sm">
                  <option value="">Start Month</option>
                  {allMonths.map((m) => <option key={m} value={m}>{fmtMonth(m)}</option>)}
                </select>
                <span className="text-xs theme-text-tertiary">to</span>
                <select value={endMonth} onChange={(e) => { setEndMonth(e.target.value); setPage(0); }} className="theme-input px-3 py-1.5 text-sm">
                  <option value="">End Month</option>
                  {allMonths.map((m) => <option key={m} value={m}>{fmtMonth(m)}</option>)}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {(brand || productType || dclass || location || search) && (
                  <Button variant="danger" size="sm" onClick={() => { setBrand(""); setProductType(""); setDclass(""); setLocation(""); setSearch(""); setPage(0); }}>
                    Clear All
                  </Button>
                )}
                {filtered.length !== items.length && (
                  <span className="text-[10px] text-[#007AFF]">{filtered.length.toLocaleString()} of {items.length.toLocaleString()} items</span>
                )}
              </div>
            </Card>

            {/* Table */}
            <div className="theme-card overflow-hidden p-0">
              {loading ? (
                <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" /></div>
              ) : !fileDate && items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <svg className="w-14 h-14 mb-4 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-sm font-medium mb-1 theme-text-secondary">No sales history data available</p>
                  <p className="text-xs text-center max-w-sm theme-text-tertiary">
                    Upload OEA07V daily sales reports through{" "}
                    <Link href="/reports/upload" className="text-[#007AFF] underline">Upload Reports</Link>{" "}
                    to see monthly sales totals here.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-black/[0.03] dark:bg-white/[0.03]">
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
                            <th key={col.key} className={`relative px-3 py-2.5 font-semibold whitespace-nowrap border-b theme-border-secondary ${isNumCol ? "text-right" : "text-left"} theme-text-tertiary`}>
                              <div className="flex items-center gap-1">
                                <span className={`${!col.key.startsWith("m_") ? "cursor-pointer select-none" : ""}`}
                                  onClick={() => !col.key.startsWith("m_") && handleSort(col.key)}>
                                  {col.label}{sortCol === col.key && <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>}
                                </span>
                                {col.filterable && (
                                  <button onClick={(e) => { e.stopPropagation(); setOpenFilterCol(isOpen ? null : col.key); setFilterSearch(""); }}
                                    className={`p-0.5 rounded transition-colors ${hasFilter ? "text-[#007AFF]" : "theme-text-tertiary hover:theme-text-secondary"}`}>
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                              {isOpen && (() => {
                                const searched = filterSearch ? uniqueVals.filter((v) => v.toLowerCase().includes(filterSearch.toLowerCase())) : uniqueVals;
                                return (
                                  <div className="theme-card absolute left-0 top-full mt-1 w-[calc(100vw-2rem)] sm:w-56 shadow-xl z-20 p-0 overflow-hidden"
                                    onClick={(e) => e.stopPropagation()}>
                                    <div className="px-2 pt-2 pb-1 border-b theme-border-secondary">
                                      <input type="text" value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)}
                                        placeholder="Search..." autoFocus
                                        className="theme-input w-full px-2 py-1 text-xs" />
                                      <div className="flex items-center justify-between mt-1">
                                        <span className="text-[10px] theme-text-tertiary">{searched.length} values</span>
                                        <div className="flex gap-1">
                                          <button onClick={() => setColumnFilters((f) => ({ ...f, [col.key]: new Set(searched) }))}
                                            className="text-[10px] px-1 text-[#007AFF]">Select shown</button>
                                          <button onClick={() => setColumnFilters((f) => { const n = { ...f }; delete n[col.key]; return n; })}
                                            className="text-[10px] px-1 theme-text-tertiary">Clear</button>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="max-h-52 overflow-y-auto p-1">
                                      {searched.slice(0, 200).map((val) => {
                                        const checked = !columnFilters[col.key] || columnFilters[col.key].size === 0 || columnFilters[col.key].has(val);
                                        return (
                                          <label key={val} className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs theme-text-secondary hover:bg-black/5 dark:hover:bg-white/5">
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
                        <tr><td colSpan={6 + visibleMonths.length + 2} className="px-3 py-8 text-center theme-text-tertiary">No data</td></tr>
                      ) : paged.map((item, i) => (
                        <tr key={i} className={`border-b theme-border-secondary transition-colors ${i % 2 ? "bg-black/[0.015] dark:bg-white/[0.015]" : ""} hover:bg-black/[0.025] dark:hover:bg-white/[0.025]`}>
                          <td className="px-3 py-1.5 font-medium min-w-[220px] theme-text-primary">{item.description}</td>
                          <td className="px-3 py-1.5 theme-text-secondary">{item.brand || item.manufacturerName}</td>
                          <td className="px-3 py-1.5 theme-text-tertiary">{item.model}</td>
                          <td className="px-3 py-1.5 font-mono text-[10px] theme-text-tertiary">{item.itemId}</td>
                          <td className="px-3 py-1.5 theme-text-tertiary">{item.productType}</td>
                          <td className="px-3 py-1.5 font-mono theme-text-tertiary">{item.dclass || "—"}</td>
                          {visibleMonths.map((m) => {
                            const val = item.monthlySales[m];
                            return (
                              <td key={m} className={`px-3 py-1.5 text-right ${val ? (val < 0 ? "text-red-400" : "text-emerald-600 dark:text-emerald-400") : "text-gray-200 dark:text-slate-700"}`}>
                                {val || "—"}
                              </td>
                            );
                          })}
                          <td className="px-3 py-1.5 text-right font-bold theme-text-primary">{item.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {sorted.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border-t theme-border-secondary">
                  <span className="text-xs theme-text-tertiary">Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sorted.length)} of {sorted.length}</span>
                  <div className="flex items-center gap-2">
                    <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} className="theme-input px-2 py-1 text-xs">
                      {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}/page</option>)}
                    </select>
                    <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
                    <span className="text-xs theme-text-tertiary">{page + 1}/{totalPages || 1}</span>
                    <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
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
          <div className="theme-card w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b theme-border-secondary flex items-center justify-between">
              <h3 className="text-lg font-semibold theme-text-primary">About Sales History</h3>
              <button onClick={() => setShowInfo(false)} className="p-1 rounded-lg theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4 text-sm theme-text-secondary">
              <div>
                <h4 className="font-semibold mb-1 theme-text-primary">What is this report?</h4>
                <p>Monthly sales aggregation by item. Shows net quantity sold per month for each tire product, sorted by total volume.</p>
              </div>
              <div>
                <h4 className="font-semibold mb-1 theme-text-primary">Data Source</h4>
                <p>Aggregated from daily <strong>OEA07V</strong> reports uploaded by the PH team. Each daily file contains item-level sales and return transactions.</p>
              </div>
              <div>
                <h4 className="font-semibold mb-1 theme-text-primary">Understanding the Numbers</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong className="text-emerald-600 dark:text-emerald-400">Positive numbers</strong> = net units sold in that month</li>
                  <li><strong className="text-red-600 dark:text-red-400">Negative numbers</strong> = net returns exceeded sales (more came back than went out)</li>
                  <li><strong>Total</strong> = sum across all visible months</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-1 theme-text-primary">Descriptions &amp; Brands</h4>
                <p>Enriched from the <strong>Tires Catalog</strong> (FTP hourly sync). Brand codes are mapped to full manufacturer names. Descriptions include size, load index, speed rating, and sidewall from the catalog.</p>
              </div>
              <div>
                <h4 className="font-semibold mb-1 theme-text-primary">Filters Applied</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li>Tire products only (type starts with T, excludes T alone)</li>
                  <li>Customer sales only (excludes warehouse transfers, internal accounts 700/7001/7002)</li>
                  <li>Excludes non-sale transactions (transfers, receives)</li>
                  <li>Non-product items filtered (descriptions starting with =, ~, $, *, #)</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-1 theme-text-primary">D-Class</h4>
                <p>Extracted from the trailing character on the Item ID. Dot, Caret, Bracket, Colon, Dash, Tilde, Star, Hash.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </Protected>
  );
}
