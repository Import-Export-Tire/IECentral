// app/equipment/scanners/setup/SetupWizard.tsx
"use client";

import { useEffect, useRef, useCallback } from "react";
import { useSetupSession } from "./useSetupSession";
import { DeviceDetectStep } from "./steps/DeviceDetectStep";
import { LocationStep } from "./steps/LocationStep";
import { IdentityStep } from "./steps/IdentityStep";
import { GenerateStep } from "./steps/GenerateStep";
import { ManageStep } from "./steps/ManageStep";
import { InstallStep } from "./steps/InstallStep";
import { VerifyStep } from "./steps/VerifyStep";
import { DoneStep } from "./steps/DoneStep";
import { useTheme } from "../../../theme-context";

export function SetupWizard({ onClose }: { onClose: () => void }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const session = useSetupSession();

  // The WebAdbClient instance is stable across renders (and across reset), so
  // releasing through it works even after the reducer's connection ref is cleared.
  const clientRef = useRef(session.state.client);
  clientRef.current = session.state.client;

  // Release the WebUSB/ADB device, then close. Without this Chrome keeps the
  // interface claimed after the wizard closes or errors, so the next setup
  // attempt fails with "device in use by another program".
  const handleClose = useCallback(() => {
    clientRef.current?.disconnect().catch(() => {});
    onClose();
  }, [onClose]);

  // Safety net: release the device if the wizard unmounts for any reason.
  useEffect(() => {
    return () => {
      clientRef.current?.disconnect().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && session.state.step !== "install" && session.state.step !== "verify") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session.state.step, handleClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && session.state.step !== "install" && session.state.step !== "verify") handleClose();
      }}
    >
      <div
        className={`w-full max-w-2xl mx-4 rounded-2xl shadow-2xl overflow-hidden ${
          isDark ? "bg-slate-900 text-white border border-slate-700" : "bg-white text-black border border-gray-200"
        }`}
      >
        <header className={`px-6 py-4 border-b ${isDark ? "border-slate-800" : "border-gray-200"}`}>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{session.state.mode === "update" ? "Update Scanner" : "New Scanner Setup"}</h2>
            <button
              onClick={handleClose}
              disabled={session.state.step === "install" || session.state.step === "verify"}
              className={`text-sm ${isDark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-black"} disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              ✕
            </button>
          </div>
          <StepBreadcrumb current={session.state.step} mode={session.state.mode} isDark={isDark} />
        </header>

        <div className="px-6 py-5">
          {session.state.step === "detect" && <DeviceDetectStep session={session} />}
          {session.state.step === "location" && <LocationStep session={session} />}
          {session.state.step === "identity" && <IdentityStep session={session} />}
          {session.state.step === "generate" && <GenerateStep session={session} />}
          {session.state.step === "manage" && <ManageStep session={session} />}
          {session.state.step === "install" && <InstallStep session={session} />}
          {session.state.step === "verify" && <VerifyStep session={session} />}
          {session.state.step === "done" && <DoneStep session={session} onClose={handleClose} />}
          {session.state.step === "error" && (
            <div className="text-red-500">
              <p className="font-semibold mb-2">Setup failed</p>
              <p className="text-sm">{session.state.error}</p>
              <button
                onClick={() => {
                  clientRef.current?.disconnect().catch(() => {});
                  session.actions.reset();
                }}
                className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
              >
                Start over
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const NEW_STEPS: Array<{ key: string; label: string }> = [
  { key: "detect", label: "Detect" },
  { key: "location", label: "Location" },
  { key: "identity", label: "Identity" },
  { key: "generate", label: "Generate" },
  { key: "install", label: "Install" },
  { key: "verify", label: "Verify" },
  { key: "done", label: "Done" },
];

const UPDATE_STEPS: Array<{ key: string; label: string }> = [
  { key: "detect", label: "Detect" },
  { key: "manage", label: "Manage" },
  { key: "install", label: "Install" },
  { key: "verify", label: "Verify" },
  { key: "done", label: "Done" },
];

function StepBreadcrumb({ current, mode, isDark }: { current: string; mode: "new" | "update"; isDark: boolean }) {
  const STEP_ORDER = mode === "update" ? UPDATE_STEPS : NEW_STEPS;
  const currentIndex = STEP_ORDER.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-1 mt-3 text-xs">
      {STEP_ORDER.map((s, i) => (
        <li
          key={s.key}
          className={`px-2 py-0.5 rounded-md ${
            i === currentIndex
              ? isDark ? "bg-blue-500/20 text-blue-300" : "bg-blue-100 text-blue-700"
              : i < currentIndex
              ? isDark ? "text-slate-500" : "text-gray-400"
              : isDark ? "text-slate-600" : "text-gray-300"
          }`}
        >
          {s.label}
        </li>
      ))}
    </ol>
  );
}
