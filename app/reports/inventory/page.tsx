"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { tireSizeMatchesQuery } from "@/lib/tireSearch";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import Link from "next/link";

const PAGE_SIZES = [25, 50, 100];

interface InventoryItem {
  location: string; productType: string; dclass: string; manufacturerCode: string;
  manufacturerName: string; model: string; itemId: string; mfgItemId: string;
  description: string; reorderPoint: number; qtyOnHand: number; qtyCommitted: number;
  qtyAvailable: number; lastCost: number; avgCost: number; extendedValue: number;
  priceRetail: number; priceCommercial: number; priceWholesale: number;
  [key: string]: string | number;
}

interface Filters { locations: string[]; brands: string[]; productTypes: string[]; dclasses: string[] }

export default function InventoryReportPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [location, setLocation] = useState("");
  const [brand, setBrand] = useState("");
  const [productType, setProductType] = useState("");
  const [dclass, setDclass] = useState("");
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("hasStock");
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({});
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);
  const [filterSearch, setFilterSearch] = useState("");
  const [sortCol, setSortCol] = useState("manufacturerName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [filters, setFilters] = useState<Filters>({ locations: [], brands: [], productTypes: [], dclasses: [] });
  const [fileDate, setFileDate] = useState<string | null>(null);
  const [staleWarning, setStaleWarning] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Fetch data from S3-backed API
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (location) params.set("location", location);
    if (brand) params.set("brand", brand);
    if (productType) params.set("productType", productType);
    if (dclass) params.set("dclass", dclass);
    // Push the in-stock toggle to the server so the response payload
    // shrinks before it ever hits the browser.
    if (stockFilter === "hasStock") params.set("inStock", "1");

    fetch(`/api/reports/inventory-data?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return; }
        setItems(data.items || []);
        setFilters(data.filters || { locations: [], brands: [], productTypes: [], dclasses: [] });
        setFileDate(data.fileDate);
        setStaleWarning(data.staleWarning || null);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [location, brand, productType, dclass, stockFilter]);

  const filtered = useMemo(() => {
    let result = items;
    if (search.trim()) {
      // Split on whitespace so "Cosmo 265 R25" finds items that match
      // all three tokens across any searchable field — order/position
      // doesn't matter and a missing field doesn't break the search.
      const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
      const searchableKeys: (keyof InventoryItem)[] = [
        "itemId",
        "mfgItemId",
        "description",
        "manufacturerName",
        "manufacturerCode",
        "model",
        "location",
        "productType",
        "dclass",
      ];
      result = result.filter((i) => {
        // Pre-build the haystack once per row, defensively
        const haystack = searchableKeys
          .map((k) => String(i[k] ?? "").toLowerCase())
          .join(" ");
        return tokens.every(
          (t) => haystack.includes(t) || tireSizeMatchesQuery(i.description, t)
        );
      });
    }
    // Stock filters
    if (stockFilter === "low") result = result.filter((i) => i.reorderPoint > 0 && i.qtyAvailable < i.reorderPoint);
    else if (stockFilter === "zero") result = result.filter((i) => i.qtyOnHand <= 0);
    else if (stockFilter === "negative") result = result.filter((i) => i.qtyAvailable < 0);
    else if (stockFilter === "overstocked") result = result.filter((i) => i.reorderPoint > 0 && i.qtyAvailable > i.reorderPoint * 5);
    else if (stockFilter === "hasStock") result = result.filter((i) => i.qtyOnHand > 0);
    // Column filters
    for (const [colKey, allowedValues] of Object.entries(columnFilters)) {
      if (allowedValues.size === 0) continue;
      result = result.filter((row) => allowedValues.has(String(row[colKey] || "")));
    }
    return result;
  }, [items, search, stockFilter, columnFilters]);

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

  const fmtCurrency = (n: number) => `$${n.toFixed(2)}`;

  const handleExportCSV = useCallback(() => {
    if (sorted.length === 0) return;
    const headers = ["Location", "Description", "Product Type", "D-Class", "Brand", "Model", "Item ID", "Qty On Hand", "Qty Committed", "Qty Available", "Last Cost", "Avg Cost", "Extended Value"];
    const csv = [headers.join(","), ...sorted.map((r) => [r.location, `"${r.description}"`, r.productType, r.dclass, r.manufacturerName, r.model, r.itemId, r.qtyOnHand, r.qtyCommitted, r.qtyAvailable, r.lastCost, r.avgCost, r.extendedValue].join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `inventory-${new Date().toISOString().split("T")[0]}.csv`; link.click();
  }, [sorted]);

  const handleExportExcel = useCallback(async () => {
    if (sorted.length === 0) return;
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const data = [["Location", "Description", "Product Type", "D-Class", "Brand", "Model", "Item ID", "On Hand", "Committed", "Available", "Last Cost", "Avg Cost", "Ext Value"], ...sorted.map((r) => [r.location, r.description, r.productType, r.dclass, r.manufacturerName, r.model, r.itemId, r.qtyOnHand, r.qtyCommitted, r.qtyAvailable, r.lastCost, r.avgCost, r.extendedValue])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), "Inventory");
    XLSX.writeFile(wb, `inventory-${new Date().toISOString().split("T")[0]}.xlsx`);
  }, [sorted]);

  const cols: { key: string; label: string; align?: string; filterable?: boolean }[] = [
    { key: "location", label: "Location", filterable: true }, { key: "description", label: "Description", filterable: true },
    { key: "productType", label: "Type", filterable: true }, { key: "dclass", label: "D-Class", filterable: true },
    { key: "manufacturerName", label: "Brand", filterable: true }, { key: "model", label: "Model", filterable: true },
    { key: "itemId", label: "Item ID", filterable: true }, { key: "reorderPoint", label: "Min", align: "right" },
    { key: "qtyOnHand", label: "On Hand", align: "right" },
    { key: "qtyCommitted", label: "Committed", align: "right" }, { key: "qtyAvailable", label: "Available", align: "right" },
    { key: "lastCost", label: "Last Cost", align: "right" }, { key: "avgCost", label: "Avg Cost", align: "right" },
    { key: "extendedValue", label: "Ext Value", align: "right" },
  ];

  return (
    <Protected>
      <div className="flex h-screen theme-bg-primary">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <MobileHeader />
          <header className={`sticky top-0 z-10 border-b px-4 sm:px-6 py-4 ${isDark ? "bg-slate-900/95 backdrop-blur border-slate-700" : "bg-white/95 backdrop-blur border-gray-200"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Link href="/reports" className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-gray-200 text-gray-500"}`}>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                </Link>
                <div>
                  <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Inventory Report</h1>
                  <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    {fileDate ? `Data from ${new Date(fileDate).toLocaleDateString()}` : loading ? "Loading..." : "No data — upload an OEAVAL 77 report"}
                    {sorted.length > 0 && ` — ${sorted.length} items`}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Link href="/reports/inventory/filtered" className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30" : "bg-purple-100 text-purple-700 hover:bg-purple-200"}`}>Filtered PDF</Link>
                <button onClick={handleExportCSV} disabled={sorted.length === 0} className={`px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700"}`}>CSV</button>
                <button onClick={handleExportExcel} disabled={sorted.length === 0} className={`px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${isDark ? "bg-blue-500/20 text-blue-400" : "bg-blue-100 text-blue-700"}`}>Excel</button>
              </div>
            </div>
            {staleWarning && (
              <div className={`mt-3 px-3 py-2 rounded-lg text-xs font-medium border ${isDark ? "bg-amber-500/10 border-amber-500/30 text-amber-300" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
                <span className="font-semibold">Heads up:</span> {staleWarning}
              </div>
            )}
          </header>

          <div className="px-4 sm:px-6 py-4">
            {error && <div className={`rounded-xl border p-4 mb-4 ${isDark ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-red-50 border-red-200 text-red-700"}`}>{error}</div>}

            {/* Filters */}
            <div className={`space-y-3 mb-4 p-4 rounded-xl border ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
              {/* Search + dropdowns */}
              <div className="flex flex-wrap gap-3">
                <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  placeholder="Search item ID, MFG ID, brand, model, description, size, location..."
                  className={`px-3 py-1.5 rounded-lg border text-sm w-full sm:w-64 ${isDark ? "bg-slate-900 border-slate-600 text-white placeholder:text-slate-500" : "bg-white border-gray-300 placeholder:text-gray-400"}`} />
                {[
                  { val: location, set: setLocation, opts: filters.locations, label: "All Warehouses" },
                  { val: brand, set: setBrand, opts: filters.brands, label: "All Brands" },
                  { val: productType, set: setProductType, opts: filters.productTypes, label: "All Product Types" },
                  { val: dclass, set: setDclass, opts: filters.dclasses, label: "All D-Classes" },
                ].map(({ val, set, opts, label }) => (
                  <select key={label} value={val} onChange={(e) => { set(e.target.value); setPage(0); }} className={`px-3 py-1.5 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300"}`}>
                    <option value="">{label}</option>
                    {opts.map((o) => <option key={o} value={o}>{o || "(blank)"}</option>)}
                  </select>
                ))}
              </div>
              {/* Stock quick filters */}
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[10px] font-medium ${isDark ? "text-slate-500" : "text-gray-400"}`}>Stock:</span>
                {[
                  { key: "", label: "All" },
                  { key: "low", label: "Below Min" },
                  { key: "zero", label: "Zero Stock" },
                  { key: "negative", label: "Negative" },
                  { key: "overstocked", label: "Overstocked" },
                  { key: "hasStock", label: "In Stock Only" },
                ].map(({ key, label }) => (
                  <button key={key} onClick={() => { setStockFilter(key); setPage(0); }}
                    className={`px-3 py-2 sm:px-2.5 sm:py-1 rounded-lg text-xs font-medium border transition-colors ${
                      stockFilter === key
                        ? key === "low" || key === "negative" ? "bg-red-500/20 text-red-400 border-red-500/30"
                          : key === "zero" ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                          : key === "overstocked" ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
                          : isDark ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" : "bg-blue-100 text-blue-700 border-blue-200"
                        : isDark ? "bg-slate-900/50 text-slate-500 border-slate-700" : "bg-gray-50 text-gray-400 border-gray-200"
                    }`}>
                    {label}
                  </button>
                ))}
                {(location || brand || productType || dclass || search || stockFilter) && (
                  <button onClick={() => { setLocation(""); setBrand(""); setProductType(""); setDclass(""); setSearch(""); setStockFilter(""); setPage(0); }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium ${isDark ? "text-red-400 hover:bg-red-500/10" : "text-red-600 hover:bg-red-50"}`}>Clear All</button>
                )}
              </div>
              {/* Summary stats */}
              {items.length > 0 && (
                <div className={`flex gap-4 text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  <span>{items.length.toLocaleString()} total items</span>
                  <span>{items.filter((i) => i.reorderPoint > 0 && i.qtyAvailable < i.reorderPoint).length} below min</span>
                  <span>{items.filter((i) => i.qtyOnHand <= 0).length} zero stock</span>
                  <span>${items.reduce((sum, i) => sum + i.extendedValue, 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} total value</span>
                  {filtered.length !== items.length && <span className={isDark ? "text-cyan-400" : "text-blue-600"}>Showing {filtered.length.toLocaleString()} filtered</span>}
                </div>
              )}
            </div>

            {/* Table */}
            <div className={`rounded-xl border overflow-hidden ${isDark ? "border-slate-700" : "border-gray-200"}`}>
              {loading ? (
                <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>
              ) : !fileDate && items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <svg className={`w-14 h-14 mb-4 ${isDark ? "text-slate-700" : "text-gray-300"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <p className={`text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>No inventory data available</p>
                  <p className={`text-xs text-center max-w-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Upload an OEAVAL 77 inventory snapshot (.xlsx) through{" "}
                    <Link href="/reports/upload" className={`underline ${isDark ? "text-cyan-400" : "text-blue-600"}`}>Upload Reports</Link>{" "}
                    to populate this report.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className={`sticky top-0 z-10 ${isDark ? "bg-slate-800" : "bg-gray-50"}`}>
                      <tr>
                        {cols.map((col) => {
                          const hasFilter = columnFilters[col.key]?.size > 0;
                          const isOpen = openFilterCol === col.key;
                          const uniqueVals = col.filterable ? [...new Set(filtered.map((r) => String(r[col.key] || "")))].sort() : [];
                          return (
                            <th key={col.key} className={`relative px-3 py-2.5 font-semibold whitespace-nowrap ${col.align === "right" ? "text-right" : "text-left"} ${isDark ? "text-slate-300 border-b border-slate-700" : "text-gray-600 border-b border-gray-200"}`}>
                              <div className="flex items-center gap-1">
                                <span className="cursor-pointer select-none" onClick={() => handleSort(col.key)}>
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
                        <tr><td colSpan={cols.length} className={`px-3 py-8 text-center ${isDark ? "text-slate-500" : "text-gray-400"}`}>No data</td></tr>
                      ) : paged.map((item, i) => (
                        <tr key={i} className={`border-b ${i % 2 ? isDark ? "bg-slate-800/30" : "bg-gray-50/50" : ""} ${isDark ? "border-slate-700/30 hover:bg-slate-700/20" : "border-gray-100 hover:bg-gray-50"}`}>
                          <td className={`px-3 py-1.5 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{item.location}</td>
                          <td className={`px-3 py-1.5 font-medium min-w-[250px] ${isDark ? "text-white" : "text-gray-900"}`}>{item.description}</td>
                          <td className={`px-3 py-1.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>{item.productType}</td>
                          <td className={`px-3 py-1.5 font-mono ${isDark ? "text-slate-400" : "text-gray-500"}`}>{item.dclass || "—"}</td>
                          <td className={`px-3 py-1.5 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{item.manufacturerName}</td>
                          <td className={`px-3 py-1.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>{item.model}</td>
                          <td className={`px-3 py-1.5 font-mono text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>{item.itemId}</td>
                          <td className={`px-3 py-1.5 text-right ${isDark ? "text-slate-500" : "text-gray-400"}`}>{Number(item.reorderPoint) > 0 ? String(item.reorderPoint) : "—"}</td>
                          <td className={`px-3 py-1.5 text-right font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{item.qtyOnHand}</td>
                          <td className={`px-3 py-1.5 text-right ${isDark ? "text-slate-400" : "text-gray-500"}`}>{item.qtyCommitted}</td>
                          <td className={`px-3 py-1.5 text-right font-medium ${item.reorderPoint > 0 && item.qtyAvailable < item.reorderPoint ? "text-red-400" : isDark ? "text-emerald-400" : "text-emerald-600"}`}>{item.qtyAvailable}</td>
                          <td className={`px-3 py-1.5 text-right ${isDark ? "text-slate-300" : "text-gray-700"}`}>{fmtCurrency(item.lastCost)}</td>
                          <td className={`px-3 py-1.5 text-right ${isDark ? "text-slate-300" : "text-gray-700"}`}>{fmtCurrency(item.avgCost)}</td>
                          <td className={`px-3 py-1.5 text-right font-medium ${isDark ? "text-cyan-400" : "text-blue-600"}`}>{fmtCurrency(item.extendedValue)}</td>
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
    </Protected>
  );
}
