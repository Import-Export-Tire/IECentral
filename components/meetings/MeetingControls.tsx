"use client";

import { useState } from "react";
import { useTheme } from "@/app/theme-context";

interface MeetingControlsProps {
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  toggleAudio: () => void;
  toggleVideo: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => Promise<void>;
  onEndCall: () => void;
  isNotedMeeting: boolean;
  onToggleNotedMeeting: () => void;
  isHost: boolean;
  participantCount: number;
  onToggleParticipantList?: () => void;
  showParticipantList?: boolean;
  // Remote control props
  someoneElseIsScreenSharing?: boolean;
  screenSharerParticipantId?: string | null;
  hasRemoteControl?: boolean;
  activeControllerName?: string | null;
  onRequestControl?: (targetParticipantId: string) => void;
  onReleaseControl?: () => void;
  onRevokeControl?: () => void;
  // Virtual background
  isBackgroundEnabled?: boolean;
  isBackgroundLoading?: boolean;
  onToggleBackground?: () => void;
}

function ControlButton({
  onClick,
  active,
  danger,
  tooltip,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  tooltip: string;
  children: React.ReactNode;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  let className =
    "relative group flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full transition-colors ";

  if (danger) {
    className += "bg-red-600 hover:bg-red-700 text-white";
  } else if (active === false) {
    // Explicitly off (muted / camera off)
    className += "bg-red-500/20 text-red-400 hover:bg-red-500/30";
  } else {
    className += isDark
      ? "bg-slate-700 text-white hover:bg-slate-600"
      : "bg-gray-200 text-gray-700 hover:bg-gray-300";
  }

  return (
    <button onClick={onClick} className={className} type="button">
      {children}
      <span
        className="absolute -top-9 left-1/2 -translate-x-1/2 px-2 py-1 rounded text-xs whitespace-nowrap
          bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
      >
        {tooltip}
      </span>
    </button>
  );
}

export default function MeetingControls({
  isAudioEnabled,
  isVideoEnabled,
  isScreenSharing,
  toggleAudio,
  toggleVideo,
  startScreenShare,
  stopScreenShare,
  onEndCall,
  isNotedMeeting,
  onToggleNotedMeeting,
  isHost,
  participantCount,
  onToggleParticipantList,
  showParticipantList,
  someoneElseIsScreenSharing,
  screenSharerParticipantId,
  hasRemoteControl,
  activeControllerName,
  onRequestControl,
  onReleaseControl,
  onRevokeControl,
  isBackgroundEnabled,
  isBackgroundLoading,
  onToggleBackground,
}: MeetingControlsProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 flex flex-wrap items-center justify-center gap-3 sm:gap-4 px-4 py-3 sm:py-4 ${
        isDark
          ? "bg-slate-900/95 border-t border-slate-700"
          : "bg-white/95 border-t border-gray-200 shadow-lg"
      } backdrop-blur-sm`}
    >
      {/* Mute */}
      <ControlButton
        onClick={toggleAudio}
        active={isAudioEnabled}
        tooltip={isAudioEnabled ? "Mute" : "Unmute"}
      >
        {isAudioEnabled ? (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
          </svg>
        )}
      </ControlButton>

      {/* Camera */}
      <ControlButton
        onClick={toggleVideo}
        active={isVideoEnabled}
        tooltip={isVideoEnabled ? "Turn off camera" : "Turn on camera"}
      >
        {isVideoEnabled ? (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        )}
      </ControlButton>

      {/* Screen Share */}
      <ControlButton
        onClick={isScreenSharing ? stopScreenShare : startScreenShare}
        active={isScreenSharing ? true : undefined}
        tooltip={isScreenSharing ? "Stop sharing" : "Share screen"}
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        {isScreenSharing && (
          <span className="absolute top-0 right-0 w-3 h-3 bg-cyan-400 rounded-full animate-pulse" />
        )}
      </ControlButton>

      {/* Noted Meeting Toggle */}
      {isHost && (
        <ControlButton
          onClick={onToggleNotedMeeting}
          active={isNotedMeeting ? true : undefined}
          tooltip={isNotedMeeting ? "Stop noting" : "Start noting"}
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          {isNotedMeeting && (
            <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          )}
        </ControlButton>
      )}

      {/* Remote Control: Request / Release / Revoke */}
      {someoneElseIsScreenSharing && !hasRemoteControl && screenSharerParticipantId && onRequestControl && (
        <ControlButton
          onClick={() => onRequestControl(screenSharerParticipantId)}
          tooltip="Request remote control"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
          </svg>
        </ControlButton>
      )}

      {hasRemoteControl && onReleaseControl && (
        <ControlButton
          onClick={onReleaseControl}
          active={true}
          tooltip="Release remote control"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
          </svg>
          <span className="absolute top-0 right-0 w-3 h-3 bg-cyan-400 rounded-full animate-pulse" />
        </ControlButton>
      )}

      {isScreenSharing && activeControllerName && onRevokeControl && (
        <ControlButton
          onClick={onRevokeControl}
          active={true}
          tooltip={`${activeControllerName} controlling — click to revoke`}
        >
          <div className="relative">
            <svg className="w-6 h-6 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
            </svg>
            <span className="absolute top-0 right-0 w-3 h-3 bg-orange-400 rounded-full animate-pulse" />
          </div>
        </ControlButton>
      )}

      {/* Participants */}
      <ControlButton
        onClick={onToggleParticipantList ?? (() => {})}
        active={showParticipantList ? true : undefined}
        tooltip={`Participants (${participantCount})`}
      >
        <div className="relative">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          <span
            className={`absolute -top-2 -right-2 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold ${
              isDark ? "bg-cyan-500 text-white" : "bg-blue-600 text-white"
            }`}
          >
            {participantCount}
          </span>
        </div>
      </ControlButton>

      {/* Virtual Background */}
      {onToggleBackground && (
        <ControlButton onClick={onToggleBackground} active={isBackgroundEnabled} tooltip={isBackgroundLoading ? "Loading..." : isBackgroundEnabled ? "Remove background" : "IE background"}>
          {isBackgroundLoading ? (
            <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          )}
        </ControlButton>
      )}

      {/* End Call */}
      <ControlButton onClick={onEndCall} danger tooltip="Leave call">
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z"
          />
        </svg>
      </ControlButton>
    </div>
  );
}
