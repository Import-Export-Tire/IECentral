"use client";

import { useEquipment } from "../EquipmentContext";

export default function RetireModal() {
  const {
    showRetireModal, activeTab, retireReason, setRetireReason, handleRetire,
    setShowRetireModal, setRetireId,
  } = useEquipment();

  if (!showRetireModal) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="theme-card p-4 sm:p-6 w-full max-w-md">
        <h2 className="text-xl font-semibold mb-4 theme-text-primary">
          Retire {activeTab === "scanners" ? "Scanner" : "Picker"}
        </h2>
        <p className="text-sm mb-4 theme-text-tertiary">
          This will mark the equipment as retired and remove any current assignment. This action cannot be undone.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2 theme-text-secondary">
              Reason for Retirement *
            </label>
            <textarea
              value={retireReason}
              onChange={(e) => setRetireReason(e.target.value)}
              rows={3}
              className="theme-input w-full px-4 py-3 resize-none"
              placeholder="e.g., Damaged beyond repair, obsolete model, lost"
              required
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => {
                setShowRetireModal(false);
                setRetireId(null);
                setRetireReason("");
              }}
              className="flex-1 px-4 py-3 font-medium rounded-lg transition-colors theme-btn-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRetire}
              disabled={!retireReason.trim()}
              className="flex-1 px-4 py-3 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ui-btn-danger"
            >
              Retire Equipment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
