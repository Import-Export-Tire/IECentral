"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Protected from "../../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../../theme-context";
import { useAuth } from "../../auth-context";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import ScannerStatusDot, { getScannerHealth, ScannerHealth } from "./components/ScannerStatusDot";
import ScannerBatteryBar from "./components/ScannerBatteryBar";
import WifiSignalIcon from "./components/WifiSignalIcon";
import dynamic from "next/dynamic";

const SetupWizard = dynamic(
  () => import("./setup/SetupWizard").then((m) => ({ default: m.SetupWizard })),
  { ssr: false, loading: () => null },
);

type StatusFilter = "all" | "online" | "offline" | "attention" | "unprovisioned";

function ScannerDashboardContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();
  const router = useRouter();

  const [locationFilter, setLocationFilter] = useState<Id<"locations"> | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedScannerId, setSelectedScannerId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const webusbSupported = typeof navigator !== "undefined" && "usb" in navigator;
  const [addForm, setAddForm] = useState({ serialNumber: "", model: "Zebra TC51", notes: "", pin: "" });
  const [addLocationId, setAddLocationId] = useState<Id<"locations"> | "">("");
  const [addStep, setAddStep] = useState<"form" | "saving" | "done">("form");
  const [addError, setAddError] = useState("");
  const [newScannerId, setNewScannerId] = useState<Id<"scanners"> | null>(null);

  const fleet = useQuery(api.scannerMdm.getScannerFleetOverview);
  const scanners = useQuery(api.equipment.listScanners, {
    locationId: locationFilter !== "all" ? locationFilter : undefined,
  });
  const locations = useQuery(api.locations.listActiveWarehouses);
  const alerts = useQuery(api.scannerMdm.getScannersNeedingAttention);
  const createScanner = useMutation(api.scannerMdm.createScannerFromSetup);
  const mdmConfigs = useQuery(api.scannerMdm.listMdmConfigs);
  const selectedLocCode = mdmConfigs?.find((c) => c.locationId === addLocationId)?.locationCode;
  const nextNumber = useQuery(api.scannerMdm.getNextScannerNumber, selectedLocCode ? { locationCode: selectedLocCode } : "skip");

  const canEdit =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director" ||
    user?.role === "warehouse_manager";

  // Computed stats
  const stats = useMemo(() => {
    const all = (scanners ?? []).filter((s) => s.status !== "retired");
    const avgBattery = all.filter((s) => s.batteryLevel !== undefined).length > 0
      ? Math.round(all.filter((s) => s.batteryLevel !== undefined).reduce((sum, s) => sum + (s.batteryLevel ?? 0), 0) / all.filter((s) => s.batteryLevel !== undefined).length)
      : null;
    const provisioned = all.filter((s) => s.mdmStatus === "provisioned").length;
    const assigned = all.filter((s) => s.status === "assigned").length;
    const withApps = all.filter((s) => s.installedApps?.tireTrack).length;
    return { avgBattery, provisioned, assigned, withApps, total: all.length };
  }, [scanners]);

  // Filter scanners
  const filteredScanners = useMemo(() => (scanners ?? [])
    .filter((s) => s.status !== "retired")
    .filter((s) => {
      if (statusFilter === "all") return true;
      const health = getScannerHealth(s);
      if (statusFilter === "online") return health === "online";
      if (statusFilter === "offline") return health === "offline";
      if (statusFilter === "attention") return health === "warning";
      if (statusFilter === "unprovisioned") return health === "unprovisioned";
      return true;
    })
    .filter((s) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        s.number.toLowerCase().includes(q) ||
        s.serialNumber?.toLowerCase().includes(q) ||
        s.assignedPersonName?.toLowerCase().includes(q) ||
        s.locationName?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const aOnline = a.isOnline ? 0 : 1;
      const bOnline = b.isOnline ? 0 : 1;
      if (aOnline !== bOnline) return aOnline - bOnline;
      return a.number.localeCompare(b.number);
    }), [scanners, statusFilter, searchQuery]);

  const selectedScanner = selectedScannerId
    ? filteredScanners.find((s) => s._id === selectedScannerId)
    : null;

  const timeAgo = (ts?: number) => {
    if (!ts) return "Never";
    const diff = Date.now() - ts;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      available: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
      assigned: "bg-blue-500/15 text-blue-400 border border-blue-500/20",
      maintenance: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
      lost: "bg-red-500/15 text-red-400 border border-red-500/20",
    };
    return styles[status] ?? "bg-slate-500/15 text-slate-400 border border-slate-500/20";
  };

  const healthBorder = (health: ScannerHealth) => {
    if (health === "online") return isDark ? "border-l-emerald-500" : "border-l-emerald-500";
    if (health === "warning") return isDark ? "border-l-amber-500" : "border-l-amber-500";
    if (health === "offline") return isDark ? "border-l-slate-600" : "border-l-gray-300";
    return isDark ? "border-l-slate-700" : "border-l-gray-200";
  };

  return (
    <Protected>
      <div className="flex h-screen">
        <Sidebar />
        <main className={`flex-1 overflow-auto ${isDark ? "bg-slate-950" : "bg-gray-50"}`}>
          <MobileHeader />

          {/* Header with gradient accent */}
          <div className={`border-b ${isDark ? "border-slate-800" : "border-gray-200"}`}>
            <div className={`h-1 ${isDark ? "bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500" : "bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500"}`} />
            <div className="px-4 sm:px-6 lg:px-8 py-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? "bg-cyan-500/10" : "bg-blue-50"}`}>
                      <svg className={`w-5 h-5 ${isDark ? "text-cyan-400" : "text-blue-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Scanner Fleet</h1>
                      <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                        {stats.total} devices &middot; {stats.provisioned} managed &middot; {stats.assigned} assigned
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canEdit && (
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch("/api/scanner-mdm/apk?app=agent");
                          const data = await res.json();
                          if (data.downloadUrl) window.open(data.downloadUrl, "_blank");
                        } catch {}
                      }}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isDark ? "border border-slate-700 text-slate-300 hover:bg-slate-800" : "border border-gray-300 text-gray-600 hover:bg-gray-50"}`}
                      title="Download agent APK for sideloading onto new scanners"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      Agent APK
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => { setShowAddModal(true); setAddStep("form"); setAddError(""); setAddForm({ serialNumber: "", model: "Zebra TC51", notes: "", pin: "" }); setAddLocationId(""); }}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isDark ? "bg-cyan-600 hover:bg-cyan-500 text-white" : "bg-blue-600 hover:bg-blue-700 text-white"}`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                      Add Scanner
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => webusbSupported && setWizardOpen(true)}
                      disabled={!webusbSupported}
                      title={webusbSupported ? "Set up a new scanner via USB (Chrome/Edge)" : "Open in Chrome or Edge to enable scanner setup"}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        webusbSupported
                          ? isDark ? "bg-indigo-600 hover:bg-indigo-500 text-white" : "bg-indigo-600 hover:bg-indigo-700 text-white"
                          : "bg-gray-300 text-gray-500 cursor-not-allowed"
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" /></svg>
                      Setup New Scanner
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => router.push("/equipment/scanners/settings")}
                      className={`p-2 rounded-lg transition-colors ${isDark ? "text-slate-400 hover:bg-slate-800 hover:text-slate-200" : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"}`}
                      title="Settings"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="px-4 sm:px-6 lg:px-8 py-5 space-y-5">

            {/* Fleet KPI Row */}
            {fleet && (
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {/* Total */}
                <div className={`rounded-xl p-4 ${isDark ? "bg-slate-900/60 border border-slate-800/80" : "bg-white border border-gray-200 shadow-sm"}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className={`text-[11px] font-semibold uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>Total</div>
                      <div className={`text-2xl font-bold mt-0.5 tabular-nums ${isDark ? "text-white" : "text-gray-900"}`}>{fleet.total}</div>
                    </div>
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isDark ? "bg-slate-800" : "bg-gray-100"}`}>
                      <svg className={`w-4.5 h-4.5 ${isDark ? "text-slate-400" : "text-gray-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Online */}
                <div className={`rounded-xl p-4 ${isDark ? "bg-emerald-500/5 border border-emerald-500/15" : "bg-emerald-50/50 border border-emerald-200/60 shadow-sm"}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className={`text-[11px] font-semibold uppercase tracking-wider ${isDark ? "text-emerald-400/70" : "text-emerald-600/70"}`}>Online</span>
                      </div>
                      <div className={`text-2xl font-bold mt-0.5 tabular-nums ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>{fleet.online}</div>
                    </div>
                    <div className={`text-xs font-medium tabular-nums ${isDark ? "text-emerald-400/50" : "text-emerald-500/60"}`}>
                      {fleet.total > 0 ? Math.round((fleet.online / fleet.total) * 100) : 0}%
                    </div>
                  </div>
                  {/* Bar */}
                  <div className={`mt-2 h-1 rounded-full overflow-hidden ${isDark ? "bg-emerald-500/10" : "bg-emerald-200/50"}`}>
                    <div className="h-full bg-emerald-400 rounded-full transition-all duration-700" style={{ width: `${fleet.total > 0 ? (fleet.online / fleet.total) * 100 : 0}%` }} />
                  </div>
                </div>

                {/* Offline */}
                <div className={`rounded-xl p-4 ${isDark ? "bg-slate-900/60 border border-slate-800/80" : "bg-white border border-gray-200 shadow-sm"}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className={`text-[11px] font-semibold uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>Offline</div>
                      <div className={`text-2xl font-bold mt-0.5 tabular-nums ${isDark ? "text-slate-400" : "text-gray-500"}`}>{fleet.offline}</div>
                    </div>
                    <div className={`text-xs font-medium tabular-nums ${isDark ? "text-slate-400" : "text-gray-400"}`}>
                      {fleet.total > 0 ? Math.round((fleet.offline / fleet.total) * 100) : 0}%
                    </div>
                  </div>
                </div>

                {/* Avg Battery */}
                <div className={`rounded-xl p-4 ${isDark ? "bg-slate-900/60 border border-slate-800/80" : "bg-white border border-gray-200 shadow-sm"}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className={`text-[11px] font-semibold uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>Avg Battery</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-2xl font-bold tabular-nums ${
                          stats.avgBattery === null ? (isDark ? "text-slate-400" : "text-gray-300")
                          : stats.avgBattery > 50 ? (isDark ? "text-emerald-400" : "text-emerald-600")
                          : stats.avgBattery > 20 ? (isDark ? "text-amber-400" : "text-amber-600")
                          : (isDark ? "text-red-400" : "text-red-600")
                        }`}>{stats.avgBattery !== null ? `${stats.avgBattery}%` : "—"}</span>
                      </div>
                    </div>
                    <ScannerBatteryBar level={stats.avgBattery ?? undefined} size="md" showLabel={false} />
                  </div>
                </div>

                {/* Attention */}
                <div className={`rounded-xl p-4 ${fleet.needsAttention > 0 ? (isDark ? "bg-amber-500/5 border border-amber-500/20" : "bg-amber-50/50 border border-amber-200/60 shadow-sm") : isDark ? "bg-slate-900/60 border border-slate-800/80" : "bg-white border border-gray-200 shadow-sm"}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className={`text-[11px] font-semibold uppercase tracking-wider ${fleet.needsAttention > 0 ? (isDark ? "text-amber-400/70" : "text-amber-600/70") : isDark ? "text-slate-500" : "text-gray-400"}`}>Alerts</div>
                      <div className={`text-2xl font-bold mt-0.5 tabular-nums ${fleet.needsAttention > 0 ? (isDark ? "text-amber-400" : "text-amber-600") : isDark ? "text-slate-400" : "text-gray-300"}`}>{fleet.needsAttention}</div>
                    </div>
                    {fleet.needsAttention > 0 && (
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isDark ? "bg-amber-500/10" : "bg-amber-100"}`}>
                        <svg className="w-4.5 h-4.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Location Overview + Alerts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {/* Location Cards */}
              {fleet?.byLocation.map((loc) => (
                <button
                  key={loc.locationId}
                  onClick={() => setLocationFilter(locationFilter === loc.locationId ? "all" : loc.locationId)}
                  className={`rounded-xl p-4 text-left transition-all ${
                    locationFilter === loc.locationId
                      ? isDark ? "bg-cyan-500/10 border-2 border-cyan-500/40" : "bg-blue-50 border-2 border-blue-300"
                      : isDark ? "bg-slate-900/60 border border-slate-800/80 hover:border-slate-700" : "bg-white border border-gray-200 hover:border-gray-300 shadow-sm"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-sm font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{loc.locationName}</span>
                    <span className={`text-lg font-bold tabular-nums ${isDark ? "text-slate-400" : "text-gray-600"}`}>{loc.total}</span>
                  </div>
                  {/* Distribution bar */}
                  <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
                    {loc.online > 0 && (
                      <div className="bg-emerald-400 rounded-full transition-all duration-500" style={{ width: `${(loc.online / Math.max(loc.total, 1)) * 100}%` }} />
                    )}
                    {loc.available > 0 && (
                      <div className={`rounded-full transition-all duration-500 ${isDark ? "bg-cyan-500/40" : "bg-blue-300"}`} style={{ width: `${((loc.available - loc.online) / Math.max(loc.total, 1)) * 100}%` }} />
                    )}
                    {loc.offline > 0 && (
                      <div className={`rounded-full transition-all duration-500 ${isDark ? "bg-slate-700" : "bg-gray-200"}`} style={{ width: `${(loc.offline / Math.max(loc.total, 1)) * 100}%` }} />
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <span className={`text-[10px] flex items-center gap-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" /> {loc.online} online
                    </span>
                    <span className={`text-[10px] flex items-center gap-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full inline-block ${isDark ? "bg-slate-600" : "bg-gray-300"}`} /> {loc.offline} offline
                    </span>
                    <span className={`text-[10px] ${isDark ? "text-slate-400" : "text-gray-300"}`}>
                      {loc.assigned} assigned
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* Alerts */}
            {alerts && alerts.length > 0 && (
              <div className={`rounded-xl p-3 flex items-center gap-3 ${isDark ? "bg-amber-500/5 border border-amber-500/20" : "bg-amber-50 border border-amber-200"}`}>
                <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div className="flex flex-wrap items-center gap-1.5 flex-1">
                  {alerts.map((a) => (
                    <button
                      key={a.scanner._id}
                      onClick={() => router.push(`/equipment/scanners/${a.scanner._id}`)}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${isDark ? "bg-slate-800/80 text-slate-300 hover:bg-slate-700" : "bg-white text-gray-600 hover:bg-gray-100"}`}
                    >
                      <span className="font-bold">{a.scanner.number}</span>
                      <span className={isDark ? "text-slate-500" : "text-gray-400"}>
                        {a.reasons.includes("low_battery") ? "low bat" : "offline"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Search + Filter Bar */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search by #, serial, name, location..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`w-full pl-8 pr-3 py-1.5 text-sm border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/40 border-slate-800 text-white focus:border-cyan-500/50 placeholder-slate-600" : "bg-white border-gray-200 text-gray-900 focus:border-blue-400 placeholder-gray-400"}`}
                />
              </div>
              <div className="flex items-center gap-1">
                {(["all", "online", "offline", "attention"] as StatusFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(statusFilter === f ? "all" : f)}
                    className={`px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                      statusFilter === f && f !== "all"
                        ? f === "online" ? "bg-emerald-500/15 text-emerald-400" : f === "offline" ? (isDark ? "bg-slate-700 text-slate-300" : "bg-gray-200 text-gray-600") : "bg-amber-500/15 text-amber-400"
                        : isDark ? "text-slate-500 hover:text-slate-300 hover:bg-slate-800" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {f === "all" ? "All" : f === "attention" ? "Alerts" : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
              {locationFilter !== "all" && (
                <button
                  onClick={() => setLocationFilter("all")}
                  className={`text-[11px] px-2 py-1 rounded-md flex items-center gap-1 ${isDark ? "bg-cyan-500/10 text-cyan-400" : "bg-blue-50 text-blue-600"}`}
                >
                  {locations?.find((l) => l._id === locationFilter)?.name}
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              )}
              <span className={`text-[11px] ml-auto tabular-nums ${isDark ? "text-slate-400" : "text-gray-400"}`}>
                {filteredScanners.length} device{filteredScanners.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Scanner Table — data-dense, professional */}
            <div className={`rounded-xl border overflow-hidden ${isDark ? "border-slate-800/80 bg-slate-900/30" : "border-gray-200 bg-white shadow-sm"}`}>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className={isDark ? "bg-slate-900/80" : "bg-gray-50/80"}>
                      <th className={`pl-4 pr-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-gray-400"}`} style={{width: 40}}></th>
                      <th className={`px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-gray-400"}`}>Scanner</th>
                      <th className={`px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-gray-400"}`}>Status</th>
                      <th className={`px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-gray-400"}`}>Battery</th>
                      <th className={`px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-gray-400"}`}>Signal</th>
                      <th className={`px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-gray-400"}`}>Location</th>
                      <th className={`px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-gray-400"}`}>Assigned To</th>
                      <th className={`px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-gray-400"}`}>TireTrack</th>
                      <th className={`px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-gray-400"}`}>Last Seen</th>
                      <th className={`px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-gray-400"}`}>Serial</th>
                      <th className={`px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-gray-400"}`}>Model</th>
                      <th className={`px-2 pr-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-slate-500" : "text-gray-400"}`}>MDM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredScanners.map((scanner) => {
                      const health = getScannerHealth(scanner);
                      const isSelected = selectedScannerId === scanner._id;
                      const colCount = 12;
                      return (
                        <>
                        <tr
                          key={scanner._id}
                          onClick={() => setSelectedScannerId(isSelected ? null : scanner._id)}
                          onDoubleClick={() => router.push(`/equipment/scanners/${scanner._id}`)}
                          className={`cursor-pointer transition-colors border-l-2 ${healthBorder(health)} ${
                            isSelected
                              ? isDark ? "bg-cyan-500/5" : "bg-blue-50/50"
                              : isDark ? "hover:bg-slate-800/40" : "hover:bg-gray-50/80"
                          }`}
                        >
                          <td className="pl-4 pr-2 py-2.5">
                            <ScannerStatusDot health={health} size="sm" />
                          </td>
                          <td className="px-2 py-2.5">
                            <span className={`text-sm font-bold tabular-nums ${isDark ? "text-white" : "text-gray-900"}`}>{scanner.number}</span>
                          </td>
                          <td className="px-2 py-2.5">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${statusBadge(scanner.status)}`}>
                              {scanner.status}
                            </span>
                          </td>
                          <td className="px-2 py-2.5">
                            <ScannerBatteryBar level={scanner.batteryLevel} size="sm" />
                          </td>
                          <td className="px-2 py-2.5">
                            <WifiSignalIcon signal={scanner.wifiSignal} />
                          </td>
                          <td className={`px-2 py-2.5 text-xs ${isDark ? "text-slate-300" : "text-gray-700"}`}>{scanner.locationName}</td>
                          <td className={`px-2 py-2.5 text-xs ${scanner.assignedPersonName ? (isDark ? "text-slate-300" : "text-gray-700") : (isDark ? "text-slate-500" : "text-gray-300")}`}>
                            {scanner.assignedPersonName ?? "—"}
                          </td>
                          <td className="px-2 py-2.5">
                            {scanner.installedApps?.tireTrack ? (
                              <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${isDark ? "bg-cyan-500/10 text-cyan-400" : "bg-blue-50 text-blue-600"}`}>
                                v{scanner.installedApps.tireTrack}
                              </span>
                            ) : (
                              <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-300"}`}>—</span>
                            )}
                          </td>
                          <td className={`px-2 py-2.5 text-xs tabular-nums ${
                            scanner.lastSeen && (Date.now() - scanner.lastSeen) < 600000
                              ? (isDark ? "text-emerald-400/70" : "text-emerald-600")
                              : isDark ? "text-slate-400" : "text-gray-400"
                          }`}>
                            {timeAgo(scanner.lastSeen)}
                          </td>
                          <td className={`px-2 py-2.5 text-[11px] font-mono ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                            {scanner.serialNumber ?? "—"}
                          </td>
                          <td className={`px-2 py-2.5 text-[11px] ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                            {scanner.model ?? "—"}
                          </td>
                          <td className="px-2 pr-4 py-2.5">
                            {scanner.mdmStatus === "provisioned" ? (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20`}>managed</span>
                            ) : (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${isDark ? "bg-slate-800 text-slate-400" : "bg-gray-100 text-gray-400"}`}>
                                {scanner.mdmStatus ?? "none"}
                              </span>
                            )}
                          </td>
                        </tr>
                        {/* Inline detail — expands directly below selected row */}
                        {isSelected && (
                          <tr key={`${scanner._id}-detail`}>
                            <td colSpan={colCount} className="p-0">
                              <div className={`px-5 py-4 ${isDark ? "bg-slate-800/40 border-y border-cyan-500/10" : "bg-blue-50/30 border-y border-blue-200/40"}`}>
                                <div className="flex items-center justify-between mb-3">
                                  <div className="flex items-center gap-3">
                                    <ScannerStatusDot health={health} size="lg" />
                                    <div>
                                      <span className={`text-base font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Scanner {scanner.number}</span>
                                      <span className={`text-xs ml-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>{scanner.model}</span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button onClick={() => router.push(`/equipment/scanners/${scanner._id}`)}
                                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${isDark ? "bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25" : "bg-blue-50 text-blue-600 hover:bg-blue-100"}`}>
                                      Open Full Detail
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); setSelectedScannerId(null); }} className={`p-1 rounded ${isDark ? "text-slate-400 hover:text-slate-200" : "text-gray-400 hover:text-gray-600"}`}>
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                                  <div>
                                    <div className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>Battery</div>
                                    <div className="mt-1"><ScannerBatteryBar level={scanner.batteryLevel} size="md" /></div>
                                  </div>
                                  <div>
                                    <div className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>WiFi</div>
                                    <div className="mt-1"><WifiSignalIcon signal={scanner.wifiSignal} showLabel /></div>
                                  </div>
                                  <div>
                                    <div className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>Location</div>
                                    <div className={`text-sm font-medium mt-1 ${isDark ? "text-slate-200" : "text-gray-700"}`}>{scanner.locationName}</div>
                                  </div>
                                  <div>
                                    <div className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>Assigned</div>
                                    <div className={`text-sm font-medium mt-1 ${isDark ? "text-slate-200" : "text-gray-700"}`}>{scanner.assignedPersonName ?? "Unassigned"}</div>
                                  </div>
                                  <div>
                                    <div className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>Serial</div>
                                    <div className={`text-xs font-mono mt-1 ${isDark ? "text-slate-300" : "text-gray-500"}`}>{scanner.serialNumber ?? "—"}</div>
                                  </div>
                                  <div>
                                    <div className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>Last Seen</div>
                                    <div className={`text-sm mt-1 ${isDark ? "text-slate-300" : "text-gray-500"}`}>{timeAgo(scanner.lastSeen)}</div>
                                  </div>
                                </div>
                                {scanner.installedApps && (
                                  <div className="flex items-center gap-2 mt-3 pt-3 border-t" style={{ borderColor: isDark ? "rgba(51,65,85,0.5)" : "rgba(229,231,235,0.8)" }}>
                                    <span className={`text-[10px] uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>Apps:</span>
                                    {scanner.installedApps.tireTrack && <span className={`text-[11px] px-2 py-0.5 rounded-full ${isDark ? "bg-cyan-500/10 text-cyan-400" : "bg-blue-50 text-blue-600"}`}>TireTrack v{scanner.installedApps.tireTrack}</span>}
                                    {scanner.installedApps.rtLocator && <span className={`text-[11px] px-2 py-0.5 rounded-full ${isDark ? "bg-purple-500/10 text-purple-400" : "bg-purple-50 text-purple-600"}`}>RT Locator v{scanner.installedApps.rtLocator}</span>}
                                    {scanner.installedApps.scannerAgent && <span className={`text-[11px] px-2 py-0.5 rounded-full ${isDark ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-500"}`}>Agent v{scanner.installedApps.scannerAgent}</span>}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Empty state */}
            {filteredScanners.length === 0 && scanners !== undefined && (
              <div className={`text-center py-20 rounded-xl border ${isDark ? "bg-slate-900/20 border-slate-800/50" : "bg-white border-gray-200"}`}>
                <div className={`w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center ${isDark ? "bg-slate-800/50" : "bg-gray-100"}`}>
                  <svg className={`w-8 h-8 ${isDark ? "text-slate-400" : "text-gray-300"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className={`text-base font-semibold ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  {searchQuery || statusFilter !== "all" ? "No matching scanners" : "No scanners in fleet"}
                </h3>
                <p className={`text-sm mt-1 max-w-sm mx-auto ${isDark ? "text-slate-400" : "text-gray-400"}`}>
                  {searchQuery || statusFilter !== "all"
                    ? "Try broadening your search or clearing filters."
                    : "Connect a scanner via USB and run the setup tool to add it to the fleet."}
                </p>
              </div>
            )}
          </div>

          {/* Add Scanner Modal */}
          {showAddModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => addStep !== "saving" && setShowAddModal(false)}>
              <div className={`w-full max-w-md rounded-2xl border p-6 ${isDark ? "bg-slate-900 border-slate-700" : "bg-white border-gray-200"}`} onClick={(e) => e.stopPropagation()}>
                {addStep === "form" && (
                  <>
                    <h3 className={`text-lg font-bold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>Add Scanner</h3>
                    <div className="space-y-3">
                      <div>
                        <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Location</label>
                        <select value={addLocationId} onChange={(e) => setAddLocationId(e.target.value as Id<"locations">)}
                          className={`w-full px-3 py-2 text-sm border rounded-lg ${isDark ? "bg-slate-800 border-slate-600 text-white" : "bg-gray-50 border-gray-300 text-gray-900"}`}>
                          <option value="">Select location...</option>
                          {locations?.map((l) => {
                            const lc = mdmConfigs?.find((c) => c.locationId === l._id)?.locationCode;
                            return <option key={l._id} value={l._id}>{l.name}{lc ? ` (${lc})` : ""}</option>;
                          })}
                        </select>
                      </div>
                      <div>
                        <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Serial Number</label>
                        <input value={addForm.serialNumber} onChange={(e) => setAddForm((f) => ({ ...f, serialNumber: e.target.value }))}
                          placeholder="e.g., 20322524202269"
                          className={`w-full px-3 py-2 text-sm border rounded-lg ${isDark ? "bg-slate-800 border-slate-600 text-white" : "bg-gray-50 border-gray-300 text-gray-900"}`} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Model</label>
                          <input value={addForm.model} onChange={(e) => setAddForm((f) => ({ ...f, model: e.target.value }))}
                            className={`w-full px-3 py-2 text-sm border rounded-lg ${isDark ? "bg-slate-800 border-slate-600 text-white" : "bg-gray-50 border-gray-300 text-gray-900"}`} />
                        </div>
                        <div>
                          <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>PIN (4-6 digits)</label>
                          <input value={addForm.pin} onChange={(e) => setAddForm((f) => ({ ...f, pin: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                            placeholder="1234" maxLength={6}
                            className={`w-full px-3 py-2 text-sm border rounded-lg ${isDark ? "bg-slate-800 border-slate-600 text-white" : "bg-gray-50 border-gray-300 text-gray-900"}`} />
                        </div>
                      </div>
                      <div>
                        <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Notes (optional)</label>
                        <input value={addForm.notes} onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
                          className={`w-full px-3 py-2 text-sm border rounded-lg ${isDark ? "bg-slate-800 border-slate-600 text-white" : "bg-gray-50 border-gray-300 text-gray-900"}`} />
                      </div>
                      {addError && <p className="text-sm text-red-500">{addError}</p>}
                    </div>
                    <div className="flex gap-3 justify-end mt-5">
                      <button onClick={() => setShowAddModal(false)} className={`px-4 py-2 text-sm rounded-lg ${isDark ? "text-slate-400" : "text-gray-500"}`}>Cancel</button>
                      <button onClick={async () => {
                        if (!addLocationId || !addForm.serialNumber || !addForm.pin || addForm.pin.length < 4) {
                          setAddError("Location, serial number, and PIN (4+ digits) are required.");
                          return;
                        }
                        setAddStep("saving");
                        setAddError("");
                        try {
                          const loc = locations?.find((l) => l._id === addLocationId);
                          const result = await createScanner({
                            number: nextNumber ?? `${selectedLocCode}-001`,
                            pin: addForm.pin,
                            serialNumber: addForm.serialNumber,
                            model: addForm.model,
                            locationId: addLocationId as Id<"locations">,
                            notes: addForm.notes || undefined,
                          });
                          setNewScannerId(result.scannerId as Id<"scanners">);
                          setAddStep("done");
                        } catch (err) {
                          setAddError(err instanceof Error ? err.message : "Failed to create scanner");
                          setAddStep("form");
                        }
                      }}
                        className="px-4 py-2 text-sm font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white">
                        Create Scanner
                      </button>
                    </div>
                  </>
                )}
                {addStep === "saving" && (
                  <div className="text-center py-8">
                    <div className="animate-spin w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full mx-auto mb-3"></div>
                    <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Creating scanner...</p>
                  </div>
                )}
                {addStep === "done" && (
                  <>
                    <div className="text-center py-4">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 ${isDark ? "bg-emerald-500/10" : "bg-emerald-50"}`}>
                        <svg className="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      </div>
                      <h3 className={`text-lg font-bold mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>Scanner Created</h3>
                      <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Go to the scanner detail page to provision it.</p>
                    </div>
                    <div className="flex gap-3 justify-end mt-4">
                      <button onClick={() => setShowAddModal(false)} className={`px-4 py-2 text-sm rounded-lg ${isDark ? "text-slate-400" : "text-gray-500"}`}>Close</button>
                      {newScannerId && (
                        <button onClick={() => router.push(`/equipment/scanners/${newScannerId}`)}
                          className="px-4 py-2 text-sm font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white">
                          Provision Now
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
      {wizardOpen && <SetupWizard onClose={() => setWizardOpen(false)} />}
    </Protected>
  );
}

export default function ScannerDashboardPage() {
  return <ScannerDashboardContent />;
}
