"use client";

import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSetupSession } from "../useSetupSession";

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
      <h3 className="text-base font-semibold">Scanner identity</h3>

      <div>
        <label className="block text-xs uppercase tracking-wider opacity-70 mb-1">Scanner number</label>
        <input
          value={scannerNumber}
          onChange={(e) => setScannerNumber(e.target.value)}
          placeholder={next ?? "Loading next free…"}
          className="w-full px-3 py-2 rounded-lg border border-current/20 bg-transparent text-sm font-mono"
        />
        <p className="text-xs opacity-60 mt-1">
          Auto-suggested: <span className="font-mono">{next ?? "…"}</span>
        </p>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider opacity-70 mb-1">RT Device ID</label>
        <input
          value={rtDeviceId}
          onChange={(e) => setRtDeviceId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-current/20 bg-transparent text-sm font-mono"
        />
        <p className="text-xs opacity-60 mt-1">Defaults to 0001. Override only if multiple scanners share an RT account.</p>
      </div>

      <div className="flex justify-between pt-2">
        <button
          onClick={() => session.actions.goToStep("location")}
          className="text-sm opacity-60 hover:opacity-100"
        >
          ← Back
        </button>
        <button
          onClick={handleContinue}
          disabled={!ready}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
