"use client";

import { useSetupSession } from "../useSetupSession";

type Session = ReturnType<typeof useSetupSession>;

export function DoneStep({ session, onClose }: { session: Session; onClose: () => void }) {
  const { scannerNumber, pin, connection, mode, manage } = session.state;
  const isUpdate = mode === "update";

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-emerald-500">
        {isUpdate ? "✓ Scanner updated" : "✓ Setup complete"}
      </h3>

      <div className="rounded-lg p-4 bg-emerald-500/10 border border-emerald-500/30 space-y-1 text-sm">
        <div><span className="opacity-70">Scanner:</span> <span className="font-mono font-semibold">{scannerNumber}</span></div>
        {isUpdate ? (
          <div><span className="opacity-70">Status:</span> <span className="font-mono font-semibold">{manage.status}</span></div>
        ) : (
          <div><span className="opacity-70">PIN:</span> <span className="font-mono font-semibold">{pin}</span></div>
        )}
        <div><span className="opacity-70">Serial:</span> <span className="font-mono">{connection?.serial}</span></div>
      </div>

      {isUpdate ? (
        <div className="text-xs opacity-80">
          Software reinstalled/updated, DataWedge Tab configured, and lockdown re-applied. Condition,
          status, and assignment saved. Number, location, and identity unchanged.
        </div>
      ) : (
        <>
          <div className="text-xs text-amber-500">⚠ Record the PIN — it cannot be recovered.</div>
          <div className="text-sm">
            <h4 className="font-semibold mb-2">Manual on-device steps remaining</h4>
            <ol className="space-y-1 list-decimal list-inside opacity-80 text-xs">
              <li>Wi-Fi → Settings → Network &amp; Internet</li>
              <li>Home screen → pin RTLMobile + TireTrack + Settings</li>
              <li>Keyboard → Gboard → Number Row ON, Autocorrect OFF</li>
              <li>Lock screen PIN: set to {pin}</li>
              <li>Ring scanner → Bluetooth Pairing Utility (if RS507)</li>
              <li>Launch RTLMobile and log in</li>
            </ol>
            <p className="text-[11px] opacity-60 mt-1">(DataWedge Tab is now configured automatically.)</p>
          </div>
        </>
      )}

      <button
        onClick={onClose}
        className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold"
      >
        Close
      </button>
    </div>
  );
}
