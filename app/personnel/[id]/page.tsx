"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Protected from "../../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useTheme } from "../../theme-context";
import { useAuth } from "../../auth-context";

const STATUS_OPTIONS = [
  { value: "active", label: "Active", color: "green" },
  { value: "on_leave", label: "On Leave", color: "amber" },
  { value: "terminated", label: "Terminated", color: "red" },
];

const statusColors: Record<string, string> = {
  active: "bg-green-500/20 text-green-400 border-green-500/30",
  on_leave: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  terminated: "bg-red-500/20 text-red-400 border-red-500/30",
};

const TABS = [
  { id: "overview", label: "Profile" },
  { id: "writeups", label: "Write-Ups" },
  { id: "attendance", label: "Attendance" },
  { id: "merits", label: "Merits" },
  { id: "equipment", label: "Equipment" },
  { id: "safety", label: "Safety" },
];

// Helper function to calculate tenure
function calculateTenure(hireDate: string, endDate?: string): {
  years: number;
  months: number;
  days: number;
  totalDays: number;
  display: string;
} {
  const start = new Date(hireDate);
  const end = endDate ? new Date(endDate) : new Date();

  const diffTime = end.getTime() - start.getTime();
  const totalDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  const years = Math.floor(totalDays / 365);
  const months = Math.floor((totalDays % 365) / 30);
  const days = totalDays % 30;

  let display = "";
  if (years > 0) display += `${years} year${years > 1 ? "s" : ""} `;
  if (months > 0) display += `${months} month${months > 1 ? "s" : ""} `;
  if (days > 0 || (!years && !months)) display += `${days} day${days !== 1 ? "s" : ""}`;

  return { years, months, days, totalDays, display: display.trim() };
}

// Helper to get tenure milestones
function getTenureMilestones(totalDays: number): {
  insuranceEligible: boolean;
  vacationEligible: boolean;
  daysToInsurance: number;
  daysToVacation: number;
} {
  return {
    insuranceEligible: totalDays >= 60,
    vacationEligible: totalDays >= 365,
    daysToInsurance: Math.max(0, 60 - totalDays),
    daysToVacation: Math.max(0, 365 - totalDays),
  };
}

// Write-up severity colors
const severityColors: Record<string, string> = {
  verbal: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  written: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  final: "bg-red-500/20 text-red-400 border-red-500/30",
  termination: "bg-red-700/20 text-red-500 border-red-700/30",
};

// Attendance status colors
const attendanceStatusColors: Record<string, string> = {
  present: "bg-green-500/20 text-green-400 border-green-500/30",
  absent: "bg-red-500/20 text-red-400 border-red-500/30",
  late: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  excused: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  no_call_no_show: "bg-red-700/20 text-red-500 border-red-700/30",
};

// Merit type colors
const meritTypeColors: Record<string, string> = {
  commendation: "bg-green-500/20 text-green-400 border-green-500/30",
  achievement: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  recognition: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  bonus: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};

