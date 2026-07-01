"use client";

import { Id } from "@/convex/_generated/dataModel";
import { useEquipment } from "./EquipmentContext";

export default function ScannerPickerGrid() {
  const {
    activeTab, scanners, pickers, getStatusColor, canEditEquipment, isSuperuser,
    openHistoryModal, handleEdit, openAssignModal, openReassignModal, openReturnModal,
    openRetireModal, openDeleteModal, openSafetyHistoryModal, openQRModal,
  } = useEquipment();

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {(activeTab === "scanners" ? scanners : pickers)?.map((item) => (
        <div
          key={item._id}
          className="theme-card p-5"
        >
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="min-w-14 h-14 px-3 rounded-lg flex items-center justify-center text-lg font-bold shrink-0 theme-card">
                #{item.number}
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold truncate theme-text-primary">
                  {activeTab === "scanners" ? "Scanner" : "Picker"} #{item.number}
                </h3>
                <p className="text-sm mt-0.5 theme-text-secondary">
                  {item.locationName}
                </p>
              </div>
            </div>
            <span className={`px-2.5 py-1 text-xs font-medium rounded shrink-0 ${getStatusColor(item.status)}`}>
              {item.status}
            </span>
          </div>

          {item.pin && (
            <div className="text-sm mb-2 theme-text-secondary">
              <span className="theme-text-tertiary">PIN:</span> {item.pin}
            </div>
          )}

          {item.assignedPersonName && (
            <div className="text-sm mb-2 theme-text-secondary">
              <span className="theme-text-tertiary">Assigned to:</span> {item.assignedPersonName}
            </div>
          )}

          {item.model && (
            <div className="text-sm mb-2 theme-text-secondary">
              <span className="theme-text-tertiary">Model:</span> {item.model}
            </div>
          )}

          {item.serialNumber && (
            <div className="text-sm mb-2 theme-text-secondary">
              <span className="theme-text-tertiary">S/N:</span> {item.serialNumber}
            </div>
          )}

          {item.notes && (
            <p className="text-sm mt-2 theme-text-tertiary">
              {item.notes}
            </p>
          )}

          {item.conditionNotes && (
            <div className="text-sm mt-2 p-2 rounded ui-callout-amber">
              <span className="font-medium">Condition:</span> {item.conditionNotes}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t theme-border-secondary">
            <button
              onClick={() => openHistoryModal(item)}
              className="px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1 theme-btn-secondary"
              title="View History"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              History
            </button>
            {canEditEquipment && (
              <button
                onClick={() => handleEdit(item)}
                className="px-3 py-1.5 text-xs font-medium rounded transition-colors theme-btn-secondary"
              >
                Edit
              </button>
            )}
            {canEditEquipment && item.status === "available" && (
              <button
                onClick={() => openAssignModal(item)}
                className="px-3 py-1.5 text-xs font-medium rounded transition-colors theme-btn-primary"
              >
                Assign
              </button>
            )}
            {canEditEquipment && item.status === "assigned" && (
              <>
                <button
                  onClick={() => openReassignModal(item)}
                  className="px-3 py-1.5 text-xs font-medium rounded transition-colors theme-accent-primary"
                >
                  Reassign
                </button>
                <button
                  onClick={() => openReturnModal(item)}
                  className="px-3 py-1.5 text-xs font-medium rounded transition-colors theme-btn-secondary"
                >
                  Return
                </button>
              </>
            )}
            {canEditEquipment && item.status !== "retired" && (
              <button
                onClick={() => openRetireModal(item._id as Id<"scanners"> | Id<"pickers">)}
                className="px-3 py-1.5 text-xs font-medium rounded transition-colors ui-btn-danger"
              >
                Retire
              </button>
            )}
            {isSuperuser && (
              <button
                onClick={() => openDeleteModal(item)}
                className="px-3 py-1.5 text-xs font-medium rounded transition-colors ui-btn-danger"
                title="Permanently delete (Superuser only)"
              >
                Delete
              </button>
            )}
            {activeTab === "pickers" && (
              <>
                <button
                  onClick={() => openSafetyHistoryModal(item as NonNullable<typeof pickers>[0])}
                  className="px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1 theme-btn-secondary"
                  title="Safety Check History"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  Safety
                </button>
                <button
                  onClick={() => openQRModal(item as NonNullable<typeof pickers>[0])}
                  className="px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1 theme-btn-secondary"
                  title="Safety Check QR Code"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h2M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                  </svg>
                  QR
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
