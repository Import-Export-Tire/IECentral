"use client";

import { useState, useRef } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

interface ExpenseItem {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  receipt: boolean;
}

const EXPENSE_CATEGORIES = [
  "Fuel / Mileage",
  "Meals",
  "Lodging",
  "Transportation",
  "Supplies",
  "Equipment",
  "Tools",
  "Parts",
  "Shipping",
  "Phone / Internet",
  "Software / Subscriptions",
  "Training",
  "Other",
];

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: "bg-slate-500/20", text: "text-slate-400", label: "Draft" },
  submitted: { bg: "bg-amber-500/20", text: "text-amber-400", label: "Submitted" },
  approved: { bg: "bg-green-500/20", text: "text-green-400", label: "Approved" },
  rejected: { bg: "bg-red-500/20", text: "text-red-400", label: "Rejected" },
  paid: { bg: "bg-cyan-500/20", text: "text-cyan-400", label: "Paid" },
};

function ExpenseReportContent() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const isDark = theme === "dark";
  const printRef = useRef<HTMLDivElement>(null);

  const [viewMode, setViewMode] = useState<"new" | "history">("new");
  const [isSaving, setIsSaving] = useState(false);
  const [selectedReport, setSelectedReport] = useState<any>(null);

  const [reportInfo, setReportInfo] = useState({
    employeeName: user?.name || "",
    department: "",
    reportDate: new Date().toISOString().split("T")[0],
    periodStart: "",
    periodEnd: "",
    purpose: "",
  });

  const [expenses, setExpenses] = useState<ExpenseItem[]>([
    {
      id: `exp-${Date.now()}`,
      date: new Date().toISOString().split("T")[0],
      description: "",
      category: "Fuel / Mileage",
      amount: 0,
      receipt: false,
    },
  ]);

  // Queries
  const myReports = useQuery(
    api.expenseReports.listMine,
    user ? { userId: user._id as Id<"users"> } : "skip"
  );

  // Mutations
  const createReport = useMutation(api.expenseReports.create);
  const submitReport = useMutation(api.expenseReports.submit);
  const removeReport = useMutation(api.expenseReports.remove);
  const revertToDraft = useMutation(api.expenseReports.revertToDraft);

  const addExpense = () => {
    setExpenses([
      ...expenses,
      {
        id: `exp-${Date.now()}`,
        date: new Date().toISOString().split("T")[0],
        description: "",
        category: "Fuel / Mileage",
        amount: 0,
        receipt: false,
      },
    ]);
  };

  const removeExpense = (id: string) => {
    if (expenses.length > 1) {
      setExpenses(expenses.filter((e) => e.id !== id));
    }
  };

  const updateExpense = (id: string, field: keyof ExpenseItem, value: any) => {
    setExpenses(
      expenses.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );
  };

  const total = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

  const handlePrint = () => {
    window.print();
  };

  const clearAll = () => {
    setExpenses([
      {
        id: `exp-${Date.now()}`,
        date: new Date().toISOString().split("T")[0],
        description: "",
        category: "Fuel / Mileage",
        amount: 0,
        receipt: false,
      },
    ]);
    setReportInfo({
      employeeName: user?.name || "",
      department: "",
      reportDate: new Date().toISOString().split("T")[0],
      periodStart: "",
      periodEnd: "",
      purpose: "",
    });
  };

  const validateForm = () => {
    if (!reportInfo.employeeName) return "Employee name is required";
    if (!reportInfo.department) return "Department is required";
    if (!reportInfo.periodStart || !reportInfo.periodEnd) return "Expense period is required";
    if (expenses.every((e) => e.amount === 0)) return "At least one expense item is required";
    return null;
  };

  const handleSaveDraft = async () => {
    const error = validateForm();
    if (error) {
      alert(error);
      return;
    }

    setIsSaving(true);
    try {
      await createReport({
        employeeName: reportInfo.employeeName,
        department: reportInfo.department,
        reportDate: reportInfo.reportDate,
        periodStart: reportInfo.periodStart,
        periodEnd: reportInfo.periodEnd,
        purpose: reportInfo.purpose || undefined,
        items: expenses.filter((e) => e.amount > 0).map((e) => ({
          date: e.date,
          description: e.description,
          category: e.category,
          amount: e.amount,
          hasReceipt: e.receipt,
        })),
        userId: user!._id as Id<"users">,
        personnelId: user?.personnelId as Id<"personnel"> | undefined,
        submitImmediately: false,
      });
      clearAll();
      setViewMode("history");
    } catch (error) {
      console.error("Failed to save draft:", error);
      alert("Failed to save draft. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async () => {
    const error = validateForm();
    if (error) {
      alert(error);
      return;
    }

    setIsSaving(true);
    try {
      await createReport({
        employeeName: reportInfo.employeeName,
        department: reportInfo.department,
        reportDate: reportInfo.reportDate,
        periodStart: reportInfo.periodStart,
        periodEnd: reportInfo.periodEnd,
        purpose: reportInfo.purpose || undefined,
        items: expenses.filter((e) => e.amount > 0).map((e) => ({
          date: e.date,
          description: e.description,
          category: e.category,
          amount: e.amount,
          hasReceipt: e.receipt,
        })),
        userId: user!._id as Id<"users">,
        personnelId: user?.personnelId as Id<"personnel"> | undefined,
        submitImmediately: true,
      });
      clearAll();
      setViewMode("history");
    } catch (error) {
      console.error("Failed to submit:", error);
      alert("Failed to submit report. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const loadReportForPrint = (report: any) => {
    setReportInfo({
      employeeName: report.employeeName,
      department: report.department,
      reportDate: report.reportDate,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      purpose: report.purpose || "",
    });
    setExpenses(
      report.items.map((item: any, i: number) => ({
        id: `exp-${i}`,
        date: item.date,
        description: item.description,
        category: item.category,
        amount: item.amount,
        receipt: item.hasReceipt,
      }))
    );
    setSelectedReport(report);
  };

  return (
    <div className={`flex h-screen theme-bg-primary`}>
      <Sidebar />
      <main className="flex-1 overflow-auto print:overflow-visible">
        <MobileHeader />
        {/* Header - Hidden when printing */}
        <header className={`sticky top-0 z-10 p-6 border-b print:hidden print-hide ${isDark ? "bg-slate-900/95 backdrop-blur border-slate-700" : "bg-[#f2f2f7]/95 backdrop-blur border-gray-200"}`}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className={`text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                Expense Report
              </h1>
              <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Create, save, and track expense reimbursement requests
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* View Mode Toggle */}
              <div className={`flex rounded-lg p-1 ${isDark ? "bg-slate-800" : "bg-gray-200"}`}>
                <button
                  onClick={() => setViewMode("new")}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    viewMode === "new"
                      ? isDark
                        ? "bg-cyan-500 text-white"
                        : "bg-white text-gray-900 shadow-sm"
                      : isDark
                        ? "text-slate-400 hover:text-white"
                        : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  New Report
                </button>
                <button
                  onClick={() => setViewMode("history")}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    viewMode === "history"
                      ? isDark
                        ? "bg-cyan-500 text-white"
                        : "bg-white text-gray-900 shadow-sm"
                      : isDark
                        ? "text-slate-400 hover:text-white"
                        : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  History {myReports && myReports.length > 0 && `(${myReports.length})`}
                </button>
              </div>
            </div>
          </div>
        </header>

        <div className="p-6 print:p-0">
          {/* History View */}
          {viewMode === "history" && (
            <div className="print:hidden print-hide space-y-4">
              {!myReports || myReports.length === 0 ? (
                <div className={`text-center py-12 rounded-xl ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200"}`}>
                  <svg className={`w-12 h-12 mx-auto mb-4 ${isDark ? "text-slate-600" : "text-gray-300"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className={`text-lg font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    No expense reports yet
                  </p>
                  <p className={`text-sm mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Create your first expense report to get started
                  </p>
                  <button
                    onClick={() => setViewMode("new")}
                    className={`mt-4 px-4 py-2 rounded-lg font-medium ${isDark ? "bg-cyan-500 text-white" : "bg-blue-600 text-white"}`}
                  >
                    Create Report
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {myReports.map((report) => {
                    const status = STATUS_STYLES[report.status] || STATUS_STYLES.draft;
                    return (
                      <div
                        key={report._id}
                        className={`rounded-xl p-4 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                                ${report.totalAmount.toFixed(2)}
                              </h3>
                              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${status.bg} ${status.text}`}>
                                {status.label}
                              </span>
                            </div>
                            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              {report.department} &middot; {new Date(report.periodStart).toLocaleDateString()} - {new Date(report.periodEnd).toLocaleDateString()}
                            </p>
                            <p className={`text-xs mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                              {report.items.length} items &middot; {report.purpose || "No description"}
                            </p>
                            {report.status === "rejected" && report.rejectionReason && (
                              <p className="text-xs mt-2 text-red-400">
                                Rejected: {report.rejectionReason}
                              </p>
                            )}
                            {report.status === "approved" && report.approvedByName && (
                              <p className={`text-xs mt-2 ${isDark ? "text-green-400" : "text-green-600"}`}>
                                Approved by {report.approvedByName}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {report.status === "draft" && (
                              <>
                                <button
                                  onClick={async () => {
                                    try {
                                      await submitReport({ reportId: report._id });
                                    } catch (e) {
                                      console.error(e);
                                    }
                                  }}
                                  className={`px-3 py-1.5 text-sm rounded-lg font-medium ${isDark ? "bg-cyan-500 hover:bg-cyan-400 text-white" : "bg-blue-600 hover:bg-blue-700 text-white"}`}
                                >
                                  Submit
                                </button>
                                <button
                                  onClick={async () => {
                                    if (confirm("Delete this draft?")) {
                                      if (!user) return;
                                      await removeReport({ reportId: report._id, requestingUserId: user._id });
                                    }
                                  }}
                                  className={`p-1.5 rounded-lg ${isDark ? "hover:bg-slate-700 text-slate-400 hover:text-red-400" : "hover:bg-gray-100 text-gray-400 hover:text-red-500"}`}
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </>
                            )}
                            {report.status === "rejected" && (
                              <button
                                onClick={async () => {
                                  await revertToDraft({ reportId: report._id });
                                }}
                                className={`px-3 py-1.5 text-sm rounded-lg font-medium ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
                              >
                                Edit & Resubmit
                              </button>
                            )}
                            <button
                              onClick={() => {
                                loadReportForPrint(report);
                                setTimeout(() => handlePrint(), 100);
                              }}
                              className={`p-1.5 rounded-lg ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-400"}`}
                              title="Print"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* New Report Form - Hidden when printing */}
          {viewMode === "new" && (
            <div className="print:hidden print-hide space-y-6">
              {/* Report Info */}
              <div className={`rounded-xl p-6 ${isDark ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                <h2 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Report Information
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Employee Name *
                    </label>
                    <input
                      type="text"
                      value={reportInfo.employeeName}
                      onChange={(e) => setReportInfo({ ...reportInfo, employeeName: e.target.value })}
                      className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Department *
                    </label>
                    <select
                      value={reportInfo.department}
                      onChange={(e) => setReportInfo({ ...reportInfo, department: e.target.value })}
                      className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                    >
                      <option value="">Select Department</option>
                      <option value="Executive">Executive</option>
                      <option value="IT">IT</option>
                      <option value="Warehouse">Warehouse</option>
                      <option value="Office">Office</option>
                      <option value="Sales">Sales</option>
                      <option value="Delivery">Delivery</option>
                    </select>
                  </div>
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Report Date
                    </label>
                    <input
                      type="date"
                      value={reportInfo.reportDate}
                      onChange={(e) => setReportInfo({ ...reportInfo, reportDate: e.target.value })}
                      className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Period Start *
                    </label>
                    <input
                      type="date"
                      value={reportInfo.periodStart}
                      onChange={(e) => setReportInfo({ ...reportInfo, periodStart: e.target.value })}
                      className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Period End *
                    </label>
                    <input
                      type="date"
                      value={reportInfo.periodEnd}
                      onChange={(e) => setReportInfo({ ...reportInfo, periodEnd: e.target.value })}
                      className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Purpose / Business Reason
                    </label>
                    <input
                      type="text"
                      value={reportInfo.purpose}
                      onChange={(e) => setReportInfo({ ...reportInfo, purpose: e.target.value })}
                      placeholder="e.g., Client visit, Trade show, Training"
                      className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                    />
                  </div>
                </div>
              </div>

              {/* Expense Items */}
              <div className={`rounded-xl p-6 ${isDark ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                    Expense Items
                  </h2>
                  <button
                    onClick={addExpense}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Item
                  </button>
                </div>

                <div className="space-y-4">
                  {expenses.map((expense, index) => (
                    <div
                      key={expense.id}
                      className={`p-4 rounded-lg ${isDark ? "bg-slate-700/50" : "bg-gray-50"}`}
                    >
                      <div className="flex items-start gap-4">
                        <span className={`text-sm font-medium w-6 pt-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          {index + 1}.
                        </span>
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                          <div>
                            <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              Date
                            </label>
                            <input
                              type="date"
                              value={expense.date}
                              onChange={(e) => updateExpense(expense.id, "date", e.target.value)}
                              className={`w-full px-3 py-2 rounded-lg text-sm ${isDark ? "bg-slate-800 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                            />
                          </div>
                          <div className="lg:col-span-2">
                            <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              Description
                            </label>
                            <input
                              type="text"
                              value={expense.description}
                              onChange={(e) => updateExpense(expense.id, "description", e.target.value)}
                              placeholder="What was the expense for?"
                              className={`w-full px-3 py-2 rounded-lg text-sm ${isDark ? "bg-slate-800 border-slate-600 text-white placeholder-slate-500" : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                            />
                          </div>
                          <div>
                            <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              Category
                            </label>
                            <select
                              value={expense.category}
                              onChange={(e) => updateExpense(expense.id, "category", e.target.value)}
                              className={`w-full px-3 py-2 rounded-lg text-sm ${isDark ? "bg-slate-800 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                            >
                              {EXPENSE_CATEGORIES.map((cat) => (
                                <option key={cat} value={cat}>{cat}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              Amount ($)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={expense.amount || ""}
                              onChange={(e) => updateExpense(expense.id, "amount", parseFloat(e.target.value) || 0)}
                              placeholder="0.00"
                              className={`w-full px-3 py-2 rounded-lg text-sm ${isDark ? "bg-slate-800 border-slate-600 text-white placeholder-slate-500" : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                            />
                          </div>
                          <div className="flex items-end gap-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={expense.receipt}
                                onChange={(e) => updateExpense(expense.id, "receipt", e.target.checked)}
                                className="w-4 h-4 rounded border-gray-300 text-cyan-500 focus:ring-cyan-500"
                              />
                              <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                Receipt
                              </span>
                            </label>
                            <button
                              onClick={() => removeExpense(expense.id)}
                              disabled={expenses.length === 1}
                              className={`p-2 rounded-lg transition-colors ${
                                expenses.length === 1
                                  ? "opacity-30 cursor-not-allowed"
                                  : isDark
                                    ? "hover:bg-slate-600 text-slate-400 hover:text-red-400"
                                    : "hover:bg-gray-200 text-gray-400 hover:text-red-500"
                              }`}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Total & Actions */}
                <div className={`mt-6 pt-4 border-t ${isDark ? "border-slate-600" : "border-gray-200"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={clearAll}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
                      >
                        Clear
                      </button>
                      <button
                        onClick={handlePrint}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        Print
                      </button>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Total:</span>
                        <span className={`text-2xl font-bold ml-2 ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                          ${total.toFixed(2)}
                        </span>
                      </div>
                      <button
                        onClick={handleSaveDraft}
                        disabled={isSaving}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-200 hover:bg-gray-300 text-gray-700"}`}
                      >
                        {isSaving ? "Saving..." : "Save Draft"}
                      </button>
                      <button
                        onClick={handleSubmit}
                        disabled={isSaving}
                        className={`px-6 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-cyan-500 hover:bg-cyan-400 text-white" : "bg-blue-600 hover:bg-blue-700 text-white"}`}
                      >
                        {isSaving ? "Submitting..." : "Submit for Approval"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Printable Report - Invoice Style */}
          <div ref={printRef} className="hidden print:block print-report" style={{ fontFamily: 'Arial, sans-serif' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '30px', paddingBottom: '20px', borderBottom: '3px solid #1e293b' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <img src="/logo.gif" alt="IE Tires" style={{ height: '50px', width: 'auto' }} />
                </div>
                <div style={{ marginTop: '8px', fontSize: '11px', color: '#64748b' }}>
                  <p style={{ margin: 0 }}>Import Export Tire Co.</p>
                  <p style={{ margin: 0 }}>Employee Expense Reimbursement</p>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 'bold', color: '#1e293b', letterSpacing: '2px' }}>EXPENSE REPORT</h1>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                  Date: {reportInfo.reportDate ? new Date(reportInfo.reportDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '_______________'}
                </p>
              </div>
            </div>

            {/* Submitted By & Period Info */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', marginBottom: '25px' }}>
              <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <p style={{ margin: '0 0 3px 0', fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>Submitted By</p>
                <p style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '600', color: '#1e293b' }}>{reportInfo.employeeName || '________________________'}</p>
                <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>Department: {reportInfo.department || '____________'}</p>
              </div>
              <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <p style={{ margin: '0 0 3px 0', fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>Expense Period</p>
                <p style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '600', color: '#1e293b' }}>
                  {reportInfo.periodStart ? new Date(reportInfo.periodStart).toLocaleDateString() : '___________'} — {reportInfo.periodEnd ? new Date(reportInfo.periodEnd).toLocaleDateString() : '___________'}
                </p>
                <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>Purpose: {reportInfo.purpose || '____________________'}</p>
              </div>
            </div>

            {/* Expense Table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #1e293b' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: '#1e293b', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>#</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: '#1e293b', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Date</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: '#1e293b', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Description</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: '#1e293b', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Category</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', color: '#1e293b', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Receipt</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right', color: '#1e293b', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense, index) => (
                  <tr key={expense.id} style={{ background: index % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>{index + 1}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }}>{expense.date ? new Date(expense.date).toLocaleDateString() : ''}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }}>{expense.description}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>{expense.category}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>{expense.receipt ? '✓' : '—'}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', textAlign: 'right', fontWeight: '500' }}>${expense.amount.toFixed(2)}</td>
                  </tr>
                ))}
                {/* Empty rows */}
                {Array.from({ length: Math.max(0, 6 - expenses.length) }).map((_, i) => (
                  <tr key={`empty-${i}`} style={{ background: (expenses.length + i) % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }}>&nbsp;</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }}>&nbsp;</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }}>&nbsp;</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }}>&nbsp;</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }}>&nbsp;</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }}>&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Total Section */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '30px' }}>
              <div style={{ width: '280px', border: '2px solid #1e293b', padding: '15px 20px', borderRadius: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#1e293b', fontSize: '12px', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>Total Reimbursement</span>
                  <span style={{ color: '#1e293b', fontSize: '22px', fontWeight: 'bold' }}>${total.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Signatures */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '50px', marginTop: '40px' }}>
              <div>
                <p style={{ margin: '0 0 40px 0', fontSize: '11px', color: '#64748b' }}>I certify that the above expenses were incurred for legitimate business purposes and are accurate.</p>
                <div style={{ borderTop: '1px solid #1e293b', paddingTop: '8px' }}>
                  <p style={{ margin: 0, fontSize: '11px', fontWeight: '600', color: '#1e293b' }}>Employee Signature</p>
                  <p style={{ margin: '4px 0 0 0', fontSize: '10px', color: '#94a3b8' }}>Date: ____________________</p>
                </div>
              </div>
              <div>
                <p style={{ margin: '0 0 40px 0', fontSize: '11px', color: '#64748b' }}>Approved for payment:</p>
                <div style={{ borderTop: '1px solid #1e293b', paddingTop: '8px' }}>
                  <p style={{ margin: 0, fontSize: '11px', fontWeight: '600', color: '#1e293b' }}>Manager Approval</p>
                  <p style={{ margin: '4px 0 0 0', fontSize: '10px', color: '#94a3b8' }}>Date: ____________________</p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ marginTop: '40px', paddingTop: '15px', borderTop: '1px solid #e2e8f0', textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: '10px', color: '#94a3b8' }}>Please attach all receipts to this report. Submit to Accounting within 30 days of expense date.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function ExpenseReportPage() {
  return (
    <Protected>
      <ExpenseReportContent />

      {/* Print Styles */}
      <style jsx global>{`
        @media print {
          @page {
            size: letter;
            margin: 0.5in;
          }

          body {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Hide everything except the print report */
          .print\\:hidden,
          header,
          nav,
          aside,
          .print-hide {
            display: none !important;
          }

          /* Show the print report */
          .print-report {
            display: block !important;
            font-family: Arial, sans-serif !important;
            color: #000 !important;
            background: #fff !important;
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          /* Hide the sidebar */
          aside {
            display: none !important;
          }

          /* Make main take full width */
          main {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
          }

          /* Ensure colors print */
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
    </Protected>
  );
}
