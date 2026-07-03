"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/app/auth-context";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useMediaStream } from "@/lib/webrtc/useMediaStream";
import { usePeerConnections } from "@/lib/webrtc/usePeerConnections";
import { useRemoteControl } from "@/lib/webrtc/useRemoteControl";
import { useMediaRecorder } from "@/lib/webrtc/useMediaRecorder";
import { useVirtualBackground } from "@/lib/webrtc/useVirtualBackground";
import VideoGrid from "@/components/meetings/VideoGrid";
import MeetingControls from "@/components/meetings/MeetingControls";
import { ControlRequestModal, ControlGrantedNotification } from "@/components/meetings/ControlRequestModal";
import Button from "@/components/ui/Button";

export default function MeetingRoomPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();

  const meetingId = params.meetingId as string;
  const typedMeetingId = meetingId as unknown as Id<"meetings">;

  // Convex queries
  const meeting = useQuery(api.meetings.get, { meetingId: typedMeetingId });
  const participants = useQuery(api.meetingParticipants.getByMeeting, {
    meetingId: typedMeetingId,
  });
  const myParticipant = useQuery(
    api.meetingParticipants.getMyParticipant,
    user ? { userId: user._id, meetingId: typedMeetingId } : "skip"
  );

  // Convex mutations
  const joinMeeting = useMutation(api.meetingParticipants.join);
  const leaveMeeting = useMutation(api.meetingParticipants.leave);
  const endMeeting = useMutation(api.meetings.end);
  const updateMediaState = useMutation(
    api.meetingParticipants.updateMediaState
  );
  const toggleNotedMeeting = useMutation(api.meetings.updateNotedMeeting);

  // Meeting notes mutations/actions
  const createMeetingNotes = useMutation(api.meetingNotes.create);
  const updateNoteStatus = useMutation(api.meetingNotes.updateStatus);
  const updateAudioFile = useMutation(api.meetingNotes.updateAudioFile);
  const updateAudioS3Key = useMutation(api.meetingNotes.updateAudioS3Key);
  const generateUploadUrl = useMutation(api.meetingNotes.generateUploadUrl);
  const transcribeAndGenerateNotes = useAction(api.meetingNoteActions.transcribeAndGenerateNotes);

  // Invite action
  const sendInviteEmail = useAction(api.meetingInviteActions.sendInviteEmail);
  const meetingInvites = useQuery(
    api.meetingInvites.getByMeeting,
    meeting ? { meetingId: typedMeetingId } : "skip"
  );

  // Local state
  const [hasJoined, setHasJoined] = useState(false);
  const [showParticipantList, setShowParticipantList] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Media
  const {
    localStream,
    isAudioEnabled,
    isVideoEnabled,
    isScreenSharing,
    toggleAudio,
    toggleVideo,
    startScreenShare,
    stopScreenShare,
    cleanup,
  } = useMediaStream();

  // Virtual background
  const virtualBg = useVirtualBackground();
  const [bgStream, setBgStream] = useState<MediaStream | null>(null);

  const handleToggleBackground = useCallback(async () => {
    if (virtualBg.enabled) {
      virtualBg.removeBackground();
      setBgStream(null);
    } else if (localStream) {
      const processed = await virtualBg.applyBackground(localStream);
      setBgStream(processed);
    }
  }, [virtualBg, localStream]);

  // Use background stream if enabled, otherwise raw localStream
  const activeStream = bgStream || localStream;

  // Peer connections — only initialize when we have the participant record
  const { remoteStreams, peerConnections } = usePeerConnections({
    localStream: activeStream,
    myParticipantId: (myParticipant?._id ?? null) as unknown as Id<"meetingParticipants">,
    meetingId: typedMeetingId,
    participants: (participants ?? []) as any[],
  });

  // Noted meeting recording state
  const [isNotedRecording, setIsNotedRecording] = useState(false);
  const [meetingNotesId, setMeetingNotesId] = useState<Id<"meetingNotes"> | null>(null);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);

  // Remote control
  const myDisplayName =
    myParticipant?.displayName || user?.name || "Participant";

  const remoteControl = useRemoteControl({
    peerConnections,
    myParticipantId: String(myParticipant?._id ?? ""),
    myDisplayName,
    isScreenSharing,
  });

  const [showControlGranted, setShowControlGranted] = useState(false);

  // Show notification when control is granted to the viewer
  useEffect(() => {
    if (remoteControl.controlGranted) {
      setShowControlGranted(true);
    }
  }, [remoteControl.controlGranted]);

  // Media recorder for noted meetings
  const { audioBlob, recordingDuration } = useMediaRecorder({
    localStream,
    remoteStreams,
    isRecording: isNotedRecording,
  });

  // Start recording when noted meeting becomes active
  useEffect(() => {
    if (
      meeting?.isNotedMeeting &&
      meeting?.status === "active" &&
      hasJoined &&
      !isNotedRecording &&
      !meetingNotesId
    ) {
      // Create notes record and start recording
      createMeetingNotes({ meetingId: typedMeetingId })
        .then((notesId) => {
          setMeetingNotesId(notesId);
          setIsNotedRecording(true);
        })
        .catch((err) => {
          console.error("Failed to create meeting notes:", err);
        });
    }
  }, [meeting?.isNotedMeeting, meeting?.status, hasJoined, isNotedRecording, meetingNotesId, createMeetingNotes, typedMeetingId]);

  // Handle audio blob ready after recording stops — upload and trigger pipeline
  useEffect(() => {
    if (!audioBlob || !meetingNotesId || isUploadingAudio) return;

    async function uploadAndProcess() {
      setIsUploadingAudio(true);
      try {
        await updateNoteStatus({
          notesId: meetingNotesId!,
          status: "uploading",
        });

        // Upload audio to S3 (avoids Convex storage limits)
        const presignRes = await fetch("/api/meetings/upload-audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meetingId: typedMeetingId, filename: "audio.webm" }),
        });
        if (!presignRes.ok) throw new Error("Failed to get S3 upload URL");
        const { url: s3UploadUrl, key: s3Key } = await presignRes.json();

        const uploadResponse = await fetch(s3UploadUrl, {
          method: "PUT",
          body: audioBlob,
        });
        if (!uploadResponse.ok) throw new Error("Failed to upload audio to S3");

        // Update notes with S3 key reference
        await updateAudioS3Key({
          notesId: meetingNotesId!,
          audioS3Key: s3Key,
          duration: recordingDuration,
        });

        // Get a presigned download URL for the audio (so Convex action doesn't need S3 SDK)
        const downloadRes = await fetch("/api/meetings/upload-audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "download", meetingId: typedMeetingId, filename: "audio.webm" }),
        });
        const { url: audioDownloadUrl } = await downloadRes.json();

        // Trigger transcription + AI pipeline
        await transcribeAndGenerateNotes({
          notesId: meetingNotesId!,
          meetingId: typedMeetingId,
          audioDownloadUrl,
        });
      } catch (err) {
        console.error("Failed to upload audio or trigger processing:", err);
        if (meetingNotesId) {
          await updateNoteStatus({
            notesId: meetingNotesId,
            status: "error",
            errorMessage: err instanceof Error ? err.message : "Upload failed",
          }).catch(() => {});
        }
      } finally {
        setIsUploadingAudio(false);
      }
    }

    uploadAndProcess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioBlob, meetingNotesId]);

  // Join meeting on mount
  const startMeeting = useMutation(api.meetings.start);
  const joiningRef = useRef(false);

  useEffect(() => {
    if (hasJoined || !user || !meeting || joiningRef.current) return;

    // Meeting already ended
    if (meeting.status === "ended") {
      setError("This meeting has ended.");
      return;
    }

    joiningRef.current = true;

    async function join() {
      try {
        const isHost = String(meeting!.hostId) === String(user!._id);
        if (isHost && (meeting!.status === "lobby" || meeting!.status === "scheduled")) {
          await startMeeting({ meetingId: typedMeetingId });
        }
        await joinMeeting({ meetingId: typedMeetingId, userId: user!._id });
        setHasJoined(true);
      } catch (err) {
        console.error("Failed to join meeting:", err);
        joiningRef.current = false;
        setError("Failed to join meeting. Please try refreshing the page.");
      }
    }

    join();
  }, [user, meeting, hasJoined, joinMeeting, startMeeting, typedMeetingId]);

  // Sync media state to Convex (debounced to avoid rapid mutation calls)
  const mediaStateRef = useRef({ isAudioEnabled, isVideoEnabled, isScreenSharing });
  mediaStateRef.current = { isAudioEnabled, isVideoEnabled, isScreenSharing };

  useEffect(() => {
    if (!myParticipant) return;
    const timer = setTimeout(() => {
      updateMediaState({
        participantId: myParticipant._id,
        isMuted: !mediaStateRef.current.isAudioEnabled,
        isCameraOff: !mediaStateRef.current.isVideoEnabled,
        isScreenSharing: mediaStateRef.current.isScreenSharing,
      }).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [isAudioEnabled, isVideoEnabled, isScreenSharing, myParticipant, updateMediaState]);

  // Handle leaving
  const handleLeave = useCallback(async () => {
    try {
      if (myParticipant) {
        await leaveMeeting({ participantId: myParticipant._id });
      }
    } catch {
      // Best-effort
    }
    cleanup();
    router.push("/meetings");
  }, [myParticipant, leaveMeeting, cleanup, router]);

  // Handle end call (host)
  const handleEndCall = useCallback(async () => {
    // Stop noted meeting recording before leaving
    if (isNotedRecording) {
      setIsNotedRecording(false);
    }

    if (!user || !meeting) {
      await handleLeave();
      return;
    }

    const isHost =
      meeting.hostId && String(meeting.hostId) === String(user._id);

    if (isHost) {
      try {
        await endMeeting({ meetingId: typedMeetingId });
      } catch {
        // Best-effort
      }
    }

    // If we have a noted meeting, wait briefly for recording to finalize
    // The audioBlob effect will handle uploading
    if (meeting.isNotedMeeting && meetingNotesId) {
      // Small delay to let MediaRecorder finalize
      await new Promise((r) => setTimeout(r, 500));
    }

    await handleLeave();
  }, [user, meeting, endMeeting, typedMeetingId, handleLeave, isNotedRecording, meetingNotesId]);

  // Handle noted meeting toggle
  const handleToggleNotedMeeting = useCallback(async () => {
    if (!meeting) return;
    try {
      await toggleNotedMeeting({
        meetingId: typedMeetingId,
        isNotedMeeting: !meeting.isNotedMeeting,
      });
    } catch (err) {
      console.error("Failed to toggle noted meeting:", err);
    }
  }, [meeting, toggleNotedMeeting, typedMeetingId]);

  // Handle sending email invite
  const handleSendInvite = useCallback(async () => {
    if (!inviteEmail.trim()) return;
    setInviteSending(true);
    setInviteError(null);
    setInviteSuccess(null);

    try {
      await sendInviteEmail({
        meetingId: typedMeetingId,
        email: inviteEmail.trim(),
        name: inviteName.trim() || undefined,
      });
      setInviteSuccess(`Invite sent to ${inviteEmail.trim()}`);
      setInviteName("");
      setInviteEmail("");
    } catch (err) {
      console.error("Failed to send invite:", err);
      setInviteError("Failed to send invite. Please try again.");
    } finally {
      setInviteSending(false);
    }
  }, [inviteEmail, inviteName, sendInviteEmail, typedMeetingId]);

  const handleCopyCode = useCallback(() => {
    if (!meeting?.joinCode) return;
    navigator.clipboard.writeText(meeting.joinCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  }, [meeting?.joinCode]);

  const handleCopyUrl = useCallback(() => {
    if (!meeting?.joinCode) return;
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    navigator.clipboard.writeText(`${baseUrl}/join/${meeting.joinCode}`);
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 2000);
  }, [meeting?.joinCode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect meeting ended by host
  useEffect(() => {
    if (meeting && meeting.status === "ended" && hasJoined) {
      cleanup();
      router.push("/meetings");
    }
  }, [meeting, hasJoined, cleanup, router]);

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900">
        <div className="text-center theme-card p-8 max-w-md">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
            {error}
          </h2>
          <Button variant="primary" onClick={() => router.push("/meetings")}>
            Back to Meetings
          </Button>
        </div>
      </div>
    );
  }

  // Loading state — wait for meeting data; participant record will come reactively
  if (!meeting || !hasJoined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#007AFF] mx-auto mb-4" />
          <p className="text-gray-500 dark:text-slate-400">
            Joining meeting...
          </p>
        </div>
      </div>
    );
  }

  const isHost =
    meeting.hostId && String(meeting.hostId) === String(user?._id);

  // Build participant list with display names and media state
  const enrichedParticipants = (participants ?? []).map((p: any) => ({
    ...p,
    displayName:
      p.displayName || p.guestName || (p.userId === user?._id ? user?.name : "Participant"),
  }));

  // Remote control: find the screen sharer (if it is someone else)
  const screenSharer = enrichedParticipants.find(
    (p: any) => p.isScreenSharing && String(p._id) !== String(myParticipant?._id)
  );
  const someoneElseIsScreenSharing = !!screenSharer;

  return (
    <div className="h-screen flex flex-col bg-gray-100 dark:bg-slate-900">
      {/* Top bar — minimal */}
      <div className="flex items-center justify-between px-4 py-2 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border-b border-gray-200/70 dark:border-slate-700/60 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={handleLeave}
            className="p-1.5 rounded-lg transition-colors text-gray-500 hover:bg-gray-200 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <h1 className="text-sm font-semibold truncate text-gray-900 dark:text-white">
            {meeting.title}
          </h1>
          {meeting.isNotedMeeting && (
            <span className="flex items-center gap-1 text-xs font-medium text-red-500 dark:text-red-400">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              Noting
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {meeting.joinCode && (
            <span className="text-xs font-mono text-gray-400 dark:text-slate-500">
              {meeting.joinCode}
            </span>
          )}
          {isHost && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowInviteModal(true)}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              Invite
            </Button>
          )}
        </div>
      </div>

      {/* Video area */}
      <div className="flex-1 min-h-0 p-2 sm:p-4 pb-20 sm:pb-24">
        <VideoGrid
          localStream={activeStream}
          remoteStreams={remoteStreams}
          participants={enrichedParticipants}
          myParticipantId={String(myParticipant?._id ?? "")}
          remoteControl={{
            hasControl: remoteControl.hasControl,
            controlTarget: remoteControl.controlTarget,
            onMouseMove: remoteControl.onMouseMove,
            onMouseDown: remoteControl.onMouseDown,
            onMouseUp: remoteControl.onMouseUp,
            onKeyDown: remoteControl.onKeyDown,
            onKeyUp: remoteControl.onKeyUp,
            onWheel: remoteControl.onWheel,
            releaseControl: remoteControl.releaseControl,
            activeController: remoteControl.activeController,
            activeControllerName: remoteControl.activeControllerName,
            remoteCursorPosition: remoteControl.remoteCursorPosition,
            incomingRemoteEvents: remoteControl.incomingRemoteEvents,
            revokeControl: remoteControl.revokeControl,
            isScreenSharing,
          }}
        />
      </div>

      {/* Participant side panel */}
      {showParticipantList && (
        <div className="fixed top-0 right-0 bottom-0 w-full sm:w-72 z-40 border-l shadow-xl bg-white border-gray-200 dark:bg-slate-800 dark:border-slate-700">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700">
            <h3 className="font-semibold text-gray-900 dark:text-white">
              Participants ({(participants ?? []).length})
            </h3>
            <button
              onClick={() => setShowParticipantList(false)}
              className="p-1 rounded text-gray-500 hover:bg-gray-200 dark:text-slate-400 dark:hover:bg-slate-700"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-3 space-y-2 overflow-y-auto max-h-[calc(100vh-60px)]">
            {enrichedParticipants.map((p: any) => (
              <div
                key={String(p._id)}
                className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-slate-700/50"
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white ${
                    p.userId === user?._id ? "bg-[#007AFF]" : "bg-slate-500"
                  }`}
                >
                  {(p.displayName || "?")
                    .split(" ")
                    .map((w: string) => w[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate text-gray-900 dark:text-white">
                    {p.displayName}
                    {p.userId === user?._id && " (You)"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {p.isMuted && (
                    <svg
                      className="w-4 h-4 text-red-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                      />
                    </svg>
                  )}
                  {p.isCameraOff && (
                    <svg
                      className="w-4 h-4 text-red-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                      />
                    </svg>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              setShowInviteModal(false);
              setInviteSuccess(null);
              setInviteError(null);
            }}
          />
          {/* Modal */}
          <div className="relative w-full max-w-lg rounded-2xl border shadow-2xl bg-white border-gray-200 dark:bg-slate-800 dark:border-slate-700">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Invite to Meeting
              </h2>
              <button
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteSuccess(null);
                  setInviteError(null);
                }}
                className="p-1.5 rounded-lg transition-colors text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700"
              >
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
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">
              {/* Join Code */}
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-slate-300">
                  Join Code
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center justify-center py-3 rounded-lg font-mono text-2xl font-bold tracking-[0.3em] bg-gray-50 text-[#007AFF] border border-gray-200 dark:bg-slate-900 dark:text-cyan-400 dark:border-slate-700">
                    {meeting.joinCode}
                  </div>
                  <button
                    onClick={handleCopyCode}
                    className={`px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                      codeCopied
                        ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                    }`}
                  >
                    {codeCopied ? (
                      <>
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
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        Copied
                      </>
                    ) : (
                      <>
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
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                          />
                        </svg>
                        Copy
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Join URL */}
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-slate-300">
                  Join URL
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2.5 rounded-lg text-sm truncate bg-gray-50 text-gray-600 border border-gray-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700">
                    {typeof window !== "undefined"
                      ? `${window.location.origin}/join/${meeting.joinCode}`
                      : `/join/${meeting.joinCode}`}
                  </div>
                  <button
                    onClick={handleCopyUrl}
                    className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                      urlCopied
                        ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                    }`}
                  >
                    {urlCopied ? (
                      <>
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
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        Copied
                      </>
                    ) : (
                      <>
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
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                          />
                        </svg>
                        Copy
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200 dark:border-slate-700" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-3 bg-white text-gray-400 dark:bg-slate-800 dark:text-slate-500">
                    or send an email invite
                  </span>
                </div>
              </div>

              {/* Email Invite Form */}
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-slate-300">
                    Name{" "}
                    <span className="font-normal text-gray-400 dark:text-slate-500">
                      (optional)
                    </span>
                  </label>
                  <input
                    type="text"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Guest name"
                    className="w-full px-3 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 transition-colors bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-[#007AFF]/50 focus:border-[#007AFF] dark:bg-slate-900 dark:border-slate-700 dark:text-white dark:placeholder-slate-500 dark:focus:ring-cyan-500/50 dark:focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-slate-300">
                    Email <span className="text-red-500 dark:text-red-400">*</span>
                  </label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="guest@example.com"
                    className="w-full px-3 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 transition-colors bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-[#007AFF]/50 focus:border-[#007AFF] dark:bg-slate-900 dark:border-slate-700 dark:text-white dark:placeholder-slate-500 dark:focus:ring-cyan-500/50 dark:focus:border-cyan-500"
                  />
                </div>

                {inviteSuccess && (
                  <div className="ui-callout-green rounded-lg flex items-center gap-2 p-3">
                    <svg
                      className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <p className="text-sm text-emerald-600 dark:text-emerald-400">{inviteSuccess}</p>
                  </div>
                )}

                {inviteError && (
                  <div className="ui-callout-red rounded-lg flex items-center gap-2 p-3">
                    <svg
                      className="w-4 h-4 text-red-500 dark:text-red-400 flex-shrink-0"
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
                    <p className="text-sm text-red-500 dark:text-red-400">{inviteError}</p>
                  </div>
                )}

                <Button
                  variant="primary"
                  onClick={handleSendInvite}
                  disabled={inviteSending || !inviteEmail.trim()}
                  className="w-full"
                >
                  {inviteSending ? (
                    <>
                      <svg
                        className="w-4 h-4 animate-spin"
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
                      Sending...
                    </>
                  ) : (
                    <>
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
                          d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                        />
                      </svg>
                      Send Email Invite
                    </>
                  )}
                </Button>
              </div>

              {/* Sent Invites List */}
              {meetingInvites && meetingInvites.length > 0 && (
                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-slate-300">
                    Sent Invites
                  </label>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {meetingInvites.map((inv: any) => (
                      <div
                        key={String(inv._id)}
                        className="flex items-center justify-between px-3 py-2 rounded-lg text-sm bg-gray-50 dark:bg-slate-900/50"
                      >
                        <div className="min-w-0">
                          <span className="truncate block text-gray-700 dark:text-slate-300">
                            {inv.name ? `${inv.name} (${inv.email})` : inv.email}
                          </span>
                        </div>
                        <span
                          className={`ml-2 flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
                            inv.status === "joined"
                              ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                              : inv.status === "opened"
                              ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                              : "bg-slate-500/20 text-slate-500 dark:text-slate-400"
                          }`}
                        >
                          {inv.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <MeetingControls
        isAudioEnabled={isAudioEnabled}
        isVideoEnabled={isVideoEnabled}
        isScreenSharing={isScreenSharing}
        toggleAudio={toggleAudio}
        toggleVideo={toggleVideo}
        startScreenShare={startScreenShare}
        stopScreenShare={stopScreenShare}
        onEndCall={handleEndCall}
        isNotedMeeting={meeting.isNotedMeeting ?? false}
        onToggleNotedMeeting={handleToggleNotedMeeting}
        isHost={!!isHost}
        participantCount={(participants ?? []).length}
        onToggleParticipantList={() =>
          setShowParticipantList(!showParticipantList)
        }
        showParticipantList={showParticipantList}
        someoneElseIsScreenSharing={someoneElseIsScreenSharing}
        screenSharerParticipantId={screenSharer ? String(screenSharer._id) : null}
        hasRemoteControl={remoteControl.hasControl}
        activeControllerName={remoteControl.activeControllerName}
        onRequestControl={remoteControl.requestControl}
        onReleaseControl={remoteControl.releaseControl}
        onRevokeControl={remoteControl.revokeControl}
        isBackgroundEnabled={virtualBg.enabled}
        isBackgroundLoading={virtualBg.loading}
        onToggleBackground={handleToggleBackground}
      />

      {/* Remote Control: Request modals for the screen sharer */}
      {remoteControl.controlRequests.length > 0 && (
        <ControlRequestModal
          request={remoteControl.controlRequests[0]}
          onGrant={remoteControl.grantControl}
          onDeny={remoteControl.denyControl}
        />
      )}

      {/* Remote Control: Granted notification for the viewer */}
      {showControlGranted && remoteControl.controlGranted && (
        <ControlGrantedNotification
          onDismiss={() => setShowControlGranted(false)}
        />
      )}
    </div>
  );
}
