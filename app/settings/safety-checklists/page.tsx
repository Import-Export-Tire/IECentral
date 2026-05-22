"use client";

import { useState } from "react";
import Link from "next/link";
import Protected from "../../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../../theme-context";
import { useAuth } from "../../auth-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

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
  const { theme } = useTheme();
  const { user } = useAuth();
  const isDark = theme === "dark";

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
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        {/* Header */}
        <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link
                href="/settings"
                className={`p-2 -ml-2 rounded-lg transition-colors ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-700" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className={`text-xl sm:text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Safety Checklist Templates
                </h1>
                <p className={`text-xs sm:text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Manage checklist templates for picker safety inspections
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {(!templates || templates.length === 0) && (
                <button
                  onClick={handleCreateDefault}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${isDark ? "bg-green-500/20 text-green-400 hover:bg-green-500/30" : "bg-green-50 text-green-600 hover:bg-green-100"}`}
                >
                  Create Default Template
                </button>
              )}
              <button
                onClick={handleNewTemplate}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Template
              </button>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-8">
          {/* Success/Error Messages */}
          {success && (
            <div className="mb-6 p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400">
              {success}
            </div>
          )}
          {error && (
            <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
              {error}
              <button onClick={() => setError("")} className="ml-4 text-red-300 hover:text-red-100">Dismiss</button>
            </div>
          )}

          {/* Templates List */}
          {!templates ? (
            <div className={`text-center py-12 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Loading...
            </div>
          ) : templates.length === 0 ? (
            <div className={`text-center py-12 border rounded-xl ${isDark ? "bg-slate-800/50 border-slate-700 text-slate-400" : "bg-white border-gray-200 text-gray-500"}`}>
              <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              <p className="mb-4">No templates found</p>
              <p className={`text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                Click "Create Default Template" to get started with the standard picker checklist, or create a custom template.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {templates.map((template) => (
                <div
                  key={template._id}
                  className={`border rounded-xl p-5 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}
                >
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                          {template.name}
                        </h3>
                        {template.isDefault && (
                          <span className={`px-2 py-0.5 text-xs font-medium rounded ${isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-700"}`}>
                            Default
                          </span>
                        )}
                      </div>
                      <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        {template.equipmentType === "picker" ? "Picker" : template.equipmentType === "scanner" ? "Scanner" : "All Equipment"} • {template.items.length} items
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(template as Template)}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${isDark ? "bg-slate-700 text-slate-300 hover:bg-slate-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                      >
                        Edit
                      </button>
                      {!template.isDefault && (
                        <button
                          onClick={() => handleDelete(template._id)}
                          className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${isDark ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-red-50 text-red-600 hover:bg-red-100"}`}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Checklist Items Preview */}
                  <div className={`rounded-lg p-4 ${isDark ? "bg-slate-700/30" : "bg-gray-50"}`}>
                    <div className="grid gap-2">
                      {template.items.slice(0, 5).map((item, idx) => (
                        <div key={item.id} className={`flex items-center gap-3 text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${isDark ? "bg-slate-600 text-slate-300" : "bg-gray-200 text-gray-600"}`}>
                            {idx + 1}
                          </span>
                          <span className="flex-1 truncate">{item.question}</span>
                          <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                            {formatTime(item.minimumSeconds)}
                          </span>
                        </div>
                      ))}
                      {template.items.length > 5 && (
                        <p className={`text-xs mt-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                          +{template.items.length - 5} more items
                        </p>
                      )}
                    </div>
                  </div>

                  <div className={`mt-4 pt-4 border-t flex justify-between text-xs ${isDark ? "border-slate-700 text-slate-500" : "border-gray-200 text-gray-400"}`}>
                    <span>Created: {new Date(template.createdAt).toLocaleDateString()}</span>
                    <span>Updated: {new Date(template.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Default Template Preview (if using hardcoded) */}
          {defaultTemplate && !defaultTemplate._id && templates && templates.length === 0 && (
            <div className={`mt-6 p-4 rounded-lg border ${isDark ? "bg-slate-800/30 border-slate-700" : "bg-blue-50 border-blue-200"}`}>
              <p className={`text-sm ${isDark ? "text-slate-300" : "text-blue-700"}`}>
                <strong>Note:</strong> The system is currently using the built-in default checklist with {defaultTemplate.items.length} items.
                Create a template to customize it.
              </p>
            </div>
          )}
        </div>

        {/* New/Edit Template Modal */}
        {showNewTemplate && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`border rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className="flex items-center justify-between mb-6">
                <h2 className={`text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  {editingTemplate ? "Edit Template" : "New Template"}
                </h2>
                <button
                  onClick={() => {
                    setShowNewTemplate(false);
                    setEditingTemplate(null);
                  }}
                  className={`p-1 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"}`}
                >
                  <svg className={`w-5 h-5 ${isDark ? "text-slate-400" : "text-gray-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-6">
                {/* Template Info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Template Name *
                    </label>
                    <input
                      type="text"
                      value={templateForm.name}
                      onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                      className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                      placeholder="Standard Picker Checklist"
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Equipment Type
                    </label>
                    <select
                      value={templateForm.equipmentType}
                      onChange={(e) => setTemplateForm({ ...templateForm, equipmentType: e.target.value })}
                      className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
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
                    <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Set as default template for this equipment type
                    </span>
                  </label>
                </div>

                {/* Checklist Items */}
                <div>
                  <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>
                    Checklist Items ({templateForm.items.length})
                  </h3>

                  {/* Items List */}
                  {templateForm.items.length > 0 && (
                    <div className="space-y-3 mb-4">
                      {templateForm.items.map((item, idx) => (
                        <div
                          key={item.id}
                          className={`p-4 rounded-lg ${isDark ? "bg-slate-700/50 border border-slate-600" : "bg-gray-50 border border-gray-200"}`}
                        >
                          {/* Header row with question and controls */}
                          <div className="flex items-start gap-3">
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 ${isDark ? "bg-slate-600 text-slate-300" : "bg-gray-200 text-gray-600"}`}>
                              {idx + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <input
                                type="text"
                                value={item.question}
                                onChange={(e) => handleUpdateItem(item.id, "question", e.target.value)}
                                className={`w-full px-2 py-1 text-sm border rounded focus:outline-none ${isDark ? "bg-slate-800 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"}`}
                              />
                              <input
                                type="text"
                                value={item.description || ""}
                                onChange={(e) => handleUpdateItem(item.id, "description", e.target.value)}
                                placeholder="Description (optional)"
                                className={`w-full px-2 py-1 text-xs mt-1 border rounded focus:outline-none ${isDark ? "bg-slate-800 border-slate-600 text-slate-400 placeholder-slate-500" : "bg-white border-gray-200 text-gray-600 placeholder-gray-400"}`}
                              />
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <input
                                type="number"
                                value={item.minimumSeconds}
                                onChange={(e) => handleUpdateItem(item.id, "minimumSeconds", parseInt(e.target.value) || 5)}
                                min={5}
                                max={300}
                                className={`w-16 px-2 py-1 text-sm text-center border rounded focus:outline-none ${isDark ? "bg-slate-800 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"}`}
                              />
                              <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>sec</span>
                            </div>
                            <div className="flex flex-col gap-1 flex-shrink-0">
                              <button
                                onClick={() => handleMoveItem(item.id, "up")}
                                disabled={idx === 0}
                                className={`p-1 rounded transition-colors disabled:opacity-30 ${isDark ? "hover:bg-slate-600" : "hover:bg-gray-200"}`}
                              >
                                <svg className={`w-4 h-4 ${isDark ? "text-slate-400" : "text-gray-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                </svg>
                              </button>
                              <button
                                onClick={() => handleMoveItem(item.id, "down")}
                                disabled={idx === templateForm.items.length - 1}
                                className={`p-1 rounded transition-colors disabled:opacity-30 ${isDark ? "hover:bg-slate-600" : "hover:bg-gray-200"}`}
                              >
                                <svg className={`w-4 h-4 ${isDark ? "text-slate-400" : "text-gray-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                            </div>
                            <button
                              onClick={() => handleRemoveItem(item.id)}
                              className={`p-1 rounded transition-colors flex-shrink-0 ${isDark ? "hover:bg-red-500/20 text-slate-400 hover:text-red-400" : "hover:bg-red-50 text-gray-400 hover:text-red-600"}`}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>

                          {/* Response type and damage reporting options */}
                          <div className={`mt-3 pt-3 border-t grid grid-cols-1 md:grid-cols-4 gap-3 ${isDark ? "border-slate-600" : "border-gray-200"}`}>
                            <div>
                              <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                Response Type
                              </label>
                              <select
                                value={item.responseType || "yes_no"}
                                onChange={(e) => handleUpdateItem(item.id, "responseType", e.target.value)}
                                className={`w-full px-2 py-1.5 text-xs border rounded focus:outline-none ${isDark ? "bg-slate-800 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"}`}
                              >
                                <option value="yes_no">Yes / No</option>
                                <option value="yes_no_na">Yes / No / N/A</option>
                                <option value="condition_report">Condition Report</option>
                              </select>
                            </div>
                            <div>
                              <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                Expected Answer
                              </label>
                              <select
                                value={item.expectedAnswer || "yes"}
                                onChange={(e) => handleUpdateItem(item.id, "expectedAnswer", e.target.value)}
                                className={`w-full px-2 py-1.5 text-xs border rounded focus:outline-none ${isDark ? "bg-slate-800 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"}`}
                              >
                                <option value="yes">Yes = Pass</option>
                                <option value="no">No = Pass</option>
                              </select>
                            </div>
                            <div>
                              <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                Require Details
                              </label>
                              <select
                                value={item.requiresDetailsOn || "never"}
                                onChange={(e) => handleUpdateItem(item.id, "requiresDetailsOn", e.target.value)}
                                className={`w-full px-2 py-1.5 text-xs border rounded focus:outline-none ${isDark ? "bg-slate-800 border-slate-600 text-white" : "bg-white border-gray-200 text-gray-900"}`}
                              >
                                <option value="never">Never</option>
                                <option value="no">When "No" is selected</option>
                                <option value="yes">When "Yes" is selected</option>
                                {(item.responseType === "yes_no_na") && <option value="na">When "N/A" is selected</option>}
                                <option value="always">Always required</option>
                              </select>
                            </div>
                            <div>
                              <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                Details Prompt
                              </label>
                              <input
                                type="text"
                                value={item.detailsPrompt || ""}
                                onChange={(e) => handleUpdateItem(item.id, "detailsPrompt", e.target.value)}
                                placeholder="Describe the issue..."
                                disabled={item.requiresDetailsOn === "never"}
                                className={`w-full px-2 py-1.5 text-xs border rounded focus:outline-none disabled:opacity-50 ${isDark ? "bg-slate-800 border-slate-600 text-white placeholder-slate-500" : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"}`}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add New Item */}
                  <div className={`p-4 rounded-lg border-2 border-dashed ${isDark ? "border-slate-600" : "border-gray-300"}`}>
                    <p className={`text-sm font-medium mb-3 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Add New Item</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input
                        type="text"
                        value={newItem.question}
                        onChange={(e) => setNewItem({ ...newItem, question: e.target.value })}
                        placeholder="Question / Check item *"
                        className={`px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white placeholder-slate-500 focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500"}`}
                      />
                      <input
                        type="text"
                        value={newItem.description}
                        onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                        placeholder="Description (optional)"
                        className={`px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white placeholder-slate-500 focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500"}`}
                      />
                    </div>

                    {/* Response type and damage options for new item */}
                    <div className={`grid grid-cols-1 md:grid-cols-4 gap-3 mt-3 pt-3 border-t ${isDark ? "border-slate-600" : "border-gray-200"}`}>
                      <div>
                        <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          Response Type
                        </label>
                        <select
                          value={newItem.responseType}
                          onChange={(e) => setNewItem({ ...newItem, responseType: e.target.value })}
                          className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        >
                          <option value="yes_no">Yes / No</option>
                          <option value="yes_no_na">Yes / No / N/A</option>
                          <option value="condition_report">Condition Report</option>
                        </select>
                      </div>
                      <div>
                        <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          Expected Answer
                        </label>
                        <select
                          value={newItem.expectedAnswer}
                          onChange={(e) => setNewItem({ ...newItem, expectedAnswer: e.target.value })}
                          className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        >
                          <option value="yes">Yes = Pass</option>
                          <option value="no">No = Pass</option>
                        </select>
                      </div>
                      <div>
                        <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          Require Details
                        </label>
                        <select
                          value={newItem.requiresDetailsOn}
                          onChange={(e) => setNewItem({ ...newItem, requiresDetailsOn: e.target.value })}
                          className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        >
                          <option value="never">Never</option>
                          <option value="no">When "No" is selected</option>
                          <option value="yes">When "Yes" is selected</option>
                          {newItem.responseType === "yes_no_na" && <option value="na">When "N/A" is selected</option>}
                          <option value="always">Always required</option>
                        </select>
                      </div>
                      <div>
                        <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          Details Prompt
                        </label>
                        <input
                          type="text"
                          value={newItem.detailsPrompt}
                          onChange={(e) => setNewItem({ ...newItem, detailsPrompt: e.target.value })}
                          placeholder="Describe the issue..."
                          disabled={newItem.requiresDetailsOn === "never"}
                          className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none disabled:opacity-50 ${isDark ? "bg-slate-900/50 border-slate-600 text-white placeholder-slate-500 focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500"}`}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-4 mt-3">
                      <div className="flex items-center gap-2">
                        <label className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Min. time:</label>
                        <input
                          type="number"
                          value={newItem.minimumSeconds}
                          onChange={(e) => setNewItem({ ...newItem, minimumSeconds: parseInt(e.target.value) || 5 })}
                          min={5}
                          max={300}
                          className={`w-20 px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        />
                        <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>seconds</span>
                      </div>
                      <button
                        onClick={handleAddItem}
                        disabled={!newItem.question.trim()}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${isDark ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30" : "bg-blue-50 text-blue-600 hover:bg-blue-100"}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add Item
                      </button>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-4 border-t border-slate-700">
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewTemplate(false);
                      setEditingTemplate(null);
                    }}
                    className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                  >
                    {editingTemplate ? "Update Template" : "Create Template"}
                  </button>
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
