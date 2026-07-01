"use client";

import { useState, useCallback, useEffect } from "react";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import { useAuth } from "@/app/auth-context";
import { usePermissions } from "@/lib/usePermissions";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeader from "@/components/ui/SectionHeader";

// ─── TYPES ──────────────────────────────────────────────────────────────────

interface CommissionLineItem {
  orderNo: string;
  brand: string;
  mfgItemId: string;
  description: string;
  qty: number;
  unitCost: number;
  commissionAmount: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReportSummary = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReportDetail = any;

// ─── MAIN PAGE ──────────────────────────────────────────────────────────────

export default function WTDCommissionReportPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();
  const permissions = usePermissions();

  const hasOverrideAccess = useQuery(
    api.wtdCommission.checkAccess,
    user?._id ? { userId: user._id } : "skip"
  );

  const canAccess = permissions.tier >= 5 || hasOverrideAccess === true;

  const [reportHistory, setReportHistory] = useState<ReportSummary[]>([]);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);

  const [viewingReportKey, setViewingReportKey] = useState<string | null>(null);
  const [viewingReport, setViewingReport] = useState<ReportDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  // Once availableMonths arrives, snap viewMonth to the most recent month with
  // data — but only the first time, so manual selection doesn't get overridden.
  const [defaultedToLatest, setDefaultedToLatest] = useState(false);

  // Fetch reports from S3
  useEffect(() => {
    setLoadingReports(true);
    fetch(`/api/wtd-commission/reports?month=${viewMonth}`)
      .then((r) => r.json())
      .then((data) => {
        setReportHistory(data.reports || []);
        setAvailableMonths(data.months || []);
        if (!defaultedToLatest && (data.months || []).length > 0 && !(data.months || []).includes(viewMonth)) {
          setDefaultedToLatest(true);
          setViewMonth(data.months[0]);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingReports(false));
  }, [viewMonth, defaultedToLatest]);

  // Fetch individual report from S3
  useEffect(() => {
    if (!viewingReportKey) { setViewingReport(null); return; }
    setLoadingDetail(true);
    fetch("/api/wtd-commission/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: viewingReportKey }),
    })
      .then((r) => r.json())
      .then((data) => setViewingReport(data))
      .catch(() => {})
      .finally(() => setLoadingDetail(false));
  }, [viewingReportKey]);

  const filteredReports = reportHistory;

  // Group reports by date for display
  const reportsByDate = filteredReports.reduce((acc: Record<string, ReportSummary[]>, r: ReportSummary) => {
    const key = r.date;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {} as Record<string, ReportSummary[]>);

  const sortedDates = Object.keys(reportsByDate).sort((a, b) => b.localeCompare(a));

  // ─── EXPORTS ──────────────────────────────────────────────────────────────

  const handleExportPDF = useCallback(async (report: ReportDetail) => {
    const { default: jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF();
    let y = 20;
    doc.setFontSize(16);
    doc.text("WTD Commission Report", 14, y); y += 8;
    doc.setFontSize(11);
    doc.text(`Customer: ${report.customerName} (${report.customerNumber})`, 14, y); y += 6;
    doc.text(`Date: ${report.date}`, 14, y); y += 6;
    const commLabel = report.commissionType === "percentage"
      ? `${report.commissionValue}% of product cost` : `$${report.commissionValue.toFixed(2)} per unit`;
    doc.text(`Commission: ${commLabel}`, 14, y); y += 10;
    autoTable(doc, {
      startY: y,
      head: [["Order #", "Brand", "Mfg Code", "Description", "Qty", "Commission"]],
      body: report.lineItems.map((li: CommissionLineItem) => [li.orderNo, li.brand, li.mfgItemId, li.description, String(li.qty), `$${li.commissionAmount.toFixed(2)}`]),
      foot: [["", "", "", "", "Grand Total", `$${report.grandTotal.toFixed(2)}`]],
      theme: "grid",
      headStyles: { fillColor: [16, 185, 129] },
      footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: "bold" },
      styles: { fontSize: 9 },
    });
    doc.save(`wtd-commission-${report.customerName}-${report.date}.pdf`);
  }, []);

  const handleExportExcel = useCallback(async (report: ReportDetail) => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const data = [
      ["WTD Commission Report"],
      [`Customer: ${report.customerName} (${report.customerNumber})`],
      [`Date: ${report.date}`],
      [],
      ["Order #", "Brand", "Mfg Code", "Description", "Qty", "Unit Cost", "Commission"],
      ...report.lineItems.map((li: CommissionLineItem) => [li.orderNo, li.brand, li.mfgItemId, li.description, li.qty, li.unitCost, li.commissionAmount]),
      [],
      ["", "", "", "", "", "Grand Total", report.grandTotal],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 12 }, { wch: 8 }, { wch: 15 }, { wch: 35 }, { wch: 8 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, report.customerName.slice(0, 28));
    XLSX.writeFile(wb, `wtd-commission-${report.customerName}-${report.date}.xlsx`);
  }, []);

  // ─── RENDER ───────────────────────────────────────────────────────────────

  if (!canAccess) {
    return (
      <Protected>
        <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
          <Sidebar />
          <main className="flex-1 flex items-center justify-center">
            <MobileHeader />
            <Card padding="md" className="max-w-sm mx-auto text-center">
              <p className="text-base font-semibold theme-text-primary">Access Denied</p>
              <p className="text-sm mt-1 theme-text-secondary">You do not have permission to access WTD Commission Report.</p>
            </Card>
          </main>
        </div>
      </Protected>
    );
  }

  return (
    <Protected>
      <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <MobileHeader />

          {/* Sticky iOS-style page header */}
          <header className={`sticky top-0 z-10 border-b px-4 sm:px-6 py-3 sm:py-4 backdrop-blur-sm print:hidden ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
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
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isDark ? "bg-gradient-to-br from-emerald-500/20 to-teal-600/20" : "bg-gradient-to-br from-emerald-100 to-teal-100"}`}>
                  <svg className={`w-5 h-5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <h1 className="text-xl font-bold theme-text-primary">WTD Commission Report</h1>
                  <p className="text-xs mt-0.5 theme-text-tertiary">Daily automated commission reports — runs at 4 AM EST</p>
                </div>
              </div>
              {permissions.tier >= 5 && (
                <Link
                  href="/tools/wtd-commission/setup"
                  className="inline-flex items-center justify-center gap-1.5 rounded-[9px] font-semibold transition-colors px-3.5 py-2 text-[13.5px] theme-btn-secondary"
                >
                  Setup
                </Link>
              )}
            </div>
          </header>

          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4">

            {/* Month selector */}
            {!viewingReportKey && (
              <Card padding="sm">
                <SectionHeader label="Month" />
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    id="wtd-month"
                    type="month"
                    value={viewMonth}
                    onChange={(e) => { if (e.target.value) setViewMonth(e.target.value); }}
                    className={`theme-input px-3 py-1.5 text-sm font-medium ${isDark ? "[color-scheme:dark]" : ""}`}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => {
                      const [y, m] = viewMonth.split("-").map(Number);
                      const d = new Date(y, m - 2, 1);
                      setViewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
                    }}
                    aria-label="Previous month"
                  >
                    ‹ Prev
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => {
                      const [y, m] = viewMonth.split("-").map(Number);
                      const d = new Date(y, m, 1);
                      setViewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
                    }}
                    aria-label="Next month"
                  >
                    Next ›
                  </Button>
                  {availableMonths.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className="ui-section-label">Has data:</span>
                      {availableMonths.slice(0, 6).map((m: string) => {
                        const [y, mo] = m.split("-");
                        const label = `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(mo) - 1]} ${y.slice(2)}`;
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setViewMonth(m)}
                            className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                              viewMonth === m
                                ? "bg-[#007AFF]/15 text-[#007AFF] border-[#007AFF]/30"
                                : isDark
                                ? "bg-slate-900/50 text-slate-500 border-slate-700 hover:border-slate-500"
                                : "bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-400"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <span className="ml-auto text-xs theme-text-tertiary">
                    {filteredReports.length} report{filteredReports.length !== 1 ? "s" : ""} in {viewMonth}
                  </span>
                </div>
              </Card>
            )}

            {/* Loading detail spinner */}
            {viewingReportKey && loadingDetail && (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {/* Viewing a specific report */}
            {viewingReportKey && viewingReport ? (
              <div className="space-y-4">
                {/* Back + export actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="ghost" onClick={() => setViewingReportKey(null)}>
                    ← Back to Reports
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => window.print()}>
                    Print
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleExportPDF(viewingReport)}>
                    Export PDF
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => handleExportExcel(viewingReport)}>
                    Export Excel
                  </Button>
                </div>

                {/* Report content */}
                <div className="theme-card overflow-hidden p-0 print:break-inside-avoid">
                  <div className={`px-5 py-3 border-b theme-border-secondary ${isDark ? "bg-slate-800" : "bg-gray-50"}`}>
                    <h2 className="text-base font-bold theme-text-primary">{viewingReport.customerName}</h2>
                    <div className="text-xs mt-1 flex flex-wrap gap-x-4 gap-y-0.5 theme-text-tertiary">
                      <span>Account: {viewingReport.customerNumber}</span>
                      <span>Date: {viewingReport.date || viewingReport.startDate}</span>
                      {viewingReport.commissionType && (
                        <span>Commission: {viewingReport.commissionType === "percentage" ? `${viewingReport.commissionValue}% of product cost` : `$${viewingReport.commissionValue?.toFixed(2)} per unit`}</span>
                      )}
                      <span>Generated: {new Date(viewingReport.generatedAt || viewingReport.createdAt).toLocaleString()}</span>
                    </div>
                  </div>

                  {viewingReport.lineItems.length === 0 ? (
                    <div className="p-8 text-center theme-text-tertiary text-sm">
                      No qualifying transactions for this date.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className={`border-b theme-border-secondary ${isDark ? "bg-slate-800/80" : "bg-gray-50"}`}>
                            <th className="text-left px-4 py-3 font-semibold text-xs theme-text-tertiary">Order #</th>
                            <th className="text-left px-4 py-3 font-semibold text-xs theme-text-tertiary">Brand</th>
                            <th className="text-left px-4 py-3 font-semibold text-xs theme-text-tertiary">Mfg Code</th>
                            <th className="text-left px-4 py-3 font-semibold text-xs theme-text-tertiary">Description</th>
                            <th className="text-right px-4 py-3 font-semibold text-xs theme-text-tertiary">Qty</th>
                            <th className="text-right px-4 py-3 font-semibold text-xs theme-text-tertiary">Commission</th>
                          </tr>
                        </thead>
                        <tbody>
                          {viewingReport.lineItems.map((li: CommissionLineItem, i: number) => (
                            <tr key={i} className={`border-b theme-border-secondary transition-colors ${isDark ? "hover:bg-slate-700/20" : "hover:bg-gray-50"}`}>
                              <td className="px-4 py-2.5 font-mono text-xs theme-text-secondary">{li.orderNo}</td>
                              <td className="px-4 py-2.5 font-mono text-xs font-semibold theme-text-secondary">{li.brand}</td>
                              <td className="px-4 py-2.5 font-mono text-xs theme-text-secondary">{li.mfgItemId}</td>
                              <td className="px-4 py-2.5 theme-text-primary">{li.description}</td>
                              <td className="px-4 py-2.5 text-right theme-text-secondary">{li.qty}</td>
                              <td className={`px-4 py-2.5 text-right font-medium ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                                ${li.commissionAmount.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className={isDark ? "bg-slate-800" : "bg-gray-50"}>
                            <td colSpan={5} className="px-4 py-3 text-right font-bold theme-text-primary">Grand Total</td>
                            <td className={`px-4 py-3 text-right font-bold text-lg ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                              ${viewingReport.grandTotal.toFixed(2)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Report list grouped by date */
              <>
                {loadingReports ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="w-6 h-6 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : !reportHistory || reportHistory.length === 0 ? (
                  <Card padding="md" className="text-center">
                    <p className="text-base font-semibold theme-text-primary mb-2">No reports yet</p>
                    <p className="text-sm theme-text-secondary">Reports are generated automatically at 4 AM EST for the prior day.</p>
                  </Card>
                ) : (
                  <div className="space-y-5">
                    {sortedDates.map(date => {
                      const dateReports = reportsByDate[date];
                      const formattedDate = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
                        weekday: "long", month: "short", day: "numeric", year: "numeric",
                      });

                      return (
                        <div key={date}>
                          <div className="ui-section-label mb-2">{formattedDate}</div>
                          <div className="space-y-2">
                            {dateReports.map((r: ReportSummary) => (
                              <div
                                key={r.key}
                                className="theme-card p-4 flex items-center justify-between"
                              >
                                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 min-w-0">
                                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${r.lineItemCount > 0 ? "bg-emerald-500" : "bg-slate-500"}`} />
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-semibold theme-text-primary">{r.customerName}</span>
                                      <span className="px-2 py-0.5 rounded-md text-xs font-mono theme-text-tertiary bg-black/5 dark:bg-white/10">{r.customerNumber}</span>
                                    </div>
                                    <div className="text-xs mt-0.5 theme-text-tertiary">
                                      {r.lineItemCount > 0 ? (
                                        <>
                                          <span>{r.lineItemCount} items</span>
                                          <span className={`ml-2 font-semibold ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>${r.grandTotal.toFixed(2)}</span>
                                        </>
                                      ) : (
                                        <span className={isDark ? "text-amber-400" : "text-amber-600"}>No qualifying transactions</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => setViewingReportKey(r.key)}
                                >
                                  View
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          body { background: white !important; color: black !important; font-family: Arial, Helvetica, sans-serif !important; font-size: 11px !important; }
          .print\\:hidden { display: none !important; }
          .print\\:break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
          aside, header.sticky, nav { display: none !important; }
          main { overflow: visible !important; padding: 0 !important; }
          .theme-bg-primary, .flex.h-screen { background: white !important; }
          .max-w-6xl { max-width: 100% !important; padding: 0 20px !important; }
          .rounded-xl { border-radius: 0 !important; border: none !important; box-shadow: none !important; background: white !important; }
          table { border-collapse: collapse !important; width: 100% !important; }
          th { background: #10b981 !important; color: white !important; padding: 8px 12px !important; font-size: 11px !important; border: 1px solid #0d9668 !important; }
          td { padding: 6px 12px !important; border: 1px solid #e5e7eb !important; color: black !important; font-size: 10px !important; }
          tr:nth-child(even) td { background: #f9fafb !important; }
          tfoot td { background: #f3f4f6 !important; color: black !important; font-weight: bold !important; border: 1px solid #e5e7eb !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
    </Protected>
  );
}
