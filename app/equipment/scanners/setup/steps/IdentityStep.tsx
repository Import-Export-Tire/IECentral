"use client";

import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSetupSession } from "../useSetupSession";
import Button from "@/components/ui/Button";

type Session = ReturnType<typeof useSetupSession>;

export function IdentityStep({ session }: { session: Session }) {
  const next = useQuery(
    api.scannerMdm.getNextScannerNumber,
    session.state.locationCode ? { locationCode: session.state.locationCode } : "skip",
  );
  const [scannerNumber, setScannerNumber] = useState(session.state.scannerNumber ?? "");
  const [rtDeviceId, setRtDeviceId] = useState(session.state.rtDeviceId);

  useEffect(() => {
    if (next && !scannerNumber) setScannerNumber(next);
  }, [next, scannerNumber]);

  const ready = scannerNumber.length > 0 && rtDeviceId.length > 0;

  const handleContinue = () => {
    session.actions.setIdentity(scannerNumber, rtDeviceId);
    session.actions.goToStep("generate");
  };

  return (
    <div className="space-y-4">
      <h3 className="text-[15px] font-semibold theme-text-primary">Scanner identity</h3>

      <div>
        <label className="block text-xs font-medium uppercase tracking-wider theme-text-tertiary mb-1">
          Scanner number
        </label>
        <input
          value={scannerNumber}
          onChange={(e) => setScannerNumber(e.target.value)}
          placeholder={next ?? "Loading next free…"}
          className="theme-input w-full px-3 py-2 text-sm font-mono"
        />
        <p className="text-xs theme-text-tertiary mt-1">
          Auto-suggested: <span className="font-mono">{next ?? "…"}</span>
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium uppercase tracking-wider theme-text-tertiary mb-1">
          RT Device ID
        </label>
        <input
          value={rtDeviceId}
          onChange={(e) => setRtDeviceId(e.target.value)}
          className="theme-input w-full px-3 py-2 text-sm font-mono"
        />
        <p className="text-xs theme-text-tertiary mt-1">
          Defaults to 0001. Override only if multiple scanners share an RT account.
        </p>
      </div>

      <div className="flex items-center justify-between pt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => session.actions.goToStep("location")}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </Button>
        <Button
          variant="primary"
          onClick={handleContinue}
          disabled={!ready}
        >
          Continue
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Button>
      </div>
    </div>
  );
}
