"use client";

import { useEquipment } from "../EquipmentContext";

export default function NewComputerModal() {
  const {
    showNewComputer, editingComputerId, handleComputerSubmit, error, computerFormData,
    setComputerFormData, locations, setShowNewComputer, setEditingComputerId, resetComputerForm,
  } = useEquipment();

  if (!showNewComputer) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="theme-card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold theme-text-primary">
            {editingComputerId ? "Edit Computer" : "Add New Computer"}
          </h2>
          <button
            onClick={() => {
              setShowNewComputer(false);
              setEditingComputerId(null);
              resetComputerForm();
            }}
            className="p-1 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          >
            <svg className="w-5 h-5 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleComputerSubmit} className="space-y-6">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/20 text-red-400 text-sm border border-red-500/30">
              {error}
            </div>
          )}

          {/* Basic Information */}
          <div>
            <h3 className="text-sm font-semibold mb-3 theme-text-primary">Basic Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Identifier *</label>
                <input
                  type="text"
                  value={computerFormData.name}
                  onChange={(e) => setComputerFormData({ ...computerFormData, name: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="e.g., OFFICE-PC-01, FRONT-DESK"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Type</label>
                <select
                  value={computerFormData.type}
                  onChange={(e) => setComputerFormData({ ...computerFormData, type: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                >
                  <option value="computer">Desktop Computer</option>
                  <option value="laptop">Laptop</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Location</label>
                <select
                  value={computerFormData.locationId}
                  onChange={(e) => setComputerFormData({ ...computerFormData, locationId: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                >
                  <option value="">Select location...</option>
                  {locations?.map((loc) => (
                    <option key={loc._id} value={loc._id}>{loc.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Passwords */}
          <div>
            <h3 className="text-sm font-semibold mb-3 theme-text-primary">Passwords</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Admin Password</label>
                <input
                  type="text"
                  value={computerFormData.adminPassword}
                  onChange={(e) => setComputerFormData({ ...computerFormData, adminPassword: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="Admin account password"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">User Password</label>
                <input
                  type="text"
                  value={computerFormData.userPassword}
                  onChange={(e) => setComputerFormData({ ...computerFormData, userPassword: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="Standard user password"
                />
              </div>
            </div>
          </div>

          {/* Network */}
          <div>
            <h3 className="text-sm font-semibold mb-3 theme-text-primary">Network</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">IP Address</label>
                <input
                  type="text"
                  value={computerFormData.ipAddress}
                  onChange={(e) => setComputerFormData({ ...computerFormData, ipAddress: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="192.168.1.100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Ethernet Port (if applicable)</label>
                <input
                  type="text"
                  value={computerFormData.ethernetPort}
                  onChange={(e) => setComputerFormData({ ...computerFormData, ethernetPort: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="e.g., Port 12, Patch A-5"
                />
              </div>
            </div>
          </div>

          {/* Remote Access */}
          <div>
            <h3 className="text-sm font-semibold mb-3 theme-text-primary">Remote Access</h3>
            <div className="p-3 rounded-lg mb-4 ui-callout-amber">
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Note: Unauthenticated monitoring or remote connections are not allowed. An authentication code is required on the receiving computer to establish a connection.
              </p>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="remoteAccessEnabled"
                  checked={computerFormData.remoteAccessEnabled}
                  onChange={(e) => setComputerFormData({ ...computerFormData, remoteAccessEnabled: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-cyan-500 focus:ring-cyan-500"
                />
                <label htmlFor="remoteAccessEnabled" className="text-sm font-medium theme-text-secondary">
                  Remote Access Enabled
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 theme-text-secondary">Chrome Remote Desktop ID</label>
                  <input
                    type="text"
                    value={computerFormData.chromeRemoteId}
                    onChange={(e) => setComputerFormData({ ...computerFormData, chromeRemoteId: e.target.value })}
                    className="theme-input w-full px-3 py-2"
                    placeholder="Session ID"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 theme-text-secondary">Remote Access Code</label>
                  <input
                    type="text"
                    value={computerFormData.remoteAccessCode}
                    onChange={(e) => setComputerFormData({ ...computerFormData, remoteAccessCode: e.target.value })}
                    className="theme-input w-full px-3 py-2"
                    placeholder="PIN or access code"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Remote Connection Notes</label>
                <textarea
                  value={computerFormData.remoteAccessNotes}
                  onChange={(e) => setComputerFormData({ ...computerFormData, remoteAccessNotes: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  rows={2}
                  placeholder="Additional info for connecting remotely..."
                />
              </div>
            </div>
          </div>

          {/* Hardware Details (Optional) */}
          <div>
            <h3 className="text-sm font-semibold mb-3 theme-text-primary">Hardware Details (Optional)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Manufacturer</label>
                <input
                  type="text"
                  value={computerFormData.manufacturer}
                  onChange={(e) => setComputerFormData({ ...computerFormData, manufacturer: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="Dell, HP, Lenovo..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Model</label>
                <input
                  type="text"
                  value={computerFormData.model}
                  onChange={(e) => setComputerFormData({ ...computerFormData, model: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="OptiPlex 7080"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Serial Number</label>
                <input
                  type="text"
                  value={computerFormData.serialNumber}
                  onChange={(e) => setComputerFormData({ ...computerFormData, serialNumber: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="Service tag / Serial #"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Operating System</label>
                <select
                  value={computerFormData.operatingSystem}
                  onChange={(e) => setComputerFormData({ ...computerFormData, operatingSystem: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                >
                  <option value="">Select...</option>
                  <option value="Windows 11">Windows 11</option>
                  <option value="Windows 10">Windows 10</option>
                  <option value="macOS">macOS</option>
                  <option value="Linux">Linux</option>
                  <option value="Chrome OS">Chrome OS</option>
                </select>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium mb-1 theme-text-secondary">Notes</label>
            <textarea
              value={computerFormData.notes}
              onChange={(e) => setComputerFormData({ ...computerFormData, notes: e.target.value })}
              className="theme-input w-full px-3 py-2"
              rows={3}
              placeholder="Any additional notes..."
            />
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={() => {
                setShowNewComputer(false);
                setEditingComputerId(null);
                resetComputerForm();
              }}
              className="px-4 py-2 font-medium rounded-lg transition-colors theme-btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 font-medium rounded-lg transition-colors theme-btn-primary"
            >
              {editingComputerId ? "Save Changes" : "Add Computer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
