"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRouter } from "next/navigation";
import { useTheme } from "@/app/theme-context";
import { useAuth } from "@/app/auth-context";
import { usePermissions } from "@/lib/usePermissions";

interface SearchResult {
  type: "project" | "personnel" | "application" | "equipment" | "user" | "document" | "announcement" | "location" | "tire";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  icon: string;
  category: string;
}

const typeColors: Record<string, { bg: string; text: string }> = {
  project: { bg: "bg-cyan-500/20", text: "text-cyan-400" },
  personnel: { bg: "bg-green-500/20", text: "text-green-400" },
  application: { bg: "bg-purple-500/20", text: "text-purple-400" },
  equipment: { bg: "bg-orange-500/20", text: "text-orange-400" },
  user: { bg: "bg-blue-500/20", text: "text-blue-400" },
  document: { bg: "bg-slate-500/20", text: "text-slate-400" },
  announcement: { bg: "bg-pink-500/20", text: "text-pink-400" },
  location: { bg: "bg-teal-500/20", text: "text-teal-400" },
  tire: { bg: "bg-amber-500/20", text: "text-amber-400" },
};

const typeIcons: Record<string, React.ReactNode> = {
  folder: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  ),
  user: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  document: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  device: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
  users: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
};

// Custom event for opening search
export const openGlobalSearch = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("openGlobalSearch"));
  }
};

// Standalone search button component
export function SearchButton({ className = "" }: { className?: string }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      onClick={openGlobalSearch}
      className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
        isDark
          ? "text-slate-400 bg-slate-800/50 border-slate-700 hover:border-slate-600 hover:text-slate-300"
          : "text-gray-600 bg-white border-gray-300 hover:border-gray-400 hover:text-gray-900"
      } ${className}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <span className="hidden sm:inline">Search...</span>
      <kbd className={`hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded ${
        isDark ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-600"
      }`}>
        <span className="text-xs">⌘</span>K
      </kbd>
    </button>
  );
}

export default function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const { user } = useAuth();
  const { menu } = usePermissions();

  // Debounce so we don't scan on every keystroke.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const searchResults = useQuery(
    api.search.globalSearch,
    debounced.length >= 2 && user ? { requestingUserId: user._id, searchQuery: debounced } : "skip",
  );
  const dbResults = (searchResults?.results || []) as SearchResult[];

  // Tires live in S3 (not Convex) — merge client-side, only for reports-permissioned users.
  const [tireResults, setTireResults] = useState<SearchResult[]>([]);
  useEffect(() => {
    if (!menu.reports || debounced.length < 2) { setTireResults([]); return; }
    let cancelled = false;
    fetch(`/api/reports/tire-search?q=${encodeURIComponent(debounced)}`)
      .then((r) => r.json())
      .then((d: { results?: Array<{ itemId: string; brand: string; model: string; sizeDesc: string }> }) => {
        if (cancelled) return;
        setTireResults(
          (d.results || []).slice(0, 6).map((t) => ({
            type: "tire" as const,
            id: t.itemId,
            title: `${t.brand} ${t.model}`.trim() || t.itemId,
            subtitle: t.sizeDesc || t.itemId,
            href: `/reports/inventory/filtered?q=${encodeURIComponent(t.itemId)}`,
            icon: "device",
            category: "Tires",
          })),
        );
      })
      .catch(() => { if (!cancelled) setTireResults([]); });
    return () => { cancelled = true; };
  }, [debounced, menu.reports]);

  // Combined + grouped by category; keyboard nav indexes this ordered list.
  const CAT_ORDER = ["People", "Documents", "Tires", "Operations"];
  const results = [...dbResults, ...tireResults].sort(
    (a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category),
  );

  // Handle keyboard shortcut (Cmd+K / Ctrl+K) and custom event
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    const handleOpenEvent = () => setIsOpen(true);

    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("openGlobalSearch", handleOpenEvent);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("openGlobalSearch", handleOpenEvent);
    };
  }, []);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
    if (!isOpen) {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  const handleSelect = useCallback((result: SearchResult) => {
    router.push(result.href);
    setIsOpen(false);
  }, [router]);

  const handleKeyboardNavigation = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
        onClick={() => setIsOpen(false)}
      />

      {/* Modal */}
      <div className="fixed inset-x-4 top-[15%] sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-xl z-50">
        <div className={`rounded-xl shadow-2xl overflow-hidden border ${
          isDark ? "bg-slate-900 border-slate-700" : "bg-white border-gray-200"
        }`}>
          {/* Search Input */}
          <div className={`flex items-center gap-3 px-4 py-3 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
            <svg className={`w-5 h-5 ${isDark ? "text-slate-400" : "text-gray-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyboardNavigation}
              placeholder="Search documents, people, tires, equipment..."
              className={`flex-1 bg-transparent outline-none ${
                isDark ? "text-white placeholder-slate-500" : "text-gray-900 placeholder-gray-400"
              }`}
            />
            <kbd className={`px-1.5 py-0.5 text-xs rounded ${
              isDark ? "text-slate-500 bg-slate-800" : "text-gray-500 bg-gray-100"
            }`}>ESC</kbd>
          </div>

          {/* Results */}
          <div className="max-h-[60vh] overflow-y-auto">
            {query.length < 2 ? (
              <div className={`px-4 py-8 text-center text-sm ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                Type at least 2 characters to search
              </div>
            ) : results.length === 0 ? (
              <div className={`px-4 py-8 text-center text-sm ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                No results found for &quot;{query}&quot;
              </div>
            ) : (
              <div className="py-2">
                {results.map((result, index) => {
                  const colors = typeColors[result.type] || typeColors.project;
                  const icon = typeIcons[result.icon] || typeIcons.folder;
                  const isSelected = index === selectedIndex;
                  const showHeader = index === 0 || results[index - 1].category !== result.category;

                  return (
                    <div key={`${result.type}-${result.id}`}>
                      {showHeader && (
                        <div className={`px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                          {result.category}
                        </div>
                      )}
                      <button
                        onClick={() => handleSelect(result)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          isSelected
                            ? isDark ? "bg-cyan-500/10" : "bg-blue-50"
                            : isDark ? "hover:bg-slate-800/50" : "hover:bg-gray-50"
                        }`}
                      >
                        <div className={`flex-shrink-0 p-2 rounded-lg ${colors.bg} ${colors.text}`}>
                          {icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                            {result.title}
                          </div>
                          <div className={`text-xs truncate ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                            {result.subtitle}
                          </div>
                        </div>
                        <span className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-medium rounded ${colors.bg} ${colors.text}`}>
                          {result.type}
                        </span>
                      </button>
                    </div>
                  );
                })}
                {searchResults && searchResults.totalCount > dbResults.length && (
                  <div className={`px-4 py-2 text-xs text-center border-t ${
                    isDark ? "text-slate-500 border-slate-800" : "text-gray-500 border-gray-100"
                  }`}>
                    Showing top matches — refine your search to narrow down
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className={`flex items-center justify-between px-4 py-2 border-t text-xs ${
            isDark ? "border-slate-700 text-slate-500" : "border-gray-200 text-gray-500"
          }`}>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className={`px-1 py-0.5 rounded ${isDark ? "bg-slate-800" : "bg-gray-100"}`}>↑</kbd>
                <kbd className={`px-1 py-0.5 rounded ${isDark ? "bg-slate-800" : "bg-gray-100"}`}>↓</kbd>
                to navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className={`px-1 py-0.5 rounded ${isDark ? "bg-slate-800" : "bg-gray-100"}`}>↵</kbd>
                to select
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
