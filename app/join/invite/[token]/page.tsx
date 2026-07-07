"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

function InviteJoinContent({ token }: { token: string }) {
  const router = useRouter();
  const invite = useQuery(api.meetingInvites.getByToken, {
    inviteToken: token,
  });

  const joinMeeting = useMutation(api.meetingParticipants.join);
  const updateInviteStatus = useMutation(api.meetingInvites.updateStatus);

  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preFilled, setPreFilled] = useState(false);

  // Pre-fill from invite data
  useEffect(() => {
    if (invite && !preFilled) {
      if (invite.name) setGuestName(invite.name);
      if (invite.email) setGuestEmail(invite.email);
      setPreFilled(true);
    }
  }, [invite, preFilled]);

  // Mark invite as opened
  useEffect(() => {
    if (invite && invite.status === "sent") {
      updateInviteStatus({
        inviteToken: token,
        status: "opened",
      }).catch(() => {});
    }
  }, [invite, token, updateInviteStatus]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite || !guestName.trim()) return;

    setIsJoining(true);
    setError(null);

    try {
      await joinMeeting({
        meetingId: invite.meetingId,
        guestName: guestName.trim(),
        guestEmail: guestEmail.trim() || undefined,
        inviteToken: token,
      });

      // Mark invite as joined
      await updateInviteStatus({
        inviteToken: token,
        status: "joined",
      }).catch(() => {});

      router.push(`/meetings/room/${invite.meetingId}`);
    } catch (err) {
      console.error("Failed to join meeting:", err);
      setError("Failed to join meeting. Please try again.");
      setIsJoining(false);
    }
  };

  // Loading state
  if (invite === undefined) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <svg
            className="w-8 h-8 animate-spin text-cyan-500 mx-auto mb-3"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <p className="text-slate-400">Loading invite...</p>
        </div>
      </div>
    );
  }

  // Invite not found or meeting ended
  if (!invite || invite.meetingStatus === "ended") {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Branding */}
          <div className="text-center mb-8">
            <img
              src="/logo.gif"
              alt="IECentral"
              className="h-10 w-auto mx-auto mb-2"
            />
            <p className="text-slate-500 text-sm">IECentral Video Meetings</p>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 text-center shadow-xl">
            <div className="w-16 h-16 bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">
              {invite ? "Meeting Has Ended" : "Invite Not Found"}
            </h2>
            <p className="text-slate-400 mb-6">
              {invite
                ? "This meeting has already ended. Please contact the host for a new meeting link."
                : "This invite link is invalid or has expired. Please check with the meeting host for a new invite."}
            </p>
            <a
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 transition-colors font-medium"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
              Go Home
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Invite found — show join form
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="text-center mb-8">
          <img
            src="/logo.gif"
            alt="IECentral"
            className="h-10 w-auto mx-auto mb-2"
          />
          <p className="text-slate-500 text-sm">IECentral Video Meetings</p>
        </div>

        {/* Join Card */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-xl overflow-hidden">
          {/* Invite Header */}
          <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border-b border-slate-700 px-6 py-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-cyan-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                <svg
                  className="w-5 h-5 text-cyan-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 00-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm text-cyan-400 font-medium mb-0.5">
                  You&apos;ve been invited
                </p>
                <h1 className="text-lg font-semibold text-white">
                  {invite.meetingTitle}
                </h1>
              </div>
            </div>
            <p className="text-sm text-slate-400">
              Hosted by{" "}
              <span className="text-slate-300 font-medium">
                {invite.meetingHostName}
              </span>
            </p>

            {/* Status badge */}
            <div className="flex items-center gap-2 mt-3">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                {invite.meetingStatus === "active"
                  ? "In Progress"
                  : "Ready to Join"}
              </span>
            </div>
          </div>

          {/* Join Form */}
          <form onSubmit={handleJoin} className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Your Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Enter your name"
                required
                autoFocus
                className="w-full px-4 py-2.5 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Email{" "}
                <span className="text-slate-500 font-normal">(optional)</span>
              </label>
              <input
                type="email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full px-4 py-2.5 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-colors"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <svg
                  className="w-4 h-4 text-red-400 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isJoining || !guestName.trim()}
              className="w-full py-3 px-4 bg-cyan-500 hover:bg-cyan-600 disabled:bg-cyan-500/50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isJoining ? (
                <>
                  <svg
                    className="w-5 h-5 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Joining...
                </>
              ) : (
                <>
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  Join Meeting
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-600 mt-6">
          Import Export Tire Co. &mdash; IECentral Platform
        </p>
      </div>
    </div>
  );
}

export default function InviteJoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  return <InviteJoinContent token={token} />;
}
