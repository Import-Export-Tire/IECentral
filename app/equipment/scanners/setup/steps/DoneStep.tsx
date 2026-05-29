"use client";

import { useSetupSession } from "../useSetupSession";

type Session = ReturnType<typeof useSetupSession>;

export function DoneStep({ session, onClose }: { session: Session; onClose: () => void }) {
  const { scannerNumber, pin, connection } = session.state;

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-emerald-500">✓ Setup complete</h3>

      <div className="rounded-lg p-4 bg-emerald-500/10 border border-emerald-500/30 space-y-1 text-sm">
        <div><span className="opacity-70">Scanner:</span> <span className="font-mono font-semibold">{scannerNumber}</span></div>
        <div><span className="opacity-70">PIN:</span> <span className="font-mono font-semibold">{pin}</span></div>
        <div><span className="opacity-70">Serial:</span> <span className="font-mono">{connection?.serial}</span></div>
      </div>

      <div className="text-xs text-amber-500">⚠ Record the PIN — it cannot be recovered.</div>

      <div className="text-sm">
        <h4 className="font-semibold mb-2">Manual on-device steps remaining</h4>
        <ol className="space-y-1 list-decimal list-inside opacity-80 text-xs">
          <li>Wi-Fi → Settings → Network & Internet</li>
          <li>DataWedge App → Default Profile → check "Tab Command" (required for RT — NOT Send Enter)</li>
          <li>Home screen → pin RTLMobile + TireTrack + Settings</li>
          <li>Keyboard → Gboard → Number Row ON, Autocorrect OFF</li>
          <li>Lock screen PIN: set to {pin}</li>
          <li>Ring scanner → Bluetooth Pairing Utility (if RS507)</li>
          <li>Launch RTLMobile and log in</li>
        </ol>
      </div>

      <button
        onClick={onClose}
        className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold"
      >
        Close
      </button>
    </div>
  );
}
