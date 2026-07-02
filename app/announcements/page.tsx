"use client";

import { useState } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "../auth-context";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

const PRIORITY_OPTIONS = [
  { value: "normal", label: "Normal", color: "slate" },
  { value: "urgent", label: "Urgent", color: "red" },
];

const TARGET_OPTIONS = [
  { value: "all", label: "All Employees" },
  { value: "department", label: "Specific Departments" },
  { value: "location", label: "Specific Locations" },
];

function AnnouncementsContent() {
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
      <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold theme-text-primary">
              Access Denied
            </h1>
            <p className="mt-2 theme-text-secondary">
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
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Header */}
        <header className="sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">
                Announcements
              </h1>
              <p className="text-xs sm:text-sm mt-1 hidden sm:block theme-text-tertiary">
                Create and manage employee announcements
              </p>
            </div>
            <Button
              variant="primary"
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
            >
              <span className="hidden sm:inline">New Announcement</span>
              <span className="sm:hidden">New</span>
            </Button>
          </div>
        </header>

        <div className="p-4 sm:p-8 space-y-4 sm:space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 sm:gap-4">
            <Card padding="sm" className="text-center">
              <p className="text-lg sm:text-2xl font-bold text-green-500">{activeCount}</p>
              <p className="text-[10px] sm:text-xs theme-text-tertiary mt-0.5">Active</p>
            </Card>
            <Card padding="sm" className="text-center">
              <p className="text-lg sm:text-2xl font-bold theme-text-primary">{announcements.length}</p>
              <p className="text-[10px] sm:text-xs theme-text-tertiary mt-0.5">Total</p>
            </Card>
          </div>

          {/* Filters */}
          <Card padding="sm">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search announcements..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer theme-text-secondary">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">Show inactive</span>
              </label>
            </div>
          </Card>

          {/* Announcements List */}
          <Card padding="sm" className="overflow-hidden p-0">
            {filteredAnnouncements.length === 0 ? (
              <div className="p-8 text-center">
                <svg
                  className="w-12 h-12 mx-auto mb-3 theme-text-tertiary opacity-40"
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
                <p className="theme-text-tertiary">
                  No announcements found
                </p>
              </div>
            ) : (
              <div className="divide-y theme-border-secondary">
                {filteredAnnouncements.map((announcement) => (
                  <div
                    key={announcement._id}
                    className={`p-4 transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/30 ${
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
                          <h3 className="font-medium theme-text-primary">
                            {announcement.title}
                          </h3>
                          {/* Priority badge — data-driven color kept */}
                          <span className={`ui-badge ${announcement.priority === "urgent" ? "ui-badge-red" : "ui-badge-gray"}`}>
                            {PRIORITY_OPTIONS.find((p) => p.value === announcement.priority)?.label}
                          </span>
                          {!announcement.isActive && (
                            <span className="ui-badge ui-badge-gray">Inactive</span>
                          )}
                          {isExpired(announcement) && (
                            <span className="ui-badge ui-badge-amber">Expired</span>
                          )}
                        </div>
                        <p className="mt-2 text-sm theme-text-secondary line-clamp-2">
                          {announcement.content}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs theme-text-tertiary">
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
                        <Button
                          variant={announcement.isActive ? "secondary" : "ghost"}
                          size="sm"
                          onClick={() => handleToggleActive(announcement)}
                          disabled={isProcessing}
                        >
                          {announcement.isActive ? "Deactivate" : "Activate"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(announcement)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDelete(announcement._id)}
                          disabled={isProcessing}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </main>

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-y-auto">
          <div className="w-full max-w-lg theme-card p-6 my-8">
            <h2 className="text-lg font-bold mb-4 theme-text-primary">
              {editingId ? "Edit Announcement" : "New Announcement"}
            </h2>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium mb-2 theme-text-secondary">
                  Title
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="theme-input w-full px-3 py-2 text-sm"
                  placeholder="Announcement title..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 theme-text-secondary">
                  Content
                </label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  rows={4}
                  className="theme-input w-full px-3 py-2 text-sm"
                  placeholder="Announcement content..."
                />
                <div className="flex justify-between mt-1">
                  <span className={`text-xs ${form.content.length > 5000 ? "text-red-500" : "theme-text-tertiary"}`}>
                    {form.content.length} / 5,000
                  </span>
                </div>
                {formError && (
                  <p className="text-xs text-red-500 mt-1">{formError}</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2 theme-text-secondary">
                    Priority
                  </label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                    className="theme-input w-full px-3 py-2 text-sm"
                  >
                    {PRIORITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 theme-text-secondary">
                    Target Audience
                  </label>
                  <select
                    value={form.targetType}
                    onChange={(e) => setForm({ ...form, targetType: e.target.value, targetDepartments: [], targetLocationIds: [] })}
                    className="theme-input w-full px-3 py-2 text-sm"
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
                  <label className="block text-sm font-medium mb-2 theme-text-secondary">
                    Select Departments
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {departments.map((dept) => (
                      <label
                        key={dept}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer text-sm border transition-colors ${
                          form.targetDepartments.includes(dept)
                            ? "bg-[#007AFF]/10 text-[#007AFF] border-[#007AFF]/30"
                            : "theme-card border-transparent theme-text-secondary hover:bg-gray-100 dark:hover:bg-slate-700"
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
                  <label className="block text-sm font-medium mb-2 theme-text-secondary">
                    Select Locations
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {locations.map((loc) => (
                      <label
                        key={loc._id}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer text-sm border transition-colors ${
                          form.targetLocationIds.includes(loc._id)
                            ? "bg-[#007AFF]/10 text-[#007AFF] border-[#007AFF]/30"
                            : "theme-card border-transparent theme-text-secondary hover:bg-gray-100 dark:hover:bg-slate-700"
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
                <label className="block text-sm font-medium mb-2 theme-text-secondary">
                  Expires At (optional)
                </label>
                <input
                  type="datetime-local"
                  value={form.expiresAt}
                  onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                  className="theme-input w-full px-3 py-2 text-sm"
                />
              </div>

              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-2 cursor-pointer theme-text-secondary">
                  <input
                    type="checkbox"
                    checked={form.isPinned}
                    onChange={(e) => setForm({ ...form, isPinned: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm">Pin to top</span>
                </label>

                {!editingId && (
                  <label className="flex items-center gap-2 cursor-pointer theme-text-secondary">
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
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={handleSubmit}
                disabled={isProcessing || !form.title || !form.content}
              >
                {editingId ? "Save Changes" : "Create Announcement"}
              </Button>
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
