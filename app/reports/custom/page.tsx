"use client";

import { useState, useCallback, useEffect } from "react";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "@/app/auth-context";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

const SOURCE_TYPES = [
  { code: "OEA07V", label: "OEA07V — Sales Activity" },
  { code: "oeival", label: "OEIVAL — Inventory" },
  { code: "tires", label: "Tires Catalog" },
];

const COLUMN_OPTIONS: Record<string, { key: string; name: string; defaultOn: boolean }[]> = {
  OEA07V: [
    { key: "itemId", name: "Item ID", defaultOn: true },
    { key: "description", name: "Description", defaultOn: true },
    { key: "sidewall", name: "Sidewall", defaultOn: false },
    { key: "productType", name: "Product Type", defaultOn: true },
    { key: "brand", name: "Brand", defaultOn: true },
    { key: "mfgItemId", name: "MFG Item ID", defaultOn: true },
    { key: "location", name: "Location", defaultOn: true },
    { key: "transaction", name: "Transaction", defaultOn: true },
    { key: "qty", name: "Qty", defaultOn: true },
    { key: "unitCost", name: "Unit Cost", defaultOn: true },
    { key: "extCost", name: "Ext Cost", defaultOn: true },
    { key: "unitSell", name: "Unit Sell", defaultOn: false },
    { key: "extSell", name: "Ext Sell", defaultOn: false },
    { key: "accountId", name: "Account ID", defaultOn: true },
    { key: "invoiceId", name: "Invoice ID", defaultOn: false },
    { key: "activityDate", name: "Activity Date", defaultOn: true },
    { key: "customerName", name: "Customer Name", defaultOn: true },
  ],
  ART24T: [
    { key: "arAccountId", name: "A/R Account ID", defaultOn: true },
    { key: "invoiceId", name: "Invoice ID", defaultOn: true },
    { key: "transDate", name: "Trans Date", defaultOn: true },
    { key: "location", name: "Location", defaultOn: true },
    { key: "productType", name: "Product Type", defaultOn: true },
    { key: "brand", name: "Brand", defaultOn: true },
    { key: "itemId", name: "Item ID", defaultOn: true },
    { key: "description", name: "Description", defaultOn: true },
    { key: "qty", name: "Qty Delivered", defaultOn: true },
    { key: "totalAmt", name: "Total Amount", defaultOn: true },
    { key: "totalCost", name: "Total Cost", defaultOn: true },
    { key: "grossProfit", name: "Gross Profit", defaultOn: false },
    { key: "unitPrice", name: "Unit Price", defaultOn: false },
    { key: "unitCogs", name: "Unit COGS", defaultOn: false },
    { key: "profitPct", name: "Profit %", defaultOn: false },
    { key: "customerName", name: "Customer Name", defaultOn: true },
  ],
  ART30S: [
    { key: "accountId", name: "Account", defaultOn: true },
    { key: "invoiceId", name: "Invoice", defaultOn: true },
    { key: "transDate", name: "Trans Date", defaultOn: true },
    { key: "location", name: "Location", defaultOn: true },
    { key: "itemId", name: "Item", defaultOn: true },
    { key: "description", name: "Description", defaultOn: true },
    { key: "qty", name: "Qty", defaultOn: true },
    { key: "amount", name: "Amount", defaultOn: true },
  ],
  oeival: [
    { key: "location", name: "Location", defaultOn: true },
    { key: "productType", name: "Product Type", defaultOn: true },
    { key: "dclass", name: "D-Class", defaultOn: true },
    { key: "manufacturerName", name: "Brand", defaultOn: true },
    { key: "model", name: "Model", defaultOn: true },
    { key: "itemId", name: "Item ID", defaultOn: true },
    { key: "description", name: "Description", defaultOn: true },
    { key: "qtyOnHand", name: "Qty On Hand", defaultOn: true },
    { key: "qtyAvailable", name: "Qty Available", defaultOn: true },
    { key: "lastCost", name: "Last Cost", defaultOn: true },
    { key: "avgCost", name: "Avg Cost", defaultOn: false },
    { key: "extendedValue", name: "Extended Value", defaultOn: true },
  ],
  tires: [
    { key: "itemId", name: "Item ID", defaultOn: true },
    { key: "mfgName", name: "Brand", defaultOn: true },
    { key: "model", name: "Model", defaultOn: true },
    { key: "size", name: "Size", defaultOn: true },
    { key: "xlrf", name: "XL/RF", defaultOn: true },
    { key: "loadIndex", name: "Load Index", defaultOn: true },
    { key: "speedRating", name: "Speed Rating", defaultOn: true },
    { key: "sidewall", name: "Sidewall", defaultOn: true },
    { key: "productType", name: "Product Type", defaultOn: true },
    { key: "plyRating", name: "Ply Rating", defaultOn: false },
    { key: "weight", name: "Weight", defaultOn: false },
    { key: "treadDepth", name: "Tread Depth", defaultOn: false },
  ],
};

