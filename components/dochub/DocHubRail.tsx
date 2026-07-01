"use client";

import { useDocHub } from "./DocHubContext";
import type { RailSelection } from "./types";

type RailItem = { key: RailSelection; label: string; icon: string };

const RAIL_ITEMS: RailItem[] = [
  { key: "mine", label: "My Documents", icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" },
  { key: "shared", label: "Shared with me", icon: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2-5.24M5 8a3 3 0 002 5.24" },
  { key: "company", label: "Company", icon: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { key: "recent", label: "Recent", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
];

export default function DocHubRail() {
  const { isDark, isAdmin, railSelection, setRailSelection, navigateToRoot, setShowManageDrawer } = useDocHub();

  const select = (key: RailSelection) => {
    navigateToRoot();       // exit any open folder when switching sections
    setRailSelection(key);
  };

  return (
    <div className={`hidden md:flex w-56 flex-shrink-0 border-r flex-col h-full ${
      isDark ? "bg-slate-900/50 border-slate-700/50" : "bg-gray-50/80 border-gray-200"
    }`}>
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {RAIL_ITEMS.map(item => {
          const active = railSelection === item.key;
          return (
            <button
              key={item.key}
              onClick={() => select(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                active
                  ? isDark ? "bg-cyan-500/15 text-cyan-400" : "bg-blue-50 text-blue-700"
                  : isDark ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50" : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
              </svg>
              {item.label}
            </button>
          );
        })}
      </nav>

      {isAdmin && (
        <div className={`p-3 border-t ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
          <button
            onClick={() => setShowManageDrawer(true)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              isDark ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50" : "text-gray-500 hover:text-gray-800 hover:bg-gray-100"
            }`}
          >
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Manage
          </button>
        </div>
      )}
    </div>
  );
}
