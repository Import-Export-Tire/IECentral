"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import Protected from "../../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "../../auth-context";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";

const DOCUMENT_TYPES = [
  { value: "handbook", label: "Employee Handbook", icon: "📘" },
  { value: "policy", label: "Company Policy", icon: "📋" },
  { value: "agreement", label: "Agreement", icon: "📝" },
  { value: "form", label: "Form", icon: "📄" },
];

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function OnboardingContent() {
  const { user } = useAuth();

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showSignaturesModal, setShowSignaturesModal] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<Id<"onboardingDocuments"> | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    documentType: "handbook",
    requiresSignature: true,
    isRequired: true,
    version: "1.0",
    effectiveDate: new Date().toISOString().split("T")[0],
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Queries
  const documents = useQuery(api.onboardingDocuments.listAll);
  const signatures = useQuery(
    api.onboardingDocuments.getSignaturesForDocument,
    selectedDocument ? { documentId: selectedDocument } : "skip"
  );
  const unsignedEmployees = useQuery(
    api.onboardingDocuments.getUnsignedEmployees,
    selectedDocument ? { documentId: selectedDocument } : "skip"
  );

  // Mutations
  const generateUploadUrl = useMutation(api.onboardingDocuments.generateUploadUrl);
  const createDocument = useMutation(api.onboardingDocuments.create);
  const updateDocument = useMutation(api.onboardingDocuments.update);
  const deleteDocument = useMutation(api.onboardingDocuments.deleteDocument);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!formData.title) {
        setFormData({ ...formData, title: file.name.replace(/\.[^/.]+$/, "") });
      }
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !user) return;

    setUploading(true);
    setError("");

    try {
      const uploadUrl = await generateUploadUrl();
      if (!uploadUrl) throw new Error("Failed to generate upload URL");

      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": selectedFile.type },
        body: selectedFile,
      });

      if (!response.ok) throw new Error("Upload failed");

      const result = await response.json();
      const storageId = result.storageId;

      await createDocument({
        title: formData.title,
        description: formData.description || undefined,
        documentType: formData.documentType,
        storageId,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        requiresSignature: formData.requiresSignature,
        isRequired: formData.isRequired,
        version: formData.version,
        effectiveDate: formData.effectiveDate,
        createdBy: user._id,
      });

      setShowUploadModal(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const resetForm = () => {
    setSelectedFile(null);
    setFormData({
      title: "",
      description: "",
      documentType: "handbook",
      requiresSignature: true,
      isRequired: true,
      version: "1.0",
      effectiveDate: new Date().toISOString().split("T")[0],
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleToggleActive = async (docId: Id<"onboardingDocuments">, currentActive: boolean) => {
    try {
      await updateDocument({ documentId: docId, isActive: !currentActive });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  };

  const handleDelete = async (docId: Id<"onboardingDocuments">) => {
    if (!confirm("Are you sure you want to delete this document? All signature records will be lost.")) return;
    try {
      await deleteDocument({ documentId: docId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleViewSignatures = (docId: Id<"onboardingDocuments">) => {
    setSelectedDocument(docId);
    setShowSignaturesModal(true);
  };

  const selectedDocDetails = documents?.find((d) => d._id === selectedDocument);

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
                <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">Onboarding Documents</h1>
                <p className="text-xs sm:text-sm mt-0.5 theme-text-tertiary">
                  Manage employee handbooks, policies, and required documents
                </p>
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setShowUploadModal(true);
                resetForm();
              }}
            >
              + Add Document
            </Button>
          </div>
        </header>

        <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-5 max-w-4xl">
          {error && (
            <Card tone="red" padding="sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                <button onClick={() => setError("")} className="text-sm text-red-500 hover:text-red-700 shrink-0">Dismiss</button>
              </div>
            </Card>
          )}

          {/* Stats Cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card padding="sm">
              <div className="text-2xl font-bold theme-text-primary">{documents?.length || 0}</div>
              <div className="text-sm theme-text-secondary mt-0.5">Total Documents</div>
            </Card>
            <Card padding="sm">
              <div className="text-2xl font-bold text-green-500">{documents?.filter((d) => d.isActive).length || 0}</div>
              <div className="text-sm theme-text-secondary mt-0.5">Active Documents</div>
            </Card>
            <Card padding="sm">
              <div className="text-2xl font-bold text-amber-500">{documents?.filter((d) => d.requiresSignature && d.isRequired).length || 0}</div>
              <div className="text-sm theme-text-secondary mt-0.5">Require Signature</div>
            </Card>
          </div>

          {/* Documents List */}
          {!documents || documents.length === 0 ? (
            <Card padding="md">
              <div className="text-center py-8">
                <div className="text-4xl mb-3">📋</div>
                <p className="theme-text-secondary">No onboarding documents yet.</p>
                <p className="text-sm theme-text-tertiary mt-2">Upload your employee handbook or company policies to get started.</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {documents.map((doc) => {
                const docType = DOCUMENT_TYPES.find((t) => t.value === doc.documentType);
                return (
                  <Card
                    key={doc._id}
                    padding="md"
                    className={!doc.isActive ? "opacity-60" : ""}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                      {/* Icon */}
                      <div className="text-3xl p-3 rounded-xl shrink-0 bg-[#f2f2f7] dark:bg-slate-900/60">
                        {docType?.icon || "📄"}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-lg font-semibold theme-text-primary">{doc.title}</h3>
                            <div className="flex flex-wrap items-center gap-2 mt-1">
                              <span className="ui-badge ui-badge-gray">{docType?.label}</span>
                              <span className="text-sm theme-text-tertiary">v{doc.version}</span>
                              <span className="text-sm theme-text-tertiary">·</span>
                              <span className="text-sm theme-text-tertiary">{formatFileSize(doc.fileSize)}</span>
                              {doc.pageCount && (
                                <>
                                  <span className="text-sm theme-text-tertiary">·</span>
                                  <span className="text-sm theme-text-tertiary">{doc.pageCount} pages</span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Status Badge */}
                          <span className={`ui-badge ${doc.isActive ? "ui-badge-green" : "ui-badge-gray"}`}>
                            {doc.isActive ? "Active" : "Inactive"}
                          </span>
                        </div>

                        {doc.description && (
                          <p className="mt-2 text-sm theme-text-secondary">{doc.description}</p>
                        )}

                        {/* Meta Info */}
                        <div className="flex flex-wrap items-center gap-4 mt-3 text-xs theme-text-tertiary">
                          <div className="flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            Effective: {doc.effectiveDate}
                          </div>
                          <div className="flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Added: {formatDate(doc.createdAt)}
                          </div>
                          {doc.requiresSignature && (
                            <div className="flex items-center gap-1 text-amber-500">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                              Requires Signature
                            </div>
                          )}
                          {doc.isRequired && (
                            <div className="flex items-center gap-1 text-red-500">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              Required
                            </div>
                          )}
                        </div>

                        {/* Signature Stats */}
                        {doc.requiresSignature && (
                          <div className="flex items-center gap-4 mt-4 pt-4 border-t theme-border-secondary">
                            <button
                              onClick={() => handleViewSignatures(doc._id)}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-[#f2f2f7] dark:bg-slate-900/60 theme-text-secondary hover:bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)]"
                            >
                              <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span className="text-green-500 font-bold">{doc.signatureCount}</span>
                              Signed
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex sm:flex-col gap-2 shrink-0">
                        <Button
                          variant={doc.isActive ? "secondary" : "ghost"}
                          size="sm"
                          onClick={() => handleToggleActive(doc._id, doc.isActive)}
                        >
                          {doc.isActive ? "Deactivate" : "Activate"}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDelete(doc._id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Upload Modal */}
        {showUploadModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="theme-card w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="p-5 border-b theme-border-secondary">
                <h2 className="text-lg font-semibold theme-text-primary">Add Onboarding Document</h2>
              </div>
              <form onSubmit={handleUpload} className="p-5 space-y-4">
                {/* File Upload */}
                <div>
                  <span className="block ui-section-label mb-1.5">Document File *</span>
                  <label
                    htmlFor="file-upload"
                    className={`block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                      selectedFile
                        ? "border-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_6%,transparent)]"
                        : "theme-border-secondary hover:border-[var(--accent-primary)]"
                    }`}
                  >
                    <input
                      id="file-upload"
                      ref={fileInputRef}
                      type="file"
                      onChange={handleFileSelect}
                      className="sr-only"
                      accept=".pdf,.doc,.docx"
                    />
                    {selectedFile ? (
                      <div>
                        <div className="text-2xl mb-2">📄</div>
                        <p className="font-medium theme-text-primary">{selectedFile.name}</p>
                        <p className="text-sm theme-text-secondary">{formatFileSize(selectedFile.size)}</p>
                      </div>
                    ) : (
                      <div>
                        <div className="text-2xl mb-2">📤</div>
                        <p className="theme-text-secondary">Click to select a document</p>
                        <p className="text-xs mt-1 theme-text-tertiary">PDF or Word documents</p>
                      </div>
                    )}
                  </label>
                </div>

                {/* Title */}
                <div>
                  <label className="block ui-section-label mb-1.5">Document Title *</label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="theme-input w-full px-3 py-2 text-sm"
                    required
                    placeholder="e.g., Employee Handbook 2025"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block ui-section-label mb-1.5">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={2}
                    className="theme-input w-full px-3 py-2 text-sm"
                    placeholder="Brief description..."
                  />
                </div>

                {/* Document Type & Version */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block ui-section-label mb-1.5">Document Type *</label>
                    <select
                      value={formData.documentType}
                      onChange={(e) => setFormData({ ...formData, documentType: e.target.value })}
                      className="theme-input w-full px-3 py-2 text-sm"
                    >
                      {DOCUMENT_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.icon} {type.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block ui-section-label mb-1.5">Version *</label>
                    <input
                      type="text"
                      value={formData.version}
                      onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                      className="theme-input w-full px-3 py-2 text-sm"
                      required
                      placeholder="1.0"
                    />
                  </div>
                </div>

                {/* Effective Date */}
                <div>
                  <label className="block ui-section-label mb-1.5">Effective Date *</label>
                  <input
                    type="date"
                    value={formData.effectiveDate}
                    onChange={(e) => setFormData({ ...formData, effectiveDate: e.target.value })}
                    className="theme-input w-full px-3 py-2 text-sm"
                    required
                  />
                </div>

                {/* Checkboxes */}
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.requiresSignature}
                      onChange={(e) => setFormData({ ...formData, requiresSignature: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-600 text-cyan-500 focus:ring-cyan-500"
                    />
                    <span className="text-sm theme-text-secondary">Requires digital signature</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.isRequired}
                      onChange={(e) => setFormData({ ...formData, isRequired: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-600 text-cyan-500 focus:ring-cyan-500"
                    />
                    <span className="text-sm theme-text-secondary">Required for all employees</span>
                  </label>
                </div>

                {/* Buttons */}
                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1"
                    onClick={() => {
                      setShowUploadModal(false);
                      resetForm();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    className="flex-1"
                    disabled={uploading || !selectedFile}
                  >
                    {uploading ? "Uploading..." : "Add Document"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Signatures Modal */}
        {showSignaturesModal && selectedDocDetails && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="theme-card w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
              {/* Modal Header */}
              <div className="flex items-center justify-between p-5 border-b theme-border-secondary">
                <div>
                  <h2 className="text-lg font-semibold theme-text-primary">Signature Status</h2>
                  <p className="text-sm theme-text-secondary mt-0.5">
                    {selectedDocDetails.title} (v{selectedDocDetails.version})
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowSignaturesModal(false);
                    setSelectedDocument(null);
                  }}
                  className="p-2 rounded-lg theme-text-secondary hover:theme-text-primary hover:bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)] transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Content */}
              <div className="flex-1 overflow-y-auto p-5">
                {/* Stats */}
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <Card tone="green" padding="sm">
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">{signatures?.length || 0}</div>
                    <div className="text-sm text-green-700 dark:text-green-400 mt-0.5">Signed</div>
                  </Card>
                  <Card tone="amber" padding="sm">
                    <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{unsignedEmployees?.length || 0}</div>
                    <div className="text-sm text-amber-700 dark:text-amber-400 mt-0.5">Pending</div>
                  </Card>
                </div>

                <div className="space-y-6">
                  {/* Signed List */}
                  <div>
                    <div className="ui-section-label mb-3">Signed ({signatures?.length || 0})</div>
                    {signatures && signatures.length > 0 ? (
                      <div className="space-y-2">
                        {signatures.map((sig) => (
                          <div
                            key={sig._id}
                            className="flex items-center justify-between p-3 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/60"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium bg-green-500/20 text-green-600 dark:text-green-400">
                                {sig.personnelName.charAt(0)}
                              </div>
                              <span className="theme-text-primary text-sm">{sig.personnelName}</span>
                            </div>
                            <span className="text-xs theme-text-tertiary">{formatDate(sig.signedAt)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm theme-text-tertiary">No signatures yet</p>
                    )}
                  </div>

                  {/* Unsigned List */}
                  <div>
                    <div className="ui-section-label mb-3">Pending Signatures ({unsignedEmployees?.length || 0})</div>
                    {unsignedEmployees && unsignedEmployees.length > 0 ? (
                      <div className="space-y-2">
                        {unsignedEmployees.map((emp) => (
                          <div
                            key={emp._id}
                            className="flex items-center justify-between p-3 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/60"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium bg-amber-500/20 text-amber-600 dark:text-amber-400">
                                {emp.name.charAt(0)}
                              </div>
                              <div>
                                <span className="theme-text-primary text-sm">{emp.name}</span>
                                {emp.department && (
                                  <span className="block text-xs theme-text-tertiary">{emp.department}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-green-500">All active employees have signed!</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Protected>
      <OnboardingContent />
    </Protected>
  );
}
