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
import SectionHeader from "@/components/ui/SectionHeader";

interface DomainConfig {
  _id: Id<"emailDomainConfigs">;
  domain: string;
  name: string;
  description?: string;
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpTls: boolean;
  useEmailAsUsername: boolean;
  sortOrder?: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_FORM = {
  domain: "",
  name: "",
  description: "",
  imapHost: "",
  imapPort: 993,
  imapTls: true,
  smtpHost: "",
  smtpPort: 587,
  smtpTls: true,
  useEmailAsUsername: true,
  sortOrder: 0,
};

function EmailDomainSettingsContent() {
  const { user } = useAuth();

  const configs = useQuery(
    api.email.domainConfigs.listAll,
    user?._id ? { userId: user._id } : "skip"
  ) as DomainConfig[] | undefined;

  const createConfig = useMutation(api.email.domainConfigs.create);
  const updateConfig = useMutation(api.email.domainConfigs.update);
  const removeConfig = useMutation(api.email.domainConfigs.remove);
  const toggleActive = useMutation(api.email.domainConfigs.toggleActive);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<Id<"emailDomainConfigs"> | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const openCreate = () => {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setError("");
    setShowModal(true);
  };

  const openEdit = (config: DomainConfig) => {
    setEditingId(config._id);
    setForm({
      domain: config.domain,
      name: config.name,
      description: config.description || "",
      imapHost: config.imapHost,
      imapPort: config.imapPort,
      imapTls: config.imapTls,
      smtpHost: config.smtpHost,
      smtpPort: config.smtpPort,
      smtpTls: config.smtpTls,
      useEmailAsUsername: config.useEmailAsUsername,
      sortOrder: config.sortOrder || 0,
    });
    setError("");
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?._id) return;

    setError("");
    setIsSaving(true);

    try {
      if (editingId) {
        await updateConfig({
          userId: user._id,
          configId: editingId,
          ...form,
        });
      } else {
        await createConfig({
          userId: user._id,
          ...form,
        });
      }
      setShowModal(false);
      setForm(DEFAULT_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save configuration");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (configId: Id<"emailDomainConfigs">) => {
    if (!user?._id) return;
    if (!confirm("Are you sure you want to delete this domain configuration?")) return;

    try {
      await removeConfig({ userId: user._id, configId });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete configuration");
    }
  };

  const handleToggleActive = async (configId: Id<"emailDomainConfigs">) => {
    if (!user?._id) return;
    try {
      await toggleActive({ userId: user._id, configId });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update configuration");
    }
  };

  // Export configurations as JSON
  const handleExport = () => {
    if (!configs || configs.length === 0) {
      alert("No configurations to export");
      return;
    }

    // Strip internal fields for export
    const exportData = configs.map(({ _id, createdAt, updatedAt, ...rest }) => rest);

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `email-domain-configs-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Import configurations from JSON file
  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user?._id) return;

    setIsImporting(true);
    try {
      const text = await file.text();
      const importedConfigs = JSON.parse(text);

      if (!Array.isArray(importedConfigs)) {
        throw new Error("Invalid format: expected an array of configurations");
      }

      let imported = 0;
      let skipped = 0;

      for (const config of importedConfigs) {
        // Validate required fields
        if (!config.domain || !config.name || !config.imapHost || !config.smtpHost) {
          skipped++;
          continue;
        }

        // Check if domain already exists
        const existingDomain = configs?.find((c) => c.domain === config.domain);
        if (existingDomain) {
          skipped++;
          continue;
        }

        await createConfig({
          userId: user._id,
          domain: config.domain,
          name: config.name,
          description: config.description || "",
          imapHost: config.imapHost,
          imapPort: config.imapPort || 993,
          imapTls: config.imapTls !== false,
          smtpHost: config.smtpHost,
          smtpPort: config.smtpPort || 587,
          smtpTls: config.smtpTls !== false,
          useEmailAsUsername: config.useEmailAsUsername !== false,
          sortOrder: config.sortOrder || 0,
        });
        imported++;
      }

      alert(`Import complete: ${imported} imported, ${skipped} skipped (duplicates or invalid)`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to import configurations");
    } finally {
      setIsImporting(false);
      // Reset the file input
      event.target.value = "";
    }
  };

  return (
    <div className="flex h-screen theme-bg">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <MobileHeader />

        {/* Sticky iOS-style page header */}
        <header className="sticky top-0 z-10 backdrop-blur-sm border-b theme-border-secondary px-4 sm:px-8 py-3 sm:py-4 bg-[var(--surface-primary)]/80">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link
                href="/settings"
                className="p-2 rounded-lg theme-text-secondary hover:theme-text-primary transition-colors hover:bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)]"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">Email Domain Configurations</h1>
                <p className="text-xs sm:text-sm mt-0.5 theme-text-tertiary">
                  Configure default IMAP/SMTP settings for email domains
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Export Button */}
              <Button
                variant="secondary"
                size="sm"
                onClick={handleExport}
                disabled={!configs || configs.length === 0}
                title="Export configurations as JSON"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Export
              </Button>

              {/* Import Button */}
              <label
                className={`inline-flex items-center justify-center gap-1.5 rounded-[9px] font-semibold transition-colors px-3.5 py-2 text-[13.5px] cursor-pointer ${
                  isImporting
                    ? "opacity-50 cursor-not-allowed theme-btn-secondary"
                    : "theme-btn-secondary"
                }`}
                title="Import configurations from JSON"
              >
                {isImporting ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                )}
                {isImporting ? "Importing..." : "Import"}
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImport}
                  disabled={isImporting}
                  className="hidden"
                />
              </label>

              {/* Add Domain Button */}
              <Button variant="primary" onClick={openCreate}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Domain
              </Button>
            </div>
          </div>
        </header>

        <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-5 max-w-6xl">
          {/* Configs List */}
          <Card padding="md">
            <SectionHeader label="DOMAIN CONFIGURATIONS" title="Configured Domains" />
            {!configs ? (
              <div className="py-8 text-center">
                <svg className="w-8 h-8 mx-auto mb-2 animate-spin theme-text-tertiary" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="theme-text-secondary">Loading configurations...</p>
              </div>
            ) : configs.length === 0 ? (
              <div className="py-8 text-center">
                <svg className="w-16 h-16 mx-auto mb-4 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <h3 className="text-base font-semibold theme-text-primary mb-2">No Domain Configurations</h3>
                <p className="theme-text-secondary mb-4 text-sm">
                  Add your first domain configuration to enable auto-fill for IMAP email accounts.
                </p>
                <Button variant="primary" onClick={openCreate}>Add Domain</Button>
              </div>
            ) : (
              <div className="space-y-0 divide-y theme-border-secondary -mx-1">
                {/* Table Header */}
                <div className="grid grid-cols-12 gap-4 px-4 py-2 ui-section-label">
                  <div className="col-span-2">Domain</div>
                  <div className="col-span-2">Name</div>
                  <div className="col-span-3">IMAP Server</div>
                  <div className="col-span-3">SMTP Server</div>
                  <div className="col-span-1">Status</div>
                  <div className="col-span-1">Actions</div>
                </div>

                {/* Table Rows */}
                {configs.map((config) => (
                  <div
                    key={config._id}
                    className="grid grid-cols-12 gap-4 px-4 py-3 items-center hover:bg-[color-mix(in_srgb,var(--accent-primary)_4%,transparent)] transition-colors rounded-lg"
                  >
                    <div className="col-span-2">
                      <span className="font-mono text-sm theme-accent-primary">
                        @{config.domain}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="theme-text-primary font-medium text-sm">{config.name}</span>
                      {config.description && (
                        <p className="text-xs theme-text-tertiary truncate">{config.description}</p>
                      )}
                    </div>
                    <div className="col-span-3">
                      <span className="text-sm theme-text-secondary">
                        {config.imapHost}:{config.imapPort}
                      </span>
                      {config.imapTls && (
                        <span className="ml-2 ui-badge ui-badge-green">TLS</span>
                      )}
                    </div>
                    <div className="col-span-3">
                      <span className="text-sm theme-text-secondary">
                        {config.smtpHost}:{config.smtpPort}
                      </span>
                      {config.smtpTls && (
                        <span className="ml-2 ui-badge ui-badge-green">TLS</span>
                      )}
                    </div>
                    <div className="col-span-1">
                      <button
                        onClick={() => handleToggleActive(config._id)}
                        className={`ui-badge cursor-pointer ${config.isActive ? "ui-badge-green" : "ui-badge-gray"}`}
                      >
                        {config.isActive ? "Active" : "Inactive"}
                      </button>
                    </div>
                    <div className="col-span-1 flex items-center gap-1">
                      <button
                        onClick={() => openEdit(config)}
                        className="p-1.5 rounded-lg theme-text-secondary hover:theme-text-primary hover:bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)] transition-colors"
                        title="Edit"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(config._id)}
                        className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                        title="Delete"
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

          {/* Common Presets Info */}
          <Card tone="accent" padding="sm">
            <h3 className="ui-section-label mb-3">Common IMAP/SMTP Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm theme-text-secondary">
              <div>
                <strong className="theme-text-primary">Gmail:</strong><br />
                IMAP: imap.gmail.com:993 (TLS)<br />
                SMTP: smtp.gmail.com:587 (TLS)
              </div>
              <div>
                <strong className="theme-text-primary">Outlook/Microsoft 365:</strong><br />
                IMAP: outlook.office365.com:993 (TLS)<br />
                SMTP: smtp.office365.com:587 (TLS)
              </div>
              <div>
                <strong className="theme-text-primary">Yahoo:</strong><br />
                IMAP: imap.mail.yahoo.com:993 (TLS)<br />
                SMTP: smtp.mail.yahoo.com:587 (TLS)
              </div>
            </div>
          </Card>
        </div>

        {/* Create/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="theme-card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="px-6 py-4 border-b theme-border-secondary flex items-center justify-between sticky top-0 bg-[var(--surface-primary)]">
                <h2 className="text-lg font-semibold theme-text-primary">
                  {editingId ? "Edit Domain Configuration" : "Add Domain Configuration"}
                </h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-2 rounded-lg theme-text-secondary hover:theme-text-primary hover:bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)] transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-6">
                {error && (
                  <Card tone="red" padding="sm">
                    <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                  </Card>
                )}

                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block ui-section-label mb-1.5">Domain *</label>
                    <div className="flex">
                      <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 theme-border-secondary bg-[#f2f2f7] dark:bg-slate-900/60 theme-text-secondary text-sm">
                        @
                      </span>
                      <input
                        type="text"
                        value={form.domain}
                        onChange={(e) => setForm({ ...form, domain: e.target.value })}
                        placeholder="company.com"
                        required
                        className="theme-input flex-1 px-3 py-2 text-sm rounded-l-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block ui-section-label mb-1.5">Display Name *</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Company Email"
                      required
                      className="theme-input w-full px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block ui-section-label mb-1.5">Description</label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Help text for users"
                    className="theme-input w-full px-3 py-2 text-sm"
                  />
                </div>

                {/* IMAP Settings */}
                <div>
                  <p className="ui-section-label mb-3">IMAP Settings (Incoming Mail)</p>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <label className="block ui-section-label mb-1">Host</label>
                      <input
                        type="text"
                        value={form.imapHost}
                        onChange={(e) => setForm({ ...form, imapHost: e.target.value })}
                        placeholder="imap.example.com"
                        required
                        className="theme-input w-full px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block ui-section-label mb-1">Port</label>
                      <input
                        type="number"
                        value={form.imapPort}
                        onChange={(e) => setForm({ ...form, imapPort: parseInt(e.target.value) || 993 })}
                        required
                        className="theme-input w-full px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.imapTls}
                      onChange={(e) => setForm({ ...form, imapTls: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm theme-text-secondary">Use TLS/SSL</span>
                  </label>
                </div>

                {/* SMTP Settings */}
                <div>
                  <p className="ui-section-label mb-3">SMTP Settings (Outgoing Mail)</p>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <label className="block ui-section-label mb-1">Host</label>
                      <input
                        type="text"
                        value={form.smtpHost}
                        onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
                        placeholder="smtp.example.com"
                        required
                        className="theme-input w-full px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block ui-section-label mb-1">Port</label>
                      <input
                        type="number"
                        value={form.smtpPort}
                        onChange={(e) => setForm({ ...form, smtpPort: parseInt(e.target.value) || 587 })}
                        required
                        className="theme-input w-full px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.smtpTls}
                      onChange={(e) => setForm({ ...form, smtpTls: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm theme-text-secondary">Use TLS/SSL</span>
                  </label>
                </div>

                {/* Additional Options */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.useEmailAsUsername}
                        onChange={(e) => setForm({ ...form, useEmailAsUsername: e.target.checked })}
                        className="rounded"
                      />
                      <span className="text-sm theme-text-secondary">Use email as username</span>
                    </label>
                    <p className="text-xs mt-1 theme-text-tertiary">
                      If checked, user&apos;s email will be used as IMAP/SMTP username
                    </p>
                  </div>
                  <div>
                    <label className="block ui-section-label mb-1">Sort Order</label>
                    <input
                      type="number"
                      value={form.sortOrder}
                      onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })}
                      className="theme-input w-full px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-4 border-t theme-border-secondary">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={isSaving}
                  >
                    {isSaving && (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    {isSaving ? "Saving..." : editingId ? "Update" : "Create"}
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

export default function EmailDomainSettingsPage() {
  return (
    <Protected requiredRoles={["super_admin"]}>
      <EmailDomainSettingsContent />
    </Protected>
  );
}
