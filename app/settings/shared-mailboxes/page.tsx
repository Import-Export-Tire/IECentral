"use client";

import { useState } from "react";
import Protected from "../../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "../../auth-context";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

interface SharedMailbox {
  _id: Id<"sharedMailboxes">;
  accountId: Id<"emailAccounts">;
  name: string;
  description?: string;
  ownerUserId: Id<"users">;
  memberUserIds: Id<"users">[];
  permissions: {
    canRead: boolean;
    canSend: boolean;
    canDelete: boolean;
    canManageMembers: boolean;
  };
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_PERMISSIONS = {
  canRead: true,
  canSend: false,
  canDelete: false,
  canManageMembers: false,
};

function SharedMailboxesContent() {
  const { user } = useAuth();

  const mailboxes = useQuery(api.email.sharedMailboxes.listAll);
  const emailAccounts = useQuery(
    api.email.accounts.listByUser,
    user?._id ? { userId: user._id } : "skip"
  );
  const allUsers = useQuery(api.auth.getAllUsers);

  const createMailbox = useMutation(api.email.sharedMailboxes.create);
  const updateMailbox = useMutation(api.email.sharedMailboxes.update);
  const addMember = useMutation(api.email.sharedMailboxes.addMember);
  const removeMember = useMutation(api.email.sharedMailboxes.removeMember);
  const removeMailbox = useMutation(api.email.sharedMailboxes.remove);

  const [showModal, setShowModal] = useState(false);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [selectedMailboxId, setSelectedMailboxId] = useState<Id<"sharedMailboxes"> | null>(null);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [form, setForm] = useState({
    accountId: "",
    name: "",
    description: "",
    permissions: DEFAULT_PERMISSIONS,
  });

  const [memberForm, setMemberForm] = useState({
    userId: "",
  });

  const openCreate = () => {
    setForm({
      accountId: "",
      name: "",
      description: "",
      permissions: DEFAULT_PERMISSIONS,
    });
    setError("");
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?._id || !form.accountId || !form.name) {
      setError("Please fill in all required fields");
      return;
    }

    setError("");
    setIsSaving(true);

    try {
      await createMailbox({
        accountId: form.accountId as Id<"emailAccounts">,
        name: form.name,
        description: form.description || undefined,
        createdBy: user._id,
        permissions: form.permissions,
      });
      setShowModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create shared mailbox");
    } finally {
      setIsSaving(false);
    }
  };

  const openAddMember = (mailboxId: Id<"sharedMailboxes">) => {
    setSelectedMailboxId(mailboxId);
    setMemberForm({ userId: "" });
    setError("");
    setShowMemberModal(true);
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?._id || !selectedMailboxId || !memberForm.userId) {
      setError("Please select a user");
      return;
    }

    setError("");
    setIsSaving(true);

