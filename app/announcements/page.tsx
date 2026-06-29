"use client";

import { useState } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";

const PRIORITY_OPTIONS = [
  { value: "normal", label: "Normal", color: "slate" },
  { value: "urgent", label: "Urgent", color: "red" },
];

const TARGET_OPTIONS = [
  { value: "all", label: "All Employees" },
  { value: "department", label: "Specific Departments" },
  { value: "location", label: "Specific Locations" },
];

const priorityColors: Record<string, string> = {
  normal: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  urgent: "bg-red-500/20 text-red-400 border-red-500/30",
};

function AnnouncementsContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user, canManageAnnouncements } = useAuth();

  const announcements = useQuery(api.announcements.getAll, { includeInactive: true }) || [];
  const departments = useQuery(api.personnel.getDepartments) || [];
  const locations = useQuery(api.locations.list, {}) || [];

  const createMutation = useMutation(api.announcements.create);
  const updateMutation = useMutation(api.announcements.update);
  const removeMutation = useMutation(api.announcements.remove);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<Id<"announcements"> | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const [form, setForm] = useState({
    title: "",
    content: "",
    priority: "normal",
    targetType: "all",
    targetDepartments: [] as string[],
    targetLocationIds: [] as Id<"locations">[],
    expiresAt: "",
    isPinned: false,
    sendPush: false,
  });

  // Redirect if user doesn't have permission
  if (!canManageAnnouncements) {
    return (
      <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h1 className={`text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
              Access Denied
            </h1>
            <p className={`mt-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              You don&apos;t have permission to view this page.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const filteredAnnouncements = announcements.filter((announcement) => {
    const matchesSearch =
      searchTerm === "" ||
      announcement.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      announcement.content.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesActive = showInactive || announcement.isActive;
    return matchesSearch && matchesActive;
  });

  const activeCount = announcements.filter((a) => a.isActive).length;

  const resetForm = () => {
    setForm({
      title: "",
      content: "",
      priority: "normal",
      targetType: "all",
      targetDepartments: [],
      targetLocationIds: [],
      expiresAt: "",
      isPinned: false,
      sendPush: false,
    });
    setEditingId(null);
  };

  const handleEdit = (announcement: typeof announcements[0]) => {
    setForm({
      title: announcement.title,
      content: announcement.content,
      priority: announcement.priority,
      targetType: announcement.targetType,
      targetDepartments: announcement.targetDepartments || [],
      targetLocationIds: (announcement.targetLocationIds as Id<"locations">[]) || [],
      expiresAt: announcement.expiresAt
        ? new Date(announcement.expiresAt).toISOString().slice(0, 16)
        : "",
      isPinned: announcement.isPinned,
      sendPush: false,
    });
    setEditingId(announcement._id);
    setShowForm(true);
  };

  const [formError, setFormError] = useState("");

  const handleSubmit = async () => {
    if (!user || !form.title || !form.content) return;

    if (form.content.length > 5000) {
      setFormError("Announcement content must be 5,000 characters or fewer.");
      return;
    }
    setFormError("");
    setIsProcessing(true);

    try {
      if (editingId) {
        await updateMutation({
          announcementId: editingId,
          title: form.title,
          content: form.content,
          priority: form.priority,
          targetType: form.targetType,
          targetDepartments: form.targetType === "department" ? form.targetDepartments : undefined,
          targetLocationIds: form.targetType === "location" ? form.targetLocationIds : undefined,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).getTime() : undefined,
          isPinned: form.isPinned,
          requestingUserId: user._id,
        });
      } else {
        await createMutation({
          title: form.title,
          content: form.content,
          priority: form.priority,
          targetType: form.targetType,
          targetDepartments: form.targetType === "department" ? form.targetDepartments : undefined,
          targetLocationIds: form.targetType === "location" ? form.targetLocationIds : undefined,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).getTime() : undefined,
          isPinned: form.isPinned,
          sendPush: form.sendPush,
          createdBy: user._id,
        });
      }
      setShowForm(false);
      resetForm();
    } catch (error) {
      console.error("Failed to save announcement:", error);
    }
    setIsProcessing(false);
  };

  const handleToggleActive = async (announcement: typeof announcements[0]) => {
    if (!user) return;
    setIsProcessing(true);
    try {
      await updateMutation({
        announcementId: announcement._id,
        isActive: !announcement.isActive,
        requestingUserId: user._id,
      });
    } catch (error) {
      console.error("Failed to toggle announcement:", error);
    }
    setIsProcessing(false);
  };

  const handleDelete = async (announcementId: Id<"announcements">) => {
    if (!confirm("Are you sure you want to delete this announcement?")) return;
    if (!user) return;
    setIsProcessing(true);
    try {
      await removeMutation({ announcementId, requestingUserId: user._id });
    } catch (error) {
      console.error("Failed to delete announcement:", error);
    }
    setIsProcessing(false);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const isExpired = (announcement: typeof announcements[0]) => {
    return announcement.expiresAt && announcement.expiresAt < Date.now();
  };

  return (
    <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Header */}
        <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className={`text-xl sm:text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                Announcements
              </h1>
              <p className={`text-xs sm:text-sm mt-1 hidden sm:block ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Create and manage employee announcements
              </p>
            </div>
            <button
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
              className={`px-3 sm:px-4 py-2 rounded-lg font-medium transition-colors flex-shrink-0 ${
                isDark
                  ? "bg-cyan-500 hover:bg-cyan-400 text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }`}
            >
              <span className="hidden sm:inline">New Announcement</span>
              <span className="sm:hidden">New</span>
            </button>
          </div>
        </header>

        <div className="p-4 sm:p-8 space-y-4 sm:space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 sm:gap-4">
            <div className={`rounded-lg p-2 sm:p-4 text-center ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
              <p className={`text-lg sm:text-2xl font-bold text-green-400`}>{activeCount}</p>
              <p className={`text-[10px] sm:text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>Active</p>
            </div>
            <div className={`rounded-lg p-2 sm:p-4 text-center ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
              <p className={`text-lg sm:text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{announcements.length}</p>
              <p className={`text-[10px] sm:text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>Total</p>
            </div>
          </div>

          {/* Filters */}
          <div className={`rounded-lg p-3 sm:p-4 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search announcements..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${
                    isDark
                      ? "bg-slate-700 border-slate-600 text-white placeholder-slate-400"
                      : "bg-white border-gray-300 text-gray-900 placeholder-gray-500"
                  }`}
                />
              </div>
              <label className={`flex items-center gap-2 cursor-pointer ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">Show inactive</span>
              </label>
            </div>
          </div>

          {/* Announcements List */}
          <div className={`rounded-lg overflow-hidden ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
            {filteredAnnouncements.length === 0 ? (
              <div className="p-8 text-center">
                <svg
                  className={`w-12 h-12 mx-auto mb-3 ${isDark ? "text-slate-600" : "text-gray-300"}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
                  />
                </svg>
                <p className={isDark ? "text-slate-400" : "text-gray-500"}>
                  No announcements found
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-700">
                {filteredAnnouncements.map((announcement) => (
                  <div
                    key={announcement._id}
                    className={`p-4 ${isDark ? "hover:bg-slate-700/50" : "hover:bg-gray-50"} transition-colors ${
                      !announcement.isActive ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {announcement.isPinned && (
                            <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.381z" />
                            </svg>
                          )}
                          <h3 className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                            {announcement.title}
                          </h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${priorityColors[announcement.priority]}`}>
                            {PRIORITY_OPTIONS.find((p) => p.value === announcement.priority)?.label}
                          </span>
                          {!announcement.isActive && (
                            <span className="text-xs px-2 py-0.5 rounded-full border bg-gray-500/20 text-gray-400 border-gray-500/30">
                              Inactive
                            </span>
                          )}
                          {isExpired(announcement) && (
                            <span className="text-xs px-2 py-0.5 rounded-full border bg-orange-500/20 text-orange-400 border-orange-500/30">
                              Expired
                            </span>
                          )}
                        </div>
                        <p className={`mt-2 text-sm ${isDark ? "text-slate-300" : "text-gray-700"} line-clamp-2`}>
                          {announcement.content}
                        </p>
                        <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                          <span>
                            Target: {announcement.targetType === "all" ? "All Employees" :
                              announcement.targetType === "department" ? `${announcement.targetDepartments?.length || 0} departments` :
                              `${announcement.targetLocationIds?.length || 0} locations`}
                          </span>
                          <span>&bull;</span>
                          <span>{announcement.readCount || 0} reads</span>
                          <span>&bull;</span>
                          <span>Created {formatDate(announcement.createdAt)}</span>
                          {announcement.expiresAt && (
                            <>
                              <span>&bull;</span>
                              <span>Expires {formatDate(announcement.expiresAt)}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => handleToggleActive(announcement)}
                          disabled={isProcessing}
                          className={`px-2 py-1.5 rounded-lg text-xs font-medium ${
                            announcement.isActive
                              ? isDark
                                ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                                : "bg-amber-100 text-amber-600 hover:bg-amber-200"
                              : isDark
                                ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                                : "bg-green-100 text-green-600 hover:bg-green-200"
                          }`}
                        >
                          {announcement.isActive ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          onClick={() => handleEdit(announcement)}
                          className={`px-2 py-1.5 rounded-lg text-xs font-medium ${
                            isDark
                              ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30"
                              : "bg-blue-100 text-blue-600 hover:bg-blue-200"
                          }`}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(announcement._id)}
                          disabled={isProcessing}
                          className={`px-2 py-1.5 rounded-lg text-xs font-medium ${
                            isDark
                              ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                              : "bg-red-100 text-red-600 hover:bg-red-200"
                          }`}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-y-auto">
          <div className={`w-full max-w-lg rounded-xl p-6 my-8 ${isDark ? "bg-slate-800" : "bg-white"}`}>
            <h2 className={`text-lg font-bold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
              {editingId ? "Edit Announcement" : "New Announcement"}
            </h2>

            <div className="space-y-4 mb-6">
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  Title
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${
                    isDark
                      ? "bg-slate-700 border-slate-600 text-white placeholder-slate-400"
                      : "bg-white border-gray-300 text-gray-900 placeholder-gray-500"
                  }`}
                  placeholder="Announcement title..."
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  Content
                </label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  rows={4}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${
                    isDark
                      ? "bg-slate-700 border-slate-600 text-white placeholder-slate-400"
                      : "bg-white border-gray-300 text-gray-900 placeholder-gray-500"
                  }`}
                  placeholder="Announcement content..."
                />
                <div className="flex justify-between mt-1">
                  <span className={`text-xs ${form.content.length > 5000 ? "text-red-400" : isDark ? "text-slate-500" : "text-gray-400"}`}>
                    {form.content.length} / 5,000
                  </span>
                </div>
                {formError && (
                  <p className="text-xs text-red-400 mt-1">{formError}</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Priority
                  </label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg border text-sm ${
                      isDark
                        ? "bg-slate-700 border-slate-600 text-white"
                        : "bg-white border-gray-300 text-gray-900"
                    }`}
                  >
                    {PRIORITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Target Audience
                  </label>
                  <select
                    value={form.targetType}
                    onChange={(e) => setForm({ ...form, targetType: e.target.value, targetDepartments: [], targetLocationIds: [] })}
                    className={`w-full px-3 py-2 rounded-lg border text-sm ${
                      isDark
                        ? "bg-slate-700 border-slate-600 text-white"
                        : "bg-white border-gray-300 text-gray-900"
                    }`}
                  >
                    {TARGET_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {form.targetType === "department" && (
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Select Departments
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {departments.map((dept) => (
                      <label
                        key={dept}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer text-sm ${
                          form.targetDepartments.includes(dept)
                            ? isDark
                              ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                              : "bg-blue-100 text-blue-600 border border-blue-200"
                            : isDark
                              ? "bg-slate-700 text-slate-300 border border-slate-600"
                              : "bg-gray-100 text-gray-700 border border-gray-200"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={form.targetDepartments.includes(dept)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setForm({ ...form, targetDepartments: [...form.targetDepartments, dept] });
                            } else {
                              setForm({ ...form, targetDepartments: form.targetDepartments.filter((d) => d !== dept) });
                            }
                          }}
                          className="sr-only"
                        />
                        {dept}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {form.targetType === "location" && (
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Select Locations
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {locations.map((loc) => (
                      <label
                        key={loc._id}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer text-sm ${
                          form.targetLocationIds.includes(loc._id)
                            ? isDark
                              ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                              : "bg-blue-100 text-blue-600 border border-blue-200"
                            : isDark
                              ? "bg-slate-700 text-slate-300 border border-slate-600"
                              : "bg-gray-100 text-gray-700 border border-gray-200"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={form.targetLocationIds.includes(loc._id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setForm({ ...form, targetLocationIds: [...form.targetLocationIds, loc._id] });
                            } else {
                              setForm({ ...form, targetLocationIds: form.targetLocationIds.filter((id) => id !== loc._id) });
                            }
                          }}
                          className="sr-only"
                        />
                        {loc.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  Expires At (optional)
                </label>
                <input
                  type="datetime-local"
                  value={form.expiresAt}
                  onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${
                    isDark
                      ? "bg-slate-700 border-slate-600 text-white"
                      : "bg-white border-gray-300 text-gray-900"
                  }`}
                />
              </div>

              <div className="flex flex-col gap-3">
                <label className={`flex items-center gap-2 cursor-pointer ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  <input
                    type="checkbox"
                    checked={form.isPinned}
                    onChange={(e) => setForm({ ...form, isPinned: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm">Pin to top</span>
                </label>

                {!editingId && (
                  <label className={`flex items-center gap-2 cursor-pointer ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    <input
                      type="checkbox"
                      checked={form.sendPush}
                      onChange={(e) => setForm({ ...form, sendPush: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm">Send push notification</span>
                  </label>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                  isDark
                    ? "bg-slate-700 hover:bg-slate-600 text-slate-300"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isProcessing || !form.title || !form.content}
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                  isDark
                    ? "bg-cyan-500 hover:bg-cyan-400 text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white"
                } disabled:opacity-50`}
              >
                {editingId ? "Save Changes" : "Create Announcement"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AnnouncementsPage() {
  return (
    <Protected>
      <AnnouncementsContent />
    </Protected>
  );
}
