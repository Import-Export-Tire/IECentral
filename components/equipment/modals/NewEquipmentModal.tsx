"use client";

import { useEquipment } from "../EquipmentContext";

export default function NewEquipmentModal() {
  const {
    showNewEquipment, activeTab, editingId, handleSubmit, formData, setFormData,
    locations, EQUIPMENT_STATUS_OPTIONS, setShowNewEquipment, setEditingId, resetForm,
  } = useEquipment();

  if (!showNewEquipment) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="theme-card p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-semibold mb-4 theme-text-primary">
          {editingId ? `Edit ${activeTab === "scanners" ? "Scanner" : "Picker"}` : `Add New ${activeTab === "scanners" ? "Scanner" : "Picker"}`}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2 theme-text-secondary">
                Identifier *
              </label>
              <input
                type="text"
                value={formData.number}
                onChange={(e) => setFormData({ ...formData, number: e.target.value })}
                className="theme-input w-full px-4 py-3"
                required
                placeholder="e.g., 1, A-12, SC-001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 theme-text-secondary">
                PIN
              </label>
              <input
                type="text"
                value={formData.pin}
                onChange={(e) => setFormData({ ...formData, pin: e.target.value })}
                className="theme-input w-full px-4 py-3"
                placeholder="1234"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 theme-text-secondary">
              Location *
            </label>
            <select
              value={formData.locationId}
              onChange={(e) => setFormData({ ...formData, locationId: e.target.value })}
              className="theme-input w-full px-4 py-3"
              required
            >
              <option value="">Select a location</option>
              {locations?.map((loc) => (
                <option key={loc._id} value={loc._id}>{loc.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 theme-text-secondary">
              Model
            </label>
            <input
              type="text"
              value={formData.model}
              onChange={(e) => setFormData({ ...formData, model: e.target.value })}
              className="theme-input w-full px-4 py-3"
              placeholder="e.g., Zebra TC52"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 theme-text-secondary">
              Serial Number
            </label>
            <input
              type="text"
              value={formData.serialNumber}
              onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
              className="theme-input w-full px-4 py-3"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 theme-text-secondary">
              Purchase Date
            </label>
            <input
              type="date"
              value={formData.purchaseDate}
              onChange={(e) => setFormData({ ...formData, purchaseDate: e.target.value })}
              className="theme-input w-full px-4 py-3"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 theme-text-secondary">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={2}
              className="theme-input w-full px-4 py-3 resize-none"
              placeholder="General notes about this equipment"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 theme-text-secondary">
              Condition Notes
            </label>
            <textarea
              value={formData.conditionNotes}
              onChange={(e) => setFormData({ ...formData, conditionNotes: e.target.value })}
              rows={2}
              className="theme-input w-full px-4 py-3 resize-none"
              placeholder="Current condition (e.g., screen scratched, battery weak)"
            />
          </div>

          {editingId && (
            <div>
              <label className="block text-sm font-medium mb-2 theme-text-secondary">
                Status
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="theme-input w-full px-4 py-3"
              >
                {EQUIPMENT_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => {
                setShowNewEquipment(false);
                setEditingId(null);
                resetForm();
              }}
              className="flex-1 px-4 py-3 font-medium rounded-lg transition-colors theme-btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-3 font-medium rounded-lg transition-colors theme-btn-primary"
            >
              {editingId ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
