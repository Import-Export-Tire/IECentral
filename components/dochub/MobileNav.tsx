"use client";

import { useDocHub } from "./DocHubContext";
import type { RailSelection } from "./types";

const ITEMS: { key: RailSelection; label: string }[] = [
  { key: "mine", label: "Mine" },
  { key: "shared", label: "Shared" },
  { key: "company", label: "Company" },
  { key: "recent", label: "Recent" },
];

export default function MobileNav() {
  const { isDark, isAdmin, railSelection, setRailSelection, navigateToRoot, setShowUploadModal, setShowManageDrawer } = useDocHub();

  return (
    <>
      {/* Section selector — horizontal scroll, below md only */}
      <div className={`md:hidden flex-shrink-0 border-b overflow-x-auto ${isDark ? "border-slate-700/50 bg-slate-900/40" : "border-gray-200 bg-gray-50/60"}`}>
        <div className="flex items-center gap-1 px-3 py-2 min-w-max">
          {ITEMS.map(item => {
            const active = railSelection === item.key;
            return (
              <button
                key={item.key}
                onClick={() => { navigateToRoot(); setRailSelection(item.key); }}
                className={`px-3 py-1.5 text-sm font-medium rounded-full whitespace-nowrap transition-colors ${
                  active
                    ? isDark ? "bg-cyan-500 text-white" : "bg-blue-600 text-white"
                    : isDark ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {item.label}
              </button>
            );
          })}
          {isAdmin && (
            <button
              onClick={() => setShowManageDrawer(true)}
              className={`px-3 py-1.5 text-sm font-medium rounded-full whitespace-nowrap transition-colors ml-1 ${isDark ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-100"}`}
            >
              Manage
            </button>
          )}
        </div>
      </div>

      {/* Floating Upload button — below md only */}
      <button
        onClick={() => setShowUploadModal(true)}
        className={`md:hidden fixed bottom-5 right-5 z-30 w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-colors ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
        aria-label="Upload document"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </>
  );
}
