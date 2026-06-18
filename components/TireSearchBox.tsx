"use client";
// Type-ahead picker for the tire-label printer. The user searches the catalog by
// what's on the sidewall (brand / size / model) and clicks a match — no manual
// field entry. onSelect fills the row (itemId + brand + model + size).
import { useState, useEffect, useRef } from "react";

export interface TireSearchResult {
  itemId: string;
  brand: string;
  model: string;
  sizeDesc: string;
  mpn: string;
}

export default function TireSearchBox({
  isDark,
  onSelect,
}: {
  isDark: boolean;
  onSelect: (r: TireSearchResult) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TireSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/reports/tire-search?q=${encodeURIComponent(q.trim())}`);
        const data = await res.json();
        setResults(data.results || []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={boxRef} className="relative">
      <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
        Find tire (no tag? search by brand, size, or model)
      </label>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => { if (results.length) setOpen(true); }}
        placeholder="e.g. 245/40R18 Falken Ziex"
        className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-800 border-slate-600 text-white placeholder-slate-500" : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
      />
      {open && (
        <div className={`absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-lg border shadow-xl ${isDark ? "bg-slate-800 border-slate-600" : "bg-white border-gray-200"}`}>
          {loading && results.length === 0 ? (
            <div className={`px-4 py-3 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Searching…</div>
          ) : results.length === 0 ? (
            <div className={`px-4 py-3 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>No matches — try the size (e.g. 245/40R18) or brand.</div>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.itemId}-${i}`}
                onClick={() => { onSelect(r); setQ(""); setResults([]); setOpen(false); }}
                className={`block w-full text-left px-4 py-2 border-b last:border-b-0 ${isDark ? "border-slate-700 hover:bg-slate-700/60" : "border-gray-100 hover:bg-gray-50"}`}
              >
                <div className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{r.brand}{r.model ? ` ${r.model}` : ""}</div>
                <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{r.sizeDesc}{r.itemId ? ` · ${r.itemId}` : ""}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
