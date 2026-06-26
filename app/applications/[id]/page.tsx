"use client";

import { use, useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Protected from "../../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "@/app/auth-context";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/ui/StatusBadge";
import ScorePill from "@/components/ui/ScorePill";
import RatingScale from "@/components/ui/RatingScale";

const STATUS_OPTIONS = [
  { value: "new", label: "New", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" },
  { value: "reviewed", label: "Reviewed", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  { value: "contacted", label: "Contacted", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  { value: "scheduled", label: "Scheduled", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  { value: "interviewed", label: "Interviewed", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  { value: "hired", label: "Hired", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  { value: "rejected", label: "Rejected", color: "bg-red-500/20 text-red-400 border-red-500/30" },
];

const RECOMMENDED_ACTION_STYLES: Record<string, string> = {
  strong_candidate: "bg-green-500/20 text-green-400 border-green-500/30",
  worth_interviewing: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  review_carefully: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  likely_pass: "bg-red-500/20 text-red-400 border-red-500/30",
};

// Helper to format schedule times for display
function getScheduleDisplay(template: { departments?: { startTime: string; endTime: string }[] }): string {
  if (template.departments && template.departments.length > 0) {
    const dept = template.departments[0];
    const formatTime = (time: string) => {
      const [hours, minutes] = time.split(":");
      const h = parseInt(hours);
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = h % 12 || 12;
      return `${h12}:${minutes} ${ampm}`;
    };
    return `${formatTime(dept.startTime)} - ${formatTime(dept.endTime)}`;
  }
  return "No times set";
}

// Resume Section Component - Shows PDF viewer or text fallback
function ResumeSection({ application }: { application: { resumeFileId?: Id<"_storage">; resumeText?: string; firstName: string; lastName: string } }) {
  const [viewMode, setViewMode] = useState<"pdf" | "text">(application.resumeFileId ? "pdf" : "text");

  // Fetch PDF URL if file exists
  const resumeUrl = useQuery(
    api.applications.getResumeUrl,
    application.resumeFileId ? { fileId: application.resumeFileId } : "skip"
  );

  const hasPdf = !!application.resumeFileId && !!resumeUrl;
  const hasText = !!application.resumeText;

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-white">Submitted Resume</h2>
        <div className="flex items-center gap-2">
          {/* View mode tabs - only show if both PDF and text are available */}
          {hasPdf && hasText && (
            <div className="flex bg-slate-900 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode("pdf")}
                className={`px-3 py-1 rounded-md text-sm transition-colors ${
                  viewMode === "pdf"
                    ? "bg-cyan-600 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                PDF
              </button>
              <button
                onClick={() => setViewMode("text")}
                className={`px-3 py-1 rounded-md text-sm transition-colors ${
                  viewMode === "text"
                    ? "bg-cyan-600 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Text
              </button>
            </div>
          )}
          {/* Download button for PDF */}
          {hasPdf && (
            <a
              href={resumeUrl}
              download={`${application.firstName}_${application.lastName}_Resume.pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </a>
          )}
        </div>
      </div>

      {/* PDF View */}
      {viewMode === "pdf" && hasPdf && (
        <div className="bg-slate-900/50 border border-slate-600 rounded-lg overflow-hidden">
          <iframe
            src={`${resumeUrl}#toolbar=1&navpanes=0`}
            className="w-full h-[600px]"
            title="Resume PDF"
          />
        </div>
      )}

      {/* Text View */}
      {viewMode === "text" && hasText && (
        <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-4 max-h-96 overflow-y-auto">
          <pre className="text-slate-300 text-sm whitespace-pre-wrap font-mono">
            {application.resumeText}
          </pre>
        </div>
      )}

      {/* No PDF available message */}
      {viewMode === "pdf" && !hasPdf && hasText && (
        <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-8 text-center">
          <p className="text-slate-400 mb-2">PDF not available for this application</p>
          <button
            onClick={() => setViewMode("text")}
            className="text-cyan-400 hover:text-cyan-300 text-sm"
          >
            View extracted text instead
          </button>
        </div>
      )}

      {/* Only PDF, no text */}
      {viewMode === "text" && !hasText && hasPdf && (
        <div className="bg-slate-900/50 border border-slate-600 rounded-lg p-8 text-center">
          <p className="text-slate-400 mb-2">Text version not available</p>
          <button
            onClick={() => setViewMode("pdf")}
            className="text-cyan-400 hover:text-cyan-300 text-sm"
          >
            View PDF instead
          </button>
        </div>
      )}
    </div>
  );
}

function ApplicationDetailContent({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const application = useQuery(api.applications.getById, {
    applicationId: id as Id<"applications">,
  });
  const activityTimeline = useQuery(api.applications.getActivityTimeline, {
    applicationId: id as Id<"applications">,
  });
  const updateStatusWithActivity = useMutation(api.applications.updateStatusWithActivity);
  const deleteApplication = useMutation(api.applications.remove);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Interview state
  const [showNewInterview, setShowNewInterview] = useState(false);
  const [interviewerName, setInterviewerName] = useState("");
  const [selectedRound, setSelectedRound] = useState(1);
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  const [expandedRound, setExpandedRound] = useState<number | null>(null);
  const [isEvaluating, setIsEvaluating] = useState<number | null>(null);
  const [answerInputs, setAnswerInputs] = useState<Record<string, string>>({});
  const [prelimEvalForm, setPrelimEvalForm] = useState<Record<number, {
    appearance: number;
    manner: number;
    conversation: number;
    intelligence: number;
    sociability: number;
    overallHealthOpinion: number;
    notes: string;
  }>>({});
  const [isSavingPrelimEval, setIsSavingPrelimEval] = useState<number | null>(null);

  // Interview mutations and actions
  const generateQuestions = useAction(api.aiInterview.generateInterviewQuestions);
  const evaluateInterview = useAction(api.aiInterview.evaluateInterview);
  const startInterviewRound = useMutation(api.applications.startInterviewRound);
  const updateInterviewAnswer = useMutation(api.applications.updateInterviewAnswer);
  const updateInterviewNotes = useMutation(api.applications.updateInterviewNotes);
  const saveInterviewEvaluation = useMutation(api.applications.saveInterviewEvaluation);
  const savePreliminaryEvaluation = useMutation(api.applications.savePreliminaryEvaluation);
  const deleteInterviewRound = useMutation(api.applications.deleteInterviewRound);
  const updateNotes = useMutation(api.applications.updateNotes);
  const scheduleInterview = useMutation(api.applications.scheduleInterview);
  const clearScheduledInterview = useMutation(api.applications.clearScheduledInterview);
  const createPersonnel = useMutation(api.personnel.createFromApplication);
  const addInterviewAttendees = useMutation(api.applications.addInterviewAttendees);
  const removeInterviewAttendee = useMutation(api.applications.removeInterviewAttendee);

  // Get interview attendees - run when there's a scheduled interview date
  const interviewAttendees = useQuery(
    api.applications.getInterviewAttendees,
    application?.scheduledInterviewDate ? { applicationId: id as Id<"applications"> } : "skip"
  );

  // Get all users for attendee selection
  const allUsers = useQuery(api.auth.getAllUsers, {});

  // Check if personnel record already exists for this application
  const existingPersonnel = useQuery(api.personnel.getByApplicationId, {
    applicationId: id as Id<"applications">,
  });

  // Schedule templates for hire modal
  const scheduleTemplates = useQuery(api.shiftTemplates.list, {});

  // Notes state
  const [notesInput, setNotesInput] = useState("");
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  // Scheduling state
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleLocation, setScheduleLocation] = useState("In-person");
  const [isScheduling, setIsScheduling] = useState(false);
  const [showAttendeeDropdown, setShowAttendeeDropdown] = useState(false);
  const [isAddingAttendee, setIsAddingAttendee] = useState(false);
  const attendeePopoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showAttendeeDropdown) return;
    const onDoc = (e: MouseEvent) => {
      if (attendeePopoverRef.current && !attendeePopoverRef.current.contains(e.target as Node))
        setShowAttendeeDropdown(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showAttendeeDropdown]);

  // Hiring state
  const [showHireModal, setShowHireModal] = useState(false);
  const [isHiring, setIsHiring] = useState(false);
  const [hireForm, setHireForm] = useState({
    position: "",
    department: "",
    employeeType: "full_time",
    hireDate: new Date().toISOString().split("T")[0],
    hourlyRate: "",
    scheduleTemplateId: "" as string,
    sendOfferEmail: true, // Send offer email by default
    startTime: "08:00",
    staffingAgency: "",
    tempEligibilityMode: "days" as "days" | "hours",
    tempEligibilityValue: "",
    tempEligibleDateOverride: "",
  });

  // Send Offer state
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [isSendingOffer, setIsSendingOffer] = useState(false);
  const [offerForm, setOfferForm] = useState({
    positionTitle: "",
    department: "",
    compensationType: "hourly" as "hourly" | "salary",
    compensationAmount: "",
    startDate: new Date().toISOString().split("T")[0],
    startTime: "08:00",
  });
  const createAndSendOffer = useMutation(api.offerLetters.createAndSend);

  const handleDelete = async () => {
    if (!application) return;
    setIsDeleting(true);
    try {
      await deleteApplication({ applicationId: application._id });
      router.push("/applications");
    } catch (error) {
      console.error("Failed to delete application:", error);
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleHire = async () => {
    if (!application || !hireForm.position || !hireForm.department || !user) return;
    setIsHiring(true);
    try {
      // Send offer email first if checkbox is checked and applicant has email
      if (hireForm.sendOfferEmail && application.email && hireForm.hourlyRate) {
        try {
          await createAndSendOffer({
            applicationId: application._id,
            positionTitle: hireForm.position,
            department: hireForm.department,
            compensationType: "hourly",
            compensationAmount: parseFloat(hireForm.hourlyRate),
            startDate: hireForm.hireDate,
            startTime: hireForm.startTime || undefined,
            userId: user._id,
          });
        } catch (offerError) {
          console.error("Failed to send offer email:", offerError);
          // Continue with hiring even if email fails
        }
      }

      const personnelId = await createPersonnel({
        applicationId: application._id,
        position: hireForm.position,
        department: hireForm.department,
        employeeType: hireForm.employeeType,
        hireDate: hireForm.hireDate,
        hourlyRate: hireForm.hourlyRate ? parseFloat(hireForm.hourlyRate) : undefined,
        userId: user._id,
        defaultScheduleTemplateId: hireForm.scheduleTemplateId ? hireForm.scheduleTemplateId as Id<"shiftTemplates"> : undefined,
        requestingUserId: user._id,
        ...(hireForm.employeeType === "temp"
          ? {
              staffingAgency: hireForm.staffingAgency || undefined,
              tempEligibilityMode: hireForm.tempEligibilityMode,
              tempEligibilityValue: hireForm.tempEligibilityValue ? Number(hireForm.tempEligibilityValue) : undefined,
              tempEligibleDateOverride: hireForm.tempEligibleDateOverride || undefined,
            }
          : {}),
      });
      setShowHireModal(false);
      // Navigate to the new personnel record
      router.push(`/personnel/${personnelId}`);
    } catch (error) {
      console.error("Failed to hire applicant:", error);
      setIsHiring(false);
    }
  };

  if (!application) {
    return (
      <div className="flex h-screen theme-bg-primary">
        <Sidebar />
        <main className="flex-1 flex flex-col">
          <MobileHeader />
          <div className="flex-1 flex items-center justify-center">
            <div className="text-slate-400">Loading...</div>
          </div>
        </main>
      </div>
    );
  }

  const handleStatusChange = async (newStatus: string) => {
    if (!user) return;
    await updateStatusWithActivity({
      applicationId: application._id,
      newStatus,
      userId: user._id,
    });
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return "text-green-400";
    if (score >= 50) return "text-amber-400";
    return "text-red-400";
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 70) return "bg-green-500/20 border-green-500/30";
    if (score >= 50) return "bg-amber-500/20 border-amber-500/30";
    return "bg-red-500/20 border-red-500/30";
  };

  // Interview handlers
  const handleStartInterview = async () => {
    if (!application || !interviewerName.trim()) return;
    setIsGeneratingQuestions(true);
    try {
      const result = await generateQuestions({
        applicationId: application._id,
        round: selectedRound,
        interviewerName: interviewerName.trim(),
      });

      if (result.questions.length > 0) {
        await startInterviewRound({
          applicationId: application._id,
          round: selectedRound,
          interviewerName: interviewerName.trim(),
          questions: result.questions,
        });
        setShowNewInterview(false);
        setInterviewerName("");
        setExpandedRound(selectedRound);
      }
    } catch (error) {
      console.error("Failed to start interview:", error);
    } finally {
      setIsGeneratingQuestions(false);
    }
  };

  const handleSaveAnswer = async (round: number, questionIndex: number, answer: string) => {
    if (!application) return;
    await updateInterviewAnswer({
      applicationId: application._id,
      round,
      questionIndex,
      answer,
    });
  };

  const handleEvaluateInterview = async (round: number) => {
    if (!application) return;
    setIsEvaluating(round);
    try {
      const result = await evaluateInterview({
        applicationId: application._id,
        round,
      });

      if (!result.error) {
        await saveInterviewEvaluation({
          applicationId: application._id,
          round,
          evaluation: {
            overallScore: result.overallScore,
            strengths: result.strengths,
            concerns: result.concerns,
            recommendation: result.recommendation,
            detailedFeedback: result.detailedFeedback,
          },
        });
      }
    } catch (error) {
      console.error("Failed to evaluate interview:", error);
    } finally {
      setIsEvaluating(null);
    }
  };

  const handleDeleteRound = async (round: number) => {
    if (!application) return;
    if (!confirm(`Delete interview round ${round}? This cannot be undone.`)) return;
    await deleteInterviewRound({ applicationId: application._id, round });
    if (expandedRound === round) setExpandedRound(null);
  };

  const handleSavePreliminaryEval = async (round: number) => {
    if (!application) return;
    const form = prelimEvalForm[round];
    if (!form) return;

    // Validate all scores are set (1-4)
    const scores = [form.appearance, form.manner, form.conversation, form.intelligence, form.sociability, form.overallHealthOpinion];
    if (scores.some(s => !s || s < 1 || s > 4)) {
      alert("Please rate all categories (1-4)");
      return;
    }

    setIsSavingPrelimEval(round);
    try {
      await savePreliminaryEvaluation({
        applicationId: application._id,
        round,
        evaluation: {
          appearance: form.appearance,
          manner: form.manner,
          conversation: form.conversation,
          intelligence: form.intelligence,
          sociability: form.sociability,
          overallHealthOpinion: form.overallHealthOpinion,
          notes: form.notes || undefined,
        },
      });
      // Clear the form after successful save
      setPrelimEvalForm(prev => {
        const updated = { ...prev };
        delete updated[round];
        return updated;
      });
    } catch (error) {
      console.error("Failed to save preliminary evaluation:", error);
    } finally {
      setIsSavingPrelimEval(null);
    }
  };

  const initPrelimEvalForm = (round: number, existing?: {
    appearance: number;
    manner: number;
    conversation: number;
    intelligence: number;
    sociability: number;
    overallHealthOpinion: number;
    notes?: string;
  }) => {
    if (prelimEvalForm[round]) return; // Already initialized
    setPrelimEvalForm(prev => ({
      ...prev,
      [round]: existing ? {
        ...existing,
        notes: existing.notes || "",
      } : {
        appearance: 0,
        manner: 0,
        conversation: 0,
        intelligence: 0,
        sociability: 0,
        overallHealthOpinion: 0,
        notes: "",
      },
    }));
  };

  const getNextRound = () => {
    const existingRounds = application?.interviewRounds?.map((r) => r.round) || [];
    for (let i = 1; i <= 3; i++) {
      if (!existingRounds.includes(i)) return i;
    }
    return null;
  };

  return (
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        {/* Header */}
        <header className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur-sm border-b border-slate-700 px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/applications"
                className="p-2 text-slate-400 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-white">
                  {application.firstName} {application.lastName}
                </h1>
                <p className="text-slate-400 text-sm">
                  Applied for: {application.appliedJobTitle}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Show "View Personnel Record" button if already hired */}
              {existingPersonnel && (
                <button
                  onClick={() => router.push(`/personnel/${existingPersonnel._id}`)}
                  className="px-4 py-2 bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/30 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  View Personnel Record
                </button>
              )}
              {/* Schedule Interview button in header */}
              <button
                onClick={() => setShowScheduleModal(true)}
                className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                  application.scheduledInterviewDate
                    ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30"
                    : "bg-cyan-500 hover:bg-cyan-600 text-white"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {application.scheduledInterviewDate
                  ? `Interview: ${new Date(application.scheduledInterviewDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} @ ${application.scheduledInterviewTime}`
                  : "Schedule Interview"}
              </button>
              {/* Show "Hire" button if not already hired */}
              {!existingPersonnel && application.status !== "rejected" && (
                <button
                  onClick={() => {
                    setHireForm({
                      ...hireForm,
                      position: application.appliedJobTitle,
                    });
                    setShowHireModal(true);
                  }}
                  className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  Hire Applicant
                </button>
              )}
              {/* Send Offer button */}
              {application.email && application.status !== "rejected" && application.status !== "hired" && (
                <button
                  onClick={() => {
                    setOfferForm({
                      ...offerForm,
                      positionTitle: application.appliedJobTitle || "",
                    });
                    setShowOfferModal(true);
                  }}
                  className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Send Offer
                </button>
              )}
              <select
                value={application.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                className={`px-4 py-2 rounded-lg border ${
                  STATUS_OPTIONS.find((s) => s.value === application.status)?.color ||
                  "bg-slate-700"
                } bg-transparent focus:outline-none`}
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status.value} value={status.value} className="bg-slate-800 text-white">
                    {status.label}
                  </option>
                ))}
              </select>
              {(user?.role === "super_admin" || user?.role === "admin") && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md mx-4">
              <h3 className="text-xl font-bold text-white mb-4">Delete Application?</h3>
              <p className="text-slate-300 mb-6">
                Are you sure you want to delete the application from{" "}
                <span className="font-semibold text-white">
                  {application.firstName} {application.lastName}
                </span>
                ? This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                  className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="p-8 space-y-6">
          {/* Contact Info & Quick Stats */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Contact Info */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Contact Information</h2>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-slate-500">Email</p>
                  <a href={`mailto:${application.email}`} className="text-cyan-400 hover:underline">
                    {application.email}
                  </a>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Phone</p>
                  <a href={`tel:${application.phone}`} className="text-white hover:text-cyan-400">
                    {application.phone}
                  </a>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Applied</p>
                  <p className="text-white">
                    {new Date(application.createdAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                </div>
              </div>
            </div>

            {/* Overall Scores */}
            {application.candidateAnalysis && (
              <div className="lg:col-span-2 bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-white mb-4">Candidate Scores</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className={`p-4 rounded-lg border text-center ${getScoreBgColor(application.candidateAnalysis.overallScore)}`}>
                    <p className={`text-3xl font-bold ${getScoreColor(application.candidateAnalysis.overallScore)}`}>
                      {application.candidateAnalysis.overallScore}%
                    </p>
                    <p className="text-sm text-slate-400 mt-1">Overall</p>
                  </div>
                  <div className={`p-4 rounded-lg border text-center ${getScoreBgColor(application.candidateAnalysis.stabilityScore)}`}>
                    <p className={`text-3xl font-bold ${getScoreColor(application.candidateAnalysis.stabilityScore)}`}>
                      {application.candidateAnalysis.stabilityScore}%
                    </p>
                    <p className="text-sm text-slate-400 mt-1">Stability</p>
                  </div>
                  <div className={`p-4 rounded-lg border text-center ${getScoreBgColor(application.candidateAnalysis.experienceScore)}`}>
                    <p className={`text-3xl font-bold ${getScoreColor(application.candidateAnalysis.experienceScore)}`}>
                      {application.candidateAnalysis.experienceScore}%
                    </p>
                    <p className="text-sm text-slate-400 mt-1">Experience</p>
                  </div>
                  <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50 text-center">
                    <p className="text-3xl font-bold text-white">
                      {application.candidateAnalysis.totalYearsExperience.toFixed(1)}
                    </p>
                    <p className="text-sm text-slate-400 mt-1">Years Exp.</p>
                  </div>
                </div>

                {/* Recommended Action */}
                <div className="mt-4">
                  <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border ${
                    RECOMMENDED_ACTION_STYLES[application.candidateAnalysis.recommendedAction] || "bg-slate-700"
                  }`}>
                    <span className="text-sm font-medium">
                      Recommended: {application.candidateAnalysis.recommendedAction.replace(/_/g, " ").toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Cover Message */}
          {application.message && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-3">Cover Message</h2>
              <p className="text-slate-300 whitespace-pre-wrap">{application.message}</p>
            </div>
          )}

          {/* Red & Green Flags */}
          {application.candidateAnalysis && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Red Flags */}
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-red-400 mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z" clipRule="evenodd" />
                  </svg>
                  Red Flags ({application.candidateAnalysis.redFlags.length})
                </h2>
                {application.candidateAnalysis.redFlags.length === 0 ? (
                  <p className="text-slate-500 text-sm">No red flags identified</p>
                ) : (
                  <div className="space-y-3">
                    {application.candidateAnalysis.redFlags.map((flag, i) => (
                      <div key={i} className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-bold text-red-400 uppercase px-2 py-0.5 bg-red-500/20 rounded">
                            {flag.type.replace(/_/g, " ")}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            flag.severity === "high"
                              ? "bg-red-500/30 text-red-300"
                              : flag.severity === "medium"
                                ? "bg-amber-500/30 text-amber-300"
                                : "bg-slate-500/30 text-slate-300"
                          }`}>
                            {flag.severity}
                          </span>
                        </div>
                        <p className="text-sm text-slate-300">{flag.description}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Green Flags */}
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-green-400 mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Green Flags ({application.candidateAnalysis.greenFlags.length})
                </h2>
                {application.candidateAnalysis.greenFlags.length === 0 ? (
                  <p className="text-slate-500 text-sm">No green flags identified</p>
                ) : (
                  <div className="space-y-3">
                    {application.candidateAnalysis.greenFlags.map((flag, i) => (
                      <div key={i} className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                        <span className="text-xs font-bold text-green-400 uppercase px-2 py-0.5 bg-green-500/20 rounded mb-2 inline-block">
                          {flag.type.replace(/_/g, " ")}
                        </span>
                        <p className="text-sm text-slate-300 mt-2">{flag.description}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Employment History */}
          {application.candidateAnalysis && application.candidateAnalysis.employmentHistory.length > 0 && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Employment History</h2>
              <div className="space-y-4">
                {application.candidateAnalysis.employmentHistory.map((job, i) => (
                  <div key={i} className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                    <div>
                      <p className="text-white font-medium">{job.title}</p>
                      <p className="text-slate-400 text-sm">{job.company}</p>
                      {job.startDate && (
                        <p className="text-slate-500 text-xs mt-1">
                          {job.startDate} - {job.endDate || "Present"}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-white font-medium">{job.duration}</p>
                      <p className="text-slate-500 text-xs">{job.durationMonths} months</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 pt-4 border-t border-slate-700">
                <div className="text-center">
                  <p className="text-2xl font-bold text-white">
                    {application.candidateAnalysis.averageTenureMonths.toFixed(0)}
                  </p>
                  <p className="text-sm text-slate-400">Avg. Tenure (months)</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-white">
                    {application.candidateAnalysis.longestTenureMonths}
                  </p>
                  <p className="text-sm text-slate-400">Longest Tenure (months)</p>
                </div>
              </div>
            </div>
          )}

          {/* Interview Rounds */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Interview Rounds
                {application.interviewRounds && application.interviewRounds.length > 0 && (
                  <span className="text-sm bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded">
                    {application.interviewRounds.length}/3 completed
                  </span>
                )}
              </h2>
              {getNextRound() && (
                <button
                  onClick={() => {
                    setSelectedRound(getNextRound()!);
                    setShowNewInterview(true);
                  }}
                  className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Start Round {getNextRound()}
                </button>
              )}
            </div>

            {/* Existing Interview Rounds */}
            {application.interviewRounds && application.interviewRounds.length > 0 ? (
              <div className="space-y-4">
                {application.interviewRounds
                  .sort((a, b) => a.round - b.round)
                  .map((round) => (
                    <Card key={round.round}>
                      {/* Round Header */}
                      <div
                        className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-800/30 transition-colors rounded-t-xl"
                        onClick={() =>
                          setExpandedRound(expandedRound === round.round ? null : round.round)
                        }
                      >
                        <div className="flex items-center gap-4">
                          <span className="ui-badge ui-badge-blue w-8 h-8 flex items-center justify-center text-base font-bold">{round.round}</span>
                          <div>
                            <p className="theme-text-primary font-medium">Round {round.round} · {round.interviewerName}</p>
                            <p className="theme-text-secondary text-sm">{new Date(round.conductedAt).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {round.aiEvaluation && (
                            <span className="ui-badge ui-badge-blue">AI {round.aiEvaluation.overallScore}%</span>
                          )}
                          <svg
                            className={`w-5 h-5 text-slate-400 transition-transform ${
                              expandedRound === round.round ? "rotate-180" : ""
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>

                      {/* Expanded Content */}
                      {expandedRound === round.round && (
                        <div className="border-t border-slate-700 p-4 space-y-4">
                          {/* Preliminary Evaluation (Small Talk Phase) */}
                          <Card tone="amber" padding="sm">
                            <SectionHeader
                              title="Preliminary Evaluation"
                              label="Small talk phase — rate 1–4"
                              actions={round.preliminaryEvaluation ? (
                                <span className="ui-badge ui-badge-green">
                                  Avg {((round.preliminaryEvaluation.appearance + round.preliminaryEvaluation.manner + round.preliminaryEvaluation.conversation + round.preliminaryEvaluation.intelligence + round.preliminaryEvaluation.sociability + round.preliminaryEvaluation.overallHealthOpinion) / 6).toFixed(1)} / 4
                                </span>
                              ) : undefined}
                            />

                            {round.preliminaryEvaluation ? (
                              // Display saved evaluation
                              <div className="space-y-3">
                                <div className="space-y-0 divide-y divide-slate-700/50">
                                  {[
                                    { key: "appearance", label: "Appearance" },
                                    { key: "manner", label: "Manner" },
                                    { key: "conversation", label: "Conversation" },
                                    { key: "intelligence", label: "Intelligence" },
                                    { key: "sociability", label: "Sociability" },
                                    { key: "overallHealthOpinion", label: "Health Opinion" },
                                  ].map(({ key, label }) => (
                                    <div key={key} className="flex items-center justify-between py-2.5">
                                      <span className="theme-text-secondary text-sm">{label}</span>
                                      <RatingScale
                                        name={label}
                                        value={round.preliminaryEvaluation?.[key as keyof typeof round.preliminaryEvaluation] as number ?? null}
                                        readOnly
                                      />
                                    </div>
                                  ))}
                                </div>
                                {round.preliminaryEvaluation.notes && (
                                  <div className="bg-slate-800/50 rounded p-3">
                                    <p className="text-slate-400 text-xs mb-1">Notes</p>
                                    <p className="text-slate-300 text-sm">{round.preliminaryEvaluation.notes}</p>
                                  </div>
                                )}
                                <p className="text-slate-500 text-xs">
                                  Evaluated {new Date(round.preliminaryEvaluation.evaluatedAt).toLocaleString()}
                                </p>
                              </div>
                            ) : (
                              // Evaluation form
                              <div className="space-y-3">
                                <div className="space-y-0 divide-y divide-slate-700/50 mb-3">
                                  {[
                                    { key: "appearance", label: "Appearance" },
                                    { key: "manner", label: "Manner" },
                                    { key: "conversation", label: "Conversation" },
                                    { key: "intelligence", label: "Intelligence" },
                                    { key: "sociability", label: "Sociability" },
                                    { key: "overallHealthOpinion", label: "Health Opinion" },
                                  ].map(({ key, label }) => (
                                    <div key={key} className="flex items-center justify-between py-2.5">
                                      <span className="theme-text-secondary text-sm">{label}</span>
                                      <RatingScale
                                        name={label}
                                        value={(prelimEvalForm[round.round]?.[key as keyof typeof prelimEvalForm[number]] as number) ?? null}
                                        onChange={(v) => {
                                          initPrelimEvalForm(round.round);
                                          setPrelimEvalForm((prev) => ({
                                            ...prev,
                                            [round.round]: {
                                              ...(prev[round.round] || { appearance: 0, manner: 0, conversation: 0, intelligence: 0, sociability: 0, overallHealthOpinion: 0, notes: "" }),
                                              [key]: v,
                                            },
                                          }));
                                        }}
                                      />
                                    </div>
                                  ))}
                                </div>
                                <div>
                                  <label className="block text-slate-400 text-xs mb-1">Notes (optional)</label>
                                  <textarea
                                    placeholder="Any observations from the small talk phase..."
                                    value={prelimEvalForm[round.round]?.notes || ""}
                                    onChange={(e) => {
                                      initPrelimEvalForm(round.round);
                                      setPrelimEvalForm(prev => ({
                                        ...prev,
                                        [round.round]: {
                                          ...(prev[round.round] || {
                                            appearance: 0,
                                            manner: 0,
                                            conversation: 0,
                                            intelligence: 0,
                                            sociability: 0,
                                            overallHealthOpinion: 0,
                                            notes: "",
                                          }),
                                          notes: e.target.value,
                                        },
                                      }));
                                    }}
                                    rows={2}
                                    className="theme-input w-full resize-none text-sm"
                                  />
                                </div>
                                <Button variant="primary" onClick={() => handleSavePreliminaryEval(round.round)} disabled={isSavingPrelimEval === round.round}>{isSavingPrelimEval === round.round ? "Saving..." : "Save Preliminary Evaluation"}</Button>
                              </div>
                            )}
                          </Card>

                          {/* Questions & Answers */}
                          <div className="space-y-4">
                            {round.questions.map((q, qIndex) => (
                              <Card key={qIndex} padding="sm">
                                <div className="flex items-start gap-3 mb-3">
                                  <span className="ui-badge ui-badge-blue flex-shrink-0">{qIndex + 1}</span>
                                  <p className="text-white font-medium">{q.question}</p>
                                  {q.aiGenerated && (
                                    <span className="ui-badge ui-badge-purple flex-shrink-0">AI</span>
                                  )}
                                </div>
                                <div className="ml-9">
                                  {q.answer ? (
                                    <p className="text-slate-300 text-sm whitespace-pre-wrap">{q.answer}</p>
                                  ) : (
                                    <div className="space-y-2">
                                      <textarea
                                        placeholder="Record candidate's answer..."
                                        value={answerInputs[`${round.round}-${qIndex}`] || ""}
                                        onChange={(e) =>
                                          setAnswerInputs((prev) => ({
                                            ...prev,
                                            [`${round.round}-${qIndex}`]: e.target.value,
                                          }))
                                        }
                                        rows={3}
                                        className="theme-input w-full resize-none text-sm"
                                      />
                                      <Button
                                        size="sm"
                                        onClick={() => {
                                          const answer = answerInputs[`${round.round}-${qIndex}`];
                                          if (answer?.trim()) {
                                            handleSaveAnswer(round.round, qIndex, answer.trim());
                                            setAnswerInputs((prev) => {
                                              const newInputs = { ...prev };
                                              delete newInputs[`${round.round}-${qIndex}`];
                                              return newInputs;
                                            });
                                          }
                                        }}
                                        disabled={!answerInputs[`${round.round}-${qIndex}`]?.trim()}
                                      >
                                        Save Answer
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </Card>
                            ))}
                          </div>

                          {/* Interview Notes */}
                          <div className="pt-4 border-t border-slate-700">
                            <label className="block text-sm text-slate-400 mb-2">Interview Notes</label>
                            <textarea
                              placeholder="Add general notes about this interview..."
                              defaultValue={round.interviewNotes || ""}
                              onBlur={(e) => {
                                if (e.target.value !== (round.interviewNotes || "")) {
                                  updateInterviewNotes({
                                    applicationId: application._id,
                                    round: round.round,
                                    notes: e.target.value,
                                  });
                                }
                              }}
                              rows={3}
                              className="theme-input w-full resize-none text-sm"
                            />
                          </div>

                          {/* AI Evaluation */}
                          {round.aiEvaluation ? (
                            <div className="pt-4 border-t border-slate-700 space-y-4">
                              <h4 className="text-white font-medium flex items-center gap-2">
                                <svg className="w-4 h-4 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                                  <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
                                </svg>
                                AI Evaluation
                              </h4>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Strengths */}
                                <Card padding="sm">
                                  <SectionHeader title="" actions={<span className="ui-badge ui-badge-green">Strengths</span>} />
                                  <ul className="space-y-1">
                                    {round.aiEvaluation.strengths.map((s, i) => (
                                      <li key={i} className="text-slate-300 text-sm flex items-start gap-2">
                                        <svg className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                        </svg>
                                        {s}
                                      </li>
                                    ))}
                                  </ul>
                                </Card>

                                {/* Concerns */}
                                <Card padding="sm">
                                  <SectionHeader title="" actions={<span className="ui-badge ui-badge-amber">Concerns</span>} />
                                  <ul className="space-y-1">
                                    {round.aiEvaluation.concerns.map((c, i) => (
                                      <li key={i} className="text-slate-300 text-sm flex items-start gap-2">
                                        <svg className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                        </svg>
                                        {c}
                                      </li>
                                    ))}
                                  </ul>
                                </Card>
                              </div>

                              <Card padding="sm" tone={round.aiEvaluation.recommendation.includes("YES") ? "default" : round.aiEvaluation.recommendation.includes("MAYBE") ? "amber" : "default"}>
                                <span className="font-semibold theme-text-primary">Recommendation: </span>
                                <span className="theme-text-secondary">{round.aiEvaluation.recommendation}</span>
                              </Card>

                              <Card padding="sm">
                                <p className="text-slate-400 font-medium text-sm mb-2">Detailed Feedback</p>
                                <p className="text-slate-300 text-sm whitespace-pre-wrap">{round.aiEvaluation.detailedFeedback}</p>
                              </Card>
                            </div>
                          ) : (
                            <div className="pt-4 border-t border-slate-700">
                              <Button
                                variant="primary"
                                onClick={() => handleEvaluateInterview(round.round)}
                                disabled={
                                  isEvaluating === round.round ||
                                  round.questions.some((q) => !q.answer || q.answer.trim() === "")
                                }
                              >
                                {isEvaluating === round.round ? (
                                  <>
                                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    Evaluating with AI...
                                  </>
                                ) : (
                                  <>
                                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                      <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z" />
                                    </svg>
                                    Generate AI Evaluation
                                  </>
                                )}
                              </Button>
                              {round.questions.some((q) => !q.answer || q.answer.trim() === "") && (
                                <p className="text-amber-400 text-xs text-center mt-2">
                                  Complete all answers before generating evaluation
                                </p>
                              )}
                            </div>
                          )}

                          {/* Delete Round Button */}
                          <div className="pt-4 border-t border-slate-700 flex justify-end">
                            <Button variant="danger" size="sm" onClick={() => handleDeleteRound(round.round)}>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              Delete Round
                            </Button>
                          </div>
                        </div>
                      )}
                    </Card>
                  ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <svg className="w-12 h-12 text-slate-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="text-slate-400">No interviews conducted yet</p>
                <p className="text-slate-500 text-sm mt-1">Start the first interview round to track the hiring process</p>
              </div>
            )}
          </div>

          {/* New Interview Modal */}
          {showNewInterview && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <Card className="max-w-md mx-4 w-full">
                <h3 className="text-xl font-bold text-white mb-4">Start Interview Round {selectedRound}</h3>
                <p className="text-slate-400 text-sm mb-6">
                  AI will generate personalized interview questions based on the candidate&apos;s profile and the position they applied for.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-2">Interviewer Name</label>
                    <input
                      type="text"
                      placeholder="Enter your name"
                      value={interviewerName}
                      onChange={(e) => setInterviewerName(e.target.value)}
                      className="theme-input w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-slate-400 mb-2">Interview Round</label>
                    <select
                      value={selectedRound}
                      onChange={(e) => setSelectedRound(Number(e.target.value))}
                      className="theme-input w-full"
                    >
                      {[1, 2, 3]
                        .filter((r) => !application.interviewRounds?.some((ir) => ir.round === r))
                        .map((r) => (
                          <option key={r} value={r}>
                            Round {r} - {r === 1 ? "Initial Screening" : r === 2 ? "Skills Assessment" : "Final Interview"}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-6">
                  <Button variant="ghost" onClick={() => { setShowNewInterview(false); setInterviewerName(""); }} disabled={isGeneratingQuestions}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={handleStartInterview} disabled={!interviewerName.trim() || isGeneratingQuestions}>
                    {isGeneratingQuestions ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Generating Questions...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z" />
                        </svg>
                        Generate Questions
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            </div>
          )}

          {/* AI Job Match Scores */}
          {application.aiAnalysis && application.aiAnalysis.allScores.length > 0 && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">AI Job Match Analysis</h2>
              <div className="space-y-3">
                {application.aiAnalysis.allScores
                  .sort((a, b) => b.score - a.score)
                  .map((score, i) => (
                    <div
                      key={i}
                      className={`p-4 rounded-lg border ${
                        score.jobTitle === application.appliedJobTitle
                          ? "bg-cyan-500/10 border-cyan-500/30"
                          : "bg-slate-900/50 border-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-white font-medium">{score.jobTitle}</p>
                            {score.jobTitle === application.appliedJobTitle && (
                              <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded">
                                Applied
                              </span>
                            )}
                          </div>
                          {score.matchedKeywords.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {score.matchedKeywords.map((keyword, j) => (
                                <span
                                  key={j}
                                  className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded"
                                >
                                  {keyword}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className={`text-2xl font-bold ${getScoreColor(score.score)}`}>
                          {score.score}%
                        </div>
                      </div>
                      {score.reasoning && (
                        <p className="text-sm text-slate-400 mt-2">{score.reasoning}</p>
                      )}
                    </div>
                  ))}
              </div>
              {application.aiAnalysis.extractedSkills.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-700">
                  <p className="text-sm text-slate-400 mb-2">Extracted Skills</p>
                  <div className="flex flex-wrap gap-2">
                    {application.aiAnalysis.extractedSkills.map((skill, i) => (
                      <span
                        key={i}
                        className="px-3 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-full text-sm"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Hiring Team Notes */}
          {application.candidateAnalysis && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-cyan-400 mb-3">Hiring Team Notes</h2>
              <p className="text-slate-300">{application.candidateAnalysis.hiringTeamNotes}</p>
            </div>
          )}

          {/* Activity Timeline */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Activity Timeline
            </h2>
            {activityTimeline && activityTimeline.length > 0 ? (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-700" />

                <div className="space-y-4">
                  {activityTimeline.map((activity, index) => {
                    // Get icon and color based on activity type
                    const getActivityStyle = (type: string) => {
                      switch (type) {
                        case "application_received":
                          return { icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z", color: "bg-cyan-500", borderColor: "border-cyan-500/30" };
                        case "status_change":
                          return { icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15", color: "bg-purple-500", borderColor: "border-purple-500/30" };
                        case "interview_scheduled":
                          return { icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z", color: "bg-orange-500", borderColor: "border-orange-500/30" };
                        case "interview_completed":
                          return { icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", color: "bg-blue-500", borderColor: "border-blue-500/30" };
                        case "note_added":
                          return { icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z", color: "bg-amber-500", borderColor: "border-amber-500/30" };
                        case "evaluation_added":
                          return { icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z", color: "bg-indigo-500", borderColor: "border-indigo-500/30" };
                        case "hired":
                          return { icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z", color: "bg-green-500", borderColor: "border-green-500/30" };
                        case "rejected":
                          return { icon: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z", color: "bg-red-500", borderColor: "border-red-500/30" };
                        default:
                          return { icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z", color: "bg-slate-500", borderColor: "border-slate-500/30" };
                      }
                    };

                    const style = getActivityStyle(activity.type);
                    const isFirst = index === 0;

                    return (
                      <div key={activity._id} className="relative flex items-start gap-4 pl-8">
                        {/* Timeline dot */}
                        <div className={`absolute left-0 w-8 h-8 rounded-full ${style.color} flex items-center justify-center z-10 ${isFirst ? "ring-2 ring-white/20" : ""}`}>
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={style.icon} />
                          </svg>
                        </div>

                        {/* Content */}
                        <div className={`flex-1 bg-slate-900/50 border ${style.borderColor} rounded-lg p-4`}>
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <p className="text-white font-medium">{activity.description}</p>
                              {activity.previousValue && activity.newValue && (
                                <p className="text-slate-400 text-sm mt-1">
                                  <span className="text-slate-500">{activity.previousValue}</span>
                                  <span className="mx-2">→</span>
                                  <span className="text-slate-300">{activity.newValue}</span>
                                </p>
                              )}
                              {activity.metadata && typeof activity.metadata === "object" && (
                                <div className="mt-2 space-y-1">
                                  {(activity.metadata as { score?: number; recommendation?: string; round?: number }).score !== undefined && (
                                    <p className="text-sm">
                                      <span className="text-slate-400">Score: </span>
                                      <span className={getScoreColor((activity.metadata as { score: number }).score)}>
                                        {(activity.metadata as { score: number }).score}%
                                      </span>
                                    </p>
                                  )}
                                  {(activity.metadata as { recommendation?: string }).recommendation && (
                                    <p className="text-slate-300 text-sm">
                                      {(activity.metadata as { recommendation: string }).recommendation}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-slate-400 text-sm">
                                {new Date(activity.createdAt).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </p>
                              <p className="text-slate-500 text-xs">
                                {new Date(activity.createdAt).toLocaleTimeString("en-US", {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </p>
                            </div>
                          </div>
                          <p className="text-slate-500 text-xs mt-2">
                            By: {activity.performedByName}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <svg className="w-12 h-12 text-slate-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-slate-400">No activity recorded yet</p>
                <p className="text-slate-500 text-sm mt-1">Activities will appear here as you interact with this application</p>
              </div>
            )}
          </div>

          {/* Scheduled Interview Banner */}
          {application.scheduledInterviewDate && (
            <Card tone="amber">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-orange-500/20 border border-orange-500/30 flex items-center justify-center">
                    <svg className="w-6 h-6 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-orange-400">Interview Scheduled</h2>
                    <p className="text-white">
                      {new Date(application.scheduledInterviewDate + "T00:00:00").toLocaleDateString("en-US", {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                      {application.scheduledInterviewTime && (
                        <span className="text-slate-300"> at {application.scheduledInterviewTime}</span>
                      )}
                    </p>
                    {application.scheduledInterviewLocation && (
                      <p className="text-slate-400 text-sm mt-1">
                        Location: {application.scheduledInterviewLocation}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setScheduleDate(application.scheduledInterviewDate || "");
                      setScheduleTime(application.scheduledInterviewTime || "");
                      setScheduleLocation(application.scheduledInterviewLocation || "In-person");
                      setShowScheduleModal(true);
                    }}
                    className="px-3 py-2 bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-lg hover:bg-orange-500/30 transition-colors text-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm("Clear the scheduled interview?")) {
                        await clearScheduledInterview({
                          applicationId: application._id,
                          userId: user?._id as Id<"users">,
                        });
                      }
                    }}
                    className="px-3 py-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors text-sm"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Attendees Section */}
              <div className="mt-4 pt-4 border-t border-orange-500/20">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-orange-300">Interview Attendees</h3>
                  <div ref={attendeePopoverRef} className="relative">
                    <Button variant="ghost" size="sm" onClick={() => setShowAttendeeDropdown(o => !o)}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      Add Attendee
                    </Button>
                    {showAttendeeDropdown && (
                      <div className="absolute right-0 mt-2 w-64 max-w-[calc(100vw-2rem)] theme-card p-2 z-20 shadow-lg rounded-lg max-h-60 overflow-y-auto">
                        {allUsers?.filter(u =>
                          !interviewAttendees?.some(a => a?._id === u._id)
                        ).map(u => (
                          <button
                            key={u._id}
                            onClick={async () => {
                              setIsAddingAttendee(true);
                              try {
                                await addInterviewAttendees({
                                  applicationId: application._id,
                                  attendeeIds: [u._id],
                                  userId: user?._id,
                                });
                                setShowAttendeeDropdown(false);
                              } catch (error) {
                                console.error("Failed to add attendee:", error);
                                alert("Failed to add attendee: " + (error as Error).message);
                              } finally {
                                setIsAddingAttendee(false);
                              }
                            }}
                            disabled={isAddingAttendee}
                            className="w-full px-4 py-2 text-left text-white hover:bg-slate-700 transition-colors text-sm disabled:opacity-50"
                          >
                            {u.name}
                            <span className="text-slate-400 text-xs ml-2">({u.email})</span>
                          </button>
                        ))}
                        {allUsers?.filter(u => !interviewAttendees?.some(a => a?._id === u._id)).length === 0 && (
                          <div className="px-4 py-3 text-slate-400 text-sm text-center">
                            All users already added
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {interviewAttendees && interviewAttendees.length > 0 ? (
                    interviewAttendees.map(attendee => attendee && (
                      <span
                        key={attendee._id}
                        className="ui-badge ui-badge-gray flex items-center gap-2"
                      >
                        <div className="w-6 h-6 rounded-full bg-orange-500/30 flex items-center justify-center text-xs text-orange-300 font-medium">
                          {attendee.name.split(" ").map(n => n[0]).join("")}
                        </div>
                        <span className="text-white text-sm">{attendee.name}</span>
                        <button
                          onClick={async () => {
                            try {
                              await removeInterviewAttendee({
                                applicationId: application._id,
                                attendeeId: attendee._id,
                              });
                            } catch (error) {
                              console.error("Failed to remove attendee:", error);
                            }
                          }}
                          className="text-slate-400 hover:text-red-400 transition-colors ml-1"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-400 text-sm">No attendees assigned yet</span>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* Schedule Interview Modal */}
          {showScheduleModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <Card className="max-w-md mx-4 w-full">
                <h3 className="text-xl font-bold text-white mb-4">
                  {application.scheduledInterviewDate ? "Edit Interview Schedule" : "Schedule Interview"}
                </h3>
                <p className="text-slate-400 text-sm mb-6">
                  Set the date, time, and location for the interview with {application.firstName}.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-2">Date *</label>
                    <input
                      type="date"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      className="theme-input w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-slate-400 mb-2">Time *</label>
                    <input
                      type="time"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="theme-input w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-slate-400 mb-2">Location</label>
                    <select
                      value={scheduleLocation}
                      onChange={(e) => setScheduleLocation(e.target.value)}
                      className="theme-input w-full"
                    >
                      <option value="In-person">In-person</option>
                      <option value="Phone">Phone</option>
                      <option value="Video">Video Call</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-6">
                  <Button variant="ghost" onClick={() => { setShowScheduleModal(false); setScheduleDate(""); setScheduleTime(""); setScheduleLocation("In-person"); }} disabled={isScheduling}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={async () => {
                      if (!scheduleDate || !scheduleTime) return;
                      setIsScheduling(true);
                      try {
                        // Calculate timestamp in user's local timezone
                        const startTimestamp = new Date(`${scheduleDate}T${scheduleTime}`).getTime();
                        await scheduleInterview({
                          applicationId: application._id,
                          date: scheduleDate,
                          time: scheduleTime,
                          location: scheduleLocation,
                          userId: user?._id as Id<"users">,
                          startTimestamp,
                        });
                        setShowScheduleModal(false);
                        setScheduleDate("");
                        setScheduleTime("");
                        setScheduleLocation("In-person");
                      } catch (error) {
                        console.error("Failed to schedule interview:", error);
                      } finally {
                        setIsScheduling(false);
                      }
                    }}
                    disabled={!scheduleDate || !scheduleTime || isScheduling}
                  >
                    {isScheduling ? "Scheduling..." : "Schedule Interview"}
                  </Button>
                </div>
              </Card>
            </div>
          )}

          {/* Hire Applicant Modal */}
          {showHireModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <Card className="max-w-lg mx-4 w-full">
                <h3 className="text-xl font-bold text-white mb-2">Hire Applicant</h3>
                <p className="text-slate-400 text-sm mb-6">
                  Create a personnel record for {application.firstName} {application.lastName}. This will also update their application status to &quot;Hired&quot;.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-2">Position *</label>
                    <input
                      type="text"
                      placeholder="e.g., Warehouse Associate"
                      value={hireForm.position}
                      onChange={(e) => setHireForm({ ...hireForm, position: e.target.value })}
                      className="theme-input w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-slate-400 mb-2">Department *</label>
                    <input
                      type="text"
                      placeholder="e.g., Warehouse, Sales, Operations"
                      value={hireForm.department}
                      onChange={(e) => setHireForm({ ...hireForm, department: e.target.value })}
                      className="theme-input w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-slate-400 mb-2">Employee Type *</label>
                    <select
                      value={hireForm.employeeType}
                      onChange={(e) => setHireForm({ ...hireForm, employeeType: e.target.value })}
                      className="theme-input w-full"
                    >
                      <option value="full_time">Full Time</option>
                      <option value="part_time">Part Time</option>
                      <option value="contract">Contract</option>
                      <option value="seasonal">Seasonal</option>
                      <option value="temp">Temp (staffing agency)</option>
                    </select>
                  </div>

                  {hireForm.employeeType === "temp" && (
                    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                      <div>
                        <label className="block text-sm font-medium mb-1 text-slate-700">Staffing Agency</label>
                        <input
                          type="text"
                          value={hireForm.staffingAgency}
                          onChange={(e) => setHireForm({ ...hireForm, staffingAgency: e.target.value })}
                          className="theme-input w-full"
                          placeholder="e.g. Express Employment"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium mb-1 text-slate-700">Eligible after</label>
                          <input
                            type="number"
                            min={1}
                            value={hireForm.tempEligibilityValue}
                            onChange={(e) => setHireForm({ ...hireForm, tempEligibilityValue: e.target.value })}
                            className="theme-input w-full"
                            placeholder="e.g. 90"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1 text-slate-700">Basis</label>
                          <select
                            value={hireForm.tempEligibilityMode}
                            onChange={(e) => setHireForm({ ...hireForm, tempEligibilityMode: e.target.value as "days" | "hours" })}
                            className="theme-input w-full"
                          >
                            <option value="days">Days</option>
                            <option value="hours">Hours (at 40/wk)</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1 text-slate-700">Override eligible date (optional)</label>
                        <input
                          type="date"
                          value={hireForm.tempEligibleDateOverride}
                          onChange={(e) => setHireForm({ ...hireForm, tempEligibleDateOverride: e.target.value })}
                          className="theme-input w-full"
                        />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm text-slate-400 mb-2">Hire Date *</label>
                      <input
                        type="date"
                        value={hireForm.hireDate}
                        onChange={(e) => setHireForm({ ...hireForm, hireDate: e.target.value })}
                        className="theme-input w-full"
                      />
                    </div>

                    <div>
                      <label className="block text-sm text-slate-400 mb-2">Start Time</label>
                      <input
                        type="time"
                        value={hireForm.startTime}
                        onChange={(e) => setHireForm({ ...hireForm, startTime: e.target.value })}
                        className="theme-input w-full"
                      />
                    </div>

                    <div>
                      <label className="block text-sm text-slate-400 mb-2">Hourly Rate</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="e.g., 18.00"
                        value={hireForm.hourlyRate}
                        onChange={(e) => setHireForm({ ...hireForm, hourlyRate: e.target.value })}
                        className="theme-input w-full"
                      />
                    </div>
                  </div>

                  {/* Send Offer Email Checkbox */}
                  {application.email && (
                    <div className="flex items-center gap-3 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                      <input
                        type="checkbox"
                        id="sendOfferEmail"
                        checked={hireForm.sendOfferEmail}
                        onChange={(e) => setHireForm({ ...hireForm, sendOfferEmail: e.target.checked })}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-purple-500 focus:ring-purple-500"
                      />
                      <label htmlFor="sendOfferEmail" className="text-sm text-slate-300">
                        Send offer email to <span className="text-purple-400">{application.email}</span>
                        {!hireForm.hourlyRate && <span className="text-amber-400 ml-2">(requires hourly rate)</span>}
                      </label>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm text-slate-400 mb-2">Schedule Template</label>
                    <select
                      value={hireForm.scheduleTemplateId}
                      onChange={(e) => setHireForm({ ...hireForm, scheduleTemplateId: e.target.value })}
                      className="theme-input w-full"
                    >
                      <option value="">No schedule assigned</option>
                      {scheduleTemplates?.map((template) => (
                        <option key={template._id} value={template._id}>
                          {template.name} ({getScheduleDisplay(template)})
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500 mt-1">
                      Assign a default schedule template for this employee
                    </p>
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-6">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setShowHireModal(false);
                      setHireForm({
                        position: "",
                        department: "",
                        employeeType: "full_time",
                        hireDate: new Date().toISOString().split("T")[0],
                        hourlyRate: "",
                        scheduleTemplateId: "",
                        sendOfferEmail: true,
                        startTime: "08:00",
                        staffingAgency: "",
                        tempEligibilityMode: "days",
                        tempEligibilityValue: "",
                        tempEligibleDateOverride: "",
                      });
                    }}
                    disabled={isHiring}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleHire}
                    disabled={!hireForm.position || !hireForm.department || isHiring}
                  >
                    {isHiring ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Creating Personnel Record...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                        </svg>
                        Create Personnel Record
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            </div>
          )}

          {/* Send Offer Modal */}
          {showOfferModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-lg mx-4 w-full">
                <h3 className="text-xl font-bold text-white mb-2">Send Offer Letter</h3>
                <p className="text-slate-400 text-sm mb-6">
                  Send an offer email to {application.firstName} {application.lastName} at {application.email}
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-2">Position *</label>
                    <input
                      type="text"
                      placeholder="e.g., Warehouse Associate"
                      value={offerForm.positionTitle}
                      onChange={(e) => setOfferForm({ ...offerForm, positionTitle: e.target.value })}
                      className="theme-input w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-slate-400 mb-2">Department *</label>
                    <input
                      type="text"
                      placeholder="e.g., Warehouse, Operations"
                      value={offerForm.department}
                      onChange={(e) => setOfferForm({ ...offerForm, department: e.target.value })}
                      className="theme-input w-full"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-slate-400 mb-2">Pay Type *</label>
                      <select
                        value={offerForm.compensationType}
                        onChange={(e) => setOfferForm({ ...offerForm, compensationType: e.target.value as "hourly" | "salary" })}
                        className="theme-input w-full"
                      >
                        <option value="hourly">Hourly</option>
                        <option value="salary">Salary</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-2">
                        {offerForm.compensationType === "hourly" ? "Hourly Rate *" : "Annual Salary *"}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder={offerForm.compensationType === "hourly" ? "e.g., 18.00" : "e.g., 45000"}
                        value={offerForm.compensationAmount}
                        onChange={(e) => setOfferForm({ ...offerForm, compensationAmount: e.target.value })}
                        className="theme-input w-full"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-slate-400 mb-2">Start Date *</label>
                      <input
                        type="date"
                        value={offerForm.startDate}
                        onChange={(e) => setOfferForm({ ...offerForm, startDate: e.target.value })}
                        className="theme-input w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-2">Start Time</label>
                      <input
                        type="time"
                        value={offerForm.startTime}
                        onChange={(e) => setOfferForm({ ...offerForm, startTime: e.target.value })}
                        className="theme-input w-full"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-6">
                  <button
                    onClick={() => {
                      setShowOfferModal(false);
                      setOfferForm({
                        positionTitle: "",
                        department: "",
                        compensationType: "hourly",
                        compensationAmount: "",
                        startDate: new Date().toISOString().split("T")[0],
                        startTime: "08:00",
                      });
                    }}
                    disabled={isSendingOffer}
                    className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      if (!user || !offerForm.positionTitle || !offerForm.department || !offerForm.compensationAmount) return;
                      setIsSendingOffer(true);
                      try {
                        await createAndSendOffer({
                          applicationId: application._id,
                          positionTitle: offerForm.positionTitle,
                          department: offerForm.department,
                          compensationType: offerForm.compensationType,
                          compensationAmount: parseFloat(offerForm.compensationAmount),
                          startDate: offerForm.startDate,
                          startTime: offerForm.startTime || undefined,
                          userId: user._id,
                        });
                        setShowOfferModal(false);
                        setOfferForm({
                          positionTitle: "",
                          department: "",
                          compensationType: "hourly",
                          compensationAmount: "",
                          startDate: new Date().toISOString().split("T")[0],
                          startTime: "08:00",
                        });
                      } catch (error: any) {
                        console.error("Failed to send offer:", error);
                        alert(error?.message || "Failed to send offer");
                      } finally {
                        setIsSendingOffer(false);
                      }
                    }}
                    disabled={!offerForm.positionTitle || !offerForm.department || !offerForm.compensationAmount || isSendingOffer}
                    className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isSendingOffer ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Sending Offer...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        Send Offer Email
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Internal Notes (Editable) */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Internal Notes</h2>
              {!isEditingNotes && (
                <button
                  onClick={() => {
                    setNotesInput(application.notes || "");
                    setIsEditingNotes(true);
                  }}
                  className="px-3 py-1 text-sm text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 rounded transition-colors"
                >
                  {application.notes ? "Edit" : "Add Notes"}
                </button>
              )}
            </div>
            {isEditingNotes ? (
              <div className="space-y-3">
                <textarea
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  placeholder="Add internal notes about this candidate..."
                  rows={4}
                  className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-cyan-500 resize-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setIsEditingNotes(false);
                      setNotesInput("");
                    }}
                    disabled={isSavingNotes}
                    className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      setIsSavingNotes(true);
                      try {
                        await updateNotes({
                          applicationId: application._id,
                          notes: notesInput,
                        });
                        setIsEditingNotes(false);
                        setNotesInput("");
                      } catch (error) {
                        console.error("Failed to save notes:", error);
                      } finally {
                        setIsSavingNotes(false);
                      }
                    }}
                    disabled={isSavingNotes}
                    className="px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors disabled:opacity-50"
                  >
                    {isSavingNotes ? "Saving..." : "Save Notes"}
                  </button>
                </div>
              </div>
            ) : application.notes ? (
              <p className="text-slate-300 whitespace-pre-wrap">{application.notes}</p>
            ) : (
              <p className="text-slate-500 text-sm italic">No notes added yet</p>
            )}
          </div>

          {/* Resume Section - PDF or Text */}
          {(application.resumeFileId || application.resumeText) && (
            <ResumeSection application={application} />
          )}
        </div>
      </main>
    </div>
  );
}

export default function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);

  return (
    <Protected>
      <ApplicationDetailContent id={resolvedParams.id} />
    </Protected>
  );
}
