"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/app/theme-context";
import { useAuth } from "@/app/auth-context";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export type EquipmentType = "scanners" | "pickers" | "vehicles" | "computers";

// Equipment value for agreements
export const EQUIPMENT_VALUE = 100;

// Derived row types from the Convex queries so components can type their props.
type ScannerRow = NonNullable<ReturnType<typeof useQuery<typeof api.equipment.listScanners>>>[0];
type PickerRow = NonNullable<ReturnType<typeof useQuery<typeof api.equipment.listPickers>>>[0];
type ComputerRow = NonNullable<ReturnType<typeof useQuery<typeof api.equipment.listComputers>>>[0];
export type EquipmentItem = ScannerRow | PickerRow;

const EquipmentContext = createContext<ReturnType<typeof useEquipmentValue> | null>(null);

export function useEquipment() {
  const ctx = useContext(EquipmentContext);
  if (!ctx) throw new Error("useEquipment must be used within EquipmentProvider");
  return ctx;
}

function useEquipmentValue() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();

  const router = useRouter();
  const canEditEquipment = user?.role === "super_admin" || user?.role === "admin" || user?.role === "warehouse_director" || user?.role === "warehouse_manager";

  const [activeTab, setActiveTab] = useState<EquipmentType>("pickers");
  const [selectedLocation, setSelectedLocation] = useState<Id<"locations"> | "all">("all");
  const [showNewEquipment, setShowNewEquipment] = useState(false);
  const [editingId, setEditingId] = useState<Id<"scanners"> | Id<"pickers"> | null>(null);
  const [showRetireModal, setShowRetireModal] = useState(false);
  const [retireId, setRetireId] = useState<Id<"scanners"> | Id<"pickers"> | null>(null);
  const [retireReason, setRetireReason] = useState("");
  const [error, setError] = useState("");

  // Assign modal state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignEquipmentId, setAssignEquipmentId] = useState<Id<"scanners"> | Id<"pickers"> | null>(null);
  const [assignEquipmentData, setAssignEquipmentData] = useState<{
    number: string;
    serialNumber?: string;
  } | null>(null);
  const [selectedPersonnelId, setSelectedPersonnelId] = useState<string>("");
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [assignStep, setAssignStep] = useState<"select" | "sign">("select");

  // Return modal state
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnEquipmentId, setReturnEquipmentId] = useState<Id<"scanners"> | Id<"pickers"> | null>(null);
  const [returnEquipmentData, setReturnEquipmentData] = useState<{
    number: string;
    assignedPersonName?: string | null;
  } | null>(null);
  const [checklist, setChecklist] = useState({
    physicalCondition: true,
    screenFunctional: true,
    buttonsWorking: true,
    batteryCondition: true,
    chargingPortOk: true,
    scannerFunctional: true,
    cleanCondition: true,
  });
  const [overallCondition, setOverallCondition] = useState<string>("good");
  const [damageNotes, setDamageNotes] = useState("");
  const [repairRequired, setRepairRequired] = useState(false);
  const [readyForReassignment, setReadyForReassignment] = useState(true);
  const [deductionRequired, setDeductionRequired] = useState(false);
  const [deductionAmount, setDeductionAmount] = useState<number>(0);

  // QR Code modal state
  const [showQRModal, setShowQRModal] = useState(false);
  const [qrEquipment, setQREquipment] = useState<{
    id: string;
    type: "picker" | "scanner";
    number: string;
    locationName: string;
  } | null>(null);

  // Safety history modal state
  const [showSafetyHistoryModal, setShowSafetyHistoryModal] = useState(false);
  const [safetyHistoryEquipment, setSafetyHistoryEquipment] = useState<{
    id: Id<"pickers">;
    number: string;
  } | null>(null);

  // History modal state
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyEquipmentId, setHistoryEquipmentId] = useState<Id<"scanners"> | Id<"pickers"> | null>(null);
  const [historyEquipmentNumber, setHistoryEquipmentNumber] = useState<string>("");

  // Reassign modal state
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [reassignEquipmentId, setReassignEquipmentId] = useState<Id<"scanners"> | Id<"pickers"> | null>(null);
  const [reassignEquipmentData, setReassignEquipmentData] = useState<{
    number: string;
    serialNumber?: string;
    assignedPersonName?: string | null;
  } | null>(null);
  const [reassignStep, setReassignStep] = useState<"condition" | "assign">("condition");
  const [reassignChecklist, setReassignChecklist] = useState({
    physicalCondition: true,
    screenFunctional: true,
    buttonsWorking: true,
    batteryCondition: true,
    chargingPortOk: true,
    scannerFunctional: true,
    cleanCondition: true,
  });
  const [reassignOverallCondition, setReassignOverallCondition] = useState<string>("good");
  const [reassignDamageNotes, setReassignDamageNotes] = useState("");
  const [reassignRepairRequired, setReassignRepairRequired] = useState(false);
  const [reassignDeductionRequired, setReassignDeductionRequired] = useState(false);
  const [reassignDeductionAmount, setReassignDeductionAmount] = useState<number>(0);
  const [reassignSignOffSignature, setReassignSignOffSignature] = useState<string | null>(null);
  const [reassignNewPersonnelId, setReassignNewPersonnelId] = useState<string>("");
  const [reassignNewPersonnelSignature, setReassignNewPersonnelSignature] = useState<string | null>(null);

  // Queries
  const locations = useQuery(api.locations.listActive);
  const scanners = useQuery(api.equipment.listScanners,
    selectedLocation === "all" ? {} : { locationId: selectedLocation }
  );
  const pickers = useQuery(api.equipment.listPickers,
    selectedLocation === "all" ? {} : { locationId: selectedLocation }
  );
  const vehicles = useQuery(api.equipment.listVehicles,
    selectedLocation === "all" ? {} : { locationId: selectedLocation }
  );
  const computers = useQuery(
    api.equipment.listComputers,
    user ? { requestingUserId: user._id } : "skip",
  );
  const personnel = useQuery(api.personnel.listAll, {});
  const activePersonnel = useQuery(api.equipment.listActivePersonnel);
  const safetyCompletions = useQuery(
    api.safetyChecklist.getEquipmentCompletions,
    safetyHistoryEquipment
      ? { equipmentType: "picker", equipmentId: safetyHistoryEquipment.id, limit: 10 }
      : "skip"
  );
  const equipmentHistory = useQuery(
    api.equipment.getEquipmentHistory,
    historyEquipmentId
      ? { equipmentType: activeTab === "scanners" ? "scanner" : "picker", equipmentId: historyEquipmentId }
      : "skip"
  );

  // Mutations
  const createScanner = useMutation(api.equipment.createScanner);
  const updateScanner = useMutation(api.equipment.updateScanner);
  const createPicker = useMutation(api.equipment.createPicker);
  const updatePicker = useMutation(api.equipment.updatePicker);
  const retireEquipment = useMutation(api.equipment.retireEquipment);
  const assignEquipmentWithAgreement = useMutation(api.equipment.assignEquipmentWithAgreement);
  const returnEquipmentWithCheck = useMutation(api.equipment.returnEquipmentWithCheck);
  const deleteEquipmentMutation = useMutation(api.equipment.deleteEquipment);
  const reassignEquipmentMutation = useMutation(api.equipment.reassignEquipment);
  const createVehicle = useMutation(api.equipment.createVehicle);
  const updateVehicle = useMutation(api.equipment.updateVehicle);
  const retireVehicle = useMutation(api.equipment.retireVehicle);
  const deleteVehicleMutation = useMutation(api.equipment.deleteVehicle);
  const createComputer = useMutation(api.equipment.createComputer);
  const updateComputer = useMutation(api.equipment.updateComputer);
  const deleteComputerMutation = useMutation(api.equipment.deleteComputer);

  // Delete modal state (superuser only)
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteId, setDeleteId] = useState<Id<"scanners"> | Id<"pickers"> | null>(null);
  const [deleteNumber, setDeleteNumber] = useState("");
  const isSuperuser = user?.role === "super_admin";

  // Equipment status options
  const EQUIPMENT_STATUS_OPTIONS = [
    { value: "available", label: "Available" },
    { value: "inactive", label: "Inactive" },
    { value: "inoperable", label: "Inoperable" },
  ];

  // Form state
  const [formData, setFormData] = useState({
    number: "",
    pin: "",
    serialNumber: "",
    model: "",
    locationId: "" as string,
    purchaseDate: "",
    notes: "",
    conditionNotes: "",
    status: "available",
  });

  // Vehicle form state
  const [vehicleFormData, setVehicleFormData] = useState({
    vin: "",
    plateNumber: "",
    year: "",
    make: "",
    model: "",
    trim: "",
    color: "",
    fuelType: "",
    locationId: "" as string,
    currentMileage: "",
    insurancePolicyNumber: "",
    insuranceProvider: "",
    insuranceExpirationDate: "",
    registrationExpirationDate: "",
    registrationState: "",
    purchaseDate: "",
    purchasePrice: "",
    purchasedFrom: "",
    notes: "",
  });
  const [editingVehicleId, setEditingVehicleId] = useState<Id<"vehicles"> | null>(null);
  const [showNewVehicle, setShowNewVehicle] = useState(false);

  // Computer form state
  const [computerFormData, setComputerFormData] = useState({
    name: "", // Identifier
    type: "computer" as string, // computer | laptop
    locationId: "" as string,
    adminPassword: "",
    userPassword: "",
    ethernetPort: "",
    ipAddress: "",
    remoteAccessEnabled: false,
    remoteAccessCode: "",
    remoteAccessNotes: "",
    chromeRemoteId: "",
    serialNumber: "",
    manufacturer: "",
    model: "",
    operatingSystem: "",
    notes: "",
  });
  const [editingComputerId, setEditingComputerId] = useState<Id<"equipment"> | null>(null);
  const [showNewComputer, setShowNewComputer] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!formData.locationId) {
      setError("Please select a location");
      return;
    }

    if (!formData.number.trim()) {
      setError("Please enter an identifier");
      return;
    }

    try {
      if (!user) throw new Error("Not signed in");
      if (editingId) {
        if (activeTab === "scanners") {
          await updateScanner({
            id: editingId as Id<"scanners">,
            number: formData.number.trim() || undefined,
            pin: formData.pin || undefined,
            serialNumber: formData.serialNumber || undefined,
            model: formData.model || undefined,
            locationId: formData.locationId as Id<"locations">,
            purchaseDate: formData.purchaseDate || undefined,
            notes: formData.notes || undefined,
            conditionNotes: formData.conditionNotes || undefined,
            status: formData.status || undefined,
            userId: user._id, // For PIN change tracking
            requestingUserId: user._id,
          });
        } else {
          await updatePicker({
            id: editingId as Id<"pickers">,
            number: formData.number.trim() || undefined,
            pin: formData.pin || undefined,
            serialNumber: formData.serialNumber || undefined,
            model: formData.model || undefined,
            locationId: formData.locationId as Id<"locations">,
            purchaseDate: formData.purchaseDate || undefined,
            notes: formData.notes || undefined,
            conditionNotes: formData.conditionNotes || undefined,
            status: formData.status || undefined,
            userId: user._id, // For PIN change tracking
            requestingUserId: user._id,
          });
        }
      } else {
        if (activeTab === "scanners") {
          await createScanner({
            number: formData.number.trim(),
            pin: formData.pin || undefined,
            serialNumber: formData.serialNumber || undefined,
            model: formData.model || undefined,
            locationId: formData.locationId as Id<"locations">,
            purchaseDate: formData.purchaseDate || undefined,
            notes: formData.notes || undefined,
            conditionNotes: formData.conditionNotes || undefined,
            requestingUserId: user._id,
          });
        } else {
          await createPicker({
            number: formData.number.trim(),
            pin: formData.pin || undefined,
            serialNumber: formData.serialNumber || undefined,
            model: formData.model || undefined,
            locationId: formData.locationId as Id<"locations">,
            purchaseDate: formData.purchaseDate || undefined,
            notes: formData.notes || undefined,
            conditionNotes: formData.conditionNotes || undefined,
            requestingUserId: user._id,
          });
        }
      }

      setShowNewEquipment(false);
      setEditingId(null);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  const handleRetire = async () => {
    if (!retireId || !retireReason.trim() || !user?._id) return;

    try {
      await retireEquipment({
        equipmentType: activeTab === "scanners" ? "scanner" : "picker",
        equipmentId: retireId,
        reason: retireReason.trim(),
        userId: user._id,
      });
      setShowRetireModal(false);
      setRetireId(null);
      setRetireReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retire equipment");
    }
  };

  const resetForm = () => {
    setFormData({
      number: "",
      pin: "",
      serialNumber: "",
      model: "",
      locationId: locations?.[0]?._id ?? "",
      purchaseDate: "",
      notes: "",
      conditionNotes: "",
      status: "available",
    });
  };

  const resetComputerForm = () => {
    setComputerFormData({
      name: "",
      type: "computer",
      locationId: "",
      adminPassword: "",
      userPassword: "",
      ethernetPort: "",
      ipAddress: "",
      remoteAccessEnabled: false,
      remoteAccessCode: "",
      remoteAccessNotes: "",
      chromeRemoteId: "",
      serialNumber: "",
      manufacturer: "",
      model: "",
      operatingSystem: "",
      notes: "",
    });
  };

  const handleComputerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!computerFormData.name.trim()) {
      setError("Please enter an identifier");
      return;
    }

    try {
      if (!user) throw new Error("Not signed in");
      if (editingComputerId) {
        await updateComputer({
          computerId: editingComputerId,
          name: computerFormData.name.trim(),
          type: computerFormData.type,
          locationId: computerFormData.locationId ? computerFormData.locationId as Id<"locations"> : undefined,
          adminPassword: computerFormData.adminPassword || undefined,
          userPassword: computerFormData.userPassword || undefined,
          ethernetPort: computerFormData.ethernetPort || undefined,
          ipAddress: computerFormData.ipAddress || undefined,
          remoteAccessEnabled: computerFormData.remoteAccessEnabled,
          remoteAccessCode: computerFormData.remoteAccessCode || undefined,
          remoteAccessNotes: computerFormData.remoteAccessNotes || undefined,
          chromeRemoteId: computerFormData.chromeRemoteId || undefined,
          serialNumber: computerFormData.serialNumber || undefined,
          manufacturer: computerFormData.manufacturer || undefined,
          model: computerFormData.model || undefined,
          operatingSystem: computerFormData.operatingSystem || undefined,
          notes: computerFormData.notes || undefined,
          requestingUserId: user._id,
        });
      } else {
        if (!user?._id) {
          setError("User not found");
          return;
        }
        await createComputer({
          name: computerFormData.name.trim(),
          type: computerFormData.type,
          locationId: computerFormData.locationId ? computerFormData.locationId as Id<"locations"> : undefined,
          adminPassword: computerFormData.adminPassword || undefined,
          userPassword: computerFormData.userPassword || undefined,
          ethernetPort: computerFormData.ethernetPort || undefined,
          ipAddress: computerFormData.ipAddress || undefined,
          remoteAccessEnabled: computerFormData.remoteAccessEnabled,
          remoteAccessCode: computerFormData.remoteAccessCode || undefined,
          remoteAccessNotes: computerFormData.remoteAccessNotes || undefined,
          chromeRemoteId: computerFormData.chromeRemoteId || undefined,
          serialNumber: computerFormData.serialNumber || undefined,
          manufacturer: computerFormData.manufacturer || undefined,
          model: computerFormData.model || undefined,
          operatingSystem: computerFormData.operatingSystem || undefined,
          notes: computerFormData.notes || undefined,
          userId: user._id,
        });
      }

      setShowNewComputer(false);
      setEditingComputerId(null);
      resetComputerForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  const handleEditComputer = (computer: ComputerRow) => {
    setEditingComputerId(computer._id);
    setComputerFormData({
      name: computer.name,
      type: computer.type,
      locationId: computer.locationId || "",
      adminPassword: computer.adminPassword || "",
      userPassword: computer.userPassword || "",
      ethernetPort: computer.ethernetPort || "",
      ipAddress: computer.ipAddress || "",
      remoteAccessEnabled: computer.remoteAccessEnabled,
      remoteAccessCode: computer.remoteAccessCode || "",
      remoteAccessNotes: computer.remoteAccessNotes || "",
      chromeRemoteId: computer.chromeRemoteId || "",
      serialNumber: computer.serialNumber || "",
      manufacturer: computer.manufacturer || "",
      model: computer.model || "",
      operatingSystem: computer.operatingSystem || "",
      notes: computer.notes || "",
    });
    setShowNewComputer(true);
  };

  const handleEdit = (item: ScannerRow | PickerRow) => {
    setEditingId(item._id as Id<"scanners"> | Id<"pickers">);
    setFormData({
      number: String(item.number),
      pin: item.pin || "",
      serialNumber: item.serialNumber || "",
      model: item.model || "",
      locationId: item.locationId,
      purchaseDate: item.purchaseDate || "",
      notes: item.notes || "",
      conditionNotes: item.conditionNotes || "",
      status: item.status || "available",
    });
    setShowNewEquipment(true);
  };

  const openRetireModal = (id: Id<"scanners"> | Id<"pickers">) => {
    setRetireId(id);
    setRetireReason("");
    setShowRetireModal(true);
  };

  const openDeleteModal = (item: ScannerRow | PickerRow) => {
    setDeleteId(item._id as Id<"scanners"> | Id<"pickers">);
    setDeleteNumber(String(item.number));
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!deleteId || !user?._id) return;

    try {
      await deleteEquipmentMutation({
        equipmentType: activeTab === "scanners" ? "scanner" : "picker",
        equipmentId: deleteId,
        userId: user._id,
      });
      setShowDeleteModal(false);
      setDeleteId(null);
      setDeleteNumber("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete equipment");
    }
  };

  const openAssignModal = (item: ScannerRow | PickerRow) => {
    setAssignEquipmentId(item._id as Id<"scanners"> | Id<"pickers">);
    setAssignEquipmentData({
      number: String(item.number),
      serialNumber: item.serialNumber,
    });
    setSelectedPersonnelId("");
    setSignatureData(null);
    setAssignStep("select");
    setShowAssignModal(true);
  };

  const openReturnModal = (item: ScannerRow | PickerRow) => {
    setReturnEquipmentId(item._id as Id<"scanners"> | Id<"pickers">);
    setReturnEquipmentData({
      number: String(item.number),
      assignedPersonName: item.assignedPersonName,
    });
    setChecklist({
      physicalCondition: true,
      screenFunctional: true,
      buttonsWorking: true,
      batteryCondition: true,
      chargingPortOk: true,
      scannerFunctional: true,
      cleanCondition: true,
    });
    setOverallCondition("good");
    setDamageNotes("");
    setRepairRequired(false);
    setReadyForReassignment(true);
    setDeductionRequired(false);
    setDeductionAmount(0);
    setShowReturnModal(true);
  };

  const handleAssign = async () => {
    if (!assignEquipmentId || !selectedPersonnelId || !signatureData || !user?._id) return;

    try {
      await assignEquipmentWithAgreement({
        equipmentType: activeTab === "scanners" ? "scanner" : "picker",
        equipmentId: assignEquipmentId,
        personnelId: selectedPersonnelId as Id<"personnel">,
        signatureData: signatureData,
        userId: user._id,
        userName: user.name,
        equipmentValue: EQUIPMENT_VALUE,
      });
      setShowAssignModal(false);
      setAssignEquipmentId(null);
      setAssignEquipmentData(null);
      setSelectedPersonnelId("");
      setSignatureData(null);
      setAssignStep("select");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign equipment");
    }
  };

  const handleReturn = async () => {
    if (!returnEquipmentId || !user?._id) return;

    try {
      await returnEquipmentWithCheck({
        equipmentType: activeTab === "scanners" ? "scanner" : "picker",
        equipmentId: returnEquipmentId,
        checkedBy: user._id,
        checkedByName: user.name,
        checklist: checklist,
        overallCondition: overallCondition,
        damageNotes: damageNotes || undefined,
        repairRequired: repairRequired,
        readyForReassignment: readyForReassignment,
        deductionRequired: deductionRequired,
        deductionAmount: deductionRequired ? deductionAmount : undefined,
      });
      setShowReturnModal(false);
      setReturnEquipmentId(null);
      setReturnEquipmentData(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to return equipment");
    }
  };

  const openHistoryModal = (item: ScannerRow | PickerRow) => {
    setHistoryEquipmentId(item._id as Id<"scanners"> | Id<"pickers">);
    setHistoryEquipmentNumber(String(item.number));
    setShowHistoryModal(true);
  };

  const openReassignModal = (item: ScannerRow | PickerRow) => {
    setReassignEquipmentId(item._id as Id<"scanners"> | Id<"pickers">);
    setReassignEquipmentData({
      number: String(item.number),
      serialNumber: item.serialNumber,
      assignedPersonName: item.assignedPersonName,
    });
    setReassignStep("condition");
    setReassignChecklist({
      physicalCondition: true,
      screenFunctional: true,
      buttonsWorking: true,
      batteryCondition: true,
      chargingPortOk: true,
      scannerFunctional: true,
      cleanCondition: true,
    });
    setReassignOverallCondition("good");
    setReassignDamageNotes("");
    setReassignRepairRequired(false);
    setReassignDeductionRequired(false);
    setReassignDeductionAmount(0);
    setReassignSignOffSignature(null);
    setReassignNewPersonnelId("");
    setReassignNewPersonnelSignature(null);
    setShowReassignModal(true);
  };

  const handleReassign = async () => {
    if (!reassignEquipmentId || !reassignSignOffSignature || !reassignNewPersonnelId || !reassignNewPersonnelSignature || !user?._id) return;

    try {
      await reassignEquipmentMutation({
        equipmentType: activeTab === "scanners" ? "scanner" : "picker",
        equipmentId: reassignEquipmentId,
        checklist: reassignChecklist,
        overallCondition: reassignOverallCondition,
        damageNotes: reassignDamageNotes || undefined,
        repairRequired: reassignRepairRequired,
        deductionRequired: reassignDeductionRequired,
        deductionAmount: reassignDeductionRequired ? reassignDeductionAmount : undefined,
        signOffSignature: reassignSignOffSignature,
        newPersonnelId: reassignNewPersonnelId as Id<"personnel">,
        newPersonnelSignature: reassignNewPersonnelSignature,
        userId: user._id,
        userName: user.name,
        equipmentValue: EQUIPMENT_VALUE,
      });
      setShowReassignModal(false);
      setReassignEquipmentId(null);
      setReassignEquipmentData(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reassign equipment");
    }
  };

  const getReassignAgreementText = () => {
    if (!reassignEquipmentData) return "";
    const selectedPerson = activePersonnel?.find(p => p._id === reassignNewPersonnelId);
    const employeeName = selectedPerson?.name || "Employee";
    const serialDisplay = reassignEquipmentData.serialNumber ? ` (Serial: ${reassignEquipmentData.serialNumber})` : "";
    const equipmentLabel = activeTab === "scanners" ? "Scanner" : "Picker";

    return `EQUIPMENT RESPONSIBILITY AGREEMENT

This Equipment Responsibility Agreement ("Agreement") is entered into between the Employee named below and IE Tires, LLC ("Company").

EQUIPMENT ASSIGNED:
${equipmentLabel} #${reassignEquipmentData.number}${serialDisplay}
Equipment Value: $${EQUIPMENT_VALUE.toFixed(2)}

EMPLOYEE: ${employeeName}

TERMS AND CONDITIONS:

1. SOLE RESPONSIBILITY: The undersigned Employee acknowledges receipt of the above-described Company equipment and accepts full responsibility for its care, security, and proper use.

2. AUTHORIZED USE ONLY: This equipment is issued exclusively to the undersigned Employee. No other individual is authorized to access, operate, or use this equipment under any circumstances.

3. ON-PREMISES ONLY: This equipment must remain on Company premises at all times. Under no circumstances shall this equipment be removed from the workplace or taken to the Employee's residence.

4. DAMAGE REPORTING: The Employee shall immediately report any damage, malfunction, or defect to their supervisor. Failure to promptly report damage may result in disciplinary action and financial liability.

5. FINANCIAL LIABILITY:
   a) Failure to return equipment upon separation from employment, reassignment, or request by management will result in a deduction of up to $${EQUIPMENT_VALUE.toFixed(2)} from the Employee's final pay.
   b) Damage resulting from intentional misconduct, gross negligence, or careless handling may result in a deduction of up to $${EQUIPMENT_VALUE.toFixed(2)} from Employee's pay to cover replacement costs.

6. RETURN REQUIREMENT: Upon termination of employment, reassignment, or request by management, the Employee shall immediately return this equipment in the same condition as received, allowing for reasonable wear and tear.

By signing below, the Employee acknowledges that they have read, understand, and agree to abide by all terms and conditions set forth in this Agreement.`;
  };

  const getAgreementText = () => {
    if (!assignEquipmentData) return "";
    const selectedPerson = activePersonnel?.find(p => p._id === selectedPersonnelId);
    const employeeName = selectedPerson?.name || "Employee";
    const serialDisplay = assignEquipmentData.serialNumber ? ` (Serial: ${assignEquipmentData.serialNumber})` : "";
    const equipmentLabel = activeTab === "scanners" ? "Scanner" : "Picker";

    return `EQUIPMENT RESPONSIBILITY AGREEMENT

This Equipment Responsibility Agreement ("Agreement") is entered into between the Employee named below and IE Tires, LLC ("Company").

EQUIPMENT ASSIGNED:
${equipmentLabel} #${assignEquipmentData.number}${serialDisplay}
Equipment Value: $${EQUIPMENT_VALUE.toFixed(2)}

EMPLOYEE: ${employeeName}

TERMS AND CONDITIONS:

1. SOLE RESPONSIBILITY: The undersigned Employee acknowledges receipt of the above-described Company equipment and accepts full responsibility for its care, security, and proper use.

2. AUTHORIZED USE ONLY: This equipment is issued exclusively to the undersigned Employee. No other individual is authorized to access, operate, or use this equipment under any circumstances.

3. ON-PREMISES ONLY: This equipment must remain on Company premises at all times. Under no circumstances shall this equipment be removed from the workplace or taken to the Employee's residence.

4. DAMAGE REPORTING: The Employee shall immediately report any damage, malfunction, or defect to their supervisor. Failure to promptly report damage may result in disciplinary action and financial liability.

5. FINANCIAL LIABILITY:
   a) Failure to return equipment upon separation from employment, reassignment, or request by management will result in a deduction of up to $${EQUIPMENT_VALUE.toFixed(2)} from the Employee's final pay.
   b) Damage resulting from intentional misconduct, gross negligence, or careless handling may result in a deduction of up to $${EQUIPMENT_VALUE.toFixed(2)} from Employee's pay to cover replacement costs.

6. RETURN REQUIREMENT: Upon termination of employment, reassignment, or request by management, the Employee shall immediately return this equipment in the same condition as received, allowing for reasonable wear and tear.

By signing below, the Employee acknowledges that they have read, understand, and agree to abide by all terms and conditions set forth in this Agreement.`;
  };

  // Sort equipment: available first, then assigned, then others
  const sortByStatus = (items: typeof scanners | typeof pickers) => {
    if (!items) return items;
    const statusOrder: Record<string, number> = {
      available: 0,
      assigned: 1,
      maintenance: 2,
      lost: 3,
      retired: 4,
    };
    return [...items].sort((a, b) => {
      const orderA = statusOrder[a.status] ?? 99;
      const orderB = statusOrder[b.status] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      // Secondary sort by number
      return String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
    });
  };

  const currentItems = activeTab === "vehicles"
    ? vehicles
    : sortByStatus(activeTab === "scanners" ? scanners : pickers);

  const openQRModal = (item: PickerRow) => {
    setQREquipment({
      id: item._id,
      type: "picker",
      number: String(item.number),
      locationName: item.locationName,
    });
    setShowQRModal(true);
  };

  const openSafetyHistoryModal = (item: PickerRow) => {
    setSafetyHistoryEquipment({
      id: item._id,
      number: String(item.number),
    });
    setShowSafetyHistoryModal(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "available":
        return "bg-green-500/20 text-green-400";
      case "assigned":
        return "bg-blue-500/20 text-blue-400";
      case "maintenance":
        return "bg-yellow-500/20 text-yellow-400";
      case "lost":
        return "bg-red-500/20 text-red-400";
      case "retired":
        return "bg-slate-500/20 text-slate-400";
      default:
        return "bg-slate-500/20 text-slate-400";
    }
  };

  return {
    // theme / user / roles
    isDark, user, router, canEditEquipment, isSuperuser,
    // tab / filter
    activeTab, setActiveTab, selectedLocation, setSelectedLocation,
    // queries
    locations, scanners, pickers, vehicles, computers, personnel, activePersonnel,
    safetyCompletions, equipmentHistory,
    // mutations used directly in JSX
    retireVehicle, deleteComputerMutation, createVehicle, updateVehicle,
    // derived
    currentItems, sortByStatus, getStatusColor,
    EQUIPMENT_STATUS_OPTIONS,
    // new/edit equipment modal
    showNewEquipment, setShowNewEquipment, editingId, setEditingId, formData, setFormData,
    handleSubmit, resetForm, handleEdit,
    // retire modal
    showRetireModal, setShowRetireModal, retireId, setRetireId, retireReason, setRetireReason,
    handleRetire, openRetireModal,
    // delete modal
    showDeleteModal, setShowDeleteModal, deleteId, setDeleteId, deleteNumber, setDeleteNumber,
    handleDelete, openDeleteModal,
    // assign modal
    showAssignModal, setShowAssignModal, assignEquipmentId, setAssignEquipmentId,
    assignEquipmentData, setAssignEquipmentData, selectedPersonnelId, setSelectedPersonnelId,
    signatureData, setSignatureData, assignStep, setAssignStep, handleAssign, openAssignModal,
    getAgreementText,
    // return modal
    showReturnModal, setShowReturnModal, returnEquipmentId, setReturnEquipmentId,
    returnEquipmentData, setReturnEquipmentData, checklist, setChecklist,
    overallCondition, setOverallCondition, damageNotes, setDamageNotes,
    repairRequired, setRepairRequired, readyForReassignment, setReadyForReassignment,
    deductionRequired, setDeductionRequired, deductionAmount, setDeductionAmount,
    handleReturn, openReturnModal,
    // reassign modal
    showReassignModal, setShowReassignModal, reassignEquipmentId, setReassignEquipmentId,
    reassignEquipmentData, setReassignEquipmentData, reassignStep, setReassignStep,
    reassignChecklist, setReassignChecklist, reassignOverallCondition, setReassignOverallCondition,
    reassignDamageNotes, setReassignDamageNotes, reassignRepairRequired, setReassignRepairRequired,
    reassignDeductionRequired, setReassignDeductionRequired, reassignDeductionAmount, setReassignDeductionAmount,
    reassignSignOffSignature, setReassignSignOffSignature, reassignNewPersonnelId, setReassignNewPersonnelId,
    reassignNewPersonnelSignature, setReassignNewPersonnelSignature,
    handleReassign, openReassignModal, getReassignAgreementText,
    // QR modal
    showQRModal, setShowQRModal, qrEquipment, setQREquipment, openQRModal,
    // safety history modal
    showSafetyHistoryModal, setShowSafetyHistoryModal, safetyHistoryEquipment, setSafetyHistoryEquipment,
    openSafetyHistoryModal,
    // history modal
    showHistoryModal, setShowHistoryModal, historyEquipmentId, setHistoryEquipmentId,
    historyEquipmentNumber, setHistoryEquipmentNumber, openHistoryModal,
    // vehicle modal
    vehicleFormData, setVehicleFormData, editingVehicleId, setEditingVehicleId,
    showNewVehicle, setShowNewVehicle,
    // computer modal
    computerFormData, setComputerFormData, editingComputerId, setEditingComputerId,
    showNewComputer, setShowNewComputer, handleComputerSubmit, resetComputerForm, handleEditComputer,
    // error
    error, setError,
  };
}

export function EquipmentProvider({ children }: { children: ReactNode }) {
  const value = useEquipmentValue();
  return <EquipmentContext.Provider value={value}>{children}</EquipmentContext.Provider>;
}
