"use client";

import { useState } from "react";
import { useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSetupSession, ExistingScanner } from "../useSetupSession";
import Button from "@/components/ui/Button";

type Session = ReturnType<typeof useSetupSession>;

export function DeviceDetectStep({ session }: { session: Session }) {
  const convex = useConvex();
  const [connecting, setConnecting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // A scanner already registered under this serial — offer to update it.
  const [match, setMatch] = useState<ExistingScanner | null>(null);
  const [alreadyRegistered, setAlreadyRegistered] = useState<string | null>(null);

  const handleConnect = async () => {
    setConnecting(true);
    setErr(null);
    try {
      const conn = await session.state.client.connect();
      session.actions.setConnection(conn);

      const existing = await convex.query(api.scannerMdm.getScannerBySerialNumber, {
        serialNumber: conn.serial,
      });

      if (existing) {
        // Location code is the scanner-number prefix (e.g. "W08-700" -> "W08").
        // That's what InstallStep needs for APK URLs / MDM config; it's also fine for display.
        const locationCode = existing.number.split("-")[0] || null;
        const locationName: string | null = locationCode;
        setMatch({
          _id: existing._id,
          number: existing.number,
          locationCode,
          locationName,
          status: existing.status,
          conditionNotes: existing.conditionNotes ?? null,
          assignedTo: existing.assignedTo ?? null,
        });
      } else {
        session.actions.goToStep("location");
      }
    } catch (e: any) {
      setErr(e?.message ?? "Failed to connect");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Instructions */}
      <div>
        <h3 className="text-[15px] font-semibold mb-2 theme-text-primary">Plug in the scanner</h3>
        <ol className="text-sm space-y-1 list-decimal list-inside theme-text-secondary">
          <li>Connect the TC51 to this computer via USB.</li>
          <li>On the scanner: enable USB debugging (Developer Options).</li>
          <li>When prompted on the scanner, tap <strong>Allow</strong>.</li>
        </ol>
      </div>

      {/* Error */}
      {err && (
        <div className="p-3 rounded-xl ui-callout-red text-sm">{err}</div>
      )}

      {/* Connect button */}
      {!match && (
        <Button
          variant="primary"
          className="w-full"
          onClick={handleConnect}
          disabled={connecting}
        >
          {connecting ? (
            <>
              <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Connecting…
            </>
          ) : (
            "Detect scanner"
          )}
        </Button>
      )}

      {/* Connected device info */}
      {session.state.connection && (
        <div className="p-3 rounded-xl ui-callout-green text-sm space-y-0.5">
          <div className="font-semibold text-emerald-600 dark:text-emerald-400">Connected</div>
          <div className="theme-text-secondary">Serial: <span className="font-mono">{session.state.connection.serial}</span></div>
          <div className="theme-text-secondary">Model: {session.state.connection.model}</div>
          <div className="theme-text-secondary">Android: {session.state.connection.androidVersion}</div>
        </div>
      )}

      {/* Already-registered → offer update */}
      {match && (
        <div className="p-4 rounded-xl theme-card space-y-2.5">
          <div>
            <div className="text-[15px] font-bold theme-text-primary">{match.number}</div>
            <div className="text-xs theme-text-tertiary mt-0.5">
              {match.locationName ?? match.locationCode ?? "—"} &middot; {match.status} &middot;{" "}
              {match.assignedTo ? "assigned" : "unassigned"}
            </div>
          </div>
          {alreadyRegistered ? (
            <div className="p-2.5 rounded-lg ui-callout-amber text-xs">{alreadyRegistered}</div>
          ) : (
            <div className="flex gap-2 pt-1">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  session.actions.setUpdateMode(match);
                  session.actions.goToStep("manage");
                }}
              >
                Update this scanner
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setAlreadyRegistered(
                    `This serial is already registered as ${match.number}. To re-register it under a different number, retire ${match.number} first in Scanner Management.`,
                  )
                }
              >
                Not this one
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
