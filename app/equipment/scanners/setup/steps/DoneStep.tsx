"use client";

import { useSetupSession } from "../useSetupSession";
import Button from "@/components/ui/Button";

type Session = ReturnType<typeof useSetupSession>;

export function DoneStep({ session, onClose }: { session: Session; onClose: () => void }) {
  const { scannerNumber, connection, mode, manage } = session.state;
  const isUpdate = mode === "update";

  return (
    <div className="space-y-4">
      {/* Success heading */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-[15px] font-semibold text-emerald-600 dark:text-emerald-400">
          {isUpdate ? "Scanner updated" : "Setup complete"}
        </h3>
      </div>

      {/* Summary card */}
      <div className="p-4 rounded-xl ui-callout-green space-y-1.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="theme-text-tertiary text-xs">Scanner</span>
          <span className="font-mono font-semibold theme-text-primary">{scannerNumber}</span>
        </div>
        {isUpdate ? (
          <div className="flex items-center justify-between">
            <span className="theme-text-tertiary text-xs">Status</span>
            <span className="font-mono font-semibold theme-text-primary">{manage.status}</span>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="theme-text-tertiary text-xs">PIN</span>
            <span className="text-xs theme-text-secondary text-right">
              Set by the scanner — shown on its page once it connects
            </span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="theme-text-tertiary text-xs">Serial</span>
          <span className="font-mono text-xs theme-text-secondary">{connection?.serial}</span>
        </div>
      </div>

      {isUpdate ? (
        <p className="text-xs theme-text-tertiary">
          Software reinstalled/updated, DataWedge Tab configured, and lockdown re-applied. Condition,
          status, and assignment saved. Number, location, and identity unchanged.
        </p>
      ) : (
        <>
          {/* Where the real PIN comes from. The wizard used to print an invented PIN here and
              tell the technician to record it and set the lock screen to it by hand — but that
              number never reached the device, and doing so would be reverted by the agent. */}
          <div className="p-2.5 rounded-lg ui-callout-amber text-xs font-medium">
            Don&apos;t set a lock PIN by hand. The scanner picks its own and applies it once it
            comes online — read it from this scanner&apos;s page in IE Central, where it can also
            be reset.
          </div>

          {/* Remaining manual steps */}
          <div>
            <div className="ui-section-label mb-2">Manual on-device steps remaining</div>
            <ol className="space-y-1 list-decimal list-inside theme-text-secondary text-xs">
              <li>Wi-Fi → Settings → Network &amp; Internet</li>
              <li>Home screen → pin RTLMobile + TireTrack + Settings</li>
              <li>Keyboard → Gboard → Number Row ON, Autocorrect OFF</li>
              <li>Ring scanner → Bluetooth Pairing Utility (if RS507)</li>
              <li>Launch RTLMobile and log in</li>
            </ol>
            <p className="text-[11px] theme-text-tertiary mt-1">(DataWedge Tab is now configured automatically.)</p>
          </div>
        </>
      )}

      <Button
        variant="primary"
        className="w-full"
        onClick={onClose}
      >
        Close
      </Button>
    </div>
  );
}
