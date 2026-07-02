"use client";

import { useState } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "../auth-context";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";

function ScheduleTemplatesContent() {
  const { user } = useAuth();

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<Id<"shiftTemplates"> | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startTime, setStartTime] = useState("06:00");
  const [endTime, setEndTime] = useState("14:30");
  const [error, setError] = useState("");

  // Queries
  const templates = useQuery(api.shiftTemplates.list, {});

  // Mutations
  const createTemplate = useMutation(api.shiftTemplates.create);
  const updateTemplate = useMutation(api.shiftTemplates.update);
  const deleteTemplate = useMutation(api.shiftTemplates.remove);

  const resetForm = () => {
    setName("");
    setDescription("");
    setStartTime("06:00");
    setEndTime("14:30");
    setEditingId(null);
    setError("");
  };

  const handleEdit = (template: NonNullable<typeof templates>[0]) => {
    setEditingId(template._id);
    setName(template.name);
    setDescription(template.description || "");
    // Get times from first department if exists
    if (template.departments.length > 0) {
      setStartTime(template.departments[0].startTime);
      setEndTime(template.departments[0].endTime);
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Schedule name is required");
      return;
    }
    if (!user) return;

    try {
      // Create a simple department entry to store the times
      const departments = [{
        name: "Default",
        position: "Employee",
        startTime,
        endTime,
        requiredCount: 1,
        assignedPersonnel: [] as Id<"personnel">[],
      }];

      if (editingId) {
        await updateTemplate({
          templateId: editingId,
          name: name.trim(),
          description: description.trim() || undefined,
          departments,
        });
      } else {
        await createTemplate({
          name: name.trim(),
          description: description.trim() || undefined,
          departments,
          userId: user._id,
        });
      }
      setShowModal(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const handleDelete = async (templateId: Id<"shiftTemplates">) => {
    if (!confirm("Delete this schedule?")) return;
    try {
      await deleteTemplate({ templateId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const h = parseInt(hours);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
  };

  const getScheduleTimes = (template: NonNullable<typeof templates>[0]) => {
    if (template.departments.length > 0) {
      const dept = template.departments[0];
      return `${formatTime(dept.startTime)} – ${formatTime(dept.endTime)}`;
    }
    return "No times set";
  };

  return (
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Sticky iOS-style page header */}
        <header className="flex-shrink-0 sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold theme-text-primary truncate">
                Work Schedules
              </h1>
              <p className="text-xs sm:text-sm mt-0.5 hidden sm:block theme-text-tertiary">
                Define shift times to assign to employees
              </p>
            </div>
            <Button
              variant="primary"
              onClick={() => {
                resetForm();
                setShowModal(true);
              }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">New Schedule</span>
              <span className="sm:hidden">New</span>
            </Button>
          </div>
        </header>

        <div className="p-4 sm:p-8 space-y-4 sm:space-y-6">
          {/* Error banner */}
          {error && (
            <Card tone="red" padding="sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm theme-text-primary">{error}</p>
                <Button variant="ghost" size="sm" onClick={() => setError("")}>Dismiss</Button>
              </div>
            </Card>
          )}

          {/* Info callout */}
          <Card tone="default" padding="sm" className="ui-callout-blue rounded-2xl">
            <p className="text-sm theme-text-primary">
              Create work schedules here, then assign them to employees on their profile page or when hiring.
            </p>
          </Card>

          {/* Schedules List */}
          {!templates || templates.length === 0 ? (
            <Card>
              <div className="py-8 text-center">
                <div className="text-4xl mb-3">🕐</div>
                <p className="theme-text-secondary font-medium">No work schedules yet.</p>
                <p className="text-sm mt-2 theme-text-tertiary">Create schedules like &quot;Day Shift&quot; or &quot;Executive Hours&quot;</p>
              </div>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((template) => (
                <Card key={template._id}>
                  <SectionHeader
                    actions={
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleEdit(template)}
                          className="p-2 rounded-lg theme-text-tertiary hover:theme-text-primary hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                          title="Edit"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(template._id)}
                          className="p-2 rounded-lg theme-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors"
                          title="Delete"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    }
                  />
                  <h3 className="text-[17px] font-semibold theme-text-primary leading-tight">
                    {template.name}
                  </h3>
                  <p className="text-lg font-medium mt-1 theme-accent-primary">
                    {getScheduleTimes(template)}
                  </p>
                  {template.description && (
                    <p className="text-sm mt-2 theme-text-tertiary">
                      {template.description}
                    </p>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Create/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="w-full max-w-md rounded-2xl border bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700">
              <div className="flex items-center justify-between px-5 py-4 border-b theme-border-secondary">
                <h2 className="text-[17px] font-semibold theme-text-primary">
                  {editingId ? "Edit Schedule" : "New Schedule"}
                </h2>
                <button
                  onClick={() => {
                    setShowModal(false);
                    resetForm();
                  }}
                  className="p-2 rounded-lg theme-text-tertiary hover:theme-text-primary hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="px-5 py-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5 theme-text-tertiary">
                    Schedule Name *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Day Shift, Executive Hours"
                    className="theme-input w-full px-3 py-2.5 text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1.5 theme-text-tertiary">
                      Start Time
                    </label>
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="theme-input w-full px-3 py-2.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5 theme-text-tertiary">
                      End Time
                    </label>
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="theme-input w-full px-3 py-2.5 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1.5 theme-text-tertiary">
                    Description (optional)
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g., Standard warehouse hours"
                    className="theme-input w-full px-3 py-2.5 text-sm"
                  />
                </div>
              </div>

              <div className="flex gap-3 px-5 py-4 border-t theme-border-secondary">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setShowModal(false);
                    resetForm();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleSave}
                  disabled={!name.trim()}
                >
                  {editingId ? "Save" : "Create"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function ScheduleTemplatesPage() {
  return (
    <Protected>
      <ScheduleTemplatesContent />
    </Protected>
  );
}
