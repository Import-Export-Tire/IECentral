"use client";

import { useMemo, useState } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "../auth-context";
import { useTheme } from "../theme-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

type Tab = "pending_signoff" | "scheduled" | "completed" | "reversed";

const LEAVING_CATEGORIES = [
  { value: "voluntary_quit",   label: "Voluntary quit" },
  { value: "no_call_no_show",  label: "No-call no-show" },
  { value: "attendance",       label: "Attendance" },
  { value: "performance",      label: "Performance" },
  { value: "involuntary",      label: "Involuntary (other)" },
  { value: "layoff",           label: "Layoff / reorg" },
  { value: "other",            label: "Other" },
];

interface ConductForm {
  leavingCategory: string;
  primaryReason: string;
  wouldReturn: string;
  wouldRecommend: string;
  satisfactionRating: number | "";
  managementRating: number | "";
  workLifeBalanceRating: number | "";
  compensationRating: number | "";
  growthOpportunityRating: number | "";
  whatLikedMost: string;
  whatCouldImprove: string;
  additionalComments: string;
  interviewerNotes: string;
  rehireEligible: boolean | null;
  severancePaid: boolean | null;
  finalPaycheckDate: string;
  hrNotes: string;
}

const EMPTY_FORM: ConductForm = {
  leavingCategory: "",
  primaryReason: "",
  wouldReturn: "",
  wouldRecommend: "",
  satisfactionRating: "",
  managementRating: "",
  workLifeBalanceRating: "",
  compensationRating: "",
  growthOpportunityRating: "",
  whatLikedMost: "",
  whatCouldImprove: "",
  additionalComments: "",
  interviewerNotes: "",
  rehireEligible: null,
  severancePaid: null,
  finalPaycheckDate: "",
  hrNotes: "",
};

function ExitInterviewsContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();

  const interviews = useQuery(api.exitInterviews.list, {}) as any[] | undefined;
  const signOff = useMutation(api.exitInterviews.signOff);
  const reverse = useMutation(api.exitInterviews.reverse);
  const complete = useMutation(api.exitInterviews.complete);

  const [tab, setTab] = useState<Tab>("pending_signoff");
  const [conductId, setConductId] = useState<Id<"exitInterviews"> | null>(null);
  const [form, setForm] = useState<ConductForm>(EMPTY_FORM);
  const [reverseId, setReverseId] = useState<Id<"exitInterviews"> | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const buckets = useMemo(() => {
    const list = interviews || [];
    return {
      pending_signoff: list.filter(i => i.status === "pending_signoff" || i.status === "pending"),
      scheduled: list.filter(i => i.status === "scheduled"),
      completed: list.filter(i => i.status === "completed"),
      reversed: list.filter(i => i.status === "reversed" || i.status === "declined"),
    };
  }, [interviews]);

  const rows = buckets[tab];

  const tabBtn = (key: Tab, label: string) => {
    const active = tab === key;
    return (
      <button
        key={key}
        onClick={() => setTab(key)}
        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
          active ? "bg-[#007AFF] text-white shadow-sm" : "theme-text-secondary theme-bg-hover"
        }`}
      >
        {label}
        <span className={`ml-1.5 text-[11px] ${active ? "opacity-80" : "opacity-60"}`}>
          {buckets[key].length}
        </span>
      </button>
    );
  };

  const handleSignOff = async (id: Id<"exitInterviews">) => {
    if (!user) return;
    setBusy(true); setError("");
    try { await signOff({ interviewId: id, signedOffByUserId: user._id as Id<"users"> }); }
    catch (e) { setError(e instanceof Error ? e.message : "Sign-off failed"); }
    finally { setBusy(false); }
  };

  const handleReverse = async () => {
    if (!user || !reverseId || !reverseReason.trim()) return;
    setBusy(true); setError("");
    try {
      await reverse({ interviewId: reverseId, reversedByUserId: user._id as Id<"users">, reversedReason: reverseReason });
      setReverseId(null); setReverseReason("");
    } catch (e) { setError(e instanceof Error ? e.message : "Reverse failed"); }
    finally { setBusy(false); }
  };

  const openConduct = (interview: any) => {
    setConductId(interview._id);
    setForm({
      ...EMPTY_FORM,
      ...(interview.responses || {}),
      leavingCategory: interview.leavingCategory || "",
      interviewerNotes: interview.interviewerNotes || "",
      rehireEligible: interview.rehireEligible ?? null,
      severancePaid: interview.severancePaid ?? null,
      finalPaycheckDate: interview.finalPaycheckDate || "",
      hrNotes: interview.hrNotes || "",
      satisfactionRating: interview.responses?.satisfactionRating ?? "",
      managementRating: interview.responses?.managementRating ?? "",
      workLifeBalanceRating: interview.responses?.workLifeBalanceRating ?? "",
      compensationRating: interview.responses?.compensationRating ?? "",
      growthOpportunityRating: interview.responses?.growthOpportunityRating ?? "",
    });
  };

  const handleComplete = async () => {
    if (!user || !conductId) return;
    setBusy(true); setError("");
    try {
      const ratingOrUndef = (v: number | "") => (v === "" ? undefined : Number(v));
      await complete({
        interviewId: conductId,
        conductedBy: user._id as Id<"users">,
        responses: {
          primaryReason: form.primaryReason || undefined,
          wouldReturn: form.wouldReturn || undefined,
          wouldRecommend: form.wouldRecommend || undefined,
          satisfactionRating: ratingOrUndef(form.satisfactionRating),
          managementRating: ratingOrUndef(form.managementRating),
          workLifeBalanceRating: ratingOrUndef(form.workLifeBalanceRating),
          compensationRating: ratingOrUndef(form.compensationRating),
          growthOpportunityRating: ratingOrUndef(form.growthOpportunityRating),
          whatLikedMost: form.whatLikedMost || undefined,
          whatCouldImprove: form.whatCouldImprove || undefined,
          additionalComments: form.additionalComments || undefined,
        },
        interviewerNotes: form.interviewerNotes || undefined,
        leavingCategory: form.leavingCategory || undefined,
        rehireEligible: form.rehireEligible ?? undefined,
        severancePaid: form.severancePaid ?? undefined,
        finalPaycheckDate: form.finalPaycheckDate || undefined,
        hrNotes: form.hrNotes || undefined,
      });
      setConductId(null);
      setForm(EMPTY_FORM);
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(false); }
  };

  const tenureStr = (i: any) => {
    if (!i.hireDate || !i.terminationDate) return "—";
    const days = Math.floor((new Date(i.terminationDate).getTime() - new Date(i.hireDate).getTime()) / 86400000);
    if (days < 90) return `${days}d`;
    if (days < 365) return `${Math.round(days / 30)}mo`;
    return `${(days / 365.25).toFixed(1)}yr`;
  };

  const labelClass = `block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`;
  const inputClass = `w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 ${
    isDark ? "bg-slate-900 border-slate-700 text-white" : "bg-white border-gray-300 text-gray-900"
  }`;
  const cardClass = `rounded-2xl border p-5 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"} shadow-sm`;

  const conductingInterview = conductId ? (interviews || []).find(i => i._id === conductId) : null;

  return (
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        <header className={`sticky top-0 z-10 backdrop-blur-md border-b px-6 sm:px-8 py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/85 border-gray-200"}`}>
          <div>
            <h1 className="text-xl font-semibold theme-text-primary tracking-tight">Exit Interviews</h1>
            <p className="text-xs theme-text-tertiary">Sign off on terminations, reverse within 7 days, and conduct interviews</p>
          </div>
        </header>

        <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-5">
          {error && <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm p-3">{error}</div>}

          <div className={`inline-flex items-center gap-1 rounded-full p-1 ${isDark ? "bg-slate-800/60 border border-slate-700" : "bg-gray-100"}`}>
            {tabBtn("pending_signoff", "Pending sign-off")}
            {tabBtn("scheduled",       "Scheduled")}
            {tabBtn("completed",       "Completed")}
            {tabBtn("reversed",        "Reversed")}
          </div>

          <div className={cardClass}>
            {rows.length === 0 ? (
              <p className="text-sm theme-text-muted py-6 text-center">Nothing in this tab.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={isDark ? "text-slate-400" : "text-gray-600"}>
                    <tr className="border-b theme-border-secondary">
                      <th className="text-left py-2 px-2 font-medium">Employee</th>
                      <th className="text-left py-2 px-2 font-medium">Position</th>
                      <th className="text-left py-2 px-2 font-medium">Department</th>
                      <th className="text-left py-2 px-2 font-medium">Termed</th>
                      <th className="text-left py-2 px-2 font-medium">Tenure</th>
                      <th className="text-left py-2 px-2 font-medium">Reason</th>
                      <th className="text-left py-2 px-2 font-medium">Status</th>
                      <th className="text-right py-2 px-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((i: any) => {
                      const canReverse = i.reversibleUntil && Date.now() < i.reversibleUntil && i.status !== "reversed";
                      const reversibleDays = canReverse ? Math.ceil((i.reversibleUntil - Date.now()) / 86400000) : 0;
                      return (
                        <tr key={i._id} className="border-b theme-border-secondary">
                          <td className="py-2 px-2 theme-text-primary font-medium">{i.personnelName}</td>
                          <td className="py-2 px-2 theme-text-secondary">{i.position || "—"}</td>
                          <td className="py-2 px-2 theme-text-secondary">{i.department || "—"}</td>
                          <td className="py-2 px-2 theme-text-tertiary tabular-nums">{i.terminationDate}</td>
                          <td className="py-2 px-2 theme-text-tertiary tabular-nums">{tenureStr(i)}</td>
                          <td className="py-2 px-2 theme-text-secondary truncate max-w-[160px]" title={i.terminationReason || ""}>{i.terminationReason || "—"}</td>
                          <td className="py-2 px-2">
                            <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${
                              i.status === "pending_signoff" || i.status === "pending" ? "bg-amber-100 text-amber-700" :
                              i.status === "scheduled" ? "bg-blue-100 text-blue-700" :
                              i.status === "completed" ? "bg-green-100 text-green-700" :
                              "bg-gray-100 text-gray-700"
                            }`}>{i.status.replace(/_/g, " ")}</span>
                            {canReverse && (
                              <span className="ml-1.5 text-[10px] theme-text-muted">{reversibleDays}d to reverse</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right">
                            <div className="flex gap-1 justify-end flex-wrap">
                              {(i.status === "pending_signoff" || i.status === "pending") && (
                                <button
                                  onClick={() => handleSignOff(i._id)}
                                  disabled={busy}
                                  className="px-3 py-1 text-xs font-medium rounded-full bg-[#007AFF]/10 text-[#007AFF] hover:bg-[#007AFF]/20"
                                >Sign off</button>
                              )}
                              {i.status !== "completed" && i.status !== "reversed" && (
                                <button
                                  onClick={() => openConduct(i)}
                                  className="px-3 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700 hover:bg-green-200"
                                >Conduct</button>
                              )}
                              {i.status === "completed" && (
                                <button
                                  onClick={() => openConduct(i)}
                                  className="px-3 py-1 text-xs font-medium rounded-full theme-bg-secondary theme-text-secondary theme-bg-hover"
                                >View</button>
                              )}
                              {canReverse && (
                                <button
                                  onClick={() => { setReverseId(i._id); setReverseReason(""); }}
                                  className="px-3 py-1 text-xs font-medium rounded-full bg-red-50 text-red-600 hover:bg-red-100"
                                >Reverse</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Conduct modal */}
        {conductingInterview && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
            <div className="theme-bg-card rounded-2xl shadow-2xl w-full max-w-3xl max-h-[95vh] flex flex-col overflow-hidden">
              <div className="px-6 py-4 border-b theme-border-primary flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold theme-text-primary tracking-tight">
                    {conductingInterview.status === "completed" ? "Exit Interview (view)" : "Conduct Exit Interview"}
                  </h2>
                  <p className="text-xs theme-text-tertiary mt-0.5">
                    {conductingInterview.personnelName} · {conductingInterview.position || "—"} · termed {conductingInterview.terminationDate} · tenure {tenureStr(conductingInterview)}
                  </p>
                </div>
                <button onClick={() => { setConductId(null); setForm(EMPTY_FORM); }} className="p-1.5 theme-text-tertiary hover:theme-text-primary rounded-full theme-bg-hover">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                {/* Reason */}
                <section className="theme-bg-secondary rounded-2xl border theme-border-primary p-4">
                  <h3 className="text-xs font-semibold theme-text-tertiary uppercase tracking-wider mb-3">Reason for Leaving</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Category</label>
                      <select className={inputClass} value={form.leavingCategory} onChange={(e) => setForm({ ...form, leavingCategory: e.target.value })}>
                        <option value="">—</option>
                        {LEAVING_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Would return?</label>
                      <select className={inputClass} value={form.wouldReturn} onChange={(e) => setForm({ ...form, wouldReturn: e.target.value })}>
                        <option value="">—</option>
                        <option value="yes">Yes</option>
                        <option value="maybe">Maybe</option>
                        <option value="no">No</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelClass}>Primary reason (their words)</label>
                      <textarea rows={2} className={inputClass} value={form.primaryReason} onChange={(e) => setForm({ ...form, primaryReason: e.target.value })} />
                    </div>
                  </div>
                </section>

                {/* Ratings */}
                <section className="theme-bg-secondary rounded-2xl border theme-border-primary p-4">
                  <h3 className="text-xs font-semibold theme-text-tertiary uppercase tracking-wider mb-3">Ratings (1 = poor, 5 = excellent)</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { key: "satisfactionRating", label: "Job satisfaction" },
                      { key: "managementRating", label: "Management" },
                      { key: "workLifeBalanceRating", label: "Work / life balance" },
                      { key: "compensationRating", label: "Compensation / benefits" },
                      { key: "growthOpportunityRating", label: "Growth opportunity" },
                    ].map(f => (
                      <div key={f.key}>
                        <label className={labelClass}>{f.label}</label>
                        <select
                          className={inputClass}
                          value={(form as any)[f.key]}
                          onChange={(e) => setForm({ ...form, [f.key]: e.target.value ? parseInt(e.target.value) : "" } as ConductForm)}
                        >
                          <option value="">—</option>
                          {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                    ))}
                    <div>
                      <label className={labelClass}>Would recommend us as employer?</label>
                      <select className={inputClass} value={form.wouldRecommend} onChange={(e) => setForm({ ...form, wouldRecommend: e.target.value })}>
                        <option value="">—</option>
                        <option value="yes">Yes</option>
                        <option value="maybe">Maybe</option>
                        <option value="no">No</option>
                      </select>
                    </div>
                  </div>
                </section>

                {/* Open feedback */}
                <section className="theme-bg-secondary rounded-2xl border theme-border-primary p-4">
                  <h3 className="text-xs font-semibold theme-text-tertiary uppercase tracking-wider mb-3">Open feedback</h3>
                  <div className="space-y-3">
                    <div>
                      <label className={labelClass}>What worked / what they liked</label>
                      <textarea rows={2} className={inputClass} value={form.whatLikedMost} onChange={(e) => setForm({ ...form, whatLikedMost: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelClass}>What didn't work / what to improve</label>
                      <textarea rows={3} className={inputClass} value={form.whatCouldImprove} onChange={(e) => setForm({ ...form, whatCouldImprove: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelClass}>Suggestions / additional comments</label>
                      <textarea rows={2} className={inputClass} value={form.additionalComments} onChange={(e) => setForm({ ...form, additionalComments: e.target.value })} />
                    </div>
                  </div>
                </section>

                {/* Eligibility / HR */}
                <section className="theme-bg-secondary rounded-2xl border theme-border-primary p-4">
                  <h3 className="text-xs font-semibold theme-text-tertiary uppercase tracking-wider mb-3">Eligibility &amp; HR</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className={labelClass}>Rehire eligible?</label>
                      <select className={inputClass}
                        value={form.rehireEligible === null ? "" : form.rehireEligible ? "yes" : "no"}
                        onChange={(e) => setForm({ ...form, rehireEligible: e.target.value === "" ? null : e.target.value === "yes" })}
                      >
                        <option value="">—</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Severance paid?</label>
                      <select className={inputClass}
                        value={form.severancePaid === null ? "" : form.severancePaid ? "yes" : "no"}
                        onChange={(e) => setForm({ ...form, severancePaid: e.target.value === "" ? null : e.target.value === "yes" })}
                      >
                        <option value="">—</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Final paycheck date</label>
                      <input type="date" className={inputClass} value={form.finalPaycheckDate} onChange={(e) => setForm({ ...form, finalPaycheckDate: e.target.value })} />
                    </div>
                    <div className="sm:col-span-3">
                      <label className={labelClass}>HR notes (internal)</label>
                      <textarea rows={2} className={inputClass} value={form.hrNotes} onChange={(e) => setForm({ ...form, hrNotes: e.target.value })} />
                    </div>
                  </div>
                </section>

                {/* Interviewer notes */}
                <section>
                  <label className={labelClass}>Interviewer notes</label>
                  <textarea rows={3} className={inputClass} value={form.interviewerNotes} onChange={(e) => setForm({ ...form, interviewerNotes: e.target.value })} />
                </section>
              </div>

              <div className="px-6 py-3 border-t theme-border-primary flex justify-end gap-2">
                <button onClick={() => { setConductId(null); setForm(EMPTY_FORM); }}
                  className="px-4 py-2 text-sm font-medium rounded-full theme-bg-secondary theme-text-primary theme-bg-hover">
                  Cancel
                </button>
                {conductingInterview.status !== "completed" && (
                  <button onClick={handleComplete} disabled={busy}
                    className="px-5 py-2 text-sm font-medium rounded-full bg-[#007AFF] hover:bg-[#0063CC] text-white shadow-sm disabled:opacity-50">
                    {busy ? "Saving…" : "Save & mark complete"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Reverse modal */}
        {reverseId && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="theme-bg-card rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
              <div className="px-6 py-4 border-b theme-border-primary">
                <h2 className="text-lg font-semibold theme-text-primary">Reverse termination</h2>
                <p className="text-xs theme-text-tertiary mt-0.5">
                  Flips the personnel record back to active and cancels the auto-scheduled exit interview. Requires a reason.
                </p>
              </div>
              <div className="px-6 py-5 space-y-3">
                <label className={labelClass}>Reason for reversal</label>
                <textarea rows={4} className={inputClass} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} placeholder="e.g., manager called too early, employee asked to be reinstated, mistake" />
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => { setReverseId(null); setReverseReason(""); }} className="px-4 py-2 text-sm font-medium rounded-full theme-bg-secondary theme-text-primary theme-bg-hover">Cancel</button>
                  <button onClick={handleReverse} disabled={busy || !reverseReason.trim()}
                    className="px-5 py-2 text-sm font-medium rounded-full bg-red-600 hover:bg-red-700 text-white shadow-sm disabled:opacity-50">
                    {busy ? "Reversing…" : "Reverse termination"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function ExitInterviewsPage() {
  return (
    <Protected minTier={4}>
      <ExitInterviewsContent />
    </Protected>
  );
}
