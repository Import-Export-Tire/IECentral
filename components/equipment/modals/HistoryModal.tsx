"use client";

import { useEquipment } from "../EquipmentContext";

export default function HistoryModal() {
  const {
    showHistoryModal, historyEquipmentId, activeTab, historyEquipmentNumber,
    equipmentHistory, setShowHistoryModal, setHistoryEquipmentId, setHistoryEquipmentNumber,
  } = useEquipment();

  if (!(showHistoryModal && historyEquipmentId)) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="theme-card p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold theme-text-primary">
            {activeTab === "scanners" ? "Scanner" : "Picker"} #{historyEquipmentNumber} - History
          </h2>
          <button
            onClick={() => {
              setShowHistoryModal(false);
              setHistoryEquipmentId(null);
              setHistoryEquipmentNumber("");
            }}
            className="p-1 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          >
            <svg className="w-5 h-5 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!equipmentHistory ? (
          <div className="text-center py-12 theme-text-tertiary">
            Loading...
          </div>
        ) : equipmentHistory.length === 0 ? (
          <div className="text-center py-12 theme-text-tertiary">
            <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>No history recorded for this equipment</p>
          </div>
        ) : (
          <div className="space-y-3">
            {equipmentHistory.map((record) => (
              <div
                key={record._id}
                className="rounded-lg p-4 theme-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      record.action === "assigned"
                        ? "bg-green-500/20 text-green-400"
                        : record.action === "unassigned"
                        ? "bg-amber-500/20 text-amber-400"
                        : record.action === "status_change"
                        ? "bg-blue-500/20 text-blue-400"
                        : record.action === "condition_check"
                        ? "bg-purple-500/20 text-purple-400"
                        : "bg-slate-500/20 text-slate-400"
                    }`}>
                      {record.action === "assigned" ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                        </svg>
                      ) : record.action === "unassigned" ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" />
                        </svg>
                      ) : record.action === "status_change" ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-sm theme-text-primary">
                        {record.action === "assigned" && "Assigned"}
                        {record.action === "unassigned" && "Returned/Unassigned"}
                        {record.action === "status_change" && "Status Changed"}
                        {record.action === "condition_check" && "Condition Check"}
                      </p>
                      <p className="text-xs mt-0.5 theme-text-tertiary">
                        {new Date(record.createdAt).toLocaleDateString()} at {new Date(record.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <span className={`ui-badge shrink-0 ${
                    record.action === "assigned"
                      ? "ui-badge-green"
                      : record.action === "unassigned"
                      ? "ui-badge-amber"
                      : "ui-badge-blue"
                  }`}>
                    {record.action.replace("_", " ")}
                  </span>
                </div>

                <div className="mt-3 text-sm space-y-1 theme-text-secondary">
                  {record.previousAssigneeName && (
                    <p>
                      <span className="theme-text-tertiary">From:</span>{" "}
                      {record.previousAssigneeName}
                    </p>
                  )}
                  {record.newAssigneeName && (
                    <p>
                      <span className="theme-text-tertiary">To:</span>{" "}
                      {record.newAssigneeName}
                    </p>
                  )}
                  {record.previousStatus && record.newStatus && record.previousStatus !== record.newStatus && (
                    <p>
                      <span className="theme-text-tertiary">Status:</span>{" "}
                      {record.previousStatus} → {record.newStatus}
                    </p>
                  )}
                  {record.notes && (
                    <p className="theme-text-secondary">
                      {record.notes}
                    </p>
                  )}
                  <p className="text-xs theme-text-tertiary">
                    By: {record.performedByName}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6">
          <button
            onClick={() => {
              setShowHistoryModal(false);
              setHistoryEquipmentId(null);
              setHistoryEquipmentNumber("");
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