type RunState = "idle" | "loading" | "success" | "error";

export default function CustomReportPage() {
  const { user } = useAuth();
  const saveConfig = useMutation(api.savedReports.create);

  const [sourceType, setSourceType] = useState("OEA07V");
  const [secondSource, setSecondSource] = useState("");
  const [fusionJoinKey, setFusionJoinKey] = useState("mfgItemId");
  const [selectedFusionColumns, setSelectedFusionColumns] = useState<string[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDescription, setSaveDescription] = useState("");
  const [saveAutoRun, setSaveAutoRun] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveDateRange, setSaveDateRange] = useState("yesterday");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>(
    COLUMN_OPTIONS.OEA07V.filter((c) => c.defaultOn).map((c) => c.key)
  );
  const [excludeTransactions, setExcludeTransactions] = useState<string[]>([]);
  const [negateQty, setNegateQty] = useState(true);
  const [filterBrands, setFilterBrands] = useState<string[]>([]);
  const [brandSearchOpen, setBrandSearchOpen] = useState(false);
  const [brandSearch, setBrandSearch] = useState("");
  const [filterAccount, setFilterAccount] = useState("");
  const [runState, setRunState] = useState<RunState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [columns, setColumns] = useState<{ key: string; name: string }[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [allRows, setAllRows] = useState<Record<string, string>[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [availableTransactions, setAvailableTransactions] = useState<string[]>([]);
  const [availableBrands, setAvailableBrands] = useState<string[]>([]);
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({});
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);
  const [filterSearch, setFilterSearch] = useState("");

  const columnOptions = COLUMN_OPTIONS[sourceType] || [];

  // Set default dates (current month)
  useEffect(() => {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    setStartDate(firstOfMonth.toISOString().split("T")[0]);
    setEndDate(now.toISOString().split("T")[0]);
  }, []);

  const handleSourceChange = useCallback((code: string) => {
    setSourceType(code);
    const defaults = (COLUMN_OPTIONS[code] || []).filter((c) => c.defaultOn).map((c) => c.key);
    // Always include mfgItemId for fusion support
    if (!defaults.includes("mfgItemId") && (COLUMN_OPTIONS[code] || []).some((c) => c.key === "mfgItemId")) {
      defaults.push("mfgItemId");
    }
    setSelectedColumns(defaults);
    setSecondSource("");
    setSelectedFusionColumns([]);
    setRows([]);
    setRunState("idle");
  }, []);

  const fusionColumnOptions = secondSource ? (COLUMN_OPTIONS[secondSource] || []).filter(
    (c) => c.key !== fusionJoinKey && !selectedColumns.includes(c.key)
  ) : [];

  const toggleColumn = useCallback((key: string) => {
    // Don't allow deselecting mfgItemId when fusion is active
    if (key === "mfgItemId" && secondSource) return;
    setSelectedColumns((prev) => prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]);
  }, [secondSource]);

  // Derive months from date range
  function getMonthsFromRange(start: string, end: string): string[] {
    if (!start || !end) return [];
    const months: string[] = [];
    const s = new Date(start);
    const e = new Date(end);
    const cursor = new Date(s.getFullYear(), s.getMonth(), 1);
    while (cursor <= e) {
      months.push(`${cursor.getFullYear()}${String(cursor.getMonth() + 1).padStart(2, "0")}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  }

  const handleGenerate = useCallback(async () => {
    if (!startDate || !endDate || selectedColumns.length === 0) return;
    const months = getMonthsFromRange(startDate, endDate);
    if (months.length === 0) return;

    setRunState("loading");
    setErrorMsg("");

    try {
      const res = await fetch(`/api/reports/custom-data?_t=${Date.now()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          reportType: sourceType,
          months,
          selectedColumns,
          secondSource: secondSource || undefined,
          fusionJoinKey: secondSource ? fusionJoinKey : undefined,
          fusionColumns: secondSource && selectedFusionColumns.length > 0 ? selectedFusionColumns : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setRunState("error"); setErrorMsg(data.error); return; }

      setColumns(data.columns);
      setAllRows(data.rows);
      setTotalRows(data.totalRows);
      setTruncated(data.truncated);
      setAvailableMonths(months);

      // Extract unique transaction codes and brands for filter dropdowns
      const txns = new Set<string>();
      const brands = new Set<string>();
      for (const row of data.rows) {
        if (row.transaction) txns.add(row.transaction);
        if (row.brand) brands.add(row.brand);
      }
      setAvailableTransactions([...txns].sort());
      setAvailableBrands([...brands].sort());

      // Apply filters
      let filtered = data.rows;
      if (excludeTransactions.length > 0) {
        filtered = filtered.filter((r: Record<string, string>) => !excludeTransactions.includes(r.transaction || ""));
      }
      if (filterBrands.length > 0) {
        const brandSet = new Set(filterBrands);
        filtered = filtered.filter((r: Record<string, string>) => brandSet.has(r.brand || ""));
      }
      if (filterAccount) {
        filtered = filtered.filter((r: Record<string, string>) => (r.accountId || "").includes(filterAccount));
      }
      // Negate quantities for display (sales are negative in OEA07V)
      if (negateQty && sourceType === "OEA07V") {
        filtered = filtered.map((r: Record<string, string>) => {
          const copy = { ...r };
          if (copy.qty) copy.qty = String(-parseFloat(copy.qty) || 0);
          if (copy.extCost) copy.extCost = String(-parseFloat(copy.extCost) || 0);
          if (copy.extSell) copy.extSell = String(-parseFloat(copy.extSell) || 0);
          return copy;
        });
      }
      setRows(filtered);
      setRunState("success");
    } catch (err) {
      setRunState("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to generate report");
    }
  }, [sourceType, startDate, endDate, selectedColumns, secondSource, fusionJoinKey, selectedFusionColumns]);

  const handleExportCSV = useCallback(() => {
    if (rows.length === 0) return;
    const headers = columns.map((c) => c.name);
    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        columns.map((c) => {
          const val = row[c.key] || "";
          return val.includes(",") || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
        }).join(",")
      ),
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `custom-${sourceType}-${startDate}-to-${endDate}.csv`;
    link.click();
  }, [rows, columns, sourceType, startDate, endDate]);

  const handleExportExcel = useCallback(async () => {
    if (rows.length === 0) return;
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const data = [
      columns.map((c) => c.name),
      ...rows.map((row) => columns.map((c) => row[c.key] || "")),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, sourceType);
    XLSX.writeFile(wb, `custom-${sourceType}-${startDate}-to-${endDate}.xlsx`);
  }, [rows, columns, sourceType, startDate, endDate]);

  const handleSaveConfig = useCallback(async () => {
    if (!user || !saveName) return;
    setSaving(true);
    try {
      const sources = secondSource ? [sourceType, secondSource] : [sourceType];
      await saveConfig({
        name: saveName,
        description: saveDescription || undefined,
        sources,
        selectedColumns,
        excludeTransactions: excludeTransactions.length > 0 ? excludeTransactions : undefined,
        filterBrand: filterBrands.length > 0 ? filterBrands.join(",") : undefined,
        filterAccount: filterAccount || undefined,
        negateQty: negateQty || undefined,
        dateRangeType: saveDateRange,
        customStartDate: saveDateRange === "custom" ? startDate : undefined,
        customEndDate: saveDateRange === "custom" ? endDate : undefined,
        fusionJoinKey: secondSource ? fusionJoinKey : undefined,
        autoRun: saveAutoRun,
        createdBy: user._id,
        createdByName: user.name || "Unknown",
      });
      setShowSaveModal(false);
      setSaveName("");
      setSaveDescription("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [user, saveName, saveDescription, sourceType, secondSource, selectedColumns, excludeTransactions, filterBrands, filterAccount, negateQty, startDate, endDate, fusionJoinKey, saveAutoRun, saveConfig]);

  return (
    <Protected>
      <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <MobileHeader />

          {/* Sticky iOS-style page header */}
          <header className="sticky top-0 z-10 border-b px-4 sm:px-6 py-3 sm:py-4 backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
            <div className="flex items-center gap-3">
              <Link
                href="/reports"
                className="p-2 rounded-lg transition-colors theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5 flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <div className="min-w-0">
                <h1 className="text-xl font-bold theme-text-primary">Custom Report Builder</h1>
                <p className="text-xs mt-0.5 theme-text-tertiary">Build a report from uploaded JMK data</p>
              </div>
            </div>
          </header>

          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
            <Card>
              {/* Source Type */}
              <div className="mb-5">
                <div className="ui-section-label mb-2">Source Report</div>
                <div className="flex flex-wrap gap-2">
                  {SOURCE_TYPES.map((t) => (
                    <button
                      key={t.code}
                      onClick={() => handleSourceChange(t.code)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        sourceType === t.code
                          ? "bg-blue-50 dark:bg-cyan-500/20 text-[#007AFF] dark:text-cyan-400 border-blue-200 dark:border-cyan-500/40"
                          : "bg-white dark:bg-slate-900 theme-text-tertiary border-gray-300 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* Fusion — join with second source */}
                <div className="mt-3">
                  <label className="flex items-center gap-2 text-xs theme-text-tertiary">
                    <span>Fuse with:</span>
                    <div className="relative group">
                      <svg className="w-3.5 h-3.5 cursor-help theme-text-tertiary hover:theme-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div className="absolute left-0 bottom-full mb-2 w-[calc(100vw-2rem)] sm:w-72 p-3 rounded-xl border shadow-xl text-xs z-30 hidden group-hover:block theme-card">
                        <p className="font-semibold mb-1 theme-text-primary">What is Fusion?</p>
                        <p className="mb-2 theme-text-secondary">Combines two data sources by Item ID into one view. Example: fuse Inventory (OEIVAL) with Sales History (OEA07V) to see stock levels alongside sales trends.</p>
                        <p className="font-medium mb-1 theme-text-secondary">Use cases:</p>
                        <ul className="space-y-0.5 ml-2 theme-text-secondary">
                          <li>Find dead stock (in inventory, zero sales)</li>
                          <li>Identify hot items (high sales, low stock)</li>
                          <li>Reorder decisions (selling fast + low inventory)</li>
                        </ul>
                      </div>
                    </div>
                    <select value={secondSource} onChange={(e) => {
                      setSecondSource(e.target.value);
                      // Ensure mfgItemId is selected when fusion is active
                      if (e.target.value && !selectedColumns.includes("mfgItemId")) {
                        setSelectedColumns((prev) => [...prev, "mfgItemId"]);
                      }
                      // Auto-select all fusion columns from second source (excluding overlapping + join key)
                      const opts = (COLUMN_OPTIONS[e.target.value] || []).filter((c) => c.key !== fusionJoinKey && !selectedColumns.includes(c.key));
                      setSelectedFusionColumns(opts.filter((c) => c.defaultOn).map((c) => c.key));
                    }}
                      className="theme-input px-2 py-1 text-xs">
                      <option value="">None (single source)</option>
                      {SOURCE_TYPES.filter((t) => t.code !== sourceType).map((t) => (
                        <option key={t.code} value={t.code}>{t.label}</option>
                      ))}
                    </select>
                    {secondSource && (
                      <span className="text-[10px] text-[#007AFF]">
                        Joined by MFG Item ID
                      </span>
                    )}
                  </label>
                  {secondSource && fusionColumnOptions.length > 0 && (
                    <div className="mt-2 ml-12">
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] font-medium theme-text-tertiary">
                          {secondSource} columns ({selectedFusionColumns.length}/{fusionColumnOptions.length})
                        </label>
                        <div className="flex gap-2">
                          <button onClick={() => setSelectedFusionColumns(fusionColumnOptions.map((c) => c.key))} className="text-[10px] px-1.5 py-0.5 rounded text-[#007AFF] hover:bg-blue-50 dark:hover:bg-slate-800">All</button>
                          <button onClick={() => setSelectedFusionColumns([])} className="text-[10px] px-1.5 py-0.5 rounded theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5">None</button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {fusionColumnOptions.map((col) => (
                          <button
                            key={col.key}
                            onClick={() => setSelectedFusionColumns((prev) => prev.includes(col.key) ? prev.filter((x) => x !== col.key) : [...prev, col.key])}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                              selectedFusionColumns.includes(col.key)
                                ? "bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-500/30"
                                : "bg-gray-50 dark:bg-slate-900/50 theme-text-tertiary border-gray-200 dark:border-slate-700"
                            }`}
                          >
                            {col.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Date Range */}
              <div className="mb-5">
                <div className="ui-section-label mb-2">Date Range</div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="theme-input px-3 py-2 text-sm"
                  />
                  <span className="text-sm theme-text-tertiary">to</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="theme-input px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Column Selection */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="ui-section-label">
                    Columns ({selectedColumns.length}/{columnOptions.length})
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedColumns(columnOptions.map((c) => c.key))} className="text-[10px] px-2 py-0.5 rounded text-[#007AFF] hover:bg-blue-50 dark:hover:bg-slate-800">All</button>
                    <button onClick={() => setSelectedColumns([])} className="text-[10px] px-2 py-0.5 rounded theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5">Clear</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {columnOptions.map((col) => (
                    <button
                      key={col.key}
                      onClick={() => toggleColumn(col.key)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                        selectedColumns.includes(col.key)
                          ? "bg-blue-50 dark:bg-cyan-500/15 text-[#007AFF] dark:text-cyan-400 border-blue-200 dark:border-cyan-500/30"
                          : "bg-gray-50 dark:bg-slate-900/50 theme-text-tertiary border-gray-200 dark:border-slate-700"
                      }`}
                    >
                      {col.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Filters */}
              {sourceType === "OEA07V" && (
                <div className="mb-5">
                  <div className="ui-section-label mb-2">Filters</div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <label className="block text-[10px] mb-0.5 theme-text-tertiary">Exclude Transactions</label>
                      <div className="flex flex-wrap gap-1">
                        {(availableTransactions.length > 0 ? availableTransactions : ["Sld", "Adj/RS", "Rcv", "Trn"]).map((t) => (
                          <button key={t} onClick={() => setExcludeTransactions((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])}
                            className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${
                              excludeTransactions.includes(t)
                                ? "bg-red-50 dark:bg-red-500/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30 line-through"
                                : "bg-white dark:bg-slate-900 theme-text-secondary border-gray-200 dark:border-slate-700"
                            }`}>
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="relative">
                      <label className="block text-[10px] mb-0.5 theme-text-tertiary">Brands</label>
                      <button onClick={() => { setBrandSearchOpen(!brandSearchOpen); setBrandSearch(""); }}
                        className={`theme-input px-2 py-1 text-xs text-left min-w-[120px] ${filterBrands.length > 0 ? "text-[#007AFF] dark:text-cyan-400" : "theme-text-secondary"}`}>
                        {filterBrands.length === 0 ? "All brands" : `${filterBrands.length} selected`}
                      </button>
                      {brandSearchOpen && (
                        <div className="absolute left-0 top-full mt-1 w-[calc(100vw-2rem)] sm:w-56 rounded-xl border shadow-xl z-30 theme-card p-0 overflow-hidden"
                          onClick={(e) => e.stopPropagation()}>
                          <div className="px-2 pt-2 pb-1 border-b theme-border-secondary">
                            <input type="text" value={brandSearch} onChange={(e) => setBrandSearch(e.target.value)}
                              placeholder="Search brands..." autoFocus
                              className="theme-input w-full px-2 py-1 text-xs" />
                            <div className="flex items-center justify-between mt-1">
                              <span className="text-[10px] theme-text-tertiary">{filterBrands.length} selected</span>
                              <button onClick={() => setFilterBrands([])} className="text-[10px] px-1 theme-text-tertiary">Clear</button>
                            </div>
                          </div>
                          <div className="max-h-52 overflow-y-auto p-1">
                            {(brandSearch ? availableBrands.filter((b) => b.toLowerCase().includes(brandSearch.toLowerCase())) : availableBrands).slice(0, 200).map((b) => (
                              <label key={b} className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs theme-text-secondary hover:bg-black/5 dark:hover:bg-white/5">
                                <input type="checkbox" checked={filterBrands.includes(b)} onChange={() => {
                                  setFilterBrands((prev) => prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]);
                                }} className="rounded w-3 h-3" />
                                <span className="truncate">{b}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-[10px] mb-0.5 theme-text-tertiary">Account ID</label>
                      <input type="text" value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)} placeholder="Filter account..."
                        className="theme-input px-2 py-1 text-xs w-28" />
                    </div>
                    <label className="flex items-center gap-1.5 text-xs theme-text-secondary">
                      <input type="checkbox" checked={negateQty} onChange={(e) => setNegateQty(e.target.checked)} className="rounded" />
                      Show sales as positive
                    </label>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  variant="primary"
                  onClick={handleGenerate}
                  disabled={runState === "loading" || !startDate || !endDate || selectedColumns.length === 0}
                >
                  {runState === "loading" ? "Generating..." : "Generate Report"}
                </Button>
                {runState === "success" && (
                  <>
                    <Button variant="secondary" onClick={handleExportCSV}>
                      Export CSV
                    </Button>
                    <Button variant="secondary" onClick={handleExportExcel}>
                      Export Excel
                    </Button>
                    <Button variant="secondary" onClick={() => setShowSaveModal(true)}>
                      Save Config
                    </Button>
                  </>
                )}
              </div>
            </Card>

            {/* Idle hint */}
            {runState === "idle" && rows.length === 0 && (
              <div className="rounded-xl border border-dashed p-6 text-center border-gray-300 dark:border-slate-700">
                <p className="text-sm theme-text-tertiary">
                  Select a source, date range, and columns, then click <strong>Generate Report</strong> to pull data.
                </p>
              </div>
            )}

            {/* Error */}
            {runState === "error" && (
              <Card tone="red" padding="sm">
                <p className="text-sm theme-text-primary">{errorMsg}</p>
              </Card>
            )}

            {/* Empty result */}
            {runState === "success" && rows.length === 0 && (
              <Card>
                <div className="py-8 text-center">
                  <svg className="w-12 h-12 mx-auto mb-3 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-sm font-medium mb-1 theme-text-primary">No data found</p>
                  <p className="text-xs theme-text-tertiary">
                    No {sourceType} records match the selected date range ({startDate} to {endDate}).
                    {secondSource && ` Fusion with ${secondSource} returned no matching rows by Item ID.`}
                    <br />Make sure files have been uploaded for this period.
                  </p>
                </div>
              </Card>
            )}

            {/* Results */}
            {runState === "success" && rows.length > 0 && (() => {
              // Apply column filters
              const filteredRows = rows.filter((row) => {
                for (const [colKey, allowedValues] of Object.entries(columnFilters)) {
                  if (allowedValues.size === 0) continue;
                  if (!allowedValues.has(row[colKey] || "")) return false;
                }
                return true;
              });
              const activeFilterCount = Object.values(columnFilters).filter((s) => s.size > 0).length;

              return (
                <div className="theme-card overflow-hidden p-0">
                  <div className="px-4 py-3 border-b theme-border-secondary flex items-center justify-between bg-gray-50 dark:bg-slate-800">
                    <span className="text-sm font-semibold theme-text-primary">
                      {filteredRows.length.toLocaleString()} rows
                      {filteredRows.length !== rows.length && <span className="ml-1 text-xs text-[#007AFF] dark:text-cyan-400">(filtered from {rows.length.toLocaleString()})</span>}
                      {truncated && <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">(capped at 10,000)</span>}
                    </span>
                    <div className="flex items-center gap-2">
                      {activeFilterCount > 0 && (
                        <button onClick={() => setColumnFilters({})} className="text-xs px-2 py-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10">
                          Clear {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}
                        </button>
                      )}
                      <span className="text-xs theme-text-tertiary">
                        {startDate} to {endDate} — {sourceType}
                      </span>
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-[60vh]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-slate-800">
                        <tr>
                          {columns.map((col) => {
                            const uniqueVals = [...new Set(rows.map((r) => r[col.key] || ""))].sort();
                            const hasFilter = columnFilters[col.key]?.size > 0;
                            const isOpen = openFilterCol === col.key;

                            return (
                              <th key={col.key} className="relative text-left px-3 py-2 font-semibold whitespace-nowrap theme-text-secondary border-b theme-border-secondary">
                                <div className="flex items-center gap-1">
                                  <span>{col.name}</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setOpenFilterCol(isOpen ? null : col.key); setFilterSearch(""); }}
                                    className={`p-0.5 rounded transition-colors ${hasFilter ? "text-[#007AFF]" : "theme-text-tertiary hover:theme-text-secondary"}`}
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                    </svg>
                                  </button>
                                </div>

                                {/* Filter dropdown */}
                                {isOpen && (() => {
                                  const searchedVals = filterSearch
                                    ? uniqueVals.filter((v) => v.toLowerCase().includes(filterSearch.toLowerCase()))
                                    : uniqueVals;
                                  return (
                                    <div className="absolute left-0 top-full mt-1 w-[calc(100vw-2rem)] sm:w-56 rounded-xl border shadow-xl z-20 theme-card p-0 overflow-hidden"
                                      onClick={(e) => e.stopPropagation()}>
                                      <div className="px-2 pt-2 pb-1 border-b theme-border-secondary">
                                        <input type="text" value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)}
                                          placeholder="Search..." autoFocus
                                          className="theme-input w-full px-2 py-1 text-xs" />
                                        <div className="flex items-center justify-between mt-1">
                                          <span className="text-[10px] theme-text-tertiary">{searchedVals.length} values</span>
                                          <div className="flex gap-1">
                                            <button onClick={() => setColumnFilters((f) => { const n = { ...f }; n[col.key] = new Set(searchedVals); return n; })}
                                              className="text-[10px] px-1 text-[#007AFF]">Select shown</button>
                                            <button onClick={() => setColumnFilters((f) => { const n = { ...f }; delete n[col.key]; return n; })}
                                              className="text-[10px] px-1 theme-text-tertiary">Clear</button>
                                          </div>
                                        </div>
                                      </div>
                                      <div className="max-h-52 overflow-y-auto p-1">
                                        {searchedVals.slice(0, 200).map((val) => {
                                          const checked = !columnFilters[col.key] || columnFilters[col.key].size === 0 || columnFilters[col.key].has(val);
                                          return (
                                            <label key={val} className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs theme-text-secondary hover:bg-black/5 dark:hover:bg-white/5">
                                              <input type="checkbox" checked={checked} onChange={() => {
                                                setColumnFilters((prev) => {
                                                  const current = prev[col.key] ? new Set(prev[col.key]) : new Set(uniqueVals);
                                                  if (current.has(val)) current.delete(val);
                                                  else current.add(val);
                                                  return { ...prev, [col.key]: current };
                                                });
                                              }} className="rounded w-3 h-3" />
                                              <span className="truncate">{val || "(blank)"}</span>
                                            </label>
                                          );
                                        })}
                                        {searchedVals.length > 200 && (
                                          <p className="text-center text-[10px] py-1 theme-text-tertiary">+{searchedVals.length - 200} more — refine search</p>
                                        )}
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
                        {filteredRows.slice(0, 500).map((row, i) => (
                          <tr key={i} className="border-b border-gray-50 dark:border-slate-700/30 hover:bg-gray-50 dark:hover:bg-slate-700/20">
                            {columns.map((col) => (
                              <td key={col.key} className="px-3 py-1.5 whitespace-nowrap theme-text-secondary">
                                {row[col.key] || ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length > 500 && (
                      <p className="text-center py-3 text-xs theme-text-tertiary">
                        Showing 500 of {rows.length.toLocaleString()} rows — export for full data
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </main>
      </div>

      {/* Save Configuration Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowSaveModal(false)}>
          <div className="w-full max-w-md theme-card p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <h3 className="text-lg font-semibold theme-text-primary">Save Report Configuration</h3>
              <div className="relative group">
                <svg className="w-4 h-4 cursor-help theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="absolute left-0 top-full mt-1 w-64 p-3 rounded-xl border shadow-xl text-xs z-30 hidden group-hover:block theme-card">
                  <span className="theme-text-secondary">Saved configs appear as cards in the Reports hub under "Saved Configurations". Auto-run configs execute on schedule using relative date ranges (not fixed dates).</span>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1 theme-text-tertiary">Report Name *</label>
                <input type="text" value={saveName} onChange={(e) => setSaveName(e.target.value)}
                  placeholder="e.g. Daily Sales Summary" className="theme-input w-full px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1 theme-text-tertiary">Description</label>
                <input type="text" value={saveDescription} onChange={(e) => setSaveDescription(e.target.value)}
                  placeholder="Optional description" className="theme-input w-full px-3 py-2 text-sm" />
              </div>
              <div className="p-3 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/50">
                <p className="text-xs theme-text-secondary">
                  Source: <strong>{sourceType}</strong>{secondSource && ` + ${secondSource} (joined by Item ID)`}
                  <br />Columns: {selectedColumns.length} selected
                  {excludeTransactions.length > 0 && <><br />Excluding: {excludeTransactions.join(", ")}</>}
                  {filterBrands.length > 0 && <><br />Brands: {filterBrands.join(", ")}</>}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1 theme-text-tertiary">Date Range (for auto-runs)</label>
                  <select value={saveDateRange} onChange={(e) => setSaveDateRange(e.target.value)}
                    className="theme-input w-full px-3 py-2 text-sm">
                    <option value="yesterday">Yesterday</option>
                    <option value="last7">Last 7 days</option>
                    <option value="last30">Last 30 days</option>
                    <option value="thisMonth">This month</option>
                    <option value="lastMonth">Last month</option>
                    <option value="last90">Last 90 days</option>
                    <option value="custom">Custom (use current dates)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1 theme-text-tertiary">Schedule</label>
                  <select value={saveAutoRun ? "daily" : "manual"} onChange={(e) => setSaveAutoRun(e.target.value !== "manual")}
                    className="theme-input w-full px-3 py-2 text-sm">
                    <option value="manual">Manual only</option>
                    <option value="daily">Daily (4 AM EST)</option>
                    <option value="weekly">Weekly (Monday)</option>
                    <option value="monthly">Monthly (1st)</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => setShowSaveModal(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleSaveConfig} disabled={saving || !saveName}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Protected>
  );
}
