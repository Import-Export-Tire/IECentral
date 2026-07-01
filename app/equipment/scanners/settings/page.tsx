"use client";

import { useState, useEffect } from "react";
import Protected from "../../../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../../../theme-context";
import { useAuth } from "../../../auth-context";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";

const DEFAULT_BLOATWARE = [
  { pkg: "com.google.android.apps.docs", label: "Google Docs" },
  { pkg: "com.google.android.apps.maps", label: "Google Maps" },
  { pkg: "com.google.android.apps.photos", label: "Google Photos" },
  { pkg: "com.google.android.apps.tachyon", label: "Google Duo" },
  { pkg: "com.google.android.gm", label: "Gmail" },
  { pkg: "com.google.android.music", label: "Google Music" },
  { pkg: "com.google.android.videos", label: "Google Videos" },
  { pkg: "com.google.android.youtube", label: "YouTube" },
  { pkg: "com.google.android.calendar", label: "Google Calendar" },
  { pkg: "com.google.android.contacts", label: "Google Contacts" },
  { pkg: "com.google.android.apps.messaging", label: "Messages" },
  { pkg: "com.google.android.dialer", label: "Phone/Dialer" },
  { pkg: "com.google.android.apps.walletnfcrel", label: "Google Pay" },
  { pkg: "com.android.chrome", label: "Chrome" },
  { pkg: "com.android.camera2", label: "Camera" },
  { pkg: "com.android.calculator2", label: "Calculator" },
  { pkg: "com.android.deskclock", label: "Clock" },
  { pkg: "com.android.vending", label: "Play Store" },
  { pkg: "com.google.android.gms.setup", label: "Google Setup" },
  { pkg: "com.google.android.googlequicksearchbox", label: "Google Search" },
];

const LOCATION_DEFAULTS: Record<string, { code: string; rtUrl: string }> = {
  Latrobe: { code: "W08", rtUrl: "http://importexporttire-latrobe.rtlocator.mobi/Login.aspx/" },
  Everson: { code: "R10", rtUrl: "https://importexporttire-everson-rtlm.rtlocator.com/" },
  Chestnut: { code: "W09", rtUrl: "" },
};

interface ConfigForm {
  rtLocatorUrl: string;
  defaultDeviceIdPrefix: string;
  screenTimeoutMs: number;
  screenRotation: string;
  bloatwarePackages: string[];
  wifiSsid: string;
  wifiPassword: string;
  tireTrackApkSource: string;
  tireTrackApkS3Key: string;
  rtLocatorApkS3Key: string;
  agentApkS3Key: string;
  currentTireTrackVersion: string;
  currentRtLocatorVersion: string;
  currentAgentVersion: string;
  rtConfigXml: string;
  notes: string;
}

function ScannerSettingsContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();

  const locations = useQuery(api.locations.listActive);
  const mdmConfigs = useQuery(api.scannerMdm.listMdmConfigs);
  const upsertConfig = useMutation(api.scannerMdm.upsertMdmConfig);

  // Lock Policy (global — not per-location)
  const lockPolicy = useQuery(api.scannerMdm.getLockPolicy, {});
  const setLockPolicy = useMutation(api.scannerMdm.setLockPolicy);

  const [selectedLocationId, setSelectedLocationId] = useState<Id<"locations"> | null>(null);
  const [form, setForm] = useState<ConfigForm>({
    rtLocatorUrl: "",
    defaultDeviceIdPrefix: "",
    screenTimeoutMs: 1800000,
    screenRotation: "portrait",
    bloatwarePackages: DEFAULT_BLOATWARE.map((b) => b.pkg),
    wifiSsid: "",
    wifiPassword: "",
    tireTrackApkSource: "s3",
    tireTrackApkS3Key: "",
    rtLocatorApkS3Key: "",
    agentApkS3Key: "",
    currentTireTrackVersion: "",
    currentRtLocatorVersion: "",
    currentAgentVersion: "",
    rtConfigXml: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Lock Policy form state
  const [lockForm, setLockForm] = useState({
    lockdownEnabled: false,
    dataWedgeTab: false,
    screenTimeoutMs: 30000,
    screenRotation: "portrait",
    allowedPackagesText: "",
  });
  const [lockSaving, setLockSaving] = useState(false);
  const [lockSaved, setLockSaved] = useState(false);

  // Auto-select first location
  useEffect(() => {
    if (locations && locations.length > 0 && !selectedLocationId) {
      setSelectedLocationId(locations[0]._id);
    }
  }, [locations, selectedLocationId]);

  // Load config when location changes
  useEffect(() => {
    if (!selectedLocationId || !mdmConfigs) return;
    const config = mdmConfigs.find((c) => c.locationId === selectedLocationId);
    const location = locations?.find((l) => l._id === selectedLocationId);
    const defaults = location ? LOCATION_DEFAULTS[location.name] : null;

    if (config) {
      setForm({
        rtLocatorUrl: config.rtLocatorUrl,
        defaultDeviceIdPrefix: config.defaultDeviceIdPrefix,
        screenTimeoutMs: config.screenTimeoutMs,
        screenRotation: config.screenRotation,
        bloatwarePackages: config.bloatwarePackages,
        wifiSsid: config.wifiSsid ?? "",
        wifiPassword: config.wifiPassword ?? "",
        tireTrackApkSource: config.tireTrackApkSource,
        tireTrackApkS3Key: config.tireTrackApkS3Key ?? "",
        rtLocatorApkS3Key: config.rtLocatorApkS3Key ?? "",
        agentApkS3Key: config.agentApkS3Key ?? "",
        currentTireTrackVersion: config.currentTireTrackVersion ?? "",
        currentRtLocatorVersion: config.currentRtLocatorVersion ?? "",
        currentAgentVersion: config.currentAgentVersion ?? "",
        rtConfigXml: config.rtConfigXml ?? "",
        notes: config.notes ?? "",
      });
    } else {
      // Set defaults for new config
      setForm({
        rtLocatorUrl: defaults?.rtUrl ?? "",
        defaultDeviceIdPrefix: defaults ? `${defaults.code}-` : "",
        screenTimeoutMs: 1800000,
        screenRotation: "portrait",
        bloatwarePackages: DEFAULT_BLOATWARE.map((b) => b.pkg),
        wifiSsid: "",
        wifiPassword: "",
        tireTrackApkSource: "s3",
        tireTrackApkS3Key: "",
        rtLocatorApkS3Key: "",
        agentApkS3Key: "",
        currentTireTrackVersion: "",
        currentRtLocatorVersion: "",
        currentAgentVersion: "",
        rtConfigXml: "",
        notes: "",
      });
    }
  }, [selectedLocationId, mdmConfigs, locations]);

  // Sync lock policy query into form state once resolved
  useEffect(() => {
    if (lockPolicy === undefined) return;
    setLockForm({
      lockdownEnabled: lockPolicy.lockdownEnabled,
      dataWedgeTab: lockPolicy.dataWedgeTab,
      screenTimeoutMs: lockPolicy.screenTimeoutMs ?? 30000,
      screenRotation: lockPolicy.screenRotation ?? "portrait",
      allowedPackagesText: lockPolicy.allowedPackages.join("\n"),
    });
  }, [lockPolicy]);

  const handleSaveLockPolicy = async () => {
    if (!user) return;
    const allowedPackages = lockForm.allowedPackagesText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    setLockSaving(true);
    try {
      await setLockPolicy({
        allowedPackages,
        lockdownEnabled: lockForm.lockdownEnabled,
        dataWedgeTab: lockForm.dataWedgeTab,
        screenTimeoutMs: lockForm.screenTimeoutMs,
        screenRotation: lockForm.screenRotation,
        requestingUserId: user._id,
      });
      setLockSaved(true);
      setTimeout(() => setLockSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save lock policy:", err);
      alert("Failed to save lock policy. See console for details.");
    } finally {
      setLockSaving(false);
    }
  };

  const handleSave = async () => {
    if (!selectedLocationId || !user) return;
    const location = locations?.find((l) => l._id === selectedLocationId);
    const defaults = location ? LOCATION_DEFAULTS[location.name] : null;

    setSaving(true);
    try {
      await upsertConfig({
        locationId: selectedLocationId,
        locationCode: defaults?.code ?? location?.name?.substring(0, 3).toUpperCase() ?? "???",
        rtLocatorUrl: form.rtLocatorUrl,
        defaultDeviceIdPrefix: form.defaultDeviceIdPrefix,
        screenTimeoutMs: form.screenTimeoutMs,
        screenRotation: form.screenRotation,
        bloatwarePackages: form.bloatwarePackages,
        wifiSsid: form.wifiSsid || undefined,
        wifiPassword: form.wifiPassword || undefined,
        tireTrackApkSource: form.tireTrackApkSource,
        tireTrackApkS3Key: form.tireTrackApkS3Key || undefined,
        rtLocatorApkS3Key: form.rtLocatorApkS3Key || undefined,
        agentApkS3Key: form.agentApkS3Key || undefined,
        currentTireTrackVersion: form.currentTireTrackVersion || undefined,
        currentRtLocatorVersion: form.currentRtLocatorVersion || undefined,
        currentAgentVersion: form.currentAgentVersion || undefined,
        rtConfigXml: form.rtConfigXml || undefined,
        notes: form.notes || undefined,
        userId: user._id,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save config:", err);
    } finally {
      setSaving(false);
    }
  };

  const toggleBloatware = (pkg: string) => {
    setForm((f) => ({
      ...f,
      bloatwarePackages: f.bloatwarePackages.includes(pkg)
        ? f.bloatwarePackages.filter((p) => p !== pkg)
        : [...f.bloatwarePackages, pkg],
    }));
  };

  return (
    <Protected>
      <div className="flex h-screen theme-bg">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <MobileHeader />

          {/* Sticky iOS-style page header */}
          <header className="sticky top-0 z-10 backdrop-blur-sm border-b theme-border-secondary px-4 sm:px-8 py-3 sm:py-4 bg-[var(--surface-primary)]/80">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">Scanner Setup Settings</h1>
                <p className="text-xs sm:text-sm mt-1 hidden sm:block theme-text-tertiary">
                  Configure MDM settings per location for the setup tool
                </p>
              </div>
              <Button
                variant={saved ? "primary" : "primary"}
                onClick={handleSave}
                disabled={saving}
                className={saved ? "!theme-btn-primary opacity-100 bg-emerald-500 hover:bg-emerald-500" : ""}
              >
                {saved ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Saved
                  </>
                ) : saving ? "Saving..." : "Save Settings"}
              </Button>
            </div>

            {/* Location Tabs */}
            <div className="flex gap-2 overflow-x-auto flex-nowrap pb-1 mt-4">
              {locations?.map((loc) => (
                <button
                  key={loc._id}
                  onClick={() => setSelectedLocationId(loc._id)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap border ${
                    selectedLocationId === loc._id
                      ? "theme-accent-primary border-[var(--accent-primary)]/30 bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)]"
                      : "theme-text-secondary theme-border-secondary theme-card hover:theme-text-primary"
                  }`}
                >
                  {loc.name}
                  {LOCATION_DEFAULTS[loc.name] && (
                    <span className={`ml-1.5 text-xs ${selectedLocationId === loc._id ? "opacity-70" : "opacity-50"}`}>
                      ({LOCATION_DEFAULTS[loc.name].code})
                    </span>
                  )}
                </button>
              ))}
            </div>
          </header>

          <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-5 max-w-4xl">

            {/* RT Locator Configuration */}
            <Card padding="md">
              <SectionHeader label="RT LOCATOR CONFIGURATION" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block ui-section-label mb-1.5">RT Locator URL</label>
                  <input
                    type="text"
                    value={form.rtLocatorUrl}
                    onChange={(e) => setForm({ ...form, rtLocatorUrl: e.target.value })}
                    className="theme-input w-full px-3 py-2 text-sm"
                    placeholder="https://..."
                  />
                </div>
                <div>
                  <label className="block ui-section-label mb-1.5">Device ID Prefix</label>
                  <input
                    type="text"
                    value={form.defaultDeviceIdPrefix}
                    onChange={(e) => setForm({ ...form, defaultDeviceIdPrefix: e.target.value })}
                    className="theme-input w-full px-3 py-2 text-sm"
                    placeholder="W08-"
                  />
                </div>
              </div>
              <div className="mt-4">
                <label className="block ui-section-label mb-1.5">RT Config XML Template</label>
                <textarea
                  value={form.rtConfigXml}
                  onChange={(e) => setForm({ ...form, rtConfigXml: e.target.value })}
                  className="theme-input w-full px-3 py-2 text-sm font-mono text-xs"
                  rows={6}
                  placeholder={"<RT>\n  <ORIENTATION>PORTRAIT</ORIENTATION>\n  ..."}
                />
              </div>
            </Card>

            {/* WiFi Configuration */}
            <Card padding="md">
              <SectionHeader label="WIFI CONFIGURATION" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block ui-section-label mb-1.5">WiFi SSID</label>
                  <input
                    type="text"
                    value={form.wifiSsid}
                    onChange={(e) => setForm({ ...form, wifiSsid: e.target.value })}
                    className="theme-input w-full px-3 py-2 text-sm"
                    placeholder="Network name"
                  />
                </div>
                <div>
                  <label className="block ui-section-label mb-1.5">WiFi Password</label>
                  <input
                    type="password"
                    value={form.wifiPassword}
                    onChange={(e) => setForm({ ...form, wifiPassword: e.target.value })}
                    className="theme-input w-full px-3 py-2 text-sm"
                    placeholder="Password"
                  />
                </div>
              </div>
            </Card>

            {/* APK Management */}
            <Card padding="md">
              <SectionHeader label="APK MANAGEMENT" />
              <div className="space-y-3">

                {/* TireTrack */}
                <div className="theme-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold theme-text-primary">TireTrack</span>
                    <select
                      value={form.tireTrackApkSource}
                      onChange={(e) => setForm({ ...form, tireTrackApkSource: e.target.value })}
                      className="theme-input text-xs px-2 py-1"
                    >
                      <option value="expo">Auto (Expo)</option>
                      <option value="s3">Manual (S3)</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block ui-section-label mb-1.5">Current Version</label>
                      <input
                        type="text"
                        value={form.currentTireTrackVersion}
                        onChange={(e) => setForm({ ...form, currentTireTrackVersion: e.target.value })}
                        className="theme-input w-full px-3 py-2 text-sm"
                        placeholder="e.g., 2.4.1"
                      />
                    </div>
                    {form.tireTrackApkSource === "s3" && (
                      <div>
                        <label className="block ui-section-label mb-1.5">S3 Key</label>
                        <input
                          type="text"
                          value={form.tireTrackApkS3Key}
                          onChange={(e) => setForm({ ...form, tireTrackApkS3Key: e.target.value })}
                          className="theme-input w-full px-3 py-2 text-sm"
                          placeholder="apks/tiretrack-2.4.1.apk"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* RT Locator */}
                <div className="theme-card p-4">
                  <span className="text-sm font-semibold theme-text-primary">RT Locator</span>
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="block ui-section-label mb-1.5">Current Version</label>
                      <input
                        type="text"
                        value={form.currentRtLocatorVersion}
                        onChange={(e) => setForm({ ...form, currentRtLocatorVersion: e.target.value })}
                        className="theme-input w-full px-3 py-2 text-sm"
                        placeholder="e.g., 1.2.0"
                      />
                    </div>
                    <div>
                      <label className="block ui-section-label mb-1.5">S3 Key</label>
                      <input
                        type="text"
                        value={form.rtLocatorApkS3Key}
                        onChange={(e) => setForm({ ...form, rtLocatorApkS3Key: e.target.value })}
                        className="theme-input w-full px-3 py-2 text-sm"
                        placeholder="apks/rtlocator-1.2.0.apk"
                      />
                    </div>
                  </div>
                </div>

                {/* Scanner Agent */}
                <div className="theme-card p-4">
                  <span className="text-sm font-semibold theme-text-primary">Scanner Agent</span>
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="block ui-section-label mb-1.5">Current Version</label>
                      <input
                        type="text"
                        value={form.currentAgentVersion}
                        onChange={(e) => setForm({ ...form, currentAgentVersion: e.target.value })}
                        className="theme-input w-full px-3 py-2 text-sm"
                        placeholder="e.g., 1.0.0"
                      />
                    </div>
                    <div>
                      <label className="block ui-section-label mb-1.5">S3 Key</label>
                      <input
                        type="text"
                        value={form.agentApkS3Key}
                        onChange={(e) => setForm({ ...form, agentApkS3Key: e.target.value })}
                        className="theme-input w-full px-3 py-2 text-sm"
                        placeholder="apks/scanner-agent-1.0.0.apk"
                      />
                    </div>
                  </div>
                </div>

              </div>
            </Card>

            {/* Device Defaults */}
            <Card padding="md">
              <SectionHeader label="DEVICE DEFAULTS" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block ui-section-label mb-1.5">Screen Timeout</label>
                  <select
                    value={form.screenTimeoutMs}
                    onChange={(e) => setForm({ ...form, screenTimeoutMs: Number(e.target.value) })}
                    className="theme-input w-full px-3 py-2 text-sm"
                  >
                    <option value={60000}>1 minute</option>
                    <option value={120000}>2 minutes</option>
                    <option value={300000}>5 minutes</option>
                    <option value={600000}>10 minutes</option>
                    <option value={1800000}>30 minutes</option>
                    <option value={3600000}>1 hour</option>
                  </select>
                </div>
                <div>
                  <label className="block ui-section-label mb-1.5">Screen Rotation</label>
                  <select
                    value={form.screenRotation}
                    onChange={(e) => setForm({ ...form, screenRotation: e.target.value })}
                    className="theme-input w-full px-3 py-2 text-sm"
                  >
                    <option value="portrait">Portrait (locked)</option>
                    <option value="landscape">Landscape (locked)</option>
                    <option value="auto">Auto-rotate</option>
                  </select>
                </div>
              </div>
            </Card>

            {/* Bloatware List */}
            <Card padding="md">
              <SectionHeader
                label="APPS TO DISABLE"
                actions={
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setForm({ ...form, bloatwarePackages: DEFAULT_BLOATWARE.map((b) => b.pkg) })}
                    >
                      Select All
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setForm({ ...form, bloatwarePackages: [] })}
                    >
                      Clear All
                    </Button>
                  </>
                }
              />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {DEFAULT_BLOATWARE.map(({ pkg, label }) => (
                  <label
                    key={pkg}
                    className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors border theme-border-secondary ${
                      form.bloatwarePackages.includes(pkg)
                        ? "ui-callout-red"
                        : "theme-card"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={form.bloatwarePackages.includes(pkg)}
                      onChange={() => toggleBloatware(pkg)}
                      className="rounded"
                    />
                    <span className="text-xs theme-text-secondary">{label}</span>
                  </label>
                ))}
              </div>
            </Card>

            {/* Notes */}
            <Card padding="md">
              <SectionHeader label="NOTES" />
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="theme-input w-full px-3 py-2 text-sm"
                rows={3}
                placeholder="Configuration notes for this location..."
              />
            </Card>

            {/* Setup Tool Info */}
            <Card padding="md">
              <SectionHeader label="SETUP TOOL" />
              <p className="text-sm mb-3 theme-text-secondary">
                The local setup tool runs on the computer where scanners are plugged in via USB. It pulls these settings automatically.
              </p>
              <div className={`p-3 rounded-lg font-mono text-xs theme-border-secondary border ${isDark ? "bg-slate-900/60 theme-text-secondary" : "bg-gray-100 text-gray-700"}`}>
                <p>cd /path/to/IECentral/tools/scanner-setup</p>
                <p>npm install</p>
                <p>npx ts-node src/index.ts --location {LOCATION_DEFAULTS[locations?.find((l) => l._id === selectedLocationId)?.name ?? ""]?.code ?? "W08"}</p>
              </div>
            </Card>

            {/* Lock Policy */}
            <Card padding="md">
              <SectionHeader
                label="LOCK POLICY"
                actions={
                  <Button
                    variant={lockSaved ? "primary" : "primary"}
                    size="sm"
                    onClick={handleSaveLockPolicy}
                    disabled={lockSaving || !user}
                    className={lockSaved ? "bg-emerald-500 hover:bg-emerald-500" : ""}
                  >
                    {lockSaved ? (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Saved
                      </>
                    ) : lockSaving ? "Saving..." : "Save"}
                  </Button>
                }
              />

              <p className="text-xs mb-4 theme-text-tertiary">
                Global policy applied during the lockdown + DataWedge steps of the setup wizard.
              </p>

              <div className="space-y-4">
                {/* Lockdown + DataWedge toggles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

                  {/* Lockdown toggle — destructive, gets amber callout emphasis */}
                  <Card tone={lockForm.lockdownEnabled ? "amber" : "default"} padding="sm">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lockForm.lockdownEnabled}
                        onChange={(e) => setLockForm({ ...lockForm, lockdownEnabled: e.target.checked })}
                        className="mt-0.5 rounded"
                      />
                      <div>
                        <span className="text-sm font-semibold theme-text-primary block">Lockdown Enabled</span>
                        <span className="text-xs theme-text-secondary">Disable all apps except the allowlist + essentials</span>
                        {lockForm.lockdownEnabled && (
                          <span className="text-xs text-amber-600 dark:text-amber-400 font-medium block mt-1">
                            Active — scanners will be locked on next provision
                          </span>
                        )}
                      </div>
                    </label>
                  </Card>

                  {/* DataWedge toggle */}
                  <Card tone="default" padding="sm">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lockForm.dataWedgeTab}
                        onChange={(e) => setLockForm({ ...lockForm, dataWedgeTab: e.target.checked })}
                        className="mt-0.5 rounded"
                      />
                      <div>
                        <span className="text-sm font-semibold theme-text-primary block">DataWedge Tab</span>
                        <span className="text-xs theme-text-secondary">Send a Tab key after each scan</span>
                      </div>
                    </label>
                  </Card>
                </div>

                {/* Lockdown active warning callout */}
                {lockForm.lockdownEnabled && (
                  <Card tone="amber" padding="sm">
                    <div className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                      <p className="text-xs theme-text-primary">
                        <span className="font-semibold">Lockdown is on.</span> Scanners provisioned with this policy will have all apps outside the allowlist disabled. Ensure the allowlist below is correct before provisioning.
                      </p>
                    </div>
                  </Card>
                )}

                {/* Screen Timeout + Rotation */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block ui-section-label mb-1.5">Screen Timeout (ms)</label>
                    <input
                      type="number"
                      value={lockForm.screenTimeoutMs}
                      onChange={(e) => setLockForm({ ...lockForm, screenTimeoutMs: Number(e.target.value) })}
                      className="theme-input w-full px-3 py-2 text-sm"
                      placeholder="30000"
                      min={0}
                    />
                  </div>
                  <div>
                    <label className="block ui-section-label mb-1.5">Screen Rotation</label>
                    <select
                      value={lockForm.screenRotation}
                      onChange={(e) => setLockForm({ ...lockForm, screenRotation: e.target.value })}
                      className="theme-input w-full px-3 py-2 text-sm"
                    >
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </div>
                </div>

                {/* Allowed Packages */}
                <div>
                  <label className="block ui-section-label mb-1.5">Allowed Packages</label>
                  <textarea
                    value={lockForm.allowedPackagesText}
                    onChange={(e) => setLockForm({ ...lockForm, allowedPackagesText: e.target.value })}
                    className="theme-input w-full px-3 py-2 text-sm font-mono text-xs"
                    rows={5}
                    placeholder={"com.example.myapp\ncom.example.otherapp"}
                  />
                  <p className="text-xs mt-1.5 theme-text-tertiary">
                    Extra app package names to keep enabled (one per line). The 3 IET apps + essential system apps are always kept.
                  </p>
                </div>
              </div>
            </Card>

          </div>
        </main>
      </div>
    </Protected>
  );
}

export default function ScannerSettingsPage() {
  return <ScannerSettingsContent />;
}
