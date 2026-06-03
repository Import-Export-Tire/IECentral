"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "../../../../auth-context";
import { useSetupSession } from "../useSetupSession";
import { fetchApk } from "../apkManifest";
import { IET_PACKAGES, ESSENTIAL_SYSTEM_PREFIXES, ESSENTIAL_SYSTEM_EXACT } from "../WebAdbClient";

type Session = ReturnType<typeof useSetupSession>;

const TIRETRACK_PKG = "com.importexporttire.tiretrack";
const RTL_PKG = "com.rt_systems.rtlhandsfree";
const AGENT_PKG = "com.ietires.scanneragent";

export function InstallStep({ session }: { session: Session }) {
  const { user } = useAuth();
  const getApkUrls = useAction(api.scannerMdm.getApkDownloadUrls);
  const logStep = useMutation(api.scannerMdm.logScannerSetupStep);
  const markComplete = useMutation(api.scannerMdm.markScannerSetupComplete);
  const updateScanner = useMutation(api.scannerMdm.updateScannerFromSetup);
  const storePendingProvision = useMutation(api.scannerMdm.storePendingProvision);
  const lockPolicy = useQuery(api.scannerMdm.getLockPolicy, {});
  const mdmConfig = useQuery(
    api.scannerMdm.getMdmConfigByCode,
    session.state.locationCode ? { locationCode: session.state.locationCode } : "skip",
  );

  const [fatalErr, setFatalErr] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!lockPolicy || started) return;
    // New flow needs the location's MDM config; update flow tolerates its absence (uses fallbacks).
    if (session.state.mode === "new" && !mdmConfig) return;
    setStarted(true);
    let cancelled = false;

    const log = (
      step: string,
      status: "started" | "success" | "skipped" | "failed",
      durationMs?: number,
      error?: string,
    ) => {
      if (!session.state.scannerId || !user) return;
      logStep({
        scannerId: session.state.scannerId,
        step,
        status,
        durationMs,
        error,
        browserAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        actingUserId: user._id,
      }).catch(() => {});
    };

    const runStep = async (key: string, label: string, fn: () => Promise<void>) => {
      session.actions.reportProgress(key, "in-progress", label);
      log(key, "started");
      const t0 = performance.now();
      try {
        await fn();
        const dt = Math.round(performance.now() - t0);
        session.actions.reportProgress(key, "success", `${label} (${dt}ms)`);
        log(key, "success", dt);
      } catch (e: unknown) {
        const dt = Math.round(performance.now() - t0);
        const msg = e instanceof Error ? e.message : String(e);
        session.actions.reportProgress(key, "failed", msg);
        log(key, "failed", dt, msg);
        throw e;
      }
    };

    (async () => {
      try {
        const client = session.state.client;
        const { state, actions } = session;
        if (!state.locationCode) throw new Error("Missing locationCode");

        // 0. Update flow: mint a fresh certificate + claim code. The new-scanner flow
        // does this in GenerateStep, but the update flow skips Generate — so without this
        // the Verify step shows an empty code box and the reinstalled agent can't connect.
        if (state.mode === "update" && !state.provisionCode) {
          await runStep("provision", "Provisioning device certificate", async () => {
            if (!user) throw new Error("Not signed in");
            if (!state.connection) throw new Error("No device connection");
            if (!state.scannerId) throw new Error("Missing scanner record");
            const scannerId = state.scannerId;
            const serial = state.connection.serial;
            const provisionRes = await fetch("/api/scanner-mdm/provision", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                serialNumber: serial,
                locationCode: state.locationCode,
                scannerNumber: state.scannerNumber,
                scannerId,
              }),
            });
            if (!provisionRes.ok) {
              const e = await provisionRes.json().catch(() => ({}));
              throw new Error(e.error || "IoT provisioning failed");
            }
            const iot = await provisionRes.json();
            const { code } = await storePendingProvision({
              scannerId,
              thingName: iot.thingName,
              thingArn: iot.thingArn,
              certificateArn: iot.certificateArn,
              certificatePem: iot.certificatePem,
              privateKey: iot.privateKey,
              iotEndpoint: iot.iotEndpoint,
              userId: user._id,
            });
            actions.setGenerated(scannerId, code, state.pin ?? "");
          });
        }

        // 1. Fetch APK URLs
        let urls: Awaited<ReturnType<typeof getApkUrls>> | undefined;
        await runStep("getUrls", "Fetching APK URLs", async () => {
          urls = await getApkUrls({ locationCode: state.locationCode! });
        });

        // 2. Download all three APKs in parallel
        let apks:
          | {
              rtlBuf: ArrayBuffer;
              ttBuf: ArrayBuffer;
              agentBuf: ArrayBuffer;
              versions: { tireTrack: string; rtLocator: string; scannerAgent: string };
            }
          | undefined;
        await runStep("downloadApks", "Downloading APKs", async () => {
          const onProgressFor = (label: string) => (pct: number) =>
            actions.reportProgress(`download-${label}`, "in-progress", `Downloading ${label}`, pct);

          const [rtlBuf, ttBuf, agentBuf] = await Promise.all([
            fetchApk(urls!.rtLocator, onProgressFor("rtl")),
            fetchApk(urls!.tireTrack, onProgressFor("tiretrack")),
            fetchApk(urls!.scannerAgent, onProgressFor("agent")),
          ]);
          apks = {
            rtlBuf,
            ttBuf,
            agentBuf,
            versions: {
              tireTrack: urls!.tireTrack.version,
              rtLocator: urls!.rtLocator.version,
              scannerAgent: urls!.scannerAgent.version,
            },
          };
        });

        // 3. Install RTL
        await runStep("installRtl", "Installing RT Locator", async () => {
          try {
            await client.installApk(apks!.rtlBuf);
          } catch (e: unknown) {
            if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(String(e instanceof Error ? e.message : e))) {
              await client.uninstall(RTL_PKG);
              await client.installApk(apks!.rtlBuf);
            } else {
              throw e;
            }
          }
          actions.recordInstalledVersion("rtLocator", apks!.versions.rtLocator);
        });

        // 4. Install TireTrack
        await runStep("installTireTrack", "Installing TireTrack", async () => {
          try {
            await client.installApk(apks!.ttBuf);
          } catch (e: unknown) {
            if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(String(e instanceof Error ? e.message : e))) {
              await client.uninstall(TIRETRACK_PKG);
              await client.installApk(apks!.ttBuf);
            } else {
              throw e;
            }
          }
          actions.recordInstalledVersion("tireTrack", apks!.versions.tireTrack);
        });

        // 5. Install Scanner Agent
        await runStep("installAgent", "Installing Scanner Agent", async () => {
          try {
            await client.installApk(apks!.agentBuf);
          } catch (e: unknown) {
            if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(String(e instanceof Error ? e.message : e))) {
              await client.uninstall(AGENT_PKG);
              await client.installApk(apks!.agentBuf);
            } else {
              throw e;
            }
          }
          actions.recordInstalledVersion("scannerAgent", apks!.versions.scannerAgent);
        });

        // 6. Push RT config
        await runStep("pushRtConfig", "Pushing RT config", async () => {
          const xml =
            mdmConfig?.rtConfigXml ??
            `<RT>
    <ORIENTATION>PORTRAIT</ORIENTATION>
    <DEVICEID>${state.rtDeviceId}</DEVICEID>
    <SCALEFACTOR>3.5</SCALEFACTOR>
    <RTLMOBILEURL>${mdmConfig?.rtLocatorUrl ?? ""}</RTLMOBILEURL>
</RT>`;
          const finalXml = xml.replace(
            /<DEVICEID>[^<]*<\/DEVICEID>/,
            `<DEVICEID>${state.rtDeviceId}</DEVICEID>`,
          );
          await client.shell(`mkdir -p '/sdcard/My Documents'`);
          await client.pushTextFile(finalXml, "/sdcard/My Documents/rtlconfig.xml");
        });

        // 7. Grant permissions
        await runStep("grantPerms", "Granting permissions", async () => {
          const grants: Array<[string, string]> = [
            [TIRETRACK_PKG, "android.permission.CAMERA"],
            [TIRETRACK_PKG, "android.permission.READ_EXTERNAL_STORAGE"],
            [TIRETRACK_PKG, "android.permission.WRITE_EXTERNAL_STORAGE"],
            [TIRETRACK_PKG, "android.permission.RECORD_AUDIO"],
            [RTL_PKG, "android.permission.READ_EXTERNAL_STORAGE"],
            [RTL_PKG, "android.permission.WRITE_EXTERNAL_STORAGE"],
            [AGENT_PKG, "android.permission.ACCESS_FINE_LOCATION"],
            [AGENT_PKG, "android.permission.ACCESS_COARSE_LOCATION"],
            [AGENT_PKG, "android.permission.READ_EXTERNAL_STORAGE"],
            [AGENT_PKG, "android.permission.WRITE_EXTERNAL_STORAGE"],
          ];
          for (const [pkg, perm] of grants) {
            try {
              await client.grantPermission(pkg, perm);
            } catch {
              /* silent — permission may already be granted or not applicable */
            }
          }
        });

        // 8. Device settings
        await runStep("settings", "Configuring device settings", async () => {
          const timeoutMs = mdmConfig?.screenTimeoutMs ?? 1800000;
          const rotation = mdmConfig?.screenRotation === "landscape" ? 1 : 0;
          await client.shell(`settings put system screen_off_timeout ${timeoutMs}`);
          await client.shell(`settings put system accelerometer_rotation ${rotation}`);
        });

        // 9. Activate Scanner Agent as Device Admin
        await runStep("deviceAdmin", "Activating Scanner Agent as Device Admin", async () => {
          await client.setActiveAdmin(`${AGENT_PKG}/.DeviceAdminReceiver`);
        });

        // Promote to Device Owner (required for managed PINs). No-op if already owner.
        await runStep("deviceOwner", "Promoting to Device Owner", async () => {
          if (await client.isDeviceOwner()) { actions.setDeviceOwner(true); return; }
          const accounts = await client.listAccounts();
          if (accounts.length > 0) {
            await client.openAccountsSettings();
            throw new Error(
              `Remove the account(s) on the scanner first (Settings → Accounts: ${accounts.join(", ")}), then re-run setup.`,
            );
          }
          await client.setDeviceOwner();
          actions.setDeviceOwner(true);
        });

        // 10a. DataWedge: emit a Tab key after each scan (policy-gated, idempotent)
        if (lockPolicy.dataWedgeTab) {
          await runStep("datawedge", "Configuring DataWedge (Tab)", async () => {
            await client.configureDataWedgeTab();
          });
        }

        // 10b. Lockdown: disable every non-allowlisted user package (policy-gated)
        if (lockPolicy.lockdownEnabled) {
          await runStep("lockdown", "Locking down to allowlist", async () => {
            const installed = await client.listPackages();
            const keep = new Set<string>([
              ...Object.values(IET_PACKAGES),
              ...ESSENTIAL_SYSTEM_EXACT,
              ...lockPolicy.allowedPackages,
            ]);
            const isEssential = (pkg: string) =>
              keep.has(pkg) || ESSENTIAL_SYSTEM_PREFIXES.some((p) => pkg === p || pkg.startsWith(p));
            const toDisable = installed.filter((pkg) => !isEssential(pkg));
            // Dry-run record: log exactly what will be disabled BEFORE acting
            // (pm disable-user is reversible via `pm enable`).
            log("lockdown", "started", undefined, `disabling ${toDisable.length}: ${toDisable.join(",")}`.slice(0, 4000));
            await client.disablePackages(toDisable);
          });
        }

        // 11. Launch SetupActivity
        await runStep("launchSetupActivity", "Launching Scanner Agent setup", async () => {
          await client.launchActivity(`${AGENT_PKG}/.SetupActivity`);
        });

        // Record completion
        const installedApps = {
          tireTrack: state.installedVersions.tireTrack ?? apks!.versions.tireTrack,
          rtLocator: state.installedVersions.rtLocator ?? apks!.versions.rtLocator,
          scannerAgent: state.installedVersions.scannerAgent ?? apks!.versions.scannerAgent,
        };
        if (state.mode === "update") {
          await updateScanner({
            scannerId: state.scannerId!,
            installedApps,
            androidVersion: state.connection?.androidVersion,
            conditionNotes: state.manage.conditionNotes,
            status: state.manage.status,
            assignedTo: state.manage.assignedTo,
          });
        } else {
          await markComplete({
            scannerId: state.scannerId!,
            installedApps,
            actingUserId: user!._id,
          });
        }

        if (cancelled) return;
        actions.goToStep("verify");
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Install failed";
        setFatalErr(msg);
        session.actions.reportError(msg);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mdmConfig, lockPolicy]);

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">Installing</h3>
      <p className="text-xs opacity-70">
        Provisioning code:{" "}
        <span className="font-mono text-base text-blue-500">{session.state.provisionCode}</span>
      </p>

      <ul className="space-y-1.5 text-sm">
        {Object.entries(session.state.installProgress).map(([key, p]) => (
          <li key={key} className="flex items-center gap-2">
            <span>
              {p.status === "success" && "✓"}
              {p.status === "in-progress" && "…"}
              {p.status === "failed" && "✗"}
              {p.status === "skipped" && "—"}
            </span>
            <span className={p.status === "failed" ? "text-red-500" : ""}>{p.message ?? key}</span>
            {p.percent !== undefined && p.status === "in-progress" && (
              <span className="opacity-60">({p.percent}%)</span>
            )}
          </li>
        ))}
      </ul>

      {fatalErr && (
        <div className="text-red-500 text-sm pt-2">
          <p className="font-semibold">Install failed</p>
          <p>{fatalErr}</p>
        </div>
      )}
    </div>
  );
}
