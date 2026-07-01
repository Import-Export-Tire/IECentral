"use client";

import { useEquipment } from "../EquipmentContext";

export default function DeleteModal() {
  const {
    showDeleteModal, isSuperuser, activeTab, deleteNumber, handleDelete,
    setShowDeleteModal, setDeleteId, setDeleteNumber,
  } = useEquipment();

  if (!(showDeleteModal && isSuperuser)) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="theme-card p-4 sm:p-6 w-full max-w-md">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 rounded-full bg-red-500/20 dark:bg-red-500/20">
            <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold theme-text-primary">
              Delete {activeTab === "scanners" ? "Scanner" : "Picker"}
            </h2>
            <p className="text-sm theme-text-tertiary">
              #{deleteNumber}
            </p>
          </div>
        </div>

        <div className="p-4 rounded-lg mb-4 ui-callout-red">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            Warning: This action cannot be undone!
          </p>
          <p className="text-sm mt-1 text-red-600 dark:text-red-400">
            This will permanently delete this equipment and all associated records including:
          </p>
          <ul className="text-sm mt-2 ml-4 list-disc text-red-600 dark:text-red-400">
            <li>Equipment history</li>
            <li>Signed agreements</li>
            <li>Condition check records</li>
          </ul>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              setShowDeleteModal(false);
              setDeleteId(null);
              setDeleteNumber("");
            }}
            className="flex-1 px-4 py-3 font-medium rounded-lg transition-colors theme-btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="flex-1 px-4 py-3 font-medium rounded-lg transition-colors ui-btn-danger"
          >
            Delete Permanently
          </button>
        </div>
      </div>
    </div>
  );
}
