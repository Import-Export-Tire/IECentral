"use client";

import { useState, useEffect } from "react";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import Link from "next/link";

interface FileInfo { key: string; size: number; lastModified: string; hour?: number }
interface SourceStatus { files: FileInfo[]; complete: boolean; partial: boolean }
interface SourceDef { type: string; label: string; frequency: string }

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

export default function UploadStatusPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<SourceDef[]>([]);
  const [statusByDate, setStatusByDate] = useState<Record<string, Record<string, SourceStatus>>>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [viewMonth, setViewMonth] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });

  useEffect(() => {
    fetch("/api/reports/upload-status")
      .then((r) => r.json())
      .then((data) => {
        setSources(data.sources || []);
        setStatusByDate(data.statusByDate || {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const days = getDaysInMonth(viewMonth.year, viewMonth.month);
  const firstDayOfWeek = days[0].getDay();
  const monthName = new Date(viewMonth.year, viewMonth.month).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const prevMonth = () => setViewMonth((v) => v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 });
  const nextMonth = () => setViewMonth((v) => v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 });

  const selectedStatus = selectedDate ? statusByDate[selectedDate] : null;

  return (
    <Protected>
      <div className="flex h-screen theme-bg-primary">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <MobileHeader />

          <header className={`sticky top-0 z-10 border-b px-6 py-4 ${isDark ? "bg-slate-900/95 backdrop-blur border-slate-700" : "bg-white/95 backdrop-blur border-gray-200"}`}>
            <div className="flex items-center gap-3">
              <Link href="/reports/upload" className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-gray-200 text-gray-500"}`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
              </Link>
              <div>
                <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Upload Status</h1>
                <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Data availability calendar — green = uploaded, red = missing</p>
              </div>
            </div>
          </header>

          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
            {loading ? (
              <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Calendar */}
                <div className={`lg:col-span-2 rounded-xl border p-5 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
                  {/* Month nav */}
                  <div className="flex items-center justify-between mb-4">
                    <button onClick={prevMonth} className={`p-1.5 rounded-lg ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-200 text-gray-500"}`}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <h2 className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>{monthName}</h2>
                    <button onClick={nextMonth} className={`p-1.5 rounded-lg ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-200 text-gray-500"}`}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </button>
                  </div>

                  {/* Day headers */}
                  <div className="grid grid-cols-7 gap-1 mb-1">
                    {DAYS.map((d) => (
                      <div key={d} className={`text-center text-[10px] font-medium py-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>{d}</div>
                    ))}
                  </div>

                  {/* Calendar grid */}
                  <div className="grid grid-cols-7 gap-1">
                    {/* Empty cells for first week offset */}
                    {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                      <div key={`empty-${i}`} className="aspect-square" />
                    ))}

                    {days.map((day) => {
                      const dateStr = day.toISOString().split("T")[0];
                      const dayStatus = statusByDate[dateStr];
                      const isSelected = selectedDate === dateStr;
                      const isToday = dateStr === new Date().toISOString().split("T")[0];
                      const isFuture = day > new Date();
                      const isSunday = day.getDay() === 0;
                      const isSaturday = day.getDay() === 6;
                      const isWeekend = isSunday || isSaturday;

                      // Sunday inherits Saturday's status (no reports on Sunday)
                      const satDate = isSunday ? new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1).toISOString().split("T")[0] : null;
                      const effectiveStatus = isSunday ? statusByDate[satDate!] : dayStatus;

                      // Determine overall status for the day
                      let hasAny = false;
                      let hasAll = true;
                      let hasPartial = false;
                      if (isSunday) {
                        // Sunday is green if Saturday has data
                        const satHasData = effectiveStatus && Object.values(effectiveStatus).some((s: any) => s?.complete || s?.partial);
                        hasAny = !!satHasData;
                        hasAll = !!satHasData;
                      } else {
                        for (const source of sources) {
                          const s = dayStatus?.[source.type];
                          if (s?.complete) hasAny = true;
                          else if (s?.partial) { hasAny = true; hasPartial = true; hasAll = false; }
                          else if (!isFuture && !isWeekend) hasAll = false;
                        }
                        if (!hasAny) hasAll = false;
                      }

                      return (
                        <button
                          key={dateStr}
                          onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                          className={`aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 text-xs transition-all ${
                            isSelected ? isDark ? "ring-2 ring-cyan-500 bg-slate-700" : "ring-2 ring-blue-400 bg-blue-50" :
                            isDark ? "hover:bg-slate-700/50" : "hover:bg-gray-50"
                          } ${isFuture ? "opacity-30" : ""}`}
                        >
                          <span className={`text-[11px] font-medium ${isToday ? isDark ? "text-cyan-400" : "text-blue-600" : isDark ? "text-slate-300" : "text-gray-700"}`}>
                            {day.getDate()}
                          </span>
                          {!isFuture && !isSunday && !isSaturday && (
                            <div className="flex gap-0.5">
                              {sources.map((source) => {
                                const s = dayStatus?.[source.type];
                                const color = s?.complete ? "bg-emerald-500" : s?.partial ? "bg-amber-500" : "bg-red-500";
                                return (
                                  <div key={source.type} className={`w-1.5 h-1.5 rounded-full ${hasAny ? color : isDark ? "bg-slate-600" : "bg-gray-300"}`}
                                    title={`${source.label}: ${s?.complete ? "Complete" : s?.partial ? "Partial" : "Missing"}`} />
                                );
                              })}
                            </div>
                          )}
                          {!isFuture && isSaturday && (
                            <div className="flex gap-0.5">
                              {sources.map((source) => {
                                const s = dayStatus?.[source.type];
                                const color = s?.complete ? "bg-emerald-500" : s?.partial ? "bg-amber-500" : "bg-red-500";
                                return (
                                  <div key={source.type} className={`w-1.5 h-1.5 rounded-full ${hasAny ? color : isDark ? "bg-slate-600" : "bg-gray-300"}`}
                                    title={`${source.label}: ${s?.complete ? "Complete" : s?.partial ? "Partial" : "Missing"}`} />
                                );
                              })}
                            </div>
                          )}
                          {!isFuture && isSunday && hasAny && (
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="No reports on Sunday" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Legend */}
                  <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-slate-700/50">
                    {[
                      { color: "bg-emerald-500", label: "Complete" },
                      { color: "bg-amber-500", label: "Partial" },
                      { color: "bg-red-500", label: "Missing" },
                    ].map(({ color, label }) => (
                      <div key={label} className="flex items-center gap-1.5">
                        <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
                        <span className={`text-[10px] ${isDark ? "text-slate-400" : "text-gray-500"}`}>{label}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-1.5 ml-2">
                      {sources.map((s) => (
                        <span key={s.type} className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? "bg-slate-700 text-slate-400" : "bg-gray-100 text-gray-500"}`}>{s.label}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Day detail panel */}
                <div className={`rounded-xl border p-5 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
                  {selectedDate ? (
                    <>
                      <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>
                        {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                      </h3>
                      <div className="space-y-3">
                        {sources.map((source) => {
                          const s = selectedStatus?.[source.type];
                          return (
                            <div key={source.type} className={`p-3 rounded-lg ${isDark ? "bg-slate-900/50" : "bg-gray-50"}`}>
                              <div className="flex items-center justify-between mb-1">
                                <span className={`text-xs font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{source.label}</span>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                  s?.complete ? "bg-emerald-500/20 text-emerald-400" :
                                  s?.partial ? "bg-amber-500/20 text-amber-400" :
                                  "bg-red-500/20 text-red-400"
                                }`}>
                                  {s?.complete ? "Complete" : s?.partial ? "Partial" : "Missing"}
                                </span>
                              </div>
                              {s?.files.length ? (
                                <div className="space-y-1">
                                  {source.frequency === "hourly" ? (
                                    <>
                                      {/* Hour grid */}
                                      <div className="grid grid-cols-6 sm:grid-cols-12 gap-0.5 mt-1">
                                        {Array.from({ length: 24 }).map((_, h) => {
                                          const hasFile = s.files.some((f) => f.hour === h);
                                          return (
                                            <div key={h} className={`text-center rounded py-0.5 text-[8px] font-mono ${
                                              hasFile
                                                ? isDark ? "bg-emerald-500/30 text-emerald-400" : "bg-emerald-100 text-emerald-700"
                                                : isDark ? "bg-slate-800 text-slate-600" : "bg-gray-100 text-gray-400"
                                            }`} title={`${String(h).padStart(2, "0")}:00 — ${hasFile ? "uploaded" : "missing"}`}>
                                              {String(h).padStart(2, "0")}
                                            </div>
                                          );
                                        })}
                                      </div>
                                      <div className={`text-[10px] mt-1 ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                                        {s.files.length} of 24 hours covered
                                      </div>
                                    </>
                                  ) : (
                                    s.files.map((f, i) => (
                                      <div key={i} className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                                        {f.key.split("/").pop()} — {(f.size / 1024).toFixed(0)}KB
                                      </div>
                                    ))
                                  )}
                                </div>
                              ) : (
                                <p className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>No data uploaded</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div className={`text-center py-8 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      <p className="text-sm">Click a day to see details</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </Protected>
  );
}
