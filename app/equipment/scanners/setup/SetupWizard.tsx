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
import Button from "@/components/ui/Button";

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

  // isDark is consumed only for the breadcrumb; suppress the lint warning
  void isDark;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && session.state.step !== "install" && session.state.step !== "verify") handleClose();
      }}
    >
      <div className="w-full max-w-2xl theme-card rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <header className="px-6 py-4 border-b theme-border-secondary">
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-semibold theme-text-primary">
              {session.state.mode === "update" ? "Update Scanner" : "New Scanner Setup"}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              disabled={session.state.step === "install" || session.state.step === "verify"}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Button>
          </div>
          <StepBreadcrumb current={session.state.step} mode={session.state.mode} />
        </header>

        {/* Body */}
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
            <div className="space-y-3">
              <p className="text-sm font-semibold text-red-500">Setup failed</p>
              <p className="text-sm theme-text-secondary">{session.state.error}</p>
              <Button
                variant="primary"
                onClick={() => {
                  clientRef.current?.disconnect().catch(() => {});
                  session.actions.reset();
                }}
              >
                Start over
              </Button>
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

function StepBreadcrumb({ current, mode }: { current: string; mode: "new" | "update" }) {
  const STEP_ORDER = mode === "update" ? UPDATE_STEPS : NEW_STEPS;
  const currentIndex = STEP_ORDER.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-1 mt-3 text-xs">
      {STEP_ORDER.map((s, i) => (
        <li
          key={s.key}
          className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
            i === currentIndex
              ? "theme-accent-primary"
              : i < currentIndex
              ? "theme-text-tertiary"
              : "theme-text-tertiary opacity-40"
          }`}
          style={i === currentIndex ? { background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)" } : undefined}
        >
          {s.label}
        </li>
      ))}
    </ol>
  );
}
