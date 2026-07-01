"use client";

import SignaturePad from "@/components/SignaturePad";
import { EQUIPMENT_VALUE, useEquipment } from "../EquipmentContext";

export default function ReassignModal() {
  const {
    showReassignModal, activeTab, reassignEquipmentData, reassignStep, setReassignStep,
    reassignChecklist, setReassignChecklist, reassignOverallCondition, setReassignOverallCondition,
    reassignDamageNotes, setReassignDamageNotes, reassignRepairRequired, setReassignRepairRequired,
    reassignDeductionRequired, setReassignDeductionRequired, reassignDeductionAmount, setReassignDeductionAmount,
    reassignSignOffSignature, setReassignSignOffSignature, reassignNewPersonnelId, setReassignNewPersonnelId,
    reassignNewPersonnelSignature, setReassignNewPersonnelSignature, activePersonnel,
    getReassignAgreementText, handleReassign,
    setShowReassignModal, setReassignEquipmentId, setReassignEquipmentData,
  } = useEquipment();

  if (!showReassignModal) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="theme-card p-4 sm:p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold theme-text-primary">
              Reassign {activeTab === "scanners" ? "Scanner" : "Picker"} #{reassignEquipmentData?.number}
            </h2>
            <p className="text-sm mt-1 theme-text-tertiary">
              Step {reassignStep === "condition" ? "1" : "2"} of 2: {reassignStep === "condition" ? "Condition Check & Sign-off" : "New Assignment"}
            </p>
          </div>
          <button
            onClick={() => {
              setShowReassignModal(false);
              setReassignEquipmentId(null);
              setReassignEquipmentData(null);
            }}
            className="p-1 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          >
            <svg className="w-5 h-5 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Current Assignee Info */}
        <div className="mb-4 p-3 rounded-lg border border-purple-500/30 bg-purple-500/10 dark:bg-purple-500/10">
          <p className="text-sm text-purple-600 dark:text-purple-400">
            <span className="font-medium">Currently assigned to:</span> {reassignEquipmentData?.assignedPersonName || "Unknown"}
          </p>
        </div>

        {reassignStep === "condition" ? (
          <div className="space-y-6">
            {/* Condition Checklist */}
            <div>
              <h3 className="text-sm font-semibold mb-3 theme-text-primary">
                Condition Checklist
              </h3>
              <p className="text-xs mb-3 theme-text-tertiary">
                Verify the condition of the equipment before reassigning to a new user.
              </p>
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
                      reassignChecklist[item.key as keyof typeof reassignChecklist]
                        ? "bg-green-500/10 border-green-500/30"
                        : "bg-red-500/10 border-red-500/30"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={reassignChecklist[item.key as keyof typeof reassignChecklist]}
                      onChange={(e) => setReassignChecklist({ ...reassignChecklist, [item.key]: e.target.checked })}
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
                value={reassignOverallCondition}
                onChange={(e) => setReassignOverallCondition(e.target.value)}
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
                value={reassignDamageNotes}
                onChange={(e) => setReassignDamageNotes(e.target.value)}
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
                  checked={reassignRepairRequired}
                  onChange={(e) => setReassignRepairRequired(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm theme-text-secondary">
                  Repair required (cannot reassign if checked)
                </span>
              </label>

              <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer theme-border-secondary">
                <input
                  type="checkbox"
                  checked={reassignDeductionRequired}
                  onChange={(e) => setReassignDeductionRequired(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm theme-text-secondary">
                  Pay deduction required for damage
                </span>
              </label>

              {reassignDeductionRequired && (
                <div className="ml-7">
                  <label className="block text-sm font-medium mb-2 theme-text-secondary">
                    Deduction Amount
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="theme-text-tertiary">$</span>
                    <input
                      type="number"
                      value={reassignDeductionAmount}
                      onChange={(e) => setReassignDeductionAmount(Math.min(EQUIPMENT_VALUE, Math.max(0, Number(e.target.value))))}
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

            {/* Manager Sign-off Signature */}
            <div>
              <h3 className="text-sm font-semibold mb-2 theme-text-primary">
                Manager Sign-off
              </h3>
              <p className="text-xs mb-2 theme-text-tertiary">
                Sign below to confirm the condition check of this equipment.
              </p>
              <SignaturePad
                onSignatureChange={setReassignSignOffSignature}
                width={500}
                height={120}
                label="Manager Signature"
              />
            </div>

            <div className="flex gap-3 pt-4 border-t theme-border-secondary">
              <button
                type="button"
                onClick={() => {
                  setShowReassignModal(false);
                  setReassignEquipmentId(null);
                  setReassignEquipmentData(null);
                }}
                className="flex-1 px-4 py-3 font-medium rounded-lg transition-colors theme-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setReassignStep("assign")}
                disabled={!reassignSignOffSignature || reassignRepairRequired}
                className="flex-1 px-4 py-3 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed theme-btn-primary"
              >
                {reassignRepairRequired ? "Cannot Reassign (Repair Required)" : "Continue to Assignment"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Condition Summary */}
            <div className="p-3 rounded-lg theme-card">
              <p className="text-sm theme-text-secondary">
                <span className="font-medium">Condition verified:</span> {reassignOverallCondition}
                {reassignDamageNotes && ` - ${reassignDamageNotes}`}
              </p>
            </div>

            {/* Select New Assignee */}
            <div>
              <label className="block text-sm font-medium mb-2 theme-text-secondary">
                Assign to New Employee *
              </label>
              <select
                value={reassignNewPersonnelId}
                onChange={(e) => {
                  setReassignNewPersonnelId(e.target.value);
                  setReassignNewPersonnelSignature(null);
                }}
                className="theme-input w-full px-4 py-3"
              >
                <option value="">Select an employee</option>
                {activePersonnel
                  ?.slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((person) => (
                  <option key={person._id} value={person._id}>
                    {person.name} - {person.position} ({person.department})
                  </option>
                ))}
              </select>
            </div>

            {reassignNewPersonnelId && (
              <>
                {/* Equipment Agreement */}
                <div className="p-4 rounded-lg border max-h-48 overflow-y-auto theme-card">
                  <pre className="text-xs whitespace-pre-wrap font-mono theme-text-secondary">
                    {getReassignAgreementText()}
                  </pre>
                </div>

                {/* New Employee Signature */}
                <div>
                  <label className="block text-sm font-medium mb-2 theme-text-secondary">
                    New Employee Signature *
                  </label>
                  <p className="text-xs mb-2 theme-text-tertiary">
                    Have the new employee sign below to acknowledge the equipment responsibility agreement.
                  </p>
                  <SignaturePad
                    onSignatureChange={setReassignNewPersonnelSignature}
                    width={500}
                    height={120}
                  />
                </div>
              </>
            )}

            <div className="flex gap-3 pt-4 border-t theme-border-secondary">
              <button
                type="button"
                onClick={() => {
                  setReassignStep("condition");
                  setReassignNewPersonnelSignature(null);
                }}
                className="flex-1 px-4 py-3 font-medium rounded-lg transition-colors theme-btn-secondary"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleReassign}
                disabled={!reassignNewPersonnelId || !reassignNewPersonnelSignature}
                className="flex-1 px-4 py-3 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed theme-btn-primary"
              >
                Complete Reassignment
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
