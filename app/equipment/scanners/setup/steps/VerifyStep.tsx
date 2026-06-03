"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSetupSession } from "../useSetupSession";

type Session = ReturnType<typeof useSetupSession>;

const TIMEOUT_MS = 120_000;

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
      <h3 className="text-base font-semibold">Last step — finish on the scanner</h3>
      <div className="space-y-3 text-sm">
        <p>
          The <b>IE Scanner Agent · Setup</b> screen is now open <span className="opacity-70">on the
          handheld scanner</span>. On the scanner:
        </p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Type this code into the box and tap <b>Submit</b>:</li>
        </ol>
        <div className="text-3xl font-mono font-bold tracking-[0.3em] text-blue-500 text-center py-3 rounded-lg bg-blue-500/10">
          {session.state.provisionCode}
        </div>
        <p className="opacity-70">
          The scanner then connects on its own and this screen turns to <b>Online</b> automatically —
          nothing more to do here. Keep this window open.
        </p>
      </div>

      <div className={`text-sm font-medium ${scanner?.isOnline ? "text-green-500" : "text-blue-500"}`}>
        {scanner?.isOnline
          ? "✓ Scanner is online — finishing…"
          : `Waiting for the scanner to connect… (${Math.round(elapsed / 1000)}s)`}
      </div>

      {timedOut && !scanner?.isOnline && (
        <div className="text-amber-500 text-sm space-y-2">
          <p>Still waiting after 2 minutes.</p>
          <p>That's OK — the code stays valid, so you can finish typing it on the scanner. This screen will switch to Online as soon as the scanner connects. You can also close this and provision later from the scanner's detail page.</p>
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
