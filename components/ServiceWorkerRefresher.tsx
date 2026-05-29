"use client";

import { useEffect } from "react";

/**
 * Force the service worker to check for updates on every app mount and
 * reload the page when a new worker takes control. Belt-and-suspenders
 * partner to clientsClaim + skipWaiting in next-pwa: those make the new
 * SW take over open tabs once it's installed, this makes sure the
 * "checking for new SW" actually happens promptly when an old client
 * loads the app.
 *
 * Background: Andy 5/29 — removed dashboard widgets (Tire Quote of the
 * Day) kept appearing for users whose PWA was on a stale service worker.
 * The old SW was happily serving the old JS bundle from cache for hours
 * after deploys.
 */
export default function ServiceWorkerRefresher() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let reloaded = false;
    const onControllerChange = () => {
      // A new SW has taken control. Reload once to pick up the fresh bundle.
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Ask the registered SW to check for updates. If there's a newer one
    // available it will install, activate, and (because of clientsClaim)
    // trigger the controllerchange above.
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg) reg.update().catch(() => {});
    }).catch(() => {});

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
