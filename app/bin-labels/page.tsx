"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import JsBarcode from "jsbarcode";
import { brandLogoSrc } from "@/lib/brandLogo";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";

// ── jsPDF helpers (tire labels print as an exact 4x6 PDF so they print
//    identically on any label printer — Zebra, LabelRange BT320, etc. —
//    regardless of browser/driver paper-size & scaling settings). ──
async function loadImageForPdf(url: string): Promise<{ dataUrl: string; w: number; h: number } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const rawUrl: string = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = rawUrl;
    });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return null;
    // Re-encode the logo through a white-backed canvas before handing it to jsPDF.
    // Some brand PNGs (e.g. interlaced or palette+alpha) make jsPDF emit a solid
    // black block instead of the artwork; redrawing onto an opaque white canvas
    // (the label is white anyway) normalizes the encoding and flattens transparency.
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { dataUrl: rawUrl, w, h };
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL("image/png"), w, h };
  } catch {
    return null;
  }
}

function barcodePngForPdf(value: string, rotate90 = false): { dataUrl: string; w: number; h: number } | null {
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, value, { format: "CODE128", width: 2, height: 60, displayValue: true, fontSize: 16, font: "monospace", margin: 6 });
    if (!rotate90) return { dataUrl: canvas.toDataURL("image/png"), w: canvas.width, h: canvas.height };
    // Rotate 90° for portrait labels so the barcode runs down the label ("ladder")
    // instead of overflowing a narrow 2"-wide label.
    const rc = document.createElement("canvas");
    rc.width = canvas.height;
    rc.height = canvas.width;
    const ctx = rc.getContext("2d");
    if (!ctx) return { dataUrl: canvas.toDataURL("image/png"), w: canvas.width, h: canvas.height };
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rc.width, rc.height);
    ctx.translate(rc.width / 2, rc.height / 2);
    // Rotate -90° (counter-clockwise) so the human-readable value (which JsBarcode
    // renders BELOW the bars) lands on the opposite side of the ladder — otherwise it
    // falls off the narrow label edge and doesn't print.
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return { dataUrl: rc.toDataURL("image/png"), w: rc.width, h: rc.height };
  } catch {
    return null;
  }
}
import TireSearchBox, { type TireSearchResult } from "@/components/TireSearchBox";

interface LabelData {
  locationId: string;
  locationName: string;
}

interface TireLabelData {
  itemId: string;
  mpn: string; // manufacturer part number — printed AS the barcode (falls back to itemId)
  brand: string;
  model: string;
  sizeDesc: string;
  qty: number; // how many copies of THIS label to print
  dclass: string; // d-class symbol appended to the barcode (e.g. "[" so AB1234 -> AB1234[)
}

// D-class options: a single symbol appended to the part number so the printed
// barcode exactly matches the item in inventory (the scanner does an exact match,
// so "AB1234" won't scan an item that is really "AB1234["). Empty = no d-class.
const DCLASS_OPTIONS: { name: string; symbol: string }[] = [
  { name: "None", symbol: "" },
  { name: "Dot  .", symbol: "." },
  { name: "Caret  ^", symbol: "^" },
  { name: "Bracket  [", symbol: "[" },
  { name: "Colon  :", symbol: ":" },
  { name: "Dash  -", symbol: "-" },
  { name: "Tilde  ~", symbol: "~" },
  { name: "Star  *", symbol: "*" },
  { name: "Hash  #", symbol: "#" },
  { name: "Bang  !", symbol: "!" },
];
const DCLASS_SYMBOLS = DCLASS_OPTIONS.map((o) => o.symbol).filter(Boolean).join("");

// Append the selected d-class symbol to the base part number. First strip any
// trailing d-class symbol the base already carries (the item-ID may include one),
// so we never double it: "AB1234[" + Bracket still yields "AB1234[".
function applyDclass(base: string, dclass: string): string {
  let b = (base ?? "").trim();
  if (b && DCLASS_SYMBOLS.includes(b[b.length - 1])) b = b.slice(0, -1);
  return b + (dclass ?? "");
}

// Remove a trailing d-class symbol so the MPN field shows the clean part number.
function stripDclass(s: string): string {
  const v = (s ?? "").trim();
  return v && DCLASS_SYMBOLS.includes(v[v.length - 1]) ? v.slice(0, -1) : v;
}

// Detect the d-class from a looked-up part number: the first candidate whose last
// character is a d-class symbol wins (check MPN, then item-ID). "" if none.
function detectDclass(...vals: string[]): string {
  for (const raw of vals) {
    const s = (raw ?? "").trim();
    if (s && DCLASS_SYMBOLS.includes(s[s.length - 1])) return s[s.length - 1];
  }
  return "";
}

// The value encoded in (and printed under) the barcode: the MPN when we have one,
// otherwise the internal item-ID — plus the d-class suffix so it scans exactly.
function tireBarcodeValue(l: { mpn?: string; itemId: string; dclass?: string }): string {
  const base = ((l.mpn ?? "").trim() || (l.itemId ?? "")).trim();
  return applyDclass(base, l.dclass ?? "");
}

type Mode = "bin" | "tire";

interface WorkOrderRow {
  _id: string;
  title: string;
  labels: (Omit<TireLabelData, "qty" | "mpn" | "dclass"> & { qty?: number; mpn?: string; dclass?: string })[];
  copies: number;
  status: string;
  createdByName: string;
  createdAt: number;
  printedAt?: number;
  printedByName?: string;
}

