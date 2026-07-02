"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import Protected from "../../protected";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "../../auth-context";
import { Id } from "@/convex/_generated/dataModel";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";

function QuickBooksSettingsContent() {
  const { user } = useAuth();
  const router = useRouter();

  // Queries
  const connection = useQuery(api.quickbooks.getConnection);
  const syncStats = useQuery(api.quickbooks.getSyncStats);
  const employeeMappings = useQuery(api.quickbooks.getEmployeeMappings);
  const unmappedPersonnel = useQuery(api.quickbooks.getUnmappedPersonnel);
  const pendingExports = useQuery(api.quickbooks.getPendingTimeExports);
  const syncLogs = useQuery(api.quickbooks.getSyncLogs, { limit: 20 });

  // Mutations
  const saveConnection = useMutation(api.quickbooks.saveConnection);
  const createMapping = useMutation(api.quickbooks.createEmployeeMapping);
  const deleteMapping = useMutation(api.quickbooks.deleteEmployeeMapping);
  const approveExport = useMutation(api.quickbooks.approveTimeExport);
  const calculateExports = useMutation(api.quickbooks.calculatePendingTimeExports);

  // State
  const [activeTab, setActiveTab] = useState<"connection" | "mapping" | "exports" | "logs">("connection");
  const [showSetup, setShowSetup] = useState(false);
  const [setupForm, setSetupForm] = useState({
    companyName: "",
    wcUsername: "IECentral",
    wcPassword: "",
    syncTimeEntries: true,
    syncPayStubs: true,
    syncEmployees: true,
    autoSyncEnabled: true,
    syncIntervalMinutes: 15,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [selectedPersonnel, setSelectedPersonnel] = useState<Id<"personnel"> | null>(null);
  const [qbListId, setQbListId] = useState("");
  const [qbName, setQbName] = useState("");

  // Check permissions
  const canManageQB = user?.role === "super_admin" || user?.role === "admin";

  if (!canManageQB) {
    return (
      <div className="min-h-screen flex items-center justify-center theme-bg">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2 theme-text-primary">Access Denied</h1>
          <p className="theme-text-secondary">You don&apos;t have permission to manage QuickBooks settings.</p>
        </div>
      </div>
    );
  }

  const handleSaveConnection = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      await saveConnection({
        ...setupForm,
        userId: user._id,
      });
      setShowSetup(false);
    } catch (error) {
      console.error("Failed to save connection:", error);
    }
    setIsSaving(false);
  };

  const handleCreateMapping = async () => {
    if (!selectedPersonnel || !qbListId || !qbName) return;
    try {
      await createMapping({
        personnelId: selectedPersonnel,
        qbListId,
        qbName,
      });
      setShowMappingModal(false);
      setSelectedPersonnel(null);
      setQbListId("");
      setQbName("");
    } catch (error) {
      console.error("Failed to create mapping:", error);
    }
  };

  const handleApproveExport = async (exportId: Id<"qbPendingTimeExport">) => {
    if (!user) return;
    try {
      await approveExport({ exportId, userId: user._id });
    } catch (error) {
      console.error("Failed to approve export:", error);
    }
  };

  const handleCalculateExports = async () => {
    // Calculate for current week (Sunday)
    const today = new Date();
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - today.getDay());
    const weekStart = sunday.toISOString().split("T")[0];

    try {
      await calculateExports({ weekStartDate: weekStart });
    } catch (error) {
      console.error("Failed to calculate exports:", error);
    }
  };

  const downloadQwcFile = () => {
    if (!connection) return;

    const appUrl = window.location.origin;
    const content = `<?xml version="1.0"?>
<QBWCXML>
  <AppName>IE Central Time Sync</AppName>
  <AppID></AppID>
  <AppURL>${appUrl}/api/qbwc</AppURL>
  <AppDescription>IE Central - QuickBooks Time &amp; Payroll Sync</AppDescription>
  <AppSupport>${appUrl}/support</AppSupport>
  <UserName>${connection.wcUsername}</UserName>
  <OwnerID>{${crypto.randomUUID().toUpperCase()}}</OwnerID>
  <FileID>{${crypto.randomUUID().toUpperCase()}}</FileID>
  <QBType>QBFS</QBType>
  <Scheduler>
    <RunEveryNMinutes>${connection.syncIntervalMinutes}</RunEveryNMinutes>
  </Scheduler>
  <IsReadOnly>false</IsReadOnly>
</QBWCXML>`;

    const blob = new Blob([content], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "IECentral.qwc";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "connected":
        return "text-green-400";
      case "disconnected":
        return "text-slate-400";
      case "error":
        return "text-red-400";
      default:
        return "text-amber-400";
    }
  };

  return (
    <div className="flex h-screen theme-bg">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Sticky iOS-style page header */}
        <header className="sticky top-0 z-10 backdrop-blur-sm border-b theme-border-secondary px-4 sm:px-8 py-3 sm:py-4 bg-[var(--surface-primary)]/80">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="p-2 rounded-lg theme-text-secondary hover:theme-text-primary transition-colors hover:bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">QuickBooks Integration</h1>
              <p className="text-xs sm:text-sm mt-0.5 theme-text-tertiary">
                Sync time entries and payroll with QuickBooks Desktop
              </p>
            </div>
          </div>
        </header>

        <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-5 max-w-4xl">

          {/* Connection Status Card */}
          <Card padding="md">
            <SectionHeader
              label="CONNECTION"
              title="Connection Status"
              actions={
                connection ? (
                  <Button variant="primary" size="sm" onClick={downloadQwcFile}>
                    Download .QWC File
                  </Button>
                ) : undefined
              }
            />

            {!connection ? (
              <div className="text-center py-8">
                <svg className="w-16 h-16 mx-auto mb-4 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <h3 className="text-base font-semibold mb-2 theme-text-primary">QuickBooks Not Connected</h3>
                <p className="text-sm mb-4 theme-text-secondary">
                  Set up the connection to start syncing time entries and payroll.
                </p>
                <Button variant="primary" onClick={() => setShowSetup(true)}>
                  Set Up Connection
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="ui-section-label mb-1">Company</p>
                  <p className="font-medium theme-text-primary">{connection.companyName}</p>
                </div>
                <div>
                  <p className="ui-section-label mb-1">Status</p>
                  <p className={`font-medium capitalize ${getStatusColor(connection.connectionStatus)}`}>
                    {connection.connectionStatus}
                  </p>
                </div>
                <div>
                  <p className="ui-section-label mb-1">Last Connected</p>
                  <p className="font-medium theme-text-primary">
                    {connection.lastConnectedAt
                      ? new Date(connection.lastConnectedAt).toLocaleString()
                      : "Never"}
                  </p>
                </div>
                <div>
                  <p className="ui-section-label mb-1">Last Sync</p>
                  <p className="font-medium theme-text-primary">
                    {connection.lastSyncAt
                      ? new Date(connection.lastSyncAt).toLocaleString()
                      : "Never"}
                  </p>
                </div>
              </div>
            )}

            {connection?.lastError && (
              <Card tone="red" padding="sm" className="mt-4">
                <p className="text-sm text-red-700 dark:text-red-400">{connection.lastError}</p>
              </Card>
            )}
          </Card>

          {/* Tabs */}
          {connection && (
            <>
              <div className="flex gap-2 overflow-x-auto flex-nowrap pb-1">
                {[
                  { id: "connection", label: "Settings" },
                  { id: "mapping", label: "Employee Mapping" },
                  { id: "exports", label: "Time Exports" },
                  { id: "logs", label: "Sync Logs" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as typeof activeTab)}
                    className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap border ${
                      activeTab === tab.id
                        ? "theme-accent-primary border-[var(--accent-primary)]/30 bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)]"
                        : "theme-text-secondary theme-border-secondary theme-card hover:theme-text-primary"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Settings Tab */}
              {activeTab === "connection" && (
                <Card padding="md">
                  <SectionHeader
                    label="SYNC CONFIGURATION"
                    title="Sync Settings"
                    actions={
                      <Button variant="secondary" size="sm" onClick={() => setShowSetup(true)}>
                        Edit Settings
                      </Button>
                    }
                  />
                  <div className="space-y-0 divide-y theme-border-secondary">
                    {[
                      {
                        label: "Sync Time Entries",
                        description: "Export employee hours to QuickBooks",
                        enabled: connection.syncTimeEntries,
                      },
                      {
                        label: "Import Pay Stubs",
                        description: "Pull paycheck data from QuickBooks",
                        enabled: connection.syncPayStubs,
                      },
                      {
                        label: "Sync Employees",
                        description: "Keep employee list in sync",
                        enabled: connection.syncEmployees,
                      },
                    ].map(({ label, description, enabled }) => (
                      <div key={label} className="flex items-center justify-between py-3">
                        <div>
                          <p className="text-sm font-medium theme-text-primary">{label}</p>
                          <p className="text-xs theme-text-secondary">{description}</p>
                        </div>
                        <span className={`ui-badge ${enabled ? "ui-badge-green" : "ui-badge-gray"}`}>
                          {enabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-sm font-medium theme-text-primary">Sync Interval</p>
                        <p className="text-xs theme-text-secondary">How often Web Connector syncs</p>
                      </div>
                      <span className="ui-badge ui-badge-gray">
                        Every {connection.syncIntervalMinutes} min
                      </span>
                    </div>
                  </div>
                </Card>
              )}

              {/* Employee Mapping Tab */}
              {activeTab === "mapping" && (
                <Card padding="md">
                  <SectionHeader
                    label="EMPLOYEE MAPPING"
                    title="Employee Mapping"
                    actions={
                      <Button variant="primary" size="sm" onClick={() => setShowMappingModal(true)}>
                        Add Mapping
                      </Button>
                    }
                  />
                  <p className="text-sm theme-text-secondary -mt-2 mb-4">
                    Link IE Central personnel to QuickBooks employees
                  </p>

                  {syncStats && (
                    <div className="grid grid-cols-2 gap-4 mb-5">
                      <div className="p-4 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/60">
                        <p className="text-2xl font-bold theme-text-primary">{syncStats.mappings.total}</p>
                        <p className="text-sm theme-text-secondary">Mapped Employees</p>
                      </div>
                      <div className="p-4 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/60">
                        <p className={`text-2xl font-bold ${syncStats.mappings.unmapped > 0 ? "text-amber-500 dark:text-amber-400" : "theme-text-primary"}`}>
                          {syncStats.mappings.unmapped}
                        </p>
                        <p className="text-sm theme-text-secondary">Unmapped Employees</p>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    {employeeMappings?.map((mapping) => (
                      <div
                        key={mapping._id}
                        className="flex items-center justify-between p-3 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/60"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center bg-[color-mix(in_srgb,var(--accent-primary)_15%,transparent)]">
                            <span className="text-sm font-semibold theme-accent-primary">
                              {mapping.personnel?.firstName?.[0]}{mapping.personnel?.lastName?.[0]}
                            </span>
                          </div>
                          <div>
                            <p className="text-sm font-medium theme-text-primary">
                              {mapping.personnel?.firstName} {mapping.personnel?.lastName}
                            </p>
                            <p className="text-xs theme-text-secondary">QB: {mapping.qbName}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`ui-badge ${mapping.isSynced ? "ui-badge-green" : "ui-badge-amber"}`}>
                            {mapping.isSynced ? "Synced" : "Pending"}
                          </span>
                          <button
                            onClick={() => deleteMapping({ mappingId: mapping._id })}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}

                    {(!employeeMappings || employeeMappings.length === 0) && (
                      <div className="text-center py-8 theme-text-secondary text-sm">
                        No employee mappings yet. Add mappings to sync time entries.
                      </div>
                    )}
                  </div>
                </Card>
              )}

              {/* Time Exports Tab */}
              {activeTab === "exports" && (
                <Card padding="md">
                  <SectionHeader
                    label="TIME EXPORTS"
                    title="Pending Time Exports"
                    actions={
                      <Button variant="secondary" size="sm" onClick={handleCalculateExports}>
                        Calculate This Week
                      </Button>
                    }
                  />
                  <p className="text-sm theme-text-secondary -mt-2 mb-4">
                    Review and approve time entries for QuickBooks export
                  </p>

                  {syncStats && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                      {[
                        { value: syncStats.exports.pending, label: "Pending", color: "theme-text-primary" },
                        { value: syncStats.exports.approved, label: "Approved", color: "text-green-500 dark:text-green-400" },
                        { value: syncStats.exports.totalPendingHours.toFixed(1), label: "Pending Hours", color: "theme-text-primary" },
                        { value: syncStats.queue.pending, label: "In Queue", color: "theme-text-primary" },
                      ].map(({ value, label, color }) => (
                        <div key={label} className="p-4 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/60">
                          <p className={`text-2xl font-bold ${color}`}>{value}</p>
                          <p className="text-sm theme-text-secondary">{label}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2">
                    {pendingExports?.map((exp) => (
                      <div
                        key={exp._id}
                        className="flex items-center justify-between p-3 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/60"
                      >
                        <div>
                          <p className="text-sm font-medium theme-text-primary">
                            {exp.personnel?.firstName} {exp.personnel?.lastName}
                          </p>
                          <p className="text-xs theme-text-secondary">
                            Week of {exp.weekStartDate} • {exp.totalHours.toFixed(1)} hrs
                            {exp.overtimeHours > 0 && ` (${exp.overtimeHours.toFixed(1)} OT)`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {!exp.qbMapping && (
                            <span className="ui-badge ui-badge-red">Not Mapped</span>
                          )}
                          {exp.status === "pending" && exp.qbMapping && (
                            <button
                              onClick={() => handleApproveExport(exp._id)}
                              className="px-3 py-1 rounded-lg text-sm font-medium bg-green-500/15 text-green-600 dark:text-green-400 hover:bg-green-500/25 transition-colors"
                            >
                              Approve
                            </button>
                          )}
                          {exp.status === "approved" && (
                            <span className="ui-badge ui-badge-green">Approved</span>
                          )}
                        </div>
                      </div>
                    ))}

                    {(!pendingExports || pendingExports.length === 0) && (
                      <div className="text-center py-8 theme-text-secondary text-sm">
                        No pending exports. Click &quot;Calculate This Week&quot; to generate.
                      </div>
                    )}
                  </div>
                </Card>
              )}

              {/* Sync Logs Tab */}
              {activeTab === "logs" && (
                <Card padding="md">
                  <SectionHeader label="SYNC LOGS" title="Sync Logs" />
                  <div className="space-y-2">
                    {syncLogs?.map((log) => (
                      <div
                        key={log._id}
                        className="flex items-center justify-between p-3 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/60"
                      >
                        <div className="flex items-center gap-3">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            log.status === "completed" ? "bg-green-400" :
                            log.status === "failed" ? "bg-red-400" : "bg-amber-400"
                          }`} />
                          <div>
                            <p className="text-sm font-medium theme-text-primary">{log.operation}</p>
                            {log.message && (
                              <p className="text-xs theme-text-secondary">{log.message}</p>
                            )}
                          </div>
                        </div>
                        <p className="text-xs theme-text-tertiary whitespace-nowrap ml-4">
                          {new Date(log.createdAt).toLocaleString()}
                        </p>
                      </div>
                    ))}

                    {(!syncLogs || syncLogs.length === 0) && (
                      <div className="text-center py-8 theme-text-secondary text-sm">
                        No sync logs yet.
                      </div>
                    )}
                  </div>
                </Card>
              )}
            </>
          )}

          {/* Setup Instructions */}
          <Card padding="md">
            <SectionHeader label="SETUP GUIDE" title="Setup Instructions" />
            <ol className="list-decimal list-inside space-y-3 text-sm theme-text-secondary">
              <li>Configure the connection settings above with your QuickBooks company name</li>
              <li>Download the .QWC file and save it to the computer running QuickBooks</li>
              <li>Open QuickBooks Desktop and go to <strong className="theme-text-primary">File → App Management → Update Web Services</strong></li>
              <li>Click &quot;Add an Application&quot; and select the downloaded .QWC file</li>
              <li>When prompted, enter the password you configured above</li>
              <li>Grant access permissions when QuickBooks asks</li>
              <li>Map your IE Central employees to QuickBooks employees in the Mapping tab</li>
              <li>The Web Connector will automatically sync at the configured interval</li>
            </ol>
          </Card>

        </div>
      </main>

      {/* Setup Modal */}
      {showSetup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="theme-card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4 theme-text-primary">QuickBooks Connection Setup</h2>

            <div className="space-y-4">
              <div>
                <label className="block ui-section-label mb-1.5">Company Name</label>
                <input
                  type="text"
                  value={setupForm.companyName}
                  onChange={(e) => setSetupForm({ ...setupForm, companyName: e.target.value })}
                  placeholder="Your QuickBooks Company Name"
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block ui-section-label mb-1.5">Web Connector Username</label>
                <input
                  type="text"
                  value={setupForm.wcUsername}
                  onChange={(e) => setSetupForm({ ...setupForm, wcUsername: e.target.value })}
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block ui-section-label mb-1.5">Web Connector Password</label>
                <input
                  type="password"
                  value={setupForm.wcPassword}
                  onChange={(e) => setSetupForm({ ...setupForm, wcPassword: e.target.value })}
                  placeholder="Create a secure password"
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block ui-section-label mb-1.5">Sync Interval</label>
                <select
                  value={setupForm.syncIntervalMinutes}
                  onChange={(e) => setSetupForm({ ...setupForm, syncIntervalMinutes: parseInt(e.target.value) })}
                  className="theme-input w-full px-3 py-2 text-sm"
                >
                  <option value={5}>Every 5 minutes</option>
                  <option value={15}>Every 15 minutes</option>
                  <option value={30}>Every 30 minutes</option>
                  <option value={60}>Every hour</option>
                </select>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={setupForm.syncTimeEntries}
                    onChange={(e) => setSetupForm({ ...setupForm, syncTimeEntries: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm theme-text-secondary">Export time entries to QuickBooks</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={setupForm.syncPayStubs}
                    onChange={(e) => setSetupForm({ ...setupForm, syncPayStubs: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm theme-text-secondary">Import pay stubs from QuickBooks</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={setupForm.syncEmployees}
                    onChange={(e) => setSetupForm({ ...setupForm, syncEmployees: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm theme-text-secondary">Sync employee list</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button variant="secondary" onClick={() => setShowSetup(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSaveConnection}
                disabled={isSaving || !setupForm.companyName || !setupForm.wcPassword}
              >
                {isSaving ? "Saving..." : "Save Connection"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add Mapping Modal */}
      {showMappingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="theme-card w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4 theme-text-primary">Map Employee to QuickBooks</h2>

            <div className="space-y-4">
              <div>
                <label className="block ui-section-label mb-1.5">IE Central Employee</label>
                <select
                  value={selectedPersonnel || ""}
                  onChange={(e) => setSelectedPersonnel(e.target.value as Id<"personnel">)}
                  className="theme-input w-full px-3 py-2 text-sm"
                >
                  <option value="">Select employee...</option>
                  {unmappedPersonnel?.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.firstName} {p.lastName} - {p.position}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block ui-section-label mb-1.5">QuickBooks Employee Name</label>
                <input
                  type="text"
                  value={qbName}
                  onChange={(e) => setQbName(e.target.value)}
                  placeholder="Name as it appears in QuickBooks"
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block ui-section-label mb-1.5">QuickBooks List ID</label>
                <input
                  type="text"
                  value={qbListId}
                  onChange={(e) => setQbListId(e.target.value)}
                  placeholder="e.g., 80000001-1234567890"
                  className="theme-input w-full px-3 py-2 text-sm"
                />
                <p className="text-xs mt-1.5 theme-text-tertiary">
                  The List ID is auto-populated when employees sync from QuickBooks
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowMappingModal(false);
                  setSelectedPersonnel(null);
                  setQbListId("");
                  setQbName("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleCreateMapping}
                disabled={!selectedPersonnel || !qbListId || !qbName}
              >
                Create Mapping
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function QuickBooksSettingsPage() {
  return (
    <Protected>
      <QuickBooksSettingsContent />
    </Protected>
  );
}
