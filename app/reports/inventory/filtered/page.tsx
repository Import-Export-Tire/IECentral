"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import { useAuth } from "@/app/auth-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { LOCATION_LABELS, locationLabel } from "@/lib/locationLabels";
import { tireSortKey } from "@/lib/tireSize";
import { isReportableBrand } from "@/lib/brandFilter";
import { tireSizeMatchesQuery } from "@/lib/tireSearch";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeader from "@/components/ui/SectionHeader";

interface InventoryItem {
  location: string;
  manufacturerName: string;
  itemId: string;
  description: string;
  model?: string;
  qtyOnHand: number;
  qtyCommitted: number;
  qtyAvailable: number;
}

function ymKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function priorYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function ymLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m) - 1]} ${y}`;
}

// Safety cap on the adjustments log query. Well above any realistic
// per-location history, but keeps a runaway table from blowing Convex's
// per-query bandwidth limit. The UI warns when the cap is reached.
const ADJ_LOG_CAP = 5000;

type AdjRange = "thisMonth" | "lastMonth" | "last90" | "all";

const ADJ_RANGE_LABELS: Record<AdjRange, string> = {
  thisMonth: "This Month",
  lastMonth: "Last Month",
  last90: "Last 90 Days",
  all: "All Time",
};

function brandAbbr(brand: string): string {
  return brand.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
}

function formatReportDateMMDDYY(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  return `${m[2]}/${m[3]}/${m[1].slice(2)}`;
}

export default function FilteredInventoryReportPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();

  const [tab, setTab] = useState<"report" | "adjustments" | "coverage">("report");
  const [location, setLocation] = useState("");
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);

  // Adjustments state
  const [adjItemId, setAdjItemId] = useState("");
  const [adjQty, setAdjQty] = useState("");
  const [adjNotes, setAdjNotes] = useState("");
  const [adjSaving, setAdjSaving] = useState(false);
  const [adjError, setAdjError] = useState("");
  const [adjGenerating, setAdjGenerating] = useState(false);
  const [adjExporting, setAdjExporting] = useState(false);

  // Adjustments log filters
  const [adjSearch, setAdjSearch] = useState("");
  const [adjRange, setAdjRange] = useState<AdjRange>("thisMonth");
  const [adjPage, setAdjPage] = useState(0);
  // 0 = show all rows on one page.
  const [adjPageSize, setAdjPageSize] = useState(50);

  const addAdjustment = useMutation(api.inventoryAdjustments.add);
  const removeAdjustment = useMutation(api.inventoryAdjustments.remove);

  // Date-range bounds (ms since epoch). thisMonth/lastMonth use calendar month.
  // Declared before the log query because the query is bounded by `start`.
  const adjRangeBounds = useMemo(() => {
    const now = new Date();
    const startOfMonth = (y: number, m: number) => new Date(y, m, 1).getTime();
    if (adjRange === "thisMonth") {
      return { start: startOfMonth(now.getFullYear(), now.getMonth()), end: Infinity };
    }
    if (adjRange === "lastMonth") {
      return { start: startOfMonth(now.getFullYear(), now.getMonth() - 1), end: startOfMonth(now.getFullYear(), now.getMonth()) };
    }
    if (adjRange === "last90") {
      return { start: now.getTime() - 90 * 86_400_000, end: Infinity };
    }
    return { start: 0, end: Infinity };
  }, [adjRange]);

  // Log display: bounded server-side by the selected date range rather than
  // by a fixed tail, so every adjustment in range is visible. ADJ_LOG_CAP is
  // only a backstop against Convex's per-query bandwidth limit; hitting it is
  // surfaced in the UI so nothing is silently dropped.
  const adjustments = useQuery(
    api.inventoryAdjustments.listByLocation,
    location
      ? { locationCode: location, since: adjRangeBounds.start, limit: ADJ_LOG_CAP }
      : "skip"
  );
  // Stats aggregation: bounded by date (~6 months) instead of count so
  // MoM / repeat-month / consecutive-month metrics stay accurate.
  const statsSince = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const adjustmentsForStats = useQuery(
    api.inventoryAdjustments.listByLocationSince,
    location ? { locationCode: location, since: statsSince } : "skip"
  );

  const logCirRun = useMutation(api.cirReportRuns.logRun);

  // Coverage tab state — rolling window (last N days) so counts that straddle the
  // month boundary stay visible while a count cycle is still in progress.
  const [coverageDays, setCoverageDays] = useState(45);
  const coverageWindowStart = useMemo(() => Date.now() - coverageDays * 86_400_000, [coverageDays]);
  const cirRunsInWindow = useQuery(api.cirReportRuns.listSince, { since: coverageWindowStart });
  const [coverageBrands, setCoverageBrands] = useState<Record<string, string[]>>({});
  const [coverageLoading, setCoverageLoading] = useState(false);

  const latestUpload = useQuery(api.jmkUploads.getLatestByType, { reportType: "oeival" });
  const reportDate = latestUpload?.reportDate ?? null;
  const uploadedAt = latestUpload?.createdAt ?? null;
  const uploadedAtLabel = uploadedAt
    ? new Date(uploadedAt).toLocaleString(undefined, { month: "2-digit", day: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;

  useEffect(() => {
    if (!location) {
      setItems([]);
      setSelectedBrands(new Set());
      return;
    }
    setLoading(true);
    setError("");
    // CIR audits what's *available* to sell at a location, so we only
    // need rows with positive on-hand quantity.
    const params = new URLSearchParams({ location, inStock: "1" });
    fetch(`/api/reports/inventory-data?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return; }
        setItems(data.items || []);
        setSelectedBrands(new Set());
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [location]);

  const brandsAtLocation = useMemo(() => {
    return [...new Set(items.map((i) => i.manufacturerName).filter(isReportableBrand))].sort();
  }, [items]);

  // Item lookup map keyed by itemId — used to autofill the adjustment entry form.
  const itemLookup = useMemo(() => {
    const m = new Map<string, InventoryItem>();
    for (const i of items) if (i.itemId) m.set(i.itemId.trim().toUpperCase(), i);
    return m;
  }, [items]);

  const adjLookupMatch = useMemo(() => {
    const key = adjItemId.trim().toUpperCase();
    return key ? itemLookup.get(key) : undefined;
  }, [adjItemId, itemLookup]);

  // The query is lower-bounded server-side by `since`, but ranges like
  // "last month" also have an upper bound — apply it here so the row
  // counter's denominator reflects the range, not just the fetch.
  const adjInRange = useMemo(() => {
    return (adjustments ?? []).filter(
      (a) => a.createdAt >= adjRangeBounds.start && a.createdAt < adjRangeBounds.end
    );
  }, [adjustments, adjRangeBounds]);

  // Then narrow by the search box.
  const filteredAdjustments = useMemo(() => {
    const q = adjSearch.trim().toLowerCase();
    if (!q) return adjInRange;
    return adjInRange.filter((a) => {
      const hay = `${a.itemId} ${a.manufacturerName ?? ""} ${a.description ?? ""} ${a.notes ?? ""}`.toLowerCase();
      return hay.includes(q) || tireSizeMatchesQuery(a.description, adjSearch);
    });
  }, [adjInRange, adjSearch]);

  // Reset page on filter change.
  useEffect(() => { setAdjPage(0); }, [adjSearch, adjRange, adjPageSize]);

  // adjPageSize of 0 means "All" — collapse to a single page.
  const adjEffectivePageSize = adjPageSize > 0 ? adjPageSize : Math.max(1, filteredAdjustments.length);
  const adjTotalPages = Math.max(1, Math.ceil(filteredAdjustments.length / adjEffectivePageSize));
  const adjPaged = useMemo(
    () => filteredAdjustments.slice(adjPage * adjEffectivePageSize, (adjPage + 1) * adjEffectivePageSize),
    [filteredAdjustments, adjPage, adjEffectivePageSize]
  );
  const adjCapped = (adjustments?.length ?? 0) >= ADJ_LOG_CAP;

  // Aggregate stats over the location's adjustments — MoM count, per-item MoM,
  // repeat flags. Uses the date-bounded query so the underlying row count
  // stays well below Convex limits regardless of log size.
  const adjStats = useMemo(() => {
    const list = adjustmentsForStats ?? [];
    const nowYm = ymKey(Date.now());
    const lastYm = priorYm(nowYm);

    const countByYm = new Map<string, number>();
    const netByItemByYm = new Map<string, Map<string, number>>(); // itemId → ym → net
    const monthsByItem = new Map<string, Set<string>>();           // itemId → set of yms
    const itemMeta = new Map<string, { manufacturerName: string; description: string }>();

    for (const a of list) {
      const ym = ymKey(a.createdAt);
      countByYm.set(ym, (countByYm.get(ym) || 0) + 1);
      const inner = netByItemByYm.get(a.itemId) || new Map<string, number>();
      inner.set(ym, (inner.get(ym) || 0) + a.qtyChange);
      netByItemByYm.set(a.itemId, inner);
      const set = monthsByItem.get(a.itemId) || new Set<string>();
      set.add(ym);
      monthsByItem.set(a.itemId, set);
      if (!itemMeta.has(a.itemId)) {
        itemMeta.set(a.itemId, {
          manufacturerName: a.manufacturerName || "",
          description: a.description || "",
        });
      }
    }

    // Items adjusted ≥2 times in the current month
    const currentMonthByItemCount = new Map<string, number>();
    for (const a of list) {
      if (ymKey(a.createdAt) === nowYm) {
        currentMonthByItemCount.set(a.itemId, (currentMonthByItemCount.get(a.itemId) || 0) + 1);
      }
    }
    const repeatedThisMonth: { itemId: string; count: number; meta: { manufacturerName: string; description: string } }[] = [];
    for (const [itemId, count] of currentMonthByItemCount) {
      if (count >= 2) repeatedThisMonth.push({ itemId, count, meta: itemMeta.get(itemId) || { manufacturerName: "", description: "" } });
    }

    // Items adjusted in 2+ consecutive months
    const consecutiveMultiMonth: { itemId: string; months: string[]; meta: { manufacturerName: string; description: string } }[] = [];
    for (const [itemId, set] of monthsByItem) {
      const sorted = [...set].sort();
      let runStart = -1;
      let bestRun: string[] = [];
      for (let i = 0; i < sorted.length; i++) {
        if (i === 0 || priorYm(sorted[i]) === sorted[i - 1]) {
          if (runStart === -1) runStart = i;
          if (i - runStart + 1 > bestRun.length) bestRun = sorted.slice(runStart, i + 1);
        } else {
          runStart = i;
        }
      }
      if (bestRun.length >= 2) consecutiveMultiMonth.push({ itemId, months: bestRun, meta: itemMeta.get(itemId) || { manufacturerName: "", description: "" } });
    }

    // Per-item MoM net qty (current vs prior month)
    const perItemMoM: { itemId: string; meta: { manufacturerName: string; description: string }; current: number; prior: number }[] = [];
    for (const [itemId, perYm] of netByItemByYm) {
      const cur = perYm.get(nowYm) || 0;
      const pri = perYm.get(lastYm) || 0;
      if (cur !== 0 || pri !== 0) {
        perItemMoM.push({ itemId, meta: itemMeta.get(itemId) || { manufacturerName: "", description: "" }, current: cur, prior: pri });
      }
    }
    perItemMoM.sort((a, b) => Math.abs(b.current - b.prior) - Math.abs(a.current - a.prior));

    return {
      currentYm: nowYm,
      priorYm: lastYm,
      currentCount: countByYm.get(nowYm) || 0,
      priorCount: countByYm.get(lastYm) || 0,
      totalCount: list.length,
      repeatedThisMonth: repeatedThisMonth.sort((a, b) => b.count - a.count),
      consecutiveMultiMonth,
      perItemMoM,
      countByYm: [...countByYm.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [adjustmentsForStats]);

  const toggleBrand = useCallback((brand: string) => {
    setSelectedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(brand)) next.delete(brand); else next.add(brand);
      return next;
    });
  }, []);

  const selectAllBrands = useCallback(() => setSelectedBrands(new Set(brandsAtLocation)), [brandsAtLocation]);
  const clearBrands = useCallback(() => setSelectedBrands(new Set()), []);

  const filteredRows = useMemo(() => {
    if (!location || selectedBrands.size === 0) return [];
    const rows = items.filter((i) => selectedBrands.has(i.manufacturerName));
    rows.sort((a, b) => {
      const brandCmp = a.manufacturerName.localeCompare(b.manufacturerName);
      if (brandCmp !== 0) return brandCmp;
      const ka = tireSortKey(a.description);
      const kb = tireSortKey(b.description);
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] !== kb[i]) return ka[i] - kb[i];
      }
      return a.description.localeCompare(b.description);
    });
    return rows;
  }, [items, location, selectedBrands]);

  const handleAddAdjustment = useCallback(async () => {
    if (!location) return;
    setAdjError("");
    const itemIdTrim = adjItemId.trim();
    const qtyNum = Number(adjQty);
    if (!itemIdTrim) { setAdjError("Item ID is required"); return; }
    if (!Number.isFinite(qtyNum) || qtyNum === 0) { setAdjError("Qty change must be a non-zero number (use - for negative)"); return; }
    let manufacturerName = adjLookupMatch?.manufacturerName;
    let description = adjLookupMatch?.description;
    if (!manufacturerName) {
      try {
        const res = await fetch(`/api/reports/resolve-brand?itemId=${encodeURIComponent(adjItemId.trim())}`);
        const data = await res.json();
        if (data?.found) { manufacturerName = data.manufacturerName; description = description || data.description; }
      } catch { /* best-effort; save without brand if resolver unavailable */ }
    }
    setAdjSaving(true);
    try {
      await addAdjustment({
        locationCode: location,
        itemId: itemIdTrim,
        manufacturerName,
        description,
        qtyChange: qtyNum,
        notes: adjNotes.trim() || undefined,
        enteredBy: user?._id,
        enteredByName: user?.name || "Unknown",
      });
      setAdjItemId(""); setAdjQty(""); setAdjNotes("");
    } catch (err) {
      setAdjError(err instanceof Error ? err.message : "Failed to add adjustment");
    } finally {
      setAdjSaving(false);
    }
  }, [location, adjItemId, adjQty, adjNotes, adjLookupMatch, user, addAdjustment]);

  const handleDeleteAdjustment = useCallback(async (id: string) => {
    if (!confirm("Delete this adjustment?")) return;
    await removeAdjustment({ id: id as any });
  }, [removeAdjustment]);

  // Newest-first rows for both exports. Driven by the on-screen filter so a
  // print/export always matches what the user is looking at.
  const adjExportRows = useMemo(
    () => [...filteredAdjustments].sort((a, b) => b.createdAt - a.createdAt),
    [filteredAdjustments]
  );

  // Shared naming for both exports.
  const adjExportMeta = useCallback(() => {
    const storeName = locationLabel(location);
    const fullStore = `${location} - ${storeName}`;
    const now = new Date();
    const ranDate = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${String(now.getFullYear()).slice(2)}`;
    const ranTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const rangeLabel = ADJ_RANGE_LABELS[adjRange];
    const fileSlug = `${location}_${storeName.replace(/[^A-Za-z0-9]+/g, "_")}`;
    return { storeName, fullStore, ranDate, ranTime, rangeLabel, fileSlug };
  }, [location, adjRange]);

  const handleExportAdjustmentsExcel = useCallback(async () => {
    if (!location || adjExportRows.length === 0) return;
    setAdjExporting(true);
    try {
      const XLSX = await import("xlsx");
      const { fullStore, ranDate, rangeLabel, fileSlug } = adjExportMeta();
      const wb = XLSX.utils.book_new();

      // Sheet 1 — the log itself, matching the on-screen filter.
      // Qty stays a real number so Excel can sum/filter on it.
      const logSheet = XLSX.utils.aoa_to_sheet([
        [`${fullStore} — Inventory Adjustments (${rangeLabel})`],
        [`Ran: ${ranDate}`, `${adjExportRows.length} record${adjExportRows.length === 1 ? "" : "s"}`],
        [],
        ["Date", "Item ID", "Mfg", "Description", "Qty", "Notes", "Entered By"],
        ...adjExportRows.map((a) => [
          new Date(a.createdAt).toLocaleString(undefined, { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
          a.itemId,
          a.manufacturerName || "",
          a.description || "",
          a.qtyChange,
          a.notes || "",
          a.enteredByName,
        ]),
      ]);
      logSheet["!cols"] = [{ wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 38 }, { wch: 8 }, { wch: 30 }, { wch: 20 }];
      // Autofilter over the header row (row 4) + data. Freeze panes aren't
      // supported by the community xlsx build, so this is the useful knob.
      logSheet["!autofilter"] = { ref: `A4:G${4 + adjExportRows.length}` };
      XLSX.utils.book_append_sheet(wb, logSheet, "Adjustments");

      // Sheet 2 — monthly activity. Sourced from the 6-month stats query, so
      // its scope is fixed regardless of the log filter; labeled as such.
      const monthlySheet = XLSX.utils.aoa_to_sheet([
        ["Monthly Activity (last 6 months)"],
        [],
        ["Month", "Adjustments"],
        ...adjStats.countByYm.map(([ym, n]) => [ymLabel(ym), n]),
      ]);
      monthlySheet["!cols"] = [{ wch: 16 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, monthlySheet, "Monthly Activity");

      // Sheet 3 — per-item month-over-month net qty.
      if (adjStats.perItemMoM.length > 0) {
        const momSheet = XLSX.utils.aoa_to_sheet([
          [`Per-Item MoM — ${ymLabel(adjStats.priorYm)} vs ${ymLabel(adjStats.currentYm)}`],
          [],
          ["Item ID", "Mfg", "Description", ymLabel(adjStats.priorYm), ymLabel(adjStats.currentYm), "Delta"],
          ...adjStats.perItemMoM.map((r) => [
            r.itemId, r.meta.manufacturerName, r.meta.description, r.prior, r.current, r.current - r.prior,
          ]),
        ]);
        momSheet["!cols"] = [{ wch: 16 }, { wch: 16 }, { wch: 38 }, { wch: 12 }, { wch: 12 }, { wch: 10 }];
        XLSX.utils.book_append_sheet(wb, momSheet, "Per-Item MoM");
      }

      // Sheet 4 — the two review flags, stacked on one sheet.
      if (adjStats.repeatedThisMonth.length > 0 || adjStats.consecutiveMultiMonth.length > 0) {
        const flagRows: (string | number)[][] = [["Repeated this month (2+ entries)"], [], ["Item ID", "Mfg", "Description", "Count"]];
        for (const r of adjStats.repeatedThisMonth) {
          flagRows.push([r.itemId, r.meta.manufacturerName, r.meta.description, r.count]);
        }
        if (adjStats.repeatedThisMonth.length === 0) flagRows.push(["None"]);
        flagRows.push([], ["Consecutive months (same item 2+ months in a row)"], [], ["Item ID", "Mfg", "Description", "Months"]);
        for (const r of adjStats.consecutiveMultiMonth) {
          flagRows.push([r.itemId, r.meta.manufacturerName, r.meta.description, r.months.map(ymLabel).join(", ")]);
        }
        if (adjStats.consecutiveMultiMonth.length === 0) flagRows.push(["None"]);
        const flagSheet = XLSX.utils.aoa_to_sheet(flagRows);
        flagSheet["!cols"] = [{ wch: 16 }, { wch: 16 }, { wch: 38 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(wb, flagSheet, "Flags");
      }

      XLSX.writeFile(wb, `${fileSlug}_adjustments_${ranDate.replace(/\//g, "")}.xlsx`);
    } catch (err) {
      setAdjError(err instanceof Error ? err.message : "Excel export failed");
    } finally {
      setAdjExporting(false);
    }
  }, [location, adjExportRows, adjExportMeta, adjStats]);

  const handleGenerateAdjustmentsPDF = useCallback(async () => {
    if (!location || adjExportRows.length === 0) return;
    setAdjGenerating(true);
    try {
      const { jsPDF } = await import("jspdf");
      const autoTableModule = await import("jspdf-autotable");
      const autoTable = (autoTableModule.default || autoTableModule) as typeof import("jspdf-autotable").default;

      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      const { fullStore, ranDate, ranTime, rangeLabel, fileSlug } = adjExportMeta();
      const title = `${fullStore} - Inventory Adjustments (${rangeLabel})`;
      const ranStr = `Ran: ${ranDate} ${ranTime} — ${adjExportRows.length} record${adjExportRows.length === 1 ? "" : "s"}`;
      const footerLeft = `${fullStore} Adjustments - ${ranDate}`;

      const drawHeaderFooter = () => {
        doc.setFontSize(11); doc.setFont("helvetica", "bold");
        doc.text(title, pageWidth / 2, 36, { align: "center" });
        doc.setFontSize(9); doc.setFont("helvetica", "normal");
        doc.text(ranStr, pageWidth / 2, 52, { align: "center" });
        doc.text(footerLeft, 36, pageHeight - 24);
      };

      // Section 1 — chronological log over the selected range (newest first)
      const logBody = adjExportRows.map((a) => [
        new Date(a.createdAt).toLocaleString(undefined, { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
        a.itemId,
        a.manufacturerName || "",
        a.description || "",
        (a.qtyChange > 0 ? "+" : "") + String(a.qtyChange),
        a.notes || "",
        a.enteredByName,
      ]);

      autoTable(doc, {
        head: [["Date", "Item ID", "Mfg", "Description", "Qty", "Notes", "By"]],
        body: logBody,
        startY: 72,
        margin: { top: 72, bottom: 50, left: 36, right: 36 },
        styles: { fontSize: 9, cellPadding: 4, overflow: "linebreak" },
        headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold", halign: "center" },
        columnStyles: {
          0: { cellWidth: 70 },
          1: { cellWidth: 75 },
          2: { cellWidth: 65 },
          3: { cellWidth: 140 },
          4: { halign: "center", cellWidth: 35 },
          5: { cellWidth: 90 },
          6: { cellWidth: 65 },
        },
        didDrawPage: drawHeaderFooter,
      });

      // Section 2 — monthly counts
      doc.addPage();
      drawHeaderFooter();
      doc.setFontSize(13); doc.setFont("helvetica", "bold");
      doc.text("Monthly Activity (last 6 months)", 36, 80);
      autoTable(doc, {
        head: [["Month", "Adjustments"]],
        body: adjStats.countByYm.map(([ym, n]) => [ymLabel(ym), String(n)]),
        startY: 90,
        margin: { top: 72, left: 36, right: 36, bottom: 50 },
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold", halign: "center" },
        columnStyles: { 1: { halign: "center" } },
        didDrawPage: drawHeaderFooter,
      });

      // Section 3 — per-item MoM
      if (adjStats.perItemMoM.length > 0) {
        const yAfter = (doc as any).lastAutoTable?.finalY ?? 100;
        doc.setFontSize(13); doc.setFont("helvetica", "bold");
        doc.text(`Per-Item MoM (${ymLabel(adjStats.priorYm)} vs ${ymLabel(adjStats.currentYm)})`, 36, yAfter + 28);
        autoTable(doc, {
          head: [["Item ID", "Mfg", "Description", ymLabel(adjStats.priorYm), ymLabel(adjStats.currentYm), "Δ"]],
          body: adjStats.perItemMoM.map((r) => [
            r.itemId, r.meta.manufacturerName, r.meta.description,
            (r.prior > 0 ? "+" : "") + String(r.prior),
            (r.current > 0 ? "+" : "") + String(r.current),
            ((r.current - r.prior) > 0 ? "+" : "") + String(r.current - r.prior),
          ]),
          startY: yAfter + 36,
          margin: { top: 72, left: 36, right: 36, bottom: 50 },
          styles: { fontSize: 9, cellPadding: 4 },
          headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold", halign: "center" },
          columnStyles: { 3: { halign: "center" }, 4: { halign: "center" }, 5: { halign: "center", fontStyle: "bold" } },
          didDrawPage: drawHeaderFooter,
        });
      }

      // Section 4 — flags
      if (adjStats.repeatedThisMonth.length > 0 || adjStats.consecutiveMultiMonth.length > 0) {
        doc.addPage();
        drawHeaderFooter();
        doc.setFontSize(13); doc.setFont("helvetica", "bold");
        doc.text("Repeated this month (≥ 2 entries)", 36, 80);
        if (adjStats.repeatedThisMonth.length > 0) {
          autoTable(doc, {
            head: [["Item ID", "Mfg", "Description", "Count"]],
            body: adjStats.repeatedThisMonth.map((r) => [r.itemId, r.meta.manufacturerName, r.meta.description, String(r.count)]),
            startY: 90,
            margin: { top: 72, left: 36, right: 36, bottom: 50 },
            styles: { fontSize: 9, cellPadding: 4 },
            headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold", halign: "center" },
            columnStyles: { 3: { halign: "center" } },
            didDrawPage: drawHeaderFooter,
          });
        } else {
          doc.setFontSize(9); doc.setFont("helvetica", "italic");
          doc.text("No repeats this month.", 36, 110);
        }

        const yAfter2 = (doc as any).lastAutoTable?.finalY ?? 130;
        doc.setFontSize(13); doc.setFont("helvetica", "bold");
        doc.text("Consecutive months (same item ≥ 2 months in a row)", 36, yAfter2 + 28);
        if (adjStats.consecutiveMultiMonth.length > 0) {
          autoTable(doc, {
            head: [["Item ID", "Mfg", "Description", "Months"]],
            body: adjStats.consecutiveMultiMonth.map((r) => [r.itemId, r.meta.manufacturerName, r.meta.description, r.months.map(ymLabel).join(", ")]),
            startY: yAfter2 + 36,
            margin: { top: 72, left: 36, right: 36, bottom: 50 },
            styles: { fontSize: 9, cellPadding: 4 },
            headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold", halign: "center" },
            didDrawPage: drawHeaderFooter,
          });
        }
      }

      // Final pass: page numbers everywhere
      const total = doc.getNumberOfPages();
      for (let i = 1; i <= total; i++) {
        doc.setPage(i);
        doc.setFontSize(9); doc.setFont("helvetica", "normal");
        doc.text(`Page ${i} of ${total}`, pageWidth - 36, pageHeight - 24, { align: "right" });
      }

      doc.save(`${fileSlug}_adjustments_${ranDate.replace(/\//g,"")}.pdf`);
    } catch (err) {
      setAdjError(err instanceof Error ? err.message : "PDF generation failed");
    } finally {
      setAdjGenerating(false);
    }
  }, [location, adjExportRows, adjExportMeta, adjStats]);

  const handleGenerate = useCallback(async () => {
    if (filteredRows.length === 0) return;
    setGenerating(true);
    try {
      const { jsPDF } = await import("jspdf");
      const autoTableModule = await import("jspdf-autotable");
      const autoTable = (autoTableModule.default || autoTableModule) as typeof import("jspdf-autotable").default;

      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      const storeName = locationLabel(location);
      const sortedBrands = [...selectedBrands].sort();
      const abbrs = sortedBrands.map(brandAbbr).join("/");
      const title = `${storeName} - Inventory (${abbrs})`;
      const dateStr = formatReportDateMMDDYY(reportDate);
      const now = new Date();
      const ranDate = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${String(now.getFullYear()).slice(2)}`;
      const ranTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const ranStr = `Ran: ${ranDate} ${ranTime}`;
      const footerLeft = `${storeName} Filtered - ${dateStr}`;

      const head = [["Manufacturer", "Item ID", "Description", "Qty On Hand", "Qty Committed", "Qty Available"]];
      const body = filteredRows.map((r) => [
        r.manufacturerName,
        r.itemId,
        r.description,
        String(r.qtyOnHand),
        String(r.qtyCommitted),
        String(r.qtyAvailable),
      ]);

      autoTable(doc, {
        head,
        body,
        startY: 72,
        margin: { top: 72, bottom: 50, left: 36, right: 36 },
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold", halign: "center" },
        columnStyles: {
          0: { cellWidth: 80 },
          1: { cellWidth: 80 },
          2: { cellWidth: 200 },
          3: { halign: "center", cellWidth: 60 },
          4: { halign: "center", cellWidth: 60 },
          5: { halign: "center", cellWidth: 60 },
        },
        didDrawPage: () => {
          doc.setFontSize(11);
          doc.setFont("helvetica", "bold");
          doc.text(title, pageWidth / 2, 36, { align: "center" });
          doc.setFontSize(9);
          doc.setFont("helvetica", "normal");
          doc.text(ranStr, pageWidth / 2, 52, { align: "center" });
          doc.text(footerLeft, 36, pageHeight - 24);
        },
      });

      const total = doc.getNumberOfPages();
      for (let i = 1; i <= total; i++) {
        doc.setPage(i);
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.text(`Page ${i} of ${total}`, pageWidth - 36, pageHeight - 24, { align: "right" });
      }

      const fileSlug = storeName.replace(/[^A-Za-z0-9]+/g, "_");
      const fileDate = dateStr.replace(/\//g, "");
      const fileName = `${fileSlug}_filtered_${fileDate || "snapshot"}.pdf`;

      // Build the PDF as a blob first so we can both download AND upload it.
      const pdfBlob = doc.output("blob");

      // Trigger browser download.
      const downloadUrl = URL.createObjectURL(pdfBlob);
      const a = document.createElement("a");
      a.href = downloadUrl; a.download = fileName; a.click();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

      // Best-effort: archive to S3 + log to Convex with the s3Key for Coverage.
      let archivedKey: string | undefined;
      try {
        const urlRes = await fetch("/api/reports/cir/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locationCode: location, snapshotDate: reportDate || undefined }),
        });
        const { url, key } = await urlRes.json();
        if (url) {
          const putRes = await fetch(url, { method: "PUT", body: pdfBlob, headers: { "Content-Type": "application/pdf" } });
          if (putRes.ok) archivedKey = key;
        }
      } catch { /* archiving is best-effort */ }

      try {
        await logCirRun({
          locationCode: location,
          brands: sortedBrands,
          generatedBy: user?._id,
          generatedByName: user?.name || "Unknown",
          s3Key: archivedKey,
          rowCount: filteredRows.length,
        });
      } catch { /* coverage logging is best-effort */ }
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF generation failed");
    } finally {
      setGenerating(false);
    }
  }, [filteredRows, location, selectedBrands, reportDate, logCirRun, user]);

  // Fetch brand list per location when Coverage tab is shown.
  useEffect(() => {
    if (tab !== "coverage") return;
    if (Object.keys(coverageBrands).length > 0) return;
    setCoverageLoading(true);
    Promise.all(
      Object.keys(LOCATION_LABELS).map(async (code) => {
        try {
          const res = await fetch(`/api/reports/inventory-data?location=${code}&inStock=1`);
          const data = await res.json();
          const brands = [...new Set(((data.items as InventoryItem[]) || []).map((i) => i.manufacturerName).filter(isReportableBrand))].sort();
          return [code, brands] as const;
        } catch { return [code, [] as string[]] as const; }
      })
    ).then((entries) => {
      setCoverageBrands(Object.fromEntries(entries));
    }).finally(() => setCoverageLoading(false));
  }, [tab, coverageBrands]);

  // Aggregate CIR runs by location/brand for the selected month.
  const coverageByLocation = useMemo(() => {
    const result: Record<string, { brand: string; pulledOn: number[] }[]> = {};
    const runs = cirRunsInWindow || [];
    for (const code of Object.keys(LOCATION_LABELS)) {
      const allBrands = coverageBrands[code] || [];
      const locRuns = runs.filter((r) => r.locationCode === code);
      const pulledMap = new Map<string, number[]>();
      for (const r of locRuns) {
        for (const b of r.brands) {
          const arr = pulledMap.get(b) || [];
          arr.push(r.createdAt);
          pulledMap.set(b, arr);
        }
      }
      const known = allBrands.length > 0 ? allBrands : [...pulledMap.keys()].sort();
      result[code] = known.map((b) => ({ brand: b, pulledOn: pulledMap.get(b) || [] }));
    }
    return result;
  }, [cirRunsInWindow, coverageBrands]);

  // Past CIR PDFs (with s3Key) for the selected month, grouped by location.
  const archivedRunsByLocation = useMemo(() => {
    const out: Record<string, typeof cirRunsInWindow extends (infer T)[] | undefined ? T[] : any[]> = {};
    for (const r of (cirRunsInWindow || [])) {
      if (!r.s3Key) continue;
      (out[r.locationCode] = out[r.locationCode] || []).push(r);
    }
    return out;
  }, [cirRunsInWindow]);

  const handleMarkCovered = useCallback(async (code: string, brand: string) => {
    try {
      await logCirRun({
        locationCode: code,
        brands: [brand],
        generatedBy: user?._id,
        generatedByName: `${user?.name || "Unknown"} (manual)`,
      });
    } catch { /* best-effort */ }
  }, [logCirRun, user]);

  const handleDownloadArchived = useCallback(async (s3Key: string) => {
    try {
      const res = await fetch(`/api/reports/cir/download-url?key=${encodeURIComponent(s3Key)}`);
      const data = await res.json();
      if (data.url) window.open(data.url, "_blank");
    } catch { /* ignore */ }
  }, []);

  const locationOptions = useMemo(() => Object.keys(LOCATION_LABELS).sort(), []);

  return (
    <Protected>
      <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <MobileHeader />

          {/* Sticky iOS-style page header */}
          <header className={`sticky top-0 z-10 border-b px-4 sm:px-6 py-3 sm:py-4 backdrop-blur-sm ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
            <div className="flex items-center gap-3">
              <Link
                href="/reports/inventory"
                className="p-2 rounded-lg transition-colors theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5 flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <div className="min-w-0">
                <h1 className="text-xl font-bold theme-text-primary">Filtered Inventory Report</h1>
                <p className="text-xs mt-0.5 theme-text-tertiary">
                  {reportDate
                    ? `Snapshot date: ${formatReportDateMMDDYY(reportDate)}`
                    : "No OEAVAL 77 upload found — upload one to set the snapshot date"}
                  {uploadedAtLabel && (
                    <span className="ml-2">· Last uploaded: {uploadedAtLabel}</span>
                  )}
                </p>
              </div>
            </div>
          </header>

          <div className="px-4 sm:px-6 py-5 max-w-3xl space-y-4">

            {/* Error banner */}
            {error && (
              <Card tone="red" padding="sm">
                <p className="text-sm theme-text-primary">{error}</p>
              </Card>
            )}

            {/* Location picker */}
            <Card padding="sm">
              <label className="block ui-section-label mb-2">Location</label>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="theme-input w-full px-3 py-2 text-sm"
              >
                <option value="">— Select a location —</option>
                {locationOptions.map((code) => (
                  <option key={code} value={code}>{code} — {LOCATION_LABELS[code]}</option>
                ))}
              </select>
            </Card>

            {/* Tab strip */}
            <div className="flex gap-1">
              {(["report", "adjustments", "coverage"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    tab === t
                      ? isDark
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                        : "bg-emerald-100 text-emerald-700 border border-emerald-300"
                      : "theme-text-tertiary hover:theme-text-secondary hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  {t === "report" ? "Generate Report" : t === "adjustments" ? "Adjustments" : "Coverage"}
                </button>
              ))}
            </div>

            {/* Brand picker */}
            {tab === "report" && location && (
              <Card padding="sm">
                <SectionHeader
                  label={`Brands (${selectedBrands.size} selected)`}
                  actions={
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={selectAllBrands}
                        disabled={brandsAtLocation.length === 0}
                      >
                        Select all
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearBrands}
                        disabled={selectedBrands.size === 0}
                      >
                        Clear
                      </Button>
                    </div>
                  }
                />
                {loading ? (
                  <p className="text-xs py-3 theme-text-tertiary">Loading inventory...</p>
                ) : brandsAtLocation.length === 0 ? (
                  <p className="text-xs py-3 theme-text-tertiary">No items at this location.</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-72 overflow-y-auto">
                    {brandsAtLocation.map((brand) => {
                      const checked = selectedBrands.has(brand);
                      return (
                        <label
                          key={brand}
                          className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs theme-text-secondary hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <input type="checkbox" checked={checked} onChange={() => toggleBrand(brand)} className="rounded w-3.5 h-3.5" />
                          <span className="truncate">{brand}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </Card>
            )}

            {/* Generate */}
            {tab === "report" && location && selectedBrands.size > 0 && (
              <Card padding="sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium theme-text-primary">
                      {filteredRows.length.toLocaleString()} items will appear in the report
                    </p>
                    <p className="text-xs mt-0.5 theme-text-tertiary">
                      {locationLabel(location)} — {[...selectedBrands].sort().map(brandAbbr).join("/")}
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    onClick={handleGenerate}
                    disabled={generating || filteredRows.length === 0}
                  >
                    {generating ? "Generating..." : "Generate PDF"}
                  </Button>
                </div>
              </Card>
            )}

            {/* Adjustments tab — no location selected */}
            {tab === "adjustments" && !location && (
              <Card padding="sm">
                <p className="text-sm theme-text-tertiary">Pick a location above to log inventory adjustments.</p>
              </Card>
            )}

            {tab === "adjustments" && location && (
              <>
                {/* Entry form */}
                <Card padding="sm">
                  <SectionHeader title={`Log adjustment — ${location} · ${locationLabel(location)}`} />
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3" onKeyDown={(e) => {
                    // Press Enter from any input in the entry form to add the
                    // adjustment, mirroring the click on Add.
                    if (e.key !== "Enter") return;
                    if (adjSaving || !adjItemId.trim() || !adjQty) return;
                    e.preventDefault();
                    handleAddAdjustment();
                  }}>
                    <div className="sm:col-span-3">
                      <label className="block text-[10px] uppercase tracking-wide mb-1 theme-text-tertiary">Item ID</label>
                      <input
                        type="text"
                        value={adjItemId}
                        onChange={(e) => setAdjItemId(e.target.value)}
                        placeholder="e.g. 4076ATL"
                        className="theme-input w-full px-3 py-2 text-sm font-mono"
                      />
                    </div>
                    <div className="sm:col-span-5">
                      <label className="block text-[10px] uppercase tracking-wide mb-1 theme-text-tertiary">Item details (autofilled)</label>
                      <div className="theme-input px-3 py-2 text-sm h-[38px] bg-black/[0.03] dark:bg-white/[0.03]">
                        {adjItemId.trim() === "" ? (
                          <span className="theme-text-tertiary">—</span>
                        ) : adjLookupMatch ? (
                          <span className="truncate block theme-text-secondary">{adjLookupMatch.manufacturerName} · {adjLookupMatch.description}</span>
                        ) : loading ? (
                          <span className="theme-text-tertiary">loading inventory…</span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">not in current inventory snapshot</span>
                        )}
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] uppercase tracking-wide mb-1 theme-text-tertiary">Qty (+/−)</label>
                      <input
                        type="number"
                        value={adjQty}
                        onChange={(e) => setAdjQty(e.target.value)}
                        placeholder="-2 or 4"
                        className="theme-input w-full px-3 py-2 text-sm text-right font-mono"
                      />
                    </div>
                    <div className="sm:col-span-2 flex items-end">
                      <Button
                        variant="primary"
                        onClick={handleAddAdjustment}
                        disabled={adjSaving || !adjItemId.trim() || !adjQty}
                        className="w-full"
                      >
                        {adjSaving ? "Saving…" : "Add"}
                      </Button>
                    </div>
                    <div className="sm:col-span-12">
                      <label className="block text-[10px] uppercase tracking-wide mb-1 theme-text-tertiary">Notes (optional)</label>
                      <input
                        type="text"
                        value={adjNotes}
                        onChange={(e) => setAdjNotes(e.target.value)}
                        placeholder="e.g. damaged, recount, inter-store transfer"
                        className="theme-input w-full px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                  {adjError && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">{adjError}</p>
                  )}
                </Card>

                {/* Stats panel */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { label: ymLabel(adjStats.priorYm), value: adjStats.priorCount },
                    { label: ymLabel(adjStats.currentYm), value: adjStats.currentCount },
                    { label: "Total", value: adjStats.totalCount },
                  ].map((s) => (
                    <Card key={s.label} padding="sm">
                      <div className="ui-section-label">{s.label}</div>
                      <div className="text-2xl font-bold mt-1 theme-text-primary">{s.value}</div>
                    </Card>
                  ))}
                </div>

                {/* Recent log + filters + Print */}
                <div className="theme-card overflow-hidden p-0">
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b theme-border-secondary">
                    <h2 className="text-sm font-semibold theme-text-primary">Adjustment log</h2>
                    <input
                      type="text"
                      value={adjSearch}
                      onChange={(e) => setAdjSearch(e.target.value)}
                      placeholder="Search item ID, description, notes…"
                      className="theme-input flex-1 min-w-[180px] px-3 py-1.5 text-xs"
                    />
                    <select
                      value={adjRange}
                      onChange={(e) => setAdjRange(e.target.value as any)}
                      className="theme-input px-2 py-1.5 text-xs"
                    >
                      <option value="thisMonth">This month</option>
                      <option value="lastMonth">Last month</option>
                      <option value="last90">Last 90 days</option>
                      <option value="all">All time</option>
                    </select>
                    <span className="text-xs theme-text-tertiary">
                      {filteredAdjustments.length} of {adjInRange.length} in range
                      {adjCapped ? ` (capped at ${ADJ_LOG_CAP} — narrow the range)` : ""}
                    </span>
                    <button
                      onClick={handleGenerateAdjustmentsPDF}
                      disabled={adjGenerating || adjExportRows.length === 0}
                      title="Export the rows matching the current filter as a PDF"
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 bg-purple-500/20 text-purple-700 dark:text-purple-400 hover:bg-purple-500/30 transition-colors"
                    >
                      {adjGenerating ? "Generating…" : "Print PDF"}
                    </button>
                    <button
                      onClick={handleExportAdjustmentsExcel}
                      disabled={adjExporting || adjExportRows.length === 0}
                      title="Export the rows matching the current filter as an Excel workbook"
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                    >
                      {adjExporting ? "Exporting…" : "Export Excel"}
                    </button>
                  </div>
                  {!adjustments ? (
                    <p className="p-4 text-sm theme-text-tertiary">Loading…</p>
                  ) : adjInRange.length === 0 ? (
                    // The query is scoped to the selected range, so an empty
                    // result means "none in range", not "none ever".
                    <p className="p-4 text-sm theme-text-tertiary">
                      No adjustments for this location in {ADJ_RANGE_LABELS[adjRange].toLowerCase()}
                      {adjRange !== "all" ? " — try widening the date range." : "."}
                    </p>
                  ) : filteredAdjustments.length === 0 ? (
                    <p className="p-4 text-sm theme-text-tertiary">No adjustments match the current filter.</p>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className={`${isDark ? "bg-slate-800" : "bg-gray-50"}`}>
                            <tr>
                              {["Date", "Item ID", "Mfg", "Description", "Qty", "Notes", "By", ""].map((h) => (
                                <th key={h} className="text-left px-3 py-2 font-semibold theme-text-tertiary">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {adjPaged.map((a) => (
                              <tr key={a._id} className="border-t theme-border-secondary">
                                <td className="px-3 py-2 theme-text-tertiary">{new Date(a.createdAt).toLocaleString(undefined, { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                                <td className="px-3 py-2 font-mono theme-text-secondary">{a.itemId}</td>
                                <td className="px-3 py-2 theme-text-secondary">{a.manufacturerName || "—"}</td>
                                <td className="px-3 py-2 theme-text-secondary">{a.description || "—"}</td>
                                {/* data-driven: color depends on sign of qty, not just dark mode */}
                                <td className={`px-3 py-2 text-right font-mono font-semibold ${a.qtyChange > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{a.qtyChange > 0 ? "+" : ""}{a.qtyChange}</td>
                                <td className="px-3 py-2 theme-text-tertiary">{a.notes || ""}</td>
                                <td className="px-3 py-2 theme-text-tertiary">{a.enteredByName}</td>
                                <td className="px-3 py-2 text-right">
                                  <button
                                    onClick={() => handleDeleteAdjustment(a._id)}
                                    className="text-[10px] px-2 py-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex items-center justify-between px-4 py-3 border-t theme-border-secondary">
                        <span className="text-xs theme-text-tertiary">
                          Showing {adjPage * adjEffectivePageSize + 1}–{Math.min((adjPage + 1) * adjEffectivePageSize, filteredAdjustments.length)} of {filteredAdjustments.length}
                        </span>
                        <div className="flex items-center gap-2">
                          <select
                            value={adjPageSize}
                            onChange={(e) => setAdjPageSize(Number(e.target.value))}
                            className="theme-input px-2 py-1 text-xs"
                          >
                            {[25, 50, 100, 250, 500].map((s) => <option key={s} value={s}>{s}/page</option>)}
                            <option value={0}>All</option>
                          </select>
                          <Button variant="ghost" size="sm" disabled={adjPage === 0} onClick={() => setAdjPage((p) => p - 1)}>Prev</Button>
                          <span className="text-xs theme-text-tertiary">{adjPage + 1}/{adjTotalPages}</span>
                          <Button variant="ghost" size="sm" disabled={adjPage >= adjTotalPages - 1} onClick={() => setAdjPage((p) => p + 1)}>Next</Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Per-item MoM */}
                {adjStats.perItemMoM.length > 0 && (
                  <div className="theme-card overflow-hidden p-0">
                    <div className="px-4 py-2 border-b theme-border-secondary">
                      <h2 className="text-xs font-semibold theme-text-primary">
                        Per-item MoM ({ymLabel(adjStats.priorYm)} → {ymLabel(adjStats.currentYm)})
                      </h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead className={`${isDark ? "bg-slate-800" : "bg-gray-50"}`}>
                          <tr>
                            <th className="text-left px-2 py-1 font-semibold theme-text-tertiary">Item ID</th>
                            <th className="text-left px-2 py-1 font-semibold theme-text-tertiary">Mfg</th>
                            <th className="text-left px-2 py-1 font-semibold theme-text-tertiary">Description</th>
                            <th className="text-right px-2 py-1 font-semibold theme-text-tertiary">{ymLabel(adjStats.priorYm)}</th>
                            <th className="text-right px-2 py-1 font-semibold theme-text-tertiary">{ymLabel(adjStats.currentYm)}</th>
                            <th className="text-right px-2 py-1 font-semibold theme-text-tertiary">Δ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adjStats.perItemMoM.map((r) => (
                            <tr key={r.itemId} className="border-t theme-border-secondary">
                              <td className="px-2 py-0.5 font-mono theme-text-secondary">{r.itemId}</td>
                              <td className="px-2 py-0.5 theme-text-secondary">{r.meta.manufacturerName}</td>
                              <td className="px-2 py-0.5 theme-text-secondary">{r.meta.description}</td>
                              <td className="px-2 py-0.5 text-right font-mono theme-text-tertiary">{r.prior > 0 ? "+" : ""}{r.prior}</td>
                              <td className="px-2 py-0.5 text-right font-mono theme-text-tertiary">{r.current > 0 ? "+" : ""}{r.current}</td>
                              {/* data-driven: delta color depends on sign */}
                              <td className={`px-2 py-0.5 text-right font-mono font-bold ${(r.current - r.prior) > 0 ? "text-emerald-600 dark:text-emerald-400" : (r.current - r.prior) < 0 ? "text-red-600 dark:text-red-400" : "theme-text-tertiary"}`}>{(r.current - r.prior) > 0 ? "+" : ""}{r.current - r.prior}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Repeat flags */}
                {(adjStats.repeatedThisMonth.length > 0 || adjStats.consecutiveMultiMonth.length > 0) && (
                  <Card tone="amber" padding="sm">
                    <h2 className="text-sm font-semibold mb-2 text-amber-800 dark:text-amber-300">Flags</h2>
                    {adjStats.repeatedThisMonth.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-medium mb-1 text-amber-800 dark:text-amber-300">Adjusted ≥ 2× this month:</p>
                        <ul className="text-xs space-y-0.5 text-amber-900 dark:text-amber-200">
                          {adjStats.repeatedThisMonth.map((r) => (
                            <li key={r.itemId}>
                              <span className="font-mono">{r.itemId}</span> — {r.meta.manufacturerName} {r.meta.description} <span className="font-bold">({r.count}×)</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {adjStats.consecutiveMultiMonth.length > 0 && (
                      <div>
                        <p className="text-xs font-medium mb-1 text-amber-800 dark:text-amber-300">Adjusted in consecutive months:</p>
                        <ul className="text-xs space-y-0.5 text-amber-900 dark:text-amber-200">
                          {adjStats.consecutiveMultiMonth.map((r) => (
                            <li key={r.itemId}>
                              <span className="font-mono">{r.itemId}</span> — {r.meta.manufacturerName} {r.meta.description} <span className="font-bold">({r.months.map(ymLabel).join(", ")})</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </Card>
                )}
              </>
            )}

            {/* Coverage tab */}
            {tab === "coverage" && (
              <div className="space-y-4">
                <Card padding="sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="ui-section-label">Window:</label>
                    <div className="flex gap-1">
                      {[30, 45, 60, 90].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setCoverageDays(d)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                            coverageDays === d
                              ? "bg-[#007AFF]/15 text-[#007AFF] border-[#007AFF]/30"
                              : isDark
                                ? "bg-slate-900 text-slate-400 border-slate-600 hover:bg-slate-800"
                                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          {d}d
                        </button>
                      ))}
                    </div>
                    <span className="text-[11px] theme-text-tertiary">counts in the last {coverageDays} days</span>
                    <span className="ml-auto text-xs theme-text-tertiary">
                      {coverageLoading ? "Loading inventory…" : `${(cirRunsInWindow ?? []).length} CIR run(s)`}
                    </span>
                  </div>
                </Card>

                {coverageLoading && Object.keys(coverageBrands).length === 0 ? (
                  <Card padding="sm">
                    <p className="text-sm text-center theme-text-tertiary">Loading brand inventory across all locations…</p>
                  </Card>
                ) : (
                  (location ? [location] : Object.keys(LOCATION_LABELS).sort()).map((code) => {
                    const rows = coverageByLocation[code] || [];
                    const total = rows.length;
                    const covered = rows.filter((r) => r.pulledOn.length > 0).length;
                    return (
                      <div key={code} className="theme-card overflow-hidden p-0">
                        <div className="flex items-center justify-between px-4 py-3 border-b theme-border-secondary">
                          <h3 className="text-sm font-semibold theme-text-primary">
                            {code} · {LOCATION_LABELS[code]}
                          </h3>
                          <span className={`text-xs font-medium ${covered === total && total > 0 ? "text-emerald-600 dark:text-emerald-400" : "theme-text-tertiary"}`}>
                            {covered} / {total} covered
                          </span>
                        </div>
                        {total === 0 ? (
                          <p className="p-4 text-xs theme-text-tertiary">No brands found in this location.</p>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1 p-2">
                            {rows.map((r) => {
                              const pulled = r.pulledOn.length > 0;
                              const lastPulled = pulled ? new Date(Math.max(...r.pulledOn)) : null;
                              return (
                                <div
                                  key={r.brand}
                                  className={`group flex items-center justify-between px-2 py-1 rounded text-[11px] border ${
                                    pulled
                                      ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30"
                                      : isDark
                                        ? "bg-slate-900/40 border-slate-700"
                                        : "bg-gray-50 border-gray-200"
                                  }`}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className={pulled ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400 dark:text-slate-600"}>
                                      {pulled ? "✓" : "○"}
                                    </span>
                                    <span className={`truncate ${pulled ? "text-emerald-800 dark:text-emerald-300" : "theme-text-tertiary"}`}>{r.brand}</span>
                                  </div>
                                  {pulled && lastPulled ? (
                                    <span className="text-[10px] ml-2 flex-shrink-0 theme-text-tertiary">
                                      {`${lastPulled.getMonth()+1}/${lastPulled.getDate()}`}{r.pulledOn.length > 1 ? ` ×${r.pulledOn.length}` : ""}
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleMarkCovered(code, r.brand)}
                                      className="text-[10px] ml-2 flex-shrink-0 px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-[#007AFF]/15 text-[#007AFF] hover:bg-[#007AFF]/25"
                                    >
                                      Mark
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {(archivedRunsByLocation[code] || []).length > 0 && (
                          <div className="px-4 py-3 border-t theme-border-secondary text-xs">
                            <p className="ui-section-label mb-1.5">Past CIR PDFs ({(archivedRunsByLocation[code] || []).length})</p>
                            <div className="flex flex-wrap gap-1.5">
                              {(archivedRunsByLocation[code] || []).map((r: any) => {
                                const d = new Date(r.createdAt);
                                const label = `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
                                const abbrs = [...r.brands].sort().map(brandAbbr).join("/");
                                return (
                                  <button
                                    key={r._id}
                                    type="button"
                                    onClick={() => handleDownloadArchived(r.s3Key)}
                                    className="px-2 py-1 rounded text-[11px] border theme-card theme-text-secondary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                                    title={`${abbrs} — ${r.generatedByName}`}
                                  >
                                    {label} · {abbrs.length > 25 ? abbrs.slice(0, 22) + "…" : abbrs}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </Protected>
  );
}
