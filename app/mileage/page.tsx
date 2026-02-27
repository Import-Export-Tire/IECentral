"use client";

import { useState, useMemo, useRef } from "react";
import Protected from "../protected";
import Sidebar from "@/components/Sidebar";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const DEFAULT_FROM_LOCATION = "Latrobe, PA";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function MileageContent() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const isDark = theme === "dark";
  const printRef = useRef<HTMLDivElement>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Id<"mileageEntries"> | null>(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>("pending"); // Default to pending
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    date: new Date().toISOString().split("T")[0],
    fromLocation: DEFAULT_FROM_LOCATION,
    toLocation: "",
    miles: "",
    isRoundTrip: true,
    purpose: "",
    vehicle: "",
    notes: "",
  });

  // Queries - filter by current user's mileage only
  const entries = useQuery(api.mileage.list, user?._id ? {
    year: selectedYear,
    month: selectedMonth ?? undefined,
    status: selectedStatus ?? undefined,
    userId: user._id,
  } : "skip");

  const summary = useQuery(api.mileage.getSummary, user?._id ? {
    year: selectedYear,
    month: selectedMonth ?? undefined,
    userId: user._id,
  } : "skip");

  const currentRate = useQuery(api.mileage.getCurrentRate);

  // Mutations
  const createEntry = useMutation(api.mileage.create);
  const updateEntry = useMutation(api.mileage.update);
  const updateStatus = useMutation(api.mileage.updateStatus);
  const bulkUpdateStatus = useMutation(api.mileage.bulkUpdateStatus);
  const removeEntry = useMutation(api.mileage.remove);

  // Get pending entries for submit report
  const pendingEntries = useMemo(() => {
    return entries?.filter(e => e.status === "pending") || [];
  }, [entries]);

  const pendingTotal = useMemo(() => {
    return pendingEntries.reduce((sum, e) => sum + e.reimbursementAmount, 0);
  }, [pendingEntries]);

  // Get submitted entries for approve action
  const submittedEntries = useMemo(() => {
    return entries?.filter(e => e.status === "submitted") || [];
  }, [entries]);

  const submittedTotal = useMemo(() => {
    return submittedEntries.reduce((sum, e) => sum + e.reimbursementAmount, 0);
  }, [submittedEntries]);

  // Get approved entries for mark-as-paid action
  const approvedEntries = useMemo(() => {
    return entries?.filter(e => e.status === "approved") || [];
  }, [entries]);

  const approvedTotal = useMemo(() => {
    return approvedEntries.reduce((sum, e) => sum + e.reimbursementAmount, 0);
  }, [approvedEntries]);

  // Compute totals from the filtered entries (matches the current status filter)
  const filteredTotalEntries = entries?.length || 0;
  const filteredTotalMiles = useMemo(() => {
    return entries?.reduce((sum, e) => {
      const miles = e.isRoundTrip ? e.miles * 2 : e.miles;
      return sum + miles;
    }, 0) || 0;
  }, [entries]);
  const filteredTotalReimbursement = useMemo(() => {
    return entries?.reduce((sum, e) => sum + e.reimbursementAmount, 0) || 0;
  }, [entries]);

  // Submit all pending entries as a report
  const handleSubmitReport = async () => {
    if (pendingEntries.length === 0) return;

    if (!confirm(`Submit ${pendingEntries.length} entries totaling ${formatCurrency(pendingTotal)} for reimbursement?`)) {
      return;
    }

    setIsSubmitting(true);
    try {
      await bulkUpdateStatus({
        entryIds: pendingEntries.map(e => e._id),
        status: "submitted",
      });
      // Switch view to show submitted entries
      setSelectedStatus("submitted");
    } catch (err) {
      console.error("Failed to submit report:", err);
      alert("Failed to submit report");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Approve all submitted entries
  const handleApproveAll = async () => {
    if (submittedEntries.length === 0) return;

    if (!confirm(`Approve ${submittedEntries.length} entries totaling ${formatCurrency(submittedTotal)}?`)) {
      return;
    }

    setIsSubmitting(true);
    try {
      await bulkUpdateStatus({
        entryIds: submittedEntries.map(e => e._id),
        status: "approved",
      });
      setSelectedStatus("approved");
    } catch (err) {
      console.error("Failed to approve entries:", err);
      alert("Failed to approve entries");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Mark all approved entries as paid
  const handleMarkPaid = async () => {
    if (approvedEntries.length === 0) return;

    if (!confirm(`Mark ${approvedEntries.length} entries totaling ${formatCurrency(approvedTotal)} as paid?`)) {
      return;
    }

    setIsSubmitting(true);
    try {
      await bulkUpdateStatus({
        entryIds: approvedEntries.map(e => e._id),
        status: "paid",
      });
      setSelectedStatus("paid");
    } catch (err) {
      console.error("Failed to mark entries as paid:", err);
      alert("Failed to mark entries as paid");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Years for filter
  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return [currentYear, currentYear - 1, currentYear - 2];
  }, []);

  const months = [
    { value: 1, label: "January" },
    { value: 2, label: "February" },
    { value: 3, label: "March" },
    { value: 4, label: "April" },
    { value: 5, label: "May" },
    { value: 6, label: "June" },
    { value: 7, label: "July" },
    { value: 8, label: "August" },
    { value: 9, label: "September" },
    { value: 10, label: "October" },
    { value: 11, label: "November" },
    { value: 12, label: "December" },
  ];

  const handleSubmit = async () => {
    if (!user || !formData.toLocation || !formData.miles || !formData.purpose) return;

    try {
      if (editingEntry) {
        await updateEntry({
          entryId: editingEntry,
          date: formData.date,
          fromLocation: formData.fromLocation,
          toLocation: formData.toLocation,
          miles: parseFloat(formData.miles),
          isRoundTrip: formData.isRoundTrip,
          purpose: formData.purpose,
          vehicle: formData.vehicle || undefined,
          notes: formData.notes || undefined,
        });
      } else {
        await createEntry({
          date: formData.date,
          fromLocation: formData.fromLocation,
          toLocation: formData.toLocation,
          miles: parseFloat(formData.miles),
          isRoundTrip: formData.isRoundTrip,
          purpose: formData.purpose,
          vehicle: formData.vehicle || undefined,
          notes: formData.notes || undefined,
          userId: user._id as Id<"users">,
        });
      }

      setShowAddModal(false);
      setEditingEntry(null);
      resetForm();
    } catch (err) {
      console.error("Failed to save entry:", err);
    }
  };

  const handleEdit = (entry: NonNullable<typeof entries>[0]) => {
    setEditingEntry(entry._id);
    setFormData({
      date: entry.date,
      fromLocation: entry.fromLocation,
      toLocation: entry.toLocation,
      miles: entry.miles.toString(),
      isRoundTrip: entry.isRoundTrip,
      purpose: entry.purpose,
      vehicle: entry.vehicle || "",
      notes: entry.notes || "",
    });
    setShowAddModal(true);
  };

  const handleDelete = async (entryId: Id<"mileageEntries">) => {
    if (!confirm("Are you sure you want to delete this entry?")) return;
    try {
      await removeEntry({ entryId });
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  };

  const resetForm = () => {
    setFormData({
      date: new Date().toISOString().split("T")[0],
      fromLocation: DEFAULT_FROM_LOCATION,
      toLocation: "",
      miles: "",
      isRoundTrip: true,
      purpose: "",
      vehicle: "",
      notes: "",
    });
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-gray-50"}`}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        {/* Print styles */}
        <style jsx global>{`
          @media print {
            @page {
              margin: 0.5in;
              size: letter;
            }

            body {
              margin: 0 !important;
              padding: 0 !important;
              background: white !important;
            }

            /* Hide everything except print area */
            .no-print,
            header,
            aside {
              display: none !important;
            }

            /* Hide all on-screen content inside print-area */
            .print-area > *:not(.print-only) {
              display: none !important;
            }

            .print-area {
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              width: 100% !important;
              background: white !important;
              color: black !important;
              padding: 0 !important;
              font-family: Arial, sans-serif !important;
            }

            .print-only {
              display: block !important;
            }
          }
        `}</style>

        {/* Header */}
        <header
          className={`sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-4 no-print ${
            isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <h1 className={`text-xl sm:text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                Mileage Tracker
              </h1>
              <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                IRS Rate: ${currentRate?.toFixed(2)}/mile
              </p>
            </div>
            <div className="flex gap-2">
              {/* Submit Report Button - only show when viewing pending and there are pending entries */}
              {selectedStatus === "pending" && pendingEntries.length > 0 && (
                <button
                  onClick={handleSubmitReport}
                  disabled={isSubmitting}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                    isDark
                      ? "bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
                      : "bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                  }`}
                >
                  {isSubmitting ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Submitting...
                    </>
                  ) : (
                    <>
                      Submit Report ({pendingEntries.length}) - {formatCurrency(pendingTotal)}
                    </>
                  )}
                </button>
              )}
              {/* Approve All Button - only show when viewing submitted entries */}
              {selectedStatus === "submitted" && submittedEntries.length > 0 && (
                <button
                  onClick={handleApproveAll}
                  disabled={isSubmitting}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                    isDark
                      ? "bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
                      : "bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                  }`}
                >
                  {isSubmitting ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Approving...
                    </>
                  ) : (
                    <>
                      Approve All ({submittedEntries.length}) - {formatCurrency(submittedTotal)}
                    </>
                  )}
                </button>
              )}
              {/* Mark as Paid Button - only show when viewing approved entries */}
              {selectedStatus === "approved" && approvedEntries.length > 0 && (
                <button
                  onClick={handleMarkPaid}
                  disabled={isSubmitting}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                    isDark
                      ? "bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
                      : "bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                  }`}
                >
                  {isSubmitting ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Processing...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Mark as Paid ({approvedEntries.length}) - {formatCurrency(approvedTotal)}
                    </>
                  )}
                </button>
              )}
              <button
                onClick={handlePrint}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  isDark
                    ? "bg-slate-700 text-white hover:bg-slate-600"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Print
              </button>
              <button
                onClick={() => {
                  resetForm();
                  setEditingEntry(null);
                  setShowAddModal(true);
                }}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  isDark
                    ? "bg-cyan-500 text-white hover:bg-cyan-600"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                + Add Entry
              </button>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-8 print-area" ref={printRef}>
          {/* Print Header - Invoice Style */}
          <div className="hidden print:block print-only" style={{ fontFamily: 'Arial, sans-serif' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '30px', paddingBottom: '20px', borderBottom: '3px solid #1e293b' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <img src="/logo.gif" alt="IE Tires" style={{ height: '50px', width: 'auto' }} />
                </div>
                <div style={{ marginTop: '8px', fontSize: '11px', color: '#64748b' }}>
                  <p style={{ margin: 0 }}>Import Export Tire Co.</p>
                  <p style={{ margin: 0 }}>Mileage Reimbursement Request</p>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 'bold', color: '#1e293b', letterSpacing: '2px' }}>MILEAGE REPORT</h1>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                  IRS Rate: ${currentRate?.toFixed(3)}/mile
                </p>
              </div>
            </div>

            {/* Employee & Period Info */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', marginBottom: '25px' }}>
              <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <p style={{ margin: '0 0 3px 0', fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>Submitted By</p>
                <p style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '600', color: '#1e293b' }}>{user?.name || '________________________'}</p>
                <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>Email: {user?.email || '____________'}</p>
              </div>
              <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <p style={{ margin: '0 0 3px 0', fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>Report Period</p>
                <p style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '600', color: '#1e293b' }}>
                  {selectedMonth ? months.find((m) => m.value === selectedMonth)?.label : "All Months"} {selectedYear}
                </p>
                <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>Generated: {new Date().toLocaleDateString()}</p>
              </div>
            </div>

            {/* Summary Box */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '20px' }}>
              <div style={{ width: '100%', border: '2px solid #1e293b', padding: '15px 20px', borderRadius: '6px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', textAlign: 'center' }}>
                  <div>
                    <p style={{ margin: 0, color: '#64748b', fontSize: '10px', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>Total Entries</p>
                    <p style={{ margin: '4px 0 0 0', color: '#1e293b', fontSize: '20px', fontWeight: 'bold' }}>{filteredTotalEntries}</p>
                  </div>
                  <div>
                    <p style={{ margin: 0, color: '#64748b', fontSize: '10px', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>Total Miles</p>
                    <p style={{ margin: '4px 0 0 0', color: '#1e293b', fontSize: '20px', fontWeight: 'bold' }}>{filteredTotalMiles.toFixed(1)}</p>
                  </div>
                  <div>
                    <p style={{ margin: 0, color: '#64748b', fontSize: '10px', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>Total Reimbursement</p>
                    <p style={{ margin: '4px 0 0 0', color: '#1e293b', fontSize: '20px', fontWeight: 'bold' }}>{formatCurrency(filteredTotalReimbursement)}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px', fontSize: '11px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #1e293b' }}>
                  <th style={{ padding: '10px 8px', textAlign: 'left', color: '#1e293b', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Date</th>
                  <th style={{ padding: '10px 8px', textAlign: 'left', color: '#1e293b', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>From</th>
                  <th style={{ padding: '10px 8px', textAlign: 'left', color: '#1e293b', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>To</th>
                  <th style={{ padding: '10px 8px', textAlign: 'center', color: '#1e293b', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Miles</th>
                  <th style={{ padding: '10px 8px', textAlign: 'left', color: '#1e293b', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Purpose</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right', color: '#1e293b', fontWeight: '600', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {entries?.map((entry, index) => (
                  <tr key={entry._id} style={{ background: index % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                    <td style={{ padding: '8px', borderBottom: '1px solid #e2e8f0', fontSize: '11px' }}>{formatDate(entry.date)}</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #e2e8f0', fontSize: '11px', color: '#64748b' }}>{entry.fromLocation}</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #e2e8f0', fontSize: '11px' }}>{entry.toLocation}</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #e2e8f0', fontSize: '11px', textAlign: 'center' }}>{entry.miles}{entry.isRoundTrip ? ' (RT)' : ''}</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #e2e8f0', fontSize: '11px', color: '#64748b', maxWidth: '150px' }}>{entry.purpose}</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #e2e8f0', fontSize: '11px', textAlign: 'right', fontWeight: '500' }}>{formatCurrency(entry.reimbursementAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f1f5f9' }}>
                  <td colSpan={3} style={{ padding: '10px 8px', fontWeight: 'bold', fontSize: '11px', textAlign: 'right' }}>TOTALS:</td>
                  <td style={{ padding: '10px 8px', fontWeight: 'bold', fontSize: '11px', textAlign: 'center' }}>{filteredTotalMiles.toFixed(1)}</td>
                  <td style={{ padding: '10px 8px' }}></td>
                  <td style={{ padding: '10px 8px', fontWeight: 'bold', fontSize: '11px', textAlign: 'right' }}>{formatCurrency(filteredTotalReimbursement)}</td>
                </tr>
              </tfoot>
            </table>

            {/* Certification & Signatures */}
            <div style={{ marginTop: '30px', padding: '15px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
              <p style={{ margin: 0, fontSize: '11px', color: '#64748b' }}>
                <strong style={{ color: '#1e293b' }}>EMPLOYEE CERTIFICATION:</strong> I certify that the above mileage was incurred in the performance
                of official business duties and that I have not been reimbursed from any other source.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '50px', marginTop: '40px' }}>
              <div>
                <div style={{ borderTop: '1px solid #1e293b', paddingTop: '8px', marginTop: '50px' }}>
                  <p style={{ margin: 0, fontSize: '11px', fontWeight: '600', color: '#1e293b' }}>Employee Signature</p>
                  <p style={{ margin: '4px 0 0 0', fontSize: '10px', color: '#94a3b8' }}>Date: ____________________</p>
                </div>
              </div>
              <div>
                <div style={{ borderTop: '1px solid #1e293b', paddingTop: '8px', marginTop: '50px' }}>
                  <p style={{ margin: 0, fontSize: '11px', fontWeight: '600', color: '#1e293b' }}>Supervisor Approval</p>
                  <p style={{ margin: '4px 0 0 0', fontSize: '10px', color: '#94a3b8' }}>Date: ____________________</p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ marginTop: '40px', paddingTop: '15px', borderTop: '1px solid #e2e8f0', textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: '10px', color: '#94a3b8' }}>This document is for internal use only. Submit to Accounting for reimbursement processing.</p>
            </div>
          </div>

          {/* Filters */}
          <div className={`flex flex-wrap gap-3 mb-6 no-print`}>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className={`px-3 py-2 rounded-lg border ${
                isDark
                  ? "bg-slate-800 border-slate-600 text-white"
                  : "bg-white border-gray-300 text-gray-900"
              }`}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>

            <select
              value={selectedMonth ?? ""}
              onChange={(e) => setSelectedMonth(e.target.value ? parseInt(e.target.value) : null)}
              className={`px-3 py-2 rounded-lg border ${
                isDark
                  ? "bg-slate-800 border-slate-600 text-white"
                  : "bg-white border-gray-300 text-gray-900"
              }`}
            >
              <option value="">All Months</option>
              {months.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>

            <select
              value={selectedStatus ?? ""}
              onChange={(e) => setSelectedStatus(e.target.value || null)}
              className={`px-3 py-2 rounded-lg border ${
                isDark
                  ? "bg-slate-800 border-slate-600 text-white"
                  : "bg-white border-gray-300 text-gray-900"
              }`}
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="paid">Paid</option>
            </select>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 no-print">
            <div className={`p-4 rounded-xl border ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Total Entries</p>
              <p className={`text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                {filteredTotalEntries}
              </p>
            </div>
            <div className={`p-4 rounded-xl border ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Total Miles</p>
              <p className={`text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                {filteredTotalMiles.toFixed(1)}
              </p>
            </div>
            <div className={`p-4 rounded-xl border ${isDark ? "bg-cyan-500/10 border-cyan-500/30" : "bg-blue-50 border-blue-200"}`}>
              <p className={`text-sm ${isDark ? "text-cyan-400" : "text-blue-600"}`}>Total Reimbursement</p>
              <p className={`text-2xl font-bold ${isDark ? "text-cyan-400" : "text-blue-700"}`}>
                {formatCurrency(filteredTotalReimbursement)}
              </p>
            </div>
            <div className={`p-4 rounded-xl border ${isDark ? "bg-green-500/10 border-green-500/30" : "bg-green-50 border-green-200"}`}>
              <p className={`text-sm ${isDark ? "text-green-400" : "text-green-600"}`}>Paid</p>
              <p className={`text-2xl font-bold ${isDark ? "text-green-400" : "text-green-700"}`}>
                {summary?.byStatus?.paid || 0}
              </p>
            </div>
          </div>

          {/* Entries Table */}
          <div className={`rounded-xl border overflow-hidden no-print ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
            <table className="w-full">
              <thead className={isDark ? "bg-slate-700" : "bg-gray-50"}>
                <tr>
                  <th className={`px-4 py-3 text-left text-sm font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>Date</th>
                  <th className={`px-4 py-3 text-left text-sm font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>From</th>
                  <th className={`px-4 py-3 text-left text-sm font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>To</th>
                  <th className={`px-4 py-3 text-left text-sm font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>Miles</th>
                  <th className={`px-4 py-3 text-left text-sm font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>Vehicle</th>
                  <th className={`px-4 py-3 text-left text-sm font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>Purpose</th>
                  <th className={`px-4 py-3 text-left text-sm font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>Reimbursement</th>
                  <th className={`px-4 py-3 text-left text-sm font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>Status</th>
                  <th className={`px-4 py-3 text-right text-sm font-medium no-print ${isDark ? "text-slate-300" : "text-gray-600"}`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {entries?.map((entry) => (
                  <tr key={entry._id} className={isDark ? "hover:bg-slate-700/50" : "hover:bg-gray-50"}>
                    <td className={`px-4 py-3 text-sm ${isDark ? "text-white" : "text-gray-900"}`}>
                      {formatDate(entry.date)}
                    </td>
                    <td className={`px-4 py-3 text-sm ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                      {entry.fromLocation}
                    </td>
                    <td className={`px-4 py-3 text-sm ${isDark ? "text-white" : "text-gray-900"}`}>
                      {entry.toLocation}
                    </td>
                    <td className={`px-4 py-3 text-sm ${isDark ? "text-white" : "text-gray-900"}`}>
                      {entry.miles} {entry.isRoundTrip && <span className="text-xs text-slate-500">(RT)</span>}
                    </td>
                    <td className={`px-4 py-3 text-sm ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                      {entry.vehicle || "-"}
                    </td>
                    <td className={`px-4 py-3 text-sm max-w-[200px] truncate ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                      {entry.purpose}
                    </td>
                    <td className={`px-4 py-3 text-sm font-medium ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                      {formatCurrency(entry.reimbursementAmount)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded ${
                          entry.status === "paid"
                            ? "bg-green-500/20 text-green-400"
                            : entry.status === "approved"
                            ? "bg-blue-500/20 text-blue-400"
                            : entry.status === "submitted"
                            ? "bg-purple-500/20 text-purple-400"
                            : "bg-amber-500/20 text-amber-400"
                        }`}
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right no-print">
                      <div className="flex justify-end gap-2">
                        {entry.status === "pending" && (
                          <>
                            <button
                              onClick={() => handleEdit(entry)}
                              className={`px-2 py-1 text-xs font-medium rounded ${
                                isDark
                                  ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                              }`}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(entry._id)}
                              className="px-2 py-1 text-xs font-medium rounded bg-red-500/20 text-red-400 hover:bg-red-500/30"
                            >
                              Delete
                            </button>
                          </>
                        )}
                        {entry.status === "submitted" && (
                          <button
                            onClick={async () => {
                              try {
                                await updateStatus({ entryId: entry._id, status: "approved" });
                              } catch (err) {
                                console.error("Failed to approve entry:", err);
                              }
                            }}
                            className="px-2 py-1 text-xs font-medium rounded bg-green-500/20 text-green-400 hover:bg-green-500/30"
                          >
                            Approve
                          </button>
                        )}
                        {entry.status === "approved" && (
                          <button
                            onClick={async () => {
                              try {
                                await updateStatus({ entryId: entry._id, status: "paid" });
                              } catch (err) {
                                console.error("Failed to mark entry as paid:", err);
                              }
                            }}
                            className="px-2 py-1 text-xs font-medium rounded bg-green-500/20 text-green-400 hover:bg-green-500/30"
                          >
                            Mark Paid
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {(!entries || entries.length === 0) && (
                  <tr>
                    <td colSpan={9} className={`px-4 py-8 text-center ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      No mileage entries found. Add your first entry to get started.
                    </td>
                  </tr>
                )}
              </tbody>
              {entries && entries.length > 0 && (
                <tfoot className={isDark ? "bg-slate-700" : "bg-gray-50"}>
                  <tr>
                    <td colSpan={3} className={`px-4 py-3 text-sm font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                      TOTALS
                    </td>
                    <td className={`px-4 py-3 text-sm font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                      {filteredTotalMiles.toFixed(1)}
                    </td>
                    <td colSpan={2}></td>
                    <td className={`px-4 py-3 text-sm font-bold ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                      {formatCurrency(filteredTotalReimbursement)}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

        </div>

        {/* Add/Edit Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 no-print">
            <div className={`w-full max-w-lg rounded-xl border ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className={`p-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  {editingEntry ? "Edit Mileage Entry" : "Add Mileage Entry"}
                </h2>
              </div>

              <div className="p-4 space-y-4">
                {/* Date */}
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Date *
                  </label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                  />
                </div>

                {/* From Location */}
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    From *
                  </label>
                  <input
                    type="text"
                    value={formData.fromLocation}
                    onChange={(e) => setFormData({ ...formData, fromLocation: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                    placeholder="Latrobe, PA"
                  />
                </div>

                {/* To Location */}
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    To *
                  </label>
                  <input
                    type="text"
                    value={formData.toLocation}
                    onChange={(e) => setFormData({ ...formData, toLocation: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                    placeholder="Pittsburgh, PA"
                  />
                </div>

                {/* Miles and Round Trip */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Miles (one way) *
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.miles}
                      onChange={(e) => setFormData({ ...formData, miles: e.target.value })}
                      className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                      placeholder="45.5"
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.isRoundTrip}
                        onChange={(e) => setFormData({ ...formData, isRoundTrip: e.target.checked })}
                        className="rounded"
                      />
                      <span className={isDark ? "text-white" : "text-gray-900"}>Round Trip</span>
                    </label>
                  </div>
                </div>

                {/* Calculated Reimbursement Preview */}
                {formData.miles && currentRate && (
                  <div className={`p-3 rounded-lg ${isDark ? "bg-cyan-500/10" : "bg-blue-50"}`}>
                    <p className={`text-sm ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                      Estimated Reimbursement:{" "}
                      <span className="font-bold">
                        {formatCurrency(
                          parseFloat(formData.miles) * (formData.isRoundTrip ? 2 : 1) * currentRate
                        )}
                      </span>
                      {formData.isRoundTrip && (
                        <span className="text-xs ml-2">
                          ({parseFloat(formData.miles) * 2} miles total)
                        </span>
                      )}
                    </p>
                  </div>
                )}

                {/* Purpose */}
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Business Purpose *
                  </label>
                  <input
                    type="text"
                    value={formData.purpose}
                    onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                    placeholder="Client meeting, site visit, etc."
                  />
                </div>

                {/* Vehicle */}
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Vehicle
                  </label>
                  <input
                    type="text"
                    value={formData.vehicle}
                    onChange={(e) => setFormData({ ...formData, vehicle: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                    placeholder="2022 Ford F-150, Personal car, etc."
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={2}
                    className={`w-full px-3 py-2 rounded-lg border resize-none ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                    placeholder="Additional notes..."
                  />
                </div>
              </div>

              <div className={`p-4 border-t flex gap-3 ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingEntry(null);
                    resetForm();
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!formData.toLocation || !formData.miles || !formData.purpose}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium disabled:opacity-50 ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                >
                  {editingEntry ? "Save Changes" : "Add Entry"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function MileagePage() {
  return (
    <Protected>
      <MileageContent />
    </Protected>
  );
}
