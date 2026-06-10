"use client";
// Score-entry + decision panel for one employee review. Used in a modal on the
// Review Tracker. Backed by the employeeReviews table; computes the 1-5 average
// and recommended raise tier live, then records Approve/Deny + approved increase.
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  REVIEW_QUESTIONS, REVIEW_TYPE_LABEL, reviewSections, computeAverage, recommendedIncrease, type ReviewType,
} from "@/lib/reviewQuestions";

export default function ReviewScorePanel({
  reviewId, reqId, userName, isDark, onClose,
}: {
  reviewId: Id<"employeeReviews">;
  reqId: Id<"users">;
  userName: string;
  isDark: boolean;
  onClose: () => void;
}) {
  const review = useQuery(api.employeeReviews.get, { id: reviewId });
  const saveScores = useMutation(api.employeeReviews.saveScores);
  const setDecision = useMutation(api.employeeReviews.setDecision);

  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [reviewerName, setReviewerName] = useState("");
  const [comments, setComments] = useState("");
  const [approvedIncrease, setApprovedIncrease] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Seed local state once the review loads.
  if (review && !loaded) {
    const m: Record<string, number> = {};
    for (const r of review.ratings ?? []) m[r.questionId] = r.rating;
    setRatings(m);
    setReviewerName(review.reviewerName ?? "");
    setComments(review.generalComments ?? "");
    setApprovedIncrease(review.approvedIncrease ?? "");
    setLoaded(true);
  }

  const type = (review?.reviewType ?? "90_day") as ReviewType;
  const questions = REVIEW_QUESTIONS[type];
  const avg = useMemo(() => computeAverage(ratings), [ratings]);
  const rec = avg > 0 ? recommendedIncrease(avg, type) : "—";

  const save = async () => {
    if (!review) return;
    setSaving(true);
    try {
      await saveScores({
        requestingUserId: reqId, id: reviewId,
        ratings: questions.map((q) => ({ questionId: q.id, section: q.section, rating: ratings[q.id] ?? 0 })),
        reviewerName, generalComments: comments,
      });
    } finally { setSaving(false); }
  };
  const decide = async (decision: "approved" | "denied") => {
    await save();
    await setDecision({ requestingUserId: reqId, id: reviewId, decision, approvedIncrease: decision === "approved" ? approvedIncrease : undefined, decidedByName: userName });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={`w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl ${isDark ? "bg-slate-800" : "bg-white"}`}>
        {!review ? (
          <div className={`p-8 text-center ${isDark ? "text-slate-400" : "text-gray-500"}`}>Loading…</div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className={`text-lg font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{review.employeeName}</h3>
                <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{REVIEW_TYPE_LABEL[type]} · {review.position || "—"}</p>
              </div>
              <button onClick={onClose} className={`p-1 rounded ${isDark ? "text-slate-400 hover:text-white" : "text-gray-400 hover:text-gray-700"}`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

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

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button onClick={save} disabled={saving} className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-200 hover:bg-gray-300 text-gray-800"}`}>{saving ? "Saving…" : "Save scores"}</button>
              <input value={approvedIncrease} onChange={(e) => setApprovedIncrease(e.target.value)} placeholder="Approved increase (e.g. 2.5%)"
                className={`px-3 py-1.5 rounded-lg text-sm border flex-1 min-w-[160px] ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"}`} />
              <button onClick={() => decide("approved")} className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? "bg-emerald-500 hover:bg-emerald-400 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`}>Approve</button>
              <button onClick={() => decide("denied")} className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? "bg-red-500/80 hover:bg-red-500 text-white" : "bg-red-600 hover:bg-red-700 text-white"}`}>Deny</button>
            </div>
            {review.decision !== "pending" && (
              <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Current: <strong>{review.decision}</strong>{review.approvedIncrease ? ` · approved ${review.approvedIncrease}` : ""}{review.decidedByName ? ` · by ${review.decidedByName}` : ""}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
