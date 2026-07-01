"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSetupSession } from "../useSetupSession";
import Button from "@/components/ui/Button";

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
      <h3 className="text-[15px] font-semibold theme-text-primary">Last step — finish on the scanner</h3>

      <div className="space-y-3 text-sm">
        <p className="theme-text-secondary">
          The <strong>IE Scanner Agent · Setup</strong> screen is now open{" "}
          <span className="theme-text-tertiary">on the handheld scanner</span>. On the scanner:
        </p>
        <ol className="list-decimal pl-5 space-y-1 theme-text-secondary">
          <li>Type this code into the box and tap <strong>Submit</strong>:</li>
        </ol>

        {/* Provision code display */}
        <div className="text-3xl font-mono font-bold tracking-[0.3em] theme-accent-primary text-center py-4 rounded-xl"
          style={{ background: "color-mix(in srgb, var(--accent-primary) 10%, transparent)" }}>
          {session.state.provisionCode}
        </div>

        <p className="text-xs theme-text-tertiary">
          The scanner then connects on its own and this screen turns to <strong>Online</strong> automatically —
          nothing more to do here. Keep this window open.
        </p>
      </div>

      {/* Status indicator */}
      <div className={`flex items-center gap-2 text-sm font-medium ${scanner?.isOnline ? "text-emerald-500" : "theme-accent-primary"}`}>
        {scanner?.isOnline ? (
          <>
            <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
            Scanner is online — finishing…
          </>
        ) : (
          <>
            <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />
            Waiting for the scanner to connect… ({Math.round(elapsed / 1000)}s)
          </>
        )}
      </div>

      {/* Timeout fallback */}
      {timedOut && !scanner?.isOnline && (
        <div className="p-3 rounded-xl ui-callout-amber text-sm space-y-2">
          <p className="font-medium">Still waiting after 2 minutes.</p>
          <p className="theme-text-secondary text-xs">
            That&apos;s OK — the code stays valid, so you can finish typing it on the scanner. This screen will switch to Online as soon as the scanner connects. You can also close this and provision later from the scanner&apos;s detail page.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => session.actions.goToStep("done")}
          >
            Mark setup done anyway
          </Button>
        </div>
      )}
    </div>
  );
}