// Helper to format schedule times
function formatScheduleTime(time: string): string {
  const [hours, minutes] = time.split(":");
  const h = parseInt(hours);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${minutes} ${ampm}`;
}

// Helper to get schedule display string from template
function getScheduleDisplay(template: { departments?: { startTime: string; endTime: string }[] }): string {
  if (template.departments && template.departments.length > 0) {
    const dept = template.departments[0];
    return `${formatScheduleTime(dept.startTime)} - ${formatScheduleTime(dept.endTime)}`;
  }
  return "No times set";
}

// Training areas
const TRAINING_AREAS = [
  "Picker Training Video",
  "Picking",
  "Shipping Floor",
  "Receiving",
  "Inventory",
  "Shift Management",
  "Leadership Training",
  "Safety Training",
];

// File icon helper
function getFileIcon(fileType: string) {
  if (fileType.startsWith("image/")) {
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  if (fileType === "application/pdf") {
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

// Attendance Attachment Item Component
function AttendanceAttachmentItem({
  attachment,
  attendanceId,
  canDelete,
  onDelete,
  isDark,
}: {
  attachment: {
    storageId: Id<"_storage">;
    fileName: string;
    fileType: string;
    uploadedAt: number;
  };
  attendanceId: Id<"attendance">;
  canDelete: boolean;
  onDelete: (attendanceId: Id<"attendance">, storageId: Id<"_storage">) => void;
  isDark: boolean;
}) {
  const attachmentUrl = useQuery(api.attendance.getAttachmentUrl, {
    storageId: attachment.storageId,
  });

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
        isDark
          ? "bg-slate-700/50 border border-slate-600"
          : "bg-gray-100 border border-gray-200"
      }`}
    >
      <span className={isDark ? "text-slate-400" : "text-gray-500"}>
        {getFileIcon(attachment.fileType)}
      </span>
      <a
        href={attachmentUrl || "#"}
        target="_blank"
        rel="noopener noreferrer"
        className={`hover:underline truncate max-w-[150px] ${
          isDark ? "text-cyan-400" : "text-blue-600"
        }`}
        title={attachment.fileName}
      >
        {attachment.fileName}
      </a>
      {canDelete && (
        <button
          onClick={() => onDelete(attendanceId, attachment.storageId)}
          className={`p-1 rounded hover:bg-red-500/20 transition-colors ${
            isDark ? "text-slate-500 hover:text-red-400" : "text-gray-400 hover:text-red-600"
          }`}
          title="Delete attachment"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

// Write-up Attachment Item Component
function AttachmentItem({
  attachment,
  writeUpId,
  canDelete,
  onDelete,
  isDark,
}: {
  attachment: {
    storageId: Id<"_storage">;
    fileName: string;
    fileType: string;
    uploadedAt: number;
  };
  writeUpId: Id<"writeUps">;
  canDelete: boolean;
  onDelete: (writeUpId: Id<"writeUps">, storageId: Id<"_storage">) => void;
  isDark: boolean;
}) {
  const attachmentUrl = useQuery(api.writeUps.getAttachmentUrl, {
    storageId: attachment.storageId,
  });

  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith("image/")) {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    }
    if (fileType === "application/pdf") {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      );
    }
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  };

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
        isDark
          ? "bg-slate-700/50 border border-slate-600"
          : "bg-gray-100 border border-gray-200"
      }`}
    >
      <span className={isDark ? "text-slate-400" : "text-gray-500"}>
        {getFileIcon(attachment.fileType)}
      </span>
      <a
        href={attachmentUrl || "#"}
        target="_blank"
        rel="noopener noreferrer"
        className={`hover:underline truncate max-w-[150px] ${
          isDark ? "text-cyan-400" : "text-blue-600"
        }`}
        title={attachment.fileName}
      >
        {attachment.fileName}
      </a>
      {canDelete && (
        <button
          onClick={() => onDelete(writeUpId, attachment.storageId)}
          className={`p-1 rounded hover:bg-red-500/20 transition-colors ${
            isDark ? "text-slate-500 hover:text-red-400" : "text-gray-400 hover:text-red-600"
          }`}
          title="Delete attachment"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

function PersonnelDetailContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const router = useRouter();
  const params = useParams();
  const personnelId = params.id as Id<"personnel">;
  const { user, canViewPersonnel, canManagePersonnel, canDeleteRecords, canEditPersonnelInfo } = useAuth();

  const [activeTab, setActiveTab] = useState("overview");
  const [showWriteUpModal, setShowWriteUpModal] = useState(false);
  const [showMeritModal, setShowMeritModal] = useState(false);
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [showEditPersonnelModal, setShowEditPersonnelModal] = useState(false);
  const [showTerminateModal, setShowTerminateModal] = useState(false);
  const [showRehireModal, setShowRehireModal] = useState(false);
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [selectedMilestone, setSelectedMilestone] = useState<string | null>(null);
  const [checkInNotes, setCheckInNotes] = useState("");
  const [viewingAgreement, setViewingAgreement] = useState<{
    text: string;
    signatureData: string;
    signedAt: number;
    witnessedByName: string;
  } | null>(null);

  // Queries
  const personnel = useQuery(api.personnel.getWithStats, { personnelId });
  const writeUps = useQuery(api.writeUps.listByPersonnel, { personnelId });
  const attendance = useQuery(api.attendance.listByPersonnel, { personnelId });
  const merits = useQuery(api.merits.listByPersonnel, { personnelId });
  const equipment = useQuery(api.equipment.getPersonnelEquipment, { personnelId });
  const equipmentAgreements = useQuery(api.equipment.getPersonnelAgreements, { personnelId });
  const locations = useQuery(api.locations.list);
  const safetyCompletions = useQuery(api.safetyChecklist.getPersonnelCompletions, { personnelId, limit: 20 });
  const portalLogin = useQuery(api.auth.getPersonnelPortalLogin, { personnelId });

  // Schedule templates
  const scheduleTemplates = useQuery(api.shiftTemplates.list, {});
  const assignedScheduleTemplate = useQuery(
    api.shiftTemplates.getById,
    personnel?.defaultScheduleTemplateId ? { templateId: personnel.defaultScheduleTemplateId } : "skip"
  );

  // Get linked application if exists
  const linkedApplication = useQuery(
    api.applications.getById,
    personnel?.applicationId ? { applicationId: personnel.applicationId } : "skip"
  );

  // Mutations
  const createWriteUp = useMutation(api.writeUps.create);
  const createMerit = useMutation(api.merits.create);
  const upsertAttendance = useMutation(api.attendance.upsert);
  const updatePersonnel = useMutation(api.personnel.update);
  const deleteWriteUp = useMutation(api.writeUps.remove);
  const deleteAttendance = useMutation(api.attendance.remove);
  const generateUploadUrl = useMutation(api.writeUps.generateUploadUrl);
  const addAttachment = useMutation(api.writeUps.addAttachment);
  const removeAttachment = useMutation(api.writeUps.removeAttachment);
  const generateAttendanceUploadUrl = useMutation(api.attendance.generateUploadUrl);
  const addAttendanceAttachment = useMutation(api.attendance.addAttachment);
  const removeAttendanceAttachment = useMutation(api.attendance.removeAttachment);
  const terminatePersonnel = useMutation(api.personnel.terminate);
  const rehirePersonnel = useMutation(api.personnel.rehire);
  const toggleTraining = useMutation(api.personnel.toggleTraining);
  const recordTenureCheckIn = useMutation(api.personnel.recordTenureCheckIn);
  const dismissTenureNotifications = useMutation(api.notifications.dismissTenureCheckInNotifications);
  const createEmployeePortalLogin = useMutation(api.auth.createEmployeePortalLogin);
  const resetEmployeePortalPassword = useMutation(api.auth.resetEmployeePortalPassword);
  const updateScheduleAssignment = useMutation(api.personnel.updateScheduleAssignment);
  const clearScheduleAssignment = useMutation(api.personnel.clearScheduleAssignment);
  const createScheduleOverride = useMutation(api.personnel.createScheduleOverride);
  const deleteScheduleOverride = useMutation(api.personnel.deleteScheduleOverride);

  // Schedule overrides query - get upcoming 30 days
  const scheduleOverrides = useQuery(api.personnel.getScheduleOverrides, {
    personnelId,
    startDate: new Date().toISOString().split("T")[0],
  });

  // File upload state
  const [uploadingWriteUpId, setUploadingWriteUpId] = useState<Id<"writeUps"> | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Write-up file upload state
  const [writeUpFiles, setWriteUpFiles] = useState<File[]>([]);
  const [isCreatingWriteUp, setIsCreatingWriteUp] = useState(false);

  // Attendance file upload state
  const [uploadingAttendanceId, setUploadingAttendanceId] = useState<Id<"attendance"> | null>(null);
  const [isUploadingAttendance, setIsUploadingAttendance] = useState(false);

  // Edit personnel loading state
  const [isSavingPersonnel, setIsSavingPersonnel] = useState(false);

  // Portal login state
  const [isCreatingPortalLogin, setIsCreatingPortalLogin] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [showTempPasswordModal, setShowTempPasswordModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedScheduleTemplateId, setSelectedScheduleTemplateId] = useState<Id<"shiftTemplates"> | null>(null);
  const [tempPassword, setTempPassword] = useState("");
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideForm, setOverrideForm] = useState({
    date: new Date().toISOString().split("T")[0],
    overrideType: "day_off" as "day_off" | "modified_hours" | "extra_shift",
    startTime: "08:00",
    endTime: "17:00",
    reason: "",
  });
  const [isCreatingOverride, setIsCreatingOverride] = useState(false);

  // Form states
  const [writeUpForm, setWriteUpForm] = useState({
    date: new Date().toISOString().split("T")[0],
    severity: "verbal",
    category: "",
    description: "",
    followUpDate: "",
  });

  const [meritForm, setMeritForm] = useState({
    date: new Date().toISOString().split("T")[0],
    type: "commendation",
    title: "",
    description: "",
  });

  const [attendanceForm, setAttendanceForm] = useState({
    date: new Date().toISOString().split("T")[0],
    status: "absent",
    notes: "",
    actualStart: "",
    actualEnd: "",
    hoursWorked: "",
  });
  const [editingAttendanceId, setEditingAttendanceId] = useState<Id<"attendance"> | null>(null);

  const [editPersonnelForm, setEditPersonnelForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    position: "",
    department: "",
    locationId: "",
    hourlyRate: 0,
    notes: "",
    hireDate: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelationship: "",
  });

  const [terminateForm, setTerminateForm] = useState({
    terminationDate: new Date().toISOString().split("T")[0],
    terminationReason: "",
  });
  const [rehireForm, setRehireForm] = useState({
    rehireDate: new Date().toISOString().split("T")[0],
    position: "",
    department: "",
    employeeType: "full_time",
    hourlyRate: "",
    rehireReason: "",
  });

  // Initialize edit form when personnel data loads
  const initEditForm = () => {
    if (personnel) {
      setEditPersonnelForm({
        firstName: personnel.firstName,
        lastName: personnel.lastName,
        email: personnel.email,
        phone: personnel.phone,
        position: personnel.position,
        department: personnel.department,
        locationId: personnel.locationId || "",
        hourlyRate: personnel.hourlyRate || 0,
        notes: personnel.notes || "",
        hireDate: personnel.hireDate,
        emergencyContactName: personnel.emergencyContact?.name || "",
        emergencyContactPhone: personnel.emergencyContact?.phone || "",
        emergencyContactRelationship: personnel.emergencyContact?.relationship || "",
      });
    }
  };

  // Redirect if user doesn't have permission
  if (!canViewPersonnel) {
    return (
      <div className={`flex h-screen theme-bg-primary`}>
        <Sidebar />
        <main className="flex-1 flex flex-col">
          <MobileHeader />
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <h1 className={`text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                Access Denied
              </h1>
              <p className={`mt-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                You don&apos;t have permission to view this page.
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!personnel) {
    return (
      <div className={`flex h-screen theme-bg-primary`}>
        <Sidebar />
        <main className="flex-1 flex flex-col">
          <MobileHeader />
          <div className="flex-1 flex items-center justify-center">
            <div className={`animate-pulse ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Loading...
            </div>
          </div>
        </main>
      </div>
    );
  }

  const handleCreateWriteUp = async () => {
    if (!user || !writeUpForm.category || !writeUpForm.description) return;

    setIsCreatingWriteUp(true);
    try {
      // Create the write-up first
      const writeUpId = await createWriteUp({
        personnelId,
        date: writeUpForm.date,
        severity: writeUpForm.severity,
        category: writeUpForm.category,
        description: writeUpForm.description,
        followUpRequired: false,
        followUpDate: writeUpForm.followUpDate || undefined,
        issuedBy: user._id as Id<"users">,
      });

      // Upload files if any
      if (writeUpFiles.length > 0) {
        for (const file of writeUpFiles) {
          // Get upload URL from Convex
          const uploadUrl = await generateUploadUrl();

          // Upload the file
          const result = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": file.type },
            body: file,
          });

          const { storageId } = await result.json();

          // Add attachment to write-up
          await addAttachment({
            writeUpId,
            storageId,
            fileName: file.name,
            fileType: file.type,
          });
        }
      }

      setShowWriteUpModal(false);
      setWriteUpForm({
        date: new Date().toISOString().split("T")[0],
        severity: "verbal",
        category: "",
        description: "",
        followUpDate: "",
      });
      setWriteUpFiles([]);
    } catch (error) {
      console.error("Failed to create write-up:", error);
    } finally {
      setIsCreatingWriteUp(false);
    }
  };

  const handleCreateMerit = async () => {
    if (!user || !meritForm.title || !meritForm.description) return;
    await createMerit({
      personnelId,
      date: meritForm.date,
      type: meritForm.type,
      title: meritForm.title,
      description: meritForm.description,
      issuedBy: user._id as Id<"users">,
    });
    setShowMeritModal(false);
    setMeritForm({
      date: new Date().toISOString().split("T")[0],
      type: "commendation",
      title: "",
      description: "",
    });
  };

  const handleAddAttendance = async () => {
    await upsertAttendance({
      personnelId,
      date: attendanceForm.date,
      status: attendanceForm.status,
      notes: attendanceForm.notes || undefined,
      actualStart: attendanceForm.actualStart || undefined,
      actualEnd: attendanceForm.actualEnd || undefined,
      hoursWorked: attendanceForm.hoursWorked ? parseFloat(attendanceForm.hoursWorked) : undefined,
    });
    setShowAttendanceModal(false);
    setEditingAttendanceId(null);
    setAttendanceForm({
      date: new Date().toISOString().split("T")[0],
      status: "absent",
      notes: "",
      actualStart: "",
      actualEnd: "",
      hoursWorked: "",
    });
  };

  const handleUpdatePersonnel = async () => {
    setIsSavingPersonnel(true);
    try {
      const updateData: {
        personnelId: typeof personnelId;
        firstName?: string;
        lastName?: string;
        email: string;
        phone: string;
        position: string;
        department: string;
        hourlyRate?: number;
        notes?: string;
        hireDate?: string;
        emergencyContact?: {
          name: string;
          phone: string;
          relationship: string;
        };
      } = {
        personnelId,
        firstName: editPersonnelForm.firstName,
        lastName: editPersonnelForm.lastName,
        email: editPersonnelForm.email,
        phone: editPersonnelForm.phone,
        position: editPersonnelForm.position,
        department: editPersonnelForm.department,
        hourlyRate: editPersonnelForm.hourlyRate || undefined,
        notes: editPersonnelForm.notes || undefined,
      };

      // Allow admins to edit hire date
      if (editPersonnelForm.hireDate) {
        updateData.hireDate = editPersonnelForm.hireDate;
      }

      // Add locationId if provided
      if (editPersonnelForm.locationId) {
        (updateData as any).locationId = editPersonnelForm.locationId;
      }

      // Add emergency contact if provided
      if (editPersonnelForm.emergencyContactName && editPersonnelForm.emergencyContactPhone) {
        updateData.emergencyContact = {
          name: editPersonnelForm.emergencyContactName,
          phone: editPersonnelForm.emergencyContactPhone,
          relationship: editPersonnelForm.emergencyContactRelationship || "Not specified",
        };
      }

      await updatePersonnel({ ...updateData, userId: user?._id });
      setShowEditPersonnelModal(false);
    } catch (error) {
      console.error("Error updating personnel:", error);
      alert("Failed to update personnel. Please try again.");
    } finally {
      setIsSavingPersonnel(false);
    }
  };

  const handleDeleteWriteUp = async (writeUpId: Id<"writeUps">) => {
    if (confirm("Are you sure you want to delete this write-up? This action cannot be undone.")) {
      await deleteWriteUp({ writeUpId });
    }
  };

  const handleDeleteAttendance = async (attendanceId: Id<"attendance">) => {
    if (confirm("Are you sure you want to delete this attendance record? This action cannot be undone.")) {
      await deleteAttendance({ attendanceId });
    }
  };

  const handleEditAttendance = (record: {
    _id: Id<"attendance">;
    date: string;
    status: string;
    notes?: string;
    actualStart?: string;
    actualEnd?: string;
    hoursWorked?: number;
  }) => {
    setEditingAttendanceId(record._id);
    setAttendanceForm({
      date: record.date,
      status: record.status,
      notes: record.notes || "",
      actualStart: record.actualStart || "",
      actualEnd: record.actualEnd || "",
      hoursWorked: record.hoursWorked?.toString() || "",
    });
    setShowAttendanceModal(true);
  };

  const handleFileUpload = async (writeUpId: Id<"writeUps">, files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadingWriteUpId(writeUpId);

    try {
      for (const file of Array.from(files)) {
        // Get upload URL from Convex
        const uploadUrl = await generateUploadUrl();

        // Upload file to Convex storage
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!response.ok) {
          throw new Error("Failed to upload file");
        }

        const { storageId } = await response.json();

        // Add attachment to write-up
        await addAttachment({
          writeUpId,
          storageId,
          fileName: file.name,
          fileType: file.type,
        });
      }
    } catch (error) {
      console.error("Error uploading file:", error);
      alert("Failed to upload file. Please try again.");
    } finally {
      setIsUploading(false);
      setUploadingWriteUpId(null);
    }
  };

  const handleDeleteAttachment = async (writeUpId: Id<"writeUps">, storageId: Id<"_storage">) => {
    if (confirm("Are you sure you want to delete this attachment?")) {
      try {
        await removeAttachment({ writeUpId, storageId });
      } catch (error) {
        console.error("Error deleting attachment:", error);
        alert("Failed to delete attachment. Please try again.");
      }
    }
  };

  const handleAttendanceFileUpload = async (attendanceId: Id<"attendance">, files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsUploadingAttendance(true);
    setUploadingAttendanceId(attendanceId);

    try {
      for (const file of Array.from(files)) {
        const uploadUrl = await generateAttendanceUploadUrl();

        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!response.ok) {
          throw new Error("Failed to upload file");
        }

        const { storageId } = await response.json();

        await addAttendanceAttachment({
          attendanceId,
          storageId,
          fileName: file.name,
          fileType: file.type,
        });
      }
    } catch (error) {
      console.error("Error uploading file:", error);
      alert("Failed to upload file. Please try again.");
    } finally {
      setIsUploadingAttendance(false);
      setUploadingAttendanceId(null);
    }
  };

  const handleDeleteAttendanceAttachment = async (attendanceId: Id<"attendance">, storageId: Id<"_storage">) => {
    if (confirm("Are you sure you want to delete this attachment?")) {
      try {
        await removeAttendanceAttachment({ attendanceId, storageId });
      } catch (error) {
        console.error("Error deleting attachment:", error);
        alert("Failed to delete attachment. Please try again.");
      }
    }
  };

  const handleTerminate = async () => {
    if (!terminateForm.terminationReason) {
      alert("Please provide a reason for termination.");
      return;
    }
    try {
      await terminatePersonnel({
        personnelId,
        terminationDate: terminateForm.terminationDate,
        terminationReason: terminateForm.terminationReason,
        userId: user?._id,
      });
      setShowTerminateModal(false);
      setTerminateForm({
        terminationDate: new Date().toISOString().split("T")[0],
        terminationReason: "",
      });
    } catch (error) {
      console.error("Error terminating personnel:", error);
      alert("Failed to terminate personnel. Please try again.");
    }
  };

  const handleRecordCheckIn = async () => {
    if (!user || !selectedMilestone) return;
    try {
      await recordTenureCheckIn({
        personnelId,
        milestone: selectedMilestone,
        completedBy: user._id as Id<"users">,
        completedByName: user.name || user.email || "Unknown",
        notes: checkInNotes || undefined,
      });
      // Dismiss any notifications for this check-in
      await dismissTenureNotifications({
        personnelId,
        milestone: selectedMilestone,
      });
      setShowCheckInModal(false);
      setSelectedMilestone(null);
      setCheckInNotes("");
    } catch (error) {
      console.error("Error recording check-in:", error);
      alert("Failed to record check-in. Please try again.");
    }
  };

  // Calculate tenure for display
  const tenure = personnel ? calculateTenure(personnel.hireDate, personnel.terminationDate) : null;
  const milestones = tenure ? getTenureMilestones(tenure.totalDays) : null;

  return (
    <div className={`flex h-screen theme-bg-primary`}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        {/* Header */}
        <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-8 py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push("/personnel")}
                className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex items-center gap-4">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl text-white font-bold ${isDark ? "bg-gradient-to-br from-cyan-400 to-blue-500" : "bg-gradient-to-br from-blue-500 to-blue-600"}`}>
                  {personnel.firstName.charAt(0)}{personnel.lastName.charAt(0)}
                </div>
                <div>
                  <h1 className={`text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                    {personnel.firstName} {personnel.lastName}
                  </h1>
                  <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    {personnel.position} • {personnel.department}
                    {personnel.locationId && locations?.find(l => l._id === personnel.locationId) && (
                      <span> • {locations.find(l => l._id === personnel.locationId)?.name}</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
            <span className={`px-3 py-1 text-sm font-medium rounded border ${statusColors[personnel.status] || statusColors.active}`}>
              {STATUS_OPTIONS.find((s) => s.value === personnel.status)?.label || personnel.status}
            </span>
          </div>

          {/* Summary bar — always-visible essentials so users don't have to
              dig through the Profile tab for tenure, portal status, or to
              tap a phone/email. */}
          {(() => {
            const tenure = calculateTenure(
              personnel.hireDate,
              personnel.status === "terminated" ? personnel.terminationDate : undefined
            );
            const hireDateLabel = new Date(personnel.hireDate).toLocaleDateString(undefined, {
              month: "short", day: "numeric", year: "numeric",
            });
            return (
              <div className={`mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                <div className="flex items-center gap-2">
                  <svg className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span><span className={isDark ? "text-slate-500" : "text-gray-500"}>Hired</span> {hireDateLabel}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isDark ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-700"}`}>
                    {tenure.display}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${portalLogin?.isActive ? "bg-green-500" : portalLogin ? "bg-amber-500" : "bg-gray-400"}`} />
                  <span>
                    {portalLogin?.isActive
                      ? "Portal active"
                      : portalLogin
                        ? "Portal disabled"
                        : "No portal login"}
                  </span>
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  {personnel.phone && (
                    <a
                      href={`tel:${personnel.phone}`}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${isDark ? "bg-slate-700/60 hover:bg-slate-700 text-slate-200" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
                      title={personnel.phone}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      Call
                    </a>
                  )}
                  {personnel.email && (
                    <a
                      href={`mailto:${personnel.email}`}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${isDark ? "bg-slate-700/60 hover:bg-slate-700 text-slate-200" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
                      title={personnel.email}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      Email
                    </a>
                  )}
                  {canEditPersonnelInfo && (
                    <button
                      onClick={() => {
                        initEditForm();
                        setShowEditPersonnelModal(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold text-white transition-colors"
                      style={{ backgroundColor: "#007AFF" }}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Edit Personnel
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Tabs */}
          <div className="flex gap-2 mt-4">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? isDark
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "bg-blue-50 text-blue-600 border border-blue-200"
                    : isDark
                      ? "text-slate-400 hover:bg-slate-700/50"
                      : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>

        <div className="p-8">
          {/* Overview Tab */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className={`rounded-lg p-4 text-center ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                  <p className={`text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                    {personnel.stats?.writeUpsCount || 0}
                  </p>
                  <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>Write-Ups</p>
                </div>
                <div className={`rounded-lg p-4 text-center ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                  <p className={`text-2xl font-bold text-green-400`}>
                    {personnel.stats?.meritsCount || 0}
                  </p>
                  <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>Merits</p>
                </div>
                <div className={`rounded-lg p-4 text-center ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                  <p className={`text-2xl font-bold text-blue-400`}>
                    {personnel.stats?.attendance?.presentDays || 0}
                  </p>
                  <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>Present (30d)</p>
                </div>
                <div className={`rounded-lg p-4 text-center ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                  <p className={`text-2xl font-bold text-red-400`}>
                    {personnel.stats?.activeWriteUps || 0}
                  </p>
                  <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>Active Write-Ups</p>
                </div>
              </div>

              {/* Profile Info */}
              <div className={`rounded-xl p-6 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                    Profile Information
                  </h2>
                  {canEditPersonnelInfo && (
                    <button
                      onClick={() => {
                        initEditForm();
                        setShowEditPersonnelModal(true);
                      }}
                      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                        isDark
                          ? "bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30"
                          : "bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200"
                      }`}
                    >
                      Edit
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>Email</p>
                    <p className={`${isDark ? "text-white" : "text-gray-900"}`}>{personnel.email}</p>
                  </div>
                  <div>
                    <p className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>Phone</p>
                    <a href={`tel:${personnel.phone}`} className={`${isDark ? "text-white" : "text-gray-900"}`}>{personnel.phone}</a>
                  </div>
                  <div>
                    <p className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>Hire Date</p>
                    <p className={`${isDark ? "text-white" : "text-gray-900"}`}>
                      {new Date(personnel.hireDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>Hourly Rate</p>
                    <p className={`${isDark ? "text-white" : "text-gray-900"}`}>
                      ${personnel.hourlyRate?.toFixed(2) || "N/A"}/hr
                    </p>
                  </div>
                  {personnel.emergencyContact && (
                    <div className="md:col-span-2">
                      <p className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>Emergency Contact</p>
                      <p className={`${isDark ? "text-white" : "text-gray-900"}`}>
                        {personnel.emergencyContact.name} ({personnel.emergencyContact.relationship}) - {personnel.emergencyContact.phone}
                      </p>
                    </div>
                  )}
                  {personnel.notes && (
                    <div className="md:col-span-2">
                      <p className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>Notes</p>
                      <p className={`${isDark ? "text-slate-300" : "text-gray-700"}`}>{personnel.notes}</p>
                    </div>
                  )}
                  {/* Link to original application if exists */}
                  {personnel.applicationId && (
                    <div className="md:col-span-2 pt-2 border-t border-slate-700/50">
                      <p className={`text-xs font-medium mb-1 ${isDark ? "text-slate-500" : "text-gray-500"}`}>Original Application</p>
                      <a
                        href={`/applications/${personnel.applicationId}`}
                        className={`inline-flex items-center gap-2 text-sm font-medium transition-colors ${
                          isDark
                            ? "text-cyan-400 hover:text-cyan-300"
                            : "text-blue-600 hover:text-blue-700"
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        View Application & Interview Records
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Portal Login Section */}
              <div className={`rounded-xl p-6 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      portalLogin
                        ? isDark ? "bg-green-500/20" : "bg-green-100"
                        : isDark ? "bg-slate-700" : "bg-gray-100"
                    }`}>
                      <svg className={`w-5 h-5 ${portalLogin ? "text-green-500" : isDark ? "text-slate-400" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                        Employee Portal Access
                      </h2>
                      <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        {portalLogin
                          ? `Active login: ${portalLogin.email}`
                          : "No portal login created yet"
                        }
                      </p>
                    </div>
                  </div>
                  {!portalLogin && canManagePersonnel && personnel.email && (
                    <button
                      onClick={async () => {
                        setIsCreatingPortalLogin(true);
                        try {
                          const result = await createEmployeePortalLogin({ personnelId });
                          if (result.success) {
                            if (result.tempPassword) {
                              setTempPassword(result.tempPassword);
                              setShowTempPasswordModal(true);
                            } else if (result.alreadyExists) {
                              alert(result.message || "Account linked successfully");
                            }
                          } else {
                            alert(result.error || "Failed to create portal login");
                          }
                        } catch (error) {
                          console.error("Failed to create portal login:", error);
                          alert("An error occurred while creating portal login");
                        } finally {
                          setIsCreatingPortalLogin(false);
                        }
                      }}
                      disabled={isCreatingPortalLogin}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                        isDark
                          ? "bg-cyan-500 hover:bg-cyan-400 text-white"
                          : "bg-blue-600 hover:bg-blue-700 text-white"
                      } disabled:opacity-50`}
                    >
                      {isCreatingPortalLogin ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Creating...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                          </svg>
                          Create Portal Login
                        </>
                      )}
                    </button>
                  )}
                  {portalLogin && (
                    <div className="flex items-center gap-3">
                      {canManagePersonnel && (
                        <button
                          onClick={async () => {
                            if (!confirm("Reset this employee's portal password? They will be given a new temporary password and forced to change it on next login.")) {
                              return;
                            }
                            setIsResettingPassword(true);
                            try {
                              const result = await resetEmployeePortalPassword({
                                personnelId,
                                adminUserId: user!._id,
                              });
                              if (result.success && result.tempPassword) {
                                setTempPassword(result.tempPassword);
                                setShowTempPasswordModal(true);
                              } else {
                                alert(result.error || "Failed to reset password");
                              }
                            } catch (error) {
                              console.error("Failed to reset password:", error);
                              alert("An error occurred while resetting password");
                            } finally {
                              setIsResettingPassword(false);
                            }
                          }}
                          disabled={isResettingPassword}
                          className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors flex items-center gap-2 ${
                            isDark
                              ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                              : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                          } disabled:opacity-50`}
                        >
                          {isResettingPassword ? (
                            <>
                              <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              Resetting...
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                              </svg>
                              Reset Password
                            </>
                          )}
                        </button>
                      )}
                      <span className={`px-3 py-1 text-sm font-medium rounded border ${
                        portalLogin.isActive
                          ? "bg-green-500/20 text-green-400 border-green-500/30"
                          : "bg-red-500/20 text-red-400 border-red-500/30"
                      }`}>
                        {portalLogin.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                  )}
                </div>
                {!personnel.email && !portalLogin && (
                  <p className={`mt-3 text-sm ${isDark ? "text-amber-400" : "text-amber-600"}`}>
                    Add an email address to this personnel record to enable portal login creation.
                  </p>
                )}
              </div>

              {/* Schedule Assignment Section */}
              <div className={`rounded-xl p-6 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? "bg-blue-500/20" : "bg-blue-100"}`}>
                      <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                        Schedule Assignment
                      </h2>
                      <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        {personnel.defaultScheduleTemplateId
                          ? "Assigned to schedule template"
                          : "No schedule template assigned"
                        }
                      </p>
                    </div>
                  </div>
                  {canManagePersonnel && (
                    <button
                      onClick={() => setShowScheduleModal(true)}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                        isDark
                          ? "bg-blue-500 hover:bg-blue-400 text-white"
                          : "bg-blue-600 hover:bg-blue-700 text-white"
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      {personnel.defaultScheduleTemplateId ? "Change Schedule" : "Assign Schedule"}
                    </button>
                  )}
                </div>
                {personnel.defaultScheduleTemplateId && assignedScheduleTemplate && (
                  <div className={`mt-4 p-4 rounded-lg ${isDark ? "bg-slate-700/50" : "bg-gray-50"}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                          {assignedScheduleTemplate.name}
                        </p>
                        <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          {getScheduleDisplay(assignedScheduleTemplate)}
                        </p>
                      </div>
                      {canManagePersonnel && (
                        <button
                          onClick={async () => {
                            if (confirm("Remove schedule assignment?")) {
                              try {
                                await clearScheduleAssignment({
                                  personnelId: personnel._id,
                                  userId: user!._id
                                });
                              } catch (error) {
                                console.error("Failed to clear schedule:", error);
                                alert("Failed to clear schedule assignment");
                              }
                            }
                          }}
                          className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                            isDark
                              ? "text-red-400 hover:bg-red-500/20"
                              : "text-red-600 hover:bg-red-50"
                          }`}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Schedule Overrides Section */}
              <div className={`rounded-xl p-6 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? "bg-purple-500/20" : "bg-purple-100"}`}>
                      <svg className="w-6 h-6 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                        Schedule Overrides
                      </h2>
                      <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        One-time schedule changes (days off, modified hours)
                      </p>
                    </div>
                  </div>
                  {canManagePersonnel && (
                    <button
                      onClick={() => setShowOverrideModal(true)}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                        isDark
                          ? "bg-purple-500 hover:bg-purple-400 text-white"
                          : "bg-purple-600 hover:bg-purple-700 text-white"
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      Add Override
                    </button>
                  )}
                </div>

                {/* Overrides List */}
                {scheduleOverrides && scheduleOverrides.length > 0 ? (
                  <div className="space-y-2">
                    {scheduleOverrides.map((override) => (
                      <div
                        key={override._id}
                        className={`p-4 rounded-lg flex items-center justify-between ${
                          isDark ? "bg-slate-700/50" : "bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            override.overrideType === "day_off"
                              ? isDark ? "bg-red-500/20" : "bg-red-100"
                              : override.overrideType === "modified_hours"
                              ? isDark ? "bg-amber-500/20" : "bg-amber-100"
                              : isDark ? "bg-green-500/20" : "bg-green-100"
                          }`}>
                            {override.overrideType === "day_off" ? (
                              <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            ) : override.overrideType === "modified_hours" ? (
                              <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            ) : (
                              <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                              </svg>
                            )}
                          </div>
                          <div>
                            <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                              {new Date(override.date + "T00:00:00").toLocaleDateString("en-US", {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                              })}
                              {" - "}
                              {override.overrideType === "day_off" && "Day Off"}
                              {override.overrideType === "modified_hours" && `Modified Hours (${override.startTime} - ${override.endTime})`}
                              {override.overrideType === "extra_shift" && `Extra Shift (${override.startTime} - ${override.endTime})`}
                            </p>
                            {override.reason && (
                              <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                {override.reason}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            override.status === "approved"
                              ? "bg-green-500/20 text-green-400 border border-green-500/30"
                              : override.status === "pending"
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                              : "bg-red-500/20 text-red-400 border border-red-500/30"
                          }`}>
                            {override.status}
                          </span>
                          {canManagePersonnel && (
                            <button
                              onClick={async () => {
                                if (confirm("Delete this schedule override?")) {
                                  try {
                                    await deleteScheduleOverride({
                                      overrideId: override._id,
                                      userId: user!._id,
                                    });
                                  } catch (error) {
                                    console.error("Failed to delete override:", error);
                                    alert("Failed to delete override");
                                  }
                                }
                              }}
                              className={`p-1 rounded-lg transition-colors ${
                                isDark
                                  ? "text-red-400 hover:bg-red-500/20"
                                  : "text-red-600 hover:bg-red-50"
                              }`}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`text-center py-8 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p>No upcoming schedule overrides</p>
                  </div>
                )}
              </div>

              {/* Training Badges Section - IE Tire Badges of Honor */}
              <div className={`rounded-xl p-6 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? "bg-amber-500/20" : "bg-amber-100"}`}>
                      <svg className="w-6 h-6 text-amber-500" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                        IE Tire Badges of Honor
                      </h2>
                      <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        {personnel.trainingRecords?.length || personnel.completedTraining?.length || 0} of {TRAINING_AREAS.length} certifications earned
                      </p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {TRAINING_AREAS.map((area) => {
                    // Check both new trainingRecords and legacy completedTraining
                    const trainingRecord = personnel.trainingRecords?.find((r) => r.area === area);
                    const isCompleted = trainingRecord || personnel.completedTraining?.includes(area);
                    const completedDate = trainingRecord?.completedAt
                      ? new Date(trainingRecord.completedAt).toLocaleDateString()
                      : null;

                    return (
                      <button
                        type="button"
                        key={area}
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!canManagePersonnel) return;
                          try {
                            await toggleTraining({ personnelId: personnel._id, trainingArea: area });
                          } catch (error) {
                            console.error("Failed to toggle training:", error);
                          }
                        }}
                        disabled={!canManagePersonnel}
                        className={`relative p-4 rounded-xl text-center transition-all transform ${
                          canManagePersonnel ? "cursor-pointer hover:scale-105 active:scale-95" : "cursor-not-allowed"
                        } ${
                          isCompleted
                            ? isDark
                              ? "bg-gradient-to-br from-amber-500/20 to-orange-500/20 border-2 border-amber-500/50 shadow-lg shadow-amber-500/10"
                              : "bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-400 shadow-lg shadow-amber-200/50"
                            : isDark
                              ? "bg-slate-700/30 border border-slate-600/50 hover:border-slate-500 opacity-60"
                              : "bg-gray-50 border border-gray-200 hover:border-gray-300 opacity-60"
                        }`}
                      >
                        {/* Badge Icon */}
                        <div className={`w-12 h-12 mx-auto mb-2 rounded-full flex items-center justify-center ${
                          isCompleted
                            ? "bg-gradient-to-br from-amber-400 to-orange-500 shadow-md"
                            : isDark
                              ? "bg-slate-600/50"
                              : "bg-gray-200"
                        }`}>
                          {isCompleted ? (
                            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                            </svg>
                          ) : (
                            <svg className={`w-6 h-6 ${isDark ? "text-slate-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                            </svg>
                          )}
                        </div>

                        {/* Badge Title */}
                        <p className={`text-xs font-semibold leading-tight ${
                          isCompleted
                            ? isDark ? "text-amber-300" : "text-amber-700"
                            : isDark ? "text-slate-400" : "text-gray-500"
                        }`}>
                          {area}
                        </p>

                        {/* Completion Date */}
                        {isCompleted && (
                          <p className={`text-[10px] mt-1 ${isDark ? "text-amber-400/70" : "text-amber-600/70"}`}>
                            {completedDate || "Earned"}
                          </p>
                        )}

                        {/* Earned Ribbon */}
                        {isCompleted && (
                          <div className={`absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center ${
                            isDark ? "bg-emerald-500" : "bg-emerald-500"
                          } shadow-md`}>
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
                {!canManagePersonnel && (
                  <p className={`text-xs mt-4 text-center ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Only managers can award badges
                  </p>
                )}
              </div>

              {/* Linked Application Card */}
              {personnel.applicationId && (
                <div className={`rounded-xl p-6 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                      Original Application
                    </h2>
                    <button
                      onClick={() => router.push(`/applications/${personnel.applicationId}`)}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                        isDark
                          ? "bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30"
                          : "bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200"
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      View Application
                    </button>
                  </div>
                  {linkedApplication ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <p className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>Applied Position</p>
                        <p className={`${isDark ? "text-white" : "text-gray-900"}`}>{linkedApplication.appliedJobTitle}</p>
                      </div>
                      <div>
                        <p className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>Applied On</p>
                        <p className={`${isDark ? "text-white" : "text-gray-900"}`}>
                          {new Date(linkedApplication.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div>
                        <p className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>Application Status</p>
                        <span className={`px-2 py-1 text-xs font-medium rounded border ${statusColors.active}`}>
                          Hired
                        </span>
                      </div>
                      {linkedApplication.aiAnalysis && (
                        <div>
                          <p className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>AI Match Score</p>
                          <p className={`${isDark ? "text-white" : "text-gray-900"}`}>
                            {linkedApplication.aiAnalysis.matchScore}%
                          </p>
                        </div>
                      )}
                      {linkedApplication.candidateAnalysis && (
                        <>
                          <div>
                            <p className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>Overall Score</p>
                            <p className={`${isDark ? "text-white" : "text-gray-900"}`}>
                              {linkedApplication.candidateAnalysis.overallScore}/100
                            </p>
                          </div>
                          <div>
                            <p className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>Prior Experience</p>
                            <p className={`${isDark ? "text-white" : "text-gray-900"}`}>
                              {linkedApplication.candidateAnalysis.totalYearsExperience.toFixed(1)} years
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Loading application data...
                    </p>
                  )}
                </div>
              )}

              {/* Tenure & Employment Card */}
              <div className={`rounded-xl p-6 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                    Tenure & Employment
                  </h2>
                  {personnel.status === "terminated" && (
                    <span className={`px-3 py-1 text-sm font-medium rounded-full ${
                      isDark
                        ? "bg-red-500/20 text-red-400 border border-red-500/30"
                        : "bg-red-50 text-red-600 border border-red-200"
                    }`}>
                      Terminated
                    </span>
                  )}
                </div>

                {/* Tenure Display */}
                {tenure && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <p className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                          {personnel.status === "terminated" ? "Total Employment" : "Current Tenure"}
                        </p>
                        <p className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                          {tenure.display}
                        </p>
                      </div>
                      <div>
                        <p className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>Hire Date</p>
                        <p className={`${isDark ? "text-white" : "text-gray-900"}`}>
                          {new Date(personnel.hireDate).toLocaleDateString()}
                        </p>
                      </div>
                      {personnel.status === "terminated" && personnel.terminationDate && (
                        <div>
                          <p className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-gray-500"}`}>Termination Date</p>
                          <p className={`${isDark ? "text-white" : "text-gray-900"}`}>
                            {new Date(personnel.terminationDate).toLocaleDateString()}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Termination Reason (if terminated) */}
                    {personnel.status === "terminated" && personnel.terminationReason && (
                      <div className={`p-4 rounded-lg ${isDark ? "bg-red-500/10 border border-red-500/20" : "bg-red-50 border border-red-200"}`}>
                        <p className={`text-xs font-medium mb-1 ${isDark ? "text-red-400" : "text-red-600"}`}>Termination Reason</p>
                        <p className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>{personnel.terminationReason}</p>
                      </div>
                    )}

                    {/* Milestones (only for active employees) */}
                    {personnel.status !== "terminated" && milestones && (
                      <div className={`p-4 rounded-lg ${isDark ? "bg-slate-700/50" : "bg-gray-50"}`}>
                        <p className={`text-xs font-medium mb-3 ${isDark ? "text-slate-400" : "text-gray-600"}`}>Tenure Milestones</p>
                        <div className="flex flex-wrap gap-3">
                          {/* Insurance Eligibility (60 days) */}
                          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                            milestones.insuranceEligible
                              ? isDark
                                ? "bg-green-500/20 border border-green-500/30"
                                : "bg-green-50 border border-green-200"
                              : isDark
                                ? "bg-slate-600/50 border border-slate-500/30"
                                : "bg-gray-100 border border-gray-200"
                          }`}>
                            {milestones.insuranceEligible ? (
                              <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            ) : (
                              <svg className={`w-5 h-5 ${isDark ? "text-slate-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            )}
                            <div>
                              <p className={`text-sm font-medium ${
                                milestones.insuranceEligible
                                  ? isDark ? "text-green-400" : "text-green-600"
                                  : isDark ? "text-slate-400" : "text-gray-600"
                              }`}>
                                Insurance Eligible
                              </p>
                              <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                                {milestones.insuranceEligible
                                  ? "Reached at 60 days"
                                  : `${milestones.daysToInsurance} days remaining`}
                              </p>
                            </div>
                          </div>

                          {/* Vacation Eligibility (1 year) */}
                          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                            milestones.vacationEligible
                              ? isDark
                                ? "bg-green-500/20 border border-green-500/30"
                                : "bg-green-50 border border-green-200"
                              : isDark
                                ? "bg-slate-600/50 border border-slate-500/30"
                                : "bg-gray-100 border border-gray-200"
                          }`}>
                            {milestones.vacationEligible ? (
                              <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            ) : (
                              <svg className={`w-5 h-5 ${isDark ? "text-slate-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            )}
                            <div>
                              <p className={`text-sm font-medium ${
                                milestones.vacationEligible
                                  ? isDark ? "text-green-400" : "text-green-600"
                                  : isDark ? "text-slate-400" : "text-gray-600"
                              }`}>
                                Vacation Time
                              </p>
                              <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                                {milestones.vacationEligible
                                  ? "Eligible after 1 year"
                                  : `${milestones.daysToVacation} days remaining`}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Terminate Button (admin+ only, non-terminated) */}
                    {canManagePersonnel && personnel.status !== "terminated" && (
                      <div className="pt-4 border-t border-dashed border-slate-600/50">
                        <button
                          onClick={() => setShowTerminateModal(true)}
                          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                            isDark
                              ? "bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
                              : "bg-red-50 hover:bg-red-100 text-red-600 border border-red-200"
                          }`}
                        >
                          Terminate Employee
                        </button>
                      </div>
                    )}

                    {/* Rehire Button (admin+ only, terminated) */}
                    {canManagePersonnel && personnel.status === "terminated" && (
                      <div className="pt-4 border-t border-dashed border-slate-600/50">
                        <button
                          onClick={() => {
                            setRehireForm({
                              rehireDate: new Date().toISOString().split("T")[0],
                              position: personnel.position || "",
                              department: personnel.department || "",
                              employeeType: personnel.employeeType || "full_time",
                              hourlyRate: personnel.hourlyRate?.toString() || "",
                              rehireReason: "",
                            });
                            setShowRehireModal(true);
                          }}
                          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                            isDark
                              ? "bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30"
                              : "bg-green-50 hover:bg-green-100 text-green-600 border border-green-200"
                          }`}
                        >
                          Rehire Employee
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Tenure Check-Ins Section (only for active employees) */}
              {personnel.status !== "terminated" && tenure && (
                <div className={`rounded-xl p-6 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? "bg-blue-500/20" : "bg-blue-100"}`}>
                        <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                      </div>
                      <div>
                        <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                          Tenure Check-Ins
                        </h2>
                        <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          {personnel.tenureCheckIns?.length || 0} of 5 milestones completed
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Check-in Milestones */}
                  <div className="space-y-3">
                    {[
                      { key: "1_day", label: "1 Day", dayThreshold: 1 },
                      { key: "3_day", label: "3 Day", dayThreshold: 3 },
                      { key: "7_day", label: "7 Day (1 Week)", dayThreshold: 7 },
                      { key: "30_day", label: "30 Day (1 Month)", dayThreshold: 30 },
                      { key: "60_day", label: "60 Day (2 Months)", dayThreshold: 60 },
                    ].map((milestone) => {
                      const checkIn = personnel.tenureCheckIns?.find((c) => c.milestone === milestone.key);
                      const isEligible = tenure.totalDays >= milestone.dayThreshold;
                      const isPastDue = isEligible && !checkIn;

                      return (
                        <div
                          key={milestone.key}
                          className={`flex items-center justify-between p-4 rounded-lg transition-all ${
                            checkIn
                              ? isDark
                                ? "bg-green-500/10 border border-green-500/30"
                                : "bg-green-50 border border-green-200"
                              : isPastDue
                                ? isDark
                                  ? "bg-amber-500/10 border border-amber-500/30"
                                  : "bg-amber-50 border border-amber-200"
                                : isDark
                                  ? "bg-slate-700/30 border border-slate-600/50"
                                  : "bg-gray-50 border border-gray-200"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            {/* Checkbox / Status Icon */}
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                              checkIn
                                ? "bg-green-500"
                                : isPastDue
                                  ? isDark ? "bg-amber-500/20" : "bg-amber-100"
                                  : isDark ? "bg-slate-600/50" : "bg-gray-200"
                            }`}>
                              {checkIn ? (
                                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              ) : isPastDue ? (
                                <svg className={`w-5 h-5 ${isDark ? "text-amber-400" : "text-amber-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              ) : (
                                <span className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                  {milestone.dayThreshold - tenure.totalDays}d
                                </span>
                              )}
                            </div>

                            {/* Milestone Info */}
                            <div>
                              <p className={`font-medium ${
                                checkIn
                                  ? isDark ? "text-green-400" : "text-green-700"
                                  : isPastDue
                                    ? isDark ? "text-amber-400" : "text-amber-700"
                                    : isDark ? "text-slate-300" : "text-gray-700"
                              }`}>
                                {milestone.label} Check-In
                              </p>
                              {checkIn ? (
                                <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                  Completed by {checkIn.completedByName} on {new Date(checkIn.completedAt).toLocaleDateString()}
                                  {checkIn.notes && (
                                    <span className="block mt-1 italic">&quot;{checkIn.notes}&quot;</span>
                                  )}
                                </div>
                              ) : isPastDue ? (
                                <p className={`text-xs ${isDark ? "text-amber-400/70" : "text-amber-600"}`}>
                                  Overdue - was due on day {milestone.dayThreshold}
                                </p>
                              ) : (
                                <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                                  Due in {milestone.dayThreshold - tenure.totalDays} days
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Action Button */}
                          {!checkIn && canManagePersonnel && (
                            <button
                              onClick={() => {
                                setSelectedMilestone(milestone.key);
                                setShowCheckInModal(true);
                              }}
                              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                                isPastDue
                                  ? isDark
                                    ? "bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30"
                                    : "bg-amber-100 hover:bg-amber-200 text-amber-700 border border-amber-300"
                                  : isDark
                                    ? "bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/30"
                                    : "bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200"
                              }`}
                            >
                              {isPastDue ? "Complete Now" : "Mark Complete"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {!canManagePersonnel && (
                    <p className={`text-xs mt-4 text-center ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      Only managers can record check-ins
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Write-Ups Tab */}
          {activeTab === "writeups" && (
            <div className="space-y-4">
              {canManagePersonnel && (
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowWriteUpModal(true)}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      isDark
                        ? "bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
                        : "bg-red-50 hover:bg-red-100 text-red-600 border border-red-200"
                    }`}
                  >
                    Add Write-Up
                  </button>
                </div>
              )}

              {writeUps && writeUps.length > 0 ? (
                <div className="space-y-4">
                  {writeUps.map((writeUp) => (
                    <div
                      key={writeUp._id}
                      className={`rounded-xl p-6 ${
                        writeUp.isDeprecated
                          ? isDark
                            ? "bg-slate-800/30 border border-slate-700/50"
                            : "bg-gray-50 border border-gray-200"
                          : isDark
                            ? "bg-slate-800/50 border border-slate-700"
                            : "bg-white border border-gray-200 shadow-sm"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2 flex-wrap">
                            <span className={`px-2 py-1 text-xs font-medium rounded border ${severityColors[writeUp.severity] || severityColors.verbal}`}>
                              {writeUp.severity.charAt(0).toUpperCase() + writeUp.severity.slice(1)}
                            </span>
                            <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              {new Date(writeUp.date).toLocaleDateString()}
                            </span>
                            {writeUp.isDeprecated && (
                              <span className={`px-2 py-1 text-xs font-medium rounded border ${
                                isDark
                                  ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                                  : "bg-amber-100 text-amber-700 border-amber-200"
                              }`}>
                                Deprecated ({writeUp.daysSinceIssued}+ days)
                              </span>
                            )}
                          </div>
                          <h3 className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                            {writeUp.category}
                          </h3>
                          <p className={`mt-2 text-sm ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                            {writeUp.description}
                          </p>
                          {writeUp.followUpDate && (
                            <p className={`mt-2 text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                              Follow-up: {new Date(writeUp.followUpDate).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2 ml-4">
                          <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                            By: {writeUp.issuerName}
                          </p>
                          {canDeleteRecords && (
                            <button
                              onClick={() => handleDeleteWriteUp(writeUp._id)}
                              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                                isDark
                                  ? "bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
                                  : "bg-red-50 hover:bg-red-100 text-red-600 border border-red-200"
                              }`}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Attachments Section */}
                      <div className={`mt-4 pt-4 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className={`text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                            Attachments
                          </h4>
                          {canManagePersonnel && (
                            <label
                              className={`px-3 py-1.5 text-xs font-medium rounded cursor-pointer transition-colors flex items-center gap-1 ${
                                isUploading && uploadingWriteUpId === writeUp._id
                                  ? isDark
                                    ? "bg-slate-600 text-slate-400"
                                    : "bg-gray-200 text-gray-400"
                                  : isDark
                                    ? "bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30"
                                    : "bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200"
                              }`}
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                              {isUploading && uploadingWriteUpId === writeUp._id ? "Uploading..." : "Add File"}
                              <input
                                type="file"
                                className="hidden"
                                multiple
                                onChange={(e) => handleFileUpload(writeUp._id, e.target.files)}
                                disabled={isUploading && uploadingWriteUpId === writeUp._id}
                                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.txt"
                              />
                            </label>
                          )}
                        </div>
                        {writeUp.attachments && writeUp.attachments.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {writeUp.attachments.map((attachment) => (
                              <AttachmentItem
                                key={attachment.storageId}
                                attachment={attachment}
                                writeUpId={writeUp._id}
                                canDelete={canDeleteRecords}
                                onDelete={handleDeleteAttachment}
                                isDark={isDark}
                              />
                            ))}
                          </div>
                        ) : (
                          <p className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                            No attachments
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`text-center py-12 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                  No write-ups on record
                </div>
              )}
            </div>
          )}

          {/* Attendance Tab */}
          {activeTab === "attendance" && (
            <div className="space-y-4">
              {canManagePersonnel && (
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowAttendanceModal(true)}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      isDark
                        ? "bg-cyan-500 hover:bg-cyan-400 text-white"
                        : "bg-blue-600 hover:bg-blue-700 text-white"
                    }`}
                  >
                    Add Attendance Record
                  </button>
                </div>
              )}

              {attendance && attendance.length > 0 ? (
                <div className="space-y-4">
                  {attendance.map((record) => (
                    <div
                      key={record._id}
                      className={`rounded-xl p-6 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2 flex-wrap">
                            <span className={`px-2 py-1 text-xs font-medium rounded border ${attendanceStatusColors[record.status] || attendanceStatusColors.present}`}>
                              {record.status.replace("_", " ").charAt(0).toUpperCase() + record.status.replace("_", " ").slice(1)}
                            </span>
                            <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              {new Date(record.date).toLocaleDateString()}
                            </span>
                          </div>
                          <div className={`grid grid-cols-3 gap-4 mt-3 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                            <div>
                              <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Time In</span>
                              <p className="font-medium">{record.actualStart || "-"}</p>
                            </div>
                            <div>
                              <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Time Out</span>
                              <p className="font-medium">{record.actualEnd || "-"}</p>
                            </div>
                            <div>
                              <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Hours</span>
                              <p className="font-medium">{record.hoursWorked?.toFixed(1) || "-"}</p>
                            </div>
                          </div>
                          {record.notes && (
                            <p className={`mt-3 text-sm ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                              {record.notes}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {canManagePersonnel && (
                            <button
                              onClick={() => handleEditAttendance(record)}
                              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                                isDark
                                  ? "bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30"
                                  : "bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200"
                              }`}
                            >
                              Edit
                            </button>
                          )}
                          {canDeleteRecords && (
                            <button
                              onClick={() => handleDeleteAttendance(record._id)}
                              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                                isDark
                                  ? "bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
                                  : "bg-red-50 hover:bg-red-100 text-red-600 border border-red-200"
                              }`}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Attachments Section */}
                      <div className={`mt-4 pt-4 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className={`text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                            Documents (Doctor&apos;s Notes, etc.)
                          </h4>
                          {canManagePersonnel && (
                            <label
                              className={`px-3 py-1.5 text-xs font-medium rounded cursor-pointer transition-colors flex items-center gap-1 ${
                                isUploadingAttendance && uploadingAttendanceId === record._id
                                  ? isDark
                                    ? "bg-slate-600 text-slate-400"
                                    : "bg-gray-200 text-gray-400"
                                  : isDark
                                    ? "bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30"
                                    : "bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200"
                              }`}
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                              {isUploadingAttendance && uploadingAttendanceId === record._id ? "Uploading..." : "Add File"}
                              <input
                                type="file"
                                className="hidden"
                                multiple
                                onChange={(e) => handleAttendanceFileUpload(record._id, e.target.files)}
                                disabled={isUploadingAttendance && uploadingAttendanceId === record._id}
                                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.txt"
                              />
                            </label>
                          )}
                        </div>
                        {record.attachments && record.attachments.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {record.attachments.map((attachment) => (
                              <AttendanceAttachmentItem
                                key={attachment.storageId}
                                attachment={attachment}
                                attendanceId={record._id}
                                canDelete={canDeleteRecords}
                                onDelete={handleDeleteAttendanceAttachment}
                                isDark={isDark}
                              />
                            ))}
                          </div>
                        ) : (
                          <p className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                            No attachments
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`text-center py-12 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                  No attendance records
                </div>
              )}
            </div>
          )}

          {/* Merits Tab */}
          {activeTab === "merits" && (
            <div className="space-y-4">
              {canManagePersonnel && (
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowMeritModal(true)}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      isDark
                        ? "bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30"
                        : "bg-green-50 hover:bg-green-100 text-green-600 border border-green-200"
                    }`}
                  >
                    Add Merit
                  </button>
                </div>
              )}

              {merits && merits.length > 0 ? (
                <div className="space-y-4">
                  {merits.map((merit) => (
                    <div
                      key={merit._id}
                      className={`rounded-xl p-6 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className={`px-2 py-1 text-xs font-medium rounded border ${meritTypeColors[merit.type] || meritTypeColors.commendation}`}>
                              {merit.type.charAt(0).toUpperCase() + merit.type.slice(1)}
                            </span>
                            <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              {new Date(merit.date).toLocaleDateString()}
                            </span>
                          </div>
                          <h3 className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                            {merit.title}
                          </h3>
                          <p className={`mt-2 text-sm ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                            {merit.description}
                          </p>
                        </div>
                        <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                          By: {merit.issuerName}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`text-center py-12 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                  No merits on record
                </div>
              )}
            </div>
          )}

          {/* Equipment Tab */}
          {activeTab === "equipment" && (
            <div className="space-y-6">
              <h3 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                Assigned Equipment
              </h3>

              {equipment && (equipment.scanners.length > 0 || equipment.pickers.length > 0) ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Scanners */}
                  {equipment.scanners.map((scanner) => {
                    const location = locations?.find(l => l._id === scanner.locationId);
                    return (
                      <div
                        key={scanner._id}
                        className={`rounded-lg p-4 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isDark ? "bg-cyan-500/20" : "bg-blue-100"}`}>
                              <svg className={`w-5 h-5 ${isDark ? "text-cyan-400" : "text-blue-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                              </svg>
                            </div>
                            <div>
                              <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                                Scanner #{scanner.number}
                              </p>
                              <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                {scanner.model || "Unknown Model"}
                              </p>
                            </div>
                          </div>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            scanner.status === "assigned"
                              ? isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-700"
                              : isDark ? "bg-slate-600 text-slate-300" : "bg-gray-100 text-gray-600"
                          }`}>
                            {scanner.status}
                          </span>
                        </div>
                        <div className={`mt-3 pt-3 border-t space-y-1 ${isDark ? "border-slate-700" : "border-gray-100"}`}>
                          {location && (
                            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              <span className="font-medium">Location:</span> {location.name}
                            </p>
                          )}
                          {scanner.serialNumber && (
                            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              <span className="font-medium">S/N:</span> {scanner.serialNumber}
                            </p>
                          )}
                          {scanner.assignedAt && (
                            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              <span className="font-medium">Assigned:</span> {new Date(scanner.assignedAt).toLocaleDateString()}
                            </p>
                          )}
                          {scanner.conditionNotes && (
                            <p className={`text-sm ${isDark ? "text-amber-400" : "text-amber-600"}`}>
                              <span className="font-medium">Condition:</span> {scanner.conditionNotes}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Pickers */}
                  {equipment.pickers.map((picker) => {
                    const location = locations?.find(l => l._id === picker.locationId);
                    return (
                      <div
                        key={picker._id}
                        className={`rounded-lg p-4 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isDark ? "bg-purple-500/20" : "bg-purple-100"}`}>
                              <svg className={`w-5 h-5 ${isDark ? "text-purple-400" : "text-purple-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                              </svg>
                            </div>
                            <div>
                              <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                                Picker #{picker.number}
                              </p>
                              <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                {picker.model || "Unknown Model"}
                              </p>
                            </div>
                          </div>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            picker.status === "assigned"
                              ? isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-700"
                              : isDark ? "bg-slate-600 text-slate-300" : "bg-gray-100 text-gray-600"
                          }`}>
                            {picker.status}
                          </span>
                        </div>
                        <div className={`mt-3 pt-3 border-t space-y-1 ${isDark ? "border-slate-700" : "border-gray-100"}`}>
                          {location && (
                            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              <span className="font-medium">Location:</span> {location.name}
                            </p>
                          )}
                          {picker.serialNumber && (
                            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              <span className="font-medium">S/N:</span> {picker.serialNumber}
                            </p>
                          )}
                          {picker.assignedAt && (
                            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              <span className="font-medium">Assigned:</span> {new Date(picker.assignedAt).toLocaleDateString()}
                            </p>
                          )}
                          {picker.conditionNotes && (
                            <p className={`text-sm ${isDark ? "text-amber-400" : "text-amber-600"}`}>
                              <span className="font-medium">Condition:</span> {picker.conditionNotes}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className={`text-center py-12 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                  No equipment assigned
                </div>
              )}

              {/* Signed Agreements Section */}
              {equipmentAgreements && equipmentAgreements.length > 0 && (
                <div className="mt-8">
                  <h3 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                    Signed Equipment Agreements
                  </h3>
                  <div className="space-y-4">
                    {equipmentAgreements.map((agreement) => (
                      <div
                        key={agreement._id}
                        className={`rounded-lg p-4 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                              agreement.revokedAt
                                ? isDark ? "bg-slate-600" : "bg-gray-200"
                                : isDark ? "bg-green-500/20" : "bg-green-100"
                            }`}>
                              <svg className={`w-5 h-5 ${
                                agreement.revokedAt
                                  ? isDark ? "text-slate-400" : "text-gray-500"
                                  : isDark ? "text-green-400" : "text-green-600"
                              }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </div>
                            <div>
                              <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                                {agreement.equipmentType === "scanner" ? "Scanner" : "Picker"} #{agreement.equipmentNumber}
                              </p>
                              <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                {agreement.serialNumber ? `S/N: ${agreement.serialNumber}` : "No serial number"}
                              </p>
                            </div>
                          </div>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            agreement.revokedAt
                              ? isDark ? "bg-slate-600 text-slate-300" : "bg-gray-100 text-gray-600"
                              : isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-700"
                          }`}>
                            {agreement.revokedAt ? "Returned" : "Active"}
                          </span>
                        </div>

                        <div className={`space-y-2 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          <div className="flex justify-between">
                            <span>Equipment Value:</span>
                            <span className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                              ${agreement.equipmentValue.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Signed:</span>
                            <span className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                              {new Date(agreement.signedAt).toLocaleDateString()} at {new Date(agreement.signedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Witnessed by:</span>
                            <span className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                              {agreement.witnessedByName}
                            </span>
                          </div>
                          {agreement.revokedAt && (
                            <div className="flex justify-between">
                              <span>Returned:</span>
                              <span className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                                {new Date(agreement.revokedAt).toLocaleDateString()}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Signature Preview and View Button */}
                        <div className={`mt-3 pt-3 border-t flex items-end justify-between ${isDark ? "border-slate-700" : "border-gray-100"}`}>
                          <div>
                            <p className={`text-xs mb-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Signature:</p>
                            <div className={`inline-block rounded border p-2 ${isDark ? "bg-white border-slate-600" : "bg-white border-gray-200"}`}>
                              <img
                                src={agreement.signatureData}
                                alt="Employee signature"
                                className="h-12 max-w-48 object-contain"
                              />
                            </div>
                          </div>
                          <button
                            onClick={() => setViewingAgreement({
                              text: agreement.agreementText,
                              signatureData: agreement.signatureData,
                              signedAt: agreement.signedAt,
                              witnessedByName: agreement.witnessedByName,
                            })}
                            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${isDark ? "bg-slate-700 text-slate-300 hover:bg-slate-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                          >
                            View Full Agreement
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Safety Tab */}
          {activeTab === "safety" && (
            <div className="space-y-6">
              <h3 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                Safety Checklist History
              </h3>

              {!safetyCompletions ? (
                <div className={`text-center py-12 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Loading...
                </div>
              ) : safetyCompletions.length === 0 ? (
                <div className={`text-center py-12 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                  No safety checklists completed yet
                </div>
              ) : (
                <div className="space-y-4">
                  {safetyCompletions.map((completion) => (
                    <div
                      key={completion._id}
                      className={`rounded-lg p-4 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            completion.allPassed
                              ? isDark ? "bg-green-500/20" : "bg-green-100"
                              : isDark ? "bg-red-500/20" : "bg-red-100"
                          }`}>
                            {completion.allPassed ? (
                              <svg className={`w-5 h-5 ${isDark ? "text-green-400" : "text-green-600"}`} fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            ) : (
                              <svg className={`w-5 h-5 ${isDark ? "text-red-400" : "text-red-600"}`} fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                            )}
                          </div>
                          <div>
                            <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                              Picker #{completion.equipmentNumber}
                            </p>
                            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              {new Date(completion.completedAt).toLocaleDateString()} at {new Date(completion.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          completion.allPassed
                            ? isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-700"
                            : isDark ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-700"
                        }`}>
                          {completion.allPassed ? "All Passed" : "Issues Found"}
                        </span>
                      </div>

                      <div className={`space-y-2 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        <div className="flex justify-between">
                          <span>Total Time:</span>
                          <span className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                            {Math.floor(completion.totalTimeSpent / 60)}m {completion.totalTimeSpent % 60}s
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Items Checked:</span>
                          <span className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                            {completion.responses.filter((r: { passed: boolean }) => r.passed).length}/{completion.responses.length} passed
                          </span>
                        </div>
                      </div>

                      {/* Show issues if any */}
                      {completion.issues && completion.issues.length > 0 && (
                        <div className={`mt-3 pt-3 border-t ${isDark ? "border-slate-700" : "border-gray-100"}`}>
                          <p className={`text-xs font-medium mb-2 ${isDark ? "text-red-400" : "text-red-600"}`}>Issues Reported:</p>
                          <div className="space-y-1">
                            {completion.issues.map((issue: { itemId: string; description: string }, idx: number) => (
                              <p key={idx} className={`text-sm ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                                • {issue.description}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Write-Up Modal */}
        {showWriteUpModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className={`w-full max-w-md rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
              <h2 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                Add Write-Up
              </h2>
              <div className="space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Date
                  </label>
                  <input
                    type="date"
                    value={writeUpForm.date}
                    onChange={(e) => setWriteUpForm({ ...writeUpForm, date: e.target.value })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Severity
                  </label>
                  <select
                    value={writeUpForm.severity}
                    onChange={(e) => setWriteUpForm({ ...writeUpForm, severity: e.target.value })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  >
                    <option value="verbal">Verbal Warning</option>
                    <option value="written">Written Warning</option>
                    <option value="final">Final Warning</option>
                    <option value="termination">Termination</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Category
                  </label>
                  <select
                    value={writeUpForm.category}
                    onChange={(e) => setWriteUpForm({ ...writeUpForm, category: e.target.value })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  >
                    <option value="">Select category...</option>
                    <option value="attendance">Attendance</option>
                    <option value="behavior">Behavior</option>
                    <option value="safety">Safety</option>
                    <option value="performance">Performance</option>
                    <option value="policy_violation">Policy Violation</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Description
                  </label>
                  <textarea
                    value={writeUpForm.description}
                    onChange={(e) => setWriteUpForm({ ...writeUpForm, description: e.target.value })}
                    placeholder="Detailed description of the incident"
                    rows={3}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Follow-up Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={writeUpForm.followUpDate}
                    onChange={(e) => setWriteUpForm({ ...writeUpForm, followUpDate: e.target.value })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Attachments (Optional)
                  </label>
                  <div className={`relative border-2 border-dashed rounded-lg p-4 text-center transition-colors ${isDark ? "border-slate-600 hover:border-slate-500" : "border-gray-300 hover:border-gray-400"}`}>
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif"
                      onChange={(e) => {
                        if (e.target.files) {
                          setWriteUpFiles(Array.from(e.target.files));
                        }
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <svg
                      className={`mx-auto h-8 w-8 ${isDark ? "text-slate-500" : "text-gray-400"}`}
                      stroke="currentColor"
                      fill="none"
                      viewBox="0 0 48 48"
                    >
                      <path
                        d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <p className={`mt-1 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Click or drag files to upload
                    </p>
                    <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      PDF, Word, or images
                    </p>
                  </div>
                  {writeUpFiles.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {writeUpFiles.map((file, index) => (
                        <div
                          key={index}
                          className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${isDark ? "bg-slate-700/50" : "bg-gray-100"}`}
                        >
                          <span className={`truncate ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                            {file.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => setWriteUpFiles(writeUpFiles.filter((_, i) => i !== index))}
                            className={`ml-2 p-1 rounded hover:bg-red-500/20 ${isDark ? "text-slate-400 hover:text-red-400" : "text-gray-500 hover:text-red-600"}`}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowWriteUpModal(false);
                    setWriteUpFiles([]);
                  }}
                  disabled={isCreatingWriteUp}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-900"} disabled:opacity-50`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateWriteUp}
                  disabled={isCreatingWriteUp}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-red-500 hover:bg-red-400 text-white" : "bg-red-600 hover:bg-red-700 text-white"} disabled:opacity-50`}
                >
                  {isCreatingWriteUp ? "Creating..." : "Add Write-Up"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Merit Modal */}
        {showMeritModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className={`w-full max-w-md rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
              <h2 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                Add Merit
              </h2>
              <div className="space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Date
                  </label>
                  <input
                    type="date"
                    value={meritForm.date}
                    onChange={(e) => setMeritForm({ ...meritForm, date: e.target.value })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Type
                  </label>
                  <select
                    value={meritForm.type}
                    onChange={(e) => setMeritForm({ ...meritForm, type: e.target.value })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  >
                    <option value="commendation">Commendation</option>
                    <option value="achievement">Achievement</option>
                    <option value="recognition">Recognition</option>
                    <option value="bonus">Bonus</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Title
                  </label>
                  <input
                    type="text"
                    value={meritForm.title}
                    onChange={(e) => setMeritForm({ ...meritForm, title: e.target.value })}
                    placeholder="Merit title"
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Description
                  </label>
                  <textarea
                    value={meritForm.description}
                    onChange={(e) => setMeritForm({ ...meritForm, description: e.target.value })}
                    placeholder="Describe the achievement or recognition"
                    rows={3}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none`}
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowMeritModal(false)}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-900"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateMerit}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-green-500 hover:bg-green-400 text-white" : "bg-green-600 hover:bg-green-700 text-white"}`}
                >
                  Add Merit
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Attendance Modal */}
        {showAttendanceModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className={`w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
              <h2 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                {editingAttendanceId ? "Edit Attendance Record" : "Record Attendance"}
              </h2>
              <div className="space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Date
                  </label>
                  <input
                    type="date"
                    value={attendanceForm.date}
                    onChange={(e) => setAttendanceForm({ ...attendanceForm, date: e.target.value })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Status
                  </label>
                  <select
                    value={attendanceForm.status}
                    onChange={(e) => setAttendanceForm({ ...attendanceForm, status: e.target.value })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  >
                    <option value="present">Present</option>
                    <option value="absent">Absent</option>
                    <option value="late">Late</option>
                    <option value="excused">Excused</option>
                    <option value="no_call_no_show">No Call No Show</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Time In
                    </label>
                    <input
                      type="time"
                      value={attendanceForm.actualStart}
                      onChange={(e) => setAttendanceForm({ ...attendanceForm, actualStart: e.target.value })}
                      className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Time Out
                    </label>
                    <input
                      type="time"
                      value={attendanceForm.actualEnd}
                      onChange={(e) => setAttendanceForm({ ...attendanceForm, actualEnd: e.target.value })}
                      className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                    />
                  </div>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Hours Worked
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={attendanceForm.hoursWorked}
                    onChange={(e) => setAttendanceForm({ ...attendanceForm, hoursWorked: e.target.value })}
                    placeholder="e.g., 8.0"
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Notes (Optional)
                  </label>
                  <textarea
                    value={attendanceForm.notes}
                    onChange={(e) => setAttendanceForm({ ...attendanceForm, notes: e.target.value })}
                    placeholder="Reason for absence, call-in details, etc."
                    rows={3}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none`}
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowAttendanceModal(false);
                    setEditingAttendanceId(null);
                    setAttendanceForm({
                      date: new Date().toISOString().split("T")[0],
                      status: "absent",
                      notes: "",
                      actualStart: "",
                      actualEnd: "",
                      hoursWorked: "",
                    });
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-900"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddAttendance}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-cyan-500 hover:bg-cyan-400 text-white" : "bg-blue-600 hover:bg-blue-700 text-white"}`}
                >
                  {editingAttendanceId ? "Save Changes" : "Save Record"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Personnel Modal */}
        {showEditPersonnelModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className={`w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
              <h2 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                Edit Personnel Information
              </h2>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      First Name
                    </label>
                    <input
                      type="text"
                      value={editPersonnelForm.firstName}
                      onChange={(e) => setEditPersonnelForm({ ...editPersonnelForm, firstName: e.target.value })}
                      className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      Last Name
                    </label>
                    <input
                      type="text"
                      value={editPersonnelForm.lastName}
                      onChange={(e) => setEditPersonnelForm({ ...editPersonnelForm, lastName: e.target.value })}
                      className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                    />
                  </div>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Email
                  </label>
                  <input
                    type="email"
                    value={editPersonnelForm.email}
                    onChange={(e) => setEditPersonnelForm({ ...editPersonnelForm, email: e.target.value })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={editPersonnelForm.phone}
                    onChange={(e) => setEditPersonnelForm({ ...editPersonnelForm, phone: e.target.value })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Position
                  </label>
                  <input
                    type="text"
                    value={editPersonnelForm.position}
                    onChange={(e) => setEditPersonnelForm({ ...editPersonnelForm, position: e.target.value })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Department
                  </label>
                  <select
                    value={editPersonnelForm.department}
                    onChange={(e) => setEditPersonnelForm({ ...editPersonnelForm, department: e.target.value })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  >
                    <option value="Executive">Executive</option>
                    <option value="IT">IT</option>
                    <option value="Warehouse">Warehouse</option>
                    <option value="Shipping">Shipping</option>
                    <option value="Receiving">Receiving</option>
                    <option value="Inventory">Inventory</option>
                    <option value="Purchases">Purchases</option>
                    <option value="Office">Office</option>
                    <option value="Sales">Sales</option>
                    <option value="Ecommerce">Ecommerce</option>
                    <option value="Retail">Retail</option>
                    <option value="Management">Management</option>
                    <option value="Administration">Administration</option>
                    <option value="Delivery">Delivery</option>
                    <option value="Janitorial">Janitorial</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Location / Company
                  </label>
                  <select
                    value={editPersonnelForm.locationId}
                    onChange={(e) => setEditPersonnelForm({ ...editPersonnelForm, locationId: e.target.value })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  >
                    <option value="">Select Location</option>
                    {locations?.map((location) => (
                      <option key={location._id} value={location._id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                  <p className={`text-xs mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Used for payroll separation by company
                  </p>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Hourly Rate ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editPersonnelForm.hourlyRate}
                    onChange={(e) => setEditPersonnelForm({ ...editPersonnelForm, hourlyRate: parseFloat(e.target.value) || 0 })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Notes
                  </label>
                  <textarea
                    value={editPersonnelForm.notes}
                    onChange={(e) => setEditPersonnelForm({ ...editPersonnelForm, notes: e.target.value })}
                    placeholder="Additional notes"
                    rows={3}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none`}
                  />
                </div>
                {/* Start Date */}
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={editPersonnelForm.hireDate}
                    onChange={(e) => setEditPersonnelForm({ ...editPersonnelForm, hireDate: e.target.value })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  />
                  <p className={`text-xs mt-1 ${isDark ? "text-amber-400/70" : "text-amber-600"}`}>
                    Note: Changing the start date will affect tenure calculations and milestone tracking.
                  </p>
                </div>

                {/* Emergency Contact Section */}
                <div className={`pt-4 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                  <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`}>
                    Emergency Contact
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        Name
                      </label>
                      <input
                        type="text"
                        value={editPersonnelForm.emergencyContactName}
                        onChange={(e) => setEditPersonnelForm({ ...editPersonnelForm, emergencyContactName: e.target.value })}
                        placeholder="Emergency contact name"
                        className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none`}
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        Phone
                      </label>
                      <input
                        type="tel"
                        value={editPersonnelForm.emergencyContactPhone}
                        onChange={(e) => setEditPersonnelForm({ ...editPersonnelForm, emergencyContactPhone: e.target.value })}
                        placeholder="Emergency contact phone"
                        className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none`}
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        Relationship
                      </label>
                      <input
                        type="text"
                        value={editPersonnelForm.emergencyContactRelationship}
                        onChange={(e) => setEditPersonnelForm({ ...editPersonnelForm, emergencyContactRelationship: e.target.value })}
                        placeholder="e.g., Spouse, Parent, Sibling"
                        className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none`}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowEditPersonnelModal(false)}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-900"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdatePersonnel}
                  disabled={isSavingPersonnel}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-cyan-500 hover:bg-cyan-400 text-white" : "bg-blue-600 hover:bg-blue-700 text-white"} ${isSavingPersonnel ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {isSavingPersonnel ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Termination Modal */}
        {showTerminateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className={`w-full max-w-md rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`p-2 rounded-full ${isDark ? "bg-red-500/20" : "bg-red-100"}`}>
                  <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Terminate Employee
                </h2>
              </div>
              <p className={`text-sm mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                This action will mark {personnel?.firstName} {personnel?.lastName} as terminated.
                They will no longer appear in shift planning and will be moved to the terminated section.
              </p>
              <div className="space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Termination Date *
                  </label>
                  <input
                    type="date"
                    value={terminateForm.terminationDate}
                    onChange={(e) => setTerminateForm({ ...terminateForm, terminationDate: e.target.value })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Reason for Termination *
                  </label>
                  <textarea
                    value={terminateForm.terminationReason}
                    onChange={(e) => setTerminateForm({ ...terminateForm, terminationReason: e.target.value })}
                    placeholder="Enter the reason for termination..."
                    rows={3}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none`}
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowTerminateModal(false);
                    setTerminateForm({
                      terminationDate: new Date().toISOString().split("T")[0],
                      terminationReason: "",
                    });
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-900"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleTerminate}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-red-500 hover:bg-red-400 text-white" : "bg-red-600 hover:bg-red-700 text-white"}`}
                >
                  Confirm Termination
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Rehire Modal */}
        {showRehireModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className={`w-full max-w-md rounded-xl p-6 max-h-[90vh] overflow-y-auto ${isDark ? "bg-slate-800" : "bg-white"}`}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`p-2 rounded-full ${isDark ? "bg-green-500/20" : "bg-green-100"}`}>
                  <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                </div>
                <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Rehire Employee
                </h2>
              </div>
              <p className={`text-sm mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Rehire {personnel?.firstName} {personnel?.lastName} as an active employee.
                This will restore their access and add them back to shift planning.
              </p>
              <div className="space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Rehire Date *
                  </label>
                  <input
                    type="date"
                    value={rehireForm.rehireDate}
                    onChange={(e) => setRehireForm({ ...rehireForm, rehireDate: e.target.value })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Position *
                  </label>
                  <input
                    type="text"
                    value={rehireForm.position}
                    onChange={(e) => setRehireForm({ ...rehireForm, position: e.target.value })}
                    placeholder="e.g., Warehouse Associate"
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Department *
                  </label>
                  <select
                    value={rehireForm.department}
                    onChange={(e) => setRehireForm({ ...rehireForm, department: e.target.value })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  >
                    <option value="">Select Department</option>
                    <option value="Executive">Executive</option>
                    <option value="IT">IT</option>
                    <option value="Warehouse">Warehouse</option>
                    <option value="Shipping">Shipping</option>
                    <option value="Receiving">Receiving</option>
                    <option value="Inventory">Inventory</option>
                    <option value="Purchases">Purchases</option>
                    <option value="Office">Office</option>
                    <option value="Sales">Sales</option>
                    <option value="Ecommerce">Ecommerce</option>
                    <option value="Retail">Retail</option>
                    <option value="Management">Management</option>
                    <option value="Administration">Administration</option>
                    <option value="Delivery">Delivery</option>
                    <option value="Janitorial">Janitorial</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Employment Type *
                  </label>
                  <select
                    value={rehireForm.employeeType}
                    onChange={(e) => setRehireForm({ ...rehireForm, employeeType: e.target.value })}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-gray-50 border-gray-200 text-gray-900"} border focus:outline-none`}
                  >
                    <option value="full_time">Full Time</option>
                    <option value="part_time">Part Time</option>
                    <option value="seasonal">Seasonal</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Hourly Rate
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={rehireForm.hourlyRate}
                    onChange={(e) => setRehireForm({ ...rehireForm, hourlyRate: e.target.value })}
                    placeholder="e.g., 15.50"
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Reason for Rehire
                  </label>
                  <textarea
                    value={rehireForm.rehireReason}
                    onChange={(e) => setRehireForm({ ...rehireForm, rehireReason: e.target.value })}
                    placeholder="Enter the reason for rehiring..."
                    rows={2}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none`}
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowRehireModal(false);
                    setRehireForm({
                      rehireDate: new Date().toISOString().split("T")[0],
                      position: "",
                      department: "",
                      employeeType: "full_time",
                      hourlyRate: "",
                      rehireReason: "",
                    });
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-900"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!rehireForm.position || !rehireForm.department || !user) {
                      alert("Please fill in position and department.");
                      return;
                    }
                    try {
                      await rehirePersonnel({
                        personnelId: personnel!._id,
                        rehireDate: rehireForm.rehireDate,
                        position: rehireForm.position,
                        department: rehireForm.department,
                        employeeType: rehireForm.employeeType,
                        hourlyRate: rehireForm.hourlyRate ? parseFloat(rehireForm.hourlyRate) : undefined,
                        rehireReason: rehireForm.rehireReason || undefined,
                        userId: user._id as Id<"users">,
                      });
                      setShowRehireModal(false);
                      setRehireForm({
                        rehireDate: new Date().toISOString().split("T")[0],
                        position: "",
                        department: "",
                        employeeType: "full_time",
                        hourlyRate: "",
                        rehireReason: "",
                      });
                    } catch (error: unknown) {
                      console.error("Failed to rehire:", error);
                      const errorMessage = error instanceof Error ? error.message : "Unknown error";
                      alert(`Failed to rehire employee: ${errorMessage}`);
                    }
                  }}
                  disabled={!rehireForm.position || !rehireForm.department}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${isDark ? "bg-green-500 hover:bg-green-400 text-white" : "bg-green-600 hover:bg-green-700 text-white"}`}
                >
                  Confirm Rehire
                </button>
              </div>
              <p className={`text-xs mt-4 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                Authorized by: {user?.name} ({user?.email})
              </p>
            </div>
          </div>
        )}

        {/* Tenure Check-In Modal */}
        {showCheckInModal && selectedMilestone && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className={`w-full max-w-md rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`p-2 rounded-full ${isDark ? "bg-blue-500/20" : "bg-blue-100"}`}>
                  <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                </div>
                <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Record Check-In
                </h2>
              </div>
              <p className={`text-sm mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Recording {selectedMilestone.replace("_", " ")} tenure check-in for {personnel?.firstName} {personnel?.lastName}.
                This will be logged with your name and the current date/time.
              </p>
              <div className="space-y-4">
                <div className={`p-3 rounded-lg ${isDark ? "bg-slate-700/50" : "bg-gray-50"}`}>
                  <p className={`text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Completed By
                  </p>
                  <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                    {user?.name || user?.email}
                  </p>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Notes (Optional)
                  </label>
                  <textarea
                    value={checkInNotes}
                    onChange={(e) => setCheckInNotes(e.target.value)}
                    placeholder="Any observations from the check-in conversation..."
                    rows={3}
                    className={`w-full px-4 py-2 rounded-lg ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-500" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400"} border focus:outline-none`}
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowCheckInModal(false);
                    setSelectedMilestone(null);
                    setCheckInNotes("");
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-900"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleRecordCheckIn}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-blue-500 hover:bg-blue-400 text-white" : "bg-blue-600 hover:bg-blue-700 text-white"}`}
                >
                  Record Check-In
                </button>
              </div>
            </div>
          </div>
        )}

        {/* View Agreement Modal */}
        {viewingAgreement && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className={`w-full max-w-2xl max-h-[90vh] rounded-xl overflow-hidden flex flex-col ${isDark ? "bg-slate-800" : "bg-white"}`}>
              <div className={`flex items-center justify-between p-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Equipment Responsibility Agreement
                </h2>
                <button
                  onClick={() => setViewingAgreement(null)}
                  className={`p-1 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"}`}
                >
                  <svg className={`w-5 h-5 ${isDark ? "text-slate-400" : "text-gray-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                <pre className={`whitespace-pre-wrap font-mono text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  {viewingAgreement.text}
                </pre>

                <div className={`mt-6 pt-4 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                        Signed: {new Date(viewingAgreement.signedAt).toLocaleDateString()} at {new Date(viewingAgreement.signedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        Witnessed by: {viewingAgreement.witnessedByName}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className={`text-xs mb-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Employee Signature:</p>
                    <div className={`inline-block rounded border p-3 ${isDark ? "bg-white border-slate-600" : "bg-white border-gray-200"}`}>
                      <img
                        src={viewingAgreement.signatureData}
                        alt="Employee signature"
                        className="h-16 max-w-64 object-contain"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className={`p-4 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <button
                  onClick={() => setViewingAgreement(null)}
                  className={`w-full px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-900"}`}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Temporary Password Modal */}
        {showTempPasswordModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className={`w-full max-w-md rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
              <div className="text-center mb-6">
                <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4 ${isDark ? "bg-green-500/20" : "bg-green-100"}`}>
                  <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className={`text-xl font-bold mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Portal Login Created!
                </h2>
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Give this temporary password to the employee. They will be required to change it on first login.
                </p>
              </div>

              <div className={`p-4 rounded-lg mb-6 ${isDark ? "bg-slate-700" : "bg-gray-100"}`}>
                <p className={`text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Temporary Password
                </p>
                <div className="flex items-center gap-2">
                  <code className={`text-2xl font-mono font-bold flex-1 ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                    {tempPassword}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(tempPassword);
                      alert("Password copied to clipboard!");
                    }}
                    className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-600 text-slate-400" : "hover:bg-gray-200 text-gray-500"}`}
                    title="Copy to clipboard"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className={`p-3 rounded-lg mb-6 border ${isDark ? "bg-amber-500/10 border-amber-500/30" : "bg-amber-50 border-amber-200"}`}>
                <p className={`text-sm ${isDark ? "text-amber-400" : "text-amber-700"}`}>
                  <strong>Important:</strong> This password will not be shown again. Make sure to save it or share it with the employee now.
                </p>
              </div>

              <button
                onClick={() => {
                  setShowTempPasswordModal(false);
                  setTempPassword("");
                }}
                className={`w-full px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-cyan-500 hover:bg-cyan-400 text-white" : "bg-blue-600 hover:bg-blue-700 text-white"}`}
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* Schedule Assignment Modal */}
        {showScheduleModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className={`w-full max-w-lg rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
              <div className="flex items-center justify-between mb-6">
                <h2 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Assign Schedule Template
                </h2>
                <button
                  onClick={() => {
                    setShowScheduleModal(false);
                    setSelectedScheduleTemplateId(null);
                  }}
                  className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <p className={`text-sm mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Select a schedule template to assign to {personnel?.firstName} {personnel?.lastName}.
              </p>

              <div className="space-y-2 max-h-80 overflow-y-auto mb-6">
                {scheduleTemplates?.map((template) => (
                  <button
                    key={template._id}
                    onClick={() => setSelectedScheduleTemplateId(template._id)}
                    className={`w-full p-4 rounded-lg text-left transition-colors border ${
                      selectedScheduleTemplateId === template._id
                        ? isDark
                          ? "bg-blue-500/20 border-blue-500"
                          : "bg-blue-50 border-blue-500"
                        : isDark
                          ? "bg-slate-700/50 border-slate-600 hover:border-slate-500"
                          : "bg-gray-50 border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                          {template.name}
                        </p>
                        <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          {getScheduleDisplay(template)}
                        </p>
                      </div>
                      {selectedScheduleTemplateId === template._id && (
                        <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                        </svg>
                      )}
                    </div>
                  </button>
                ))}
                {(!scheduleTemplates || scheduleTemplates.length === 0) && (
                  <p className={`text-center py-8 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    No schedule templates available. Create one from the Scheduling page.
                  </p>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowScheduleModal(false);
                    setSelectedScheduleTemplateId(null);
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                    isDark
                      ? "bg-slate-700 hover:bg-slate-600 text-white"
                      : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                  }`}
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!selectedScheduleTemplateId || !user) return;
                    try {
                      await updateScheduleAssignment({
                        personnelId: personnel!._id,
                        defaultScheduleTemplateId: selectedScheduleTemplateId,
                        userId: user._id,
                      });
                      setShowScheduleModal(false);
                      setSelectedScheduleTemplateId(null);
                    } catch (error) {
                      console.error("Failed to assign schedule:", error);
                      alert("Failed to assign schedule template");
                    }
                  }}
                  disabled={!selectedScheduleTemplateId}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                    isDark
                      ? "bg-blue-500 hover:bg-blue-400 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      : "bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  }`}
                >
                  Assign Schedule
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Schedule Override Modal */}
        {showOverrideModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className={`w-full max-w-lg rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
              <div className="flex items-center justify-between mb-6">
                <h2 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Add Schedule Override
                </h2>
                <button
                  onClick={() => {
                    setShowOverrideModal(false);
                    setOverrideForm({
                      date: new Date().toISOString().split("T")[0],
                      overrideType: "day_off",
                      startTime: "08:00",
                      endTime: "17:00",
                      reason: "",
                    });
                  }}
                  className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                {/* Date */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Date
                  </label>
                  <input
                    type="date"
                    value={overrideForm.date}
                    onChange={(e) => setOverrideForm({ ...overrideForm, date: e.target.value })}
                    min={new Date().toISOString().split("T")[0]}
                    className={`w-full px-4 py-2 rounded-lg border ${
                      isDark
                        ? "bg-slate-700 border-slate-600 text-white"
                        : "bg-white border-gray-300 text-gray-900"
                    }`}
                  />
                </div>

                {/* Override Type */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Override Type
                  </label>
                  <select
                    value={overrideForm.overrideType}
                    onChange={(e) => setOverrideForm({ ...overrideForm, overrideType: e.target.value as "day_off" | "modified_hours" | "extra_shift" })}
                    className={`w-full px-4 py-2 rounded-lg border ${
                      isDark
                        ? "bg-slate-700 border-slate-600 text-white"
                        : "bg-white border-gray-300 text-gray-900"
                    }`}
                  >
                    <option value="day_off">Day Off</option>
                    <option value="modified_hours">Modified Hours</option>
                    <option value="extra_shift">Extra Shift</option>
                  </select>
                </div>

                {/* Time Fields - only show for modified_hours and extra_shift */}
                {(overrideForm.overrideType === "modified_hours" || overrideForm.overrideType === "extra_shift") && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        Start Time
                      </label>
                      <input
                        type="time"
                        value={overrideForm.startTime}
                        onChange={(e) => setOverrideForm({ ...overrideForm, startTime: e.target.value })}
                        className={`w-full px-4 py-2 rounded-lg border ${
                          isDark
                            ? "bg-slate-700 border-slate-600 text-white"
                            : "bg-white border-gray-300 text-gray-900"
                        }`}
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        End Time
                      </label>
                      <input
                        type="time"
                        value={overrideForm.endTime}
                        onChange={(e) => setOverrideForm({ ...overrideForm, endTime: e.target.value })}
                        className={`w-full px-4 py-2 rounded-lg border ${
                          isDark
                            ? "bg-slate-700 border-slate-600 text-white"
                            : "bg-white border-gray-300 text-gray-900"
                        }`}
                      />
                    </div>
                  </div>
                )}

                {/* Reason */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Reason (optional)
                  </label>
                  <textarea
                    value={overrideForm.reason}
                    onChange={(e) => setOverrideForm({ ...overrideForm, reason: e.target.value })}
                    placeholder="e.g., Doctor's appointment, personal day, covering for another employee..."
                    rows={3}
                    className={`w-full px-4 py-2 rounded-lg border ${
                      isDark
                        ? "bg-slate-700 border-slate-600 text-white placeholder-slate-400"
                        : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"
                    }`}
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowOverrideModal(false);
                    setOverrideForm({
                      date: new Date().toISOString().split("T")[0],
                      overrideType: "day_off",
                      startTime: "08:00",
                      endTime: "17:00",
                      reason: "",
                    });
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                    isDark
                      ? "bg-slate-700 hover:bg-slate-600 text-white"
                      : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                  }`}
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!user || !personnel) return;
                    setIsCreatingOverride(true);
                    try {
                      await createScheduleOverride({
                        personnelId: personnel._id,
                        date: overrideForm.date,
                        overrideType: overrideForm.overrideType,
                        startTime: overrideForm.overrideType !== "day_off" ? overrideForm.startTime : undefined,
                        endTime: overrideForm.overrideType !== "day_off" ? overrideForm.endTime : undefined,
                        reason: overrideForm.reason || undefined,
                        autoApprove: true, // Admin-created overrides are auto-approved
                        userId: user._id,
                      });
                      setShowOverrideModal(false);
                      setOverrideForm({
                        date: new Date().toISOString().split("T")[0],
                        overrideType: "day_off",
                        startTime: "08:00",
                        endTime: "17:00",
                        reason: "",
                      });
                    } catch (error) {
                      console.error("Failed to create override:", error);
                      alert("Failed to create schedule override");
                    } finally {
                      setIsCreatingOverride(false);
                    }
                  }}
                  disabled={isCreatingOverride || !overrideForm.date}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                    isDark
                      ? "bg-purple-500 hover:bg-purple-400 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      : "bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  }`}
                >
                  {isCreatingOverride ? "Creating..." : "Create Override"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function PersonnelDetailPage() {
  return (
    <Protected>
      <PersonnelDetailContent />
    </Protected>
  );
}