    try {
      await addMember({
        sharedMailboxId: selectedMailboxId,
        newUserId: memberForm.userId as Id<"users">,
        addedBy: user._id,
      });
      setShowMemberModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveMember = async (mailboxId: Id<"sharedMailboxes">, userIdToRemove: Id<"users">) => {
    if (!user?._id) return;
    if (!confirm("Remove this member from the shared mailbox?")) return;

    try {
      await removeMember({
        sharedMailboxId: mailboxId,
        userIdToRemove,
        removedBy: user._id,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  const handleToggleActive = async (mailbox: SharedMailbox) => {
    if (!user?._id) return;

    try {
      await updateMailbox({
        sharedMailboxId: mailbox._id,
        userId: user._id,
        isActive: !mailbox.isActive,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update mailbox");
    }
  };

  const handleDelete = async (mailboxId: Id<"sharedMailboxes">) => {
    if (!user?._id) return;
    if (!confirm("Are you sure you want to delete this shared mailbox?")) return;

    try {
      await removeMailbox({
        sharedMailboxId: mailboxId,
        userId: user._id,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete mailbox");
    }
  };

  const getUserName = (userId: Id<"users">) => {
    const u = allUsers?.find((u) => u._id === userId);
    return u?.name || u?.email || "Unknown";
  };

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
                <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">Shared Mailboxes</h1>
                <p className="text-xs sm:text-sm mt-0.5 theme-text-tertiary">
                  Manage shared email accounts accessible by multiple users.
                </p>
              </div>
            </div>
            <Button variant="primary" size="sm" onClick={openCreate}>
              + Create Shared Mailbox
            </Button>
          </div>
        </header>

        <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-4 max-w-4xl">
          {!mailboxes ? (
            <Card padding="md">
              <div className="py-8 text-center">
                <svg className="w-8 h-8 mx-auto mb-2 animate-spin theme-text-tertiary" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="theme-text-secondary">Loading shared mailboxes...</p>
              </div>
            </Card>
          ) : mailboxes.length === 0 ? (
            <Card padding="md">
              <div className="py-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center bg-[#f2f2f7] dark:bg-slate-900/60">
                  <svg className="w-8 h-8 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold theme-text-primary mb-2">No Shared Mailboxes</h3>
                <p className="theme-text-secondary mb-4">
                  Create a shared mailbox to allow multiple users to access the same email account.
                </p>
                <Button variant="primary" size="sm" onClick={openCreate}>
                  Create Shared Mailbox
                </Button>
              </div>
            </Card>
          ) : (
            mailboxes.map(({ mailbox, account, owner, memberCount }) => (
              <Card key={mailbox._id} padding="md" className="overflow-hidden !p-0">
                {/* Mailbox Header */}
                <div className="px-5 py-4 border-b theme-border-secondary">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-blue-500/10">
                        <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold theme-text-primary">{mailbox.name}</h3>
                          <span className={`ui-badge ${mailbox.isActive ? "ui-badge-green" : "ui-badge-gray"}`}>
                            {mailbox.isActive ? "Active" : "Inactive"}
                          </span>
                        </div>
                        <p className="text-sm theme-text-secondary flex items-center gap-1 mt-0.5">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          {account?.emailAddress || "Unknown account"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleToggleActive(mailbox)}
                      >
                        {mailbox.isActive ? "Deactivate" : "Activate"}
                      </Button>
                      <button
                        onClick={() => handleDelete(mailbox._id)}
                        className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                        title="Delete"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {mailbox.description && (
                    <p className="mt-2 text-sm theme-text-tertiary">{mailbox.description}</p>
                  )}
                </div>

                {/* Members Section */}
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-medium theme-text-primary flex items-center gap-2 text-sm">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                      Members ({memberCount + 1})
                    </h4>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openAddMember(mailbox._id)}
                    >
                      + Add
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {/* Owner */}
                    <div className="flex items-center justify-between p-3 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/60">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center bg-amber-500/20 text-amber-500">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div>
                          <p className="font-medium theme-text-primary text-sm">{owner?.userName || "Unknown"}</p>
                          <p className="text-xs theme-text-tertiary">Owner</p>
                        </div>
                      </div>
                      <span className="ui-badge ui-badge-amber">Full Access</span>
                    </div>

                    {/* Members */}
                    {mailbox.memberUserIds.map((memberId) => (
                      <div
                        key={memberId}
                        className="flex items-center justify-between p-3 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/60"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center bg-[color-mix(in_srgb,var(--accent-primary)_10%,transparent)]">
                            <svg className="w-4 h-4 theme-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                          </div>
                          <div>
                            <p className="font-medium theme-text-primary text-sm">{getUserName(memberId)}</p>
                            <p className="text-xs theme-text-tertiary">Member</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="ui-badge ui-badge-blue">
                            {mailbox.permissions.canSend ? "Read/Write" : "Read Only"}
                          </span>
                          <button
                            onClick={() => handleRemoveMember(mailbox._id, memberId)}
                            className="p-1 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                            title="Remove member"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}

                    {mailbox.memberUserIds.length === 0 && (
                      <p className="text-sm theme-text-tertiary text-center py-2">
                        No members added yet
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>

        {/* Create Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="theme-card w-full max-w-lg">
              <div className="px-5 py-4 border-b theme-border-secondary flex items-center justify-between">
                <h2 className="text-lg font-semibold theme-text-primary">Create Shared Mailbox</h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-2 rounded-lg theme-text-secondary hover:theme-text-primary hover:bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)] transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                {error && (
                  <div className="p-3 bg-red-500/10 text-red-500 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                <div>
                  <label className="block ui-section-label mb-1.5">Email Account *</label>
                  <select
                    value={form.accountId}
                    onChange={(e) => setForm({ ...form, accountId: e.target.value })}
                    required
                    className="theme-input w-full px-3 py-2 text-sm"
                  >
                    <option value="">Select an email account</option>
                    {emailAccounts?.map((account) => (
                      <option key={account._id} value={account._id}>
                        {account.emailAddress}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block ui-section-label mb-1.5">Mailbox Name *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g., Support Team"
                    required
                    className="theme-input w-full px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block ui-section-label mb-1.5">Description</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Optional description"
                    rows={2}
                    className="theme-input w-full px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block ui-section-label mb-2">Default Member Permissions</label>
                  <div className="space-y-2">
                    {[
                      { key: "canRead", label: "Can Read Emails" },
                      { key: "canSend", label: "Can Send Emails" },
                      { key: "canDelete", label: "Can Delete Emails" },
                      { key: "canManageMembers", label: "Can Manage Members" },
                    ].map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.permissions[key as keyof typeof form.permissions]}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              permissions: { ...form.permissions, [key]: e.target.checked },
                            })
                          }
                          className="rounded border-gray-300"
                        />
                        <span className="text-sm theme-text-secondary">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 pt-2 border-t theme-border-secondary">
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1"
                    onClick={() => setShowModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    className="flex-1"
                    disabled={isSaving}
                  >
                    {isSaving ? "Creating..." : "Create"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Add Member Modal */}
        {showMemberModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="theme-card w-full max-w-md">
              <div className="px-5 py-4 border-b theme-border-secondary flex items-center justify-between">
                <h2 className="text-lg font-semibold theme-text-primary">Add Member</h2>
                <button
                  onClick={() => setShowMemberModal(false)}
                  className="p-2 rounded-lg theme-text-secondary hover:theme-text-primary hover:bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)] transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleAddMember} className="p-5 space-y-4">
                {error && (
                  <div className="p-3 bg-red-500/10 text-red-500 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                <div>
                  <label className="block ui-section-label mb-1.5">Select User *</label>
                  <select
                    value={memberForm.userId}
                    onChange={(e) => setMemberForm({ ...memberForm, userId: e.target.value })}
                    required
                    className="theme-input w-full px-3 py-2 text-sm"
                  >
                    <option value="">Select a user</option>
                    {allUsers?.map((u) => (
                      <option key={u._id} value={u._id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-3 pt-2 border-t theme-border-secondary">
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1"
                    onClick={() => setShowMemberModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    className="flex-1"
                    disabled={isSaving}
                  >
                    {isSaving ? "Adding..." : "Add Member"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function SharedMailboxesPage() {
  return (
    <Protected requiredRoles={["super_admin", "admin"]}>
      <SharedMailboxesContent />
    </Protected>
  );
}
