"use client";

import { useEquipment } from "../EquipmentContext";

export default function SafetyHistoryModal() {
  const {
    showSafetyHistoryModal, safetyHistoryEquipment, safetyCompletions,
    setShowSafetyHistoryModal, setSafetyHistoryEquipment,
  } = useEquipment();

  if (!(showSafetyHistoryModal && safetyHistoryEquipment)) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="theme-card p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold theme-text-primary">
            Safety Check History - Picker #{safetyHistoryEquipment.number}
          </h2>
          <button
            onClick={() => {
              setShowSafetyHistoryModal(false);
              setSafetyHistoryEquipment(null);
            }}
            className="p-1 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          >
            <svg className="w-5 h-5 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!safetyCompletions ? (
          <div className="text-center py-12 theme-text-tertiary">
            Loading...
          </div>
        ) : safetyCompletions.length === 0 ? (
          <div className="text-center py-12 theme-text-tertiary">
            <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <p>No safety checks recorded for this picker</p>
          </div>
        ) : (
          <div className="space-y-3">
            {safetyCompletions.map((completion) => (
              <div
                key={completion._id}
                className="rounded-lg p-4 theme-card"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      completion.allPassed
                        ? "bg-green-500/20 text-green-400"
                        : "bg-red-500/20 text-red-400"
                    }`}>
                      {completion.allPassed ? (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-sm theme-text-primary">
                        {completion.personnelName}
                      </p>
                      <p className="text-xs theme-text-tertiary">
                        {new Date(completion.completedAt).toLocaleDateString()} at {new Date(completion.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <span className={`ui-badge ${
                    completion.allPassed
                      ? "ui-badge-green"
                      : "ui-badge-red"
                  }`}>
                    {completion.allPassed ? "Passed" : "Issues"}
                  </span>
                </div>

                <div className="text-xs theme-text-tertiary">
                  <span className="font-medium">Duration:</span> {Math.floor(completion.totalTimeSpent / 60)}m {completion.totalTimeSpent % 60}s
                  <span className="mx-2">•</span>
                  <span className="font-medium">Items:</span> {completion.responses.length}
                </div>

                {completion.issues && completion.issues.length > 0 && (
                  <div className="mt-2 pt-2 border-t theme-border-secondary">
                    <p className="text-xs font-medium mb-1 text-red-600 dark:text-red-400">Issues:</p>
                    {completion.issues.map((issue: { itemId: string; description: string }, idx: number) => (
                      <p key={idx} className="text-xs theme-text-secondary">
                        • {issue.description}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-6">
          <button
            onClick={() => {
              setShowSafetyHistoryModal(false);
              setSafetyHistoryEquipment(null);
            }}
            className="w-full px-4 py-3 font-medium rounded-lg transition-colors theme-btn-secondary"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
