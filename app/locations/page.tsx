"use client";

import { useState } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

function LocationsContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();

  // Admin screen: fetch full rows incl. security codes via the guarded query.
  const locations = useQuery(
    api.locations.listWithSecurity,
    user ? { requestingUserId: user._id } : "skip",
  );
  const createLocation = useMutation(api.locations.create);
  const updateLocation = useMutation(api.locations.update);
  const deactivateLocation = useMutation(api.locations.deactivate);
  const reactivateLocation = useMutation(api.locations.reactivate);
  const seedLocations = useMutation(api.locations.seedLocations);

  const [showNewLocation, setShowNewLocation] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Id<"locations"> | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    phone: "",
    pinCode: "",
    alarmCode: "",
    gateCode: "",
    wifiPassword: "",
    securityNotes: "",
    notes: "",
  });
  const [error, setError] = useState("");
  const [seeding, setSeeding] = useState(false);

  const resetFormData = () => ({
    name: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    phone: "",
    pinCode: "",
    alarmCode: "",
    gateCode: "",
    wifiPassword: "",
    securityNotes: "",
    notes: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      if (!user) throw new Error("Not signed in");
      if (editingLocation) {
        await updateLocation({
          id: editingLocation,
          name: formData.name || undefined,
          address: formData.address || undefined,
          city: formData.city || undefined,
          state: formData.state || undefined,
          zipCode: formData.zipCode || undefined,
          phone: formData.phone || undefined,
          pinCode: formData.pinCode || undefined,
          alarmCode: formData.alarmCode || undefined,
          gateCode: formData.gateCode || undefined,
          wifiPassword: formData.wifiPassword || undefined,
          securityNotes: formData.securityNotes || undefined,
          notes: formData.notes || undefined,
          requestingUserId: user._id,
        });
        setEditingLocation(null);
      } else {
        await createLocation({
          name: formData.name,
          address: formData.address || undefined,
          city: formData.city || undefined,
          state: formData.state || undefined,
          zipCode: formData.zipCode || undefined,
          phone: formData.phone || undefined,
          pinCode: formData.pinCode || undefined,
          alarmCode: formData.alarmCode || undefined,
          gateCode: formData.gateCode || undefined,
          wifiPassword: formData.wifiPassword || undefined,
          securityNotes: formData.securityNotes || undefined,
          notes: formData.notes || undefined,
          requestingUserId: user._id,
        });
      }

      setShowNewLocation(false);
      setFormData(resetFormData());
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  const handleEdit = (location: NonNullable<typeof locations>[0]) => {
    setEditingLocation(location._id);
    setFormData({
      name: location.name,
      address: location.address || "",
      city: location.city || "",
      state: location.state || "",
      zipCode: location.zipCode || "",
      phone: location.phone || "",
      pinCode: location.pinCode || "",
      alarmCode: location.alarmCode || "",
      gateCode: location.gateCode || "",
      wifiPassword: location.wifiPassword || "",
      securityNotes: location.securityNotes || "",
      notes: location.notes || "",
    });
    setShowNewLocation(true);
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      if (!user) throw new Error("Not signed in");
      await seedLocations({ requestingUserId: user._id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to seed locations");
    } finally {
      setSeeding(false);
    }
  };

  const handleDeactivate = async (id: Id<"locations">) => {
    try {
      if (!user) throw new Error("Not signed in");
      await deactivateLocation({ id, requestingUserId: user._id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate location");
    }
  };

  const handleReactivate = async (id: Id<"locations">) => {
    try {
      if (!user) throw new Error("Not signed in");
      await reactivateLocation({ id, requestingUserId: user._id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reactivate location");
    }
  };

  const activeLocations = locations?.filter(l => l.isActive) ?? [];
  const inactiveLocations = locations?.filter(l => !l.isActive) ?? [];

  return (
    <div className={`flex h-screen theme-bg-primary`}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        {/* Header */}
        <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className={`text-xl sm:text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Locations</h1>
              <p className={`text-xs sm:text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Manage warehouse locations
              </p>
            </div>
            <div className="flex gap-2">
              {locations?.length === 0 && (
                <button
                  onClick={handleSeed}
                  disabled={seeding}
                  className={`px-3 sm:px-4 py-2 text-sm font-medium rounded-lg transition-colors ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                >
                  {seeding ? "Seeding..." : "Seed Initial Locations"}
                </button>
              )}
              <button
                onClick={() => {
                  setShowNewLocation(true);
                  setEditingLocation(null);
                  setFormData(resetFormData());
                }}
                className={`px-3 sm:px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="hidden sm:inline">Add Location</span>
              </button>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-8">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm mb-6">
              {error}
              <button onClick={() => setError("")} className="ml-4 text-red-300 hover:text-red-100">Dismiss</button>
            </div>
          )}

          {/* Active Locations */}
          <div className="mb-8">
            <h2 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
              Active Locations ({activeLocations.length})
            </h2>

            {activeLocations.length === 0 ? (
              <div className={`text-center py-12 border rounded-xl ${isDark ? "bg-slate-800/50 border-slate-700 text-slate-400" : "bg-white border-gray-200 text-gray-500"}`}>
                No active locations. Add a location or seed the initial locations.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {activeLocations.map((location) => (
                  <div
                    key={location._id}
                    className={`border rounded-xl p-4 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                          {location.name}
                        </h3>
                        {(location.address || location.city) && (
                          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                            {[location.address, location.city, location.state, location.zipCode]
                              .filter(Boolean)
                              .join(", ")}
                          </p>
                        )}
                        {location.phone && (
                          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                            {location.phone}
                          </p>
                        )}
                      </div>
                      <span className="px-2 py-1 text-xs font-medium rounded bg-green-500/20 text-green-400 shrink-0">
                        Active
                      </span>
                    </div>

                    {/* Security Codes */}
                    {(location.pinCode || location.alarmCode || location.gateCode || location.wifiPassword) && (
                      <div className={`mt-3 pt-3 border-t ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
                        <p className={`text-xs font-medium mb-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Security Codes</p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {location.pinCode && (
                            <div className={`${isDark ? "text-slate-300" : "text-gray-600"}`}>
                              <span className={`${isDark ? "text-slate-500" : "text-gray-400"}`}>PIN:</span> {location.pinCode}
                            </div>
                          )}
                          {location.alarmCode && (
                            <div className={`${isDark ? "text-slate-300" : "text-gray-600"}`}>
                              <span className={`${isDark ? "text-slate-500" : "text-gray-400"}`}>Alarm:</span> {location.alarmCode}
                            </div>
                          )}
                          {location.gateCode && (
                            <div className={`${isDark ? "text-slate-300" : "text-gray-600"}`}>
                              <span className={`${isDark ? "text-slate-500" : "text-gray-400"}`}>Gate:</span> {location.gateCode}
                            </div>
                          )}
                          {location.wifiPassword && (
                            <div className={`${isDark ? "text-slate-300" : "text-gray-600"}`}>
                              <span className={`${isDark ? "text-slate-500" : "text-gray-400"}`}>WiFi:</span> {location.wifiPassword}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {location.notes && (
                      <p className={`text-sm mt-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                        {location.notes}
                      </p>
                    )}

                    <div className={`flex gap-2 mt-4 pt-4 border-t ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
                      <button
                        onClick={() => handleEdit(location)}
                        className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${isDark ? "bg-slate-700 text-slate-300 hover:bg-slate-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeactivate(location._id)}
                        className="px-3 py-1.5 text-xs font-medium rounded transition-colors bg-red-500/10 text-red-400 hover:bg-red-500/20"
                      >
                        Deactivate
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Inactive Locations */}
          {inactiveLocations.length > 0 && (
            <div>
              <h2 className={`text-lg font-semibold mb-4 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                Inactive Locations ({inactiveLocations.length})
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {inactiveLocations.map((location) => (
                  <div
                    key={location._id}
                    className={`border rounded-xl p-4 opacity-60 ${isDark ? "bg-slate-800/30 border-slate-700" : "bg-gray-50 border-gray-200"}`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className={`font-semibold ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                          {location.name}
                        </h3>
                      </div>
                      <span className="px-2 py-1 text-xs font-medium rounded bg-slate-500/20 text-slate-400">
                        Inactive
                      </span>
                    </div>
                    <div className="flex gap-2 mt-4 pt-4 border-t border-slate-700/30">
                      <button
                        onClick={() => handleReactivate(location._id)}
                        className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${isDark ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30" : "bg-blue-100 text-blue-600 hover:bg-blue-200"}`}
                      >
                        Reactivate
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Add/Edit Location Modal */}
        {showNewLocation && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`border rounded-xl p-4 sm:p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className="flex items-center justify-between mb-6">
                <h2 className={`text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  {editingLocation ? "Edit Location" : "Add New Location"}
                </h2>
                <button
                  onClick={() => {
                    setShowNewLocation(false);
                    setEditingLocation(null);
                    setFormData(resetFormData());
                  }}
                  className={`p-1 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"}`}
                >
                  <svg className={`w-5 h-5 ${isDark ? "text-slate-400" : "text-gray-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Basic Information */}
                <div>
                  <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>Basic Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        Name *
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        required
                        placeholder="e.g., Latrobe"
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        Phone
                      </label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="(555) 555-5555"
                      />
                    </div>
                  </div>
                </div>

                {/* Address */}
                <div>
                  <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>Address</h3>
                  <div className="space-y-4">
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        Street Address
                      </label>
                      <input
                        type="text"
                        value={formData.address}
                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="123 Main Street"
                      />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div className="col-span-2">
                        <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                          City
                        </label>
                        <input
                          type="text"
                          value={formData.city}
                          onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                          className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        />
                      </div>
                      <div>
                        <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                          State
                        </label>
                        <input
                          type="text"
                          value={formData.state}
                          onChange={(e) => setFormData({ ...formData, state: e.target.value.toUpperCase() })}
                          className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                          placeholder="PA"
                          maxLength={2}
                        />
                      </div>
                      <div>
                        <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                          ZIP Code
                        </label>
                        <input
                          type="text"
                          value={formData.zipCode}
                          onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                          className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                          placeholder="15650"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Security Codes */}
                <div>
                  <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>Security Codes</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        Door PIN Code
                      </label>
                      <input
                        type="text"
                        value={formData.pinCode}
                        onChange={(e) => setFormData({ ...formData, pinCode: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="1234"
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        Alarm Code
                      </label>
                      <input
                        type="text"
                        value={formData.alarmCode}
                        onChange={(e) => setFormData({ ...formData, alarmCode: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="5678"
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        Gate Code
                      </label>
                      <input
                        type="text"
                        value={formData.gateCode}
                        onChange={(e) => setFormData({ ...formData, gateCode: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="9012"
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        WiFi Password
                      </label>
                      <input
                        type="text"
                        value={formData.wifiPassword}
                        onChange={(e) => setFormData({ ...formData, wifiPassword: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="password123"
                      />
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Security Notes
                    </label>
                    <textarea
                      value={formData.securityNotes}
                      onChange={(e) => setFormData({ ...formData, securityNotes: e.target.value })}
                      rows={2}
                      className={`w-full px-3 py-2 border rounded-lg focus:outline-none resize-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                      placeholder="Additional security information..."
                    />
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    General Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none resize-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                    placeholder="Any additional notes about this location..."
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewLocation(false);
                      setEditingLocation(null);
                      setFormData(resetFormData());
                    }}
                    className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                  >
                    {editingLocation ? "Update Location" : "Create Location"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function LocationsPage() {
  // Admin-only: this screen displays/edits physical-security codes, and the
  // listWithSecurity query + all location mutations require an admin role.
  return (
    <Protected requiredRoles={["super_admin", "admin"]}>
      <LocationsContent />
    </Protected>
  );
}
