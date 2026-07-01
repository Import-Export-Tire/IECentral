"use client";

import { Id } from "@/convex/_generated/dataModel";
import { useEquipment } from "../EquipmentContext";

export default function NewVehicleModal() {
  const {
    showNewVehicle, editingVehicleId, vehicleFormData, setVehicleFormData, locations,
    user, updateVehicle, createVehicle, setError, setShowNewVehicle, setEditingVehicleId,
  } = useEquipment();

  if (!showNewVehicle) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="theme-card p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold theme-text-primary">
            {editingVehicleId ? "Edit Vehicle" : "Add New Vehicle"}
          </h2>
          <button
            onClick={() => {
              setShowNewVehicle(false);
              setEditingVehicleId(null);
            }}
            className="p-1 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          >
            <svg className="w-5 h-5 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            if (!user) throw new Error("Not signed in");
            if (editingVehicleId) {
              await updateVehicle({
                id: editingVehicleId,
                vin: vehicleFormData.vin,
                plateNumber: vehicleFormData.plateNumber || undefined,
                year: vehicleFormData.year ? parseInt(vehicleFormData.year) : undefined,
                make: vehicleFormData.make || undefined,
                model: vehicleFormData.model || undefined,
                trim: vehicleFormData.trim || undefined,
                color: vehicleFormData.color || undefined,
                fuelType: vehicleFormData.fuelType || undefined,
                locationId: vehicleFormData.locationId as Id<"locations"> || undefined,
                currentMileage: vehicleFormData.currentMileage ? parseInt(vehicleFormData.currentMileage) : undefined,
                insurancePolicyNumber: vehicleFormData.insurancePolicyNumber || undefined,
                insuranceProvider: vehicleFormData.insuranceProvider || undefined,
                insuranceExpirationDate: vehicleFormData.insuranceExpirationDate || undefined,
                registrationExpirationDate: vehicleFormData.registrationExpirationDate || undefined,
                registrationState: vehicleFormData.registrationState || undefined,
                purchaseDate: vehicleFormData.purchaseDate || undefined,
                purchasePrice: vehicleFormData.purchasePrice ? parseFloat(vehicleFormData.purchasePrice) : undefined,
                purchasedFrom: vehicleFormData.purchasedFrom || undefined,
                notes: vehicleFormData.notes || undefined,
                requestingUserId: user._id,
              });
            } else {
              await createVehicle({
                vin: vehicleFormData.vin,
                plateNumber: vehicleFormData.plateNumber || undefined,
                year: vehicleFormData.year ? parseInt(vehicleFormData.year) : undefined,
                make: vehicleFormData.make,
                model: vehicleFormData.model,
                trim: vehicleFormData.trim || undefined,
                color: vehicleFormData.color || undefined,
                fuelType: vehicleFormData.fuelType || undefined,
                locationId: vehicleFormData.locationId as Id<"locations"> || undefined,
                currentMileage: vehicleFormData.currentMileage ? parseInt(vehicleFormData.currentMileage) : undefined,
                insurancePolicyNumber: vehicleFormData.insurancePolicyNumber || undefined,
                insuranceProvider: vehicleFormData.insuranceProvider || undefined,
                insuranceExpirationDate: vehicleFormData.insuranceExpirationDate || undefined,
                registrationExpirationDate: vehicleFormData.registrationExpirationDate || undefined,
                registrationState: vehicleFormData.registrationState || undefined,
                purchaseDate: vehicleFormData.purchaseDate || undefined,
                purchasePrice: vehicleFormData.purchasePrice ? parseFloat(vehicleFormData.purchasePrice) : undefined,
                purchasedFrom: vehicleFormData.purchasedFrom || undefined,
                notes: vehicleFormData.notes || undefined,
                requestingUserId: user._id,
              });
            }
            setShowNewVehicle(false);
            setEditingVehicleId(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to save vehicle");
          }
        }} className="space-y-6">
          {/* Vehicle Identification */}
          <div>
            <h3 className="text-sm font-semibold mb-3 theme-text-primary">Vehicle Identification</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">VIN *</label>
                <input
                  type="text"
                  value={vehicleFormData.vin}
                  onChange={(e) => setVehicleFormData({ ...vehicleFormData, vin: e.target.value.toUpperCase() })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="17-character VIN"
                  maxLength={17}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Plate Number</label>
                <input
                  type="text"
                  value={vehicleFormData.plateNumber}
                  onChange={(e) => setVehicleFormData({ ...vehicleFormData, plateNumber: e.target.value.toUpperCase() })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="License plate"
                />
              </div>
            </div>
          </div>

          {/* Vehicle Details */}
          <div>
            <h3 className="text-sm font-semibold mb-3 theme-text-primary">Vehicle Details</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Year</label>
                <input
                  type="number"
                  value={vehicleFormData.year}
                  onChange={(e) => setVehicleFormData({ ...vehicleFormData, year: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="2024"
                  min="1900"
                  max="2100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Make *</label>
                <input
                  type="text"
                  value={vehicleFormData.make}
                  onChange={(e) => setVehicleFormData({ ...vehicleFormData, make: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="Ford"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Model *</label>
                <input
                  type="text"
                  value={vehicleFormData.model}
                  onChange={(e) => setVehicleFormData({ ...vehicleFormData, model: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="F-150"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Trim</label>
                <input
                  type="text"
                  value={vehicleFormData.trim}
                  onChange={(e) => setVehicleFormData({ ...vehicleFormData, trim: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="XLT"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Color</label>
                <input
                  type="text"
                  value={vehicleFormData.color}
                  onChange={(e) => setVehicleFormData({ ...vehicleFormData, color: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="White"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Fuel Type</label>
                <select
                  value={vehicleFormData.fuelType}
                  onChange={(e) => setVehicleFormData({ ...vehicleFormData, fuelType: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                >
                  <option value="">Select...</option>
                  <option value="gasoline">Gasoline</option>
                  <option value="diesel">Diesel</option>
                  <option value="electric">Electric</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Current Mileage</label>
                <input
                  type="number"
                  value={vehicleFormData.currentMileage}
                  onChange={(e) => setVehicleFormData({ ...vehicleFormData, currentMileage: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="50000"
                />
              </div>
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium mb-1 theme-text-secondary">Location</label>
            <select
              value={vehicleFormData.locationId}
              onChange={(e) => setVehicleFormData({ ...vehicleFormData, locationId: e.target.value })}
              className="theme-input w-full px-3 py-2"
            >
              <option value="">Select location...</option>
              {locations?.map((loc) => (
                <option key={loc._id} value={loc._id}>{loc.name}</option>
              ))}
            </select>
          </div>

          {/* Insurance & Registration */}
          <div>
            <h3 className="text-sm font-semibold mb-3 theme-text-primary">Insurance & Registration</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Insurance Provider</label>
                <input
                  type="text"
                  value={vehicleFormData.insuranceProvider}
                  onChange={(e) => setVehicleFormData({ ...vehicleFormData, insuranceProvider: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="State Farm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Policy Number</label>
                <input
                  type="text"
                  value={vehicleFormData.insurancePolicyNumber}
                  onChange={(e) => setVehicleFormData({ ...vehicleFormData, insurancePolicyNumber: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="Policy #"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Insurance Expiration</label>
                <input
                  type="date"
                  value={vehicleFormData.insuranceExpirationDate}
                  onChange={(e) => setVehicleFormData({ ...vehicleFormData, insuranceExpirationDate: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Registration Expiration</label>
                <input
                  type="date"
                  value={vehicleFormData.registrationExpirationDate}
                  onChange={(e) => setVehicleFormData({ ...vehicleFormData, registrationExpirationDate: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Registration State</label>
                <input
                  type="text"
                  value={vehicleFormData.registrationState}
                  onChange={(e) => setVehicleFormData({ ...vehicleFormData, registrationState: e.target.value.toUpperCase() })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="PA"
                  maxLength={2}
                />
              </div>
            </div>
          </div>

          {/* Purchase Info */}
          <div>
            <h3 className="text-sm font-semibold mb-3 theme-text-primary">Purchase Info</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Purchase Date</label>
                <input
                  type="date"
                  value={vehicleFormData.purchaseDate}
                  onChange={(e) => setVehicleFormData({ ...vehicleFormData, purchaseDate: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Purchase Price</label>
                <input
                  type="number"
                  value={vehicleFormData.purchasePrice}
                  onChange={(e) => setVehicleFormData({ ...vehicleFormData, purchasePrice: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="35000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 theme-text-secondary">Purchased From</label>
                <input
                  type="text"
                  value={vehicleFormData.purchasedFrom}
                  onChange={(e) => setVehicleFormData({ ...vehicleFormData, purchasedFrom: e.target.value })}
                  className="theme-input w-full px-3 py-2"
                  placeholder="Dealer name"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium mb-1 theme-text-secondary">Notes</label>
            <textarea
              value={vehicleFormData.notes}
              onChange={(e) => setVehicleFormData({ ...vehicleFormData, notes: e.target.value })}
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
                setShowNewVehicle(false);
                setEditingVehicleId(null);
              }}
              className="px-4 py-2 font-medium rounded-lg transition-colors theme-btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 font-medium rounded-lg transition-colors theme-btn-primary"
            >
              {editingVehicleId ? "Save Changes" : "Add Vehicle"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
