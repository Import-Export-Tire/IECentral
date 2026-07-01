"use client";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { useEquipment } from "./EquipmentContext";
import EquipmentHeader from "./EquipmentHeader";
import ScannerPickerGrid from "./ScannerPickerGrid";
import VehiclesView from "./VehiclesView";
import ComputersView from "./ComputersView";
import NewEquipmentModal from "./modals/NewEquipmentModal";
import RetireModal from "./modals/RetireModal";
import DeleteModal from "./modals/DeleteModal";
import AssignModal from "./modals/AssignModal";
import ReturnModal from "./modals/ReturnModal";
import ReassignModal from "./modals/ReassignModal";
import HistoryModal from "./modals/HistoryModal";
import QRModal from "./modals/QRModal";
import NewVehicleModal from "./modals/NewVehicleModal";
import NewComputerModal from "./modals/NewComputerModal";
import SafetyHistoryModal from "./modals/SafetyHistoryModal";

export default function EquipmentContent() {
  const { activeTab, currentItems, error, setError } = useEquipment();

  return (
    <>
      <EquipmentHeader />

      <div className="p-4 sm:p-8">
        {error && (
          <Card tone="red" padding="sm" className="mb-6">
            <div className="flex items-center justify-between">
              <span className="theme-text-primary text-sm">{error}</span>
              <Button variant="ghost" size="sm" onClick={() => setError("")}>Dismiss</Button>
            </div>
          </Card>
        )}

        {/* Equipment Grid */}
        {!currentItems ? (
          <div className="text-center py-12 theme-text-tertiary">
            Loading...
          </div>
        ) : currentItems.length === 0 && activeTab !== "computers" ? (
          <Card>
            <div className="text-center py-8 theme-text-tertiary">
              No {activeTab} found. Add your first {activeTab === "scanners" ? "scanner" : activeTab === "pickers" ? "picker" : "vehicle"}.
            </div>
          </Card>
        ) : activeTab === "computers" ? (
          <ComputersView />
        ) : activeTab === "vehicles" ? (
          <VehiclesView />
        ) : (
          <ScannerPickerGrid />
        )}
      </div>

      {/* Modals */}
      <NewEquipmentModal />
      <RetireModal />
      <DeleteModal />
      <AssignModal />
      <ReturnModal />
      <ReassignModal />
      <HistoryModal />
      <QRModal />
      <NewVehicleModal />
      <NewComputerModal />
      <SafetyHistoryModal />
    </>
  );
}
