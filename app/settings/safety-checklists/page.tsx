"use client";

import { useState } from "react";
import Link from "next/link";
import Protected from "../../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "../../auth-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";

interface ChecklistItem {
  id: string;
  question: string;
  description?: string;
  minimumSeconds: number;
  order: number;
  responseType?: string; // "yes_no" | "yes_no_na" | "condition_report"
  requiresDetailsOn?: string; // "yes" | "no" | "na" | "always" | "never"
  detailsPrompt?: string;
  expectedAnswer?: string; // "yes" | "no" - the expected passing answer (defaults to "yes")
}

interface Template {
  _id: Id<"safetyChecklistTemplates">;
  name: string;
  equipmentType: string;
  isDefault: boolean;
  items: ChecklistItem[];
  createdAt: number;
  updatedAt: number;
}

function SafetyChecklistsContent() {
  const { user } = useAuth();

  // State
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Template form state
  const [templateForm, setTemplateForm] = useState({
    name: "",
    equipmentType: "picker",
    isDefault: false,
    items: [] as ChecklistItem[],
  });

  // New item form
  const [newItem, setNewItem] = useState({
    question: "",
    description: "",
    minimumSeconds: 10,
    responseType: "yes_no" as string,
    requiresDetailsOn: "never" as string,
    detailsPrompt: "",
    expectedAnswer: "yes" as string, // "yes" | "no" - expected passing answer
  });

  // Queries
  const templates = useQuery(api.safetyChecklist.getAllTemplates);
  const defaultTemplate = useQuery(api.safetyChecklist.getDefaultTemplate, { equipmentType: "picker" });

  // Mutations
  const upsertTemplate = useMutation(api.safetyChecklist.upsertTemplate);
  const deleteTemplate = useMutation(api.safetyChecklist.deleteTemplate);
  const createDefaultTemplate = useMutation(api.safetyChecklist.createDefaultTemplate);

  const generateItemId = () => `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const handleCreateDefault = async () => {
    if (!user?._id) return;
    try {
      const result = await createDefaultTemplate({ userId: user._id });
      if (result.exists) {
        setSuccess("Default template already exists.");
      } else {
        setSuccess("Default template created successfully!");
      }
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create default template");
    }
  };

  const handleEdit = (template: Template) => {
    setEditingTemplate(template);
    setTemplateForm({
      name: template.name,
      equipmentType: template.equipmentType,
      isDefault: template.isDefault,
      items: [...template.items],
    });
    setShowNewTemplate(true);
  };

  const handleNewTemplate = () => {
    setEditingTemplate(null);
    setTemplateForm({
      name: "",
      equipmentType: "picker",
      isDefault: false,
      items: [],
    });
    setShowNewTemplate(true);
  };

  const handleAddItem = () => {
    if (!newItem.question.trim()) return;

    const item: ChecklistItem = {
      id: generateItemId(),
      question: newItem.question.trim(),
      description: newItem.description.trim() || undefined,
      minimumSeconds: newItem.minimumSeconds,
      order: templateForm.items.length + 1,
      responseType: newItem.responseType,
      requiresDetailsOn: newItem.requiresDetailsOn,
      detailsPrompt: newItem.detailsPrompt.trim() || undefined,
      expectedAnswer: newItem.expectedAnswer,
    };

    setTemplateForm({
      ...templateForm,
      items: [...templateForm.items, item],
    });

    setNewItem({
      question: "",
      description: "",
      minimumSeconds: 10,
      responseType: "yes_no",
      requiresDetailsOn: "never",
      detailsPrompt: "",
      expectedAnswer: "yes",
    });
  };

  const handleRemoveItem = (itemId: string) => {
    const newItems = templateForm.items
      .filter((item) => item.id !== itemId)
      .map((item, idx) => ({ ...item, order: idx + 1 }));
    setTemplateForm({ ...templateForm, items: newItems });
  };

  const handleMoveItem = (itemId: string, direction: "up" | "down") => {
    const items = [...templateForm.items];
    const idx = items.findIndex((item) => item.id === itemId);
    if (idx < 0) return;

    if (direction === "up" && idx > 0) {
      [items[idx], items[idx - 1]] = [items[idx - 1], items[idx]];
    } else if (direction === "down" && idx < items.length - 1) {
      [items[idx], items[idx + 1]] = [items[idx + 1], items[idx]];
    }

    // Update order numbers
    items.forEach((item, i) => {
      item.order = i + 1;
    });

    setTemplateForm({ ...templateForm, items });
  };

  const handleUpdateItem = (itemId: string, field: keyof ChecklistItem, value: string | number) => {
    const items = templateForm.items.map((item) =>
      item.id === itemId ? { ...item, [field]: value } : item
    );
    setTemplateForm({ ...templateForm, items });
  };

  const handleSave = async () => {
    if (!user?._id) return;
    if (!templateForm.name.trim()) {
      setError("Please enter a template name");
      return;
    }
    if (templateForm.items.length === 0) {
      setError("Please add at least one checklist item");
      return;
    }

    setError("");
    try {
      await upsertTemplate({
        id: editingTemplate?._id,
        name: templateForm.name.trim(),
        equipmentType: templateForm.equipmentType,
        isDefault: templateForm.isDefault,
        items: templateForm.items,
        userId: user._id,
      });

      setSuccess(editingTemplate ? "Template updated successfully!" : "Template created successfully!");
      setShowNewTemplate(false);
      setEditingTemplate(null);
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save template");
    }
  };

  const handleDelete = async (templateId: Id<"safetyChecklistTemplates">) => {
    if (!confirm("Are you sure you want to delete this template?")) return;

    try {
      if (!user) throw new Error("Not signed in");
      await deleteTemplate({ id: templateId, requestingUserId: user._id });
      setSuccess("Template deleted successfully!");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete template");
    }
  };

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  return (
    <div className="flex h-screen theme-bg">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Sticky iOS-style page header */}
        <header className="sticky top-0 z-10 backdrop-blur-sm border-b theme-border-secondary px-4 sm:px-8 py-3 sm:py-4 bg-[var(--surface-primary)]/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
                <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">Safety Checklist Templates</h1>
                <p className="text-xs sm:text-sm mt-0.5 theme-text-tertiary">
                  Manage checklist templates for picker safety inspections
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {(!templates || templates.length === 0) && (
                <Button variant="secondary" size="sm" onClick={handleCreateDefault}>
                  Create Default Template
                </Button>
              )}
              <Button variant="primary" size="sm" onClick={handleNewTemplate}>
                + New Template
              </Button>
            </div>
          </div>
        </header>

        <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-5 max-w-4xl">
          {/* Success/Error Messages */}
          {success && (
            <Card tone="green" padding="sm">
              <p className="text-sm text-green-700 dark:text-green-400">{success}</p>
            </Card>
          )}
          {error && (
            <Card tone="red" padding="sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                <button onClick={() => setError("")} className="text-sm text-red-500 hover:text-red-700 shrink-0">Dismiss</button>
              </div>
            </Card>
          )}

          {/* Templates List */}
          {!templates ? (
            <Card padding="md">
              <div className="text-center py-8 theme-text-tertiary">Loading...</div>
            </Card>
          ) : templates.length === 0 ? (
            <Card padding="md">
              <div className="text-center py-8">
                <svg className="w-12 h-12 mx-auto mb-4 theme-text-tertiary opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                <p className="theme-text-secondary mb-2">No templates found</p>
                <p className="text-sm theme-text-tertiary">
                  Click &ldquo;Create Default Template&rdquo; to get started with the standard picker checklist, or create a custom template.
                </p>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {templates.map((template) => (
                <Card key={template._id} padding="md">
                  <SectionHeader
                    title={template.name}
                    actions={
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleEdit(template as Template)}
                        >
                          Edit
                        </Button>
                        {!template.isDefault && (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleDelete(template._id)}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    }
                  />
                  <div className="flex items-center gap-2 -mt-2 mb-4">
                    <span className="text-sm theme-text-secondary">
                      {template.equipmentType === "picker" ? "Picker" : template.equipmentType === "scanner" ? "Scanner" : "All Equipment"} &bull; {template.items.length} items
                    </span>
                    {template.isDefault && (
                      <span className="ui-badge ui-badge-green">Default</span>
                    )}
                  </div>

                  {/* Checklist Items Preview */}
                  <div className="rounded-xl p-4 bg-[#f2f2f7] dark:bg-slate-900/60">
                    <div className="grid gap-2">
                      {template.items.slice(0, 5).map((item, idx) => (
                        <div key={item.id} className="flex items-center gap-3 text-sm theme-text-secondary">
                          <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium bg-white dark:bg-slate-800 theme-text-secondary shrink-0">
                            {idx + 1}
                          </span>
                          <span className="flex-1 truncate theme-text-primary">{item.question}</span>
                          <span className="text-xs theme-text-tertiary">{formatTime(item.minimumSeconds)}</span>
                        </div>
                      ))}
                      {template.items.length > 5 && (
                        <p className="text-xs theme-text-tertiary mt-2">
                          +{template.items.length - 5} more items
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t theme-border-secondary flex justify-between text-xs theme-text-tertiary">
                    <span>Created: {new Date(template.createdAt).toLocaleDateString()}</span>
                    <span>Updated: {new Date(template.updatedAt).toLocaleDateString()}</span>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Default Template Preview (if using hardcoded) */}
          {defaultTemplate && !defaultTemplate._id && templates && templates.length === 0 && (
            <Card tone="accent" padding="sm">
              <p className="text-sm theme-text-secondary">
                <strong className="theme-text-primary">Note:</strong> The system is currently using the built-in default checklist with {defaultTemplate.items.length} items.
                Create a template to customize it.
              </p>
            </Card>
          )}
        </div>

        {/* New/Edit Template Modal */}
        {showNewTemplate && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="theme-card w-full max-w-3xl max-h-[90vh] overflow-y-auto">
              <div className="p-5 border-b theme-border-secondary flex items-center justify-between">
                <h2 className="text-lg font-semibold theme-text-primary">
                  {editingTemplate ? "Edit Template" : "New Template"}
                </h2>
                <button
                  onClick={() => {
                    setShowNewTemplate(false);
                    setEditingTemplate(null);
                  }}
                  className="p-2 rounded-lg theme-text-secondary hover:theme-text-primary hover:bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)] transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-5 space-y-6">
                {/* Template Info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block ui-section-label mb-1.5">Template Name *</label>
                    <input
                      type="text"
                      value={templateForm.name}
                      onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                      className="theme-input w-full px-3 py-2 text-sm"
                      placeholder="Standard Picker Checklist"
                    />
                  </div>
                  <div>
                    <label className="block ui-section-label mb-1.5">Equipment Type</label>
                    <select
                      value={templateForm.equipmentType}
                      onChange={(e) => setTemplateForm({ ...templateForm, equipmentType: e.target.value })}
                      className="theme-input w-full px-3 py-2 text-sm"
                    >
                      <option value="picker">Picker</option>
                      <option value="scanner">Scanner</option>
                      <option value="all">All Equipment</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={templateForm.isDefault}
                      onChange={(e) => setTemplateForm({ ...templateForm, isDefault: e.target.checked })}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm theme-text-secondary">
                      Set as default template for this equipment type
                    </span>
                  </label>
                </div>

                {/* Checklist Items */}
                <div>
                  <div className="ui-section-label mb-3">Checklist Items ({templateForm.items.length})</div>

                  {/* Items List */}
                  {templateForm.items.length > 0 && (
                    <div className="space-y-3 mb-4">
                      {templateForm.items.map((item, idx) => (
                        <div
                          key={item.id}
                          className="p-4 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/60 border theme-border-secondary"
                        >
                          {/* Header row with question and controls */}
                          <div className="flex items-start gap-3">
                            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 bg-white dark:bg-slate-800 theme-text-secondary">
                              {idx + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <input
                                type="text"
                                value={item.question}
                                onChange={(e) => handleUpdateItem(item.id, "question", e.target.value)}
                                className="theme-input w-full px-2 py-1 text-sm"
                              />
                              <input
                                type="text"
                                value={item.description || ""}
                                onChange={(e) => handleUpdateItem(item.id, "description", e.target.value)}
                                placeholder="Description (optional)"
                                className="theme-input w-full px-2 py-1 text-xs mt-1"
                              />
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <input
                                type="number"
                                value={item.minimumSeconds}
                                onChange={(e) => handleUpdateItem(item.id, "minimumSeconds", parseInt(e.target.value) || 5)}
                                min={5}
                                max={300}
                                className="theme-input w-16 px-2 py-1 text-sm text-center"
                              />
                              <span className="text-xs theme-text-tertiary">sec</span>
                            </div>
                            <div className="flex flex-col gap-1 flex-shrink-0">
                              <button
                                onClick={() => handleMoveItem(item.id, "up")}
                                disabled={idx === 0}
                                className="p-1 rounded-lg transition-colors disabled:opacity-30 hover:bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)]"
                              >
                                <svg className="w-4 h-4 theme-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                </svg>
                              </button>
                              <button
                                onClick={() => handleMoveItem(item.id, "down")}
                                disabled={idx === templateForm.items.length - 1}
                                className="p-1 rounded-lg transition-colors disabled:opacity-30 hover:bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)]"
                              >
                                <svg className="w-4 h-4 theme-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                            </div>
                            <button
                              onClick={() => handleRemoveItem(item.id)}
                              className="p-1 rounded-lg transition-colors flex-shrink-0 text-red-500 hover:bg-red-500/10"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>

                          {/* Response type and damage reporting options */}
                          <div className="mt-3 pt-3 border-t theme-border-secondary grid grid-cols-1 md:grid-cols-4 gap-3">
                            <div>
                              <label className="block text-xs ui-section-label mb-1">Response Type</label>
                              <select
                                value={item.responseType || "yes_no"}
                                onChange={(e) => handleUpdateItem(item.id, "responseType", e.target.value)}
                                className="theme-input w-full px-2 py-1.5 text-xs"
                              >
                                <option value="yes_no">Yes / No</option>
                                <option value="yes_no_na">Yes / No / N/A</option>
                                <option value="condition_report">Condition Report</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs ui-section-label mb-1">Expected Answer</label>
                              <select
                                value={item.expectedAnswer || "yes"}
                                onChange={(e) => handleUpdateItem(item.id, "expectedAnswer", e.target.value)}
                                className="theme-input w-full px-2 py-1.5 text-xs"
                              >
                                <option value="yes">Yes = Pass</option>
                                <option value="no">No = Pass</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs ui-section-label mb-1">Require Details</label>
                              <select
                                value={item.requiresDetailsOn || "never"}
                                onChange={(e) => handleUpdateItem(item.id, "requiresDetailsOn", e.target.value)}
                                className="theme-input w-full px-2 py-1.5 text-xs"
                              >
                                <option value="never">Never</option>
                                <option value="no">When &ldquo;No&rdquo; is selected</option>
                                <option value="yes">When &ldquo;Yes&rdquo; is selected</option>
                                {(item.responseType === "yes_no_na") && <option value="na">When &ldquo;N/A&rdquo; is selected</option>}
                                <option value="always">Always required</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs ui-section-label mb-1">Details Prompt</label>
                              <input
                                type="text"
                                value={item.detailsPrompt || ""}
                                onChange={(e) => handleUpdateItem(item.id, "detailsPrompt", e.target.value)}
                                placeholder="Describe the issue..."
                                disabled={item.requiresDetailsOn === "never"}
                                className="theme-input w-full px-2 py-1.5 text-xs disabled:opacity-50"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add New Item */}
                  <div className="p-4 rounded-xl border-2 border-dashed theme-border-secondary">
                    <p className="ui-section-label mb-3">Add New Item</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input
                        type="text"
                        value={newItem.question}
                        onChange={(e) => setNewItem({ ...newItem, question: e.target.value })}
                        placeholder="Question / Check item *"
                        className="theme-input px-3 py-2 text-sm"
                      />
                      <input
                        type="text"
                        value={newItem.description}
                        onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                        placeholder="Description (optional)"
                        className="theme-input px-3 py-2 text-sm"
                      />
                    </div>

                    {/* Response type and damage options for new item */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3 pt-3 border-t theme-border-secondary">
                      <div>
                        <label className="block text-xs ui-section-label mb-1">Response Type</label>
                        <select
                          value={newItem.responseType}
                          onChange={(e) => setNewItem({ ...newItem, responseType: e.target.value })}
                          className="theme-input w-full px-3 py-2 text-sm"
                        >
                          <option value="yes_no">Yes / No</option>
                          <option value="yes_no_na">Yes / No / N/A</option>
                          <option value="condition_report">Condition Report</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs ui-section-label mb-1">Expected Answer</label>
                        <select
                          value={newItem.expectedAnswer}
                          onChange={(e) => setNewItem({ ...newItem, expectedAnswer: e.target.value })}
                          className="theme-input w-full px-3 py-2 text-sm"
                        >
                          <option value="yes">Yes = Pass</option>
                          <option value="no">No = Pass</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs ui-section-label mb-1">Require Details</label>
                        <select
                          value={newItem.requiresDetailsOn}
                          onChange={(e) => setNewItem({ ...newItem, requiresDetailsOn: e.target.value })}
                          className="theme-input w-full px-3 py-2 text-sm"
                        >
                          <option value="never">Never</option>
                          <option value="no">When &ldquo;No&rdquo; is selected</option>
                          <option value="yes">When &ldquo;Yes&rdquo; is selected</option>
                          {newItem.responseType === "yes_no_na" && <option value="na">When &ldquo;N/A&rdquo; is selected</option>}
                          <option value="always">Always required</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs ui-section-label mb-1">Details Prompt</label>
                        <input
                          type="text"
                          value={newItem.detailsPrompt}
                          onChange={(e) => setNewItem({ ...newItem, detailsPrompt: e.target.value })}
                          placeholder="Describe the issue..."
                          disabled={newItem.requiresDetailsOn === "never"}
                          className="theme-input w-full px-3 py-2 text-sm disabled:opacity-50"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-4 mt-3">
                      <div className="flex items-center gap-2">
                        <label className="text-sm theme-text-secondary">Min. time:</label>
                        <input
                          type="number"
                          value={newItem.minimumSeconds}
                          onChange={(e) => setNewItem({ ...newItem, minimumSeconds: parseInt(e.target.value) || 5 })}
                          min={5}
                          max={300}
                          className="theme-input w-20 px-3 py-2 text-sm"
                        />
                        <span className="text-sm theme-text-secondary">seconds</span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleAddItem}
                        disabled={!newItem.question.trim()}
                      >
                        + Add Item
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-4 border-t theme-border-secondary">
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1"
                    onClick={() => {
                      setShowNewTemplate(false);
                      setEditingTemplate(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    className="flex-1"
                    onClick={handleSave}
                  >
                    {editingTemplate ? "Update Template" : "Create Template"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function SafetyChecklistsPage() {
  return (
    <Protected>
      <SafetyChecklistsContent />
    </Protected>
  );
}
