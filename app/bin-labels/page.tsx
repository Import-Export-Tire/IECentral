"use client";

import { useState, useEffect, useRef } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import JsBarcode from "jsbarcode";
import { brandLogoSrc } from "@/lib/brandLogo";

interface LabelData {
  locationId: string;
  locationName: string;
}

interface TireLabelData {
  itemId: string;
  brand: string;
  model: string;
  sizeDesc: string;
}

type Mode = "bin" | "tire";

interface WorkOrderRow {
  _id: string;
  title: string;
  labels: TireLabelData[];
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
  const [labels, setLabels] = useState<LabelData[]>([{ locationId: "", locationName: "" }]);
  const [tireLabels, setTireLabels] = useState<TireLabelData[]>([
    { itemId: "", brand: "", model: "", sizeDesc: "" },
  ]);
  const [copies, setCopies] = useState(1);
  const [lookupLoading, setLookupLoading] = useState<number | null>(null);
  const [lookupNotFound, setLookupNotFound] = useState<Record<number, boolean>>({});
  const barcodeRefs = useRef<(SVGSVGElement | null)[]>([]);
  const tireBarcodeRefs = useRef<(SVGSVGElement | null)[]>([]);
  const tirePreviewRef = useRef<HTMLDivElement>(null);

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
  }, [labels]);

  // Generate tire barcodes when tire labels change
  useEffect(() => {
    tireLabels.forEach((label, index) => {
      if (label.itemId && tireBarcodeRefs.current[index]) {
        try {
          JsBarcode(tireBarcodeRefs.current[index], label.itemId, {
            format: "CODE128",
            width: 2.5,
            height: 70,
            displayValue: true,
            fontSize: 18,
            font: "monospace",
            textMargin: 5,
            margin: 5,
          });
        } catch (e) {
          console.error("Tire barcode generation error:", e);
        }
      }
    });
  }, [tireLabels]);

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
    setTireLabels([...tireLabels, { itemId: "", brand: "", model: "", sizeDesc: "" }]);
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

  const updateTireLabel = (index: number, field: keyof TireLabelData, value: string) => {
    const newLabels = [...tireLabels];
    newLabels[index] = { ...newLabels[index], [field]: value };
    setTireLabels(newLabels);
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
          brand: data.manufacturerName || "",
          model: data.model || "",
          sizeDesc: data.description || "",
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

  const handlePrint = () => {
    window.print();
  };

  const clearAll = () => {
    if (mode === "bin") {
      setLabels([{ locationId: "", locationName: "" }]);
    } else {
      setTireLabels([{ itemId: "", brand: "", model: "", sizeDesc: "" }]);
      setLookupNotFound({});
    }
    setCopies(1);
  };

  const userName = user?.name ?? user?.email ?? "Unknown";

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

  const loadWorkOrder = (wo: { _id: string; labels: TireLabelData[]; copies: number }) => {
    setTireLabels(wo.labels.map((l) => ({ ...l })));
    setCopies(wo.copies);
    setLoadedWorkOrderId(wo._id);
    setLookupNotFound({});
    setTimeout(() => {
      tirePreviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  // Generate labels with copies
  const labelsWithCopies = labels.flatMap((label) => Array(copies).fill(label));
  const tireLabelsWithCopies = tireLabels.flatMap((label) => Array(copies).fill(label));

  const tireIsPrintable = (l: TireLabelData) => Boolean(l.itemId || l.brand);
  const canPrint =
    mode === "bin"
      ? labels.some((l) => l.locationId)
      : tireLabels.some(tireIsPrintable);

  const isTire = mode === "tire";

  return (
    <Protected>
      <div className={`flex h-screen theme-bg-primary`}>
        <Sidebar />
        <main className="flex-1 overflow-auto print:overflow-visible">
          <MobileHeader />
          {/* Header - Hidden when printing */}
          <header className={`sticky top-0 z-10 p-6 border-b print:hidden no-print ${isDark ? "bg-slate-900/95 backdrop-blur border-slate-700" : "bg-[#f2f2f7]/95 backdrop-blur border-gray-200"}`}>
            <div className="flex items-center justify-between">
              <div>
                <h1 className={`text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                  {isTire ? "Tire Label Printer" : "Bin Label Printer"}
                </h1>
                <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  {isTire
                    ? 'Print replacement labels for tires missing them (4" × 6" shipping labels)'
                    : 'Generate Code 128 barcode labels for warehouse bins (6" × 2" thermal labels)'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {/* Mode toggle - segmented control */}
                <div className={`flex items-center p-1 rounded-lg ${isDark ? "bg-slate-700" : "bg-gray-100"}`}>
                  {(["bin", "tire"] as Mode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        mode === m
                          ? isDark
                            ? "bg-cyan-500 text-white"
                            : "bg-white text-gray-900 shadow-sm"
                          : isDark
                            ? "text-slate-300 hover:text-white"
                            : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      {m === "bin" ? "Bin Labels" : "Tire Labels"}
                    </button>
                  ))}
                </div>
                <button
                  onClick={clearAll}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
                >
                  Clear All
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handlePrint}
                    disabled={!canPrint}
                    className={`px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                      canPrint
                        ? isDark
                          ? "bg-cyan-500 hover:bg-cyan-400 text-white"
                          : "bg-blue-600 hover:bg-blue-700 text-white"
                        : "bg-gray-300 text-gray-500 cursor-not-allowed"
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Print Labels
                  </button>
                  <div className="relative group">
                    <button className={`p-2 rounded-lg ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-700" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                    <div className={`absolute right-0 top-full mt-2 w-72 p-4 rounded-lg shadow-xl border z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all ${isDark ? "bg-slate-800 border-slate-600" : "bg-white border-gray-200"}`}>
                      <p className={`font-semibold mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>Print Setup Tips:</p>
                      <ol className={`text-sm space-y-1.5 ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                        <li>1. Select your label printer</li>
                        <li>2. Set paper size to <strong>{isTire ? '4" × 6"' : '6" × 2"'}</strong></li>
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

          <div className="p-6 print:p-0">
            {mode === "bin" && (
              <>
                {/* Input Form - Hidden when printing */}
                <div className={`rounded-xl p-6 mb-6 print:hidden no-print ${isDark ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                      Label Details
                    </h2>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <label className={`text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          Copies per label:
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="50"
                          value={copies}
                          onChange={(e) => setCopies(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                          className={`w-20 px-3 py-1.5 rounded-lg text-center ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                        />
                      </div>
                      <button
                        onClick={addLabel}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add Label
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {labels.map((label, index) => (
                      <div
                        key={index}
                        className={`flex items-center gap-4 p-4 rounded-lg ${isDark ? "bg-slate-700/50" : "bg-gray-50"}`}
                      >
                        <span className={`text-sm font-medium w-8 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          #{index + 1}
                        </span>
                        <div className="flex-1 grid grid-cols-2 gap-4">
                          <div>
                            <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              Location ID (Barcode Value)
                            </label>
                            <input
                              type="text"
                              value={label.locationId}
                              onChange={(e) => updateLabel(index, "locationId", e.target.value.toUpperCase())}
                              placeholder="e.g., A01-B02-C03"
                              className={`w-full px-4 py-2 rounded-lg font-mono ${isDark ? "bg-slate-800 border-slate-600 text-white placeholder-slate-500" : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                            />
                          </div>
                          <div>
                            <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              Location Name (Human Readable)
                            </label>
                            <input
                              type="text"
                              value={label.locationName}
                              onChange={(e) => updateLabel(index, "locationName", e.target.value)}
                              placeholder="e.g., Aisle 1, Bay 2, Shelf 3"
                              className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-800 border-slate-600 text-white placeholder-slate-500" : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                            />
                          </div>
                        </div>
                        <button
                          onClick={() => removeLabel(index)}
                          disabled={labels.length === 1}
                          className={`p-2 rounded-lg transition-colors ${
                            labels.length === 1
                              ? "opacity-30 cursor-not-allowed"
                              : isDark
                                ? "hover:bg-slate-600 text-slate-400 hover:text-red-400"
                                : "hover:bg-gray-200 text-gray-400 hover:text-red-500"
                          }`}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Preview Section - Hidden when printing */}
                <div className={`rounded-xl p-6 print:hidden no-print ${isDark ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                      Print Preview ({labelsWithCopies.filter(l => l.locationId).length} label{labelsWithCopies.filter(l => l.locationId).length !== 1 ? "s" : ""})
                    </h2>
                    <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Actual size: 6" × 2" (horizontal)
                    </span>
                  </div>

                  {labels.some(l => l.locationId) ? (
                    <div className={`p-8 rounded-lg ${isDark ? "bg-slate-900/50" : "bg-gray-100"}`}>
                      <div className="flex flex-col gap-6 items-center">
                        {labels.map((label, index) => (
                          label.locationId && (
                            <div key={index} className="flex flex-col items-center">
                              {/* Label number indicator */}
                              <span className={`text-xs font-medium mb-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                                Label #{index + 1} {copies > 1 && `(×${copies})`}
                              </span>

                              {/* Thermal label mockup - HORIZONTAL 6" x 2" */}
                              <div
                                className="relative bg-white shadow-xl rounded-sm"
                                style={{
                                  width: "576px",  // 6 inches at 96dpi
                                  height: "192px", // 2 inches at 96dpi
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

                                {/* Label content - horizontal layout */}
                                <div className="relative h-full flex items-center justify-center gap-6 px-6 text-black">
                                  {/* Barcode */}
                                  <svg
                                    ref={(el) => { barcodeRefs.current[index] = el; }}
                                    className="flex-shrink-0"
                                  />

                                  {/* Location name */}
                                  {label.locationName && (
                                    <div className="text-center flex-shrink-0">
                                      <p className="text-2xl font-bold leading-tight text-black">{label.locationName}</p>
                                    </div>
                                  )}
                                </div>

                                {/* Subtle perforation line indicators */}
                                <div className="absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-gray-200 to-transparent" />
                                <div className="absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-gray-200 to-transparent" />
                              </div>
                            </div>
                          )
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className={`text-center py-16 rounded-lg ${isDark ? "bg-slate-900/50" : "bg-gray-100"}`}>
                      <svg className="w-20 h-20 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                      </svg>
                      <p className={`text-lg font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        Enter a Location ID to preview label
                      </p>
                      <p className={`text-sm mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                        The barcode will be generated using Code 128 format
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}

            {mode === "tire" && (
              <>
                {/* Tire Input Form - Hidden when printing */}
                <div className={`rounded-xl p-6 mb-6 print:hidden no-print ${isDark ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                      Tire Details
                    </h2>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <label className={`text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          Copies per label:
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="50"
                          value={copies}
                          onChange={(e) => setCopies(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                          className={`w-20 px-3 py-1.5 rounded-lg text-center ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                        />
                      </div>
                      <button
                        onClick={addTireLabel}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add Tire
                      </button>
                    </div>
                  </div>

                  {/* Save as Work Order */}
                  <div className={`flex items-center gap-3 mb-4 pb-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                    <input
                      type="text"
                      value={woTitle}
                      onChange={(e) => setWoTitle(e.target.value)}
                      placeholder="Work order name (optional — will prompt if blank)"
                      className={`flex-1 px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                    />
                    <button
                      onClick={saveWorkOrder}
                      disabled={!tireLabels.some(tireIsPrintable) || woSaving}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap flex items-center gap-2 ${
                        !tireLabels.some(tireIsPrintable) || woSaving
                          ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                          : isDark
                            ? "bg-emerald-500 hover:bg-emerald-400 text-white"
                            : "bg-emerald-600 hover:bg-emerald-700 text-white"
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {woSaving ? "Saving…" : "Save as Work Order"}
                    </button>
                    {woSaved && (
                      <span className={`text-sm font-medium ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                        Saved ✓
                      </span>
                    )}
                  </div>

                  <div className="space-y-4">
                    {tireLabels.map((label, index) => (
                      <div
                        key={index}
                        className={`flex items-start gap-4 p-4 rounded-lg ${isDark ? "bg-slate-700/50" : "bg-gray-50"}`}
                      >
                        <span className={`text-sm font-medium w-8 pt-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          #{index + 1}
                        </span>
                        <div className="flex-1 space-y-4">
                          {/* Item ID + Look up */}
                          <div className="flex items-end gap-3">
                            <div className="flex-1">
                              <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                Item ID (Barcode Value)
                              </label>
                              <input
                                type="text"
                                value={label.itemId}
                                onChange={(e) => updateTireLabel(index, "itemId", e.target.value.toUpperCase())}
                                placeholder="e.g., 12345"
                                className={`w-full px-4 py-2 rounded-lg font-mono ${isDark ? "bg-slate-800 border-slate-600 text-white placeholder-slate-500" : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                              />
                            </div>
                            <button
                              onClick={() => lookupTire(index)}
                              disabled={!label.itemId.trim() || lookupLoading === index}
                              className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
                                !label.itemId.trim() || lookupLoading === index
                                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                                  : isDark
                                    ? "bg-cyan-500 hover:bg-cyan-400 text-white"
                                    : "bg-blue-600 hover:bg-blue-700 text-white"
                              }`}
                            >
                              {lookupLoading === index ? "Looking up…" : "Look up"}
                            </button>
                          </div>
                          {lookupNotFound[index] && (
                            <p className={`text-xs ${isDark ? "text-amber-400" : "text-amber-600"}`}>
                              Not found — enter manually below.
                            </p>
                          )}
                          {/* Brand / Model / Size */}
                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                Brand
                              </label>
                              <input
                                type="text"
                                value={label.brand}
                                onChange={(e) => updateTireLabel(index, "brand", e.target.value)}
                                placeholder="e.g., Goodyear"
                                className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-800 border-slate-600 text-white placeholder-slate-500" : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                              />
                            </div>
                            <div>
                              <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                Model
                              </label>
                              <input
                                type="text"
                                value={label.model}
                                onChange={(e) => updateTireLabel(index, "model", e.target.value)}
                                placeholder="e.g., Assurance MaxLife"
                                className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-800 border-slate-600 text-white placeholder-slate-500" : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                              />
                            </div>
                            <div>
                              <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                Size / Description
                              </label>
                              <input
                                type="text"
                                value={label.sizeDesc}
                                onChange={(e) => updateTireLabel(index, "sizeDesc", e.target.value)}
                                placeholder="e.g., 215/55R17 94V"
                                className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-800 border-slate-600 text-white placeholder-slate-500" : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                              />
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => removeTireLabel(index)}
                          disabled={tireLabels.length === 1}
                          className={`p-2 mt-6 rounded-lg transition-colors ${
                            tireLabels.length === 1
                              ? "opacity-30 cursor-not-allowed"
                              : isDark
                                ? "hover:bg-slate-600 text-slate-400 hover:text-red-400"
                                : "hover:bg-gray-200 text-gray-400 hover:text-red-500"
                          }`}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Tire Preview Section - Hidden when printing */}
                <div ref={tirePreviewRef} className={`rounded-xl p-6 print:hidden no-print ${isDark ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                      Print Preview ({tireLabelsWithCopies.filter(tireIsPrintable).length} label{tireLabelsWithCopies.filter(tireIsPrintable).length !== 1 ? "s" : ""})
                    </h2>
                    <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Actual size: 4" × 6" (portrait)
                    </span>
                  </div>

                  {tireLabels.some(tireIsPrintable) ? (
                    <div className={`p-8 rounded-lg ${isDark ? "bg-slate-900/50" : "bg-gray-100"}`}>
                      <div className="flex flex-wrap gap-6 items-start justify-center">
                        {tireLabels.map((label, index) => (
                          tireIsPrintable(label) && (
                            <div key={index} className="flex flex-col items-center">
                              <span className={`text-xs font-medium mb-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                                Label #{index + 1} {copies > 1 && `(×${copies})`}
                              </span>

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
                                  {label.itemId && (
                                    <svg
                                      ref={(el) => { tireBarcodeRefs.current[index] = el; }}
                                      className="mt-4"
                                    />
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className={`text-center py-16 rounded-lg ${isDark ? "bg-slate-900/50" : "bg-gray-100"}`}>
                      <svg className="w-20 h-20 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                      </svg>
                      <p className={`text-lg font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        Enter an Item ID or Brand to preview label
                      </p>
                      <p className={`text-sm mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                        Use "Look up" to auto-fill, or type details manually
                      </p>
                    </div>
                  )}
                </div>

                {/* Work Orders Panel - Hidden when printing */}
                <div className={`rounded-xl p-6 mt-6 print:hidden no-print ${isDark ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                      Work Orders
                    </h2>
                    <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      {workOrders ? `${workOrders.length} saved` : "Loading…"}
                    </span>
                  </div>

                  {workOrders === undefined ? (
                    <div className={`text-center py-10 rounded-lg ${isDark ? "bg-slate-900/50 text-slate-400" : "bg-gray-100 text-gray-500"}`}>
                      Loading work orders…
                    </div>
                  ) : workOrders.length === 0 ? (
                    <div className={`text-center py-10 rounded-lg ${isDark ? "bg-slate-900/50" : "bg-gray-100"}`}>
                      <p className={`text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        No saved work orders yet.
                      </p>
                      <p className={`text-xs mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                        Fill in tire details above and click "Save as Work Order".
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
                            className={`flex items-center gap-4 p-4 rounded-lg ${isDark ? "bg-slate-700/50" : "bg-gray-50"} ${isLoaded ? (isDark ? "ring-2 ring-cyan-500" : "ring-2 ring-blue-500") : ""}`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className={`font-semibold truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                                  {wo.title}
                                </p>
                                {isPrinted ? (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                                    Printed{wo.printedByName ? ` · ${wo.printedByName}` : ""}
                                  </span>
                                ) : (
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isDark ? "bg-blue-500/20 text-blue-300" : "bg-amber-100 text-amber-700"}`}>
                                    Open
                                  </span>
                                )}
                              </div>
                              <p className={`text-xs mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                {wo.labels.length} label{wo.labels.length !== 1 ? "s" : ""} · ×{wo.copies} copies · {wo.createdByName} · {formatWoDate(wo.createdAt)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                onClick={() => loadWorkOrder(wo)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isDark ? "bg-cyan-500 hover:bg-cyan-400 text-white" : "bg-blue-600 hover:bg-blue-700 text-white"}`}
                              >
                                Load
                              </button>
                              {!isPrinted && (
                                <button
                                  onClick={() => handleMarkPrinted(wo._id)}
                                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isDark ? "bg-slate-600 hover:bg-slate-500 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
                                >
                                  Mark printed
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteWorkOrder(wo._id, wo.title)}
                                className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-600 text-slate-400 hover:text-red-400" : "hover:bg-gray-200 text-gray-400 hover:text-red-500"}`}
                                aria-label="Delete work order"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Print-Only Labels */}
            <div className="hidden print:block print-labels-container">
              {mode === "bin" &&
                labelsWithCopies.map((label, index) => (
                  label.locationId && (
                    <div key={index} className="print-label">
                      <PrintBarcode locationId={label.locationId} locationName={label.locationName} />
                    </div>
                  )
                ))}
              {mode === "tire" &&
                tireLabelsWithCopies.map((label, index) => (
                  tireIsPrintable(label) && (
                    <div key={index} className="print-tire-label">
                      <PrintTireLabel
                        itemId={label.itemId}
                        brand={label.brand}
                        model={label.model}
                        sizeDesc={label.sizeDesc}
                      />
                    </div>
                  )
                ))}
            </div>
          </div>
        </main>
      </div>

      {/* Print Styles - Bin (6" x 2") */}
      {mode === "bin" && (
        <style jsx global>{`
          @media print {
            @page {
              size: 6in 2in;
              margin: 0;
            }

            html, body {
              margin: 0 !important;
              padding: 0 !important;
              background: white !important;
              width: 6in !important;
              height: 2in !important;
            }

            body > * {
              display: none !important;
            }

            aside,
            header,
            nav,
            .no-print,
            .print\\:hidden {
              display: none !important;
            }

            .print-labels-container {
              display: block !important;
              position: fixed !important;
              top: 0 !important;
              left: 0 !important;
              width: 6in !important;
              background: white !important;
            }

            .print-label {
              width: 6in !important;
              height: 2in !important;
              page-break-after: always !important;
              page-break-inside: avoid !important;
              display: flex !important;
              align-items: center !important;
              justify-content: center !important;
              background: white !important;
              margin: 0 !important;
              padding: 0 !important;
            }

            .print-label:last-child {
              page-break-after: auto !important;
            }

            .print-label svg {
              display: block !important;
            }

            .print-label * {
              color: black !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
          }
        `}</style>
      )}

      {/* Print Styles - Tire (4" x 6") */}
      {mode === "tire" && (
        <style jsx global>{`
          @media print {
            @page {
              size: 4in 6in;
              margin: 0;
            }

            html, body {
              margin: 0 !important;
              padding: 0 !important;
              background: white !important;
              width: 4in !important;
              height: 6in !important;
            }

            body > * {
              display: none !important;
            }

            aside,
            header,
            nav,
            .no-print,
            .print\\:hidden {
              display: none !important;
            }

            .print-labels-container {
              display: block !important;
              position: fixed !important;
              top: 0 !important;
              left: 0 !important;
              width: 4in !important;
              background: white !important;
            }

            .print-tire-label {
              width: 4in !important;
              height: 6in !important;
              page-break-after: always !important;
              page-break-inside: avoid !important;
              display: flex !important;
              align-items: center !important;
              justify-content: center !important;
              background: white !important;
              margin: 0 !important;
              padding: 0 !important;
            }

            .print-tire-label:last-child {
              page-break-after: auto !important;
            }

            .print-tire-label svg {
              display: block !important;
            }

            .print-tire-label * {
              color: black !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
          }
        `}</style>
      )}
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
function PrintTireLabel({
  itemId,
  brand,
  model,
  sizeDesc,
}: {
  itemId: string;
  brand: string;
  model: string;
  sizeDesc: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current && itemId) {
      JsBarcode(svgRef.current, itemId, {
        format: "CODE128",
        width: 2,          // narrow bars so a long item-ID fits within the 4" label width
        height: 70,
        displayValue: true,
        fontSize: 18,
        font: "monospace",
        textMargin: 4,
        margin: 4,
      });
    }
  }, [itemId]);

  return (
    <div
      className="flex flex-col items-center justify-center gap-3 text-center text-black px-4"
      style={{ width: "4in", height: "6in", overflow: "hidden", boxSizing: "border-box" }}
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
              style={{ maxHeight: "1in", maxWidth: "3.25in", objectFit: "contain", filter: "grayscale(1) contrast(1.15)" }}
            />
          )}
          <p style={{ fontSize: "40px", fontWeight: "bold", lineHeight: 1.1, maxWidth: "100%", wordBreak: "break-word" }}>{brand}</p>
        </div>
      )}
      {model && <p style={{ fontSize: "26px", fontWeight: 500, lineHeight: 1.2, maxWidth: "100%", wordBreak: "break-word" }}>{model}</p>}
      {sizeDesc && <p style={{ fontSize: "22px", fontWeight: 500, lineHeight: 1.3, maxWidth: "100%", wordBreak: "break-word" }}>{sizeDesc}</p>}
      {itemId && <svg ref={svgRef} className="flex-shrink-0 mt-1" style={{ maxWidth: "100%" }} />}
    </div>
  );
}
