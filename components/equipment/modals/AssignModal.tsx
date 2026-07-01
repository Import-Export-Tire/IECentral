"use client";

import SignaturePad from "@/components/SignaturePad";
import { useEquipment } from "../EquipmentContext";

export default function AssignModal() {
  const {
    showAssignModal, activeTab, assignEquipmentData, assignStep, setAssignStep,
    selectedPersonnelId, setSelectedPersonnelId, activePersonnel, getAgreementText,
    signatureData, setSignatureData, handleAssign,
    setShowAssignModal, setAssignEquipmentId, setAssignEquipmentData,
  } = useEquipment();

  if (!showAssignModal) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="theme-card p-4 sm:p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold theme-text-primary">
            Assign {activeTab === "scanners" ? "Scanner" : "Picker"} #{assignEquipmentData?.number}
          </h2>
          <button
            onClick={() => {
              setShowAssignModal(false);
              setAssignEquipmentId(null);
              setAssignEquipmentData(null);
              setSelectedPersonnelId("");
              setSignatureData(null);
              setAssignStep("select");
            }}
            className="p-1 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          >
            <svg className="w-5 h-5 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {assignStep === "select" ? (
          <>
            <p className="text-sm mb-4 theme-text-tertiary">
              Select an employee to assign this equipment. They will need to sign an equipment responsibility agreement.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2 theme-text-secondary">
                  Assign to Employee *
                </label>
                <select
                  value={selectedPersonnelId}
                  onChange={(e) => setSelectedPersonnelId(e.target.value)}
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

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowAssignModal(false);
                    setAssignEquipmentId(null);
                    setAssignEquipmentData(null);
                    setSelectedPersonnelId("");
                  }}
                  className="flex-1 px-4 py-3 font-medium rounded-lg transition-colors theme-btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setAssignStep("sign")}
                  disabled={!selectedPersonnelId}
                  className="flex-1 px-4 py-3 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed theme-btn-primary"
                >
                  Continue to Agreement
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 p-3 rounded-lg theme-card">
              <p className="text-sm font-medium theme-accent-primary">
                Assigning to: {activePersonnel?.find(p => p._id === selectedPersonnelId)?.name}
              </p>
            </div>

            <div className="mb-4 p-4 rounded-lg border max-h-64 overflow-y-auto theme-card">
              <pre className="text-xs whitespace-pre-wrap font-mono theme-text-secondary">
                {getAgreementText()}
              </pre>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2 theme-text-secondary">
                Employee Signature *
              </label>
              <p className="text-xs mb-2 theme-text-tertiary">
                Have the employee sign below to acknowledge the equipment responsibility agreement.
              </p>
              <SignaturePad
                onSignatureChange={setSignatureData}
                width={500}
                height={150}
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => {
                  setAssignStep("select");
                  setSignatureData(null);
                }}
                className="flex-1 px-4 py-3 font-medium rounded-lg transition-colors theme-btn-secondary"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleAssign}
                disabled={!signatureData}
                className="flex-1 px-4 py-3 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed theme-btn-primary"
              >
                Assign Equipment
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
