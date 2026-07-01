"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import SignaturePad from "@/components/SignaturePad";
import QRCodeModal from "@/components/QRCodeModal";

type EquipmentType = "scanners" | "pickers" | "vehicles" | "computers";

// Equipment value for agreements
const EQUIPMENT_VALUE = 100;

function EquipmentContent() {
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

  const handleEditComputer = (computer: NonNullable<typeof computers>[0]) => {
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

  const handleEdit = (item: NonNullable<typeof scanners>[0] | NonNullable<typeof pickers>[0]) => {
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

  const openDeleteModal = (item: NonNullable<typeof scanners>[0] | NonNullable<typeof pickers>[0]) => {
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

  const openAssignModal = (item: NonNullable<typeof scanners>[0] | NonNullable<typeof pickers>[0]) => {
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

  const openReturnModal = (item: NonNullable<typeof scanners>[0] | NonNullable<typeof pickers>[0]) => {
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

  const openHistoryModal = (item: NonNullable<typeof scanners>[0] | NonNullable<typeof pickers>[0]) => {
    setHistoryEquipmentId(item._id as Id<"scanners"> | Id<"pickers">);
    setHistoryEquipmentNumber(String(item.number));
    setShowHistoryModal(true);
  };

  const openReassignModal = (item: NonNullable<typeof scanners>[0] | NonNullable<typeof pickers>[0]) => {
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

  const openQRModal = (item: NonNullable<typeof pickers>[0]) => {
    setQREquipment({
      id: item._id,
      type: "picker",
      number: String(item.number),
      locationName: item.locationName,
    });
    setShowQRModal(true);
  };

  const openSafetyHistoryModal = (item: NonNullable<typeof pickers>[0]) => {
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

  return (
    <div className={`flex h-screen ${isDark ? "bg-slate-950" : "bg-gray-50"}`}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        {/* Header */}
        <div className={`border-b ${isDark ? "border-slate-800" : "border-gray-200"}`}>
          <div className={`h-1 ${isDark ? "bg-gradient-to-r from-purple-500 via-blue-500 to-cyan-500" : "bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-500"}`} />
        <header className={`sticky top-0 z-10 backdrop-blur-xl px-4 sm:px-6 lg:px-8 py-4 ${isDark ? "bg-slate-950/80" : "bg-gray-50/80"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? "bg-purple-500/10" : "bg-indigo-50"}`}>
                <svg className={`w-5 h-5 ${isDark ? "text-purple-400" : "text-indigo-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                </svg>
              </div>
              <div>
                <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Equipment</h1>
                <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  Pickers, vehicles, and computers
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* View Equipment Report Button */}
              <a
                href={`/reports?type=equipment&equipmentType=${activeTab === "scanners" ? "Scanner" : activeTab === "pickers" ? "Picker" : activeTab === "vehicles" ? "Vehicle" : "all"}`}
                className={`px-3 sm:px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="hidden sm:inline">View Report</span>
              </a>
              {canEditEquipment && (
                <button
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
                  className={`px-3 sm:px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span className="hidden sm:inline">Add {activeTab === "scanners" ? "Scanner" : activeTab === "pickers" ? "Picker" : activeTab === "computers" ? "Computer" : "Vehicle"}</span>
                </button>
              )}
            </div>
          </div>

          {/* Tabs and Filters */}
          <div className="flex flex-wrap items-center gap-3 mt-4">
            {/* Scanner Manager Link */}
            <button
              onClick={() => router.push("/equipment/scanners")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${isDark ? "bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20" : "bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Scanner Fleet
              <svg className="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>

            <div className={`h-5 w-px ${isDark ? "bg-slate-700" : "bg-gray-300"}`} />

            {/* Equipment Type Tabs */}
            {(["pickers", "vehicles", "computers"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  activeTab === tab
                    ? isDark ? "bg-purple-500/15 text-purple-400 border border-purple-500/20" : "bg-indigo-50 text-indigo-600 border border-indigo-200"
                    : isDark ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)} ({tab === "pickers" ? pickers?.length ?? 0 : tab === "vehicles" ? vehicles?.length ?? 0 : computers?.length ?? 0})
              </button>
            ))}

            {/* Location Filter */}
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value as Id<"locations"> | "all")}
              className={`ml-auto px-3 py-1.5 text-xs rounded-lg border focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-700 text-white focus:border-cyan-500" : "bg-white border-gray-200 text-gray-900 focus:border-blue-400"}`}
            >
              <option value="all">All Locations</option>
              {locations?.map((loc) => (
                <option key={loc._id} value={loc._id}>{loc.name}</option>
              ))}
            </select>
          </div>
        </header>
        </div>

        <div className="p-4 sm:p-8">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm mb-6">
              {error}
              <button onClick={() => setError("")} className="ml-4 text-red-300 hover:text-red-100">Dismiss</button>
            </div>
          )}

          {/* Equipment Grid */}
          {!currentItems ? (
            <div className={`text-center py-12 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Loading...
            </div>
          ) : currentItems.length === 0 && activeTab !== "computers" ? (
            <div className={`text-center py-12 border rounded-xl ${isDark ? "bg-slate-800/50 border-slate-700 text-slate-400" : "bg-white border-gray-200 text-gray-500"}`}>
              No {activeTab} found. Add your first {activeTab === "scanners" ? "scanner" : activeTab === "pickers" ? "picker" : "vehicle"}.
            </div>
          ) : activeTab === "computers" ? (
            /* Computers Grid with Remote Access */
            <div className="space-y-6">
              {/* Remote Access Computers */}
              <div>
                <h3 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Remote Access Computers
                </h3>
                {computers?.filter(c => c.remoteAccessEnabled).length === 0 ? (
                  <div className={`text-center py-8 border rounded-xl ${isDark ? "bg-slate-800/50 border-slate-700 text-slate-400" : "bg-white border-gray-200 text-gray-500"}`}>
                    No computers with remote access enabled. Add a computer with Chrome Remote Desktop ID.
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {computers?.filter(c => c.remoteAccessEnabled).map((comp) => (
                      <div
                        key={comp._id}
                        className={`border rounded-xl p-5 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-4">
                          <div className="min-w-0">
                            <h3 className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                              {comp.name}
                            </h3>
                            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              {comp.manufacturer} {comp.model}
                            </p>
                          </div>
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                            comp.status === "active"
                              ? isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-700"
                              : isDark ? "bg-yellow-500/20 text-yellow-400" : "bg-yellow-100 text-yellow-700"
                          }`}>
                            {comp.status}
                          </span>
                        </div>

                        <div className={`space-y-2 text-sm ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                          {comp.operatingSystem && (
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500">OS:</span> {comp.operatingSystem}
                            </div>
                          )}
                          {comp.assignedToName && (
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500">Assigned:</span> {comp.assignedToName}
                            </div>
                          )}
                          {comp.department && (
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500">Dept:</span> {comp.department}
                            </div>
                          )}
                          {comp.ipAddress && (
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500">IP:</span> {comp.ipAddress}
                            </div>
                          )}
                        </div>

                        {/* Remote Access Button */}
                        {comp.chromeRemoteUrl && (
                          <a
                            href={comp.chromeRemoteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                              isDark
                                ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30"
                                : "bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100"
                            }`}
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            Connect via Chrome Remote
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* All Computers */}
              <div>
                <h3 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                  All Computers ({computers?.length ?? 0})
                </h3>
                {!computers || computers.length === 0 ? (
                  <div className={`text-center py-8 border rounded-xl ${isDark ? "bg-slate-800/50 border-slate-700 text-slate-400" : "bg-white border-gray-200 text-gray-500"}`}>
                    No computers found. Add your first computer.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className={`w-full text-sm ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                      <thead>
                        <tr className={isDark ? "border-b border-slate-700" : "border-b border-gray-200"}>
                          <th className="px-4 py-3 text-left font-medium">Name</th>
                          <th className="px-4 py-3 text-left font-medium">Type</th>
                          <th className="px-4 py-3 text-left font-medium">Location</th>
                          <th className="px-4 py-3 text-left font-medium">IP Address</th>
                          <th className="px-4 py-3 text-left font-medium">Remote</th>
                          <th className="px-4 py-3 text-left font-medium">Status</th>
                          <th className="px-4 py-3 text-left font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {computers.map((comp) => (
                          <tr key={comp._id} className={isDark ? "border-b border-slate-700/50" : "border-b border-gray-100"}>
                            <td className={`px-4 py-3 font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                              {comp.name}
                            </td>
                            <td className="px-4 py-3 capitalize">{comp.type}</td>
                            <td className="px-4 py-3">{comp.locationName || "-"}</td>
                            <td className="px-4 py-3">{comp.ipAddress || "-"}</td>
                            <td className="px-4 py-3">
                              {comp.remoteAccessEnabled ? (
                                <span className={`px-2 py-1 text-xs rounded-full ${isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-700"}`}>
                                  Enabled
                                </span>
                              ) : (
                                <span className={`px-2 py-1 text-xs rounded-full ${isDark ? "bg-slate-500/20 text-slate-400" : "bg-gray-100 text-gray-500"}`}>
                                  Disabled
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                comp.status === "active"
                                  ? isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-700"
                                  : comp.status === "in_repair"
                                  ? isDark ? "bg-yellow-500/20 text-yellow-400" : "bg-yellow-100 text-yellow-700"
                                  : isDark ? "bg-slate-500/20 text-slate-400" : "bg-gray-100 text-gray-500"
                              }`}>
                                {comp.status}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleEditComputer(comp)}
                                  className={`px-2 py-1 text-xs rounded ${isDark ? "bg-slate-700 text-slate-300 hover:bg-slate-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                                >
                                  Edit
                                </button>
                                {comp.chromeRemoteUrl && (
                                  <a
                                    href={comp.chromeRemoteUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`px-2 py-1 text-xs rounded ${isDark ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30" : "bg-blue-50 text-blue-600 hover:bg-blue-100"}`}
                                  >
                                    Connect
                                  </a>
                                )}
                                {isSuperuser && (
                                  <button
                                    onClick={async () => {
                                      if (confirm(`Delete ${comp.name}?`)) {
                                        if (!user) return;
                                        await deleteComputerMutation({ computerId: comp._id, requestingUserId: user._id });
                                      }
                                    }}
                                    className="text-red-400 hover:text-red-300 text-xs"
                                  >
                                    Delete
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === "vehicles" ? (
            /* Vehicles Grid */
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(vehicles || []).map((vehicle) => (
                <div
                  key={vehicle._id}
                  className={`border rounded-xl p-5 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}
                >
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="min-w-0">
                      <h3 className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </h3>
                      {vehicle.trim && (
                        <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          {vehicle.trim}
                        </p>
                      )}
                    </div>
                    <span className={`px-2.5 py-1 text-xs font-medium rounded shrink-0 ${
                      vehicle.status === "active" ? "bg-green-500/20 text-green-400" :
                      vehicle.status === "maintenance" ? "bg-yellow-500/20 text-yellow-400" :
                      vehicle.status === "out_of_service" ? "bg-red-500/20 text-red-400" :
                      "bg-slate-500/20 text-slate-400"
                    }`}>
                      {vehicle.status}
                    </span>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className={`${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      <span className={`${isDark ? "text-slate-500" : "text-gray-400"}`}>VIN:</span> {vehicle.vin}
                    </div>
                    {vehicle.plateNumber && (
                      <div className={`${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        <span className={`${isDark ? "text-slate-500" : "text-gray-400"}`}>Plate:</span> {vehicle.plateNumber}
                      </div>
                    )}
                    {vehicle.color && (
                      <div className={`${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        <span className={`${isDark ? "text-slate-500" : "text-gray-400"}`}>Color:</span> {vehicle.color}
                      </div>
                    )}
                    {vehicle.currentMileage && (
                      <div className={`${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        <span className={`${isDark ? "text-slate-500" : "text-gray-400"}`}>Mileage:</span> {vehicle.currentMileage.toLocaleString()} mi
                      </div>
                    )}
                    {vehicle.locationName && vehicle.locationName !== "Unassigned" && (
                      <div className={`${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        <span className={`${isDark ? "text-slate-500" : "text-gray-400"}`}>Location:</span> {vehicle.locationName}
                      </div>
                    )}
                    {vehicle.assignedPersonName && (
                      <div className={`${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        <span className={`${isDark ? "text-slate-500" : "text-gray-400"}`}>Driver:</span> {vehicle.assignedPersonName}
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

                  <div className={`flex flex-wrap gap-2 mt-4 pt-4 border-t ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
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
                      className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${isDark ? "bg-slate-700 text-slate-300 hover:bg-slate-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
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
                        className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${isDark ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-red-50 text-red-600 hover:bg-red-100"}`}
                      >
                        Retire
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {(activeTab === "scanners" ? scanners : pickers)?.map((item) => (
                <div
                  key={item._id}
                  className={`border rounded-xl p-5 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}
                >
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className={`min-w-14 h-14 px-3 rounded-lg flex items-center justify-center text-lg font-bold shrink-0 ${isDark ? "bg-slate-700 text-white" : "bg-gray-100 text-gray-900"}`}>
                        #{item.number}
                      </div>
                      <div className="min-w-0">
                        <h3 className={`font-semibold truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                          {activeTab === "scanners" ? "Scanner" : "Picker"} #{item.number}
                        </h3>
                        <p className={`text-sm mt-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          {item.locationName}
                        </p>
                      </div>
                    </div>
                    <span className={`px-2.5 py-1 text-xs font-medium rounded shrink-0 ${getStatusColor(item.status)}`}>
                      {item.status}
                    </span>
                  </div>

                  {item.pin && (
                    <div className={`text-sm mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      <span className={`${isDark ? "text-slate-500" : "text-gray-400"}`}>PIN:</span> {item.pin}
                    </div>
                  )}

                  {item.assignedPersonName && (
                    <div className={`text-sm mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      <span className={`${isDark ? "text-slate-500" : "text-gray-400"}`}>Assigned to:</span> {item.assignedPersonName}
                    </div>
                  )}

                  {item.model && (
                    <div className={`text-sm mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      <span className={`${isDark ? "text-slate-500" : "text-gray-400"}`}>Model:</span> {item.model}
                    </div>
                  )}

                  {item.serialNumber && (
                    <div className={`text-sm mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      <span className={`${isDark ? "text-slate-500" : "text-gray-400"}`}>S/N:</span> {item.serialNumber}
                    </div>
                  )}

                  {item.notes && (
                    <p className={`text-sm mt-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      {item.notes}
                    </p>
                  )}

                  {item.conditionNotes && (
                    <div className={`text-sm mt-2 p-2 rounded ${isDark ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
                      <span className="font-medium">Condition:</span> {item.conditionNotes}
                    </div>
                  )}

                  <div className={`flex flex-wrap gap-2 mt-4 pt-4 border-t ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
                    <button
                      onClick={() => openHistoryModal(item)}
                      className={`px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1 ${isDark ? "bg-slate-700 text-slate-300 hover:bg-slate-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
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
                        className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${isDark ? "bg-slate-700 text-slate-300 hover:bg-slate-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                      >
                        Edit
                      </button>
                    )}
                    {canEditEquipment && item.status === "available" && (
                      <button
                        onClick={() => openAssignModal(item)}
                        className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${isDark ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30" : "bg-blue-50 text-blue-600 hover:bg-blue-100"}`}
                      >
                        Assign
                      </button>
                    )}
                    {canEditEquipment && item.status === "assigned" && (
                      <>
                        <button
                          onClick={() => openReassignModal(item)}
                          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${isDark ? "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30" : "bg-purple-50 text-purple-600 hover:bg-purple-100"}`}
                        >
                          Reassign
                        </button>
                        <button
                          onClick={() => openReturnModal(item)}
                          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${isDark ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30" : "bg-amber-50 text-amber-600 hover:bg-amber-100"}`}
                        >
                          Return
                        </button>
                      </>
                    )}
                    {canEditEquipment && item.status !== "retired" && (
                      <button
                        onClick={() => openRetireModal(item._id as Id<"scanners"> | Id<"pickers">)}
                        className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${isDark ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-red-50 text-red-600 hover:bg-red-100"}`}
                      >
                        Retire
                      </button>
                    )}
                    {isSuperuser && (
                      <button
                        onClick={() => openDeleteModal(item)}
                        className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${isDark ? "bg-red-600/30 text-red-300 hover:bg-red-600/50" : "bg-red-100 text-red-700 hover:bg-red-200"}`}
                        title="Permanently delete (Superuser only)"
                      >
                        Delete
                      </button>
                    )}
                    {activeTab === "pickers" && (
                      <>
                        <button
                          onClick={() => openSafetyHistoryModal(item as NonNullable<typeof pickers>[0])}
                          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1 ${isDark ? "bg-green-500/20 text-green-400 hover:bg-green-500/30" : "bg-green-50 text-green-600 hover:bg-green-100"}`}
                          title="Safety Check History"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                          </svg>
                          Safety
                        </button>
                        <button
                          onClick={() => openQRModal(item as NonNullable<typeof pickers>[0])}
                          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1 ${isDark ? "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30" : "bg-purple-50 text-purple-600 hover:bg-purple-100"}`}
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
          )}
        </div>

        {/* Add/Edit Equipment Modal */}
        {showNewEquipment && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`border rounded-xl p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <h2 className={`text-xl font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                {editingId ? `Edit ${activeTab === "scanners" ? "Scanner" : "Picker"}` : `Add New ${activeTab === "scanners" ? "Scanner" : "Picker"}`}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Identifier *
                    </label>
                    <input
                      type="text"
                      value={formData.number}
                      onChange={(e) => setFormData({ ...formData, number: e.target.value })}
                      className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                      required
                      placeholder="e.g., 1, A-12, SC-001"
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      PIN
                    </label>
                    <input
                      type="text"
                      value={formData.pin}
                      onChange={(e) => setFormData({ ...formData, pin: e.target.value })}
                      className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                      placeholder="1234"
                    />
                  </div>
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Location *
                  </label>
                  <select
                    value={formData.locationId}
                    onChange={(e) => setFormData({ ...formData, locationId: e.target.value })}
                    className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                    required
                  >
                    <option value="">Select a location</option>
                    {locations?.map((loc) => (
                      <option key={loc._id} value={loc._id}>{loc.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Model
                  </label>
                  <input
                    type="text"
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                    placeholder="e.g., Zebra TC52"
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Serial Number
                  </label>
                  <input
                    type="text"
                    value={formData.serialNumber}
                    onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                    className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Purchase Date
                  </label>
                  <input
                    type="date"
                    value={formData.purchaseDate}
                    onChange={(e) => setFormData({ ...formData, purchaseDate: e.target.value })}
                    className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={2}
                    className={`w-full px-4 py-3 border rounded-lg focus:outline-none resize-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                    placeholder="General notes about this equipment"
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Condition Notes
                  </label>
                  <textarea
                    value={formData.conditionNotes}
                    onChange={(e) => setFormData({ ...formData, conditionNotes: e.target.value })}
                    rows={2}
                    className={`w-full px-4 py-3 border rounded-lg focus:outline-none resize-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                    placeholder="Current condition (e.g., screen scratched, battery weak)"
                  />
                </div>

                {editingId && (
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Status
                    </label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                      className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                    >
                      {EQUIPMENT_STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewEquipment(false);
                      setEditingId(null);
                      resetForm();
                    }}
                    className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                  >
                    {editingId ? "Update" : "Create"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Retire Equipment Modal */}
        {showRetireModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`border rounded-xl p-4 sm:p-6 w-full max-w-md ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <h2 className={`text-xl font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                Retire {activeTab === "scanners" ? "Scanner" : "Picker"}
              </h2>
              <p className={`text-sm mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                This will mark the equipment as retired and remove any current assignment. This action cannot be undone.
              </p>
              <div className="space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Reason for Retirement *
                  </label>
                  <textarea
                    value={retireReason}
                    onChange={(e) => setRetireReason(e.target.value)}
                    rows={3}
                    className={`w-full px-4 py-3 border rounded-lg focus:outline-none resize-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                    placeholder="e.g., Damaged beyond repair, obsolete model, lost"
                    required
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowRetireModal(false);
                      setRetireId(null);
                      setRetireReason("");
                    }}
                    className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleRetire}
                    disabled={!retireReason.trim()}
                    className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "bg-red-500 text-white hover:bg-red-600" : "bg-red-600 text-white hover:bg-red-700"}`}
                  >
                    Retire Equipment
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Delete Equipment Modal (Superuser Only) */}
        {showDeleteModal && isSuperuser && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`border rounded-xl p-4 sm:p-6 w-full max-w-md ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`p-3 rounded-full ${isDark ? "bg-red-500/20" : "bg-red-100"}`}>
                  <svg className={`w-6 h-6 ${isDark ? "text-red-400" : "text-red-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <div>
                  <h2 className={`text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                    Delete {activeTab === "scanners" ? "Scanner" : "Picker"}
                  </h2>
                  <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    #{deleteNumber}
                  </p>
                </div>
              </div>

              <div className={`p-4 rounded-lg mb-4 ${isDark ? "bg-red-500/10 border border-red-500/30" : "bg-red-50 border border-red-200"}`}>
                <p className={`text-sm font-medium ${isDark ? "text-red-400" : "text-red-700"}`}>
                  Warning: This action cannot be undone!
                </p>
                <p className={`text-sm mt-1 ${isDark ? "text-red-300/80" : "text-red-600"}`}>
                  This will permanently delete this equipment and all associated records including:
                </p>
                <ul className={`text-sm mt-2 ml-4 list-disc ${isDark ? "text-red-300/80" : "text-red-600"}`}>
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
                  className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-slate-700 text-slate-300 hover:bg-slate-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex-1 px-4 py-3 font-medium rounded-lg transition-colors bg-red-600 text-white hover:bg-red-700"
                >
                  Delete Permanently
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Assign Equipment Modal */}
        {showAssignModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`border rounded-xl p-4 sm:p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className={`text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Assign {activeTab === "scanners" ? "Scanner" : "Picker"} #{assignEquipmentData?.number}
                </h2>
                <button
                  onClick={() => {
                    setShowAssignModal(false);
                    setAssignEquipmentId(null);
                    setAssignEquipmentData(null);
                    setSelectedPersonnelId("");
                    setSignatureData(null);
                    setAssignStep("select");
                  }}
                  className={`p-1 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"}`}
                >
                  <svg className={`w-5 h-5 ${isDark ? "text-slate-400" : "text-gray-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {assignStep === "select" ? (
                <>
                  <p className={`text-sm mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Select an employee to assign this equipment. They will need to sign an equipment responsibility agreement.
                  </p>
                  <div className="space-y-4">
                    <div>
                      <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        Assign to Employee *
                      </label>
                      <select
                        value={selectedPersonnelId}
                        onChange={(e) => setSelectedPersonnelId(e.target.value)}
                        className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                      >
                        <option value="">Select an employee</option>
                        {activePersonnel
                          ?.slice()
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((person) => (
                          <option key={person._id} value={person._id}>
                            {person.name} - {person.position} ({person.department})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex gap-3 pt-4">
                      <button
                        type="button"
                        onClick={() => {
                          setShowAssignModal(false);
                          setAssignEquipmentId(null);
                          setAssignEquipmentData(null);
                          setSelectedPersonnelId("");
                        }}
                        className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => setAssignStep("sign")}
                        disabled={!selectedPersonnelId}
                        className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                      >
                        Continue to Agreement
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className={`mb-4 p-3 rounded-lg ${isDark ? "bg-slate-700/50" : "bg-blue-50"}`}>
                    <p className={`text-sm font-medium ${isDark ? "text-cyan-400" : "text-blue-700"}`}>
                      Assigning to: {activePersonnel?.find(p => p._id === selectedPersonnelId)?.name}
                    </p>
                  </div>

                  <div className={`mb-4 p-4 rounded-lg border max-h-64 overflow-y-auto ${isDark ? "bg-slate-900/50 border-slate-600" : "bg-gray-50 border-gray-200"}`}>
                    <pre className={`text-xs whitespace-pre-wrap font-mono ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      {getAgreementText()}
                    </pre>
                  </div>

                  <div className="mb-4">
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Employee Signature *
                    </label>
                    <p className={`text-xs mb-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Have the employee sign below to acknowledge the equipment responsibility agreement.
                    </p>
                    <SignaturePad
                      onSignatureChange={setSignatureData}
                      width={500}
                      height={150}
                    />
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setAssignStep("select");
                        setSignatureData(null);
                      }}
                      className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleAssign}
                      disabled={!signatureData}
                      className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                    >
                      Assign Equipment
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Return Equipment Modal */}
        {showReturnModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`border rounded-xl p-4 sm:p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className={`text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Return {activeTab === "scanners" ? "Scanner" : "Picker"} #{returnEquipmentData?.number}
                </h2>
                <button
                  onClick={() => {
                    setShowReturnModal(false);
                    setReturnEquipmentId(null);
                    setReturnEquipmentData(null);
                  }}
                  className={`p-1 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"}`}
                >
                  <svg className={`w-5 h-5 ${isDark ? "text-slate-400" : "text-gray-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className={`mb-4 p-3 rounded-lg ${isDark ? "bg-slate-700/50" : "bg-amber-50"}`}>
                <p className={`text-sm ${isDark ? "text-amber-400" : "text-amber-700"}`}>
                  <span className="font-medium">Returning from:</span> {returnEquipmentData?.assignedPersonName || "Unknown"}
                </p>
              </div>

              <div className="space-y-6">
                {/* Condition Checklist */}
                <div>
                  <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>
                    Condition Checklist
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { key: "physicalCondition", label: "No physical damage" },
                      { key: "screenFunctional", label: "Screen works properly" },
                      { key: "buttonsWorking", label: "All buttons responsive" },
                      { key: "batteryCondition", label: "Battery holds charge" },
                      { key: "chargingPortOk", label: "Charging port undamaged" },
                      { key: "scannerFunctional", label: "Scanning works" },
                      { key: "cleanCondition", label: "Equipment is clean" },
                    ].map((item) => (
                      <label
                        key={item.key}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          checklist[item.key as keyof typeof checklist]
                            ? isDark ? "bg-green-500/10 border-green-500/30" : "bg-green-50 border-green-200"
                            : isDark ? "bg-red-500/10 border-red-500/30" : "bg-red-50 border-red-200"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checklist[item.key as keyof typeof checklist]}
                          onChange={(e) => setChecklist({ ...checklist, [item.key]: e.target.checked })}
                          className="w-4 h-4 rounded"
                        />
                        <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                          {item.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Overall Condition */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Overall Condition
                  </label>
                  <select
                    value={overallCondition}
                    onChange={(e) => setOverallCondition(e.target.value)}
                    className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                  >
                    <option value="excellent">Excellent - Like new</option>
                    <option value="good">Good - Normal wear</option>
                    <option value="fair">Fair - Some issues</option>
                    <option value="poor">Poor - Multiple issues</option>
                    <option value="damaged">Damaged - Needs repair</option>
                  </select>
                </div>

                {/* Damage Notes */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Damage Notes (if any)
                  </label>
                  <textarea
                    value={damageNotes}
                    onChange={(e) => setDamageNotes(e.target.value)}
                    rows={2}
                    className={`w-full px-4 py-3 border rounded-lg focus:outline-none resize-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                    placeholder="Describe any damage or issues found..."
                  />
                </div>

                {/* Toggles */}
                <div className="space-y-3">
                  <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${isDark ? "border-slate-600" : "border-gray-200"}`}>
                    <input
                      type="checkbox"
                      checked={repairRequired}
                      onChange={(e) => {
                        setRepairRequired(e.target.checked);
                        if (e.target.checked) setReadyForReassignment(false);
                      }}
                      className="w-4 h-4 rounded"
                    />
                    <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Repair required before next use
                    </span>
                  </label>

                  <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${isDark ? "border-slate-600" : "border-gray-200"}`}>
                    <input
                      type="checkbox"
                      checked={readyForReassignment}
                      onChange={(e) => setReadyForReassignment(e.target.checked)}
                      disabled={repairRequired}
                      className="w-4 h-4 rounded disabled:opacity-50"
                    />
                    <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"} ${repairRequired ? "opacity-50" : ""}`}>
                      Ready for reassignment
                    </span>
                  </label>

                  <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${isDark ? "border-slate-600" : "border-gray-200"}`}>
                    <input
                      type="checkbox"
                      checked={deductionRequired}
                      onChange={(e) => setDeductionRequired(e.target.checked)}
                      className="w-4 h-4 rounded"
                    />
                    <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Pay deduction required for damage
                    </span>
                  </label>

                  {deductionRequired && (
                    <div className="ml-7">
                      <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        Deduction Amount
                      </label>
                      <div className="flex items-center gap-2">
                        <span className={`${isDark ? "text-slate-400" : "text-gray-500"}`}>$</span>
                        <input
                          type="number"
                          value={deductionAmount}
                          onChange={(e) => setDeductionAmount(Math.min(EQUIPMENT_VALUE, Math.max(0, Number(e.target.value))))}
                          max={EQUIPMENT_VALUE}
                          min={0}
                          className={`w-32 px-4 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        />
                        <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                          (max ${EQUIPMENT_VALUE})
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 pt-4 border-t border-slate-700/50">
                  <button
                    type="button"
                    onClick={() => {
                      setShowReturnModal(false);
                      setReturnEquipmentId(null);
                      setReturnEquipmentData(null);
                    }}
                    className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleReturn}
                    className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-amber-600 text-white hover:bg-amber-700"}`}
                  >
                    Complete Return
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Reassign Equipment Modal */}
        {showReassignModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`border rounded-xl p-4 sm:p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className={`text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                    Reassign {activeTab === "scanners" ? "Scanner" : "Picker"} #{reassignEquipmentData?.number}
                  </h2>
                  <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Step {reassignStep === "condition" ? "1" : "2"} of 2: {reassignStep === "condition" ? "Condition Check & Sign-off" : "New Assignment"}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowReassignModal(false);
                    setReassignEquipmentId(null);
                    setReassignEquipmentData(null);
                  }}
                  className={`p-1 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"}`}
                >
                  <svg className={`w-5 h-5 ${isDark ? "text-slate-400" : "text-gray-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Current Assignee Info */}
              <div className={`mb-4 p-3 rounded-lg ${isDark ? "bg-purple-500/10 border border-purple-500/30" : "bg-purple-50 border border-purple-200"}`}>
                <p className={`text-sm ${isDark ? "text-purple-400" : "text-purple-700"}`}>
                  <span className="font-medium">Currently assigned to:</span> {reassignEquipmentData?.assignedPersonName || "Unknown"}
                </p>
              </div>

              {reassignStep === "condition" ? (
                <div className="space-y-6">
                  {/* Condition Checklist */}
                  <div>
                    <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>
                      Condition Checklist
                    </h3>
                    <p className={`text-xs mb-3 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Verify the condition of the equipment before reassigning to a new user.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[
                        { key: "physicalCondition", label: "No physical damage" },
                        { key: "screenFunctional", label: "Screen works properly" },
                        { key: "buttonsWorking", label: "All buttons responsive" },
                        { key: "batteryCondition", label: "Battery holds charge" },
                        { key: "chargingPortOk", label: "Charging port undamaged" },
                        { key: "scannerFunctional", label: "Scanning works" },
                        { key: "cleanCondition", label: "Equipment is clean" },
                      ].map((item) => (
                        <label
                          key={item.key}
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            reassignChecklist[item.key as keyof typeof reassignChecklist]
                              ? isDark ? "bg-green-500/10 border-green-500/30" : "bg-green-50 border-green-200"
                              : isDark ? "bg-red-500/10 border-red-500/30" : "bg-red-50 border-red-200"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={reassignChecklist[item.key as keyof typeof reassignChecklist]}
                            onChange={(e) => setReassignChecklist({ ...reassignChecklist, [item.key]: e.target.checked })}
                            className="w-4 h-4 rounded"
                          />
                          <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                            {item.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Overall Condition */}
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Overall Condition
                    </label>
                    <select
                      value={reassignOverallCondition}
                      onChange={(e) => setReassignOverallCondition(e.target.value)}
                      className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                    >
                      <option value="excellent">Excellent - Like new</option>
                      <option value="good">Good - Normal wear</option>
                      <option value="fair">Fair - Some issues</option>
                      <option value="poor">Poor - Multiple issues</option>
                      <option value="damaged">Damaged - Needs repair</option>
                    </select>
                  </div>

                  {/* Damage Notes */}
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Damage Notes (if any)
                    </label>
                    <textarea
                      value={reassignDamageNotes}
                      onChange={(e) => setReassignDamageNotes(e.target.value)}
                      rows={2}
                      className={`w-full px-4 py-3 border rounded-lg focus:outline-none resize-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                      placeholder="Describe any damage or issues found..."
                    />
                  </div>

                  {/* Toggles */}
                  <div className="space-y-3">
                    <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${isDark ? "border-slate-600" : "border-gray-200"}`}>
                      <input
                        type="checkbox"
                        checked={reassignRepairRequired}
                        onChange={(e) => setReassignRepairRequired(e.target.checked)}
                        className="w-4 h-4 rounded"
                      />
                      <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        Repair required (cannot reassign if checked)
                      </span>
                    </label>

                    <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${isDark ? "border-slate-600" : "border-gray-200"}`}>
                      <input
                        type="checkbox"
                        checked={reassignDeductionRequired}
                        onChange={(e) => setReassignDeductionRequired(e.target.checked)}
                        className="w-4 h-4 rounded"
                      />
                      <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        Pay deduction required for damage
                      </span>
                    </label>

                    {reassignDeductionRequired && (
                      <div className="ml-7">
                        <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                          Deduction Amount
                        </label>
                        <div className="flex items-center gap-2">
                          <span className={`${isDark ? "text-slate-400" : "text-gray-500"}`}>$</span>
                          <input
                            type="number"
                            value={reassignDeductionAmount}
                            onChange={(e) => setReassignDeductionAmount(Math.min(EQUIPMENT_VALUE, Math.max(0, Number(e.target.value))))}
                            max={EQUIPMENT_VALUE}
                            min={0}
                            className={`w-32 px-4 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                          />
                          <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                            (max ${EQUIPMENT_VALUE})
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Manager Sign-off Signature */}
                  <div>
                    <h3 className={`text-sm font-semibold mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                      Manager Sign-off
                    </h3>
                    <p className={`text-xs mb-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Sign below to confirm the condition check of this equipment.
                    </p>
                    <SignaturePad
                      onSignatureChange={setReassignSignOffSignature}
                      width={500}
                      height={120}
                      label="Manager Signature"
                    />
                  </div>

                  <div className="flex gap-3 pt-4 border-t border-slate-700/50">
                    <button
                      type="button"
                      onClick={() => {
                        setShowReassignModal(false);
                        setReassignEquipmentId(null);
                        setReassignEquipmentData(null);
                      }}
                      className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => setReassignStep("assign")}
                      disabled={!reassignSignOffSignature || reassignRepairRequired}
                      className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "bg-purple-500 text-white hover:bg-purple-600" : "bg-purple-600 text-white hover:bg-purple-700"}`}
                    >
                      {reassignRepairRequired ? "Cannot Reassign (Repair Required)" : "Continue to Assignment"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Condition Summary */}
                  <div className={`p-3 rounded-lg ${isDark ? "bg-slate-700/50" : "bg-gray-50"}`}>
                    <p className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      <span className="font-medium">Condition verified:</span> {reassignOverallCondition}
                      {reassignDamageNotes && ` - ${reassignDamageNotes}`}
                    </p>
                  </div>

                  {/* Select New Assignee */}
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Assign to New Employee *
                    </label>
                    <select
                      value={reassignNewPersonnelId}
                      onChange={(e) => {
                        setReassignNewPersonnelId(e.target.value);
                        setReassignNewPersonnelSignature(null);
                      }}
                      className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                    >
                      <option value="">Select an employee</option>
                      {activePersonnel
                        ?.slice()
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((person) => (
                        <option key={person._id} value={person._id}>
                          {person.name} - {person.position} ({person.department})
                        </option>
                      ))}
                    </select>
                  </div>

                  {reassignNewPersonnelId && (
                    <>
                      {/* Equipment Agreement */}
                      <div className={`p-4 rounded-lg border max-h-48 overflow-y-auto ${isDark ? "bg-slate-900/50 border-slate-600" : "bg-gray-50 border-gray-200"}`}>
                        <pre className={`text-xs whitespace-pre-wrap font-mono ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                          {getReassignAgreementText()}
                        </pre>
                      </div>

                      {/* New Employee Signature */}
                      <div>
                        <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                          New Employee Signature *
                        </label>
                        <p className={`text-xs mb-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          Have the new employee sign below to acknowledge the equipment responsibility agreement.
                        </p>
                        <SignaturePad
                          onSignatureChange={setReassignNewPersonnelSignature}
                          width={500}
                          height={120}
                        />
                      </div>
                    </>
                  )}

                  <div className="flex gap-3 pt-4 border-t border-slate-700/50">
                    <button
                      type="button"
                      onClick={() => {
                        setReassignStep("condition");
                        setReassignNewPersonnelSignature(null);
                      }}
                      className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleReassign}
                      disabled={!reassignNewPersonnelId || !reassignNewPersonnelSignature}
                      className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "bg-purple-500 text-white hover:bg-purple-600" : "bg-purple-600 text-white hover:bg-purple-700"}`}
                    >
                      Complete Reassignment
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Equipment History Modal */}
        {showHistoryModal && historyEquipmentId && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`border rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className={`text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  {activeTab === "scanners" ? "Scanner" : "Picker"} #{historyEquipmentNumber} - History
                </h2>
                <button
                  onClick={() => {
                    setShowHistoryModal(false);
                    setHistoryEquipmentId(null);
                    setHistoryEquipmentNumber("");
                  }}
                  className={`p-1 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"}`}
                >
                  <svg className={`w-5 h-5 ${isDark ? "text-slate-400" : "text-gray-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {!equipmentHistory ? (
                <div className={`text-center py-12 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Loading...
                </div>
              ) : equipmentHistory.length === 0 ? (
                <div className={`text-center py-12 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                  <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p>No history recorded for this equipment</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {equipmentHistory.map((record) => (
                    <div
                      key={record._id}
                      className={`rounded-lg p-4 ${isDark ? "bg-slate-700/50 border border-slate-600" : "bg-gray-50 border border-gray-200"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                            record.action === "assigned"
                              ? "bg-green-500/20 text-green-400"
                              : record.action === "unassigned"
                              ? "bg-amber-500/20 text-amber-400"
                              : record.action === "status_change"
                              ? "bg-blue-500/20 text-blue-400"
                              : record.action === "condition_check"
                              ? "bg-purple-500/20 text-purple-400"
                              : "bg-slate-500/20 text-slate-400"
                          }`}>
                            {record.action === "assigned" ? (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                              </svg>
                            ) : record.action === "unassigned" ? (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" />
                              </svg>
                            ) : record.action === "status_change" ? (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                              </svg>
                            )}
                          </div>
                          <div>
                            <p className={`font-medium text-sm ${isDark ? "text-white" : "text-gray-900"}`}>
                              {record.action === "assigned" && "Assigned"}
                              {record.action === "unassigned" && "Returned/Unassigned"}
                              {record.action === "status_change" && "Status Changed"}
                              {record.action === "condition_check" && "Condition Check"}
                            </p>
                            <p className={`text-xs mt-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              {new Date(record.createdAt).toLocaleDateString()} at {new Date(record.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-medium shrink-0 ${
                          record.action === "assigned"
                            ? isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-700"
                            : record.action === "unassigned"
                            ? isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-700"
                            : isDark ? "bg-blue-500/20 text-blue-400" : "bg-blue-100 text-blue-700"
                        }`}>
                          {record.action.replace("_", " ")}
                        </span>
                      </div>

                      <div className={`mt-3 text-sm space-y-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        {record.previousAssigneeName && (
                          <p>
                            <span className={`${isDark ? "text-slate-500" : "text-gray-500"}`}>From:</span>{" "}
                            {record.previousAssigneeName}
                          </p>
                        )}
                        {record.newAssigneeName && (
                          <p>
                            <span className={`${isDark ? "text-slate-500" : "text-gray-500"}`}>To:</span>{" "}
                            {record.newAssigneeName}
                          </p>
                        )}
                        {record.previousStatus && record.newStatus && record.previousStatus !== record.newStatus && (
                          <p>
                            <span className={`${isDark ? "text-slate-500" : "text-gray-500"}`}>Status:</span>{" "}
                            {record.previousStatus} → {record.newStatus}
                          </p>
                        )}
                        {record.notes && (
                          <p className={`${isDark ? "text-slate-400" : "text-gray-600"}`}>
                            {record.notes}
                          </p>
                        )}
                        <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                          By: {record.performedByName}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6">
                <button
                  onClick={() => {
                    setShowHistoryModal(false);
                    setHistoryEquipmentId(null);
                    setHistoryEquipmentNumber("");
                  }}
                  className={`w-full px-4 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* QR Code Modal */}
        {showQRModal && qrEquipment && (
          <QRCodeModal
            isOpen={showQRModal}
            onClose={() => {
              setShowQRModal(false);
              setQREquipment(null);
            }}
            equipmentType={qrEquipment.type}
            equipmentId={qrEquipment.id}
            equipmentNumber={qrEquipment.number}
            locationName={qrEquipment.locationName}
            isDark={isDark}
          />
        )}

        {/* Vehicle Form Modal */}
        {showNewVehicle && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`border rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className="flex items-center justify-between mb-6">
                <h2 className={`text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  {editingVehicleId ? "Edit Vehicle" : "Add New Vehicle"}
                </h2>
                <button
                  onClick={() => {
                    setShowNewVehicle(false);
                    setEditingVehicleId(null);
                  }}
                  className={`p-1 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"}`}
                >
                  <svg className={`w-5 h-5 ${isDark ? "text-slate-400" : "text-gray-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                  <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>Vehicle Identification</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>VIN *</label>
                      <input
                        type="text"
                        value={vehicleFormData.vin}
                        onChange={(e) => setVehicleFormData({ ...vehicleFormData, vin: e.target.value.toUpperCase() })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="17-character VIN"
                        maxLength={17}
                        required
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Plate Number</label>
                      <input
                        type="text"
                        value={vehicleFormData.plateNumber}
                        onChange={(e) => setVehicleFormData({ ...vehicleFormData, plateNumber: e.target.value.toUpperCase() })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="License plate"
                      />
                    </div>
                  </div>
                </div>

                {/* Vehicle Details */}
                <div>
                  <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>Vehicle Details</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Year</label>
                      <input
                        type="number"
                        value={vehicleFormData.year}
                        onChange={(e) => setVehicleFormData({ ...vehicleFormData, year: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="2024"
                        min="1900"
                        max="2100"
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Make *</label>
                      <input
                        type="text"
                        value={vehicleFormData.make}
                        onChange={(e) => setVehicleFormData({ ...vehicleFormData, make: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="Ford"
                        required
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Model *</label>
                      <input
                        type="text"
                        value={vehicleFormData.model}
                        onChange={(e) => setVehicleFormData({ ...vehicleFormData, model: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="F-150"
                        required
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Trim</label>
                      <input
                        type="text"
                        value={vehicleFormData.trim}
                        onChange={(e) => setVehicleFormData({ ...vehicleFormData, trim: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="XLT"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Color</label>
                      <input
                        type="text"
                        value={vehicleFormData.color}
                        onChange={(e) => setVehicleFormData({ ...vehicleFormData, color: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="White"
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Fuel Type</label>
                      <select
                        value={vehicleFormData.fuelType}
                        onChange={(e) => setVehicleFormData({ ...vehicleFormData, fuelType: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                      >
                        <option value="">Select...</option>
                        <option value="gasoline">Gasoline</option>
                        <option value="diesel">Diesel</option>
                        <option value="electric">Electric</option>
                        <option value="hybrid">Hybrid</option>
                      </select>
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Current Mileage</label>
                      <input
                        type="number"
                        value={vehicleFormData.currentMileage}
                        onChange={(e) => setVehicleFormData({ ...vehicleFormData, currentMileage: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="50000"
                      />
                    </div>
                  </div>
                </div>

                {/* Location */}
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Location</label>
                  <select
                    value={vehicleFormData.locationId}
                    onChange={(e) => setVehicleFormData({ ...vehicleFormData, locationId: e.target.value })}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                  >
                    <option value="">Select location...</option>
                    {locations?.map((loc) => (
                      <option key={loc._id} value={loc._id}>{loc.name}</option>
                    ))}
                  </select>
                </div>

                {/* Insurance & Registration */}
                <div>
                  <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>Insurance & Registration</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Insurance Provider</label>
                      <input
                        type="text"
                        value={vehicleFormData.insuranceProvider}
                        onChange={(e) => setVehicleFormData({ ...vehicleFormData, insuranceProvider: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="State Farm"
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Policy Number</label>
                      <input
                        type="text"
                        value={vehicleFormData.insurancePolicyNumber}
                        onChange={(e) => setVehicleFormData({ ...vehicleFormData, insurancePolicyNumber: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="Policy #"
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Insurance Expiration</label>
                      <input
                        type="date"
                        value={vehicleFormData.insuranceExpirationDate}
                        onChange={(e) => setVehicleFormData({ ...vehicleFormData, insuranceExpirationDate: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Registration Expiration</label>
                      <input
                        type="date"
                        value={vehicleFormData.registrationExpirationDate}
                        onChange={(e) => setVehicleFormData({ ...vehicleFormData, registrationExpirationDate: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Registration State</label>
                      <input
                        type="text"
                        value={vehicleFormData.registrationState}
                        onChange={(e) => setVehicleFormData({ ...vehicleFormData, registrationState: e.target.value.toUpperCase() })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="PA"
                        maxLength={2}
                      />
                    </div>
                  </div>
                </div>

                {/* Purchase Info */}
                <div>
                  <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>Purchase Info</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Purchase Date</label>
                      <input
                        type="date"
                        value={vehicleFormData.purchaseDate}
                        onChange={(e) => setVehicleFormData({ ...vehicleFormData, purchaseDate: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Purchase Price</label>
                      <input
                        type="number"
                        value={vehicleFormData.purchasePrice}
                        onChange={(e) => setVehicleFormData({ ...vehicleFormData, purchasePrice: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="35000"
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Purchased From</label>
                      <input
                        type="text"
                        value={vehicleFormData.purchasedFrom}
                        onChange={(e) => setVehicleFormData({ ...vehicleFormData, purchasedFrom: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="Dealer name"
                      />
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Notes</label>
                  <textarea
                    value={vehicleFormData.notes}
                    onChange={(e) => setVehicleFormData({ ...vehicleFormData, notes: e.target.value })}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
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
                    className={`px-4 py-2 font-medium rounded-lg transition-colors ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`px-4 py-2 font-medium rounded-lg transition-colors ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                  >
                    {editingVehicleId ? "Save Changes" : "Add Vehicle"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Computer Form Modal */}
        {showNewComputer && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`border rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className="flex items-center justify-between mb-6">
                <h2 className={`text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  {editingComputerId ? "Edit Computer" : "Add New Computer"}
                </h2>
                <button
                  onClick={() => {
                    setShowNewComputer(false);
                    setEditingComputerId(null);
                    resetComputerForm();
                  }}
                  className={`p-1 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"}`}
                >
                  <svg className={`w-5 h-5 ${isDark ? "text-slate-400" : "text-gray-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                  <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>Basic Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Identifier *</label>
                      <input
                        type="text"
                        value={computerFormData.name}
                        onChange={(e) => setComputerFormData({ ...computerFormData, name: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="e.g., OFFICE-PC-01, FRONT-DESK"
                        required
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Type</label>
                      <select
                        value={computerFormData.type}
                        onChange={(e) => setComputerFormData({ ...computerFormData, type: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                      >
                        <option value="computer">Desktop Computer</option>
                        <option value="laptop">Laptop</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Location</label>
                      <select
                        value={computerFormData.locationId}
                        onChange={(e) => setComputerFormData({ ...computerFormData, locationId: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
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
                  <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>Passwords</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Admin Password</label>
                      <input
                        type="text"
                        value={computerFormData.adminPassword}
                        onChange={(e) => setComputerFormData({ ...computerFormData, adminPassword: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="Admin account password"
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>User Password</label>
                      <input
                        type="text"
                        value={computerFormData.userPassword}
                        onChange={(e) => setComputerFormData({ ...computerFormData, userPassword: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="Standard user password"
                      />
                    </div>
                  </div>
                </div>

                {/* Network */}
                <div>
                  <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>Network</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>IP Address</label>
                      <input
                        type="text"
                        value={computerFormData.ipAddress}
                        onChange={(e) => setComputerFormData({ ...computerFormData, ipAddress: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="192.168.1.100"
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Ethernet Port (if applicable)</label>
                      <input
                        type="text"
                        value={computerFormData.ethernetPort}
                        onChange={(e) => setComputerFormData({ ...computerFormData, ethernetPort: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="e.g., Port 12, Patch A-5"
                      />
                    </div>
                  </div>
                </div>

                {/* Remote Access */}
                <div>
                  <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>Remote Access</h3>
                  <div className={`p-3 rounded-lg mb-4 ${isDark ? "bg-amber-500/10 border border-amber-500/30" : "bg-amber-50 border border-amber-200"}`}>
                    <p className={`text-sm ${isDark ? "text-amber-400" : "text-amber-700"}`}>
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
                      <label htmlFor="remoteAccessEnabled" className={`text-sm font-medium ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        Remote Access Enabled
                      </label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Chrome Remote Desktop ID</label>
                        <input
                          type="text"
                          value={computerFormData.chromeRemoteId}
                          onChange={(e) => setComputerFormData({ ...computerFormData, chromeRemoteId: e.target.value })}
                          className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                          placeholder="Session ID"
                        />
                      </div>
                      <div>
                        <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Remote Access Code</label>
                        <input
                          type="text"
                          value={computerFormData.remoteAccessCode}
                          onChange={(e) => setComputerFormData({ ...computerFormData, remoteAccessCode: e.target.value })}
                          className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                          placeholder="PIN or access code"
                        />
                      </div>
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Remote Connection Notes</label>
                      <textarea
                        value={computerFormData.remoteAccessNotes}
                        onChange={(e) => setComputerFormData({ ...computerFormData, remoteAccessNotes: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        rows={2}
                        placeholder="Additional info for connecting remotely..."
                      />
                    </div>
                  </div>
                </div>

                {/* Hardware Details (Optional) */}
                <div>
                  <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>Hardware Details (Optional)</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Manufacturer</label>
                      <input
                        type="text"
                        value={computerFormData.manufacturer}
                        onChange={(e) => setComputerFormData({ ...computerFormData, manufacturer: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="Dell, HP, Lenovo..."
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Model</label>
                      <input
                        type="text"
                        value={computerFormData.model}
                        onChange={(e) => setComputerFormData({ ...computerFormData, model: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="OptiPlex 7080"
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Serial Number</label>
                      <input
                        type="text"
                        value={computerFormData.serialNumber}
                        onChange={(e) => setComputerFormData({ ...computerFormData, serialNumber: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        placeholder="Service tag / Serial #"
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Operating System</label>
                      <select
                        value={computerFormData.operatingSystem}
                        onChange={(e) => setComputerFormData({ ...computerFormData, operatingSystem: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
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
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Notes</label>
                  <textarea
                    value={computerFormData.notes}
                    onChange={(e) => setComputerFormData({ ...computerFormData, notes: e.target.value })}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
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
                    className={`px-4 py-2 font-medium rounded-lg transition-colors ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`px-4 py-2 font-medium rounded-lg transition-colors ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                  >
                    {editingComputerId ? "Save Changes" : "Add Computer"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Safety History Modal */}
        {showSafetyHistoryModal && safetyHistoryEquipment && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`border rounded-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className={`text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Safety Check History - Picker #{safetyHistoryEquipment.number}
                </h2>
                <button
                  onClick={() => {
                    setShowSafetyHistoryModal(false);
                    setSafetyHistoryEquipment(null);
                  }}
                  className={`p-1 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"}`}
                >
                  <svg className={`w-5 h-5 ${isDark ? "text-slate-400" : "text-gray-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {!safetyCompletions ? (
                <div className={`text-center py-12 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Loading...
                </div>
              ) : safetyCompletions.length === 0 ? (
                <div className={`text-center py-12 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                  <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  <p>No safety checks recorded for this picker</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {safetyCompletions.map((completion) => (
                    <div
                      key={completion._id}
                      className={`rounded-lg p-4 ${isDark ? "bg-slate-700/50 border border-slate-600" : "bg-gray-50 border border-gray-200"}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                            completion.allPassed
                              ? "bg-green-500/20 text-green-400"
                              : "bg-red-500/20 text-red-400"
                          }`}>
                            {completion.allPassed ? (
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                            )}
                          </div>
                          <div>
                            <p className={`font-medium text-sm ${isDark ? "text-white" : "text-gray-900"}`}>
                              {completion.personnelName}
                            </p>
                            <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              {new Date(completion.completedAt).toLocaleDateString()} at {new Date(completion.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          completion.allPassed
                            ? isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-700"
                            : isDark ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-700"
                        }`}>
                          {completion.allPassed ? "Passed" : "Issues"}
                        </span>
                      </div>

                      <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        <span className="font-medium">Duration:</span> {Math.floor(completion.totalTimeSpent / 60)}m {completion.totalTimeSpent % 60}s
                        <span className="mx-2">•</span>
                        <span className="font-medium">Items:</span> {completion.responses.length}
                      </div>

                      {completion.issues && completion.issues.length > 0 && (
                        <div className={`mt-2 pt-2 border-t ${isDark ? "border-slate-600" : "border-gray-200"}`}>
                          <p className={`text-xs font-medium mb-1 ${isDark ? "text-red-400" : "text-red-600"}`}>Issues:</p>
                          {completion.issues.map((issue: { itemId: string; description: string }, idx: number) => (
                            <p key={idx} className={`text-xs ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                              • {issue.description}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6">
                <button
                  onClick={() => {
                    setShowSafetyHistoryModal(false);
                    setSafetyHistoryEquipment(null);
                  }}
                  className={`w-full px-4 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function EquipmentPage() {
  return (
    <Protected minTier={2}>
      <EquipmentContent />
    </Protected>
  );
}
