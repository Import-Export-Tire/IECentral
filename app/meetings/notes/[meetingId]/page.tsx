"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import { useAuth } from "@/app/auth-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

const STATUS_LABELS: Record<string, { label: string; color: string; bgColor: string }> = {
  recording: { label: "Recording", color: "text-red-400", bgColor: "bg-red-500/20" },
  uploading: { label: "Uploading Audio", color: "text-amber-400", bgColor: "bg-amber-500/20" },
  transcribing: { label: "Transcribing", color: "text-blue-400", bgColor: "bg-blue-500/20" },
  generating: { label: "Generating Notes", color: "text-purple-400", bgColor: "bg-purple-500/20" },
  complete: { label: "Complete", color: "text-emerald-400", bgColor: "bg-emerald-500/20" },
  error: { label: "Error", color: "text-red-400", bgColor: "bg-red-500/20" },
};

export default function MeetingNotesPage() {
  const params = useParams();
  const router = useRouter();
  const { theme } = useTheme();
  const { user } = useAuth();
  const isDark = theme === "dark";

  const meetingId = params.meetingId as string;
  const typedMeetingId = meetingId as unknown as Id<"meetings">;

  const meeting = useQuery(api.meetings.get, { meetingId: typedMeetingId });
  const notes = useQuery(api.meetingNotes.getByMeeting, {
    meetingId: typedMeetingId,
    userId: user?._id,
  });
  const participants = useQuery(api.meetingParticipants.getByMeeting, { meetingId: typedMeetingId });
  const toggleActionItem = useMutation(api.meetingNotes.toggleActionItem);
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const saveToDocHub = useMutation(api.meetingNotes.saveToDocHub);

  const [showTranscript, setShowTranscript] = useState(false);
  const [savingToDocHub, setSavingToDocHub] = useState(false);
  const [savedToDocHub, setSavedToDocHub] = useState(false);

  const handleSaveToDocHub = async () => {
    if (!notes || !meeting || !user || notes.status !== "complete") return;
    setSavingToDocHub(true);
    try {
      // Generate HTML
      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${meeting.title} - Meeting Notes</title>
<style>body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:40px 20px;color:#333}
h1{font-size:24px;border-bottom:2px solid #10b981;padding-bottom:8px}
h2{font-size:18px;margin-top:24px;color:#1f2937}
.meta{color:#6b7280;font-size:14px;margin-bottom:20px}
.summary{line-height:1.7;white-space:pre-wrap}
.action-item{padding:8px 0;border-bottom:1px solid #e5e7eb}
.action-item .assignee{color:#0891b2;font-size:13px}
.decision,.followup{padding:4px 0}
.transcript{white-space:pre-wrap;color:#6b7280;font-size:13px;line-height:1.6;margin-top:8px;padding:16px;background:#f9fafb;border-radius:8px}
</style></head><body>
<h1>${meeting.title}</h1>
<div class="meta">
  <div>Date: ${meeting.startedAt ? new Date(meeting.startedAt).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : "N/A"}</div>
  ${notes.duration ? `<div>Duration: ${Math.floor(notes.duration / 60)} minutes</div>` : ""}
</div>
${notes.summary ? `<h2>Summary</h2><div class="summary">${notes.summary}</div>` : ""}
${notes.actionItems?.length ? `<h2>Action Items</h2>${notes.actionItems.map((a: { text: string; assignee?: string; completed: boolean }) => `<div class="action-item">${a.completed ? "&#9745;" : "&#9744;"} ${a.text}${a.assignee ? ` <span class="assignee">— ${a.assignee}</span>` : ""}</div>`).join("")}` : ""}
${notes.decisions?.length ? `<h2>Key Decisions</h2>${notes.decisions.map((d: string) => `<div class="decision">• ${d}</div>`).join("")}` : ""}
${notes.followUps?.length ? `<h2>Follow-ups</h2>${notes.followUps.map((f: string) => `<div class="followup">• ${f}</div>`).join("")}` : ""}
${notes.transcript ? `<h2>Transcript</h2><div class="transcript">${notes.transcript}</div>` : ""}
</body></html>`;

      // Upload to Convex storage
      const uploadUrl = await generateUploadUrl();
      const blob = new Blob([html], { type: "text/html" });
      const uploadRes = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "text/html" }, body: blob });
      if (!uploadRes.ok) throw new Error("Failed to upload");
      const { storageId } = await uploadRes.json();

      // Save document with auto-created folder
      await saveToDocHub({
        meetingTitle: meeting.title,
        fileId: storageId,
        fileSize: blob.size,
        userId: user._id,
        userName: user.name || "Unknown",
      });

      setSavedToDocHub(true);
    } catch (err) {
      console.error("Failed to save to DocHub:", err);
      alert("Failed to save to DocHub. Please try again.");
    } finally {
      setSavingToDocHub(false);
    }
  };

  // Loading state
  if (meeting === undefined || notes === undefined) {
    return (
      <Protected>
        <div className={`flex h-screen theme-bg-primary`}>
          <Sidebar />
          <main className="flex-1 overflow-y-auto">
            <MobileHeader />
            <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8">
              <div className="flex justify-center py-20">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500" />
              </div>
            </div>
          </main>
        </div>
      </Protected>
    );
  }

  if (!meeting) {
    return (
      <Protected>
        <div className={`flex h-screen theme-bg-primary`}>
          <Sidebar />
          <main className="flex-1 overflow-y-auto">
            <MobileHeader />
            <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8">
              <div className="text-center py-20">
                <h2 className={`text-xl font-semibold mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Meeting Not Found
                </h2>
                <button
                  onClick={() => router.push("/meetings")}
                  className={`mt-4 px-5 py-2 rounded-lg font-medium transition-colors ${
                    isDark
                      ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30"
                      : "bg-blue-100 text-blue-600 hover:bg-blue-200"
                  }`}
                >
                  Back to Meetings
                </button>
              </div>
            </div>
          </main>
        </div>
      </Protected>
    );
  }

  const statusInfo = notes ? STATUS_LABELS[notes.status] || STATUS_LABELS.error : null;
  const isProcessing = notes && notes.status !== "complete" && notes.status !== "error";
  const participantNames = (participants ?? [])
    .map((p: any) => p.displayName || p.guestName || "Unknown")
    .filter(Boolean);

  return (
    <Protected>
      <div className={`flex h-screen theme-bg-primary`}>
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <MobileHeader />
          <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push("/meetings")}
                className={`p-2 rounded-lg transition-colors ${
                  isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-gray-200 text-gray-500"
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
              <div className="flex-1">
                <h1 className={`text-2xl sm:text-3xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                  {meeting.title}
                </h1>
                <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Meeting Notes
                </p>
              </div>
              {/* Save to DocHub button */}
              {notes?.status === "complete" && (
                <button
                  onClick={handleSaveToDocHub}
                  disabled={savingToDocHub || savedToDocHub}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                    savedToDocHub
                      ? isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700"
                      : isDark ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30" : "bg-blue-100 text-blue-600 hover:bg-blue-200"
                  }`}
                >
                  {savedToDocHub ? "Saved to DocHub" : savingToDocHub ? "Saving..." : "Save to DocHub"}
                </button>
              )}
            </div>

            {/* Meeting Info Card */}
            <div
              className={`border rounded-xl p-4 sm:p-6 ${
                isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"
              }`}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <p className={`text-xs font-medium uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Date
                  </p>
                  <p className={`text-sm mt-1 ${isDark ? "text-slate-200" : "text-gray-900"}`}>
                    {meeting.startedAt ? formatDateTime(meeting.startedAt) : formatDateTime(meeting.createdAt)}
                  </p>
                </div>
                <div>
                  <p className={`text-xs font-medium uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Duration
                  </p>
                  <p className={`text-sm mt-1 ${isDark ? "text-slate-200" : "text-gray-900"}`}>
                    {notes?.duration
                      ? formatDuration(notes.duration)
                      : meeting.startedAt && meeting.endedAt
                      ? formatDuration(Math.floor((meeting.endedAt - meeting.startedAt) / 1000))
                      : "N/A"}
                  </p>
                </div>
                <div>
                  <p className={`text-xs font-medium uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Participants
                  </p>
                  <p className={`text-sm mt-1 ${isDark ? "text-slate-200" : "text-gray-900"}`}>
                    {participantNames.length > 0 ? participantNames.join(", ") : "N/A"}
                  </p>
                </div>
                <div>
                  <p className={`text-xs font-medium uppercase tracking-wider ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Status
                  </p>
                  {statusInfo ? (
                    <span
                      className={`inline-flex items-center gap-1.5 mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${statusInfo.color} ${statusInfo.bgColor}`}
                    >
                      {isProcessing && (
                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                      )}
                      {statusInfo.label}
                    </span>
                  ) : (
                    <p className={`text-sm mt-1 ${isDark ? "text-slate-200" : "text-gray-900"}`}>
                      No notes
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Processing indicator */}
            {isProcessing && (
              <div
                className={`border rounded-xl p-6 text-center ${
                  isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"
                }`}
              >
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-cyan-500 mx-auto mb-4" />
                <h3 className={`text-lg font-semibold mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Processing Your Meeting
                </h3>
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  {notes.status === "recording" && "Recording in progress..."}
                  {notes.status === "uploading" && "Uploading audio file..."}
                  {notes.status === "transcribing" && "Transcribing audio with AI..."}
                  {notes.status === "generating" && "Generating meeting notes with AI..."}
                </p>
                {/* Progress steps */}
                <div className="flex items-center justify-center gap-2 mt-4">
                  {["recording", "uploading", "transcribing", "generating", "complete"].map((step, idx) => {
                    const steps = ["recording", "uploading", "transcribing", "generating", "complete"];
                    const currentIdx = steps.indexOf(notes.status);
                    const isComplete = idx < currentIdx;
                    const isCurrent = idx === currentIdx;
                    return (
                      <div key={step} className="flex items-center gap-2">
                        <div
                          className={`w-2.5 h-2.5 rounded-full ${
                            isComplete
                              ? "bg-emerald-500"
                              : isCurrent
                              ? "bg-cyan-500 animate-pulse"
                              : isDark
                              ? "bg-slate-600"
                              : "bg-gray-300"
                          }`}
                        />
                        {idx < steps.length - 1 && (
                          <div
                            className={`w-8 h-0.5 ${
                              isComplete
                                ? "bg-emerald-500"
                                : isDark
                                ? "bg-slate-600"
                                : "bg-gray-300"
                            }`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Error state */}
            {notes?.status === "error" && (
              <div
                className={`border rounded-xl p-6 ${
                  isDark ? "bg-red-900/20 border-red-800/50" : "bg-red-50 border-red-200"
                }`}
              >
                <div className="flex items-start gap-3">
                  <svg className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <h3 className="text-red-400 font-semibold">Processing Error</h3>
                    <p className={`text-sm mt-1 ${isDark ? "text-red-300/70" : "text-red-600"}`}>
                      {notes.errorMessage || "An error occurred while processing your meeting notes."}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Notes content — only show when complete */}
            {notes?.status === "complete" && (
              <>
                {/* Summary */}
                {notes.summary && (
                  <div
                    className={`border rounded-xl p-4 sm:p-6 ${
                      isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"
                    }`}
                  >
                    <h2 className={`text-lg font-semibold mb-3 flex items-center gap-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                      <svg className="w-5 h-5 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Summary
                    </h2>
                    <div className={`text-sm leading-relaxed whitespace-pre-wrap ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      {notes.summary}
                    </div>
                  </div>
                )}

                {/* Action Items */}
                {notes.actionItems && notes.actionItems.length > 0 && (
                  <div
                    className={`border rounded-xl p-4 sm:p-6 ${
                      isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"
                    }`}
                  >
                    <h2 className={`text-lg font-semibold mb-3 flex items-center gap-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                      <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                      </svg>
                      Action Items
                      <span className={`text-sm font-normal ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                        ({notes.actionItems.filter((a) => a.completed).length}/{notes.actionItems.length})
                      </span>
                    </h2>
                    <div className="space-y-2">
                      {notes.actionItems.map((item, index) => (
                        <div
                          key={index}
                          className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                            isDark ? "hover:bg-slate-700/50" : "hover:bg-gray-50"
                          }`}
                        >
                          <button
                            onClick={() =>
                              toggleActionItem({
                                notesId: notes._id,
                                index,
                              })
                            }
                            className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                              item.completed
                                ? "bg-emerald-500 border-emerald-500"
                                : isDark
                                ? "border-slate-500 hover:border-cyan-500"
                                : "border-gray-300 hover:border-blue-500"
                            }`}
                          >
                            {item.completed && (
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-sm ${
                                item.completed
                                  ? isDark
                                    ? "text-slate-500 line-through"
                                    : "text-gray-400 line-through"
                                  : isDark
                                  ? "text-slate-200"
                                  : "text-gray-900"
                              }`}
                            >
                              {item.text}
                            </p>
                            <div className="flex items-center gap-3 mt-1">
                              {item.assignee && (
                                <span className={`text-xs ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                                  @{item.assignee}
                                </span>
                              )}
                              {item.dueDate && (
                                <span className={`text-xs ${isDark ? "text-amber-400" : "text-amber-600"}`}>
                                  Due: {item.dueDate}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Decisions */}
                {notes.decisions && notes.decisions.length > 0 && (
                  <div
                    className={`border rounded-xl p-4 sm:p-6 ${
                      isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"
                    }`}
                  >
                    <h2 className={`text-lg font-semibold mb-3 flex items-center gap-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                      <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Decisions Made
                    </h2>
                    <ul className="space-y-2">
                      {notes.decisions.map((decision, index) => (
                        <li key={index} className="flex items-start gap-2">
                          <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 bg-emerald-500`} />
                          <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                            {decision}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Follow-ups */}
                {notes.followUps && notes.followUps.length > 0 && (
                  <div
                    className={`border rounded-xl p-4 sm:p-6 ${
                      isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"
                    }`}
                  >
                    <h2 className={`text-lg font-semibold mb-3 flex items-center gap-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                      <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                      Follow-ups
                    </h2>
                    <ul className="space-y-2">
                      {notes.followUps.map((followUp, index) => (
                        <li key={index} className="flex items-start gap-2">
                          <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-500`} />
                          <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                            {followUp}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Key Topics */}
                {notes.keyTopics && notes.keyTopics.length > 0 && (
                  <div
                    className={`border rounded-xl p-4 sm:p-6 ${
                      isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"
                    }`}
                  >
                    <h2 className={`text-lg font-semibold mb-3 flex items-center gap-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                      <svg className="w-5 h-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                      Key Topics
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {notes.keyTopics.map((topic, index) => (
                        <span
                          key={index}
                          className={`px-3 py-1 rounded-full text-sm font-medium ${
                            isDark
                              ? "bg-slate-700 text-slate-300"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Full Transcript (collapsible) */}
                {notes.transcript && (
                  <div
                    className={`border rounded-xl overflow-hidden ${
                      isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"
                    }`}
                  >
                    <button
                      onClick={() => setShowTranscript(!showTranscript)}
                      className={`w-full flex items-center justify-between p-4 sm:p-6 transition-colors ${
                        isDark ? "hover:bg-slate-700/30" : "hover:bg-gray-50"
                      }`}
                    >
                      <h2 className={`text-lg font-semibold flex items-center gap-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                        <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                        </svg>
                        Full Transcript
                      </h2>
                      <svg
                        className={`w-5 h-5 transition-transform ${showTranscript ? "rotate-180" : ""} ${
                          isDark ? "text-slate-400" : "text-gray-500"
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {showTranscript && (
                      <div className={`px-4 sm:px-6 pb-4 sm:pb-6 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                        <div
                          className={`mt-4 text-sm leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto ${
                            isDark ? "text-slate-300" : "text-gray-700"
                          }`}
                        >
                          {notes.transcript}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* No notes available */}
            {!notes && (
              <div
                className={`border rounded-xl p-8 text-center ${
                  isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"
                }`}
              >
                <svg
                  className={`w-16 h-16 mx-auto mb-4 ${isDark ? "text-slate-600" : "text-gray-300"}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h3 className={`text-lg font-semibold mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>
                  No Notes Available
                </h3>
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  This meeting does not have AI-generated notes.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </Protected>
  );
}
