"use client";

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import Protected from "../../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../../theme-context";
import { useAuth } from "../../auth-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  REVIEW_QUESTIONS, REVIEW_TYPE_LABEL, reviewSections, computeAverage, recommendedIncrease, raiseTier,
  type ReviewType,
} from "@/lib/reviewQuestions";

type View = "eligible" | "progress" | "summary";

export default function ReviewsPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user, canManagePersonnel } = useAuth();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [type, setType] = useState<ReviewType>("90_day");
  const [view, setView] = useState<View>("eligible");

  const reqId = user?._id;
  const eligible = useQuery(api.employeeReviews.listEligible, reqId && canManagePersonnel ? { requestingUserId: reqId, reviewType: type } : "skip");
  const reviews = useQuery(api.employeeReviews.list, reqId && canManagePersonnel ? { requestingUserId: reqId, reviewType: type } : "skip");

  const generate = useMutation(api.employeeReviews.generate);
  const generateBatch = useMutation(api.employeeReviews.generateBatch);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openReviewId, setOpenReviewId] = useState<string | null>(null);
  const [printForm, setPrintForm] = useState<{ name: string; position?: string } | null>(null);
  const [printSummary, setPrintSummary] = useState(false);

  const userName = user?.name ?? user?.email ?? "Unknown";

  useEffect(() => { setSelected(new Set()); }, [type]);

  if (!canManagePersonnel) {
    return (
      <Protected>
        <div className="flex h-screen theme-bg-primary">
          <Sidebar />
          <main className="flex-1 flex items-center justify-center">
            <p className={isDark ? "text-slate-400" : "text-gray-500"}>You don&apos;t have permission to manage reviews.</p>
          </main>
        </div>
      </Protected>
    );
  }

  const toggleSel = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const handleGenerateSelected = async () => {
    if (!reqId || selected.size === 0) return;
    await generateBatch({ requestingUserId: reqId, personnelIds: [...selected] as any, reviewType: type, createdByName: userName });
    setSelected(new Set());
    setView("progress");
  };

  const triggerPrint = (cb: () => void) => { cb(); setTimeout(() => window.print(), 60); };

  return (
    <Protected>
      <div className="flex h-screen theme-bg-primary">
        <Sidebar />
        <main className="flex-1 overflow-y-auto print:overflow-visible">
          <MobileHeader />
          <header className={`sticky top-0 z-10 border-b px-4 sm:px-6 py-3 sm:py-4 print:hidden no-print ${isDark ? "bg-slate-900/95 backdrop-blur border-slate-700" : "bg-white/95 backdrop-blur border-gray-200"}`}>
            <div className="flex items-center gap-3">
              <a href="/personnel" className={`p-2 rounded-lg ${isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-gray-200 text-gray-500"}`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
              </a>
              <div>
                <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Performance Reviews</h1>
                <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Generate forms, enter scores, and recommend raises</p>
              </div>
            </div>
            {/* Type toggle */}
            <div className="flex gap-1 mt-4">
              {(["90_day", "annual"] as ReviewType[]).map((t) => (
                <button key={t} onClick={() => setType(t)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${type === t ? (isDark ? "bg-orange-500/20 text-orange-400 border border-orange-500/40" : "bg-orange-100 text-orange-700 border border-orange-300") : (isDark ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-100")}`}>
                  {REVIEW_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            {/* View tabs */}
            <div className="flex gap-1 mt-3">
              {([["eligible", "Eligible"], ["progress", "In Progress"], ["summary", "Summary"]] as [View, string][]).map(([v, label]) => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === v ? (isDark ? "bg-slate-700 text-white" : "bg-gray-200 text-gray-900") : (isDark ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-100")}`}>
                  {label}
                </button>
              ))}
            </div>
          </header>

          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 print:hidden no-print">
            {/* ELIGIBLE */}
            {view === "eligible" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Eligible for {REVIEW_TYPE_LABEL[type]}</h2>
                  <button onClick={handleGenerateSelected} disabled={selected.size === 0}
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${selected.size === 0 ? "bg-gray-300 text-gray-500 cursor-not-allowed" : isDark ? "bg-orange-500 hover:bg-orange-400 text-white" : "bg-orange-600 hover:bg-orange-700 text-white"}`}>
                    Generate {selected.size > 0 ? `(${selected.size})` : ""}
                  </button>
                </div>
                {eligible === undefined && <p className={isDark ? "text-slate-400" : "text-gray-500"}>Loading…</p>}
                {eligible && eligible.length === 0 && <p className={isDark ? "text-slate-400" : "text-gray-500"}>No employees currently eligible.</p>}
                <div className="space-y-2">
                  {eligible?.map((e) => (
                    <div key={e.personnelId} className={`flex items-center gap-3 p-3 rounded-lg border ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
                      <input type="checkbox" checked={selected.has(e.personnelId)} onChange={() => toggleSel(e.personnelId)} className="w-4 h-4" />
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{e.name}</div>
                        <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{e.position} · {e.department} · {e.daysSinceHire} days since hire{e.existingStatus ? ` · ${e.existingStatus}` : ""}</div>
                      </div>
                      <button onClick={() => triggerPrint(() => setPrintForm({ name: e.name, position: e.position }))}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}>
                        Print blank form
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* IN PROGRESS */}
            {view === "progress" && (
              <div className="space-y-3">
                <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{REVIEW_TYPE_LABEL[type]}s — In Progress</h2>
                {reviews === undefined && <p className={isDark ? "text-slate-400" : "text-gray-500"}>Loading…</p>}
                {reviews && reviews.filter((r) => r.status !== "decided").length === 0 && <p className={isDark ? "text-slate-400" : "text-gray-500"}>Nothing in progress. Generate forms from the Eligible tab.</p>}
                {reviews?.filter((r) => r.status !== "decided").map((r) => (
                  <ReviewCard key={r._id} review={r} isDark={isDark} reqId={reqId!} userName={userName}
                    open={openReviewId === r._id} onToggle={() => setOpenReviewId(openReviewId === r._id ? null : r._id)}
                    onPrint={() => triggerPrint(() => setPrintForm({ name: r.employeeName, position: r.position }))} />
                ))}
              </div>
            )}

            {/* SUMMARY */}
            {view === "summary" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{REVIEW_TYPE_LABEL[type]} Summary</h2>
                  <button onClick={() => triggerPrint(() => setPrintSummary(true))}
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}>
                    Print summary
                  </button>
                </div>
                <div className={`rounded-xl border overflow-hidden ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                  <table className="w-full text-sm">
                    <thead className={isDark ? "bg-slate-800 text-slate-300" : "bg-gray-50 text-gray-600"}>
                      <tr><th className="text-left px-3 py-2">Employee</th><th className="text-center px-3 py-2">Avg</th><th className="text-left px-3 py-2">Recommended</th><th className="text-center px-3 py-2">Decision</th><th className="text-left px-3 py-2">Approved</th></tr>
                    </thead>
                    <tbody>
                      {reviews?.map((r) => (
                        <tr key={r._id} className={`border-t ${isDark ? "border-slate-700 text-slate-200" : "border-gray-100 text-gray-800"}`}>
                          <td className="px-3 py-2">{r.employeeName}</td>
                          <td className="text-center px-3 py-2 font-semibold">{r.averageScore != null ? r.averageScore.toFixed(2) : "—"}</td>
                          <td className="px-3 py-2">{r.recommendedIncrease ?? "—"}</td>
                          <td className="text-center px-3 py-2"><DecisionPill decision={r.decision} isDark={isDark} /></td>
                          <td className="px-3 py-2">{r.approvedIncrease || (r.decision === "approved" ? "—" : "")}</td>
                        </tr>
                      ))}
                      {reviews && reviews.length === 0 && <tr><td colSpan={5} className={`px-3 py-4 text-center ${isDark ? "text-slate-400" : "text-gray-500"}`}>No reviews yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* ── Print artifacts (portal to body) ── */}
          {mounted && (printForm || printSummary) && createPortal(
            <div id="rv-print-root">
              {printForm && <BlankForm name={printForm.name} position={printForm.position} type={type} />}
              {printSummary && <SummaryPrint rows={reviews ?? []} type={type} />}
            </div>,
            document.body,
          )}
        </main>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        #rv-print-root { display: none; }
        @media print {
          @page { size: letter portrait; margin: 0.5in; }
          body > :not(#rv-print-root) { display: none !important; }
          #rv-print-root { display: block !important; color: #000; }
        }
      ` }} />
      {/* Clear print state after printing */}
      <PrintCleanup onAfter={() => { setPrintForm(null); setPrintSummary(false); }} />
    </Protected>
  );
}

function PrintCleanup({ onAfter }: { onAfter: () => void }) {
  useEffect(() => {
    const h = () => onAfter();
    window.addEventListener("afterprint", h);
    return () => window.removeEventListener("afterprint", h);
  }, [onAfter]);
  return null;
}

function DecisionPill({ decision, isDark }: { decision: string; isDark: boolean }) {
  const map: Record<string, string> = {
    approved: isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700",
    denied: isDark ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-700",
    pending: isDark ? "bg-slate-600/40 text-slate-300" : "bg-gray-100 text-gray-600",
  };
  return <span className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${map[decision] ?? map.pending}`}>{decision}</span>;
}

// ── Score-entry card ──────────────────────────────────────────────────────────
function ReviewCard({ review, isDark, reqId, userName, open, onToggle, onPrint }: any) {
  const saveScores = useMutation(api.employeeReviews.saveScores);
  const setDecision = useMutation(api.employeeReviews.setDecision);
  const remove = useMutation(api.employeeReviews.remove);
  const type = review.reviewType as ReviewType;
  const questions = REVIEW_QUESTIONS[type];

  const [ratings, setRatings] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const r of review.ratings ?? []) m[r.questionId] = r.rating;
    return m;
  });
  const [reviewerName, setReviewerName] = useState(review.reviewerName ?? "");
  const [comments, setComments] = useState(review.generalComments ?? "");
  const [approvedIncrease, setApprovedIncrease] = useState(review.approvedIncrease ?? "");
  const [saving, setSaving] = useState(false);

  const avg = useMemo(() => computeAverage(ratings), [ratings]);
  const rec = avg > 0 ? recommendedIncrease(avg, type) : "—";

  const save = async () => {
    setSaving(true);
    try {
      await saveScores({
        requestingUserId: reqId, id: review._id,
        ratings: questions.map((q) => ({ questionId: q.id, section: q.section, rating: ratings[q.id] ?? 0 })),
        reviewerName, generalComments: comments,
      });
    } finally { setSaving(false); }
  };
  const decide = async (decision: "approved" | "denied") => {
    await save();
    await setDecision({ requestingUserId: reqId, id: review._id, decision, approvedIncrease: decision === "approved" ? approvedIncrease : undefined, decidedByName: userName });
  };

  return (
    <div className={`rounded-xl border ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
      <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={onToggle}>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{review.employeeName}</div>
          <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{review.reviewPeriodLabel} · {review.status}{review.averageScore != null ? ` · avg ${review.averageScore.toFixed(2)} · rec ${review.recommendedIncrease}` : ""}</div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onPrint(); }} className={`px-3 py-1.5 rounded-md text-xs font-medium ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}>Print form</button>
        <svg className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""} ${isDark ? "text-slate-400" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </div>

      {open && (
        <div className={`p-4 border-t space-y-4 ${isDark ? "border-slate-700" : "border-gray-200"}`}>
          <div className="flex items-center gap-3">
            <label className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>Completed by (reviewer)</label>
            <input value={reviewerName} onChange={(e) => setReviewerName(e.target.value)} placeholder="e.g. Travis"
              className={`px-3 py-1.5 rounded-lg text-sm border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"}`} />
          </div>
          {reviewSections(type).map((section) => (
            <div key={section}>
              <h4 className={`text-xs font-bold uppercase tracking-wide mb-2 ${isDark ? "text-orange-400" : "text-orange-600"}`}>{section}</h4>
              <div className="space-y-2">
                {questions.filter((q) => q.section === section).map((q) => (
                  <div key={q.id} className="flex items-center gap-3">
                    <span className={`flex-1 text-sm ${isDark ? "text-slate-200" : "text-gray-700"}`}>{q.text}</span>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} onClick={() => setRatings((p) => ({ ...p, [q.id]: n }))}
                          className={`w-8 h-8 rounded-md text-sm font-semibold border transition-colors ${ratings[q.id] === n ? (isDark ? "bg-orange-500 border-orange-400 text-white" : "bg-orange-600 border-orange-600 text-white") : (isDark ? "border-slate-600 text-slate-400 hover:bg-slate-700" : "border-gray-300 text-gray-500 hover:bg-gray-100")}`}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className={`flex items-center justify-between p-3 rounded-lg ${isDark ? "bg-slate-900" : "bg-gray-50"}`}>
            <div className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>Average score</div>
            <div className="flex items-center gap-4">
              <span className={`text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{avg > 0 ? avg.toFixed(2) : "—"}</span>
              <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Recommended: <strong className={isDark ? "text-orange-400" : "text-orange-600"}>{rec}</strong></span>
            </div>
          </div>

          <div>
            <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>General comments</label>
            <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3}
              className={`w-full px-3 py-2 rounded-lg text-sm border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"}`} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={save} disabled={saving} className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-200 hover:bg-gray-300 text-gray-800"}`}>{saving ? "Saving…" : "Save scores"}</button>
            <div className="flex items-center gap-2">
              <input value={approvedIncrease} onChange={(e) => setApprovedIncrease(e.target.value)} placeholder="Approved increase (e.g. 2.5%)"
                className={`px-3 py-1.5 rounded-lg text-sm border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"}`} />
              <button onClick={() => decide("approved")} className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? "bg-emerald-500 hover:bg-emerald-400 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`}>Approve</button>
              <button onClick={() => decide("denied")} className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? "bg-red-500/80 hover:bg-red-500 text-white" : "bg-red-600 hover:bg-red-700 text-white"}`}>Deny</button>
            </div>
            <button onClick={() => { if (confirm("Delete this review?")) remove({ requestingUserId: reqId, id: review._id }); }}
              className={`ml-auto px-3 py-1.5 rounded-md text-xs ${isDark ? "text-slate-400 hover:text-red-400" : "text-gray-400 hover:text-red-500"}`}>Delete</button>
          </div>
          {review.decision !== "pending" && (
            <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Decision: <strong>{review.decision}</strong>{review.approvedIncrease ? ` · approved ${review.approvedIncrease}` : ""}{review.decidedByName ? ` · by ${review.decidedByName}` : ""}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Printable blank form (preprinted name; Travis fills 1-5 by hand) ───────────
function BlankForm({ name, position, type }: { name: string; position?: string; type: ReviewType }) {
  const questions = REVIEW_QUESTIONS[type];
  return (
    <div style={{ fontFamily: "Arial, sans-serif", color: "#000", fontSize: "12px" }}>
      <div style={{ textAlign: "center", borderBottom: "2px solid #000", paddingBottom: "8px", marginBottom: "12px" }}>
        <div style={{ fontSize: "16px", fontWeight: 700 }}>Import Export Tire — {REVIEW_TYPE_LABEL[type]}</div>
        <div style={{ fontSize: "11px" }}>Performance Evaluation (rate each item 1 = poor, 5 = excellent)</div>
      </div>
      <table style={{ width: "100%", marginBottom: "12px", fontSize: "12px" }}>
        <tbody>
          <tr>
            <td style={{ width: "55%" }}><strong>Employee:</strong> {name}</td>
            <td><strong>Position:</strong> {position || "____________________"}</td>
          </tr>
          <tr>
            <td><strong>Reviewer:</strong> ____________________</td>
            <td><strong>Date:</strong> ____________________</td>
          </tr>
        </tbody>
      </table>

      {reviewSections(type).map((section) => (
        <div key={section} style={{ marginBottom: "10px" }}>
          <div style={{ fontWeight: 700, background: "#eee", padding: "3px 6px", borderBottom: "1px solid #000" }}>{section}</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ fontSize: "10px" }}>
                <th style={{ textAlign: "left", padding: "2px 6px" }}></th>
                {[1, 2, 3, 4, 5].map((n) => <th key={n} style={{ width: "26px", padding: "2px" }}>{n}</th>)}
              </tr>
            </thead>
            <tbody>
              {questions.filter((q) => q.section === section).map((q) => (
                <tr key={q.id} style={{ borderBottom: "1px solid #ccc" }}>
                  <td style={{ padding: "5px 6px" }}>{q.text}</td>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <td key={n} style={{ textAlign: "center", padding: "5px 2px" }}>
                      <span style={{ display: "inline-block", width: "14px", height: "14px", border: "1px solid #000" }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div style={{ marginTop: "10px" }}>
        <strong>Comments:</strong>
        <div style={{ border: "1px solid #000", height: "60px", marginTop: "4px" }} />
      </div>

      <table style={{ width: "100%", marginTop: "24px", fontSize: "12px" }}>
        <tbody>
          <tr>
            <td style={{ paddingTop: "20px" }}><div style={{ borderTop: "1px solid #000", paddingTop: "3px" }}>Reviewer (Travis) &nbsp; Date: ________</div></td>
            <td style={{ paddingTop: "20px", paddingLeft: "20px" }}><div style={{ borderTop: "1px solid #000", paddingTop: "3px" }}>Andy Barrows &nbsp; Date: ________</div></td>
          </tr>
          <tr>
            <td style={{ paddingTop: "26px" }}><div style={{ borderTop: "1px solid #000", paddingTop: "3px" }}>Terry &nbsp; Date: ________</div></td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Printable batch summary (for Terry; includes recommended/approved raises) ──
function SummaryPrint({ rows, type }: { rows: any[]; type: ReviewType }) {
  return (
    <div style={{ fontFamily: "Arial, sans-serif", color: "#000", fontSize: "12px" }}>
      <div style={{ textAlign: "center", borderBottom: "2px solid #000", paddingBottom: "8px", marginBottom: "12px" }}>
        <div style={{ fontSize: "16px", fontWeight: 700 }}>Import Export Tire — {REVIEW_TYPE_LABEL[type]} Summary</div>
        <div style={{ fontSize: "11px" }}>Scores &amp; recommended wage increases</div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
        <thead>
          <tr style={{ background: "#eee" }}>
            <th style={{ textAlign: "left", padding: "4px 6px", borderBottom: "1px solid #000" }}>Employee</th>
            <th style={{ textAlign: "center", padding: "4px 6px", borderBottom: "1px solid #000" }}>Avg (1–5)</th>
            <th style={{ textAlign: "left", padding: "4px 6px", borderBottom: "1px solid #000" }}>Recommended</th>
            <th style={{ textAlign: "center", padding: "4px 6px", borderBottom: "1px solid #000" }}>Decision</th>
            <th style={{ textAlign: "left", padding: "4px 6px", borderBottom: "1px solid #000" }}>Approved</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r._id}>
              <td style={{ padding: "4px 6px", borderBottom: "1px solid #ccc" }}>{r.employeeName}</td>
              <td style={{ textAlign: "center", padding: "4px 6px", borderBottom: "1px solid #ccc" }}>{r.averageScore != null ? r.averageScore.toFixed(2) : "—"}</td>
              <td style={{ padding: "4px 6px", borderBottom: "1px solid #ccc" }}>{r.recommendedIncrease ?? "—"}</td>
              <td style={{ textAlign: "center", padding: "4px 6px", borderBottom: "1px solid #ccc" }}>{r.decision}</td>
              <td style={{ padding: "4px 6px", borderBottom: "1px solid #ccc" }}>{r.approvedIncrease || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: "16px", fontSize: "11px" }}>Tier guide — {type === "annual" ? "Annual" : "90-Day"}: &lt;2.5 → {raiseTier(0)[type === "annual" ? "annual" : "ninetyDay"]}; 2.5–3.4 → {raiseTier(3)[type === "annual" ? "annual" : "ninetyDay"]}; 3.5–4.4 → {raiseTier(4)[type === "annual" ? "annual" : "ninetyDay"]}; 4.5–5.0 → {raiseTier(5)[type === "annual" ? "annual" : "ninetyDay"]}.</p>
      <p style={{ marginTop: "24px" }}>Approved by: ____________________ (Terry) &nbsp;&nbsp; Date: ________</p>
    </div>
  );
}
