"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Protected from "../../../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../../../theme-context";
import { useAuth } from "../../../auth-context";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import SignaturePad from "@/components/SignaturePad";
import { buildAgreementText, printAgreementPdf } from "@/lib/equipmentAgreementPdf";
import ScannerStatusDot, { getScannerHealth } from "../components/ScannerStatusDot";
import ScannerBatteryBar from "../components/ScannerBatteryBar";
import WifiSignalIcon from "../components/WifiSignalIcon";

type CommandType = "lock" | "unlock" | "wipe" | "install_apk" | "push_config" | "restart" | "update_pin";
const EQUIPMENT_VALUE = 100;

function ScannerDetailContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const scannerId = params.id as Id<"scanners">;

  // Tabs & command state
  const [activeTab, setActiveTab] = useState<"commands" | "history" | "conditions">("commands");
  const [showCommandModal, setShowCommandModal] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<CommandType | null>(null);
  const [commandPayload, setCommandPayload] = useState("");
  const [wipeConfirmText, setWipeConfirmText] = useState("");
  const [sending, setSending] = useState(false);

  // Assignment state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignStep, setAssignStep] = useState<1 | 2>(1);
  const [selectedPersonnelId, setSelectedPersonnelId] = useState<Id<"personnel"> | "">("");
  const [signatureData, setSignatureData] = useState("");
  // Paper-signing path: draw on screen, or print + upload a signed copy
  const [assignMethod, setAssignMethod] = useState<"draw" | "upload">("draw");
  const [uploadedDocId, setUploadedDocId] = useState<Id<"_storage"> | null>(null);
  const [uploadedDocType, setUploadedDocType] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [uploadingDoc, setUploadingDoc] = useState(false);

  // Return state
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnChecklist, setReturnChecklist] = useState({
    physicalCondition: true, screenFunctional: true, buttonsWorking: true,
    batteryCondition: true, chargingPortOk: true, scannerFunctional: true, cleanCondition: true,
  });
  const [overallCondition, setOverallCondition] = useState("good");
  const [damageNotes, setDamageNotes] = useState("");
  const [repairRequired, setRepairRequired] = useState(false);
  const [readyForReassignment, setReadyForReassignment] = useState(true);

  // PIN change state
  const [showPinModal, setShowPinModal] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [savingPin, setSavingPin] = useState(false);

  // Provision state
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [provisionStep, setProvisionStep] = useState<"confirm" | "generating" | "code" | "error">("confirm");
  const [provisionError, setProvisionError] = useState("");

  // Queries
  const scanner = useQuery(api.scannerMdm.getScannerDetail, { id: scannerId });
  const personnel = useQuery(api.equipment.listActivePersonnel);
  const provisionCode = useQuery(api.scannerMdm.getProvisionCode, { scannerId });
  const setupLogs = useQuery(api.scannerMdm.listSetupLogsByScanner, scannerId ? { scannerId, limit: 50 } : "skip");

  // Mutations
  const logCommand = useMutation(api.scannerMdm.logScannerCommand);
  const assignWithAgreement = useMutation(api.equipment.assignEquipmentWithAgreement);
  const returnWithCheck = useMutation(api.equipment.returnEquipmentWithCheck);
  const unassignScanner = useMutation(api.equipment.unassignScanner);
  const storePendingProvision = useMutation(api.scannerMdm.storePendingProvision);
  const updateScanner = useMutation(api.equipment.updateScanner);
  const deleteEquipment = useMutation(api.equipment.deleteEquipment);
  const generateAgreementUploadUrl = useMutation(api.equipment.generateAgreementUploadUrl);
  const attachSignedAgreement = useMutation(api.equipment.attachSignedAgreement);
  const agreement = useQuery(api.equipment.getEquipmentAgreement, { equipmentType: "scanner", equipmentId: scannerId });
  const signedDocUrl = useQuery(
    api.equipment.getSignedAgreementUrl,
    agreement?.signedDocumentStorageId ? { storageId: agreement.signedDocumentStorageId } : "skip"
  );

  const canEdit = user?.role === "super_admin" || user?.role === "admin" || user?.role === "warehouse_director" || user?.role === "warehouse_manager";
  const isSuperAdmin = user?.role === "super_admin";

  const timeAgo = (ts?: number) => {
    if (!ts) return "Never";
    const diff = Date.now() - ts;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  const formatDate = (ts?: number) => {
    if (!ts) return "--";
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  };

  // Command handlers
  const initiateCommand = (cmd: CommandType) => {
    setPendingCommand(cmd);
    setCommandPayload("");
    setWipeConfirmText("");
    setShowCommandModal(true);
  };

  const executeCommand = async () => {
    if (!pendingCommand || !scanner || !user) return;
    if (pendingCommand === "wipe" && wipeConfirmText !== scanner.number) return;
    setSending(true);
    try {
      await logCommand({ scannerId, command: pendingCommand, payload: commandPayload || undefined, userId: user._id, userName: user.name ?? user.email });
      await fetch("/api/scanner-mdm/command", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thingName: scanner.iotThingName, command: pendingCommand, payload: commandPayload ? JSON.parse(commandPayload) : {}, scannerId, userId: user._id, confirmed: true }),
      });
      setShowCommandModal(false);
      setPendingCommand(null);
    } catch (err) { console.error("Command failed:", err); }
    finally { setSending(false); }
  };

  const handleProvision = async () => {
    if (!scanner || !user) return;
    setProvisionStep("generating");
    setProvisionError("");
    try {
      // Call provision Lambda to create IoT thing + certs
      const res = await fetch("/api/scanner-mdm/provision", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serialNumber: scanner.serialNumber ?? scanner.number,
          locationCode: scanner.locationName?.substring(0, 3) ?? "W08",
          scannerNumber: scanner.number,
          scannerId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Provision failed");
      }
      const data = await res.json();

      // Store certs with claim code in Convex
      await storePendingProvision({
        scannerId,
        thingName: data.thingName,
        thingArn: data.thingArn,
        certificateArn: data.certificateArn,
        certificatePem: data.certificatePem,
        privateKey: data.privateKey,
        iotEndpoint: data.iotEndpoint,
        userId: user._id,
      });

      setProvisionStep("code");
    } catch (err) {
      setProvisionError(err instanceof Error ? err.message : "Unknown error");
      setProvisionStep("error");
    }
  };

  // Assignment handlers
  const selectedPerson = personnel?.find((p) => p._id === selectedPersonnelId);

  const getAgreementText = () => {
    if (!scanner || !selectedPerson) return "";
    return buildAgreementText({
      personName: selectedPerson.name,
      equipmentNumber: scanner.number,
      serialNumber: scanner.serialNumber,
      equipmentValue: EQUIPMENT_VALUE,
    });
  };

  const handleAssign = async () => {
    if (!scanner || !user || !selectedPersonnelId) return;
    const hasProof = assignMethod === "draw" ? !!signatureData : !!uploadedDocId;
    if (!hasProof) return;
    setSending(true);
    try {
      await assignWithAgreement({
        equipmentType: "scanner", equipmentId: scannerId,
        personnelId: selectedPersonnelId as Id<"personnel">,
        ...(assignMethod === "draw"
          ? { signatureData }
          : { signedDocumentStorageId: uploadedDocId as Id<"_storage">, signedDocumentType: uploadedDocType }),
        userId: user._id, userName: user.name ?? user.email,
        equipmentValue: EQUIPMENT_VALUE,
      });
      setShowAssignModal(false);
      setAssignStep(1);
      setSelectedPersonnelId("");
      setSignatureData("");
      setAssignMethod("draw");
      setUploadedDocId(null); setUploadedDocType(""); setUploadedFileName("");
    } catch (err) { console.error("Assign failed:", err); }
    finally { setSending(false); }
  };

  // Upload a signed agreement file to Convex storage; returns the storage id + mime.
  const uploadSignedFile = async (file: File): Promise<{ storageId: Id<"_storage">; type: string }> => {
    if (!user) throw new Error("Not signed in");
    const url = await generateAgreementUploadUrl({ requestingUserId: user._id });
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
    if (!res.ok) throw new Error("Upload failed");
    const { storageId } = await res.json();
    return { storageId, type: file.type };
  };

  // Assign-flow: stash the uploaded signed copy until the user confirms assignment.
  const handleAssignFilePick = async (file: File) => {
    setUploadingDoc(true);
    try {
      const r = await uploadSignedFile(file);
      setUploadedDocId(r.storageId); setUploadedDocType(r.type); setUploadedFileName(file.name);
    } catch (err) { console.error("Signed-copy upload failed:", err); }
    finally { setUploadingDoc(false); }
  };

  // Existing assignment: attach a signed copy to the active agreement.
  const handleAttachSignedToExisting = async (file: File) => {
    if (!user) return;
    setUploadingDoc(true);
    try {
      const r = await uploadSignedFile(file);
      await attachSignedAgreement({
        equipmentType: "scanner", equipmentId: scannerId,
        signedDocumentStorageId: r.storageId, signedDocumentType: r.type, requestingUserId: user._id,
      });
    } catch (err) { console.error("Attach signed copy failed:", err); }
    finally { setUploadingDoc(false); }
  };

  // Print the pre-filled agreement (assign flow uses the selected person; existing uses the assignee).
  const printAgreementFor = (personName: string) => {
    if (!scanner) return;
    printAgreementPdf({
      personName,
      equipmentNumber: scanner.number,
      serialNumber: scanner.serialNumber,
      equipmentValue: agreement?.equipmentValue ?? EQUIPMENT_VALUE,
    });
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!scanner || !user || newStatus === scanner.status) return;
    try {
      await updateScanner({ id: scannerId, status: newStatus, requestingUserId: user._id });
    } catch (err) { console.error("Status update failed:", err); }
  };

  const handleDeleteScanner = async () => {
    if (!scanner || !user) return;
    if (!confirm(`Delete scanner ${scanner.number}? This permanently removes it and its history, agreements, and condition checks. This cannot be undone.`)) return;
    try {
      await deleteEquipment({ equipmentType: "scanner", equipmentId: scannerId, userId: user._id });
      router.push("/equipment/scanners");
    } catch (err) {
      console.error("Delete scanner failed:", err);
      alert("Failed to delete scanner. " + (err instanceof Error ? err.message : ""));
    }
  };

  const handleReturn = async () => {
    if (!scanner || !user) return;
    setSending(true);
    try {
      await returnWithCheck({
        equipmentType: "scanner", equipmentId: scannerId,
        checkedBy: user._id, checkedByName: user.name ?? user.email,
        checklist: returnChecklist, overallCondition,
        damageNotes: damageNotes || undefined, repairRequired,
        readyForReassignment: repairRequired ? false : readyForReassignment,
      });
      setShowReturnModal(false);
    } catch (err) { console.error("Return failed:", err); }
    finally { setSending(false); }
  };

  const handleQuickUnassign = async () => {
    if (!scanner || !user) return;
    if (!confirm(`Unassign scanner ${scanner.number} from ${scanner.assignedPersonName}?`)) return;
    try {
      await unassignScanner({ scannerId, userId: user._id });
    } catch (err) { console.error("Unassign failed:", err); }
  };

  if (!scanner) {
    return (
      <Protected><div className="flex h-screen"><Sidebar />
        <main className={`flex-1 flex items-center justify-center ${isDark ? "bg-slate-950" : "bg-gray-50"}`}>
          <MobileHeader /><div className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Loading scanner...</div>
        </main></div></Protected>
    );
  }

  const health = getScannerHealth(scanner);
  const isProvisioned = scanner.mdmStatus === "provisioned";
  const cardClass = `rounded-xl border p-5 ${isDark ? "bg-slate-900/50 border-slate-800" : "bg-white border-gray-200 shadow-sm"}`;
  const sectionTitle = `text-[11px] font-semibold uppercase tracking-widest mb-4 ${isDark ? "text-slate-500" : "text-gray-400"}`;
  const inputClass = `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`;

  const commandButtons: { cmd: CommandType; label: string; icon: string; color: string; requiresAdmin?: boolean; requiresDeviceOwner?: boolean }[] = [
    { cmd: "lock", label: "Lock", icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z", color: "amber" },
    { cmd: "unlock", label: "Unlock", icon: "M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z", color: "emerald" },
    { cmd: "update_pin", label: "Reset PIN", icon: "M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z", color: "blue", requiresDeviceOwner: true },
    { cmd: "install_apk", label: "Push Update", icon: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4", color: "cyan" },
    { cmd: "push_config", label: "Push Config", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z", color: "purple" },

    { cmd: "restart", label: "Restart", icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15", color: "slate" },
    { cmd: "wipe", label: "Factory Reset", icon: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16", color: "red", requiresAdmin: true },
  ];

  const cmdStatusColors: Record<string, string> = {
    sent: "text-blue-400 bg-blue-500/10", acknowledged: "text-cyan-400 bg-cyan-500/10",
    completed: "text-emerald-400 bg-emerald-500/10", failed: "text-red-400 bg-red-500/10", timeout: "text-amber-400 bg-amber-500/10",
  };

  return (
    <Protected>
      <div className="flex h-screen">
        <Sidebar />
        <main className={`flex-1 overflow-auto ${isDark ? "bg-slate-950" : "bg-gray-50"}`}>
          <MobileHeader />

          {/* Header */}
          <div className={`border-b ${isDark ? "border-slate-800" : "border-gray-200"}`}>
            <div className={`h-1 ${isDark ? "bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500" : "bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500"}`} />
            <div className="px-4 sm:px-6 lg:px-8 py-4">
              <button onClick={() => router.push("/equipment/scanners")} className={`flex items-center gap-1 text-xs mb-3 transition-colors ${isDark ? "text-slate-500 hover:text-slate-300" : "text-gray-400 hover:text-gray-600"}`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                Fleet
              </button>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ScannerStatusDot health={health} size="lg" />
                  <div>
                    <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Scanner {scanner.number}</h1>
                    <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      {scanner.locationName} &middot; {scanner.model ?? "Unknown"} &middot; {scanner.serialNumber ?? "No serial"}
                    </p>
                  </div>
                </div>
                {/* Assignment actions in header */}
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2">
                    {scanner.status === "available" && (
                      <button onClick={() => { setShowAssignModal(true); setAssignStep(1); setSelectedPersonnelId(""); setSignatureData(""); }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg ${isDark ? "bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25" : "bg-blue-50 text-blue-600 hover:bg-blue-100"}`}>
                        Assign
                      </button>
                    )}
                    {scanner.status === "assigned" && (
                      <>
                        <button onClick={() => setShowReturnModal(true)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg ${isDark ? "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25" : "bg-amber-50 text-amber-600 hover:bg-amber-100"}`}>
                          Return
                        </button>
                        <button onClick={handleQuickUnassign}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg ${isDark ? "bg-slate-700 text-slate-300 hover:bg-slate-600" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                          Unassign
                        </button>
                      </>
                    )}
                    {isSuperAdmin && (
                      <button onClick={handleDeleteScanner}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg ${isDark ? "bg-red-500/15 text-red-400 hover:bg-red-500/25" : "bg-red-50 text-red-600 hover:bg-red-100"}`}>
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="px-4 sm:px-6 lg:px-8 py-5">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

              {/* Left Column */}
              <div className="space-y-5">
                {/* Device Info */}
                <div className={cardClass}>
                  <h3 className={sectionTitle}>Device</h3>
                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    {scanner.deviceOwner ? (
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${isDark ? "bg-emerald-500/15 text-emerald-400" : "bg-green-50 text-green-600"}`}>Device Owner</span>
                    ) : (
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${isDark ? "bg-slate-800 text-slate-400" : "bg-gray-100 text-gray-500"}`}>Admin only</span>
                    )}
                    {scanner.pinManaged && (
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${isDark ? "bg-blue-500/15 text-blue-400" : "bg-blue-50 text-blue-600"}`}>PIN managed</span>
                    )}
                  </div>
                  <div className="space-y-2.5">
                    {[
                      { label: "Model", value: scanner.model },
                      { label: "Serial", value: scanner.serialNumber },
                      { label: "Android", value: scanner.androidVersion },
                      { label: "Agent", value: scanner.agentVersion ? `v${scanner.agentVersion}` : null },
                      { label: "IoT Name", value: scanner.iotThingName },
                      { label: "MDM", value: scanner.mdmStatus },
                    ].filter((r) => r.value).map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className={`text-[11px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>{label}</span>
                        <span className={`text-xs font-medium ${isDark ? "text-slate-300" : "text-gray-700"}`}>{value}</span>
                      </div>
                    ))}
                    {/* Status — editable for managers/admins */}
                    <div className="flex items-center justify-between">
                      <span className={`text-[11px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>Status</span>
                      {canEdit ? (
                        <select
                          value={scanner.status}
                          onChange={(e) => handleStatusChange(e.target.value)}
                          className={`text-xs font-medium rounded px-2 py-1 border ${isDark ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-white border-gray-300 text-gray-700"}`}
                        >
                          {["available", "assigned", "maintenance", "lost", "retired"].map((s) => (
                            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={`text-xs font-medium ${isDark ? "text-slate-300" : "text-gray-700"}`}>{scanner.status}</span>
                      )}
                    </div>
                    {/* PIN with change button */}
                    <div className="flex items-center justify-between">
                      <span className={`text-[11px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>System PIN</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-mono font-medium ${isDark ? "text-slate-300" : "text-gray-700"}`}>{scanner.pin || "Not set"}</span>
                        {canEdit && (
                          <button
                            onClick={() => { setShowPinModal(true); setNewPin(""); setConfirmPin(""); setPinError(""); }}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${isDark ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30" : "bg-blue-100 text-blue-700 hover:bg-blue-200"}`}
                          >
                            Change
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Assignment */}
                <div className={cardClass}>
                  <h3 className={sectionTitle}>Assignment</h3>
                  {scanner.assignedPersonName ? (
                    <>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${isDark ? "bg-blue-500/20 text-blue-400" : "bg-blue-100 text-blue-600"}`}>
                        {scanner.assignedPersonName.split(" ").map((n: string) => n[0]).join("")}
                      </div>
                      <div>
                        <div className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{scanner.assignedPersonName}</div>
                        <div className={`text-[11px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>Since {scanner.assignedAt ? formatDate(scanner.assignedAt) : "--"}</div>
                      </div>
                    </div>
                    {/* Agreement: print/reprint, attach a signed paper copy, view uploaded copy */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => printAgreementFor(scanner.assignedPersonName!)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${isDark ? "border-slate-700 text-slate-200 hover:bg-slate-700" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
                        🖨 Print agreement
                      </button>
                      <label className={`px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer ${isDark ? "border-slate-700 text-slate-200 hover:bg-slate-700" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
                        {uploadingDoc ? "Uploading…" : "Attach signed copy"}
                        <input type="file" accept="image/*,application/pdf" className="hidden" disabled={uploadingDoc}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAttachSignedToExisting(f); }} />
                      </label>
                      {agreement?.signedDocumentStorageId && signedDocUrl && (
                        <a href={signedDocUrl} target="_blank" rel="noopener noreferrer"
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg ${isDark ? "bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25" : "bg-blue-50 text-blue-600 hover:bg-blue-100"}`}>
                          View signed copy
                        </a>
                      )}
                    </div>
                    <p className={`mt-2 text-[11px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      {agreement?.signedDocumentStorageId
                        ? "Signed copy on file (uploaded)"
                        : agreement?.signatureData
                          ? "Signed on screen"
                          : "No signature on file"}
                    </p>
                    </>
                  ) : (
                    <p className={`text-sm ${isDark ? "text-slate-600" : "text-gray-400"}`}>Unassigned</p>
                  )}
                </div>

                {/* Location / GPS */}
                <div className={cardClass}>
                  <h3 className={sectionTitle}>Location</h3>
                  <div className={`text-sm font-medium mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>{scanner.locationName}</div>
                  {scanner.gpsLatitude && scanner.gpsLongitude ? (
                    <div>
                      <div className={`text-xs font-mono mb-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        {scanner.gpsLatitude.toFixed(6)}, {scanner.gpsLongitude.toFixed(6)}
                      </div>
                      <a
                        href={`https://maps.google.com/?q=${scanner.gpsLatitude},${scanner.gpsLongitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg ${isDark ? "bg-blue-500/10 text-blue-400 hover:bg-blue-500/20" : "bg-blue-50 text-blue-600 hover:bg-blue-100"}`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Open in Google Maps
                      </a>
                    </div>
                  ) : (
                    <p className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>GPS data not available yet</p>
                  )}
                </div>

                {/* Notes */}
                {(scanner.notes || scanner.conditionNotes) && (
                  <div className={cardClass}>
                    <h3 className={sectionTitle}>Notes</h3>
                    {scanner.notes && <p className={`text-sm mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{scanner.notes}</p>}
                    {scanner.conditionNotes && <p className={`text-sm px-3 py-2 rounded-lg ${isDark ? "bg-amber-500/10 text-amber-300" : "bg-amber-50 text-amber-700"}`}>{scanner.conditionNotes}</p>}
                  </div>
                )}
              </div>

              {/* Right Column */}
              <div className="lg:col-span-2 space-y-5">
                {/* Live Telemetry */}
                <div className={cardClass}>
                  <h3 className={sectionTitle}>Telemetry</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                    <div>
                      <div className={`text-[10px] uppercase tracking-wider mb-1 ${isDark ? "text-slate-600" : "text-gray-400"}`}>Battery</div>
                      <ScannerBatteryBar level={scanner.batteryLevel} size="md" showLabel />
                    </div>
                    <div>
                      <div className={`text-[10px] uppercase tracking-wider mb-1 ${isDark ? "text-slate-600" : "text-gray-400"}`}>WiFi</div>
                      <WifiSignalIcon signal={scanner.wifiSignal} showLabel />
                    </div>
                    <div>
                      <div className={`text-[10px] uppercase tracking-wider mb-1 ${isDark ? "text-slate-600" : "text-gray-400"}`}>Last Seen</div>
                      <span className={`text-sm font-medium ${isDark ? "text-slate-300" : "text-gray-700"}`}>{timeAgo(scanner.lastSeen)}</span>
                    </div>
                    <div>
                      <div className={`text-[10px] uppercase tracking-wider mb-1 ${isDark ? "text-slate-600" : "text-gray-400"}`}>Locked</div>
                      <span className={`text-sm font-medium ${scanner.isLocked ? "text-amber-400" : isDark ? "text-emerald-400" : "text-emerald-600"}`}>{scanner.isLocked ? "Locked" : "Unlocked"}</span>
                    </div>
                    <div>
                      <div className={`text-[10px] uppercase tracking-wider mb-1 ${isDark ? "text-slate-600" : "text-gray-400"}`}>Provisioned</div>
                      <span className={`text-sm font-medium ${isProvisioned ? (isDark ? "text-emerald-400" : "text-emerald-600") : (isDark ? "text-slate-500" : "text-gray-400")}`}>{isProvisioned ? "Yes" : "No"}</span>
                    </div>
                  </div>
                  {/* Storage usage */}
                  {scanner.storageTotal != null && scanner.storageFree != null && (
                    <div className="mt-4 pt-3 border-t" style={{ borderColor: isDark ? "rgba(51,65,85,0.5)" : "rgba(229,231,235,0.8)" }}>
                      <div className={`text-[10px] uppercase tracking-wider mb-2 ${isDark ? "text-slate-600" : "text-gray-400"}`}>Storage</div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <div className={`w-full h-2 rounded-full overflow-hidden ${isDark ? "bg-slate-800" : "bg-gray-200"}`}>
                            <div
                              className={`h-full rounded-full transition-all ${
                                scanner.storageFree < 500
                                  ? "bg-red-500"
                                  : scanner.storageFree < 2000
                                    ? "bg-amber-500"
                                    : isDark ? "bg-cyan-500" : "bg-blue-500"
                              }`}
                              style={{ width: `${Math.max(2, Math.round(((scanner.storageTotal - scanner.storageFree) / scanner.storageTotal) * 100))}%` }}
                            />
                          </div>
                        </div>
                        <span className={`text-xs font-medium whitespace-nowrap ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                          {scanner.storageFree >= 1024
                            ? `${(scanner.storageFree / 1024).toFixed(1)} GB`
                            : `${scanner.storageFree} MB`} free
                          {" / "}
                          {scanner.storageTotal >= 1024
                            ? `${(scanner.storageTotal / 1024).toFixed(1)} GB`
                            : `${scanner.storageTotal} MB`}
                        </span>
                      </div>
                    </div>
                  )}
                  {scanner.installedApps && (
                    <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t" style={{ borderColor: isDark ? "rgba(51,65,85,0.5)" : "rgba(229,231,235,0.8)" }}>
                      {scanner.installedApps.tireTrack && <span className={`text-[11px] px-2 py-0.5 rounded-full ${isDark ? "bg-cyan-500/10 text-cyan-400" : "bg-blue-50 text-blue-600"}`}>TireTrack v{scanner.installedApps.tireTrack}</span>}
                      {scanner.installedApps.rtLocator && <span className={`text-[11px] px-2 py-0.5 rounded-full ${isDark ? "bg-purple-500/10 text-purple-400" : "bg-purple-50 text-purple-600"}`}>RT Locator v{scanner.installedApps.rtLocator}</span>}
                      {scanner.installedApps.scannerAgent && <span className={`text-[11px] px-2 py-0.5 rounded-full ${isDark ? "bg-slate-800 text-slate-400" : "bg-gray-100 text-gray-500"}`}>Agent v{scanner.installedApps.scannerAgent}</span>}
                    </div>
                  )}
                </div>

                {/* Alerts — shown when there are active alerts */}
                {scanner.scannerAlerts && scanner.scannerAlerts.filter((a: any) => !a.resolved).length > 0 && (
                  <div className={`${cardClass} !border-amber-500/30`}>
                    <h3 className={sectionTitle}>Active Alerts</h3>
                    <div className="space-y-2">
                      {scanner.scannerAlerts
                        .filter((a: any) => !a.resolved)
                        .map((alert: any, i: number) => (
                          <div key={i} className={`flex items-center gap-2 p-2.5 rounded-lg ${
                            alert.type === "low_battery" ? (isDark ? "bg-red-500/10" : "bg-red-50") :
                            alert.type === "offline" ? (isDark ? "bg-amber-500/10" : "bg-amber-50") :
                            (isDark ? "bg-orange-500/10" : "bg-orange-50")
                          }`}>
                            <svg className={`w-4 h-4 flex-shrink-0 ${
                              alert.type === "low_battery" ? "text-red-400" :
                              alert.type === "offline" ? "text-amber-400" : "text-orange-400"
                            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                            <div className="flex-1">
                              <span className={`text-xs font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{alert.message}</span>
                              <span className={`text-[10px] ml-2 ${isDark ? "text-slate-600" : "text-gray-400"}`}>{timeAgo(alert.createdAt)}</span>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Provision Card — shown for unprovisioned scanners */}
                {canEdit && !isProvisioned && (
                  <div className={`${cardClass} border-dashed`}>
                    <h3 className={sectionTitle}>IoT Management</h3>
                    <p className={`text-sm mb-3 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      This scanner is not provisioned for remote management.
                    </p>
                    <button onClick={() => { setProvisionStep("confirm"); setShowProvisionModal(true); setProvisionError(""); }}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isDark ? "bg-cyan-600 hover:bg-cyan-500 text-white" : "bg-blue-600 hover:bg-blue-700 text-white"}`}>
                      Provision Scanner
                    </button>
                  </div>
                )}

                {/* Provision Modal */}
                {showProvisionModal && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => provisionStep !== "generating" && setShowProvisionModal(false)}>
                    <div className={`w-full max-w-md rounded-2xl border p-6 ${isDark ? "bg-slate-900 border-slate-700" : "bg-white border-gray-200"}`} onClick={(e) => e.stopPropagation()}>
                      {provisionStep === "confirm" && (
                        <>
                          <h3 className={`text-lg font-bold mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>Provision Scanner</h3>
                          <p className={`text-sm mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                            This will create IoT credentials for <strong>{scanner.number}</strong> and generate a setup code.
                          </p>
                          <div className="flex gap-3 justify-end">
                            <button onClick={() => setShowProvisionModal(false)} className={`px-4 py-2 text-sm rounded-lg ${isDark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-900"}`}>Cancel</button>
                            <button onClick={handleProvision} className="px-4 py-2 text-sm font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white">Provision</button>
                          </div>
                        </>
                      )}
                      {provisionStep === "generating" && (
                        <div className="text-center py-8">
                          <div className="animate-spin w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full mx-auto mb-3"></div>
                          <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Creating IoT credentials...</p>
                        </div>
                      )}
                      {provisionStep === "code" && provisionCode && (
                        <>
                          <h3 className={`text-lg font-bold mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>Setup Code Ready</h3>
                          <p className={`text-sm mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Enter this code on the scanner&apos;s setup screen:</p>
                          <div className={`text-center py-6 rounded-xl mb-4 ${isDark ? "bg-slate-800" : "bg-gray-50"}`}>
                            <div className={`text-4xl font-mono font-bold tracking-[0.3em] ${isDark ? "text-cyan-400" : "text-blue-600"}`}>{provisionCode.code}</div>
                            <div className={`text-xs mt-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                              {provisionCode.claimed ? (
                                <span className="text-emerald-500 font-medium">Claimed! Scanner is provisioning...</span>
                              ) : (
                                <>Expires {new Date(provisionCode.expiresAt).toLocaleTimeString()}</>
                              )}
                            </div>
                          </div>
                          {provisionCode.claimed ? (
                            <button onClick={() => setShowProvisionModal(false)} className="w-full px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white">Done</button>
                          ) : (
                            <button onClick={() => { navigator.clipboard.writeText(provisionCode.code); }} className={`w-full px-4 py-2 text-sm rounded-lg border ${isDark ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>Copy Code</button>
                          )}
                        </>
                      )}
                      {provisionStep === "error" && (
                        <>
                          <h3 className={`text-lg font-bold mb-2 text-red-500`}>Provisioning Failed</h3>
                          <p className={`text-sm mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>{provisionError}</p>
                          <div className="flex gap-3 justify-end">
                            <button onClick={() => setShowProvisionModal(false)} className={`px-4 py-2 text-sm rounded-lg ${isDark ? "text-slate-400" : "text-gray-500"}`}>Close</button>
                            <button onClick={handleProvision} className="px-4 py-2 text-sm font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white">Retry</button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Remote Actions */}
                {canEdit && isProvisioned && (
                  <div className={cardClass}>
                    <h3 className={sectionTitle}>Remote Control</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {commandButtons.filter((b) => !b.requiresAdmin || isSuperAdmin).map((btn) => {
                        const blockedByOwner = btn.requiresDeviceOwner && !scanner.deviceOwner;
                        return (
                          <button key={btn.cmd} onClick={() => initiateCommand(btn.cmd)} disabled={blockedByOwner}
                            title={blockedByOwner ? "Requires Device Owner" : undefined}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors border disabled:opacity-40 disabled:cursor-not-allowed ${isDark ? `bg-${btn.color}-500/5 text-${btn.color}-400 hover:bg-${btn.color}-500/15 border-${btn.color}-500/15` : `bg-${btn.color}-50/50 text-${btn.color}-600 hover:bg-${btn.color}-50 border-${btn.color}-200/50`}`}>
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={btn.icon} /></svg>
                            {btn.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Setup History */}
                {setupLogs && setupLogs.length > 0 && (
                  <section className={`rounded-xl border ${isDark ? "border-slate-700 bg-slate-800/50" : "border-gray-200 bg-white"} p-4`}>
                    <h3 className="text-sm font-semibold mb-3">Setup History</h3>
                    <ul className="space-y-1 text-xs">
                      {setupLogs.map((log) => (
                        <li key={log._id} className="flex items-center gap-3">
                          <span className={`w-5 inline-block text-center ${log.status === "success" ? "text-emerald-500" : log.status === "failed" ? "text-red-500" : "opacity-50"}`}>
                            {log.status === "success" ? "✓" : log.status === "failed" ? "✗" : "·"}
                          </span>
                          <span className="font-mono opacity-70 w-32">{log.step}</span>
                          {log.durationMs !== undefined && <span className="opacity-60 w-16">{log.durationMs}ms</span>}
                          <span className="opacity-50">{new Date(log.createdAt).toLocaleString()}</span>
                          {log.error && <span className="text-red-500 ml-2 truncate">{log.error}</span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* Timeline */}
                <div className={`rounded-xl border ${isDark ? "bg-slate-900/50 border-slate-800" : "bg-white border-gray-200 shadow-sm"}`}>
                  <div className={`flex border-b ${isDark ? "border-slate-800" : "border-gray-200"}`}>
                    {(["commands", "history", "conditions"] as const).map((tab) => (
                      <button key={tab} onClick={() => setActiveTab(tab)}
                        className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${activeTab === tab ? (isDark ? "text-cyan-400 border-b-2 border-cyan-400" : "text-blue-600 border-b-2 border-blue-600") : (isDark ? "text-slate-500 hover:text-slate-300" : "text-gray-400 hover:text-gray-700")}`}>
                        {tab === "commands" ? "Commands" : tab === "history" ? "History" : "Conditions"}
                      </button>
                    ))}
                  </div>
                  <div className="p-4 max-h-80 overflow-y-auto">
                    {activeTab === "commands" && (
                      <div className="space-y-2">
                        {!scanner.commands?.length && <p className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>No commands sent yet</p>}
                        {scanner.commands?.map((cmd) => (
                          <div key={cmd._id} className={`flex items-center justify-between p-2.5 rounded-lg ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`}>
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cmdStatusColors[cmd.status] ?? "text-slate-400 bg-slate-500/10"}`}>{cmd.status}</span>
                              <span className={`text-xs font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{cmd.command}</span>
                              <span className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>{cmd.issuedByName}</span>
                            </div>
                            <div className="text-right">
                              <div className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>{formatDate(cmd.issuedAt)}</div>
                              {cmd.acknowledgedAt && (
                                <div className={`text-[10px] ${isDark ? "text-cyan-600" : "text-cyan-500"}`}>ACK {timeAgo(cmd.acknowledgedAt)}</div>
                              )}
                              {cmd.completedAt && (
                                <div className={`text-[10px] ${isDark ? "text-emerald-600" : "text-emerald-500"}`}>Done {timeAgo(cmd.completedAt)}</div>
                              )}
                              {cmd.errorMessage && (
                                <div className="text-[10px] text-red-400">{cmd.errorMessage}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {activeTab === "history" && (
                      <div className="space-y-2">
                        {!scanner.history?.length && <p className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>No history yet</p>}
                        {scanner.history?.map((h) => (
                          <div key={h._id} className={`flex items-center justify-between p-2.5 rounded-lg ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`}>
                            <div>
                              <span className={`text-xs font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{h.action.replace(/_/g, " ")}</span>
                              {h.newAssigneeName && <span className={`text-[10px] ml-1.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>to {h.newAssigneeName}</span>}
                              {h.notes && <p className={`text-[10px] mt-0.5 ${isDark ? "text-slate-600" : "text-gray-400"}`}>{h.notes}</p>}
                            </div>
                            <div className="text-right">
                              <div className={`text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>{formatDate(h.createdAt)}</div>
                              <div className={`text-[10px] ${isDark ? "text-slate-700" : "text-gray-300"}`}>{h.performedByName}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {activeTab === "conditions" && (
                      <p className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>Condition checks appear here after equipment returns.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* === MODALS === */}

          {/* Command Modal */}
          {showCommandModal && pendingCommand && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className={`border rounded-xl p-6 w-full max-w-md ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
                <h2 className={`text-lg font-semibold mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                  {pendingCommand === "wipe" ? "Factory Reset" : pendingCommand.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} — {scanner.number}
                </h2>
                {pendingCommand === "wipe" ? (
                  <>
                    <div className={`p-3 rounded-lg mb-4 ${isDark ? "bg-red-500/10 border border-red-500/30" : "bg-red-50 border border-red-200"}`}>
                      <p className={`text-sm ${isDark ? "text-red-300" : "text-red-700"}`}>This erases ALL data and restores factory settings. Cannot be undone.</p>
                    </div>
                    <label className={`block text-sm mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Type <span className="font-bold">{scanner.number}</span> to confirm:</label>
                    <input type="text" value={wipeConfirmText} onChange={(e) => setWipeConfirmText(e.target.value)} className={`${inputClass} mb-4`} placeholder={scanner.number} />
                  </>
                ) : (
                  <p className={`text-sm mb-4 ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                    {pendingCommand === "lock" && "Lock the scanner screen immediately."}
                    {pendingCommand === "unlock" && "Unlock the scanner screen."}
                    {pendingCommand === "install_apk" && "Push latest APK updates to the scanner."}
                    {pendingCommand === "push_config" && "Push latest RT Locator configuration."}
                    {pendingCommand === "restart" && "Restart the scanner device."}
                    {pendingCommand === "update_pin" && "Generate a new system PIN on the scanner and apply it."}
                  </p>
                )}
                <div className="flex justify-end gap-3">
                  <button onClick={() => { setShowCommandModal(false); setPendingCommand(null); }} className={`px-4 py-2 text-sm rounded-lg ${isDark ? "text-slate-300 hover:bg-slate-700" : "text-gray-600 hover:bg-gray-100"}`}>Cancel</button>
                  <button onClick={executeCommand} disabled={sending || (pendingCommand === "wipe" && wipeConfirmText !== scanner.number)}
                    className={`px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 ${pendingCommand === "wipe" ? "bg-red-500 text-white hover:bg-red-600" : isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-500 text-white hover:bg-blue-600"}`}>
                    {sending ? "Sending..." : "Confirm"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Assign Modal */}
          {showAssignModal && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className={`border rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
                <h2 className={`text-lg font-semibold mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Assign Scanner {scanner.number}
                </h2>
                <p className={`text-xs mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Step {assignStep} of 2</p>

                {assignStep === 1 ? (
                  <>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Select Employee</label>
                    <select value={selectedPersonnelId as string} onChange={(e) => setSelectedPersonnelId(e.target.value as any)} className={inputClass}>
                      <option value="">Choose...</option>
                      {personnel?.sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
                        <option key={p._id} value={p._id}>{p.name} — {p.position} ({p.department})</option>
                      ))}
                    </select>
                    <div className="flex justify-end gap-3 mt-6">
                      <button onClick={() => setShowAssignModal(false)} className={`px-4 py-2 text-sm rounded-lg ${isDark ? "text-slate-300 hover:bg-slate-700" : "text-gray-600 hover:bg-gray-100"}`}>Cancel</button>
                      <button onClick={() => setAssignStep(2)} disabled={!selectedPersonnelId}
                        className={`px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-500 text-white hover:bg-blue-600"}`}>
                        Continue to Agreement
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={`p-3 rounded-lg mb-4 text-xs ${isDark ? "bg-cyan-500/10 text-cyan-300" : "bg-blue-50 text-blue-700"}`}>
                      Assigning to: <span className="font-bold">{selectedPerson?.name}</span>
                    </div>
                    <div className={`p-3 rounded-lg mb-4 font-mono text-[11px] max-h-48 overflow-y-auto whitespace-pre-wrap ${isDark ? "bg-slate-900 text-slate-400 border border-slate-700" : "bg-gray-50 text-gray-600 border border-gray-200"}`}>
                      {getAgreementText()}
                    </div>

                    {/* Signing method: draw on screen, or print + upload a signed copy */}
                    <div className={`flex rounded-lg p-0.5 mb-4 ${isDark ? "bg-slate-900" : "bg-gray-100"}`}>
                      <button type="button" onClick={() => setAssignMethod("draw")}
                        className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${assignMethod === "draw" ? (isDark ? "bg-cyan-500 text-white" : "bg-blue-500 text-white") : (isDark ? "text-slate-400" : "text-gray-600")}`}>
                        Sign on screen
                      </button>
                      <button type="button" onClick={() => setAssignMethod("upload")}
                        className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${assignMethod === "upload" ? (isDark ? "bg-cyan-500 text-white" : "bg-blue-500 text-white") : (isDark ? "text-slate-400" : "text-gray-600")}`}>
                        Print &amp; upload
                      </button>
                    </div>

                    {assignMethod === "draw" ? (
                      <>
                        <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Employee Signature</label>
                        <div className={`border rounded-lg overflow-hidden ${isDark ? "border-slate-700" : "border-gray-300"}`}>
                          <SignaturePad height={150} onSignatureChange={(data: string | null) => setSignatureData(data ?? "")} />
                        </div>
                      </>
                    ) : (
                      <div className="space-y-3">
                        <button type="button" onClick={() => selectedPerson && printAgreementFor(selectedPerson.name)}
                          className={`w-full px-4 py-2 text-sm font-medium rounded-lg border ${isDark ? "border-slate-700 text-slate-200 hover:bg-slate-700" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
                          🖨 Print agreement to sign
                        </button>
                        <div>
                          <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Upload signed copy (photo or PDF)</label>
                          <input type="file" accept="image/*,application/pdf" disabled={uploadingDoc}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAssignFilePick(f); }}
                            className={`block w-full text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`} />
                          {uploadingDoc && <p className={`text-xs mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Uploading…</p>}
                          {uploadedFileName && !uploadingDoc && (
                            <p className={`text-xs mt-1 ${isDark ? "text-cyan-400" : "text-blue-600"}`}>Attached: {uploadedFileName}</p>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end gap-3 mt-6">
                      <button onClick={() => setAssignStep(1)} className={`px-4 py-2 text-sm rounded-lg ${isDark ? "text-slate-300 hover:bg-slate-700" : "text-gray-600 hover:bg-gray-100"}`}>Back</button>
                      <button onClick={handleAssign} disabled={sending || uploadingDoc || (assignMethod === "draw" ? !signatureData : !uploadedDocId)}
                        className={`px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-500 text-white hover:bg-blue-600"}`}>
                        {sending ? "Assigning..." : "Assign Equipment"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Return Modal */}
          {showReturnModal && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className={`border rounded-xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
                <h2 className={`text-lg font-semibold mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>Return Scanner {scanner.number}</h2>
                <div className={`p-3 rounded-lg mb-4 text-xs ${isDark ? "bg-amber-500/10 text-amber-300" : "bg-amber-50 text-amber-700"}`}>
                  Returning from: <span className="font-bold">{scanner.assignedPersonName}</span>
                </div>

                {/* Condition Checklist */}
                <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Condition Checklist</label>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {Object.entries(returnChecklist).map(([key, val]) => (
                    <label key={key} className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer text-xs ${val ? (isDark ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-green-50 border border-green-200") : (isDark ? "bg-red-500/10 border border-red-500/20" : "bg-red-50 border border-red-200")}`}>
                      <input type="checkbox" checked={val} onChange={() => setReturnChecklist((c) => ({ ...c, [key]: !val }))} className="rounded" />
                      {key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
                    </label>
                  ))}
                </div>

                <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Overall Condition</label>
                <select value={overallCondition} onChange={(e) => setOverallCondition(e.target.value)} className={`${inputClass} mb-4`}>
                  {["excellent", "good", "fair", "poor", "damaged"].map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                </select>

                <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Damage Notes</label>
                <textarea value={damageNotes} onChange={(e) => setDamageNotes(e.target.value)} className={`${inputClass} mb-4`} rows={2} placeholder="Describe any damage..." />

                <div className="flex items-center gap-4 mb-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={repairRequired} onChange={() => { setRepairRequired(!repairRequired); if (!repairRequired) setReadyForReassignment(false); }} className="rounded" />
                    <span className={isDark ? "text-slate-300" : "text-gray-700"}>Repair Required</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={readyForReassignment} disabled={repairRequired} onChange={() => setReadyForReassignment(!readyForReassignment)} className="rounded" />
                    <span className={isDark ? "text-slate-300" : "text-gray-700"}>Ready for Reassignment</span>
                  </label>
                </div>

                <div className="flex justify-end gap-3">
                  <button onClick={() => setShowReturnModal(false)} className={`px-4 py-2 text-sm rounded-lg ${isDark ? "text-slate-300 hover:bg-slate-700" : "text-gray-600 hover:bg-gray-100"}`}>Cancel</button>
                  <button onClick={handleReturn} disabled={sending}
                    className={`px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 ${isDark ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-amber-500 text-white hover:bg-amber-600"}`}>
                    {sending ? "Processing..." : "Complete Return"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* PIN Change Modal */}
          {showPinModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowPinModal(false)}>
              <div className={`w-full max-w-sm rounded-xl p-6 mx-4 ${isDark ? "bg-slate-800" : "bg-white"}`} onClick={(e) => e.stopPropagation()}>
                <h3 className={`text-lg font-semibold mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>Change PIN</h3>
                <p className={`text-xs mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  {scanner?.iotThingName || scanner?.serialNumber || "Scanner"} — minimum 4 numeric digits
                </p>

                <div className="space-y-3">
                  <div>
                    <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-600"}`}>New PIN</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={newPin}
                      onChange={(e) => { setNewPin(e.target.value.replace(/\D/g, "")); setPinError(""); }}
                      maxLength={8}
                      className={`w-full px-3 py-2 rounded-lg border text-sm font-mono tracking-widest text-center text-lg ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                      placeholder="0000"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-600"}`}>Confirm PIN</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={confirmPin}
                      onChange={(e) => { setConfirmPin(e.target.value.replace(/\D/g, "")); setPinError(""); }}
                      maxLength={8}
                      className={`w-full px-3 py-2 rounded-lg border text-sm font-mono tracking-widest text-center text-lg ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                      placeholder="0000"
                    />
                  </div>

                  {pinError && (
                    <p className="text-xs text-red-400">{pinError}</p>
                  )}
                </div>

                <div className="flex justify-end gap-3 mt-5">
                  <button
                    onClick={() => setShowPinModal(false)}
                    className={`px-4 py-2 text-sm rounded-lg ${isDark ? "text-slate-300 hover:bg-slate-700" : "text-gray-600 hover:bg-gray-100"}`}
                  >
                    Cancel
                  </button>
                  <button
                    disabled={savingPin}
                    onClick={async () => {
                      if (newPin.length < 4) { setPinError("PIN must be at least 4 digits"); return; }
                      if (newPin !== confirmPin) { setPinError("PINs do not match"); return; }
                      setSavingPin(true);
                      try {
                        if (!user) throw new Error("Not signed in");
                        await updateScanner({ id: scannerId, pin: newPin, userId: user._id, requestingUserId: user._id });
                        setShowPinModal(false);
                      } catch (err) {
                        setPinError(err instanceof Error ? err.message : "Failed to update PIN");
                      } finally {
                        setSavingPin(false);
                      }
                    }}
                    className={`px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 ${isDark ? "bg-blue-500 text-white hover:bg-blue-600" : "bg-blue-500 text-white hover:bg-blue-600"}`}
                  >
                    {savingPin ? "Saving..." : "Update PIN"}
                  </button>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>
    </Protected>
  );
}

export default function ScannerDetailPage() {
  return <ScannerDetailContent />;
}
