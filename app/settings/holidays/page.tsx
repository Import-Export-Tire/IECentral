"use client";

import { useState } from "react";
import Link from "next/link";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "@/app/auth-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";

interface Holiday {
  _id: Id<"holidays">;
  name: string;
  date: string;
  type: string;
  isPaidHoliday: boolean;
  affectedLocations?: Id<"locations">[];
  affectedDepartments?: string[];
  isRecurring?: boolean;
  notes?: string;
  createdAt: number;
}

function HolidaysContent() {
  const { user } = useAuth();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState<Holiday | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    date: "",
    type: "holiday",
    isPaidHoliday: true,
    isRecurring: false,
    notes: "",
  });

  const holidays = useQuery(api.holidays.listByYear, { year: selectedYear }) as Holiday[] | undefined;
  const locations = useQuery(api.locations.list);
  const createHoliday = useMutation(api.holidays.create);
  const updateHoliday = useMutation(api.holidays.update);
  const deleteHoliday = useMutation(api.holidays.remove);
  const createStandardHolidays = useMutation(api.holidays.createStandardHolidays);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (editingHoliday) {
      await updateHoliday({
        holidayId: editingHoliday._id,
        name: formData.name,
        date: formData.date,
        type: formData.type,
        isPaidHoliday: formData.isPaidHoliday,
        isRecurring: formData.isRecurring,
        notes: formData.notes || undefined,
      });
    } else {
      await createHoliday({
        name: formData.name,
        date: formData.date,
        type: formData.type,
        isPaidHoliday: formData.isPaidHoliday,
        isRecurring: formData.isRecurring,
        notes: formData.notes || undefined,
        createdBy: user._id,
      });
    }

    setShowAddModal(false);
    setEditingHoliday(null);
    setFormData({
      name: "",
      date: "",
      type: "holiday",
      isPaidHoliday: true,
      isRecurring: false,
      notes: "",
    });
  };

  const handleEdit = (holiday: Holiday) => {
    setEditingHoliday(holiday);
    setFormData({
      name: holiday.name,
      date: holiday.date,
      type: holiday.type,
      isPaidHoliday: holiday.isPaidHoliday,
      isRecurring: holiday.isRecurring || false,
      notes: holiday.notes || "",
    });
    setShowAddModal(true);
  };

  const handleDelete = async (holidayId: Id<"holidays">) => {
    if (confirm("Are you sure you want to delete this holiday?")) {
      await deleteHoliday({ holidayId });
    }
  };

  const handleAddStandardHolidays = async () => {
    if (!user) return;
    if (confirm(`Add standard US holidays for ${selectedYear}? Existing holidays on the same dates will be skipped.`)) {
      await createStandardHolidays({ year: selectedYear, createdBy: user._id });
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  const getTypeBadgeClass = (type: string) => {
    switch (type) {
      case "holiday": return "ui-badge ui-badge-green";
      case "closure": return "ui-badge ui-badge-red";
      case "override": return "ui-badge ui-badge-amber";
      default: return "ui-badge ui-badge-gray";
    }
  };

  void locations;

  return (
    <div className="flex h-screen theme-bg">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Sticky iOS-style page header */}
        <header className="sticky top-0 z-10 backdrop-blur-sm border-b theme-border-secondary px-4 sm:px-8 py-3 sm:py-4 bg-[var(--surface-primary)]/80">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link
                href="/settings"
                className="p-2 -ml-2 rounded-lg theme-text-secondary hover:theme-text-primary transition-colors hover:bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)]"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">Holidays &amp; Schedule Overrides</h1>
                <p className="text-xs sm:text-sm mt-0.5 theme-text-tertiary">
                  Manage company holidays to prevent false no-call-no-show triggers
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="theme-input px-3 py-2 text-sm"
              >
                {[currentYear - 1, currentYear, currentYear + 1].map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>

              <Button variant="secondary" size="sm" onClick={handleAddStandardHolidays}>
                + Add US Holidays
              </Button>

              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setEditingHoliday(null);
                  setFormData({
                    name: "",
                    date: `${selectedYear}-01-01`,
                    type: "holiday",
                    isPaidHoliday: true,
                    isRecurring: false,
                    notes: "",
                  });
                  setShowAddModal(true);
                }}
              >
                + Add Custom
              </Button>
            </div>
          </div>
        </header>

        <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-5 max-w-4xl">
          {/* Holiday List */}
          <Card padding="md">
            <SectionHeader label="HOLIDAY CALENDAR" title={`${selectedYear} Holidays`} />
            {!holidays || holidays.length === 0 ? (
              <div className="py-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center bg-[#f2f2f7] dark:bg-slate-900/60">
                  <svg className="w-8 h-8 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold theme-text-primary">No holidays for {selectedYear}</h3>
                <p className="mt-1 text-sm theme-text-secondary">Add standard US holidays or create custom ones</p>
              </div>
            ) : (
              <div className="space-y-0 divide-y theme-border-secondary">
                {holidays.map((holiday) => (
                  <div
                    key={holiday._id}
                    className="flex items-center justify-between py-3 hover:bg-[color-mix(in_srgb,var(--accent-primary)_4%,transparent)] -mx-1 px-1 rounded-lg transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[#f2f2f7] dark:bg-slate-900/60 text-xl">
                        {holiday.type === "holiday" ? "🎉" : holiday.type === "closure" ? "🚫" : "📅"}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium theme-text-primary">{holiday.name}</span>
                          <span className={getTypeBadgeClass(holiday.type)}>{holiday.type}</span>
                          {holiday.isPaidHoliday && (
                            <span className="ui-badge ui-badge-purple">Paid</span>
                          )}
                          {holiday.isRecurring && (
                            <span className="ui-badge ui-badge-blue">Recurring</span>
                          )}
                        </div>
                        <p className="text-sm theme-text-secondary mt-0.5">
                          {formatDate(holiday.date)}
                          {holiday.notes && ` — ${holiday.notes}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEdit(holiday)}
                        className="p-2 rounded-lg theme-text-secondary hover:theme-text-primary hover:bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)] transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(holiday._id)}
                        className="p-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Info callout */}
          <Card tone="accent" padding="sm">
            <div className="flex gap-3">
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5 theme-accent-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h4 className="font-medium theme-text-primary">How holidays work</h4>
                <ul className="mt-1 text-sm space-y-1 theme-text-secondary">
                  <li>- Holidays prevent automatic No-Call-No-Show detection</li>
                  <li>- Employees won&apos;t be flagged as missing on holiday dates</li>
                  <li>- You can restrict holidays to specific locations or departments</li>
                  <li>- Recurring holidays will be auto-created for future years</li>
                </ul>
              </div>
            </div>
          </Card>
        </div>
      </main>

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="theme-card w-full max-w-md">
            <div className="p-5 border-b theme-border-secondary">
              <h2 className="text-lg font-semibold theme-text-primary">
                {editingHoliday ? "Edit Holiday" : "Add Holiday"}
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block ui-section-label mb-1.5">Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Christmas Day"
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block ui-section-label mb-1.5">Date *</label>
                <input
                  type="date"
                  required
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block ui-section-label mb-1.5">Type *</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  className="theme-input w-full px-3 py-2 text-sm"
                >
                  <option value="holiday">Holiday</option>
                  <option value="closure">Office Closure</option>
                  <option value="override">Schedule Override</option>
                </select>
              </div>

              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isPaidHoliday}
                    onChange={(e) => setFormData({ ...formData, isPaidHoliday: e.target.checked })}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-sm theme-text-secondary">Paid Holiday</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isRecurring}
                    onChange={(e) => setFormData({ ...formData, isRecurring: e.target.checked })}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-sm theme-text-secondary">Recurring Annually</span>
                </label>
              </div>

              <div>
                <label className="block ui-section-label mb-1.5">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Optional notes..."
                  rows={2}
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingHoliday(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" className="flex-1">
                  {editingHoliday ? "Update" : "Create"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HolidaysPage() {
  return (
    <Protected>
      <HolidaysContent />
    </Protected>
  );
}
