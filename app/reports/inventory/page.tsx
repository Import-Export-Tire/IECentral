"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { tireSizeMatchesQuery } from "@/lib/tireSearch";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeader from "@/components/ui/SectionHeader";

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

  // Deep-link from global search: ?search=<itemId> shows that product's inventory
  // across all locations. Read once on mount (avoids useSearchParams Suspense).
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("search");
    if (s) setSearch(s);
  }, []);

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
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </Link>
                <div className="min-w-0">
                  <h1 className="text-xl font-bold theme-text-primary">Inventory Report</h1>
                  <p className="text-xs mt-0.5 theme-text-tertiary">
                    {fileDate ? `Data from ${new Date(fileDate).toLocaleDateString()}` : loading ? "Loading..." : "No data — upload an OEAVAL 77 report"}
                    {sorted.length > 0 && ` — ${sorted.length} items`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                <Link
                  href="/reports/inventory/filtered"
                  className="inline-flex items-center justify-center gap-1.5 rounded-[9px] font-semibold transition-colors px-3.5 py-2 text-[13.5px] ui-btn-ghost"
                >
                  Filtered PDF
                </Link>
                <Button variant="ghost" onClick={handleExportCSV} disabled={sorted.length === 0}>
                  CSV
                </Button>
                <Button variant="secondary" onClick={handleExportExcel} disabled={sorted.length === 0}>
                  Excel
                </Button>
              </div>
            </div>

            {/* Stale data warning — inline in header */}
            {staleWarning && (
              <div className="mt-3">
                <Card tone="amber" padding="sm">
                  <p className="text-xs"><span className="font-semibold">Heads up:</span> {staleWarning}</p>
                </Card>
              </div>
            )}
          </header>

          <div className="px-4 sm:px-6 py-5 space-y-4">

            {/* Error banner */}
            {error && (
              <Card tone="red" padding="sm">
                <p className="text-sm theme-text-primary">{error}</p>
              </Card>
            )}

            {/* Filter panel */}
            <Card padding="sm">
              <SectionHeader label="Filters" />
              {/* Search + dropdowns */}
              <div className="flex flex-wrap gap-3 mb-3">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  placeholder="Search item ID, MFG ID, brand, model, description, size, location..."
                  className="theme-input px-3 py-1.5 text-sm w-full sm:w-72"
                />
                {[
                  { val: location, set: setLocation, opts: filters.locations, label: "All Warehouses" },
                  { val: brand, set: setBrand, opts: filters.brands, label: "All Brands" },
                  { val: productType, set: setProductType, opts: filters.productTypes, label: "All Product Types" },
                  { val: dclass, set: setDclass, opts: filters.dclasses, label: "All D-Classes" },
                ].map(({ val, set, opts, label }) => (
                  <select
                    key={label}
                    value={val}
                    onChange={(e) => { set(e.target.value); setPage(0); }}
                    className="theme-input px-3 py-1.5 text-sm"
                  >
                    <option value="">{label}</option>
                    {opts.map((o) => <option key={o} value={o}>{o || "(blank)"}</option>)}
                  </select>
                ))}
              </div>

              {/* Stock quick filters */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="ui-section-label">Stock:</span>
                {[
                  { key: "", label: "All" },
                  { key: "low", label: "Below Min" },
                  { key: "zero", label: "Zero Stock" },
                  { key: "negative", label: "Negative" },
                  { key: "overstocked", label: "Overstocked" },
                  { key: "hasStock", label: "In Stock Only" },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => { setStockFilter(key); setPage(0); }}
                    className={`px-3 py-2 sm:px-2.5 sm:py-1 rounded-lg text-xs font-medium border transition-colors ${
                      stockFilter === key
                        ? key === "low" || key === "negative"
                          ? "bg-red-500/20 text-red-400 border-red-500/30"
                          : key === "zero"
                          ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                          : key === "overstocked"
                          ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
                          : "bg-[#007AFF]/15 text-[#007AFF] border-[#007AFF]/30"
                        : isDark
                        ? "bg-slate-900/50 text-slate-500 border-slate-700"
                        : "bg-gray-50 text-gray-400 border-gray-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                {(location || brand || productType || dclass || search || stockFilter) && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => { setLocation(""); setBrand(""); setProductType(""); setDclass(""); setSearch(""); setStockFilter(""); setPage(0); }}
                  >
                    Clear All
                  </Button>
                )}
              </div>

              {/* Summary stats */}
              {items.length > 0 && (
                <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t theme-border-secondary">
                  <span className="text-[10px] theme-text-tertiary">{items.length.toLocaleString()} total items</span>
                  <span className="text-[10px] theme-text-tertiary">{items.filter((i) => i.reorderPoint > 0 && i.qtyAvailable < i.reorderPoint).length} below min</span>
                  <span className="text-[10px] theme-text-tertiary">{items.filter((i) => i.qtyOnHand <= 0).length} zero stock</span>
                  <span className="text-[10px] theme-text-tertiary">${items.reduce((sum, i) => sum + i.extendedValue, 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} total value</span>
                  {filtered.length !== items.length && (
                    <span className="text-[10px] text-[#007AFF]">Showing {filtered.length.toLocaleString()} filtered</span>
                  )}
                </div>
              )}
            </Card>

            {/* Table */}
            <div className="theme-card overflow-hidden p-0">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-6 h-6 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : !fileDate && items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <svg className="w-14 h-14 mb-4 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <p className="text-sm font-medium mb-1 theme-text-secondary">No inventory data available</p>
                  <p className="text-xs text-center max-w-sm theme-text-tertiary">
                    Upload an OEAVAL 77 inventory snapshot (.xlsx) through{" "}
                    <Link href="/reports/upload" className="text-[#007AFF] underline">Upload Reports</Link>{" "}
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
                            <th
                              key={col.key}
                              className={`relative px-3 py-2.5 font-semibold whitespace-nowrap border-b theme-border-secondary ${col.align === "right" ? "text-right" : "text-left"} theme-text-tertiary`}
                            >
                              <div className="flex items-center gap-1">
                                <span className="cursor-pointer select-none" onClick={() => handleSort(col.key)}>
                                  {col.label}{sortCol === col.key && <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>}
                                </span>
                                {col.filterable && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setOpenFilterCol(isOpen ? null : col.key); setFilterSearch(""); }}
                                    className={`p-0.5 rounded transition-colors ${hasFilter ? "text-[#007AFF]" : "theme-text-tertiary hover:theme-text-secondary"}`}
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                              {isOpen && (() => {
                                const searched = filterSearch ? uniqueVals.filter((v) => v.toLowerCase().includes(filterSearch.toLowerCase())) : uniqueVals;
                                return (
                                  <div
                                    className="theme-card absolute left-0 top-full mt-1 w-[calc(100vw-2rem)] sm:w-56 shadow-xl z-20 p-0 overflow-hidden"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="px-2 pt-2 pb-1 border-b theme-border-secondary">
                                      <input
                                        type="text"
                                        value={filterSearch}
                                        onChange={(e) => setFilterSearch(e.target.value)}
                                        placeholder="Search..."
                                        autoFocus
                                        className="theme-input w-full px-2 py-1 text-xs"
                                      />
                                      <div className="flex items-center justify-between mt-1">
                                        <span className="text-[10px] theme-text-tertiary">{searched.length} values</span>
                                        <div className="flex gap-1">
                                          <button
                                            onClick={() => setColumnFilters((f) => ({ ...f, [col.key]: new Set(searched) }))}
                                            className="text-[10px] px-1 text-[#007AFF]"
                                          >
                                            Select shown
                                          </button>
                                          <button
                                            onClick={() => setColumnFilters((f) => { const n = { ...f }; delete n[col.key]; return n; })}
                                            className="text-[10px] px-1 theme-text-tertiary"
                                          >
                                            Clear
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="max-h-52 overflow-y-auto p-1">
                                      {searched.slice(0, 200).map((val) => {
                                        const checked = !columnFilters[col.key] || columnFilters[col.key].size === 0 || columnFilters[col.key].has(val);
                                        return (
                                          <label
                                            key={val}
                                            className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs theme-text-secondary hover:bg-black/5 dark:hover:bg-white/5"
                                          >
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              onChange={() => {
                                                setColumnFilters((prev) => {
                                                  const current = prev[col.key] ? new Set(prev[col.key]) : new Set(uniqueVals);
                                                  if (current.has(val)) current.delete(val); else current.add(val);
                                                  return { ...prev, [col.key]: current };
                                                });
                                              }}
                                              className="rounded w-3 h-3"
                                            />
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
                        <tr>
                          <td colSpan={cols.length} className="px-3 py-8 text-center theme-text-tertiary">No data</td>
                        </tr>
                      ) : paged.map((item, i) => (
                        <tr
                          key={i}
                          className={`border-b theme-border-secondary transition-colors ${
                            i % 2 ? isDark ? "bg-slate-800/30" : "bg-gray-50/50" : ""
                          } ${isDark ? "hover:bg-slate-700/20" : "hover:bg-gray-50"}`}
                        >
                          <td className="px-3 py-1.5 theme-text-secondary">{item.location}</td>
                          <td className="px-3 py-1.5 font-medium min-w-[250px] theme-text-primary">{item.description}</td>
                          <td className="px-3 py-1.5 theme-text-tertiary">{item.productType}</td>
                          <td className="px-3 py-1.5 font-mono theme-text-tertiary">{item.dclass || "—"}</td>
                          <td className="px-3 py-1.5 theme-text-secondary">{item.manufacturerName}</td>
                          <td className="px-3 py-1.5 theme-text-tertiary">{item.model}</td>
                          <td className="px-3 py-1.5 font-mono text-[10px] theme-text-tertiary">{item.itemId}</td>
                          <td className="px-3 py-1.5 text-right theme-text-tertiary">{Number(item.reorderPoint) > 0 ? String(item.reorderPoint) : "—"}</td>
                          <td className="px-3 py-1.5 text-right font-medium theme-text-primary">{item.qtyOnHand}</td>
                          <td className="px-3 py-1.5 text-right theme-text-tertiary">{item.qtyCommitted}</td>
                          <td className={`px-3 py-1.5 text-right font-medium ${item.reorderPoint > 0 && item.qtyAvailable < item.reorderPoint ? "text-red-400" : isDark ? "text-emerald-400" : "text-emerald-600"}`}>{item.qtyAvailable}</td>
                          <td className="px-3 py-1.5 text-right theme-text-secondary">{fmtCurrency(item.lastCost)}</td>
                          <td className="px-3 py-1.5 text-right theme-text-secondary">{fmtCurrency(item.avgCost)}</td>
                          <td className={`px-3 py-1.5 text-right font-medium ${isDark ? "text-cyan-400" : "text-[#007AFF]"}`}>{fmtCurrency(item.extendedValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination footer */}
              {sorted.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border-t theme-border-secondary">
                  <span className="text-xs theme-text-tertiary">
                    Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sorted.length)} of {sorted.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <select
                      value={pageSize}
                      onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
                      className="theme-input px-2 py-1 text-xs"
                    >
                      {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}/page</option>)}
                    </select>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage(p => p - 1)}
                    >
                      Prev
                    </Button>
                    <span className="text-xs theme-text-tertiary">{page + 1}/{totalPages || 1}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage(p => p + 1)}
                    >
                      Next
                    </Button>
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
