"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeader from "@/components/ui/SectionHeader";

export default function SavedReportDetailPage() {
  const { theme } = useTheme();
  void theme;
  const params = useParams();
  const configId = params.configId as string;

  const config = useQuery(api.savedReports.get, { id: configId as Id<"savedReportConfigs"> });
  const updateConfig = useMutation(api.savedReports.update);
  const removeConfig = useMutation(api.savedReports.remove);

  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ columns: { key: string; name: string }[]; rows: Record<string, string>[]; totalRows: number } | null>(null);
  const [error, setError] = useState("");

  const handleRun = useCallback(async () => {
    if (!config) return;
    setRunning(true);
    setError("");

    try {
      // Determine months from date range
      const months: string[] = [];
      if (config.customStartDate && config.customEndDate) {
        const s = new Date(config.customStartDate);
        const e = new Date(config.customEndDate);
        const cursor = new Date(s.getFullYear(), s.getMonth(), 1);
        while (cursor <= e) {
          months.push(`${cursor.getFullYear()}${String(cursor.getMonth() + 1).padStart(2, "0")}`);
          cursor.setMonth(cursor.getMonth() + 1);
        }
      } else {
        // Default to current month
        const now = new Date();
        months.push(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`);
      }

      const res = await fetch("/api/reports/custom-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportType: config.sources[0],
          months,
          selectedColumns: config.selectedColumns,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Apply filters from config
      let rows = data.rows;
      if (config.excludeTransactions?.length) {
        rows = rows.filter((r: Record<string, string>) => !config.excludeTransactions!.includes(r.transaction || ""));
      }
      if (config.filterBrand) {
        rows = rows.filter((r: Record<string, string>) => r.brand === config.filterBrand);
      }
      if (config.filterAccount) {
        rows = rows.filter((r: Record<string, string>) => (r.accountId || "").includes(config.filterAccount!));
      }
      if (config.negateQty && config.sources[0] === "OEA07V") {
        rows = rows.map((r: Record<string, string>) => {
          const copy = { ...r };
          if (copy.qty) copy.qty = String(-parseFloat(copy.qty) || 0);
          if (copy.extCost) copy.extCost = String(-parseFloat(copy.extCost) || 0);
          return copy;
        });
      }

      setResults({ columns: data.columns, rows, totalRows: rows.length });

      // Update last run
      await updateConfig({
        id: configId as Id<"savedReportConfigs">,
        lastRunAt: Date.now(),
        lastRunRowCount: rows.length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run report");
    } finally {
      setRunning(false);
    }
  }, [config, configId, updateConfig]);

  const handleExportCSV = useCallback(() => {
    if (!results) return;
    const headers = results.columns.map((c) => c.name);
    const csv = [headers.join(","), ...results.rows.map((row) =>
      results.columns.map((c) => {
        const val = row[c.key] || "";
        return val.includes(",") || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
      }).join(",")
    )].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${config?.name || "report"}-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  }, [results, config]);

  const handleExportExcel = useCallback(async () => {
    if (!results) return;
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const data = [results.columns.map((c) => c.name), ...results.rows.map((row) => results.columns.map((c) => row[c.key] || ""))];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), "Report");
    XLSX.writeFile(wb, `${config?.name || "report"}-${new Date().toISOString().split("T")[0]}.xlsx`);
  }, [results, config]);

  if (!config) {
    return (
      <Protected>
        <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
          <Sidebar />
          <main className="flex-1 flex items-center justify-center">
            <MobileHeader />
            <div className="text-center theme-text-tertiary">Loading...</div>
          </main>
        </div>
      </Protected>
    );
  }

  const scheduleLabel = config.autoRun ? "Auto-runs on new data" : "Manual only";

  return (
    <Protected>
      <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <MobileHeader />

          <header className="sticky top-0 z-10 border-b px-4 sm:px-6 py-3 sm:py-4 backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Link href="/reports" className="p-2 rounded-lg transition-colors theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5 flex-shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                </Link>
                <div className="min-w-0">
                  <h1 className="text-xl font-bold theme-text-primary">{config.name}</h1>
                  <p className="text-xs mt-0.5 theme-text-tertiary">
                    {config.sources.join(" + ")} — {scheduleLabel}
                    {config.lastRunAt && ` — Last run: ${new Date(config.lastRunAt).toLocaleString()}`}
                    {config.lastRunRowCount != null && ` (${config.lastRunRowCount} rows)`}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <Button
                  variant="primary"
                  onClick={handleRun}
                  disabled={running}
                >
                  {running ? "Running..." : "Run Now"}
                </Button>
                {results && (
                  <>
                    <Button variant="ghost" onClick={handleExportCSV}>CSV</Button>
                    <Button variant="secondary" onClick={handleExportExcel}>Excel</Button>
                  </>
                )}
                <Button
                  variant="danger"
                  onClick={async () => { if (confirm("Delete this saved report?")) { await removeConfig({ id: configId as Id<"savedReportConfigs"> }); window.location.href = "/reports"; } }}
                >
                  Delete
                </Button>
              </div>
            </div>
          </header>

          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-4">
            {/* Config summary */}
            <Card padding="sm">
              <SectionHeader label="Configuration" />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="ui-section-label mb-1">Sources</p>
                  <p className="text-sm theme-text-primary">{config.sources.join(" + ")}</p>
                </div>
                <div>
                  <p className="ui-section-label mb-1">Columns</p>
                  <p className="text-sm theme-text-primary">{config.selectedColumns.length} selected</p>
                </div>
                <div>
                  <p className="ui-section-label mb-1">Filters</p>
                  <p className="text-sm theme-text-primary">
                    {[
                      config.excludeTransactions?.length && `Excl: ${config.excludeTransactions.join(",")}`,
                      config.filterBrand && `Brand: ${config.filterBrand}`,
                      config.filterAccount && `Acct: ${config.filterAccount}`,
                    ].filter(Boolean).join(", ") || "None"}
                  </p>
                </div>
                <div>
                  <p className="ui-section-label mb-1">Date Range</p>
                  <p className="text-sm theme-text-primary">
                    {config.customStartDate && config.customEndDate ? `${config.customStartDate} to ${config.customEndDate}` : config.dateRangeType}
                  </p>
                </div>
              </div>
            </Card>

            {error && (
              <Card tone="red" padding="sm">
                <p className="text-sm theme-text-primary">{error}</p>
              </Card>
            )}

            {/* Results table */}
            {results && (
              <div className="theme-card overflow-hidden p-0">
                <div className="px-4 py-3 border-b theme-border-secondary">
                  <span className="text-sm font-semibold theme-text-primary">{results.totalRows.toLocaleString()} rows</span>
                </div>
                <div className="overflow-x-auto max-h-[60vh]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-black/[0.03] dark:bg-white/[0.03]">
                      <tr>
                        {results.columns.map((col) => (
                          <th key={col.key} className="text-left px-3 py-2 font-semibold whitespace-nowrap theme-text-tertiary border-b theme-border-secondary">{col.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.rows.slice(0, 500).map((row, i) => (
                        <tr key={i} className={`border-b theme-border-secondary ${i % 2 ? "bg-black/[0.015] dark:bg-white/[0.015]" : ""}`}>
                          {results.columns.map((col) => (
                            <td key={col.key} className="px-3 py-1.5 whitespace-nowrap theme-text-secondary">{row[col.key] || ""}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {results.rows.length > 500 && (
                    <p className="text-center py-3 text-xs theme-text-tertiary">Showing 500 of {results.rows.length.toLocaleString()} — export for full data</p>
                  )}
                </div>
              </div>
            )}

            {!results && !error && (
              <Card tone="default" padding="md">
                <p className="text-center theme-text-tertiary">
                  Click <strong className="theme-text-primary">Run Now</strong> to generate this report
                </p>
              </Card>
            )}
          </div>
        </main>
      </div>
    </Protected>
  );
}
