"use client";

import { useState } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "../auth-context";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";

function LocationsContent() {
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
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Header */}
        <header className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-[var(--theme-border-secondary)] px-4 sm:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">Locations</h1>
              <p className="text-xs sm:text-sm mt-1 theme-text-tertiary">
                Manage warehouse locations
              </p>
            </div>
            <div className="flex gap-2">
              {locations?.length === 0 && (
                <Button
                  variant="secondary"
                  onClick={handleSeed}
                  disabled={seeding}
                >
                  {seeding ? "Seeding..." : "Seed Initial Locations"}
                </Button>
              )}
              <Button
                variant="primary"
                onClick={() => {
                  setShowNewLocation(true);
                  setEditingLocation(null);
                  setFormData(resetFormData());
                }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="hidden sm:inline">Add Location</span>
              </Button>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-8 space-y-6">
          {error && (
            <Card tone="red" padding="sm">
              <div className="flex items-center justify-between">
                <span className="text-sm theme-text-primary">{error}</span>
                <button onClick={() => setError("")} className="ml-4 text-red-400 hover:text-red-300 text-sm">Dismiss</button>
              </div>
            </Card>
          )}

          {/* Active Locations */}
          <div>
            <SectionHeader label="LOCATIONS" title={`Active Locations (${activeLocations.length})`} />

            {activeLocations.length === 0 ? (
              <Card>
                <p className="text-center py-8 theme-text-tertiary">
                  No active locations. Add a location or seed the initial locations.
                </p>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {activeLocations.map((location) => (
                  <Card key={location._id} padding="md">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold theme-text-primary">
                          {location.name}
                        </h3>
                        {(location.address || location.city) && (
                          <p className="text-sm mt-1 theme-text-tertiary">
                            {[location.address, location.city, location.state, location.zipCode]
                              .filter(Boolean)
                              .join(", ")}
                          </p>
                        )}
                        {location.phone && (
                          <p className="text-sm mt-1 theme-text-tertiary">
                            {location.phone}
                          </p>
                        )}
                      </div>
                      <span className="ui-badge ui-badge-green shrink-0">Active</span>
                    </div>

                    {/* Security Codes */}
                    {(location.pinCode || location.alarmCode || location.gateCode || location.wifiPassword) && (
                      <div className="mt-3 pt-3 border-t border-[var(--theme-border-secondary)]">
                        <p className="text-xs font-medium mb-2 theme-text-tertiary">Security Codes</p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {location.pinCode && (
                            <div className="theme-text-secondary">
                              <span className="theme-text-tertiary">PIN:</span> {location.pinCode}
                            </div>
                          )}
                          {location.alarmCode && (
                            <div className="theme-text-secondary">
                              <span className="theme-text-tertiary">Alarm:</span> {location.alarmCode}
                            </div>
                          )}
                          {location.gateCode && (
                            <div className="theme-text-secondary">
                              <span className="theme-text-tertiary">Gate:</span> {location.gateCode}
                            </div>
                          )}
                          {location.wifiPassword && (
                            <div className="theme-text-secondary">
                              <span className="theme-text-tertiary">WiFi:</span> {location.wifiPassword}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {location.notes && (
                      <p className="text-sm mt-2 theme-text-tertiary">
                        {location.notes}
                      </p>
                    )}

                    <div className="flex gap-2 mt-4 pt-4 border-t border-[var(--theme-border-secondary)]">
                      <Button variant="secondary" size="sm" onClick={() => handleEdit(location)}>
                        Edit
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => handleDeactivate(location._id)}>
                        Deactivate
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Inactive Locations */}
          {inactiveLocations.length > 0 && (
            <div>
              <SectionHeader label="ARCHIVED" title={`Inactive Locations (${inactiveLocations.length})`} />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {inactiveLocations.map((location) => (
                  <Card key={location._id} padding="md" className="opacity-60">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold theme-text-secondary">
                          {location.name}
                        </h3>
                      </div>
                      <span className="ui-badge ui-badge-gray">Inactive</span>
                    </div>
                    <div className="flex gap-2 mt-4 pt-4 border-t border-[var(--theme-border-secondary)]">
                      <Button variant="secondary" size="sm" onClick={() => handleReactivate(location._id)}>
                        Reactivate
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Add/Edit Location Modal */}
        {showNewLocation && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="theme-card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="p-5 border-b border-[var(--theme-border-secondary)] flex items-center justify-between">
                <h2 className="text-xl font-semibold theme-text-primary">
                  {editingLocation ? "Edit Location" : "Add New Location"}
                </h2>
                <button
                  onClick={() => {
                    setShowNewLocation(false);
                    setEditingLocation(null);
                    setFormData(resetFormData());
                  }}
                  className="p-1 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-slate-700"
                >
                  <svg className="w-5 h-5 theme-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-5 space-y-6">
                {/* Basic Information */}
                <div>
                  <div className="ui-section-label mb-3">Basic Information</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block ui-section-label mb-1">Name *</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="theme-input w-full px-3 py-2 text-sm"
                        required
                        placeholder="e.g., Latrobe"
                      />
                    </div>
                    <div>
                      <label className="block ui-section-label mb-1">Phone</label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="theme-input w-full px-3 py-2 text-sm"
                        placeholder="(555) 555-5555"
                      />
                    </div>
                  </div>
                </div>

                {/* Address */}
                <div>
                  <div className="ui-section-label mb-3">Address</div>
                  <div className="space-y-4">
                    <div>
                      <label className="block ui-section-label mb-1">Street Address</label>
                      <input
                        type="text"
                        value={formData.address}
                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                        className="theme-input w-full px-3 py-2 text-sm"
                        placeholder="123 Main Street"
                      />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div className="col-span-2">
                        <label className="block ui-section-label mb-1">City</label>
                        <input
                          type="text"
                          value={formData.city}
                          onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                          className="theme-input w-full px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block ui-section-label mb-1">State</label>
                        <input
                          type="text"
                          value={formData.state}
                          onChange={(e) => setFormData({ ...formData, state: e.target.value.toUpperCase() })}
                          className="theme-input w-full px-3 py-2 text-sm"
                          placeholder="PA"
                          maxLength={2}
                        />
                      </div>
                      <div>
                        <label className="block ui-section-label mb-1">ZIP Code</label>
                        <input
                          type="text"
                          value={formData.zipCode}
                          onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                          className="theme-input w-full px-3 py-2 text-sm"
                          placeholder="15650"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Security Codes */}
                <div>
                  <div className="ui-section-label mb-3">Security Codes</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                      <label className="block ui-section-label mb-1">Door PIN Code</label>
                      <input
                        type="text"
                        value={formData.pinCode}
                        onChange={(e) => setFormData({ ...formData, pinCode: e.target.value })}
                        className="theme-input w-full px-3 py-2 text-sm"
                        placeholder="1234"
                      />
                    </div>
                    <div>
                      <label className="block ui-section-label mb-1">Alarm Code</label>
                      <input
                        type="text"
                        value={formData.alarmCode}
                        onChange={(e) => setFormData({ ...formData, alarmCode: e.target.value })}
                        className="theme-input w-full px-3 py-2 text-sm"
                        placeholder="5678"
                      />
                    </div>
                    <div>
                      <label className="block ui-section-label mb-1">Gate Code</label>
                      <input
                        type="text"
                        value={formData.gateCode}
                        onChange={(e) => setFormData({ ...formData, gateCode: e.target.value })}
                        className="theme-input w-full px-3 py-2 text-sm"
                        placeholder="9012"
                      />
                    </div>
                    <div>
                      <label className="block ui-section-label mb-1">WiFi Password</label>
                      <input
                        type="text"
                        value={formData.wifiPassword}
                        onChange={(e) => setFormData({ ...formData, wifiPassword: e.target.value })}
                        className="theme-input w-full px-3 py-2 text-sm"
                        placeholder="password123"
                      />
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="block ui-section-label mb-1">Security Notes</label>
                    <textarea
                      value={formData.securityNotes}
                      onChange={(e) => setFormData({ ...formData, securityNotes: e.target.value })}
                      rows={2}
                      className="theme-input w-full px-3 py-2 text-sm resize-none"
                      placeholder="Additional security information..."
                    />
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block ui-section-label mb-1">General Notes</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                    className="theme-input w-full px-3 py-2 text-sm resize-none"
                    placeholder="Any additional notes about this location..."
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1"
                    onClick={() => {
                      setShowNewLocation(false);
                      setEditingLocation(null);
                      setFormData(resetFormData());
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" className="flex-1">
                    {editingLocation ? "Update Location" : "Create Location"}
                  </Button>
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
