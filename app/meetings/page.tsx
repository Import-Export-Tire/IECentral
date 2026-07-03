"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "../auth-context";
import { useTheme } from "../theme-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import MeetingsHelpModal from "@/components/meetings/HelpModal";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

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
  const { user } = useAuth();
  const { theme } = useTheme();
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
      <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          {/* Mobile Header */}
          <MobileHeader />

          {/* Sticky Header */}
          <header className="sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
            <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">Meetings</h1>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <MeetingsHelpModal isDark={theme === "dark"} />
                <Button
                  variant={showNewMeeting ? "secondary" : "primary"}
                  onClick={() => setShowNewMeeting(!showNewMeeting)}
                >
                  {showNewMeeting ? "Cancel" : "New Meeting"}
                </Button>
              </div>
            </div>
          </header>

          <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">

            {/* Info Panel */}
            {showInfo && (
              <Card>
                <div className="flex items-start justify-between mb-4">
                  <h2 className="text-[17px] font-semibold theme-text-primary">Why IE Meetings?</h2>
                  <button
                    onClick={() => setShowInfo(false)}
                    className="p-1 rounded-lg theme-text-tertiary hover:theme-text-secondary transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className="text-sm theme-text-secondary mb-4">
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
                    <div key={i} className="flex gap-3 p-3 rounded-xl bg-[#f2f2f7] dark:bg-slate-800/60">
                      <svg className="w-5 h-5 mt-0.5 flex-shrink-0 text-[#007AFF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                      </svg>
                      <div>
                        <h3 className="text-sm font-semibold theme-text-primary">{item.title}</h3>
                        <p className="text-xs mt-0.5 theme-text-tertiary">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* New Meeting Form */}
            {showNewMeeting && (
              <Card>
                <div className="ui-section-label mb-1">Create</div>
                <h2 className="text-[17px] font-semibold theme-text-primary mb-4">New Meeting</h2>
                <div className="space-y-4">
                  {/* Mode Toggle */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setMeetingMode("instant")}
                      className={`flex-1 px-3 py-2 rounded-[9px] text-sm font-semibold transition-colors border ${
                        meetingMode === "instant"
                          ? "bg-[#007AFF] text-white border-[#007AFF]"
                          : "theme-text-secondary border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600"
                      }`}
                    >
                      Start Now
                    </button>
                    <button
                      onClick={() => setMeetingMode("scheduled")}
                      className={`flex-1 px-3 py-2 rounded-[9px] text-sm font-semibold transition-colors border ${
                        meetingMode === "scheduled"
                          ? "bg-[#007AFF] text-white border-[#007AFF]"
                          : "theme-text-secondary border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600"
                      }`}
                    >
                      Schedule for Later
                    </button>
                  </div>

                  <div>
                    <label className="block text-sm font-medium theme-text-secondary mb-1">
                      Meeting Title
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Weekly Team Standup"
                      className="theme-input w-full px-3 py-2"
                      onKeyDown={(e) => { if (e.key === "Enter" && meetingMode === "instant") handleCreateMeeting(); }}
                    />
                  </div>

                  {/* Schedule fields */}
                  {meetingMode === "scheduled" && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-sm font-medium theme-text-secondary mb-1">Date</label>
                        <input
                          type="date"
                          value={scheduledDate}
                          onChange={(e) => setScheduledDate(e.target.value)}
                          min={new Date().toISOString().split("T")[0]}
                          className="theme-input w-full px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium theme-text-secondary mb-1">Start Time</label>
                        <input
                          type="time"
                          value={scheduledStartTime}
                          onChange={(e) => setScheduledStartTime(e.target.value)}
                          className="theme-input w-full px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium theme-text-secondary mb-1">End Time</label>
                        <input
                          type="time"
                          value={scheduledEndTime}
                          onChange={(e) => setScheduledEndTime(e.target.value)}
                          className="theme-input w-full px-3 py-2"
                        />
                      </div>
                    </div>
                  )}

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isNotedMeeting}
                      onChange={(e) => setIsNotedMeeting(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-[#007AFF] focus:ring-[#007AFF]"
                    />
                    <span className="text-sm theme-text-secondary">
                      Noted Meeting (AI transcription + notes)
                    </span>
                  </label>

                  <Button
                    variant="primary"
                    onClick={handleCreateMeeting}
                    disabled={!title.trim() || creating || (meetingMode === "scheduled" && (!scheduledDate || !scheduledStartTime))}
                  >
                    {creating ? (meetingMode === "instant" ? "Starting..." : "Scheduling...") : meetingMode === "instant" ? "Start Now" : "Schedule Meeting"}
                  </Button>
                </div>
              </Card>
            )}

            {/* Join Meeting */}
            <Card>
              <div className="ui-section-label mb-1">Join</div>
              <h2 className="text-[17px] font-semibold theme-text-primary mb-3">Join a Meeting</h2>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => {
                    setJoinCode(e.target.value);
                    setJoinError("");
                  }}
                  placeholder="Enter meeting code"
                  className="theme-input flex-1 px-3 py-2"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleJoin();
                  }}
                />
                <Button
                  variant="primary"
                  onClick={handleJoin}
                  disabled={!joinCode.trim() || joining}
                >
                  {joining ? "Joining..." : "Join"}
                </Button>
              </div>
              {joinError && (
                <p className="mt-2 text-sm text-red-500 dark:text-red-400">{joinError}</p>
              )}
            </Card>

            {/* Companion App Download */}
            <Card>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#007AFF]/10 dark:bg-[#007AFF]/20 flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-[#007AFF]"
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
                    <h3 className="font-semibold text-sm theme-text-primary">
                      IECentral Companion App
                    </h3>
                    <p className="text-xs theme-text-tertiary">
                      Enable full remote desktop control during meetings
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    title="macOS build coming soon"
                    className="px-3 py-1.5 rounded-[9px] text-xs font-medium cursor-not-allowed select-none opacity-50 ui-badge ui-badge-gray"
                  >
                    macOS · Coming soon
                  </span>
                  <a
                    href="https://iecentral-downloads.s3.amazonaws.com/IECentral-Companion.exe"
                    className="px-3 py-1.5 rounded-[9px] text-xs font-semibold transition-colors theme-btn-secondary"
                  >
                    Windows
                  </a>
                </div>
              </div>
            </Card>

            {/* Upcoming Meetings */}
            <Card>
              <div className="ui-section-label mb-1">Scheduled</div>
              <h2 className="text-[17px] font-semibold theme-text-primary mb-3">Upcoming Meetings</h2>
              {!upcomingMeetings ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#007AFF]" />
                </div>
              ) : upcomingMeetings.length === 0 ? (
                <p className="text-sm theme-text-tertiary">No upcoming meetings.</p>
              ) : (
                <div className="space-y-2">
                  {upcomingMeetings.map((meeting: any) => (
                    <div
                      key={meeting._id}
                      className="flex items-center justify-between p-3 rounded-xl border theme-border-secondary bg-[#f2f2f7] dark:bg-slate-800/40"
                    >
                      <div>
                        <h3 className="font-semibold text-sm theme-text-primary">
                          {meeting.title}
                        </h3>
                        {meeting.scheduledStart && (
                          <p className="text-xs theme-text-tertiary mt-0.5">
                            {formatDateTime(meeting.scheduledStart)}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          {meeting.isNotedMeeting && (
                            <span className="ui-badge ui-badge-blue">Noted</span>
                          )}
                          {meeting.joinCode && (
                            <span className="text-xs font-mono theme-text-tertiary">
                              Code: {meeting.joinCode}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => router.push(`/meetings/room/${meeting._id}`)}
                      >
                        Join
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Past Meetings */}
            <Card padding="sm">
              <button
                onClick={() => setShowPast(!showPast)}
                className="flex items-center justify-between w-full px-1 py-1"
              >
                <h2 className="text-[17px] font-semibold theme-text-primary">Past Meetings</h2>
                <svg
                  className={`w-5 h-5 transition-transform theme-text-tertiary ${showPast ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showPast && (
                <div className="mt-3 pt-3 border-t theme-border-secondary">
                  {!pastMeetings ? (
                    <div className="flex justify-center py-6">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#007AFF]" />
                    </div>
                  ) : pastMeetings.length === 0 ? (
                    <p className="text-sm theme-text-tertiary">No past meetings.</p>
                  ) : (
                    <div className="space-y-2">
                      {pastMeetings.map((meeting: any) => (
                        <div
                          key={meeting._id}
                          className="p-3 rounded-xl border theme-border-secondary bg-[#f2f2f7] dark:bg-slate-800/40"
                        >
                          <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-sm theme-text-primary">
                              {meeting.title}
                            </h3>
                            <div className="flex items-center gap-2">
                              {meeting.isNotedMeeting && (
                                <span className="ui-badge ui-badge-blue">Noted</span>
                              )}
                              {meeting.isNotedMeeting && meeting.meetingNotesId && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => router.push(`/meetings/notes/${meeting._id}`)}
                                >
                                  View Notes
                                </Button>
                              )}
                            </div>
                          </div>
                          <div className="text-xs theme-text-tertiary mt-1">
                            {meeting.startedAt && formatDateTime(meeting.startedAt)}
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
            </Card>

          </div>
        </main>
      </div>
    </Protected>
  );
}
