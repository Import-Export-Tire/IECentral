"use client";

import { useEffect, useState } from "react";
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
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";

type CommandType = "lock" | "unlock" | "wipe" | "install_apk" | "push_config" | "restart" | "update_pin" | "apply_policies" | "get_screen" | "datawedge_config";
const EQUIPMENT_VALUE = 100;
// A screen snapshot older than this reads as stale rather than current — the device may well
// be showing something else by now (see the Screen View panel below).
const SCREEN_STALE_MS = 2 * 60 * 1000;

// Commands that must survive an offline scanner go through AWS IoT Jobs (queued until the
// device reconnects) instead of the fire-and-forget cmd/scanners/# path. `wipe` is
// deliberately excluded — a queued factory-reset firing days later when someone finally
// powers the device back on would be dangerous, so it stays on the direct path. `get_screen`
// stays on the direct path too, for the same reason: it's only meaningful right now, on a
// device that's online, so a queued one would be pointless.
// `datawedge_config` belongs here more than most: a scanner that can't scan is usually already
// parked on a charger, so the repair has to wait for it rather than being thrown away.
const JOB_COMMANDS: ReadonlySet<CommandType> = new Set([
  "lock", "unlock", "restart", "install_apk", "push_config", "update_pin", "apply_policies",
  "datawedge_config",
]);

