"use client";

import { useMemo, useState } from "react";
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

  // Render the report as an exact one-page Letter PDF and send it to the printer.
  // We build the PDF directly (jsPDF) rather than relying on the browser's
  // @media print path, which kept spilling onto a blank second page across
  // browsers/margin settings. jsPDF only emits the page(s) we add — we never
  // call addPage, so the output is guaranteed to be exactly one page.
  const printReportPdf = async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "in", format: "letter", orientation: "portrait" });
    const W = 8.5, H = 11, M = 0.5, CW = W - 2 * M;
    const statusLabel = STATUSES.find((s) => s.value === report.status)?.label || report.status;

    const label = (text: string, x: number, yy: number) => {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(110, 110, 110);
      doc.text(text.toUpperCase(), x, yy);
    };
    const value = (text: string, x: number, yy: number, maxW: number) => {
      doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(0, 0, 0);
      doc.text(doc.splitTextToSize(text || "", maxW), x, yy);
    };
    // Bordered, clamped text box. Returns the y just below the box.
    const box = (labelText: string, text: string, top: number, maxH: number): number => {
      label(labelText, M, top);
      const boxTop = top + 0.16;
      const pad = 0.08, lineH = 0.17, textW = CW - 2 * pad;
      // Measure wrapping at the SAME font we draw with (11pt), else lines
      // measured at the label's 8pt would be drawn wider and overflow the box.
      doc.setFont("helvetica", "normal"); doc.setFontSize(11);
      let lines: string[] = doc.splitTextToSize(text || "", textW);
      const maxLines = Math.max(1, Math.floor((maxH - 0.16 - 2 * pad) / lineH));
      if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        const last = lines[maxLines - 1] || "";
        lines[maxLines - 1] = last.replace(/.$/, "") + "…";
      }
      const boxH = lines.length * lineH + 2 * pad;
      doc.setDrawColor(150); doc.setLineWidth(0.01);
      doc.roundedRect(M, boxTop, CW, boxH, 0.04, 0.04);
      doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(0, 0, 0);
      doc.text(lines, M + pad, boxTop + pad + 0.11);
      return boxTop + boxH;
    };

    // Header.
    doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold"); doc.setFontSize(17);
    doc.text("See Something, Say Something — Report", M, M + 0.25);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(60, 60, 60);
    doc.text(
      `Ref ${report.referenceCode}   ·   Status: ${statusLabel}   ·   Submitted ${new Date(report.createdAt).toLocaleString()}`,
      M, M + 0.5,
    );
    doc.setDrawColor(0); doc.setLineWidth(0.02); doc.line(M, M + 0.62, W - M, M + 0.62);

    // 2×2 facts grid.
    let y = M + 0.95;
    const colW = CW / 2, col2 = M + colW;
    label("Category", M, y); label("Location", col2, y);
    value(CATEGORY_LABELS[report.category] || report.category, M, y + 0.17, colW - 0.2);
    value(report.locationName || "Not specified", col2, y + 0.17, colW - 0.2);
    y += 0.6;
    label("When it happened", M, y); label("Reporter", col2, y);
    value(report.occurredAt || "Not specified", M, y + 0.17, colW - 0.2);
    value(hasContact ? "Provided contact (below)" : "Anonymous", col2, y + 0.17, colW - 0.2);
    y += 0.62;

    // Optional photo — load via canvas; skip gracefully if it can't be read.
    let photo: { dataUrl: string; w: number; h: number } | null = null;
    if (photoUrl) {
      photo = await new Promise((resolve) => {
        const img = new window.Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const c = document.createElement("canvas");
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            const ctx = c.getContext("2d");
            if (!ctx) return resolve(null);
            ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(img, 0, 0);
            resolve({ dataUrl: c.toDataURL("image/jpeg", 0.85), w: img.naturalWidth, h: img.naturalHeight });
          } catch { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = photoUrl;
      });
    }

    // Reserve the bottom of the page: footer, then photo band above it.
    const footerBaseline = H - M;
    let photoTop = 0, photoH = 0, photoW = 0;
    if (photo) {
      photoW = CW; photoH = (photoW * photo.h) / photo.w;
      if (photoH > 2.6) { photoH = 2.6; photoW = (photoH * photo.w) / photo.h; }
      photoTop = footerBaseline - 0.35 - photoH;
    }
    const textFloor = (photo ? photoTop - 0.15 : footerBaseline - 0.3);

    // Description (flexible) then optional contact/notes, all clamped so nothing
    // can ever push onto a second page.
    const contactReserve = hasContact ? 0.95 : 0;
    const notesReserve = report.reviewNotes ? 0.95 : 0;
    const descMax = Math.max(0.5, textFloor - y - contactReserve - notesReserve - 0.3);
    y = box("Description", report.description, y, descMax) + 0.18;
    if (hasContact) {
      const contact = [report.reporterName, report.reporterPhone, report.reporterEmail].filter(Boolean).join("\n");
      y = box("Reporter contact (optional follow-up)", contact, y, contactReserve) + 0.18;
    }
    if (report.reviewNotes) {
      const lbl = `Review notes (internal)${report.reviewedByName ? ` — ${report.reviewedByName}` : ""}`;
      y = box(lbl, report.reviewNotes, y, notesReserve) + 0.18;
    }

    // Photo.
    if (photo) {
      label("Photo", M, photoTop - 0.16);
      doc.setDrawColor(150); doc.setLineWidth(0.01);
      doc.addImage(photo.dataUrl, "JPEG", M, photoTop, photoW, photoH);
      doc.rect(M, photoTop, photoW, photoH);
    }

    // Footer.
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(110, 110, 110);
    doc.setDrawColor(200); doc.setLineWidth(0.01); doc.line(M, footerBaseline - 0.18, W - M, footerBaseline - 0.18);
    doc.text(`Confidential — handle per company policy. Printed ${new Date().toLocaleString()}.`, M, footerBaseline - 0.04);

    // Print via a hidden iframe (avoids popup blockers after the async build).
    const url = doc.output("bloburl") as unknown as string;
    const iframe = document.createElement("iframe");
    Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
    iframe.src = url;
    iframe.onload = () => {
      setTimeout(() => { try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { /* ignore */ } }, 400);
    };
    document.body.appendChild(iframe);
    setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* ignore */ } }, 120000);
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
          <button onClick={() => void printReportPdf()} className="px-4 py-2 rounded-lg theme-bg-primary theme-text-secondary text-sm font-medium" title="Print this report on one page">Print</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg theme-bg-primary theme-text-secondary text-sm">Cancel</button>
            <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-[#007AFF] text-white text-sm font-medium disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
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
