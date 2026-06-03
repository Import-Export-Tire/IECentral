"use client";

import { useState } from "react";
import { useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSetupSession, ExistingScanner } from "../useSetupSession";

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
      <div>
        <h3 className="text-base font-semibold mb-1">Plug in the scanner</h3>
        <ol className="text-sm space-y-1 list-decimal list-inside opacity-80">
          <li>Connect the TC51 to this computer via USB.</li>
          <li>On the scanner: enable USB debugging (Developer Options).</li>
          <li>When prompted on the scanner, tap <strong>Allow</strong>.</li>
        </ol>
      </div>

      {err && <p className="text-red-500 text-sm">{err}</p>}

      {!match && (
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium text-sm"
        >
          {connecting ? "Connecting…" : "Detect scanner"}
        </button>
      )}

      {session.state.connection && (
        <div className="mt-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm">
          <div className="font-medium">✓ Connected</div>
          <div className="opacity-80">Serial: {session.state.connection.serial}</div>
          <div className="opacity-80">Model: {session.state.connection.model}</div>
          <div className="opacity-80">Android: {session.state.connection.androidVersion}</div>
        </div>
      )}

      {/* Already-registered → offer update */}
      {match && (
        <div className="mt-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/30 text-sm space-y-2">
          <div className="font-semibold text-base">This is {match.number}</div>
          <div className="opacity-80">
            {match.locationName ?? match.locationCode ?? "—"} · status: {match.status} ·{" "}
            {match.assignedTo ? "assigned" : "unassigned"}
          </div>
          {alreadyRegistered ? (
            <p className="text-amber-500 text-xs">{alreadyRegistered}</p>
          ) : (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  session.actions.setUpdateMode(match);
                  session.actions.goToStep("manage");
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold"
              >
                Update this scanner
              </button>
              <button
                onClick={() =>
                  setAlreadyRegistered(
                    `This serial is already registered as ${match.number}. To re-register it under a different number, retire ${match.number} first in Scanner Management.`,
                  )
                }
                className="px-4 py-2 rounded-lg border border-current/20 text-sm hover:bg-current/5"
              >
                Not this one
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