const jobStatusColors: Record<string, string> = {
  QUEUED: "text-slate-400 bg-slate-500/10",
  IN_PROGRESS: "text-blue-400 bg-blue-500/10",
  SUCCEEDED: "text-emerald-400 bg-emerald-500/10",
  FAILED: "text-red-400 bg-red-500/10",
  TIMED_OUT: "text-amber-400 bg-amber-500/10",
  REJECTED: "text-red-400 bg-red-500/10",
  CANCELED: "text-slate-400 bg-slate-500/10",
};

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
  const [commandError, setCommandError] = useState("");
  // Set once a command is accepted, so the modal reports what actually happened instead of
  // just vanishing. A silently-closing modal on an OFFLINE scanner is what caused two
  // update_pin jobs to be queued minutes apart on W08-902: nothing said "queued, wait" — and
  // because each update_pin mints a fresh random PIN, the second job overwrote the first,
  // which looked exactly like the PIN reverting on its own.
  const [commandQueuedMsg, setCommandQueuedMsg] = useState("");
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


  // Provision state
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [provisionStep, setProvisionStep] = useState<"confirm" | "generating" | "code" | "error">("confirm");
  const [provisionError, setProvisionError] = useState("");

  // Ticks every few seconds purely so the Screen View panel's "Xm ago" / stale badge keeps
  // advancing even when no new telemetry arrives (e.g. after the fast-publish window ends).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  // Queries
  const scanner = useQuery(api.scannerMdm.getScannerDetail, { id: scannerId });
  const personnel = useQuery(api.equipment.listActivePersonnel);
  const provisionCode = useQuery(api.scannerMdm.getProvisionCode, { scannerId });
  const setupLogs = useQuery(api.scannerMdm.listSetupLogsByScanner, scannerId ? { scannerId, limit: 50 } : "skip");
  const lastVerification = useQuery(api.scannerMdm.getLatestVerification, { scannerId });
  const recentJobs = useQuery(api.scannerMdm.listJobsForScanner, { scannerId });

  // Mutations
  const logCommand = useMutation(api.scannerMdm.logScannerCommand);
  const recordJob = useMutation(api.scannerMdm.recordJob);
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
    setCommandError("");
    setCommandQueuedMsg("");
    setShowCommandModal(true);
  };

  /** A durable job of the same command already waiting on this scanner. Sending a second one
   *  doesn't replace the first — both run when the device checks in, back to back. For
   *  update_pin that means two different random PINs seconds apart, and the one you wrote
   *  down is the wrong one. */
  const pendingDuplicateJob = pendingCommand
    ? recentJobs?.find(
        (j) => j.command === pendingCommand && (j.status === "QUEUED" || j.status === "IN_PROGRESS")
      )
    : undefined;

  const executeCommand = async () => {
    if (!pendingCommand || !scanner || !user) return;
    if (pendingCommand === "wipe" && wipeConfirmText !== scanner.number) return;
    // Hard stop, not just a warning: the duplicate is the bug, and the operator who double-taps
    // is precisely the person who can't see that the first job is still waiting.
    if (pendingDuplicateJob) {
      setCommandError(
        `A ${pendingCommand.replace(/_/g, " ")} job is already waiting for this scanner (sent ${formatDate(pendingDuplicateJob.createdAt)}). Sending another would run a second time, not replace the first.`
      );
      return;
    }
    setSending(true);
    setCommandError("");
    try {
      // Existing audit trail, unchanged for every command regardless of transport.
      await logCommand({ scannerId, command: pendingCommand, payload: commandPayload || undefined, userId: user._id, userName: user.name ?? user.email });

      const payload = commandPayload ? JSON.parse(commandPayload) : {};

      if (JOB_COMMANDS.has(pendingCommand)) {
        // Durable path: creates an AWS IoT Job that sits QUEUED on a device that's
        // currently offline, instead of being silently discarded — this is the whole
        // reason this path exists ("even if it's on next powerup").
        const res = await fetch("/api/scanner-mdm/job", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ thingName: scanner.iotThingName, command: pendingCommand, payload }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (data.jobId) {
          await recordJob({ scannerId, jobId: data.jobId, command: pendingCommand, payload, createdBy: user._id });
        }
        setCommandQueuedMsg(
          scanner.isOnline
            ? "Sent. The scanner should run it within a few seconds — watch Recent Jobs below."
            : `Queued. ${scanner.number} is offline (last seen ${formatDate(scanner.lastSeen)}), so this runs the next time it checks in. Don't send it again — a second job runs in addition to this one, not instead of it.`
        );
      } else {
        // wipe (and, once built, get_screen) stay on the direct, fire-and-forget path —
        // both are only meaningful on a device that's online right now.
        const res = await fetch("/api/scanner-mdm/command", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ thingName: scanner.iotThingName, command: pendingCommand, payload, scannerId, userId: user._id, confirmed: true }),
        });
        // This path never checked the response either — a rejected wipe/get_screen was
        // indistinguishable from an accepted one.
        if (!res.ok) throw new Error(await res.text());
        setCommandQueuedMsg("Sent to the scanner.");
      }
      // Deliberately does NOT close the modal — it now reports what happened. Closing on
      // success is what made a queued job on an offline scanner look like nothing happened.
    } catch (err) {
      // Previously this only hit console.error and then fell through to closing the modal, so a
      // rejected command looked exactly like a successful one — the operator walked away
      // believing a scanner had been fixed/locked/updated when nothing had been sent. Keep the
      // modal open and say what failed.
      console.error("Command failed:", err);
      setCommandError(err instanceof Error ? err.message : String(err));
    }
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
      generatedBy: user?.name ?? user?.email,
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
      <Protected>
        <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
          <Sidebar />
          <main className="flex-1 flex items-center justify-center">
            <MobileHeader />
            <div className="text-sm theme-text-tertiary">Loading scanner...</div>
          </main>
        </div>
      </Protected>
    );
  }

  const health = getScannerHealth(scanner);
  const isProvisioned = scanner.mdmStatus === "provisioned";

  const commandButtons: { cmd: CommandType; label: string; icon: string; color: string; requiresAdmin?: boolean; requiresDeviceOwner?: boolean; requiresOnline?: boolean }[] = [
    { cmd: "lock", label: "Lock", icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z", color: "amber" },
    { cmd: "unlock", label: "Unlock", icon: "M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z", color: "emerald" },
    { cmd: "update_pin", label: "Reset PIN", icon: "M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z", color: "blue", requiresDeviceOwner: true },
    { cmd: "install_apk", label: "Push Update", icon: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4", color: "cyan" },
    { cmd: "push_config", label: "Push Config", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z", color: "purple" },
    { cmd: "restart", label: "Restart", icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15", color: "slate" },
    { cmd: "apply_policies", label: "Apply Policies", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z", color: "indigo" },
    { cmd: "datawedge_config", label: "Fix Scanning", icon: "M4 7V5a1 1 0 011-1h2M4 17v2a1 1 0 001 1h2m10-16h2a1 1 0 011 1v2m-3 12h2a1 1 0 001-1v-2M7 8v8m3-8v8m3-8v8m3-8v8", color: "orange" },
    { cmd: "get_screen", label: "View Screen", icon: "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z", color: "teal", requiresOnline: true },
    { cmd: "wipe", label: "Factory Reset", icon: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16", color: "red", requiresAdmin: true },
  ];

  const cmdStatusColors: Record<string, string> = {
    sent: "text-blue-400 bg-blue-500/10", acknowledged: "text-cyan-400 bg-cyan-500/10",
    completed: "text-emerald-400 bg-emerald-500/10", failed: "text-red-400 bg-red-500/10", timeout: "text-amber-400 bg-amber-500/10",
  };

  // Screen View panel state — `nowTick` (updated every 5s, see effect above) keeps the age
  // display advancing even if no fresh telemetry arrives after the fast-publish window ends.
  const lastScreen = scanner.lastScreen;
  const screenAgeMs = lastScreen?.at ? nowTick - lastScreen.at : null;
  const screenIsStale = screenAgeMs !== null && screenAgeMs > SCREEN_STALE_MS;

  return (
    <Protected>
      <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <MobileHeader />

          {/* Standard iOS-style sticky page header */}
          <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <button
                  onClick={() => router.push("/equipment/scanners")}
                  className="flex items-center gap-1 text-xs mb-1 theme-text-tertiary hover:theme-text-secondary transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  Fleet
                </button>
                <div className="flex items-center gap-2.5">
                  <ScannerStatusDot health={health} size="lg" />
                  <div>
                    <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">Scanner {scanner.number}</h1>
                    <p className="text-xs mt-0.5 hidden sm:block theme-text-tertiary">
                      {scanner.locationName} &middot; {scanner.model ?? "Unknown"} &middot; {scanner.serialNumber ?? "No serial"}
                    </p>
                  </div>
                </div>
              </div>
              {canEdit && (
                <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                  {scanner.status === "available" && (
                    <Button
                      variant="primary"
                      onClick={() => { setShowAssignModal(true); setAssignStep(1); setSelectedPersonnelId(""); setSignatureData(""); }}
                    >
                      Assign
                    </Button>
                  )}
                  {scanner.status === "assigned" && (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => setShowReturnModal(true)}
                      >
                        Return
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={handleQuickUnassign}
                      >
                        Unassign
                      </Button>
                    </>
                  )}
                  {isSuperAdmin && (
                    <Button
                      variant="danger"
                      onClick={handleDeleteScanner}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              )}
            </div>
          </header>

          <div className="px-4 sm:px-6 lg:px-8 py-5">
            {lastVerification && !lastVerification.passed && (
              <div className="p-3 rounded-xl ui-callout-red text-sm mb-4">
                <p className="font-semibold">Verification failed</p>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {lastVerification.checks
                    .filter((c) => c.hard && c.status !== "pass")
                    .map((c) => (
                      <li key={c.key}>
                        {c.label} — expected {c.expected}, got {c.observed}
                      </li>
                    ))}
                </ul>
              </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

              {/* Left Column */}
              <div className="space-y-5">
                {/* Device Info */}
                <Card>
                  <SectionHeader label="Device" />
                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    {scanner.deviceOwner ? (
                      <span className="ui-badge ui-badge-green">Device Owner</span>
                    ) : (
                      <span className="ui-badge ui-badge-gray">Admin only</span>
                    )}
                    {scanner.pinManaged && (
                      <span className="ui-badge ui-badge-blue">PIN managed</span>
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
                        <span className="text-[11px] theme-text-tertiary">{label}</span>
                        <span className="text-xs font-medium theme-text-secondary">{value}</span>
                      </div>
                    ))}
                    {/* Status — editable for managers/admins */}
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] theme-text-tertiary">Status</span>
                      {canEdit ? (
                        <select
                          value={scanner.status}
                          onChange={(e) => handleStatusChange(e.target.value)}
                          className="theme-input text-xs font-medium px-2 py-1"
                        >
                          {["available", "assigned", "maintenance", "lost", "retired"].map((s) => (
                            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs font-medium theme-text-secondary">{scanner.status}</span>
                      )}
                    </div>
                    {/* PIN with change button. The PIN is the device's LAST REPORTED value, not
                        a guarantee — the scanner only tells us when it checks in, and on
                        Android 8.1 there is no API to stop someone changing it on the device.
                        Shown bare it reads as fact, which is how an offline scanner's stale PIN
                        gets handed to an employee who then can't unlock it. */}
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] theme-text-tertiary">System PIN</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-medium theme-text-secondary">{scanner.pin || "Not set"}</span>
                        {!!scanner.pin && (
                          <span
                            className={`text-[10px] ${scanner.isOnline ? "theme-text-tertiary" : "text-amber-500"}`}
                            title={scanner.isOnline ? "Confirmed at the scanner's last check-in" : "The scanner hasn't checked in since this — it may have been changed on the device"}
                          >
                            {scanner.isOnline ? "confirmed now" : `as of ${formatDate(scanner.lastSeen)}`}
                          </span>
                        )}
                        {!!scanner.pinRevertCount && (
                          <span
                            className="text-[10px] text-amber-500"
                            title={`The scanner has undone an on-device PIN change ${scanner.pinRevertCount} time(s)${scanner.pinLastRevertedAt ? `, last on ${formatDate(scanner.pinLastRevertedAt)}` : ""}. Someone is changing it on the device.`}
                          >
                            ({scanner.pinRevertCount} revert{scanner.pinRevertCount === 1 ? "" : "s"})
                          </span>
                        )}
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => initiateCommand("update_pin")}
                          >
                            Change
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Assignment */}
                <Card>
                  <SectionHeader label="Assignment" />
                  {scanner.assignedPersonName ? (
                    <>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold bg-blue-500/15 text-blue-500">
                          {scanner.assignedPersonName.split(" ").map((n: string) => n[0]).join("")}
                        </div>
                        <div>
                          <div className="text-sm font-medium theme-text-primary">{scanner.assignedPersonName}</div>
                          <div className="text-[11px] theme-text-tertiary">Since {scanner.assignedAt ? formatDate(scanner.assignedAt) : "--"}</div>
                        </div>
                      </div>
                      {/* Agreement: print/reprint, attach a signed paper copy, view uploaded copy */}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => printAgreementFor(scanner.assignedPersonName!)}
                        >
                          Print agreement
                        </Button>
                        <label className="inline-flex items-center justify-center gap-1.5 rounded-[9px] font-semibold transition-colors px-3 py-1.5 text-[13px] theme-btn-secondary cursor-pointer">
                          {uploadingDoc ? "Uploading…" : "Attach signed copy"}
                          <input type="file" accept="image/*,application/pdf" className="hidden" disabled={uploadingDoc}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAttachSignedToExisting(f); }} />
                        </label>
                        {agreement?.signedDocumentStorageId && signedDocUrl && (
                          <a
                            href={signedDocUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center gap-1.5 rounded-[9px] font-semibold transition-colors px-3 py-1.5 text-[13px] theme-btn-primary"
                          >
                            View signed copy
                          </a>
                        )}
                      </div>
                      <p className="mt-2 text-[11px] theme-text-tertiary">
                        {agreement?.signedDocumentStorageId
                          ? "Signed copy on file (uploaded)"
                          : agreement?.signatureData
                            ? "Signed on screen"
                            : "No signature on file"}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm theme-text-tertiary">Unassigned</p>
                  )}
                </Card>

                {/* Location / GPS */}
                <Card>
                  <SectionHeader label="Location" />
                  <div className="text-sm font-medium mb-2 theme-text-primary">{scanner.locationName}</div>
                  {scanner.gpsLatitude && scanner.gpsLongitude ? (
                    <div>
                      <div className="text-xs font-mono mb-2 theme-text-secondary">
                        {scanner.gpsLatitude.toFixed(6)}, {scanner.gpsLongitude.toFixed(6)}
                      </div>
                      <a
                        href={`https://maps.google.com/?q=${scanner.gpsLatitude},${scanner.gpsLongitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-[9px] theme-btn-secondary"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Open in Google Maps
                      </a>
                    </div>
                  ) : (
                    <p className="text-xs theme-text-tertiary">GPS data not available yet</p>
                  )}
                </Card>

                {/* Notes */}
                {(scanner.notes || scanner.conditionNotes) && (
                  <Card>
                    <SectionHeader label="Notes" />
                    {scanner.notes && <p className="text-sm mb-2 theme-text-secondary">{scanner.notes}</p>}
                    {scanner.conditionNotes && (
                      <p className="text-sm px-3 py-2 rounded-lg ui-callout-amber">{scanner.conditionNotes}</p>
                    )}
                  </Card>
                )}
              </div>

              {/* Right Column */}
              <div className="lg:col-span-2 space-y-5">
                {/* Live Telemetry */}
                <Card>
                  <SectionHeader label="Telemetry" />
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                    <div>
                      <div className="ui-section-label mb-1">Battery</div>
                      <ScannerBatteryBar level={scanner.batteryLevel} size="md" showLabel />
                    </div>
                    <div>
                      <div className="ui-section-label mb-1">WiFi</div>
                      <WifiSignalIcon signal={scanner.wifiSignal} showLabel />
                    </div>
                    <div>
                      <div className="ui-section-label mb-1">Last Seen</div>
                      <span className="text-sm font-medium theme-text-secondary">{timeAgo(scanner.lastSeen)}</span>
                    </div>
                    <div>
                      <div className="ui-section-label mb-1">Locked</div>
                      <span className={`text-sm font-medium ${scanner.isLocked ? "text-amber-400" : "text-emerald-500"}`}>
                        {scanner.isLocked ? "Locked" : "Unlocked"}
                      </span>
                    </div>
                    <div>
                      <div className="ui-section-label mb-1">Provisioned</div>
                      <span className={`text-sm font-medium ${isProvisioned ? "text-emerald-500" : "theme-text-tertiary"}`}>
                        {isProvisioned ? "Yes" : "No"}
                      </span>
                    </div>
                  </div>
                  {/* Storage usage */}
                  {scanner.storageTotal != null && scanner.storageFree != null && (
                    <div className="mt-4 pt-3 border-t theme-border-secondary">
                      <div className="ui-section-label mb-2">Storage</div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <div className={`w-full h-2 rounded-full overflow-hidden ${isDark ? "bg-slate-800" : "bg-gray-200"}`}>
                            <div
                              className={`h-full rounded-full transition-all ${
                                scanner.storageFree < 500
                                  ? "bg-red-500"
                                  : scanner.storageFree < 2000
                                    ? "bg-amber-500"
                                    : "bg-[var(--accent-primary)]"
                              }`}
                              style={{ width: `${Math.max(2, Math.round(((scanner.storageTotal - scanner.storageFree) / scanner.storageTotal) * 100))}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-xs font-medium whitespace-nowrap theme-text-secondary">
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
                    <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t theme-border-secondary">
                      {scanner.installedApps.tireTrack && <span className="ui-badge ui-badge-blue font-mono">TireTrack v{scanner.installedApps.tireTrack}</span>}
                      {scanner.installedApps.rtLocator && <span className="ui-badge ui-badge-purple font-mono">RT Locator v{scanner.installedApps.rtLocator}</span>}
                      {scanner.installedApps.scannerAgent && <span className="ui-badge ui-badge-gray font-mono">Agent v{scanner.installedApps.scannerAgent}</span>}
                    </div>
                  )}
                </Card>

                {/* Alerts — shown when there are active alerts */}
                {scanner.scannerAlerts && scanner.scannerAlerts.filter((a: any) => !a.resolved).length > 0 && (
                  <Card tone="amber">
                    <SectionHeader label="Active Alerts" />
                    <div className="space-y-2">
                      {scanner.scannerAlerts
                        .filter((a: any) => !a.resolved)
                        .map((alert: any, i: number) => (
                          <div key={i} className={`flex items-center gap-2 p-2.5 rounded-lg ${
                            alert.type === "low_battery" ? "bg-red-500/10" :
                            alert.type === "offline" ? "bg-amber-500/10" :
                            "bg-orange-500/10"
                          }`}>
                            <svg className={`w-4 h-4 flex-shrink-0 ${
                              alert.type === "low_battery" ? "text-red-400" :
                              alert.type === "offline" ? "text-amber-400" : "text-orange-400"
                            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                            <div className="flex-1">
                              <span className="text-xs font-medium theme-text-primary">{alert.message}</span>
                              <span className="text-[10px] ml-2 theme-text-tertiary">{timeAgo(alert.createdAt)}</span>
                            </div>
                          </div>
                        ))}
                    </div>
                  </Card>
                )}

                {/* Provision Card — shown for unprovisioned scanners */}
                {canEdit && !isProvisioned && (
                  <div className="theme-card p-5 border-dashed">
                    <SectionHeader label="IoT Management" />
                    <p className="text-sm mb-3 theme-text-tertiary">
                      This scanner is not provisioned for remote management.
                    </p>
                    <Button
                      variant="primary"
                      onClick={() => { setProvisionStep("confirm"); setShowProvisionModal(true); setProvisionError(""); }}
                    >
                      Provision Scanner
                    </Button>
                  </div>
                )}

                {/* Remote Actions */}
                {canEdit && isProvisioned && (
                  <Card>
                    <SectionHeader label="Remote Control" />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {commandButtons.filter((b) => !b.requiresAdmin || isSuperAdmin).map((btn) => {
                        const blockedByOwner = btn.requiresDeviceOwner && !scanner.deviceOwner;
                        const blockedByOffline = btn.requiresOnline && !scanner.isOnline;
                        const blocked = blockedByOwner || blockedByOffline;
                        return (
                          <button
                            key={btn.cmd}
                            onClick={() => initiateCommand(btn.cmd)}
                            disabled={blocked}
                            title={blockedByOffline ? "Scanner is offline — nothing to view right now" : blockedByOwner ? "Requires Device Owner" : undefined}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors border disabled:opacity-40 disabled:cursor-not-allowed ${isDark ? `bg-${btn.color}-500/5 text-${btn.color}-400 hover:bg-${btn.color}-500/15 border-${btn.color}-500/15` : `bg-${btn.color}-50/50 text-${btn.color}-600 hover:bg-${btn.color}-50 border-${btn.color}-200/50`}`}
                          >
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={btn.icon} /></svg>
                            {btn.label}
                          </button>
                        );
                      })}
                    </div>
                  </Card>
                )}

                {/* Barcode Engine — DataWedge state. This is the panel that answers "why won't
                    this scanner scan" without collecting the device. Only agent >= 1.7.3
                    reports it, so an older/offline agent shows an explicit "not reported yet"
                    rather than a reassuring blank. */}
                {canEdit && isProvisioned && (
                  <Card>
                    <SectionHeader label="Barcode Engine" />
                    {!scanner.dataWedge ? (
                      <p className="text-sm theme-text-tertiary">
                        Not reported yet. Scanners running agent 1.7.3 or newer report DataWedge state on every
                        check-in — this scanner is on {scanner.agentVersion ? `agent ${scanner.agentVersion}` : "an older agent"}
                        {scanner.isOnline ? "" : " and is currently offline"}.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="theme-text-tertiary">DataWedge installed</span>
                          <span className={scanner.dataWedge.installed ? "text-emerald-500 font-medium" : "text-red-400 font-medium"}>
                            {scanner.dataWedge.installed ? `Yes${scanner.dataWedge.packageVersion ? ` (v${scanner.dataWedge.packageVersion})` : ""}` : "No"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="theme-text-tertiary">Enabled</span>
                          <span className={scanner.dataWedge.packageEnabled ? "text-emerald-500 font-medium" : "text-red-400 font-medium"}>
                            {scanner.dataWedge.packageEnabled ? "Yes" : "No — cannot scan"}
                          </span>
                        </div>
                        {scanner.dataWedge.lastConfig && (
                          <>
                            <div className="flex items-center justify-between text-sm">
                              <span className="theme-text-tertiary">Last “Fix Scanning”</span>
                              <span className="theme-text-secondary">{formatDate(scanner.dataWedge.lastConfig.at)}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="theme-text-tertiary">DataWedge accepted it</span>
                              <span className={scanner.dataWedge.lastConfig.setConfigResult === "SUCCESS" ? "text-emerald-500 font-medium" : "text-amber-500 font-medium"}>
                                {scanner.dataWedge.lastConfig.setConfigResult === "SUCCESS" ? "Yes" : scanner.dataWedge.lastConfig.setConfigResult ?? "unknown"}
                              </span>
                            </div>
                            {!!scanner.dataWedge.lastConfig.activeProfile && (
                              <div className="flex items-center justify-between text-sm">
                                <span className="theme-text-tertiary">Active profile</span>
                                <span className="theme-text-secondary">{scanner.dataWedge.lastConfig.activeProfile}</span>
                              </div>
                            )}
                            {!!scanner.dataWedge.lastConfig.error && (
                              <p className="text-xs px-3 py-2 rounded-lg ui-callout-amber">{scanner.dataWedge.lastConfig.error}</p>
                            )}
                          </>
                        )}
                        {scanner.dataWedge.installed && scanner.dataWedge.packageEnabled && (
                          <p className="text-xs theme-text-tertiary pt-1">
                            The engine is running. If it still won&apos;t read a barcode after &quot;Fix Scanning&quot;, the
                            imager itself or the scan trigger is the likely fault — that needs the device in hand.
                          </p>
                        )}
                      </div>
                    )}
                  </Card>
                )}

                {/* Screen View — an on-demand look at what's actually on this scanner's
                    screen, requested via the "View Screen" button above. This is a live view
                    of a named employee's device, not neutral telemetry, and a stale snapshot
                    shown as if it were current is worse than showing nothing — so the age is
                    front and center and a stale result is visually called out. */}
                {canEdit && isProvisioned && (
                  <Card>
                    <SectionHeader label="Screen View" />
                    <p className="text-xs mb-3 theme-text-tertiary">
                      A view of what&apos;s on this device&apos;s screen, captured on request — not a continuous feed.
                      Requesting one switches the scanner to a faster ~3s check-in for about 2 minutes, then it returns to its normal 5-minute cadence.
                    </p>
                    {!lastScreen ? (
                      <p className="text-sm theme-text-tertiary">No screen snapshot requested yet. Use &quot;View Screen&quot; above.</p>
                    ) : lastScreen.at === undefined ? (
                      <div className="space-y-3">
                        <p className="text-sm theme-text-tertiary">
                          The agent hasn&apos;t captured a screen snapshot yet (it may still be waiting on the Accessibility permission). Recent agent log below.
                        </p>
                        {!!lastScreen.logTail?.length && (
                          <div className={`font-mono text-[11px] rounded-lg border p-2.5 max-h-32 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words theme-border-secondary ${isDark ? "bg-slate-900" : "bg-gray-50"}`}>
                            {lastScreen.logTail.join("\n")}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className={`flex flex-wrap items-center gap-2 mb-3 px-2.5 py-1.5 rounded-lg text-xs font-medium ${screenIsStale ? "bg-amber-500/10 text-amber-500" : "bg-emerald-500/10 text-emerald-500"}`}>
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${screenIsStale ? "bg-amber-500" : "bg-emerald-500"}`} />
                          <span>{screenIsStale ? "Stale — captured" : "Captured"} {timeAgo(lastScreen.at)}</span>
                          {screenIsStale && (
                            <span className="theme-text-tertiary font-normal">The device may be showing something different now.</span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3 text-xs">
                          <div>
                            <div className="theme-text-tertiary mb-0.5">App</div>
                            <div className="font-mono theme-text-secondary truncate">{lastScreen.packageName || "Unknown"}</div>
                          </div>
                          <div>
                            <div className="theme-text-tertiary mb-0.5">Screen</div>
                            <div className="font-mono theme-text-secondary truncate">{lastScreen.activity || "Unknown"}</div>
                          </div>
                        </div>
                        {lastScreen.title && (
                          <div className="text-xs mb-3">
                            <span className="theme-text-tertiary">Window title: </span>
                            <span className="theme-text-secondary">{lastScreen.title}</span>
                          </div>
                        )}
                        <div className="mb-3">
                          <div className="ui-section-label mb-1">
                            On-screen text {lastScreen.truncated && <span className="text-amber-500 font-normal">(truncated — capped at 100 strings / 4096 chars, passwords skipped)</span>}
                          </div>
                          <div className={`font-mono text-[11px] rounded-lg border p-2.5 max-h-48 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words theme-border-secondary ${isDark ? "bg-slate-900" : "bg-gray-50"}`}>
                            {lastScreen.text?.length ? lastScreen.text.join("\n") : "(no on-screen text captured)"}
                          </div>
                        </div>
                        <div>
                          <div className="ui-section-label mb-1">Agent log tail</div>
                          <div className={`font-mono text-[11px] rounded-lg border p-2.5 max-h-32 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words theme-border-secondary ${isDark ? "bg-slate-900" : "bg-gray-50"}`}>
                            {lastScreen.logTail?.length ? lastScreen.logTail.join("\n") : "(no log lines)"}
                          </div>
                        </div>
                      </>
                    )}
                  </Card>
                )}

                {/* Recent Jobs — durable commands (AWS IoT Jobs). A QUEUED row on an offline
                    scanner must read as "waiting", not success: that false-success behavior
                    on the old fire-and-forget path is the reason this durable path exists. */}
                {canEdit && isProvisioned && recentJobs && recentJobs.length > 0 && (
                  <Card>
                    <SectionHeader label="Recent Jobs" />
                    <div className="space-y-2">
                      {recentJobs.map((job) => (
                        <div key={job._id} className={`flex items-center justify-between p-2.5 rounded-lg ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${jobStatusColors[job.status] ?? "text-slate-400 bg-slate-500/10"}`}>
                              {job.status === "QUEUED" ? "WAITING (queued)" : job.status.replace(/_/g, " ")}
                            </span>
                            <span className="text-xs font-medium theme-text-primary truncate">{job.command.replace(/_/g, " ")}</span>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="text-[10px] theme-text-tertiary">{formatDate(job.createdAt)}</div>
                            {job.statusDetail && (
                              <div className="text-[10px] text-red-400 max-w-[14rem] truncate" title={job.statusDetail}>{job.statusDetail}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Setup History */}
                {setupLogs && setupLogs.length > 0 && (
                  <Card>
                    <SectionHeader label="Setup History" />
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
                  </Card>
                )}

                {/* Timeline */}
                <div className="theme-card overflow-hidden p-0">
                  <div className="flex border-b theme-border-secondary">
                    {(["commands", "history", "conditions"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
                          activeTab === tab
                            ? "theme-accent-primary border-b-2 border-[var(--accent-primary)]"
                            : "theme-text-tertiary hover:theme-text-secondary"
                        }`}
                      >
                        {tab === "commands" ? "Commands" : tab === "history" ? "History" : "Conditions"}
                      </button>
                    ))}
                  </div>
                  <div className="p-4 max-h-80 overflow-y-auto">
                    {activeTab === "commands" && (
                      <div className="space-y-2">
                        {!scanner.commands?.length && <p className="text-xs theme-text-tertiary">No commands sent yet</p>}
                        {scanner.commands?.map((cmd) => (
                          <div key={cmd._id} className={`flex items-center justify-between p-2.5 rounded-lg ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`}>
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cmdStatusColors[cmd.status] ?? "text-slate-400 bg-slate-500/10"}`}>{cmd.status}</span>
                              <span className="text-xs font-medium theme-text-primary">{cmd.command}</span>
                              <span className="text-[10px] theme-text-tertiary">{cmd.issuedByName}</span>
                            </div>
                            <div className="text-right">
                              <div className="text-[10px] theme-text-tertiary">{formatDate(cmd.issuedAt)}</div>
                              {cmd.acknowledgedAt && (
                                <div className="text-[10px] text-cyan-500">{`ACK ${timeAgo(cmd.acknowledgedAt)}`}</div>
                              )}
                              {cmd.completedAt && (
                                <div className="text-[10px] text-emerald-500">{`Done ${timeAgo(cmd.completedAt)}`}</div>
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
                        {!scanner.history?.length && <p className="text-xs theme-text-tertiary">No history yet</p>}
                        {scanner.history?.map((h) => (
                          <div key={h._id} className={`flex items-center justify-between p-2.5 rounded-lg ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`}>
                            <div>
                              <span className="text-xs font-medium theme-text-primary">{h.action.replace(/_/g, " ")}</span>
                              {h.newAssigneeName && <span className="text-[10px] ml-1.5 theme-text-tertiary">to {h.newAssigneeName}</span>}
                              {h.notes && <p className="text-[10px] mt-0.5 theme-text-tertiary">{h.notes}</p>}
                            </div>
                            <div className="text-right">
                              <div className="text-[10px] theme-text-tertiary">{formatDate(h.createdAt)}</div>
                              <div className="text-[10px] theme-text-tertiary">{h.performedByName}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {activeTab === "conditions" && (
                      <p className="text-xs theme-text-tertiary">Condition checks appear here after equipment returns.</p>
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
              <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
                <Card>
                  <h2 className="text-lg font-semibold mb-2 theme-text-primary">
                    {pendingCommand === "wipe" ? "Factory Reset" : pendingCommand.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} — {scanner.number}
                  </h2>
                  {pendingCommand === "wipe" ? (
                    <>
                      <div className="p-3 rounded-lg mb-4 ui-callout-red">
                        <p className="text-sm">This erases ALL data and restores factory settings. Cannot be undone.</p>
                      </div>
                      <label className="block text-sm mb-2 theme-text-secondary">Type <span className="font-bold">{scanner.number}</span> to confirm:</label>
                      <input
                        type="text"
                        value={wipeConfirmText}
                        onChange={(e) => setWipeConfirmText(e.target.value)}
                        className="theme-input w-full px-3 py-2 text-sm mb-4"
                        placeholder={scanner.number}
                      />
                    </>
                  ) : (
                    <p className="text-sm mb-4 theme-text-secondary">
                      {pendingCommand === "lock" && "Lock the scanner screen immediately."}
                      {pendingCommand === "unlock" && "Unlock the scanner screen."}
                      {pendingCommand === "install_apk" && "Push latest APK updates to the scanner."}
                      {pendingCommand === "push_config" && "Push latest RT Locator configuration."}
                      {pendingCommand === "restart" && "Restart the scanner device."}
                      {pendingCommand === "update_pin" && "The scanner will generate a new 6-digit PIN and apply it. Nobody chooses the number, so it can\u2019t be a guessable one. It appears here once the scanner confirms it \u2014 if the scanner is off, this applies next time it powers up."}
                      {pendingCommand === "apply_policies" && "Re-apply device restrictions and lockdown policy."}
                      {pendingCommand === "datawedge_config" && "For a scanner that won’t read barcodes. Turns DataWedge (the barcode engine) back on, re-enables the scanner for Profile0, and re-applies the standard output format — suffix “!”, send data, then a Tab. It does not change which barcode types the scanner reads, so a working scanner won’t start behaving differently. DataWedge reports back whether it accepted the change, and you’ll see that below under Barcode Engine."}
                      {pendingCommand === "get_screen" && "Request a live look at this scanner’s screen — the app in use, on-screen text, and recent agent log lines. This is a view of what the assigned employee currently has on their device, not just a diagnostic number. The scanner will publish faster (about every 3 seconds) for roughly 2 minutes, then return to its normal 5-minute check-in."}
                    </p>
                  )}
                  {pendingCommand !== "wipe" && JOB_COMMANDS.has(pendingCommand) && !commandQueuedMsg && (
                    <p className="text-xs mb-4 -mt-2 theme-text-tertiary">
                      Sent as a durable job — it will run even if the scanner is off right now.
                    </p>
                  )}
                  {/* Offline is the case that goes wrong: nothing visibly happens, so the button
                      gets pressed again, and every extra job runs in addition to the first. */}
                  {!commandQueuedMsg && !scanner.isOnline && JOB_COMMANDS.has(pendingCommand) && (
                    <p className="text-xs mb-4 px-3 py-2 rounded-lg ui-callout-amber">
                      {scanner.number} is offline (last seen {formatDate(scanner.lastSeen)}). This will wait
                      until it checks in — that can be hours. Send it once.
                      {pendingCommand === "update_pin" && " Each PIN change picks a new random number, so two of them means the first PIN you see is not the one that ends up on the scanner."}
                    </p>
                  )}
                  {!commandQueuedMsg && !!pendingDuplicateJob && (
                    <p className="text-xs mb-4 px-3 py-2 rounded-lg ui-callout-red">
                      Already waiting: a {pendingDuplicateJob.command.replace(/_/g, " ")} job from {formatDate(pendingDuplicateJob.createdAt)} hasn&apos;t run yet.
                      Sending another adds a second one — it does not replace the first.
                    </p>
                  )}
                  {!!commandQueuedMsg && (
                    <p className="text-sm mb-4 px-3 py-2 rounded-lg ui-callout-green">{commandQueuedMsg}</p>
                  )}
                  {!!commandError && (
                    <p className="text-xs mb-4 px-3 py-2 rounded-lg ui-callout-amber break-words">
                      Not sent — {commandError}
                    </p>
                  )}
                  <div className="flex justify-end gap-3">
                    {commandQueuedMsg ? (
                      // Only one way out once it's been accepted — offering "Confirm" again here
                      // is how you end up with two jobs.
                      <Button variant="primary" onClick={() => { setShowCommandModal(false); setPendingCommand(null); setCommandQueuedMsg(""); }}>Done</Button>
                    ) : (
                      <>
                        <Button variant="ghost" onClick={() => { setShowCommandModal(false); setPendingCommand(null); }}>Cancel</Button>
                        <Button
                          variant={pendingCommand === "wipe" ? "danger" : "primary"}
                          onClick={executeCommand}
                          disabled={sending || !!pendingDuplicateJob || (pendingCommand === "wipe" && wipeConfirmText !== scanner.number)}
                        >
                          {sending ? "Sending..." : "Confirm"}
                        </Button>
                      </>
                    )}
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* Provision Modal */}
          {showProvisionModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => provisionStep !== "generating" && setShowProvisionModal(false)}>
              <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md mx-4">
                <Card>
                  {provisionStep === "confirm" && (
                    <>
                      <h3 className="text-lg font-bold mb-2 theme-text-primary">Provision Scanner</h3>
                      <p className="text-sm mb-4 theme-text-tertiary">
                        This will create IoT credentials for <strong>{scanner.number}</strong> and generate a setup code.
                      </p>
                      <div className="flex gap-3 justify-end">
                        <Button variant="ghost" onClick={() => setShowProvisionModal(false)}>Cancel</Button>
                        <Button variant="primary" onClick={handleProvision}>Provision</Button>
                      </div>
                    </>
                  )}
                  {provisionStep === "generating" && (
                    <div className="text-center py-8">
                      <div className="animate-spin w-8 h-8 border-2 border-[var(--accent-primary)] border-t-transparent rounded-full mx-auto mb-3"></div>
                      <p className="text-sm theme-text-tertiary">Creating IoT credentials...</p>
                    </div>
                  )}
                  {provisionStep === "code" && provisionCode && (
                    <>
                      <h3 className="text-lg font-bold mb-2 theme-text-primary">Setup Code Ready</h3>
                      <p className="text-sm mb-4 theme-text-tertiary">Enter this code on the scanner&apos;s setup screen:</p>
                      <div className={`text-center py-6 rounded-xl mb-4 ${isDark ? "bg-slate-800" : "bg-gray-50"}`}>
                        <div className="text-4xl font-mono font-bold tracking-[0.3em] theme-accent-primary">{provisionCode.code}</div>
                        <div className="text-xs mt-2 theme-text-tertiary">
                          {provisionCode.claimed ? (
                            <span className="text-emerald-500 font-medium">Claimed! Scanner is provisioning...</span>
                          ) : (
                            <>Expires {new Date(provisionCode.expiresAt).toLocaleTimeString()}</>
                          )}
                        </div>
                      </div>
                      {provisionCode.claimed ? (
                        <Button variant="primary" className="w-full" onClick={() => setShowProvisionModal(false)}>Done</Button>
                      ) : (
                        <Button variant="secondary" className="w-full" onClick={() => { navigator.clipboard.writeText(provisionCode.code); }}>Copy Code</Button>
                      )}
                    </>
                  )}
                  {provisionStep === "error" && (
                    <>
                      <h3 className="text-lg font-bold mb-2 text-red-500">Provisioning Failed</h3>
                      <p className="text-sm mb-4 theme-text-tertiary">{provisionError}</p>
                      <div className="flex gap-3 justify-end">
                        <Button variant="ghost" onClick={() => setShowProvisionModal(false)}>Close</Button>
                        <Button variant="primary" onClick={handleProvision}>Retry</Button>
                      </div>
                    </>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* Assign Modal */}
          {showAssignModal && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <Card>
                  <h2 className="text-lg font-semibold mb-1 theme-text-primary">
                    Assign Scanner {scanner.number}
                  </h2>
                  <p className="text-xs mb-4 theme-text-tertiary">Step {assignStep} of 2</p>

                  {assignStep === 1 ? (
                    <>
                      <label className="block text-sm font-medium mb-2 theme-text-secondary">Select Employee</label>
                      <select
                        value={selectedPersonnelId as string}
                        onChange={(e) => setSelectedPersonnelId(e.target.value as any)}
                        className="theme-input w-full px-3 py-2 text-sm"
                      >
                        <option value="">Choose...</option>
                        {personnel?.sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
                          <option key={p._id} value={p._id}>{p.name} — {p.position} ({p.department})</option>
                        ))}
                      </select>
                      <div className="flex justify-end gap-3 mt-6">
                        <Button variant="ghost" onClick={() => setShowAssignModal(false)}>Cancel</Button>
                        <Button variant="primary" onClick={() => setAssignStep(2)} disabled={!selectedPersonnelId}>
                          Continue to Agreement
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="p-3 rounded-lg mb-4 text-xs bg-blue-500/10 text-blue-500 rounded-lg">
                        Assigning to: <span className="font-bold">{selectedPerson?.name}</span>
                      </div>
                      <div className={`p-3 rounded-lg mb-4 font-mono text-[11px] max-h-48 overflow-y-auto whitespace-pre-wrap theme-border-secondary border ${isDark ? "bg-slate-900 theme-text-tertiary" : "bg-gray-50 text-gray-600"}`}>
                        {getAgreementText()}
                      </div>

                      {/* Signing method: draw on screen, or print + upload a signed copy */}
                      <div className={`flex rounded-lg p-0.5 mb-4 ${isDark ? "bg-slate-900" : "bg-gray-100"}`}>
                        <button
                          type="button"
                          onClick={() => setAssignMethod("draw")}
                          className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${assignMethod === "draw" ? "theme-btn-primary" : "theme-text-tertiary"}`}
                        >
                          Sign on screen
                        </button>
                        <button
                          type="button"
                          onClick={() => setAssignMethod("upload")}
                          className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${assignMethod === "upload" ? "theme-btn-primary" : "theme-text-tertiary"}`}
                        >
                          Print &amp; upload
                        </button>
                      </div>

                      {assignMethod === "draw" ? (
                        <>
                          <label className="block text-sm font-medium mb-2 theme-text-secondary">Employee Signature</label>
                          <div className="border rounded-lg overflow-hidden theme-border-secondary">
                            <SignaturePad height={150} onSignatureChange={(data: string | null) => setSignatureData(data ?? "")} />
                          </div>
                        </>
                      ) : (
                        <div className="space-y-3">
                          <Button
                            variant="secondary"
                            className="w-full"
                            onClick={() => selectedPerson && printAgreementFor(selectedPerson.name)}
                          >
                            Print agreement to sign
                          </Button>
                          <div>
                            <label className="block text-sm font-medium mb-1 theme-text-secondary">Upload signed copy (photo or PDF)</label>
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              disabled={uploadingDoc}
                              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAssignFilePick(f); }}
                              className="block w-full text-sm theme-text-secondary"
                            />
                            {uploadingDoc && <p className="text-xs mt-1 theme-text-tertiary">Uploading…</p>}
                            {uploadedFileName && !uploadingDoc && (
                              <p className="text-xs mt-1 text-[var(--accent-primary)]">Attached: {uploadedFileName}</p>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="flex justify-end gap-3 mt-6">
                        <Button variant="ghost" onClick={() => setAssignStep(1)}>Back</Button>
                        <Button
                          variant="primary"
                          onClick={handleAssign}
                          disabled={sending || uploadingDoc || (assignMethod === "draw" ? !signatureData : !uploadedDocId)}
                        >
                          {sending ? "Assigning..." : "Assign Equipment"}
                        </Button>
                      </div>
                    </>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* Return Modal */}
          {showReturnModal && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xl max-h-[90vh] overflow-y-auto">
                <Card>
                  <h2 className="text-lg font-semibold mb-1 theme-text-primary">Return Scanner {scanner.number}</h2>
                  <div className="p-3 rounded-lg mb-4 text-xs ui-callout-amber">
                    Returning from: <span className="font-bold">{scanner.assignedPersonName}</span>
                  </div>

                  {/* Condition Checklist */}
                  <label className="block text-sm font-medium mb-2 theme-text-secondary">Condition Checklist</label>
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {Object.entries(returnChecklist).map(([key, val]) => (
                      <label key={key} className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer text-xs border ${val ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" : "bg-red-500/10 border-red-500/20 text-red-400"}`}>
                        <input type="checkbox" checked={val} onChange={() => setReturnChecklist((c) => ({ ...c, [key]: !val }))} className="rounded" />
                        {key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
                      </label>
                    ))}
                  </div>

                  <label className="block text-sm font-medium mb-2 theme-text-secondary">Overall Condition</label>
                  <select
                    value={overallCondition}
                    onChange={(e) => setOverallCondition(e.target.value)}
                    className="theme-input w-full px-3 py-2 text-sm mb-4"
                  >
                    {["excellent", "good", "fair", "poor", "damaged"].map((c) => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>

                  <label className="block text-sm font-medium mb-2 theme-text-secondary">Damage Notes</label>
                  <textarea
                    value={damageNotes}
                    onChange={(e) => setDamageNotes(e.target.value)}
                    className="theme-input w-full px-3 py-2 text-sm mb-4"
                    rows={2}
                    placeholder="Describe any damage..."
                  />

                  <div className="flex items-center gap-4 mb-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={repairRequired} onChange={() => { setRepairRequired(!repairRequired); if (!repairRequired) setReadyForReassignment(false); }} className="rounded" />
                      <span className="theme-text-secondary">Repair Required</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={readyForReassignment} disabled={repairRequired} onChange={() => setReadyForReassignment(!readyForReassignment)} className="rounded" />
                      <span className="theme-text-secondary">Ready for Reassignment</span>
                    </label>
                  </div>

                  <div className="flex justify-end gap-3">
                    <Button variant="ghost" onClick={() => setShowReturnModal(false)}>Cancel</Button>
                    <Button variant="secondary" onClick={handleReturn} disabled={sending}>
                      {sending ? "Processing..." : "Complete Return"}
                    </Button>
                  </div>
                </Card>
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
