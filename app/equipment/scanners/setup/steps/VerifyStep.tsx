"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSetupSession } from "../useSetupSession";

type Session = ReturnType<typeof useSetupSession>;

const TIMEOUT_MS = 60_000;

export function VerifyStep({ session }: { session: Session }) {
  // Query the scanner detail to poll for isOnline status
  const scanner = useQuery(
    api.scannerMdm.getScannerDetail,
    session.state.scannerId ? { id: session.state.scannerId } : "skip",
  );

  const [elapsed, setElapsed] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => {
      const dt = Date.now() - start;
      setElapsed(dt);
      if (dt >= TIMEOUT_MS) {
        setTimedOut(true);
        clearInterval(t);
      }
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (scanner?.isOnline) {
      session.actions.goToStep("done");
    }
  }, [scanner?.isOnline, session.actions]);

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">Waiting for Scanner Agent to connect</h3>
      <div className="space-y-2 text-sm">
        <p>On the scanner, type this code into the Scanner Agent setup screen:</p>
        <div className="text-3xl font-mono font-bold tracking-[0.3em] text-blue-500 text-center py-3 rounded-lg bg-blue-500/10">
          {session.state.provisionCode}
        </div>
        <p className="opacity-70">Once entered, the agent will connect to AWS IoT and you'll see "Online" below.</p>
      </div>

      <div className="text-xs opacity-60">
        Status: {scanner?.isOnline ? "✓ Online" : `Waiting… (${Math.round(elapsed / 1000)}s)`}
      </div>

      {timedOut && !scanner?.isOnline && (
        <div className="text-amber-500 text-sm space-y-2">
          <p>Couldn't verify within 60 seconds.</p>
          <p>The scanner is still provisionable from its detail page — the operator can type the code anytime in the next hour.</p>
          <button
            onClick={() => session.actions.goToStep("done")}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
          >
            Mark setup done anyway
          </button>
        </div>
      )}
    </div>
  );
}
