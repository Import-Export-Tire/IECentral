"use client";

import { useState, useEffect } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "../auth-context";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

const STATUS_CONFIG: Record<string, { color: string; label: string; bgColor: string }> = {
  in_progress: { color: "text-blue-400", label: "In Progress", bgColor: "bg-blue-500/20" },
  pending: { color: "text-amber-400", label: "Pending Review", bgColor: "bg-amber-500/20" },
  approved: { color: "text-green-400", label: "Approved", bgColor: "bg-green-500/20" },
  locked: { color: "text-purple-400", label: "Locked", bgColor: "bg-purple-500/20" },
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function PayrollContent() {
  const { user } = useAuth();

  const [selectedCompanyId, setSelectedCompanyId] = useState<Id<"payrollCompanies"> | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<{
    startDate: string;
    endDate: string;
  } | null>(null);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState("");
  const [filterDepartment, setFilterDepartment] = useState("all");
  const [newCompanyForm, setNewCompanyForm] = useState({
    name: "",
    code: "",
    departments: [] as string[],
  });

  // Queries
  const payrollCompanies = useQuery(api.payrollCompanies.getAll);
  const allDepartments = useQuery(api.payrollCompanies.getAllDepartments);
  const payPeriods = useQuery(
    api.timesheetApprovals.getPayPeriods,
    { count: 8, payrollCompanyId: selectedCompanyId ?? undefined }
  );
  const periodDetails = useQuery(
    api.timesheetApprovals.getPayPeriodDetails,
    selectedPeriod
      ? {
          payPeriodStart: selectedPeriod.startDate,
          payPeriodEnd: selectedPeriod.endDate,
          payrollCompanyId: selectedCompanyId ?? undefined,
        }
      : "skip"
  );

  // Company management mutations
  const createCompany = useMutation(api.payrollCompanies.create);

  // Mutations
  const approvePayPeriod = useMutation(api.timesheetApprovals.approvePayPeriod);
  const lockPayPeriod = useMutation(api.timesheetApprovals.lockPayPeriod);
  const unlockPayPeriod = useMutation(api.timesheetApprovals.unlockPayPeriod);
  const exportPayPeriodToQB = useMutation(api.quickbooks.exportPayPeriodToQB);

  // Get unique departments from details
  const departments = periodDetails
    ? [...new Set(periodDetails.employees.map((e) => e.department))].filter(Boolean).sort()
    : [];

  // Filter employees by department
  const filteredEmployees =
    filterDepartment === "all"
      ? periodDetails?.employees
      : periodDetails?.employees.filter((e) => e.department === filterDepartment);

  // Handlers
  const handleSelectPeriod = (period: { startDate: string; endDate: string }) => {
    setSelectedPeriod(period);
    setFilterDepartment("all");
  };

  const handleApprove = async () => {
    if (!user || !selectedPeriod) return;

    await approvePayPeriod({
      payPeriodStart: selectedPeriod.startDate,
      payPeriodEnd: selectedPeriod.endDate,
      userId: user._id as Id<"users">,
      notes: approvalNotes || undefined,
      payrollCompanyId: selectedCompanyId ?? undefined,
    });

    setShowApprovalModal(false);
    setApprovalNotes("");
  };

  const handleLock = async () => {
    if (!user || !selectedPeriod) return;

    if (confirm("Lock this pay period? This prevents further time entry edits.")) {
      await lockPayPeriod({
        payPeriodStart: selectedPeriod.startDate,
        payPeriodEnd: selectedPeriod.endDate,
        userId: user._id as Id<"users">,
        payrollCompanyId: selectedCompanyId ?? undefined,
      });
    }
  };

  const handleUnlock = async () => {
    if (!user || !selectedPeriod) return;

    if (confirm("Unlock this pay period? This allows time entries to be edited again.")) {
      await unlockPayPeriod({
        payPeriodStart: selectedPeriod.startDate,
        userId: user._id as Id<"users">,
        payrollCompanyId: selectedCompanyId ?? undefined,
      });
    }
  };

  const handleCreateCompany = async () => {
    if (!newCompanyForm.name || !newCompanyForm.code) return;

    try {
      if (!user) throw new Error("Not signed in");
      await createCompany({
        name: newCompanyForm.name,
        code: newCompanyForm.code,
        departments: newCompanyForm.departments,
        requestingUserId: user._id,
      });
      setShowCompanyModal(false);
      setNewCompanyForm({ name: "", code: "", departments: [] });
    } catch (error: any) {
      alert(error.message || "Failed to create company");
    }
  };

  const handleExportToQB = async () => {
    if (!user || !selectedPeriod) return;

    if (confirm("Export this pay period to QuickBooks? This will add all employee hours to the QB sync queue.")) {
      try {
        const result = await exportPayPeriodToQB({
          payPeriodStart: selectedPeriod.startDate,
          payPeriodEnd: selectedPeriod.endDate,
          userId: user._id as Id<"users">,
        });
        alert(`Successfully queued ${result.exportedCount} employee(s) for QuickBooks sync.`);
      } catch (error: any) {
        alert(error.message || "Failed to export to QuickBooks");
      }
    }
  };

  // Calculate totals for current view
  const viewTotals = filteredEmployees
    ? {
        regularHours: filteredEmployees.reduce((sum, e) => sum + e.regularHours, 0),
        overtimeHours: filteredEmployees.reduce((sum, e) => sum + e.overtimeHours, 0),
        totalHours: filteredEmployees.reduce((sum, e) => sum + e.totalHours, 0),
        issueCount: filteredEmployees.reduce((sum, e) => sum + e.issues.length, 0),
      }
    : null;

  return (
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-[var(--theme-border-secondary)]">
          <div className="px-4 sm:px-8 py-4 sm:py-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">
                  Payroll Approval
                </h1>
                <p className="text-sm theme-text-tertiary">
                  Review and approve timesheets by pay period
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Company Selector */}
                <select
                  value={selectedCompanyId || ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSelectedCompanyId(value ? value as Id<"payrollCompanies"> : null);
                    setSelectedPeriod(null); // Reset period when company changes
                  }}
                  className="theme-input px-3 py-2 text-sm"
                >
                  <option value="">All Companies</option>
                  {payrollCompanies?.map((company) => (
                    <option key={company._id} value={company._id}>
                      {company.name} ({company.employeeCount})
                    </option>
                  ))}
                </select>
                <Button variant="secondary" onClick={() => setShowCompanyModal(true)}>+ Add Company</Button>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-8 pb-8">
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Pay Periods List */}
            <div className="lg:col-span-1">
              <h2 className="text-lg font-semibold mb-4 theme-text-primary">
                Pay Periods
              </h2>
              <div className="space-y-2">
                {payPeriods?.map((period) => {
                  const isSelected =
                    selectedPeriod?.startDate === period.startDate;
                  const statusConfig = STATUS_CONFIG[period.status] || STATUS_CONFIG.pending;

                  return (
                    <button
                      key={period.startDate}
                      onClick={() => handleSelectPeriod(period)}
                      className={`w-full text-left p-4 rounded-xl transition-all ${
                        isSelected
                          ? "rounded-xl border-2 border-blue-500 bg-blue-50 dark:bg-cyan-500/20"
                          : "theme-card hover:opacity-80"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold theme-text-primary">
                            {formatDateShort(period.startDate)} - {formatDateShort(period.endDate)}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span
                              className={`px-2 py-0.5 text-xs font-medium rounded ${statusConfig.bgColor} ${statusConfig.color}`}
                            >
                              {statusConfig.label}
                            </span>
                            {period.isCurrent && (
                              <span className="ui-badge ui-badge-blue">
                                Current
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          {period.totalHours !== undefined && (
                            <p className="text-sm font-medium text-blue-600 dark:text-cyan-400">
                              {period.totalHours.toFixed(1)}h
                            </p>
                          )}
                          {period.totalEmployees !== undefined && (
                            <p className="text-xs theme-text-tertiary">
                              {period.totalEmployees} employees
                            </p>
                          )}
                        </div>
                      </div>
                      {period.exportedToQB && (
                        <div className="mt-2 pt-2 border-t border-[var(--theme-border-secondary)]">
                          <span className="text-xs text-green-600 dark:text-green-400">
                            Exported to QuickBooks
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Period Details */}
            <div className="lg:col-span-2">
              {selectedPeriod && periodDetails ? (
                <div className="space-y-4">
                  {/* Period Header */}
                  <Card padding="md">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div>
                        <h2 className="text-lg font-semibold theme-text-primary">
                          {formatDate(selectedPeriod.startDate)} - {formatDate(selectedPeriod.endDate)}
                        </h2>
                        <p className="text-sm theme-text-tertiary">
                          {periodDetails.totals.totalEmployees} employees • {periodDetails.totals.totalHours.toFixed(1)} total hours
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {periodDetails.approval?.status === "locked" ? (
                          <>
                            {!periodDetails.approval.exportedToQB && (
                              <Button variant="primary" onClick={handleExportToQB}>
                                Export to QuickBooks
                              </Button>
                            )}
                            <Button variant="secondary" onClick={handleUnlock}>
                              Unlock
                            </Button>
                          </>
                        ) : periodDetails.approval?.status === "approved" ? (
                          <Button variant="primary" onClick={handleLock}>
                            Lock for Payroll
                          </Button>
                        ) : (
                          <Button
                            variant="primary"
                            onClick={() => setShowApprovalModal(true)}
                            disabled={periodDetails.totals.totalIssues > 0}
                          >
                            Approve Timesheets
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Stats Row */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-[var(--theme-border-secondary)]">
                      <div>
                        <p className="text-xs theme-text-tertiary">Regular Hours</p>
                        <p className="text-xl font-bold theme-text-primary">
                          {periodDetails.totals.totalRegularHours.toFixed(1)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs theme-text-tertiary">Overtime Hours</p>
                        <p className="text-xl font-bold text-amber-400 dark:text-amber-400">
                          {periodDetails.totals.totalOvertimeHours.toFixed(1)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs theme-text-tertiary">Total Hours</p>
                        <p className="text-xl font-bold text-blue-600 dark:text-cyan-400">
                          {periodDetails.totals.totalHours.toFixed(1)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs theme-text-tertiary">Issues</p>
                        <p className={`text-xl font-bold ${periodDetails.totals.totalIssues > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                          {periodDetails.totals.totalIssues}
                        </p>
                      </div>
                    </div>

                    {/* Issues Warning */}
                    {periodDetails.totals.totalIssues > 0 && (
                      <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30">
                        <p className="text-sm font-medium text-red-700 dark:text-red-400">
                          {periodDetails.totals.totalIssues} issue(s) must be resolved before approval
                        </p>
                      </div>
                    )}
                  </Card>

                  {/* Department Filter */}
                  <div className="flex items-center gap-4">
                    <select
                      value={filterDepartment}
                      onChange={(e) => setFilterDepartment(e.target.value)}
                      className="theme-input px-3 py-2 text-sm"
                    >
                      <option value="all">All Departments</option>
                      {departments.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                    {viewTotals && filterDepartment !== "all" && (
                      <span className="text-sm theme-text-secondary">
                        {filteredEmployees?.length} employees • {viewTotals.totalHours.toFixed(1)}h
                      </span>
                    )}
                  </div>

                  {/* Employee List */}
                  <div className="space-y-3">
                    {filteredEmployees?.map((employee) => (
                      <Card
                        key={employee.personnelId}
                        padding="md"
                        tone={employee.hasIssues ? "red" : "default"}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                          <div>
                            <h3 className="font-semibold theme-text-primary">
                              {employee.name}
                            </h3>
                            <p className="text-sm theme-text-tertiary">
                              {employee.position} • {employee.department}
                            </p>
                            {employee.hasIssues && (
                              <div className="mt-2 space-y-1">
                                {employee.issues.map((issue, i) => (
                                  <p key={i} className="text-sm text-red-600 dark:text-red-400">
                                    • {issue}
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="sm:text-right">
                            <div className="grid grid-cols-3 gap-2 sm:gap-4 sm:text-right">
                              <div>
                                <p className="text-xs theme-text-tertiary">Regular</p>
                                <p className="font-semibold theme-text-primary">
                                  {employee.regularHours.toFixed(1)}h
                                </p>
                              </div>
                              <div>
                                <p className="text-xs theme-text-tertiary">OT</p>
                                <p className={`font-semibold ${employee.overtimeHours > 0 ? "text-amber-600 dark:text-amber-400" : "theme-text-tertiary"}`}>
                                  {employee.overtimeHours.toFixed(1)}h
                                </p>
                              </div>
                              <div>
                                <p className="text-xs theme-text-tertiary">Total</p>
                                <p className="font-semibold text-blue-600 dark:text-cyan-400">
                                  {employee.totalHours.toFixed(1)}h
                                </p>
                              </div>
                            </div>
                            <p className="text-xs mt-2 theme-text-tertiary">
                              {employee.daysWorked} days worked
                              {employee.callOffDays > 0 && ` • ${employee.callOffDays} call-off(s)`}
                            </p>
                          </div>
                        </div>

                        {/* Daily Breakdown */}
                        {employee.dailyBreakdown.length > 0 && (
                          <details className="mt-3 pt-3 border-t border-[var(--theme-border-secondary)]">
                            <summary className="text-sm font-medium cursor-pointer theme-text-tertiary">
                              Daily Breakdown
                            </summary>
                            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                              {employee.dailyBreakdown.map((day) => (
                                <div
                                  key={day.date}
                                  className="p-2 rounded-lg text-sm bg-[#f2f2f7] dark:bg-slate-700/50"
                                >
                                  <p className="font-medium theme-text-primary">
                                    {new Date(day.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                                  </p>
                                  <p className="text-xs theme-text-tertiary">
                                    {day.clockIn ? formatTime(day.clockIn) : "-"} - {day.clockOut ? formatTime(day.clockOut) : "-"}
                                  </p>
                                  <p className="font-semibold text-blue-600 dark:text-cyan-400">
                                    {day.hoursWorked.toFixed(1)}h
                                  </p>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </Card>
                    ))}
                  </div>
                </div>
              ) : (
                <Card padding="md">
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                      <div className="text-4xl mb-3">📊</div>
                      <p className="theme-text-tertiary">
                        Select a pay period to view details
                      </p>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </div>

        {/* Approval Modal */}
        {showApprovalModal && selectedPeriod && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-xl p-6 bg-white dark:bg-slate-800 border border-[var(--theme-border-secondary)]">
              <h2 className="text-lg font-semibold mb-4 theme-text-primary">
                Approve Timesheets
              </h2>
              <p className="text-sm mb-4 theme-text-tertiary">
                You are approving timesheets for the pay period:
              </p>
              <div className="p-4 rounded-lg mb-4 bg-[#f2f2f7] dark:bg-slate-700">
                <p className="font-medium theme-text-primary">
                  {formatDate(selectedPeriod.startDate)} - {formatDate(selectedPeriod.endDate)}
                </p>
                {periodDetails && (
                  <p className="text-sm theme-text-tertiary">
                    {periodDetails.totals.totalEmployees} employees • {periodDetails.totals.totalHours.toFixed(1)} hours
                  </p>
                )}
              </div>
              <div>
                <label className="ui-section-label block mb-1">
                  Notes (optional)
                </label>
                <textarea
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  placeholder="Add any notes about this approval..."
                  rows={3}
                  className="theme-input w-full px-3 py-2"
                />
              </div>
              <div className="flex gap-3 mt-6">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setShowApprovalModal(false);
                    setApprovalNotes("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleApprove}
                >
                  Approve
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Add Company Modal */}
        {showCompanyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-xl p-6 bg-white dark:bg-slate-800 border border-[var(--theme-border-secondary)]">
              <h2 className="text-lg font-semibold mb-4 theme-text-primary">
                Add Payroll Company
              </h2>
              <p className="text-sm mb-4 theme-text-tertiary">
                Create a new company for separate payroll processing.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="ui-section-label block mb-1">
                    Company Name
                  </label>
                  <input
                    type="text"
                    value={newCompanyForm.name}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, name: e.target.value })}
                    placeholder="e.g., Import Export Tire"
                    className="theme-input w-full px-3 py-2"
                  />
                </div>
                <div>
                  <label className="ui-section-label block mb-1">
                    Company Code
                  </label>
                  <input
                    type="text"
                    value={newCompanyForm.code}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, code: e.target.value.toUpperCase() })}
                    placeholder="e.g., IET"
                    maxLength={5}
                    className="theme-input w-full px-3 py-2"
                  />
                </div>
                <div>
                  <label className="ui-section-label block mb-1">
                    Departments
                  </label>
                  <p className="text-xs mb-2 theme-text-tertiary">
                    Select which departments belong to this company
                  </p>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--theme-border-secondary)] bg-[#f2f2f7] dark:bg-slate-700/50 p-2">
                    {allDepartments?.map((dept) => (
                      <label key={dept} className="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-600">
                        <input
                          type="checkbox"
                          checked={newCompanyForm.departments.includes(dept)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewCompanyForm({
                                ...newCompanyForm,
                                departments: [...newCompanyForm.departments, dept],
                              });
                            } else {
                              setNewCompanyForm({
                                ...newCompanyForm,
                                departments: newCompanyForm.departments.filter((d) => d !== dept),
                              });
                            }
                          }}
                          className="rounded"
                        />
                        <span className="text-sm theme-text-primary">{dept}</span>
                      </label>
                    ))}
                    {(!allDepartments || allDepartments.length === 0) && (
                      <p className="text-sm p-2 theme-text-tertiary">
                        No departments found
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setShowCompanyModal(false);
                    setNewCompanyForm({ name: "", code: "", departments: [] });
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={!newCompanyForm.name || !newCompanyForm.code}
                  onClick={handleCreateCompany}
                >
                  Create Company
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function Payroll() {
  return (
    <Protected minTier={4}>
      <PayrollContent />
    </Protected>
  );
}
