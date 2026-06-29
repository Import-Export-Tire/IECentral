"use client";

import { useState, useEffect } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";

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
  const { theme } = useTheme();
  const isDark = theme === "dark";
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
    <div className={`flex h-screen theme-bg-primary`}>
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        {/* Header */}
        <div
          className={`sticky top-0 z-10 backdrop-blur-md ${
            isDark ? "bg-slate-900/80" : "bg-[#f2f2f7]/80"
          }`}
        >
          <div className="px-4 sm:px-8 py-4 sm:py-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className={`text-xl sm:text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Payroll Approval
                </h1>
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
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
                  className={`px-3 py-2 rounded-lg text-sm ${
                    isDark
                      ? "bg-slate-800 border-slate-700 text-white"
                      : "bg-white border-gray-200 text-gray-900"
                  } border`}
                >
                  <option value="">All Companies</option>
                  {payrollCompanies?.map((company) => (
                    <option key={company._id} value={company._id}>
                      {company.name} ({company.employeeCount})
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setShowCompanyModal(true)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium ${
                    isDark
                      ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                  }`}
                >
                  + Add Company
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-8 pb-8">
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Pay Periods List */}
            <div className="lg:col-span-1">
              <h2 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
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
                          ? isDark
                            ? "bg-cyan-500/20 border-2 border-cyan-500"
                            : "bg-blue-50 border-2 border-blue-500"
                          : isDark
                          ? "bg-slate-800/50 border border-slate-700 hover:bg-slate-800"
                          : "bg-white border border-gray-200 hover:bg-gray-50 shadow-sm"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                            {formatDateShort(period.startDate)} - {formatDateShort(period.endDate)}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span
                              className={`px-2 py-0.5 text-xs font-medium rounded ${statusConfig.bgColor} ${statusConfig.color}`}
                            >
                              {statusConfig.label}
                            </span>
                            {period.isCurrent && (
                              <span className={`px-2 py-0.5 text-xs font-medium rounded ${isDark ? "bg-blue-500/20 text-blue-400" : "bg-blue-100 text-blue-600"}`}>
                                Current
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          {period.totalHours !== undefined && (
                            <p className={`text-sm font-medium ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                              {period.totalHours.toFixed(1)}h
                            </p>
                          )}
                          {period.totalEmployees !== undefined && (
                            <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                              {period.totalEmployees} employees
                            </p>
                          )}
                        </div>
                      </div>
                      {period.exportedToQB && (
                        <div className={`mt-2 pt-2 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                          <span className={`text-xs ${isDark ? "text-green-400" : "text-green-600"}`}>
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
                  <div className={`p-4 rounded-xl ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div>
                        <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                          {formatDate(selectedPeriod.startDate)} - {formatDate(selectedPeriod.endDate)}
                        </h2>
                        <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          {periodDetails.totals.totalEmployees} employees • {periodDetails.totals.totalHours.toFixed(1)} total hours
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {periodDetails.approval?.status === "locked" ? (
                          <>
                            {!periodDetails.approval.exportedToQB && (
                              <button
                                onClick={handleExportToQB}
                                className={`px-4 py-2 rounded-lg font-medium ${
                                  isDark
                                    ? "bg-green-500 text-white hover:bg-green-400"
                                    : "bg-green-600 text-white hover:bg-green-700"
                                }`}
                              >
                                Export to QuickBooks
                              </button>
                            )}
                            <button
                              onClick={handleUnlock}
                              className={`px-4 py-2 rounded-lg font-medium ${
                                isDark
                                  ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                              }`}
                            >
                              Unlock
                            </button>
                          </>
                        ) : periodDetails.approval?.status === "approved" ? (
                          <button
                            onClick={handleLock}
                            className={`px-4 py-2 rounded-lg font-medium ${
                              isDark
                                ? "bg-purple-500 text-white hover:bg-purple-400"
                                : "bg-purple-600 text-white hover:bg-purple-700"
                            }`}
                          >
                            Lock for Payroll
                          </button>
                        ) : (
                          <button
                            onClick={() => setShowApprovalModal(true)}
                            disabled={periodDetails.totals.totalIssues > 0}
                            className={`px-4 py-2 rounded-lg font-medium ${
                              isDark
                                ? "bg-cyan-500 text-white hover:bg-cyan-400"
                                : "bg-blue-600 text-white hover:bg-blue-700"
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            Approve Timesheets
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Stats Row */}
                    <div className={`grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                      <div>
                        <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Regular Hours</p>
                        <p className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                          {periodDetails.totals.totalRegularHours.toFixed(1)}
                        </p>
                      </div>
                      <div>
                        <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Overtime Hours</p>
                        <p className={`text-xl font-bold ${isDark ? "text-amber-400" : "text-amber-600"}`}>
                          {periodDetails.totals.totalOvertimeHours.toFixed(1)}
                        </p>
                      </div>
                      <div>
                        <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Total Hours</p>
                        <p className={`text-xl font-bold ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                          {periodDetails.totals.totalHours.toFixed(1)}
                        </p>
                      </div>
                      <div>
                        <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Issues</p>
                        <p className={`text-xl font-bold ${periodDetails.totals.totalIssues > 0 ? (isDark ? "text-red-400" : "text-red-600") : (isDark ? "text-green-400" : "text-green-600")}`}>
                          {periodDetails.totals.totalIssues}
                        </p>
                      </div>
                    </div>

                    {/* Issues Warning */}
                    {periodDetails.totals.totalIssues > 0 && (
                      <div className={`mt-4 p-3 rounded-lg ${isDark ? "bg-red-500/10 border border-red-500/30" : "bg-red-50 border border-red-200"}`}>
                        <p className={`text-sm font-medium ${isDark ? "text-red-400" : "text-red-700"}`}>
                          {periodDetails.totals.totalIssues} issue(s) must be resolved before approval
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Department Filter */}
                  <div className="flex items-center gap-4">
                    <select
                      value={filterDepartment}
                      onChange={(e) => setFilterDepartment(e.target.value)}
                      className={`px-3 py-2 rounded-lg text-sm ${
                        isDark
                          ? "bg-slate-800 border-slate-700 text-white"
                          : "bg-white border-gray-200 text-gray-900"
                      } border`}
                    >
                      <option value="all">All Departments</option>
                      {departments.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                    {viewTotals && filterDepartment !== "all" && (
                      <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        {filteredEmployees?.length} employees • {viewTotals.totalHours.toFixed(1)}h
                      </span>
                    )}
                  </div>

                  {/* Employee List */}
                  <div className="space-y-3">
                    {filteredEmployees?.map((employee) => (
                      <div
                        key={employee.personnelId}
                        className={`p-4 rounded-xl ${
                          employee.hasIssues
                            ? isDark
                              ? "bg-red-500/10 border border-red-500/30"
                              : "bg-red-50 border border-red-200"
                            : isDark
                            ? "bg-slate-800/50 border border-slate-700"
                            : "bg-white border border-gray-200 shadow-sm"
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                          <div>
                            <h3 className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                              {employee.name}
                            </h3>
                            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              {employee.position} • {employee.department}
                            </p>
                            {employee.hasIssues && (
                              <div className="mt-2 space-y-1">
                                {employee.issues.map((issue, i) => (
                                  <p key={i} className={`text-sm ${isDark ? "text-red-400" : "text-red-600"}`}>
                                    • {issue}
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="sm:text-right">
                            <div className="grid grid-cols-3 gap-2 sm:gap-4 sm:text-right">
                              <div>
                                <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Regular</p>
                                <p className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                                  {employee.regularHours.toFixed(1)}h
                                </p>
                              </div>
                              <div>
                                <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>OT</p>
                                <p className={`font-semibold ${employee.overtimeHours > 0 ? (isDark ? "text-amber-400" : "text-amber-600") : (isDark ? "text-slate-500" : "text-gray-400")}`}>
                                  {employee.overtimeHours.toFixed(1)}h
                                </p>
                              </div>
                              <div>
                                <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Total</p>
                                <p className={`font-semibold ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                                  {employee.totalHours.toFixed(1)}h
                                </p>
                              </div>
                            </div>
                            <p className={`text-xs mt-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                              {employee.daysWorked} days worked
                              {employee.callOffDays > 0 && ` • ${employee.callOffDays} call-off(s)`}
                            </p>
                          </div>
                        </div>

                        {/* Daily Breakdown */}
                        {employee.dailyBreakdown.length > 0 && (
                          <details className={`mt-3 pt-3 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                            <summary className={`text-sm font-medium cursor-pointer ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              Daily Breakdown
                            </summary>
                            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                              {employee.dailyBreakdown.map((day) => (
                                <div
                                  key={day.date}
                                  className={`p-2 rounded-lg text-sm ${isDark ? "bg-slate-700/50" : "bg-gray-50"}`}
                                >
                                  <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                                    {new Date(day.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                                  </p>
                                  <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                    {day.clockIn ? formatTime(day.clockIn) : "-"} - {day.clockOut ? formatTime(day.clockOut) : "-"}
                                  </p>
                                  <p className={`font-semibold ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                                    {day.hoursWorked.toFixed(1)}h
                                  </p>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className={`flex items-center justify-center h-64 rounded-xl ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200"}`}>
                  <div className="text-center">
                    <div className="text-4xl mb-3">📊</div>
                    <p className={`${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Select a pay period to view details
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Approval Modal */}
        {showApprovalModal && selectedPeriod && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className={`w-full max-w-md rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
              <h2 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                Approve Timesheets
              </h2>
              <p className={`text-sm mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                You are approving timesheets for the pay period:
              </p>
              <div className={`p-4 rounded-lg mb-4 ${isDark ? "bg-slate-700" : "bg-gray-100"}`}>
                <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                  {formatDate(selectedPeriod.startDate)} - {formatDate(selectedPeriod.endDate)}
                </p>
                {periodDetails && (
                  <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    {periodDetails.totals.totalEmployees} employees • {periodDetails.totals.totalHours.toFixed(1)} hours
                  </p>
                )}
              </div>
              <div>
                <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Notes (optional)
                </label>
                <textarea
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  placeholder="Add any notes about this approval..."
                  rows={3}
                  className={`w-full px-3 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"} border`}
                />
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowApprovalModal(false);
                    setApprovalNotes("");
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${isDark ? "bg-slate-700 text-white" : "bg-gray-200 text-gray-900"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleApprove}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${isDark ? "bg-green-500 text-white hover:bg-green-400" : "bg-green-600 text-white hover:bg-green-700"}`}
                >
                  Approve
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Company Modal */}
        {showCompanyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className={`w-full max-w-md rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
              <h2 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                Add Payroll Company
              </h2>
              <p className={`text-sm mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Create a new company for separate payroll processing.
              </p>
              <div className="space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Company Name
                  </label>
                  <input
                    type="text"
                    value={newCompanyForm.name}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, name: e.target.value })}
                    placeholder="e.g., Import Export Tire"
                    className={`w-full px-3 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"} border`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Company Code
                  </label>
                  <input
                    type="text"
                    value={newCompanyForm.code}
                    onChange={(e) => setNewCompanyForm({ ...newCompanyForm, code: e.target.value.toUpperCase() })}
                    placeholder="e.g., IET"
                    maxLength={5}
                    className={`w-full px-3 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"} border`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Departments
                  </label>
                  <p className={`text-xs mb-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Select which departments belong to this company
                  </p>
                  <div className={`max-h-40 overflow-y-auto rounded-lg border ${isDark ? "border-slate-700 bg-slate-700/50" : "border-gray-200 bg-gray-50"} p-2`}>
                    {allDepartments?.map((dept) => (
                      <label key={dept} className={`flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-opacity-50 ${isDark ? "hover:bg-slate-600" : "hover:bg-gray-200"}`}>
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
                        <span className={`text-sm ${isDark ? "text-white" : "text-gray-900"}`}>{dept}</span>
                      </label>
                    ))}
                    {(!allDepartments || allDepartments.length === 0) && (
                      <p className={`text-sm p-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                        No departments found
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowCompanyModal(false);
                    setNewCompanyForm({ name: "", code: "", departments: [] });
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${isDark ? "bg-slate-700 text-white" : "bg-gray-200 text-gray-900"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateCompany}
                  disabled={!newCompanyForm.name || !newCompanyForm.code}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-400" : "bg-blue-600 text-white hover:bg-blue-700"} disabled:opacity-50`}
                >
                  Create Company
                </button>
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
