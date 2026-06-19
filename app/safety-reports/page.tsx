"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "../auth-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const CATEGORY_LABELS: Record<string, string> = {
  safety: "Safety hazard",
  security: "Security / suspicious",
  theft: "Theft",
  harassment: "Harassment / misconduct",
  other: "Other",
};

const STATUSES = [
  { value: "new", label: "New" },
  { value: "in_review", label: "In review" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
];

function statusClasses(status: string): string {
  switch (status) {
    case "new": return "bg-red-100 text-red-700";
    case "in_review": return "bg-amber-100 text-amber-700";
    case "resolved": return "bg-green-100 text-green-700";
    case "dismissed": return "bg-gray-200 text-gray-600";
    default: return "bg-gray-100 text-gray-600";
  }
}

type Report = {
  _id: Id<"safetyReports">;
  category: string;
  locationName?: string;
  description: string;
  occurredAt?: string;
  photoFileId?: Id<"_storage">;
  reporterName?: string;
  reporterPhone?: string;
  reporterEmail?: string;
  referenceCode: string;
  status: string;
  reviewNotes?: string;
  reviewedByName?: string;
  createdAt: number;
};

function SafetyReportsInner() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Report | null>(null);

  const reports = useQuery(
    api.safetyReports.list,
    user ? { requestingUserId: user._id, status: filter === "all" ? undefined : filter } : "skip",
  ) as Report[] | undefined;

  const newCount = useMemo(
    () => (reports && filter === "all" ? reports.filter((r) => r.status === "new").length : undefined),
    [reports, filter],
  );

  return (
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        <header className="sticky top-0 z-10 theme-bg-card/90 backdrop-blur-md border-b theme-border-primary px-4 sm:px-8 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-semibold theme-text-primary tracking-tight">See Something, Say Something</h1>
              <p className="theme-text-tertiary text-xs sm:text-sm mt-0.5">Anonymous safety &amp; security reports{newCount ? ` · ${newCount} new` : ""}</p>
            </div>
            <Link
              href="/safety-reports/posters"
              className="shrink-0 px-3 py-2 rounded-full bg-[#007AFF] text-white text-sm font-medium hover:bg-[#0066d6]"
            >
              Print QR posters
            </Link>
          </div>
        </header>

        <div className="p-4 sm:p-8 max-w-5xl mx-auto">
          {/* Status filter */}
          <div className="flex items-center gap-1 theme-bg-card rounded-full p-1 border theme-border-primary w-fit mb-5">
            {[{ value: "all", label: "All" }, ...STATUSES].map((s) => (
              <button
                key={s.value}
                onClick={() => setFilter(s.value)}
                className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                  filter === s.value ? "bg-[#007AFF] text-white" : "theme-text-secondary hover:theme-text-primary"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {reports === undefined ? (
            <p className="theme-text-muted text-sm">Loading…</p>
          ) : reports.length === 0 ? (
            <div className="text-center py-16 theme-text-muted">
              <p className="text-sm">No reports{filter !== "all" ? " in this status" : " yet"}.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map((r) => (
                <button
                  key={r._id}
                  onClick={() => setSelected(r)}
                  className="w-full text-left theme-bg-card border theme-border-primary rounded-xl p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusClasses(r.status)}`}>
                          {STATUSES.find((s) => s.value === r.status)?.label || r.status}
                        </span>
                        <span className="text-sm font-semibold theme-text-primary">{CATEGORY_LABELS[r.category] || r.category}</span>
                        {r.locationName && <span className="text-xs theme-text-tertiary">· {r.locationName}</span>}
                      </div>
                      <p className="text-sm theme-text-secondary mt-1 line-clamp-2">{r.description}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11px] theme-text-muted font-mono">{r.referenceCode}</div>
                      <div className="text-[11px] theme-text-muted mt-0.5">{new Date(r.createdAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>

      {selected && user && (
        <ReportDetail report={selected} requestingUserId={user._id} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function ReportDetail({ report, requestingUserId, onClose }: { report: Report; requestingUserId: Id<"users">; onClose: () => void }) {
  const updateStatus = useMutation(api.safetyReports.updateStatus);
  const photoUrl = useQuery(
    api.safetyReports.getPhotoUrl,
    report.photoFileId ? { requestingUserId, reportId: report._id } : "skip",
  );
  const [status, setStatus] = useState(report.status);
  const [notes, setNotes] = useState(report.reviewNotes || "");
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const hasContact = !!(report.reporterName || report.reporterPhone || report.reporterEmail);

  const save = async () => {
    setSaving(true);
    try {
      await updateStatus({ requestingUserId, reportId: report._id, status, reviewNotes: notes });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-lg theme-bg-card rounded-2xl shadow-2xl border theme-border-primary max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b theme-border-primary">
          <div>
            <h2 className="text-lg font-semibold theme-text-primary">{CATEGORY_LABELS[report.category] || report.category}</h2>
            <p className="text-xs theme-text-muted font-mono mt-0.5">{report.referenceCode}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:theme-bg-primary theme-text-muted">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-xs theme-text-muted">Location</div><div className="theme-text-primary">{report.locationName || "Not specified"}</div></div>
            <div><div className="text-xs theme-text-muted">When</div><div className="theme-text-primary">{report.occurredAt || "Not specified"}</div></div>
            <div><div className="text-xs theme-text-muted">Submitted</div><div className="theme-text-primary">{new Date(report.createdAt).toLocaleString()}</div></div>
            <div><div className="text-xs theme-text-muted">Reporter</div><div className="theme-text-primary">{hasContact ? "Provided contact" : "Anonymous"}</div></div>
          </div>

          <div>
            <div className="text-xs theme-text-muted mb-1">Description</div>
            <div className="theme-bg-primary border theme-border-primary rounded-lg p-3 text-sm theme-text-primary whitespace-pre-wrap">{report.description}</div>
          </div>

          {report.photoFileId && (
            <div>
              <div className="text-xs theme-text-muted mb-1">Photo</div>
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <a href={photoUrl} target="_blank" rel="noopener noreferrer">
                  <img src={photoUrl} alt="Report attachment" className="max-h-72 rounded-lg border theme-border-primary" />
                </a>
              ) : (
                <p className="text-xs theme-text-muted">Loading photo…</p>
              )}
            </div>
          )}

          {hasContact && (
            <div className="rounded-lg border theme-border-primary p-3 text-sm space-y-1">
              <div className="text-xs theme-text-muted mb-1">Reporter contact (optional follow-up)</div>
              {report.reporterName && <div className="theme-text-primary">{report.reporterName}</div>}
              {report.reporterPhone && <div className="theme-text-secondary">{report.reporterPhone}</div>}
              {report.reporterEmail && <div className="theme-text-secondary">{report.reporterEmail}</div>}
            </div>
          )}

          <div>
            <label className="text-xs theme-text-muted">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-lg border theme-border-primary theme-bg-primary theme-text-primary px-3 py-2 text-sm">
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs theme-text-muted">Review notes (internal)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border theme-border-primary theme-bg-primary theme-text-primary px-3 py-2 text-sm" />
            {report.reviewedByName && <p className="text-[11px] theme-text-muted mt-1">Last reviewed by {report.reviewedByName}</p>}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t theme-border-primary">
          <button onClick={() => window.print()} className="px-4 py-2 rounded-lg theme-bg-primary theme-text-secondary text-sm font-medium" title="Print this report on one page">Print</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg theme-bg-primary theme-text-secondary text-sm">Cancel</button>
            <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-[#007AFF] text-white text-sm font-medium disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>

      {mounted && createPortal(
        <div id="safety-report-print-root">
          <SafetyReportPrint report={report} photoUrl={photoUrl} />
          <style dangerouslySetInnerHTML={{ __html: `
            #safety-report-print-root { display: none; }
            @media print {
              @page { size: letter portrait; margin: 0.5in; }
              /* Zero the UA body margin (8px) — it's added INSIDE the @page margin box and
                 pushes content a sliver past the page, producing a near-blank 2nd page. */
              html, body { margin: 0 !important; padding: 0 !important; }
              body > :not(#safety-report-print-root) { display: none !important; }
              #safety-report-print-root { display: block !important; color: #000; }
              /* No trailing margin on the last element, so it can't bleed onto a new page. */
              #safety-report-print-root > div > :last-child { margin-bottom: 0 !important; }
            }
          ` }} />
        </div>,
        document.body,
      )}
    </div>
  );
}

// Clean one-page printable sheet for a single report. Rendered into a hidden
// print-root portal and revealed only under @media print (see ReportDetail).
function SafetyReportPrint({ report, photoUrl }: { report: Report; photoUrl?: string | null }) {
  const hasContact = !!(report.reporterName || report.reporterPhone || report.reporterEmail);
  const statusLabel = STATUSES.find((s) => s.value === report.status)?.label || report.status;
  const labelStyle: React.CSSProperties = { fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.04em", color: "#555", marginBottom: "3px" };
  const boxStyle: React.CSSProperties = { border: "1px solid #999", borderRadius: "4px", padding: "10px", whiteSpace: "pre-wrap" };
  const cell = (label: string, value: string) => (
    <div style={{ marginBottom: "10px" }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontSize: "13px", color: "#000" }}>{value}</div>
    </div>
  );
  return (
    <div style={{ fontFamily: "Arial, sans-serif", color: "#000", fontSize: "13px", maxWidth: "7.5in" }}>
      <div style={{ borderBottom: "2px solid #000", paddingBottom: "8px", marginBottom: "14px" }}>
        <div style={{ fontSize: "20px", fontWeight: 700 }}>See Something, Say Something — Report</div>
        <div style={{ fontSize: "12px", color: "#333", marginTop: "3px" }}>
          Ref <span style={{ fontFamily: "monospace" }}>{report.referenceCode}</span> · Status: {statusLabel} · Submitted {new Date(report.createdAt).toLocaleString()}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: "24px" }}>
        {cell("Category", CATEGORY_LABELS[report.category] || report.category)}
        {cell("Location", report.locationName || "Not specified")}
        {cell("When it happened", report.occurredAt || "Not specified")}
        {cell("Reporter", hasContact ? "Provided contact (below)" : "Anonymous")}
      </div>

      <div style={{ marginTop: "4px", marginBottom: "12px" }}>
        <div style={labelStyle}>Description</div>
        <div style={{ ...boxStyle, minHeight: "0.75in" }}>{report.description}</div>
      </div>

      {hasContact && (
        <div style={{ marginBottom: "12px" }}>
          <div style={labelStyle}>Reporter contact (optional follow-up)</div>
          <div style={boxStyle}>
            {report.reporterName && <div>{report.reporterName}</div>}
            {report.reporterPhone && <div>{report.reporterPhone}</div>}
            {report.reporterEmail && <div>{report.reporterEmail}</div>}
          </div>
        </div>
      )}

      {report.reviewNotes && (
        <div style={{ marginBottom: "12px" }}>
          <div style={labelStyle}>Review notes (internal){report.reviewedByName ? ` — ${report.reviewedByName}` : ""}</div>
          <div style={boxStyle}>{report.reviewNotes}</div>
        </div>
      )}

      {photoUrl && (
        <div style={{ marginBottom: "12px" }}>
          <div style={labelStyle}>Photo</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl} alt="Report attachment" style={{ maxWidth: "100%", maxHeight: "3in", border: "1px solid #999", borderRadius: "4px", display: "block" }} />
        </div>
      )}

      <div style={{ marginTop: "14px", borderTop: "1px solid #ccc", paddingTop: "6px", fontSize: "10px", color: "#666" }}>
        Confidential — handle per company policy. Printed {new Date().toLocaleString()}.
      </div>
    </div>
  );
}

export default function SafetyReportsPage() {
  return (
    <Protected requiredRoles={["super_admin"]}>
      <SafetyReportsInner />
    </Protected>
  );
}
