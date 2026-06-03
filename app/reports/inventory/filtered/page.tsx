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

  // Adjustments log filters
  const [adjSearch, setAdjSearch] = useState("");
  const [adjRange, setAdjRange] = useState<"thisMonth" | "lastMonth" | "last90" | "all">("thisMonth");
  const [adjPage, setAdjPage] = useState(0);
  const [adjPageSize, setAdjPageSize] = useState(50);

  const addAdjustment = useMutation(api.inventoryAdjustments.add);
  const removeAdjustment = useMutation(api.inventoryAdjustments.remove);
  // Log display: cap at 50 most-recent to stay under Convex bandwidth
  // limits as a location's history grows.
  const adjustments = useQuery(
    api.inventoryAdjustments.listByLocation,
    location ? { locationCode: location, limit: 50 } : "skip"
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

  // Date-range bounds (ms since epoch). thisMonth/lastMonth use calendar month.
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

  // Filter and paginate the log.
  const filteredAdjustments = useMemo(() => {
    const list = adjustments ?? [];
    const q = adjSearch.trim().toLowerCase();
    return list.filter((a) => {
      if (a.createdAt < adjRangeBounds.start || a.createdAt >= adjRangeBounds.end) return false;
      if (q) {
        const hay = `${a.itemId} ${a.manufacturerName ?? ""} ${a.description ?? ""} ${a.notes ?? ""}`.toLowerCase();
        if (!hay.includes(q) && !tireSizeMatchesQuery(a.description, adjSearch)) return false;
      }
      return true;
    });
  }, [adjustments, adjSearch, adjRangeBounds]);

  // Reset page on filter change.
  useEffect(() => { setAdjPage(0); }, [adjSearch, adjRange, adjPageSize]);

  const adjTotalPages = Math.max(1, Math.ceil(filteredAdjustments.length / adjPageSize));
  const adjPaged = useMemo(() => filteredAdjustments.slice(adjPage * adjPageSize, (adjPage + 1) * adjPageSize), [filteredAdjustments, adjPage, adjPageSize]);

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

  const handleGenerateAdjustmentsPDF = useCallback(async () => {
    if (!location || !adjustmentsForStats || adjustmentsForStats.length === 0) return;
    setAdjGenerating(true);
    try {
      const { jsPDF } = await import("jspdf");
      const autoTableModule = await import("jspdf-autotable");
      const autoTable = (autoTableModule.default || autoTableModule) as typeof import("jspdf-autotable").default;

      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      const storeName = locationLabel(location);
      const fullStore = `${location} - ${storeName}`;
      const title = `${fullStore} - Inventory Adjustments (Last 6 Months)`;
      const now = new Date();
      const ranDate = `${String(now.getMonth()+1).padStart(2,"0")}/${String(now.getDate()).padStart(2,"0")}/${String(now.getFullYear()).slice(2)}`;
      const ranTime = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
      const ranStr = `Ran: ${ranDate} ${ranTime}`;
      const footerLeft = `${fullStore} Adjustments - ${ranDate}`;

      const drawHeaderFooter = () => {
        doc.setFontSize(11); doc.setFont("helvetica", "bold");
        doc.text(title, pageWidth / 2, 36, { align: "center" });
        doc.setFontSize(9); doc.setFont("helvetica", "normal");
        doc.text(ranStr, pageWidth / 2, 52, { align: "center" });
        doc.text(footerLeft, 36, pageHeight - 24);
      };

      // Section 1 — chronological log over the stats window (newest first)
      const sorted = [...adjustmentsForStats].sort((a, b) => b.createdAt - a.createdAt);
      const logBody = sorted.map((a) => [
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
      doc.text("Monthly Activity", 36, 80);
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

      const fileSlug = `${location}_${storeName.replace(/[^A-Za-z0-9]+/g, "_")}`;
      doc.save(`${fileSlug}_adjustments_${ranDate.replace(/\//g,"")}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF generation failed");
    } finally {
      setAdjGenerating(false);
    }
  }, [location, adjustmentsForStats, adjStats]);

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
      <div className="flex h-screen theme-bg-primary">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <MobileHeader />
          <header className={`sticky top-0 z-10 border-b px-4 sm:px-6 py-4 ${isDark ? "bg-slate-900/95 backdrop-blur border-slate-700" : "bg-white/95 backdrop-blur border-gray-200"}`}>
            <div className="flex items-center gap-3">
              <Link href="/reports/inventory" className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-gray-200 text-gray-500"}`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <div>
                <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Filtered Inventory Report</h1>
                <p className={`text-sm ${isDark ? "text-slate-200" : "text-gray-800"}`}>
                  {reportDate
                    ? `Snapshot date: ${formatReportDateMMDDYY(reportDate)}`
                    : "No OEAVAL 77 upload found — upload one to set the snapshot date"}
                  {uploadedAtLabel && (
                    <span className="ml-2">
                      · Last uploaded: {uploadedAtLabel}
                    </span>
                  )}
                </p>
              </div>
            </div>
          </header>

          <div className="px-4 sm:px-6 py-6 max-w-3xl space-y-5">
            {error && (
              <div className={`rounded-xl border p-4 ${isDark ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-red-50 border-red-200 text-red-700"}`}>
                {error}
              </div>
            )}

            {/* Location picker */}
            <div className={`rounded-xl border p-5 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
              <label className={`block text-xs font-medium mb-2 ${isDark ? "text-slate-400" : "text-gray-600"}`}>Location</label>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className={`w-full px-3 py-2 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
              >
                <option value="">— Select a location —</option>
                {locationOptions.map((code) => (
                  <option key={code} value={code}>{code} — {LOCATION_LABELS[code]}</option>
                ))}
              </select>
            </div>

            {/* Tab strip */}
            <div className="flex gap-1">
              {(["report", "adjustments", "coverage"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    tab === t
                      ? isDark ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" : "bg-emerald-100 text-emerald-700 border border-emerald-300"
                      : isDark ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {t === "report" ? "Generate Report" : t === "adjustments" ? "Adjustments" : "Coverage"}
                </button>
              ))}
            </div>

            {/* Brand picker */}
            {tab === "report" && location && (
              <div className={`rounded-xl border p-5 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
                <div className="flex items-center justify-between mb-2">
                  <label className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                    Brands ({selectedBrands.size} selected)
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={selectAllBrands}
                      disabled={brandsAtLocation.length === 0}
                      className={`text-xs px-2 py-1 rounded disabled:opacity-40 ${isDark ? "text-cyan-400 hover:bg-slate-700" : "text-blue-600 hover:bg-gray-100"}`}
                    >Select all</button>
                    <button
                      type="button"
                      onClick={clearBrands}
                      disabled={selectedBrands.size === 0}
                      className={`text-xs px-2 py-1 rounded disabled:opacity-40 ${isDark ? "text-slate-400 hover:bg-slate-700" : "text-gray-500 hover:bg-gray-100"}`}
                    >Clear</button>
                  </div>
                </div>
                {loading ? (
                  <p className={`text-xs py-3 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Loading inventory...</p>
                ) : brandsAtLocation.length === 0 ? (
                  <p className={`text-xs py-3 ${isDark ? "text-slate-500" : "text-gray-400"}`}>No items at this location.</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-72 overflow-y-auto">
                    {brandsAtLocation.map((brand) => {
                      const checked = selectedBrands.has(brand);
                      return (
                        <label key={brand} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs ${isDark ? "hover:bg-slate-700 text-slate-300" : "hover:bg-gray-50 text-gray-700"}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleBrand(brand)} className="rounded w-3.5 h-3.5" />
                          <span className="truncate">{brand}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Generate */}
            {tab === "report" && location && selectedBrands.size > 0 && (
              <div className={`rounded-xl border p-5 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                      {filteredRows.length.toLocaleString()} items will appear in the report
                    </p>
                    <p className={`text-xs mt-0.5 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                      {locationLabel(location)} — {[...selectedBrands].sort().map(brandAbbr).join("/")}
                    </p>
                  </div>
                  <button
                    onClick={handleGenerate}
                    disabled={generating || filteredRows.length === 0}
                    className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${isDark ? "bg-emerald-600 text-white hover:bg-emerald-500" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
                  >
                    {generating ? "Generating..." : "Generate PDF"}
                  </button>
                </div>
              </div>
            )}

            {/* Adjustments tab */}
            {tab === "adjustments" && !location && (
              <div className={`rounded-xl border p-5 text-sm ${isDark ? "bg-slate-800/50 border-slate-700 text-slate-400" : "bg-white border-gray-200 text-gray-600"}`}>
                Pick a location above to log inventory adjustments.
              </div>
            )}

            {tab === "adjustments" && location && (
              <>
                {/* Entry form */}
                <div className={`rounded-xl border p-5 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
                  <h2 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>
                    Log adjustment — {location} · {locationLabel(location)}
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3" onKeyDown={(e) => {
                    // Press Enter from any input in the entry form to add the
                    // adjustment, mirroring the click on Add.
                    if (e.key !== "Enter") return;
                    if (adjSaving || !adjItemId.trim() || !adjQty) return;
                    e.preventDefault();
                    handleAddAdjustment();
                  }}>
                    <div className="sm:col-span-3">
                      <label className={`block text-[10px] uppercase tracking-wide mb-1 ${isDark ? "text-slate-500" : "text-gray-500"}`}>Item ID</label>
                      <input
                        type="text"
                        value={adjItemId}
                        onChange={(e) => setAdjItemId(e.target.value)}
                        placeholder="e.g. 4076ATL"
                        className={`w-full px-3 py-2 rounded-lg border text-sm font-mono ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                      />
                    </div>
                    <div className="sm:col-span-5">
                      <label className={`block text-[10px] uppercase tracking-wide mb-1 ${isDark ? "text-slate-500" : "text-gray-500"}`}>Item details (autofilled)</label>
                      <div className={`px-3 py-2 rounded-lg border text-sm h-[38px] ${isDark ? "bg-slate-900/50 border-slate-700 text-slate-300" : "bg-gray-50 border-gray-200 text-gray-700"}`}>
                        {adjItemId.trim() === "" ? (
                          <span className={isDark ? "text-slate-600" : "text-gray-400"}>—</span>
                        ) : adjLookupMatch ? (
                          <span className="truncate block">{adjLookupMatch.manufacturerName} · {adjLookupMatch.description}</span>
                        ) : loading ? (
                          <span className={isDark ? "text-slate-500" : "text-gray-400"}>loading inventory…</span>
                        ) : (
                          <span className={isDark ? "text-amber-400" : "text-amber-700"}>not in current inventory snapshot</span>
                        )}
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <label className={`block text-[10px] uppercase tracking-wide mb-1 ${isDark ? "text-slate-500" : "text-gray-500"}`}>Qty (+/−)</label>
                      <input
                        type="number"
                        value={adjQty}
                        onChange={(e) => setAdjQty(e.target.value)}
                        placeholder="-2 or 4"
                        className={`w-full px-3 py-2 rounded-lg border text-sm text-right font-mono ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                      />
                    </div>
                    <div className="sm:col-span-2 flex items-end">
                      <button
                        onClick={handleAddAdjustment}
                        disabled={adjSaving || !adjItemId.trim() || !adjQty}
                        className={`w-full px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 ${isDark ? "bg-emerald-600 text-white hover:bg-emerald-500" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
                      >
                        {adjSaving ? "Saving…" : "Add"}
                      </button>
                    </div>
                    <div className="sm:col-span-12">
                      <label className={`block text-[10px] uppercase tracking-wide mb-1 ${isDark ? "text-slate-500" : "text-gray-500"}`}>Notes (optional)</label>
                      <input
                        type="text"
                        value={adjNotes}
                        onChange={(e) => setAdjNotes(e.target.value)}
                        placeholder="e.g. damaged, recount, inter-store transfer"
                        className={`w-full px-3 py-2 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                      />
                    </div>
                  </div>
                  {adjError && (
                    <p className={`mt-2 text-xs ${isDark ? "text-red-400" : "text-red-600"}`}>{adjError}</p>
                  )}
                </div>

                {/* Stats panel */}
                <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3`}>
                  {[
                    { label: ymLabel(adjStats.priorYm), value: adjStats.priorCount },
                    { label: ymLabel(adjStats.currentYm), value: adjStats.currentCount },
                    { label: "Total", value: adjStats.totalCount },
                  ].map((s) => (
                    <div key={s.label} className={`rounded-xl border p-4 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
                      <p className={`text-[10px] uppercase tracking-wide ${isDark ? "text-slate-500" : "text-gray-500"}`}>{s.label}</p>
                      <p className={`text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{s.value}</p>
                    </div>
                  ))}
                </div>

                {/* Recent log + filters + Print */}
                <div className={`rounded-xl border ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
                  <div className={`flex flex-wrap items-center gap-3 px-4 py-3 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                    <h2 className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Adjustment log</h2>
                    <input
                      type="text"
                      value={adjSearch}
                      onChange={(e) => setAdjSearch(e.target.value)}
                      placeholder="Search item ID, description, notes…"
                      className={`flex-1 min-w-[180px] px-3 py-1.5 rounded-lg border text-xs ${isDark ? "bg-slate-900 border-slate-600 text-white placeholder:text-slate-500" : "bg-white border-gray-300 placeholder:text-gray-400"}`}
                    />
                    <select
                      value={adjRange}
                      onChange={(e) => setAdjRange(e.target.value as any)}
                      className={`px-2 py-1.5 rounded-lg border text-xs ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300"}`}
                    >
                      <option value="thisMonth">This month</option>
                      <option value="lastMonth">Last month</option>
                      <option value="last90">Last 90 days</option>
                      <option value="all">All time</option>
                    </select>
                    <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                      {filteredAdjustments.length} of {adjustments?.length ?? 0}
                      {adjustments && adjustments.length >= 50 ? " (last 50)" : ""}
                    </span>
                    <button
                      onClick={handleGenerateAdjustmentsPDF}
                      disabled={adjGenerating || !adjustments || adjustments.length === 0}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 ${isDark ? "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30" : "bg-purple-100 text-purple-700 hover:bg-purple-200"}`}
                    >
                      {adjGenerating ? "Generating…" : "Print PDF"}
                    </button>
                  </div>
                  {!adjustments ? (
                    <p className={`p-4 text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>Loading…</p>
                  ) : adjustments.length === 0 ? (
                    <p className={`p-4 text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>No adjustments logged for this location yet.</p>
                  ) : filteredAdjustments.length === 0 ? (
                    <p className={`p-4 text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>No adjustments match the current filter.</p>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className={isDark ? "bg-slate-900/50 text-slate-400" : "bg-gray-50 text-gray-600"}>
                            <tr>
                              {["Date", "Item ID", "Mfg", "Description", "Qty", "Notes", "By", ""].map((h) => (
                                <th key={h} className="text-left px-3 py-2 font-semibold">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {adjPaged.map((a) => (
                              <tr key={a._id} className={`border-t ${isDark ? "border-slate-700/50" : "border-gray-100"}`}>
                                <td className={`px-3 py-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>{new Date(a.createdAt).toLocaleString(undefined, { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                                <td className={`px-3 py-2 font-mono ${isDark ? "text-slate-300" : "text-gray-800"}`}>{a.itemId}</td>
                                <td className={`px-3 py-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{a.manufacturerName || "—"}</td>
                                <td className={`px-3 py-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{a.description || "—"}</td>
                                <td className={`px-3 py-2 text-right font-mono font-semibold ${a.qtyChange > 0 ? (isDark ? "text-emerald-400" : "text-emerald-700") : (isDark ? "text-red-400" : "text-red-700")}`}>{a.qtyChange > 0 ? "+" : ""}{a.qtyChange}</td>
                                <td className={`px-3 py-2 ${isDark ? "text-slate-400" : "text-gray-600"}`}>{a.notes || ""}</td>
                                <td className={`px-3 py-2 ${isDark ? "text-slate-500" : "text-gray-500"}`}>{a.enteredByName}</td>
                                <td className="px-3 py-2 text-right">
                                  <button onClick={() => handleDeleteAdjustment(a._id)} className={`text-[10px] px-2 py-1 rounded ${isDark ? "text-red-400 hover:bg-red-500/10" : "text-red-600 hover:bg-red-50"}`}>Delete</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className={`flex items-center justify-between px-4 py-3 border-t ${isDark ? "bg-slate-900/40 border-slate-700" : "bg-gray-50 border-gray-200"}`}>
                        <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          Showing {adjPage * adjPageSize + 1}–{Math.min((adjPage + 1) * adjPageSize, filteredAdjustments.length)} of {filteredAdjustments.length}
                        </span>
                        <div className="flex items-center gap-2">
                          <select value={adjPageSize} onChange={(e) => setAdjPageSize(Number(e.target.value))} className={`px-2 py-1 rounded border text-xs ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300"}`}>
                            {[25, 50, 100].map((s) => <option key={s} value={s}>{s}/page</option>)}
                          </select>
                          <button disabled={adjPage === 0} onClick={() => setAdjPage((p) => p - 1)} className={`px-2 py-1 rounded text-xs disabled:opacity-30 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Prev</button>
                          <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>{adjPage + 1}/{adjTotalPages}</span>
                          <button disabled={adjPage >= adjTotalPages - 1} onClick={() => setAdjPage((p) => p + 1)} className={`px-2 py-1 rounded text-xs disabled:opacity-30 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Next</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Per-item MoM */}
                {adjStats.perItemMoM.length > 0 && (
                  <div className={`rounded-xl border ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
                    <div className={`px-4 py-2 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                      <h2 className={`text-xs font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                        Per-item MoM ({ymLabel(adjStats.priorYm)} → {ymLabel(adjStats.currentYm)})
                      </h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead className={isDark ? "bg-slate-900/50 text-slate-400" : "bg-gray-50 text-gray-600"}>
                          <tr>
                            <th className="text-left px-2 py-1 font-semibold">Item ID</th>
                            <th className="text-left px-2 py-1 font-semibold">Mfg</th>
                            <th className="text-left px-2 py-1 font-semibold">Description</th>
                            <th className="text-right px-2 py-1 font-semibold">{ymLabel(adjStats.priorYm)}</th>
                            <th className="text-right px-2 py-1 font-semibold">{ymLabel(adjStats.currentYm)}</th>
                            <th className="text-right px-2 py-1 font-semibold">Δ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adjStats.perItemMoM.map((r) => (
                            <tr key={r.itemId} className={`border-t ${isDark ? "border-slate-700/50" : "border-gray-100"}`}>
                              <td className={`px-2 py-0.5 font-mono ${isDark ? "text-slate-300" : "text-gray-800"}`}>{r.itemId}</td>
                              <td className={`px-2 py-0.5 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{r.meta.manufacturerName}</td>
                              <td className={`px-2 py-0.5 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{r.meta.description}</td>
                              <td className={`px-2 py-0.5 text-right font-mono ${isDark ? "text-slate-400" : "text-gray-600"}`}>{r.prior > 0 ? "+" : ""}{r.prior}</td>
                              <td className={`px-2 py-0.5 text-right font-mono ${isDark ? "text-slate-400" : "text-gray-600"}`}>{r.current > 0 ? "+" : ""}{r.current}</td>
                              <td className={`px-2 py-0.5 text-right font-mono font-bold ${(r.current - r.prior) > 0 ? (isDark ? "text-emerald-400" : "text-emerald-700") : (r.current - r.prior) < 0 ? (isDark ? "text-red-400" : "text-red-700") : ""}`}>{(r.current - r.prior) > 0 ? "+" : ""}{r.current - r.prior}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Repeat flags */}
                {(adjStats.repeatedThisMonth.length > 0 || adjStats.consecutiveMultiMonth.length > 0) && (
                  <div className={`rounded-xl border p-4 ${isDark ? "bg-amber-500/10 border-amber-500/30" : "bg-amber-50 border-amber-200"}`}>
                    <h2 className={`text-sm font-semibold mb-2 ${isDark ? "text-amber-300" : "text-amber-800"}`}>Flags</h2>
                    {adjStats.repeatedThisMonth.length > 0 && (
                      <div className="mb-3">
                        <p className={`text-xs font-medium mb-1 ${isDark ? "text-amber-300" : "text-amber-800"}`}>Adjusted ≥ 2× this month:</p>
                        <ul className={`text-xs space-y-0.5 ${isDark ? "text-amber-200" : "text-amber-900"}`}>
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
                        <p className={`text-xs font-medium mb-1 ${isDark ? "text-amber-300" : "text-amber-800"}`}>Adjusted in consecutive months:</p>
                        <ul className={`text-xs space-y-0.5 ${isDark ? "text-amber-200" : "text-amber-900"}`}>
                          {adjStats.consecutiveMultiMonth.map((r) => (
                            <li key={r.itemId}>
                              <span className="font-mono">{r.itemId}</span> — {r.meta.manufacturerName} {r.meta.description} <span className="font-bold">({r.months.map(ymLabel).join(", ")})</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Coverage tab */}
            {tab === "coverage" && (
              <div className="space-y-4">
                <div className={`rounded-xl border p-4 flex flex-wrap items-center gap-3 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
                  <label className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-gray-600"}`}>Window:</label>
                  <div className="flex gap-1">
                    {[30, 45, 60, 90].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setCoverageDays(d)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                          coverageDays === d
                            ? (isDark ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40" : "bg-blue-100 text-blue-700 border-blue-300")
                            : (isDark ? "bg-slate-900 text-slate-400 border-slate-600 hover:bg-slate-800" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50")
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                  <span className={`text-[11px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>counts in the last {coverageDays} days</span>
                  <span className={`ml-auto text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    {coverageLoading ? "Loading inventory…" : `${(cirRunsInWindow ?? []).length} CIR run(s)`}
                  </span>
                </div>

                {coverageLoading && Object.keys(coverageBrands).length === 0 ? (
                  <div className={`rounded-xl border p-8 text-center text-sm ${isDark ? "bg-slate-800/50 border-slate-700 text-slate-500" : "bg-white border-gray-200 text-gray-400"}`}>
                    Loading brand inventory across all locations…
                  </div>
                ) : (
                  (location ? [location] : Object.keys(LOCATION_LABELS).sort()).map((code) => {
                    const rows = coverageByLocation[code] || [];
                    const total = rows.length;
                    const covered = rows.filter((r) => r.pulledOn.length > 0).length;
                    return (
                      <div key={code} className={`rounded-xl border ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
                        <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                          <h3 className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                            {code} · {LOCATION_LABELS[code]}
                          </h3>
                          <span className={`text-xs font-medium ${covered === total && total > 0 ? (isDark ? "text-emerald-400" : "text-emerald-700") : (isDark ? "text-slate-400" : "text-gray-500")}`}>
                            {covered} / {total} covered
                          </span>
                        </div>
                        {total === 0 ? (
                          <p className={`p-4 text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>No brands found in this location.</p>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1 p-2">
                            {rows.map((r) => {
                              const pulled = r.pulledOn.length > 0;
                              const lastPulled = pulled ? new Date(Math.max(...r.pulledOn)) : null;
                              return (
                                <div key={r.brand} className={`group flex items-center justify-between px-2 py-1 rounded text-[11px] ${pulled ? (isDark ? "bg-emerald-500/10 border border-emerald-500/30" : "bg-emerald-50 border border-emerald-200") : (isDark ? "bg-slate-900/40 border border-slate-700" : "bg-gray-50 border border-gray-200")}`}>
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className={pulled ? (isDark ? "text-emerald-400" : "text-emerald-700") : (isDark ? "text-slate-600" : "text-gray-400")}>
                                      {pulled ? "✓" : "○"}
                                    </span>
                                    <span className={`truncate ${pulled ? (isDark ? "text-emerald-300" : "text-emerald-800") : (isDark ? "text-slate-400" : "text-gray-600")}`}>{r.brand}</span>
                                  </div>
                                  {pulled && lastPulled ? (
                                    <span className={`text-[10px] ml-2 flex-shrink-0 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                                      {`${lastPulled.getMonth()+1}/${lastPulled.getDate()}`}{r.pulledOn.length > 1 ? ` ×${r.pulledOn.length}` : ""}
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleMarkCovered(code, r.brand)}
                                      className={`text-[10px] ml-2 flex-shrink-0 px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity ${isDark ? "bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30" : "bg-blue-100 text-blue-700 hover:bg-blue-200"}`}
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
                          <div className={`px-4 py-3 border-t text-xs ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                            <p className={`text-[10px] uppercase tracking-wide mb-1.5 ${isDark ? "text-slate-500" : "text-gray-500"}`}>Past CIR PDFs ({(archivedRunsByLocation[code] || []).length})</p>
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
                                    className={`px-2 py-1 rounded text-[11px] border ${isDark ? "bg-slate-900/50 border-slate-700 text-slate-300 hover:bg-slate-800" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"}`}
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
