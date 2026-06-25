"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import MeetingsHelpModal from "@/components/meetings/HelpModal";

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDuration(start: number, end: number): string {
  const mins = Math.round((end - start) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

export default function MeetingsPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();
  const router = useRouter();

  const [showNewMeeting, setShowNewMeeting] = useState(false);
  const [title, setTitle] = useState("");
  const [isNotedMeeting, setIsNotedMeeting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [meetingMode, setMeetingMode] = useState<"instant" | "scheduled">("instant");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledStartTime, setScheduledStartTime] = useState("");
  const [scheduledEndTime, setScheduledEndTime] = useState("");

  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);
  const [lookupCode, setLookupCode] = useState<string | null>(null);

  const [showPast, setShowPast] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const userId = user?._id as Id<"users"> | undefined;
  const upcomingMeetings = useQuery(api.meetings.listUpcoming, userId ? { userId } : "skip");
  const pastMeetings = useQuery(api.meetings.listPast, userId ? { userId } : "skip");
  const createMeeting = useMutation(api.meetings.create);
  const startMeeting = useMutation(api.meetings.start);
  const meetingByJoinCode = useQuery(
    api.meetings.getByJoinCode,
    lookupCode ? { joinCode: lookupCode } : "skip"
  );

  async function handleCreateMeeting() {
    if (!user || !title.trim()) return;
    setCreating(true);
    try {
      const args: { title: string; userId: Id<"users">; isNotedMeeting: boolean; scheduledStart?: number; scheduledEnd?: number } = {
        title: title.trim(),
        isNotedMeeting,
        userId: user._id,
      };

      if (meetingMode === "scheduled" && scheduledDate && scheduledStartTime) {
        args.scheduledStart = new Date(`${scheduledDate}T${scheduledStartTime}`).getTime();
        if (scheduledEndTime) {
          args.scheduledEnd = new Date(`${scheduledDate}T${scheduledEndTime}`).getTime();
        }
      }

      const meetingId = await createMeeting(args);

      if (meetingMode === "instant") {
        await startMeeting({ meetingId });
        router.push(`/meetings/room/${meetingId}`);
      } else {
        // Reset form and show upcoming
        setTitle("");
        setIsNotedMeeting(false);
        setScheduledDate("");
        setScheduledStartTime("");
        setScheduledEndTime("");
        setShowNewMeeting(false);
      }
    } catch (err) {
      console.error("Failed to create meeting:", err);
    } finally {
      setCreating(false);
    }
  }

  // React to join-code lookup result
  useEffect(() => {
    if (!lookupCode) return;
    if (meetingByJoinCode === undefined) return; // still loading
    if (meetingByJoinCode) {
      router.push(`/meetings/room/${meetingByJoinCode._id}`);
    } else {
      setJoinError("Meeting not found. Check the code and try again.");
    }
    setJoining(false);
    setLookupCode(null);
  }, [meetingByJoinCode, lookupCode, router]);

  function handleJoin() {
    if (!joinCode.trim()) return;
    setJoining(true);
    setJoinError("");
    setLookupCode(joinCode.trim());
  }

  return (
    <Protected>
      <div className="flex h-screen theme-bg-primary">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          {/* Mobile Header */}
          <MobileHeader />
          <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h1
                className={`text-2xl sm:text-3xl font-bold ${
                  isDark ? "text-white" : "text-gray-900"
                }`}
              >
                Meetings
              </h1>
              <div className="flex items-center gap-2">
                <MeetingsHelpModal isDark={isDark} />
                <button
                  onClick={() => setShowNewMeeting(!showNewMeeting)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    isDark
                      ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30"
                      : "bg-blue-100 text-blue-600 hover:bg-blue-200"
                  }`}
                >
                  {showNewMeeting ? "Cancel" : "New Meeting"}
                </button>
              </div>
            </div>

            {/* Info Panel */}
            {showInfo && (
              <div className={`border rounded-xl p-5 sm:p-6 ${isDark ? "bg-gradient-to-br from-slate-800/80 to-slate-800/40 border-slate-700" : "bg-gradient-to-br from-blue-50 to-white border-blue-200 shadow-sm"}`}>
                <div className="flex items-start justify-between mb-4">
                  <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                    Why IE Meetings?
                  </h2>
                  <button onClick={() => setShowInfo(false)} className={`${isDark ? "text-slate-400 hover:text-slate-300" : "text-gray-400 hover:text-gray-600"}`}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className={`text-sm mb-4 ${isDark ? "text-slate-300" : "text-gray-600"}`}>
                  IE Meetings is built into IE Central with features designed specifically for our team. No extra accounts, no monthly fees, no third-party data sharing.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { icon: "M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z", title: "AI Meeting Notes", desc: "Automatic transcription, summaries, action items, and decisions — powered by AI. Never miss a detail." },
                    { icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z", title: "Remote Desktop Control", desc: "Take control of a coworker's screen during a call for real-time troubleshooting. Works with the Companion App." },
                    { icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z", title: "Works with Anyone", desc: "Invite external contacts via email — they join with a link, no account needed. Share a code or send an invite." },
                    { icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z", title: "HD Video & Screen Sharing", desc: "Peer-to-peer video calls with screen sharing, camera toggle, and noise suppression built in." },
                    { icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z", title: "Private & Secure", desc: "All data stays in our infrastructure. No Zoom, no Teams, no third parties recording or storing your calls." },
                    { icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z", title: "Zero Cost", desc: "No per-user fees, no meeting limits, no time caps. It's part of IE Central — already included." },
                  ].map((item, i) => (
                    <div key={i} className={`flex gap-3 p-3 rounded-lg ${isDark ? "bg-slate-700/30" : "bg-white/80"}`}>
                      <svg className={`w-5 h-5 mt-0.5 flex-shrink-0 ${isDark ? "text-cyan-400" : "text-blue-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                      </svg>
                      <div>
                        <h3 className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>{item.title}</h3>
                        <p className={`text-xs mt-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* New Meeting Form */}
            {showNewMeeting && (
              <div
                className={`border rounded-xl p-4 sm:p-6 ${
                  isDark
                    ? "bg-slate-800/50 border-slate-700"
                    : "bg-white border-gray-200 shadow-sm"
                }`}
              >
                <h2
                  className={`text-lg font-semibold mb-4 ${
                    isDark ? "text-white" : "text-gray-900"
                  }`}
                >
                  New Meeting
                </h2>
                <div className="space-y-4">
                  {/* Mode Toggle */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setMeetingMode("instant")}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        meetingMode === "instant"
                          ? isDark ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40" : "bg-blue-100 text-blue-700 border border-blue-300"
                          : isDark ? "text-slate-400 border border-slate-700 hover:border-slate-600" : "text-gray-500 border border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      Start Now
                    </button>
                    <button
                      onClick={() => setMeetingMode("scheduled")}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        meetingMode === "scheduled"
                          ? isDark ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40" : "bg-blue-100 text-blue-700 border border-blue-300"
                          : isDark ? "text-slate-400 border border-slate-700 hover:border-slate-600" : "text-gray-500 border border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      Schedule for Later
                    </button>
                  </div>

                  <div>
                    <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Meeting Title
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Weekly Team Standup"
                      className={`w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 ${
                        isDark
                          ? "bg-slate-700 border-slate-600 text-white focus:ring-cyan-500 placeholder-slate-400"
                          : "bg-white border-gray-300 text-gray-900 focus:ring-blue-500 placeholder-gray-400"
                      }`}
                      onKeyDown={(e) => { if (e.key === "Enter" && meetingMode === "instant") handleCreateMeeting(); }}
                    />
                  </div>

                  {/* Schedule fields */}
                  {meetingMode === "scheduled" && (
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Date</label>
                        <input
                          type="date"
                          value={scheduledDate}
                          onChange={(e) => setScheduledDate(e.target.value)}
                          min={new Date().toISOString().split("T")[0]}
                          className={`w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 ${
                            isDark ? "bg-slate-700 border-slate-600 text-white focus:ring-cyan-500" : "bg-white border-gray-300 text-gray-900 focus:ring-blue-500"
                          }`}
                        />
                      </div>
                      <div>
                        <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>Start Time</label>
                        <input
                          type="time"
                          value={scheduledStartTime}
                          onChange={(e) => setScheduledStartTime(e.target.value)}
                          className={`w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 ${
                            isDark ? "bg-slate-700 border-slate-600 text-white focus:ring-cyan-500" : "bg-white border-gray-300 text-gray-900 focus:ring-blue-500"
                          }`}
                        />
                      </div>
                      <div>
                        <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>End Time</label>
                        <input
                          type="time"
                          value={scheduledEndTime}
                          onChange={(e) => setScheduledEndTime(e.target.value)}
                          className={`w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 ${
                            isDark ? "bg-slate-700 border-slate-600 text-white focus:ring-cyan-500" : "bg-white border-gray-300 text-gray-900 focus:ring-blue-500"
                          }`}
                        />
                      </div>
                    </div>
                  )}

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isNotedMeeting}
                      onChange={(e) => setIsNotedMeeting(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-cyan-500 focus:ring-cyan-500"
                    />
                    <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Noted Meeting (AI transcription + notes)
                    </span>
                  </label>

                  <button
                    onClick={handleCreateMeeting}
                    disabled={!title.trim() || creating || (meetingMode === "scheduled" && (!scheduledDate || !scheduledStartTime))}
                    className={`px-5 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                      isDark ? "bg-cyan-600 text-white hover:bg-cyan-700" : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}
                  >
                    {creating ? (meetingMode === "instant" ? "Starting..." : "Scheduling...") : meetingMode === "instant" ? "Start Now" : "Schedule Meeting"}
                  </button>
                </div>
              </div>
            )}

            {/* Join Meeting */}
            <div
              className={`border rounded-xl p-4 sm:p-6 ${
                isDark
                  ? "bg-slate-800/50 border-slate-700"
                  : "bg-white border-gray-200 shadow-sm"
              }`}
            >
              <h2
                className={`text-lg font-semibold mb-3 ${
                  isDark ? "text-white" : "text-gray-900"
                }`}
              >
                Join a Meeting
              </h2>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => {
                    setJoinCode(e.target.value);
                    setJoinError("");
                  }}
                  placeholder="Enter meeting code"
                  className={`flex-1 px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 ${
                    isDark
                      ? "bg-slate-700 border-slate-600 text-white focus:ring-cyan-500 placeholder-slate-400"
                      : "bg-white border-gray-300 text-gray-900 focus:ring-blue-500 placeholder-gray-400"
                  }`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleJoin();
                  }}
                />
                <button
                  onClick={handleJoin}
                  disabled={!joinCode.trim() || joining}
                  className={`px-5 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                    isDark
                      ? "bg-cyan-600 text-white hover:bg-cyan-700"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  {joining ? "Joining..." : "Join"}
                </button>
              </div>
              {joinError && (
                <p className="mt-2 text-sm text-red-400">{joinError}</p>
              )}
            </div>

            {/* Companion App Download */}
            <div
              className={`border rounded-xl p-4 sm:p-6 ${
                isDark
                  ? "bg-slate-800/50 border-slate-700"
                  : "bg-white border-gray-200 shadow-sm"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      isDark ? "bg-cyan-500/20" : "bg-blue-100"
                    }`}
                  >
                    <svg
                      className={`w-5 h-5 ${isDark ? "text-cyan-400" : "text-blue-600"}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                  <div>
                    <h3
                      className={`font-semibold text-sm ${
                        isDark ? "text-white" : "text-gray-900"
                      }`}
                    >
                      IECentral Companion App
                    </h3>
                    <p
                      className={`text-xs ${
                        isDark ? "text-slate-400" : "text-gray-500"
                      }`}
                    >
                      Enable full remote desktop control during meetings
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    title="macOS build coming soon"
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-not-allowed select-none opacity-60 ${
                      isDark
                        ? "bg-slate-800 text-slate-500 border border-slate-700"
                        : "bg-gray-50 text-gray-400 border border-gray-200"
                    }`}
                  >
                    macOS · Coming soon
                  </span>
                  <a
                    href="https://iecentral-downloads.s3.amazonaws.com/IECentral-Companion.exe"
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      isDark
                        ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    Windows
                  </a>
                </div>
              </div>
            </div>

            {/* Upcoming Meetings */}
            <div
              className={`border rounded-xl p-4 sm:p-6 ${
                isDark
                  ? "bg-slate-800/50 border-slate-700"
                  : "bg-white border-gray-200 shadow-sm"
              }`}
            >
              <h2
                className={`text-lg font-semibold mb-3 ${
                  isDark ? "text-white" : "text-gray-900"
                }`}
              >
                Upcoming Meetings
              </h2>
              {!upcomingMeetings ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
                </div>
              ) : upcomingMeetings.length === 0 ? (
                <p className={isDark ? "text-slate-400" : "text-gray-500"}>
                  No upcoming meetings.
                </p>
              ) : (
                <div className="space-y-3">
                  {upcomingMeetings.map((meeting: any) => (
                    <div
                      key={meeting._id}
                      className={`flex items-center justify-between p-3 rounded-lg border ${
                        isDark
                          ? "bg-slate-700/50 border-slate-600"
                          : "bg-gray-50 border-gray-200"
                      }`}
                    >
                      <div>
                        <h3
                          className={`font-medium ${
                            isDark ? "text-white" : "text-gray-900"
                          }`}
                        >
                          {meeting.title}
                        </h3>
                        {meeting.scheduledStart && (
                          <p
                            className={`text-sm ${
                              isDark ? "text-slate-400" : "text-gray-500"
                            }`}
                          >
                            {formatDateTime(meeting.scheduledStart)}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          {meeting.isNotedMeeting && (
                            <span className="inline-flex items-center gap-1 text-xs text-cyan-400">
                              <span className="w-2 h-2 bg-cyan-400 rounded-full" />
                              Noted
                            </span>
                          )}
                          {meeting.joinCode && (
                            <span
                              className={`text-xs font-mono ${
                                isDark ? "text-slate-500" : "text-gray-400"
                              }`}
                            >
                              Code: {meeting.joinCode}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          router.push(`/meetings/room/${meeting._id}`)
                        }
                        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          isDark
                            ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30"
                            : "bg-blue-100 text-blue-600 hover:bg-blue-200"
                        }`}
                      >
                        Join
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Past Meetings */}
            <div
              className={`border rounded-xl p-4 sm:p-6 ${
                isDark
                  ? "bg-slate-800/50 border-slate-700"
                  : "bg-white border-gray-200 shadow-sm"
              }`}
            >
              <button
                onClick={() => setShowPast(!showPast)}
                className="flex items-center justify-between w-full"
              >
                <h2
                  className={`text-lg font-semibold ${
                    isDark ? "text-white" : "text-gray-900"
                  }`}
                >
                  Past Meetings
                </h2>
                <svg
                  className={`w-5 h-5 transition-transform ${
                    showPast ? "rotate-180" : ""
                  } ${isDark ? "text-slate-400" : "text-gray-500"}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {showPast && (
                <div className="mt-3">
                  {!pastMeetings ? (
                    <div className="flex justify-center py-6">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
                    </div>
                  ) : pastMeetings.length === 0 ? (
                    <p
                      className={isDark ? "text-slate-400" : "text-gray-500"}
                    >
                      No past meetings.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {pastMeetings.map((meeting: any) => (
                        <div
                          key={meeting._id}
                          className={`p-3 rounded-lg border ${
                            isDark
                              ? "bg-slate-700/50 border-slate-600"
                              : "bg-gray-50 border-gray-200"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <h3
                              className={`font-medium ${
                                isDark ? "text-white" : "text-gray-900"
                              }`}
                            >
                              {meeting.title}
                            </h3>
                            <div className="flex items-center gap-2">
                              {meeting.isNotedMeeting && (
                                <span className="text-xs text-cyan-400">
                                  Noted
                                </span>
                              )}
                              {meeting.isNotedMeeting && meeting.meetingNotesId && (
                                <button
                                  onClick={() =>
                                    router.push(`/meetings/notes/${meeting._id}`)
                                  }
                                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                                    isDark
                                      ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30"
                                      : "bg-blue-100 text-blue-600 hover:bg-blue-200"
                                  }`}
                                >
                                  View Notes
                                </button>
                              )}
                            </div>
                          </div>
                          <div
                            className={`text-sm mt-1 ${
                              isDark ? "text-slate-400" : "text-gray-500"
                            }`}
                          >
                            {meeting.startedAt &&
                              formatDateTime(meeting.startedAt)}
                            {meeting.startedAt && meeting.endedAt && (
                              <span className="ml-2">
                                ({formatDuration(meeting.startedAt, meeting.endedAt)})
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </Protected>
  );
}
