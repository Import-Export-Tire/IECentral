"use client";

import { useEquipment } from "./EquipmentContext";

export default function VehiclesView() {
  const {
    vehicles, isSuperuser, user, setEditingVehicleId, setShowNewVehicle,
    setVehicleFormData, retireVehicle, setError,
  } = useEquipment();

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {(vehicles || []).map((vehicle) => (
        <div
          key={vehicle._id}
          className="theme-card p-5"
        >
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              <h3 className="font-semibold theme-text-primary">
                {vehicle.year} {vehicle.make} {vehicle.model}
              </h3>
              {vehicle.trim && (
                <p className="text-sm theme-text-secondary">
                  {vehicle.trim}
                </p>
              )}
            </div>
            <span className={`ui-badge shrink-0 ${
              vehicle.status === "active" ? "ui-badge-green" :
              vehicle.status === "maintenance" ? "ui-badge-amber" :
              vehicle.status === "out_of_service" ? "ui-badge-red" :
              "ui-badge-gray"
            }`}>
              {vehicle.status}
            </span>
          </div>

          <div className="space-y-2 text-sm">
            <div className="theme-text-secondary">
              <span className="theme-text-tertiary">VIN:</span> {vehicle.vin}
            </div>
            {vehicle.plateNumber && (
              <div className="theme-text-secondary">
                <span className="theme-text-tertiary">Plate:</span> {vehicle.plateNumber}
              </div>
            )}
            {vehicle.color && (
              <div className="theme-text-secondary">
                <span className="theme-text-tertiary">Color:</span> {vehicle.color}
              </div>
            )}
            {vehicle.currentMileage && (
              <div className="theme-text-secondary">
                <span className="theme-text-tertiary">Mileage:</span> {vehicle.currentMileage.toLocaleString()} mi
              </div>
            )}
            {vehicle.locationName && vehicle.locationName !== "Unassigned" && (
              <div className="theme-text-secondary">
                <span className="theme-text-tertiary">Location:</span> {vehicle.locationName}
              </div>
            )}
            {vehicle.assignedPersonName && (
              <div className="theme-text-secondary">
                <span className="theme-text-tertiary">Driver:</span> {vehicle.assignedPersonName}
              </div>
            )}
          </div>

          {/* Insurance/Registration Warnings */}
          {(vehicle.insuranceExpirationDate || vehicle.registrationExpirationDate) && (
            <div className="mt-3 space-y-1">
              {vehicle.insuranceExpirationDate && new Date(vehicle.insuranceExpirationDate) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) && (
                <div className={`text-xs p-2 rounded ${
                  new Date(vehicle.insuranceExpirationDate) < new Date()
                    ? "bg-red-500/10 text-red-400 border border-red-500/20"
                    : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                }`}>
                  Insurance {new Date(vehicle.insuranceExpirationDate) < new Date() ? "expired" : "expires"}: {new Date(vehicle.insuranceExpirationDate).toLocaleDateString()}
                </div>
              )}
              {vehicle.registrationExpirationDate && new Date(vehicle.registrationExpirationDate) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) && (
                <div className={`text-xs p-2 rounded ${
                  new Date(vehicle.registrationExpirationDate) < new Date()
                    ? "bg-red-500/10 text-red-400 border border-red-500/20"
                    : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                }`}>
                  Registration {new Date(vehicle.registrationExpirationDate) < new Date() ? "expired" : "expires"}: {new Date(vehicle.registrationExpirationDate).toLocaleDateString()}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t theme-border-secondary">
            <button
              onClick={() => {
                setEditingVehicleId(vehicle._id);
                setShowNewVehicle(true);
                setVehicleFormData({
                  vin: vehicle.vin,
                  plateNumber: vehicle.plateNumber || "",
                  year: vehicle.year?.toString() || "",
                  make: vehicle.make,
                  model: vehicle.model,
                  trim: vehicle.trim || "",
                  color: vehicle.color || "",
                  fuelType: vehicle.fuelType || "",
                  locationId: vehicle.locationId || "",
                  currentMileage: vehicle.currentMileage?.toString() || "",
                  insurancePolicyNumber: vehicle.insurancePolicyNumber || "",
                  insuranceProvider: vehicle.insuranceProvider || "",
                  insuranceExpirationDate: vehicle.insuranceExpirationDate || "",
                  registrationExpirationDate: vehicle.registrationExpirationDate || "",
                  registrationState: vehicle.registrationState || "",
                  purchaseDate: vehicle.purchaseDate || "",
                  purchasePrice: vehicle.purchasePrice?.toString() || "",
                  purchasedFrom: vehicle.purchasedFrom || "",
                  notes: vehicle.notes || "",
                });
              }}
              className="px-3 py-1.5 text-xs font-medium rounded transition-colors theme-btn-secondary"
            >
              Edit
            </button>
            {vehicle.status !== "retired" && isSuperuser && (
              <button
                onClick={async () => {
                  if (confirm(`Retire this vehicle? (${vehicle.year} ${vehicle.make} ${vehicle.model})`)) {
                    const reason = prompt("Reason for retirement:");
                    if (reason) {
                      try {
                        if (!user) return;
                        await retireVehicle({ vehicleId: vehicle._id, reason, requestingUserId: user._id });
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to retire vehicle");
                      }
                    }
                  }
                }}
                className="px-3 py-1.5 text-xs font-medium rounded transition-colors ui-btn-danger"
              >
                Retire
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
