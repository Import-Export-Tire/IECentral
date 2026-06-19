"use client";

// Dashboard widget for the "See Something, Say Something" anonymous reporting inbox.
// Super-admin only — both this component's render guard (on the dashboard) and the
// underlying Convex `counts` query are gated to super_admin.
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/app/auth-context";
import { useTheme } from "@/app/theme-context";

export default function SafetyReportsWidget() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const counts = useQuery(
    api.safetyReports.counts,
    user ? { requestingUserId: user._id } : "skip",
  ) as { total: number; new: number; in_review: number } | undefined;

  const newCount = counts?.new ?? 0;
  const inReview = counts?.in_review ?? 0;
  const total = counts?.total ?? 0;

  return (
    <div className={`border rounded-xl p-4 sm:p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <div className="flex items-center gap-2">
          <h2 className={`text-base sm:text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
            Safety Reports
          </h2>
          {newCount > 0 && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
              {newCount} new
            </span>
          )}
        </div>
        <Link
          href="/safety-reports"
          className={`text-sm transition-colors ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}
        >
          View all
        </Link>
      </div>

      {counts === undefined ? (
        <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Loading…</p>
      ) : total === 0 ? (
        <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
          No reports yet. Anonymous “See Something, Say Something” reports will appear here.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <Link
            href="/safety-reports"
            className={`rounded-xl p-3 text-center transition-colors ${
              newCount > 0
                ? "bg-red-500/10 hover:bg-red-500/20"
                : isDark ? "bg-slate-700/40 hover:bg-slate-700/60" : "bg-gray-50 hover:bg-gray-100"
            }`}
          >
            <div className={`text-2xl font-bold ${newCount > 0 ? "text-red-500" : isDark ? "text-white" : "text-gray-900"}`}>{newCount}</div>
            <div className={`text-[11px] mt-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>New</div>
          </Link>
          <Link
            href="/safety-reports"
            className={`rounded-xl p-3 text-center transition-colors ${isDark ? "bg-slate-700/40 hover:bg-slate-700/60" : "bg-gray-50 hover:bg-gray-100"}`}
          >
            <div className={`text-2xl font-bold ${inReview > 0 ? "text-amber-500" : isDark ? "text-white" : "text-gray-900"}`}>{inReview}</div>
            <div className={`text-[11px] mt-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>In review</div>
          </Link>
          <Link
            href="/safety-reports"
            className={`rounded-xl p-3 text-center transition-colors ${isDark ? "bg-slate-700/40 hover:bg-slate-700/60" : "bg-gray-50 hover:bg-gray-100"}`}
          >
            <div className={`text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{total}</div>
            <div className={`text-[11px] mt-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Total</div>
          </Link>
        </div>
      )}
    </div>
  );
}
