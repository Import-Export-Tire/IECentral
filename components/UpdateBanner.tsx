"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Poll the deployment version so a running client learns when a new build has
// shipped and can prompt the user to refresh (the browser otherwise keeps the
// old bundle until reload). Complements ServiceWorkerRefresher, which only
// covers PWA/service-worker clients and reloads without warning.
const POLL_MS = 90_000;

export default function UpdateBanner() {
  // The version this client booted with; established on the first successful poll.
  const bootVersion = useRef<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { version?: string };
      const version = data.version;
      if (!version || version === "dev") return; // no version signal in dev
      if (bootVersion.current === null) {
        bootVersion.current = version;
        return;
      }
      if (version !== bootVersion.current) setUpdateAvailable(true);
    } catch {
      // offline / transient network — ignore, try again next tick
    }
  }, []);

  useEffect(() => {
    check(); // establish the boot version
    const id = setInterval(check, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  if (!updateAvailable || dismissed) return null;

  return (
    <div
      role="status"
      className="fixed top-0 inset-x-0 z-[100] bg-[#007AFF] text-white shadow-md"
    >
      <div className="mx-auto max-w-5xl px-4 py-2 flex items-center justify-center gap-3 text-sm">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <span className="font-medium">A new version of IE Central is available.</span>
        <button
          onClick={() => window.location.reload()}
          className="flex-shrink-0 rounded-md bg-white/95 hover:bg-white text-[#007AFF] font-semibold px-3 py-1 transition-colors"
        >
          Refresh
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="flex-shrink-0 p-1 rounded-md hover:bg-white/15 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
