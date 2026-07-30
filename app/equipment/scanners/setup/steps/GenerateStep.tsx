"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "../../../../auth-context";
import { useSetupSession } from "../useSetupSession";
import Button from "@/components/ui/Button";

type Session = ReturnType<typeof useSetupSession>;

export function GenerateStep({ session }: { session: Session }) {
  const { user } = useAuth();
  const createScanner = useMutation(api.scannerMdm.createScannerFromSetup);
  const storePendingProvision = useMutation(api.scannerMdm.storePendingProvision);

  // Look up the MDM config to get the locationId (Id<"locations">) from the locationCode
  const mdmConfig = useQuery(
    api.scannerMdm.getMdmConfigByCode,
    session.state.locationCode ? { locationCode: session.state.locationCode } : "skip"
  );

  const [err, setErr] = useState<string | null>(null);
  const [ran, setRan] = useState(false);

  useEffect(() => {
    // Wait until mdmConfig has resolved (undefined = loading, null = not found, object = found)
    if (mdmConfig === undefined) return;

    // Guard: only run once
    if (ran) return;

    let cancelled = false;
    setRan(true);

    (async () => {
      try {
        const { state, actions } = session;
        if (
          !state.locationCode ||
          !state.scannerNumber ||
          !state.connection ||
          !user
        ) {
          throw new Error("Missing prerequisites for generate step");
        }

        if (!mdmConfig) {
          throw new Error(
            `No MDM config found for location code "${state.locationCode}". ` +
            "Please configure this location in Scanner MDM settings first."
          );
        }

        // No PIN is generated here. The scanner sets its own lock PIN: the agent, as Device
        // Owner, generates one and applies it with resetPassword, then reports it in telemetry.
        // This step used to invent a 4-digit PIN, save it, and show it to the technician — but
        // nothing ever sent it to the device, so it was a phantom. Worse, the Done screen told
        // the technician to set the lock screen to it by hand, which the agent's boot-time
        // re-assert would then revert, locking them out with a PIN they believed was correct.
        // The device is the source of truth for its own PIN.

        // Step 1: Create the scanner record in Convex
        const { scannerId } = await createScanner({
          number: state.scannerNumber,
          serialNumber: state.connection.serial,
          model: state.connection.model || "Zebra TC51",
          locationId: mdmConfig.locationId,
        });

        if (cancelled) return;

        // Step 2: Call the provision API to create IoT thing + certificates in AWS
        const provisionRes = await fetch("/api/scanner-mdm/provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serialNumber: state.connection.serial,
            locationCode: state.locationCode,
            scannerNumber: state.scannerNumber,
            scannerId,
          }),
        });

        if (!provisionRes.ok) {
          const errBody = await provisionRes.json().catch(() => ({}));
          throw new Error(errBody.error || "IoT provisioning failed");
        }

        const iotData = await provisionRes.json();

        if (cancelled) return;

        // Step 3: Store the certs + generate a claim code in Convex
        const { code } = await storePendingProvision({
          scannerId,
          thingName: iotData.thingName,
          thingArn: iotData.thingArn,
          certificateArn: iotData.certificateArn,
          certificatePem: iotData.certificatePem,
          privateKey: iotData.privateKey,
          iotEndpoint: iotData.iotEndpoint,
          userId: user._id,
        });

        if (cancelled) return;
        actions.setGenerated(scannerId, code, "");
        actions.goToStep("install");
      } catch (e: unknown) {
        if (cancelled) return;
        const message =
          e instanceof Error ? e.message : "Failed to generate scanner";
        setErr(message);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mdmConfig]);

  if (err) {
    return (
      <div className="space-y-3">
        <div className="p-3 rounded-xl ui-callout-red text-sm">{err}</div>
        <Button
          variant="secondary"
          onClick={() => session.actions.goToStep("identity")}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to identity
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 text-sm theme-text-tertiary py-4">
      <span className="inline-block w-4 h-4 border-2 border-[var(--accent-primary)] border-t-transparent rounded-full animate-spin flex-shrink-0" />
      Generating scanner record + provisioning code…
    </div>
  );
}
