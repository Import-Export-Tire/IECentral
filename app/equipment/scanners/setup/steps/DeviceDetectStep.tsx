"use client";

import { useState } from "react";
import { useSetupSession } from "../useSetupSession";

type Session = ReturnType<typeof useSetupSession>;

export function DeviceDetectStep({ session }: { session: Session }) {
  const [connecting, setConnecting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleConnect = async () => {
    setConnecting(true);
    setErr(null);
    try {
      const conn = await session.state.client.connect();
      session.actions.setConnection(conn);
      session.actions.goToStep("location");
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

      <button
        onClick={handleConnect}
        disabled={connecting}
        className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium text-sm"
      >
        {connecting ? "Connecting…" : "Detect scanner"}
      </button>

      {session.state.connection && (
        <div className="mt-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm">
          <div className="font-medium">✓ Connected</div>
          <div className="opacity-80">Serial: {session.state.connection.serial}</div>
          <div className="opacity-80">Model: {session.state.connection.model}</div>
          <div className="opacity-80">Android: {session.state.connection.androidVersion}</div>
        </div>
      )}
    </div>
  );
}
