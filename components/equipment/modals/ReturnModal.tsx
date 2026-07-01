"use client";

import { EQUIPMENT_VALUE, useEquipment } from "../EquipmentContext";

export default function ReturnModal() {
  const {
    showReturnModal, activeTab, returnEquipmentData, checklist, setChecklist,
    overallCondition, setOverallCondition, damageNotes, setDamageNotes,
    repairRequired, setRepairRequired, readyForReassignment, setReadyForReassignment,
    deductionRequired, setDeductionRequired, deductionAmount, setDeductionAmount,
    handleReturn, setShowReturnModal, setReturnEquipmentId, setReturnEquipmentData,
  } = useEquipment();

  if (!showReturnModal) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="theme-card p-4 sm:p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold theme-text-primary">
            Return {activeTab === "scanners" ? "Scanner" : "Picker"} #{returnEquipmentData?.number}
          </h2>
          <button
            onClick={() => {
              setShowReturnModal(false);
              setReturnEquipmentId(null);
              setReturnEquipmentData(null);
            }}
            className="p-1 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          >
            <svg className="w-5 h-5 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-4 p-3 rounded-lg ui-callout-amber">
          <p className="text-sm text-amber-600 dark:text-amber-400">
            <span className="font-medium">Returning from:</span> {returnEquipmentData?.assignedPersonName || "Unknown"}
          </p>
        </div>

        <div className="space-y-6">
          {/* Condition Checklist */}
          <div>
            <h3 className="text-sm font-semibold mb-3 theme-text-primary">
              Condition Checklist
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { key: "physicalCondition", label: "No physical damage" },
                { key: "screenFunctional", label: "Screen works properly" },
                { key: "buttonsWorking", label: "All buttons responsive" },
                { key: "batteryCondition", label: "Battery holds charge" },
                { key: "chargingPortOk", label: "Charging port undamaged" },
                { key: "scannerFunctional", label: "Scanning works" },
                { key: "cleanCondition", label: "Equipment is clean" },
              ].map((item) => (
                <label
                  key={item.key}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    checklist[item.key as keyof typeof checklist]
                      ? "bg-green-500/10 border-green-500/30"
                      : "bg-red-500/10 border-red-500/30"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checklist[item.key as keyof typeof checklist]}
                    onChange={(e) => setChecklist({ ...checklist, [item.key]: e.target.checked })}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-sm theme-text-secondary">
                    {item.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Overall Condition */}
          <div>
            <label className="block text-sm font-medium mb-2 theme-text-secondary">
              Overall Condition
            </label>
            <select
              value={overallCondition}
              onChange={(e) => setOverallCondition(e.target.value)}
              className="theme-input w-full px-4 py-3"
            >
              <option value="excellent">Excellent - Like new</option>
              <option value="good">Good - Normal wear</option>
              <option value="fair">Fair - Some issues</option>
              <option value="poor">Poor - Multiple issues</option>
              <option value="damaged">Damaged - Needs repair</option>
            </select>
          </div>

          {/* Damage Notes */}
          <div>
            <label className="block text-sm font-medium mb-2 theme-text-secondary">
              Damage Notes (if any)
            </label>
            <textarea
              value={damageNotes}
              onChange={(e) => setDamageNotes(e.target.value)}
              rows={2}
              className="theme-input w-full px-4 py-3 resize-none"
              placeholder="Describe any damage or issues found..."
            />
          </div>

          {/* Toggles */}
          <div className="space-y-3">
            <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer theme-border-secondary">
              <input
                type="checkbox"
                checked={repairRequired}
                onChange={(e) => {
                  setRepairRequired(e.target.checked);
                  if (e.target.checked) setReadyForReassignment(false);
                }}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm theme-text-secondary">
                Repair required before next use
              </span>
            </label>

            <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer theme-border-secondary">
              <input
                type="checkbox"
                checked={readyForReassignment}
                onChange={(e) => setReadyForReassignment(e.target.checked)}
                disabled={repairRequired}
                className="w-4 h-4 rounded disabled:opacity-50"
              />
              <span className={`text-sm theme-text-secondary ${repairRequired ? "opacity-50" : ""}`}>
                Ready for reassignment
              </span>
            </label>

            <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer theme-border-secondary">
              <input
                type="checkbox"
                checked={deductionRequired}
                onChange={(e) => setDeductionRequired(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm theme-text-secondary">
                Pay deduction required for damage
              </span>
            </label>

            {deductionRequired && (
              <div className="ml-7">
                <label className="block text-sm font-medium mb-2 theme-text-secondary">
                  Deduction Amount
                </label>
                <div className="flex items-center gap-2">
                  <span className="theme-text-tertiary">$</span>
                  <input
                    type="number"
                    value={deductionAmount}
                    onChange={(e) => setDeductionAmount(Math.min(EQUIPMENT_VALUE, Math.max(0, Number(e.target.value))))}
                    max={EQUIPMENT_VALUE}
                    min={0}
                    className="theme-input w-32 px-4 py-2"
                  />
                  <span className="text-xs theme-text-tertiary">
                    (max ${EQUIPMENT_VALUE})
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4 border-t theme-border-secondary">
            <button
              type="button"
              onClick={() => {
                setShowReturnModal(false);
                setReturnEquipmentId(null);
                setReturnEquipmentData(null);
              }}
              className="flex-1 px-4 py-3 font-medium rounded-lg transition-colors theme-btn-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleReturn}
              className="flex-1 px-4 py-3 font-medium rounded-lg transition-colors theme-btn-primary"
            >
              Complete Return
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
