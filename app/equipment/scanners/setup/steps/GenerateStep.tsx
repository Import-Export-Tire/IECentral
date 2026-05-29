"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "../../../../auth-context";
import { useSetupSession } from "../useSetupSession";

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

        // Generate a 4-digit PIN client-side
        const pin = String(Math.floor(1000 + Math.random() * 9000));

        // Step 1: Create the scanner record in Convex
        const { scannerId } = await createScanner({
          number: state.scannerNumber,
          pin,
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
        actions.setGenerated(scannerId, code, pin);
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
        <p className="text-red-500 text-sm">{err}</p>
        <button
          onClick={() => session.actions.goToStep("identity")}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
        >
          ← Back to identity
        </button>
      </div>
    );
  }

  return (
    <div className="text-sm opacity-70 flex items-center gap-2">
      <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      Generating scanner record + provisioning code…
    </div>
  );
}