export default function BinLabelsPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>("bin");
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const [labels, setLabels] = useState<LabelData[]>([{ locationId: "", locationName: "" }]);
  const [tireLabels, setTireLabels] = useState<TireLabelData[]>([
    { itemId: "", mpn: "", brand: "", model: "", sizeDesc: "", qty: 1, dclass: "" },
  ]);
  const [copies, setCopies] = useState(1);
  // Bin-label print orientation. Physical label is 2"×6"; landscape prints it
  // 6 wide × 2 tall (barcode + name side by side), portrait 2 wide × 6 tall (stacked).
  const [binOrientation, setBinOrientation] = useState<"landscape" | "portrait">("landscape");
  const [includeItemId, setIncludeItemId] = useState(false); // add a 2nd Item-ID barcode
  const [lookupLoading, setLookupLoading] = useState<number | null>(null);
  const [lookupNotFound, setLookupNotFound] = useState<Record<number, boolean>>({});
  const barcodeRefs = useRef<(SVGSVGElement | null)[]>([]);
  const tireBarcodeRefs = useRef<(SVGSVGElement | null)[]>([]);
  const tireItemIdBarcodeRefs = useRef<(SVGSVGElement | null)[]>([]);
  const tirePreviewRef = useRef<HTMLDivElement>(null);
  const tireFormRef = useRef<HTMLDivElement>(null);

  // Work orders (tire mode)
  const workOrders = useQuery(
    api.labelWorkOrders.list,
    mode === "tire" ? { limit: 50 } : "skip",
  );
  const createWorkOrder = useMutation(api.labelWorkOrders.create);
  const markWorkOrderPrinted = useMutation(api.labelWorkOrders.markPrinted);
  const removeWorkOrder = useMutation(api.labelWorkOrders.remove);
  const [woTitle, setWoTitle] = useState("");
  const [woSaving, setWoSaving] = useState(false);
  const [woSaved, setWoSaved] = useState(false);
  const [loadedWorkOrderId, setLoadedWorkOrderId] = useState<string | null>(null);

  // Generate bin barcodes when labels change
  useEffect(() => {
    labels.forEach((label, index) => {
      if (label.locationId && barcodeRefs.current[index]) {
        try {
          JsBarcode(barcodeRefs.current[index], label.locationId, {
            format: "CODE128",
            width: 3,
            height: 60,
            displayValue: true,
            fontSize: 16,
            font: "monospace",
            textMargin: 5,
            margin: 5,
          });
        } catch (e) {
          console.error("Barcode generation error:", e);
        }
      }
    });
    // binOrientation is a dep because the barcode <svg> remounts when the layout
    // switches (portrait wraps it in a rotated container), so JsBarcode must re-run.
  }, [labels, binOrientation]);

  // Generate tire barcodes when tire labels change
  useEffect(() => {
    tireLabels.forEach((label, index) => {
      const value = tireBarcodeValue(label);
      if (value && tireBarcodeRefs.current[index]) {
        try {
          JsBarcode(tireBarcodeRefs.current[index], value, {
            format: "CODE128",
            width: 2,
            height: 70,
            displayValue: true,
            fontSize: 18,
            font: "monospace",
            textMargin: 5,
            margin: 5,
          });
          fitBarcode(tireBarcodeRefs.current[index]);
        } catch (e) {
          console.error("Tire barcode generation error:", e);
        }
      }
    });
  }, [tireLabels]);

  // Generate the optional second Item-ID barcode in the preview.
  useEffect(() => {
    if (!includeItemId) return;
    tireLabels.forEach((label, index) => {
      const itemIdVal = (label.itemId ?? "").trim();
      if (itemIdVal && itemIdVal !== tireBarcodeValue(label) && tireItemIdBarcodeRefs.current[index]) {
        try {
          JsBarcode(tireItemIdBarcodeRefs.current[index], itemIdVal, {
            format: "CODE128", width: 2, height: 70, displayValue: true,
            fontSize: 18, font: "monospace", textMargin: 5, margin: 5,
          });
          fitBarcode(tireItemIdBarcodeRefs.current[index]);
        } catch (e) {
          console.error("Item-ID barcode generation error:", e);
        }
      }
    });
  }, [tireLabels, includeItemId]);

  const addLabel = () => {
    setLabels([...labels, { locationId: "", locationName: "" }]);
  };

  const removeLabel = (index: number) => {
    if (labels.length > 1) {
      setLabels(labels.filter((_, i) => i !== index));
    }
  };

  const updateLabel = (index: number, field: keyof LabelData, value: string) => {
    const newLabels = [...labels];
    newLabels[index] = { ...newLabels[index], [field]: value };
    setLabels(newLabels);
  };

  const addTireLabel = () => {
    setTireLabels([...tireLabels, { itemId: "", mpn: "", brand: "", model: "", sizeDesc: "", qty: 1, dclass: "" }]);
  };

  const removeTireLabel = (index: number) => {
    if (tireLabels.length > 1) {
      setTireLabels(tireLabels.filter((_, i) => i !== index));
      setLookupNotFound((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
    }
  };

  const updateTireLabel = (index: number, field: "itemId" | "mpn" | "brand" | "model" | "sizeDesc" | "dclass", value: string) => {
    const newLabels = [...tireLabels];
    newLabels[index] = { ...newLabels[index], [field]: value };
    setTireLabels(newLabels);
  };

  const updateTireQty = (index: number, value: number) => {
    const newLabels = [...tireLabels];
    newLabels[index] = { ...newLabels[index], qty: Math.max(1, Math.min(99, value || 1)) };
    setTireLabels(newLabels);
  };

  // Fill a row from a catalog search pick (untagged tire — no manual entry).
  const fillTireFromSearch = (index: number, r: TireSearchResult) => {
    const newLabels = [...tireLabels];
    // Auto-detect the d-class from the looked-up part number and pre-select it;
    // show the MPN field clean (the dropdown carries the suffix). User can override.
    const dclass = detectDclass(r.mpn || "", r.itemId);
    newLabels[index] = { ...newLabels[index], itemId: r.itemId, mpn: stripDclass(r.mpn || ""), brand: r.brand, model: r.model, sizeDesc: r.sizeDesc, dclass };
    setTireLabels(newLabels);
    setLookupNotFound((prev) => ({ ...prev, [index]: false }));
  };

  const lookupTire = async (index: number) => {
    const itemId = tireLabels[index].itemId.trim();
    if (!itemId) return;
    setLookupLoading(index);
    setLookupNotFound((prev) => ({ ...prev, [index]: false }));
    try {
      const res = await fetch(`/api/reports/resolve-brand?itemId=${encodeURIComponent(itemId)}`);
      const data = await res.json();
      if (data.found) {
        const newLabels = [...tireLabels];
        newLabels[index] = {
          ...newLabels[index],
          mpn: stripDclass(data.mfgItemId || ""),
          brand: data.manufacturerName || "",
          model: data.model || "",
          sizeDesc: data.description || "",
          // Auto-detect d-class from the part number / item-ID (user can override).
          dclass: detectDclass(data.mfgItemId || "", itemId),
        };
        setTireLabels(newLabels);
      } else {
        setLookupNotFound((prev) => ({ ...prev, [index]: true }));
      }
    } catch (e) {
      console.error("Brand lookup error:", e);
      setLookupNotFound((prev) => ({ ...prev, [index]: true }));
    } finally {
      setLookupLoading(null);
    }
  };

  // Bin labels → exact 6x2 PDF, one label per page. Like the tire-label PDF, this
  // replaces the browser @media print path, which spilled each label onto a blank
  // second page. jsPDF only emits the pages we add (one per label).
  const printBinLabelsPdf = async () => {
    const items = labelsWithCopies.filter((l) => l.locationId);
    if (items.length === 0) return;
    const { jsPDF } = await import("jspdf");
    // Physical label is 2"×6". Landscape = 6 wide × 2 tall; portrait = 2 wide × 6 tall.
    const portrait = binOrientation === "portrait";
    // Physical label is 50mm × 170mm. Use its true size (in mm) as the PDF page so the
    // print fills the whole label — the old 2"×6" page (≈51×152mm) was ~18mm short,
    // leaving a blank band and throwing the spacing off.
    const LONG = 170, SHORT = 50; // mm
    const pageW = portrait ? SHORT : LONG;
    const pageH = portrait ? LONG : SHORT;
    const fmt: [number, number] = [pageW, pageH];
    const orient: "portrait" | "landscape" = portrait ? "portrait" : "landscape";
    // Edge margin (mm) so nothing prints flush to the label edge.
    const M = 5;
    const doc = new jsPDF({ unit: "mm", format: fmt, orientation: orient });

    for (let i = 0; i < items.length; i++) {
      const l = items[i];
      if (i > 0) doc.addPage(fmt, orient);
      doc.setTextColor(0, 0, 0);
      // Portrait: rotate the barcode 90° so it runs down the narrow label.
      const bc = barcodePngForPdf(l.locationId, portrait);

      const drawName = (cx: number, cy: number, maxW: number) => {
        if (!l.locationName) return;
        doc.setFont("helvetica", "bold");
        let fs = 30;
        doc.setFontSize(fs);
        while (fs > 10 && doc.getTextWidth(l.locationName) > maxW) {
          fs -= 1;
          doc.setFontSize(fs);
        }
        doc.text(l.locationName, cx, cy, { align: "center", baseline: "middle", maxWidth: maxW });
      };

      if (portrait) {
        // Stacked: location name near the top, barcode centered in the space below.
        const contentW = pageW - 2 * M;                 // ~40mm
        const hasName = !!l.locationName;
        // Reserve a top band ONLY when there's a name — otherwise the barcode centers
        // over the WHOLE label instead of being pushed down under an empty gap.
        const nameBandH = hasName ? 26 : 0;             // mm
        if (hasName) drawName(pageW / 2, M + nameBandH / 2, contentW);
        if (bc) {
          const regionTop = M + nameBandH;
          const availH = (pageH - M) - regionTop;       // barcode region height
          let bw = contentW, bh = (bw * bc.h) / bc.w;
          if (bh > availH) { bh = availH; bw = (bh * bc.w) / bc.h; }
          const bx = (pageW - bw) / 2;                  // centered horizontally
          const by = regionTop + (availH - bh) / 2;     // centered in the remaining height
          doc.addImage(bc.dataUrl, "PNG", bx, by, bw, bh);
        }
      } else {
        // Side by side: barcode on the left, name on the right. With no name the barcode
        // uses the full width and is centered.
        const availH = pageH - 2 * M;                   // ~40mm
        const hasName = !!l.locationName;
        const split = hasName ? pageW * 0.58 : pageW;   // boundary between barcode / name
        if (bc) {
          const leftW = (hasName ? split : pageW) - 2 * M; // barcode region width
          let bw = leftW, bh = (bw * bc.h) / bc.w;
          if (bh > availH) { bh = availH; bw = (bh * bc.w) / bc.h; }
          const bx = M + (leftW - bw) / 2;              // centered in the barcode region
          const by = (pageH - bh) / 2;
          doc.addImage(bc.dataUrl, "PNG", bx, by, bw, bh);
        }
        if (hasName) {
          const rightW = (pageW - M) - split;           // name region width
          drawName(split + rightW / 2, pageH / 2, rightW);
        }
      }
    }

    // Print via a hidden iframe (no popup-blocker issues after the async build).
    const url = doc.output("bloburl") as unknown as string;
    const iframe = document.createElement("iframe");
    Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
    iframe.src = url;
    iframe.onload = () => {
      setTimeout(() => { try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { /* ignore */ } }, 400);
    };
    document.body.appendChild(iframe);
    setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* ignore */ } }, 120000);
  };

  const handlePrint = () => {
    // Both label types print as exact-size PDFs (printer-agnostic), avoiding the
    // browser @media print path that produced a blank second page/label.
    if (mode === "tire") { void printTireLabelsPdf(); return; }
    void printBinLabelsPdf();
  };

  const clearAll = () => {
    if (mode === "bin") {
      setLabels([{ locationId: "", locationName: "" }]);
    } else {
      setTireLabels([{ itemId: "", mpn: "", brand: "", model: "", sizeDesc: "", qty: 1, dclass: "" }]);
      setLookupNotFound({});
    }
    setCopies(1);
  };

  const userName = user?.name ?? user?.email ?? "Unknown";
  // Accountability footer printed on each tire label: who made it + when.
  const labelFooter = `Created ${new Date().toLocaleDateString()} · ${userName}`;

  const saveWorkOrder = async () => {
    const labelsToSave = tireLabels.filter((l) => l.itemId || l.brand);
    if (labelsToSave.length === 0 || woSaving) return;
    const title = woTitle.trim() || window.prompt("Work order name") || "";
    if (!title.trim()) return;
    setWoSaving(true);
    try {
      await createWorkOrder({
        title: title.trim(),
        labels: labelsToSave.map((l) => ({ ...l })),
        copies,
        createdBy: user?._id,
        createdByName: userName,
      });
      setWoTitle("");
      setWoSaved(true);
      setTimeout(() => setWoSaved(false), 2500);
    } catch (e) {
      console.error("Save work order error:", e);
    } finally {
      setWoSaving(false);
    }
  };

  const loadWorkOrder = (wo: { _id: string; labels: (Omit<TireLabelData, "qty" | "mpn" | "dclass"> & { qty?: number; mpn?: string; dclass?: string })[]; copies: number }) => {
    // Older work orders predate per-label qty / mpn: fall back to the order's global
    // "copies" and to an empty MPN (the barcode then uses the item-ID, as before).
    setTireLabels(wo.labels.map((l) => ({ ...l, mpn: l.mpn ?? "", qty: l.qty ?? wo.copies ?? 1, dclass: l.dclass ?? "" })));
    setCopies(wo.copies);
    setLoadedWorkOrderId(wo._id);
    setLookupNotFound({});
    setTimeout(() => {
      tireFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const handleMarkPrinted = async (id: string) => {
    try {
      await markWorkOrderPrinted({ id: id as any, printedByName: userName });
    } catch (e) {
      console.error("Mark printed error:", e);
    }
  };

  const handleDeleteWorkOrder = async (id: string, title: string) => {
    if (!window.confirm(`Delete work order "${title}"?`)) return;
    try {
      await removeWorkOrder({ id: id as any });
      if (loadedWorkOrderId === id) setLoadedWorkOrderId(null);
    } catch (e) {
      console.error("Delete work order error:", e);
    }
  };

  const formatWoDate = (ts: number) => {
    const d = new Date(ts);
    const now = Date.now();
    const diffMs = now - ts;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  // Generate labels with copies. Bin labels use the global "copies" count;
  // tire labels use a PER-LABEL qty (4 of one tire, 1 of another).
  const labelsWithCopies = labels.flatMap((label) => Array(copies).fill(label));
  const tireLabelsWithCopies = tireLabels.flatMap((label) =>
    Array(Math.max(1, label.qty || 1)).fill(label),
  );

  const tireIsPrintable = (l: TireLabelData) => Boolean(l.itemId || l.brand);
  const canPrint =
    mode === "bin"
      ? labels.some((l) => l.locationId)
      : tireLabels.some(tireIsPrintable);

  const isTire = mode === "tire";

  // Build an exact 4"x6" PDF (one page per label copy) and open it for printing.
  // The PDF carries its own 4x6 page size, so it prints correctly on any label
  // printer without depending on browser/driver paper-size or scale settings.
  const printTireLabelsPdf = async () => {
    const items = tireLabelsWithCopies.filter(tireIsPrintable);
    if (items.length === 0) return;
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "in", format: [4, 6], orientation: "portrait" });
    const cx = 2; // horizontal center of a 4in-wide page
    const logoCache = new Map<string, { dataUrl: string; w: number; h: number } | null>();

    for (let i = 0; i < items.length; i++) {
      const l = items[i];
      if (i > 0) doc.addPage([4, 6], "portrait");
      doc.setTextColor(0, 0, 0);

      // Logo (centered, top). Cached per brand so we fetch each once.
      if (l.brand) {
        const src = brandLogoSrc(l.brand);
        let logo = src ? logoCache.get(src) : null;
        if (src && !logoCache.has(src)) { logo = await loadImageForPdf(src); logoCache.set(src, logo); }
        if (logo) {
          const maxW = 3.4, maxH = 1.1;
          let w = maxW, h = (w * logo.h) / logo.w;
          if (h > maxH) { h = maxH; w = (h * logo.w) / logo.h; }
          doc.addImage(logo.dataUrl, "PNG", cx - w / 2, 0.45, w, h);
        }
      }

      // Brand / model / size (flowing down the upper-middle).
      let y = 2.05;
      if (l.brand) { doc.setFont("helvetica", "bold"); doc.setFontSize(30); doc.text(l.brand, cx, y, { align: "center", maxWidth: 3.7 }); y += 0.5; }
      if (l.model) { doc.setFont("helvetica", "normal"); doc.setFontSize(18); doc.text(l.model, cx, y, { align: "center", maxWidth: 3.7 }); y += 0.4; }
      if (l.sizeDesc) { doc.setFont("helvetica", "normal"); doc.setFontSize(15); doc.text(l.sizeDesc, cx, y, { align: "center", maxWidth: 3.7 }); }

      // Barcode(s). Primary = MPN (+ d-class) for an exact scan match. Optionally a
      // second Item-ID barcode for inventory; when both show they stack with captions.
      const drawBarcode = (value: string, caption: string, topY: number, maxH: number) => {
        const bc = barcodePngForPdf(value);
        if (!bc) return;
        let bw = 3.4, bh = (bw * bc.h) / bc.w;
        if (bh > maxH) { bh = maxH; bw = (bh * bc.w) / bc.h; }
        if (caption) {
          doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(90, 90, 90);
          doc.text(caption, cx, topY, { align: "center" });
        }
        doc.setTextColor(0, 0, 0);
        doc.addImage(bc.dataUrl, "PNG", cx - bw / 2, topY + (caption ? 0.13 : 0), bw, bh);
      };
      const barcodeVal = tireBarcodeValue(l);
      const itemIdVal = (l.itemId ?? "").trim();
      const showItemId = includeItemId && !!itemIdVal && itemIdVal !== barcodeVal;
      if (barcodeVal && showItemId) {
        drawBarcode(barcodeVal, "MPN", 3.40, 0.85);
        drawBarcode(itemIdVal, "ITEM ID", 4.55, 0.85);
      } else if (barcodeVal) {
        drawBarcode(barcodeVal, "", 4.25, 1.2);
      } else if (showItemId) {
        drawBarcode(itemIdVal, "ITEM ID", 4.25, 1.2);
      }

      // Accountability footer.
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(110, 110, 110);
      doc.text(labelFooter, cx, 5.8, { align: "center" });
    }

    // Print via a hidden iframe (no popup-blocker issues after the async build).
    // The blob: URL must be allowed by the CSP frame-src directive (see next.config.ts).
    const url = doc.output("bloburl") as unknown as string;
    const iframe = document.createElement("iframe");
    Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
    iframe.src = url;
    iframe.onload = () => {
      setTimeout(() => { try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { /* ignore */ } }, 400);
    };
    document.body.appendChild(iframe);
    setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* ignore */ } }, 120000);
  };

  return (
    <Protected>
      <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
        <Sidebar />
        <main className="flex-1 overflow-auto print:overflow-visible">
          <MobileHeader />

          {/* Header - Hidden when printing */}
          <header className="sticky top-0 z-10 px-4 sm:px-8 py-3 sm:py-4 border-b print:hidden no-print bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-gray-200 dark:border-slate-700">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">
                  {isTire ? "Tire Label Printer" : "Bin Label Printer"}
                </h1>
                <p className="text-xs sm:text-sm mt-1 theme-text-tertiary">
                  {isTire
                    ? 'Print replacement labels for tires missing them (4" × 6" shipping labels)'
                    : 'Generate Code 128 barcode labels for warehouse bins (6" × 2" thermal labels)'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                {/* Mode toggle - segmented control */}
                <div className="flex items-center p-1 rounded-lg bg-gray-100 dark:bg-slate-700">
                  {(["bin", "tire"] as Mode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        mode === m
                          ? "bg-white dark:bg-cyan-500 text-gray-900 dark:text-white shadow-sm"
                          : "text-gray-500 dark:text-slate-300 hover:text-gray-700 dark:hover:text-white"
                      }`}
                    >
                      {m === "bin" ? "Bin Labels" : "Tire Labels"}
                    </button>
                  ))}
                </div>

                <Button variant="secondary" onClick={clearAll}>
                  Clear All
                </Button>

                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    onClick={handlePrint}
                    disabled={!canPrint}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Print Labels
                  </Button>

                  {/* Print Setup Tips tooltip */}
                  <div className="relative group">
                    <button className="p-2 rounded-[9px] text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-700">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                    <div className="absolute right-0 top-full mt-2 w-72 p-4 rounded-xl shadow-xl border z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all theme-card">
                      <p className="font-semibold mb-2 theme-text-primary">Print Setup Tips:</p>
                      <ol className="text-sm space-y-1.5 theme-text-secondary">
                        <li>1. Select your label printer</li>
                        <li>2. Set paper size to <strong>{isTire ? '4" × 6"' : '50 × 170 mm'}</strong></li>
                        <li>3. Set margins to <strong>None</strong></li>
                        <li>4. Disable headers/footers</li>
                        <li>5. Set scale to <strong>100%</strong></li>
                      </ol>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </header>

          <div className="p-4 sm:p-6 space-y-4 print:p-0">
            {mode === "bin" && (
              <>
                {/* Bin Label Details Card - Hidden when printing */}
                <Card className="print:hidden no-print">
                  <SectionHeader
                    title="Label Details"
                    actions={
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2">
                          <label className="text-sm font-medium theme-text-secondary whitespace-nowrap">
                            Orientation:
                          </label>
                          <div className="inline-flex rounded-lg border theme-border-secondary overflow-hidden">
                            <button
                              type="button"
                              onClick={() => setBinOrientation("landscape")}
                              className={`px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                                binOrientation === "landscape"
                                  ? "bg-[#007AFF] text-white"
                                  : "theme-card theme-text-secondary"
                              }`}
                            >
                              Landscape
                            </button>
                            <button
                              type="button"
                              onClick={() => setBinOrientation("portrait")}
                              className={`px-3 py-1.5 text-sm font-semibold whitespace-nowrap border-l theme-border-secondary transition-colors ${
                                binOrientation === "portrait"
                                  ? "bg-[#007AFF] text-white"
                                  : "theme-card theme-text-secondary"
                              }`}
                            >
                              Portrait
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-sm font-medium theme-text-secondary whitespace-nowrap">
                            Copies per label:
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="50"
                            value={copies}
                            onChange={(e) => setCopies(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                            className="theme-input w-20 px-3 py-1.5 text-center"
                          />
                        </div>
                        <Button variant="secondary" onClick={addLabel}>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          Add Label
                        </Button>
                      </div>
                    }
                  />

                  <div className="space-y-3">
                    {labels.map((label, index) => (
                      <div
                        key={index}
                        className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 rounded-xl bg-[#f2f2f7] dark:bg-slate-700/50"
                      >
                        <span className="text-sm font-medium w-8 theme-text-tertiary">
                          #{index + 1}
                        </span>
                        <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                          <div>
                            <label className="block text-xs font-medium mb-1 theme-text-tertiary">
                              Location ID (Barcode Value)
                            </label>
                            <input
                              type="text"
                              value={label.locationId}
                              onChange={(e) => updateLabel(index, "locationId", e.target.value.toUpperCase())}
                              placeholder="e.g., A01-B02-C03"
                              className="theme-input w-full font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1 theme-text-tertiary">
                              Location Name (Human Readable)
                            </label>
                            <input
                              type="text"
                              value={label.locationName}
                              onChange={(e) => updateLabel(index, "locationName", e.target.value)}
                              placeholder="e.g., Aisle 1, Bay 2, Shelf 3"
                              className="theme-input w-full"
                            />
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeLabel(index)}
                          disabled={labels.length === 1}
                          className="text-gray-400 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </Button>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Bin Preview Card - Hidden when printing */}
                <Card className="print:hidden no-print">
                  <SectionHeader
                    title={`Print Preview (${labelsWithCopies.filter(l => l.locationId).length} label${labelsWithCopies.filter(l => l.locationId).length !== 1 ? "s" : ""})`}
                    actions={
                      <span className="text-sm theme-text-tertiary">
                        Actual size: {binOrientation === "portrait" ? "50 × 170 mm (portrait)" : "170 × 50 mm (landscape)"}
                      </span>
                    }
                  />

                  {labels.some(l => l.locationId) ? (
                    <div className="p-4 sm:p-8 rounded-xl overflow-x-auto bg-[#f2f2f7] dark:bg-slate-900/50">
                      <div className="flex flex-col gap-6 items-center min-w-min">
                        {labels.map((label, index) => (
                          label.locationId && (
                            <div key={index} className="flex flex-col items-center w-full">
                              <span className="text-xs font-medium mb-2 theme-text-tertiary">
                                Label #{index + 1} {copies > 1 && `(×${copies})`}
                              </span>

                              {/* Scale wrapper: on small screens shrink to fit container */}
                              <div className="w-full overflow-hidden flex justify-center">
                              <div
                                className="origin-top scale-[0.58] sm:scale-100"
                                style={{
                                  width: binOrientation === "portrait" ? 192 : 576,
                                  height: binOrientation === "portrait" ? 576 : 192,
                                  flexShrink: 0,
                                }}
                              >

                              {/* Thermal label mockup - 2" x 6" (orientation-aware) */}
                              <div
                                className="relative bg-white shadow-xl rounded-sm"
                                style={{
                                  width: binOrientation === "portrait" ? "192px" : "576px",
                                  height: binOrientation === "portrait" ? "576px" : "192px",
                                  boxShadow: "0 4px 20px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)"
                                }}
                              >
                                {/* Label edge styling */}
                                <div
                                  className="absolute inset-0 rounded-sm"
                                  style={{
                                    background: "linear-gradient(to right, #fafafa 0%, #ffffff 2%, #ffffff 98%, #f5f5f5 100%)",
                                  }}
                                />

                                {/* Label content — stacked (portrait) or side-by-side (landscape) */}
                                <div
                                  className={`relative h-full flex items-center justify-center gap-6 text-black ${
                                    binOrientation === "portrait" ? "flex-col py-6 px-4" : "px-6"
                                  }`}
                                >
                                  {binOrientation === "portrait" && label.locationName && (
                                    <div className="text-center flex-shrink-0">
                                      <p className="text-2xl font-bold leading-tight text-black">{label.locationName}</p>
                                    </div>
                                  )}

                                  {/* Barcode — rotated 90° in portrait so it runs down the label */}
                                  {binOrientation === "portrait" ? (
                                    <div
                                      className="flex-shrink-0 flex items-center justify-center overflow-hidden"
                                      style={{ width: 150, height: 340 }}
                                    >
                                      <svg
                                        ref={(el) => { barcodeRefs.current[index] = el; }}
                                        style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
                                      />
                                    </div>
                                  ) : (
                                    <svg
                                      ref={(el) => { barcodeRefs.current[index] = el; }}
                                      className="flex-shrink-0"
                                    />
                                  )}

                                  {/* Location name (landscape: to the right of the barcode) */}
                                  {binOrientation !== "portrait" && label.locationName && (
                                    <div className="text-center flex-shrink-0">
                                      <p className="text-2xl font-bold leading-tight text-black">{label.locationName}</p>
                                    </div>
                                  )}
                                </div>

                                {/* Subtle perforation line indicators */}
                                <div className="absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-gray-200 to-transparent" />
                                <div className="absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-gray-200 to-transparent" />
                              </div>
                              </div>{/* scale wrapper inner */}
                              </div>{/* scale wrapper outer */}
                            </div>
                          )
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-16 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/50">
                      <svg className="w-20 h-20 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                      </svg>
                      <p className="text-lg font-medium theme-text-secondary">
                        Enter a Location ID to preview label
                      </p>
                      <p className="text-sm mt-1 theme-text-tertiary">
                        The barcode will be generated using Code 128 format
                      </p>
                    </div>
                  )}
                </Card>
              </>
            )}

            {mode === "tire" && (
              <>
                {/* Tire Input Form Card - Hidden when printing */}
                <div ref={tireFormRef}>
                <Card className="print:hidden no-print">
                  <SectionHeader
                    title="Tire Details"
                    actions={
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-sm theme-text-tertiary">
                          Set <strong>Qty</strong> on each tire for the number of copies
                        </span>
                        <label className="flex items-center gap-2 text-sm cursor-pointer theme-text-secondary">
                          <input
                            type="checkbox"
                            checked={includeItemId}
                            onChange={(e) => setIncludeItemId(e.target.checked)}
                            className="w-4 h-4 accent-cyan-500"
                          />
                          Add Item&nbsp;ID barcode
                        </label>
                        <Button variant="secondary" onClick={addTireLabel}>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          Add Tire
                        </Button>
                      </div>
                    }
                  />

                  {/* Save as Work Order */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5 pb-5 border-b theme-border-secondary">
                    <input
                      type="text"
                      value={woTitle}
                      onChange={(e) => setWoTitle(e.target.value)}
                      placeholder="Work order name (optional — will prompt if blank)"
                      className="theme-input flex-1"
                    />
                    <Button
                      variant="primary"
                      onClick={saveWorkOrder}
                      disabled={!tireLabels.some(tireIsPrintable) || woSaving}
                      className="whitespace-nowrap bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {woSaving ? "Saving…" : "Save as Work Order"}
                    </Button>
                    {woSaved && (
                      <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                        Saved ✓
                      </span>
                    )}
                  </div>

                  <div className="space-y-4">
                    {tireLabels.map((label, index) => (
                      <div
                        key={index}
                        className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 p-4 rounded-xl bg-[#f2f2f7] dark:bg-slate-700/50"
                      >
                        <span className="text-sm font-medium w-8 pt-2 theme-text-tertiary">
                          #{index + 1}
                        </span>
                        <div className="flex-1 space-y-4">
                          {/* Find tire by sidewall (brand/size/model) — for untagged tires */}
                          <TireSearchBox isDark={isDark} onSelect={(r) => fillTireFromSearch(index, r)} />
                          <div className="flex items-center gap-2 text-xs theme-text-tertiary">
                            <span className="flex-1 border-t theme-border-secondary" />
                            or enter Item ID
                            <span className="flex-1 border-t theme-border-secondary" />
                          </div>
                          {/* Item ID + Look up */}
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="flex-1 min-w-[180px]">
                              <label className="block text-xs font-medium mb-1 theme-text-tertiary">
                                Item ID (for lookup)
                              </label>
                              <input
                                type="text"
                                value={label.itemId}
                                onChange={(e) => updateTireLabel(index, "itemId", e.target.value.toUpperCase())}
                                placeholder="e.g., 12345"
                                className="theme-input w-full font-mono"
                              />
                            </div>
                            <Button
                              variant="primary"
                              onClick={() => lookupTire(index)}
                              disabled={!label.itemId.trim() || lookupLoading === index}
                            >
                              {lookupLoading === index ? "Looking up…" : "Look up"}
                            </Button>
                            <div>
                              <label className="block text-xs font-medium mb-1 text-center theme-text-tertiary">
                                Qty
                              </label>
                              <input
                                type="number"
                                min="1"
                                max="99"
                                value={label.qty}
                                onChange={(e) => updateTireQty(index, parseInt(e.target.value, 10))}
                                title="Number of copies of this label to print"
                                className="theme-input w-16 text-center font-medium"
                              />
                            </div>
                          </div>
                          {lookupNotFound[index] && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                              Not found — enter manually below.
                            </p>
                          )}
                          {/* Brand / Model / Size */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                            <div>
                              <label className="block text-xs font-medium mb-1 theme-text-tertiary">
                                Brand
                              </label>
                              <input
                                type="text"
                                value={label.brand}
                                onChange={(e) => updateTireLabel(index, "brand", e.target.value)}
                                placeholder="e.g., Goodyear"
                                className="theme-input w-full"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium mb-1 theme-text-tertiary">
                                Model
                              </label>
                              <input
                                type="text"
                                value={label.model}
                                onChange={(e) => updateTireLabel(index, "model", e.target.value)}
                                placeholder="e.g., Assurance MaxLife"
                                className="theme-input w-full"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium mb-1 theme-text-tertiary">
                                Size / Description
                              </label>
                              <input
                                type="text"
                                value={label.sizeDesc}
                                onChange={(e) => updateTireLabel(index, "sizeDesc", e.target.value)}
                                placeholder="e.g., 215/55R17 94V"
                                className="theme-input w-full"
                              />
                            </div>
                          </div>
                          {/* MPN — this is what prints AS the barcode. Auto-filled by search/lookup; editable. */}
                          <div>
                            <label className="block text-xs font-medium mb-1 theme-text-tertiary">
                              MPN (prints as barcode)
                            </label>
                            <input
                              type="text"
                              value={label.mpn}
                              onChange={(e) => updateTireLabel(index, "mpn", e.target.value.toUpperCase())}
                              placeholder="Auto-filled from lookup — falls back to Item ID if blank"
                              className="theme-input w-full font-mono"
                            />
                          </div>
                          {/* D-Class — appended to the barcode so it scans exactly (AB1234 -> AB1234[) */}
                          <div>
                            <label className="block text-xs font-medium mb-1 theme-text-tertiary">
                              D-Class (barcode suffix)
                            </label>
                            <select
                              value={label.dclass}
                              onChange={(e) => updateTireLabel(index, "dclass", e.target.value)}
                              className="theme-input w-full"
                            >
                              {DCLASS_OPTIONS.map((o) => (
                                <option key={o.name} value={o.symbol}>{o.name}</option>
                              ))}
                            </select>
                            {tireBarcodeValue(label) && (
                              <p className="mt-1 text-xs font-mono text-blue-600 dark:text-cyan-400">
                                Barcode: {tireBarcodeValue(label)}
                              </p>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeTireLabel(index)}
                          disabled={tireLabels.length === 1}
                          className="mt-6 text-gray-400 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </Button>
                      </div>
                    ))}
                  </div>
                </Card>
                </div>

                {/* Tire Preview Card - Hidden when printing */}
                <div ref={tirePreviewRef}>
                <Card className="print:hidden no-print">
                  <SectionHeader
                    title={`Print Preview (${tireLabelsWithCopies.filter(tireIsPrintable).length} label${tireLabelsWithCopies.filter(tireIsPrintable).length !== 1 ? "s" : ""})`}
                    actions={
                      <span className="text-sm theme-text-tertiary">Actual size: 4&quot; × 6&quot; (portrait)</span>
                    }
                  />

                  {tireLabels.some(tireIsPrintable) ? (
                    <div className="p-4 sm:p-8 rounded-xl overflow-x-auto bg-[#f2f2f7] dark:bg-slate-900/50">
                      <div className="flex flex-wrap gap-6 items-start justify-center min-w-min">
                        {tireLabels.map((label, index) => (
                          tireIsPrintable(label) && (
                            <div key={index} className="flex flex-col items-center w-full">
                              <span className="text-xs font-medium mb-2 theme-text-tertiary">
                                Label #{index + 1} {(label.qty || 1) > 1 && `(×${label.qty} copies)`}
                              </span>

                              {/* Scale wrapper: on small screens shrink to fit container */}
                              <div className="w-full overflow-hidden flex justify-center">
                              <div className="origin-top scale-[0.87] sm:scale-100" style={{ width: 384, height: 576, flexShrink: 0 }}>

                              {/* Shipping label mockup - PORTRAIT 4" x 6" */}
                              <div
                                className="relative bg-white shadow-xl rounded-sm"
                                style={{
                                  width: "384px",  // 4 inches at 96dpi
                                  height: "576px", // 6 inches at 96dpi
                                  boxShadow: "0 4px 20px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)",
                                }}
                              >
                                <div className="relative h-full flex flex-col items-center justify-center gap-4 px-6 text-center text-black">
                                  {label.brand && (
                                    <div className="flex flex-col items-center gap-2">
                                      {brandLogoSrc(label.brand) && (
                                        <img
                                          src={brandLogoSrc(label.brand)!}
                                          alt={label.brand}
                                          onError={(e) => {
                                            (e.currentTarget as HTMLImageElement).style.display = "none";
                                          }}
                                          style={{ maxHeight: "90px", maxWidth: "320px", objectFit: "contain" }}
                                        />
                                      )}
                                      <p className="text-4xl font-bold leading-tight text-black">{label.brand}</p>
                                    </div>
                                  )}
                                  {label.model && (
                                    <p className="text-2xl font-medium leading-tight text-black">{label.model}</p>
                                  )}
                                  {label.sizeDesc && (
                                    <p className="text-xl font-medium leading-snug text-black">{label.sizeDesc}</p>
                                  )}
                                  {(() => {
                                    const itemIdVal = (label.itemId ?? "").trim();
                                    const showItemId = includeItemId && !!itemIdVal && itemIdVal !== tireBarcodeValue(label);
                                    return (
                                      <>
                                        {tireBarcodeValue(label) && (
                                          <div className="flex flex-col items-center mt-4">
                                            {showItemId && <span className="text-[11px] font-semibold text-gray-500">MPN</span>}
                                            <svg
                                              ref={(el) => { tireBarcodeRefs.current[index] = el; }}
                                              style={{ maxWidth: "100%", height: "auto" }}
                                            />
                                          </div>
                                        )}
                                        {showItemId && (
                                          <div className="flex flex-col items-center mt-2">
                                            <span className="text-[11px] font-semibold text-gray-500">ITEM ID</span>
                                            <svg
                                              ref={(el) => { tireItemIdBarcodeRefs.current[index] = el; }}
                                              style={{ maxWidth: "100%", height: "auto" }}
                                            />
                                          </div>
                                        )}
                                      </>
                                    );
                                  })()}
                                </div>
                                <div style={{ position: "absolute", bottom: "8px", left: 0, right: 0, fontSize: "10px", color: "#666" }}>{labelFooter}</div>
                              </div>
                              </div>{/* scale wrapper inner */}
                              </div>{/* scale wrapper outer */}
                            </div>
                          )
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-16 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/50">
                      <svg className="w-20 h-20 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                      </svg>
                      <p className="text-lg font-medium theme-text-secondary">
                        Enter an Item ID or Brand to preview label
                      </p>
                      <p className="text-sm mt-1 theme-text-tertiary">
                        Use &quot;Look up&quot; to auto-fill, or type details manually
                      </p>
                    </div>
                  )}
                </Card>
                </div>

                {/* Work Orders Panel - Hidden when printing */}
                <Card className="print:hidden no-print">
                  <SectionHeader
                    title="Work Orders"
                    actions={
                      <span className="text-sm theme-text-tertiary">
                        {workOrders ? `${workOrders.length} saved` : "Loading…"}
                      </span>
                    }
                  />

                  {workOrders === undefined ? (
                    <div className="text-center py-10 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/50 theme-text-tertiary">
                      Loading work orders…
                    </div>
                  ) : workOrders.length === 0 ? (
                    <div className="text-center py-10 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/50">
                      <p className="text-sm font-medium theme-text-secondary">
                        No saved work orders yet.
                      </p>
                      <p className="text-xs mt-1 theme-text-tertiary">
                        Fill in tire details above and click &quot;Save as Work Order&quot;.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(workOrders as WorkOrderRow[]).map((wo) => {
                        const isPrinted = wo.status === "printed";
                        const isLoaded = loadedWorkOrderId === wo._id;
                        return (
                          <div
                            key={wo._id}
                            className={`flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 rounded-xl bg-[#f2f2f7] dark:bg-slate-700/50 ${isLoaded ? "ring-2 ring-blue-500 dark:ring-cyan-500" : ""}`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold truncate theme-text-primary">
                                  {wo.title}
                                </p>
                                {isPrinted ? (
                                  <span className="ui-badge ui-badge-green">
                                    Printed{wo.printedByName ? ` · ${wo.printedByName}` : ""}
                                  </span>
                                ) : (
                                  <span className="ui-badge ui-badge-amber">
                                    Open
                                  </span>
                                )}
                              </div>
                              <p className="text-xs mt-1 theme-text-tertiary">
                                {wo.labels.length} tire{wo.labels.length !== 1 ? "s" : ""} · {wo.labels.reduce((s, l) => s + (l.qty ?? wo.copies ?? 1), 0)} labels · {wo.createdByName} · {formatWoDate(wo.createdAt)}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 sm:flex-shrink-0">
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => loadWorkOrder(wo)}
                              >
                                Open to print/edit
                              </Button>
                              {!isPrinted && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => handleMarkPrinted(wo._id)}
                                >
                                  Mark printed
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteWorkOrder(wo._id, wo.title)}
                                aria-label="Delete work order"
                                className="text-gray-400 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </>
            )}
          </div>
        </main>
      </div>

      {mounted &&
        createPortal(
          <div id="print-root">
            {mode === "bin" &&
              labelsWithCopies.map((label, index) =>
                label.locationId ? (
                  <div key={index} className="print-label">
                    <PrintBarcode locationId={label.locationId} locationName={label.locationName} />
                  </div>
                ) : null,
              )}
            {mode === "tire" &&
              tireLabelsWithCopies.map((label, index) =>
                tireIsPrintable(label) ? (
                  <div key={index} className="print-tire-label">
                    <PrintTireLabel barcodeValue={tireBarcodeValue(label)} brand={label.brand} model={label.model} sizeDesc={label.sizeDesc} footer={labelFooter} />
                  </div>
                ) : null,
              )}
          </div>,
          document.body,
        )}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            #print-root { display: none; }
            @media print {
              @page { size: ${isTire ? "4in 6in" : "6in 2in"}; margin: 0; }
              html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
              body > :not(#print-root) { display: none !important; }
              #print-root { display: block !important; }
              #print-root .print-label, #print-root .print-tire-label {
                width: ${isTire ? "4in" : "6in"} !important;
                height: ${isTire ? "6in" : "2in"} !important;
                page-break-after: always; page-break-inside: avoid;
                display: flex; align-items: center; justify-content: center;
                overflow: hidden; background: #fff; margin: 0; padding: 0;
              }
              #print-root > :last-child { page-break-after: auto !important; }
              #print-root svg { display: block !important; }
              #print-root * { color: #000 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            }
          `,
        }}
      />
    </Protected>
  );
}

// Separate component for print barcodes
function PrintBarcode({ locationId, locationName }: { locationId: string; locationName: string }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current && locationId) {
      JsBarcode(svgRef.current, locationId, {
        format: "CODE128",
        width: 3,
        height: 70,
        displayValue: true,
        fontSize: 18,
        font: "monospace",
        textMargin: 5,
        margin: 5,
      });
    }
  }, [locationId]);

  return (
    <div className="flex items-center justify-center gap-8 h-full text-black w-full">
      <svg ref={svgRef} className="flex-shrink-0" />
      {locationName && (
        <div className="text-center flex-shrink-0">
          <p style={{ fontSize: "24px", fontWeight: "bold", lineHeight: 1.2 }}>{locationName}</p>
        </div>
      )}
    </div>
  );
}

// Separate component for print tire labels (4" x 6" portrait)
// Make a JsBarcode-rendered SVG scale down to fit its container (never overflow the
// label) for long item-IDs, while keeping its natural size for short ones. We add a
// viewBox (so it scales proportionally) but KEEP the width/height attributes so the
// SVG still has an intrinsic size — then cap it with CSS max-width:100% + height:auto.
function fitBarcode(svg: SVGSVGElement | null) {
  if (!svg) return;
  const w = svg.getAttribute("width");
  const h = svg.getAttribute("height");
  if (!w || !h) return;
  if (!svg.getAttribute("viewBox")) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";
}

function PrintTireLabel({
  barcodeValue,
  brand,
  model,
  sizeDesc,
  footer,
}: {
  barcodeValue: string;
  brand: string;
  model: string;
  sizeDesc: string;
  footer?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current && barcodeValue) {
      JsBarcode(svgRef.current, barcodeValue, {
        format: "CODE128",
        width: 2,          // narrow bars so a long item-ID fits within the 4" label width
        height: 70,
        displayValue: true,
        fontSize: 18,
        font: "monospace",
        textMargin: 4,
        margin: 4,
      });
      fitBarcode(svgRef.current); // scale to label width so long values never overhang
    }
  }, [barcodeValue]);

  return (
    <div
      className="flex flex-col items-center justify-center gap-3 text-center text-black px-4"
      style={{ width: "4in", height: "6in", overflow: "hidden", boxSizing: "border-box", position: "relative" }}
    >
      {brand && (
        <div className="flex flex-col items-center" style={{ gap: "8px", maxWidth: "100%" }}>
          {brandLogoSrc(brand) && (
            <img
              src={brandLogoSrc(brand)!}
              alt={brand}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
              style={{ maxHeight: "1in", maxWidth: "3.25in", objectFit: "contain" }}
            />
          )}
          <p style={{ fontSize: "40px", fontWeight: "bold", lineHeight: 1.1, maxWidth: "100%", wordBreak: "break-word" }}>{brand}</p>
        </div>
      )}
      {model && <p style={{ fontSize: "26px", fontWeight: 500, lineHeight: 1.2, maxWidth: "100%", wordBreak: "break-word" }}>{model}</p>}
      {sizeDesc && <p style={{ fontSize: "22px", fontWeight: 500, lineHeight: 1.3, maxWidth: "100%", wordBreak: "break-word" }}>{sizeDesc}</p>}
      {barcodeValue && <svg ref={svgRef} className="flex-shrink-0 mt-1" style={{ maxWidth: "100%", height: "auto" }} />}
      {footer && (
        <div style={{ position: "absolute", bottom: "0.18in", left: 0, right: 0, fontSize: "11px", color: "#444" }}>{footer}</div>
      )}
    </div>
  );
}
