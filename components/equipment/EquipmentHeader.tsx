"use client";

import { Id } from "@/convex/_generated/dataModel";
import Button from "@/components/ui/Button";
import { useEquipment } from "./EquipmentContext";

export default function EquipmentHeader() {
  const {
    activeTab, setActiveTab, selectedLocation, setSelectedLocation,
    canEditEquipment, locations, pickers, vehicles, computers, router,
    setShowNewVehicle, setEditingVehicleId, setVehicleFormData,
    setShowNewComputer, setEditingComputerId, resetComputerForm,
    setShowNewEquipment, setEditingId, resetForm,
  } = useEquipment();

  return (
    <header className="sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-purple-500/10">
            <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold theme-text-primary">Equipment</h1>
            <p className="text-xs theme-text-tertiary">
              Pickers, vehicles, and computers
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* View Equipment Report Button */}
          <a
            href={`/reports?type=equipment&equipmentType=${activeTab === "scanners" ? "Scanner" : activeTab === "pickers" ? "Picker" : activeTab === "vehicles" ? "Vehicle" : "all"}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-[9px] font-semibold transition-colors theme-btn-secondary px-3.5 py-2 text-[13.5px]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="hidden sm:inline">View Report</span>
          </a>
          {canEditEquipment && (
            <Button
              variant="primary"
              onClick={() => {
                if (activeTab === "vehicles") {
                  setShowNewVehicle(true);
                  setEditingVehicleId(null);
                  setVehicleFormData({
                    vin: "", plateNumber: "", year: "", make: "", model: "", trim: "",
                    color: "", fuelType: "", locationId: "", currentMileage: "",
                    insurancePolicyNumber: "", insuranceProvider: "", insuranceExpirationDate: "",
                    registrationExpirationDate: "", registrationState: "", purchaseDate: "",
                    purchasePrice: "", purchasedFrom: "", notes: "",
                  });
                } else if (activeTab === "computers") {
                  setShowNewComputer(true);
                  setEditingComputerId(null);
                  resetComputerForm();
                } else {
                  setShowNewEquipment(true);
                  setEditingId(null);
                  resetForm();
                }
              }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">Add {activeTab === "scanners" ? "Scanner" : activeTab === "pickers" ? "Picker" : activeTab === "computers" ? "Computer" : "Vehicle"}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Tabs and Filters */}
      <div className="flex flex-wrap items-center gap-3 mt-4">
        {/* Scanner Manager Link */}
        <Button variant="ghost" onClick={() => router.push("/equipment/scanners")}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          Scanner Fleet
          <svg className="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </Button>

        <div className="h-5 w-px bg-[var(--border-secondary)]" />

        {/* Equipment Type Tabs */}
        {(["pickers", "vehicles", "computers"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`${activeTab === tab ? "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ring-2 ring-[var(--accent-primary)] theme-card" : "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors theme-text-tertiary hover:theme-text-secondary"}`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)} ({tab === "pickers" ? pickers?.length ?? 0 : tab === "vehicles" ? vehicles?.length ?? 0 : computers?.length ?? 0})
          </button>
        ))}

        {/* Location Filter */}
        <select
          value={selectedLocation}
          onChange={(e) => setSelectedLocation(e.target.value as Id<"locations"> | "all")}
          className="theme-input ml-auto px-3 py-1.5 text-xs"
        >
          <option value="all">All Locations</option>
          {locations?.map((loc) => (
            <option key={loc._id} value={loc._id}>{loc.name}</option>
          ))}
        </select>
      </div>
    </header>
  );
}
