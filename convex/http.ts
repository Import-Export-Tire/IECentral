import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

// Webhook endpoint for scanner-status Lambda to POST telemetry updates
http.route({
  path: "/scanner-telemetry",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Validate shared secret
    const authHeader = request.headers.get("x-webhook-secret");
    const expectedSecret = process.env.SCANNER_WEBHOOK_SECRET;

    if (!expectedSecret || authHeader !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const body = await request.json();

      await ctx.runMutation(internal.scannerMdm.updateScannerTelemetry, {
        iotThingName: body.iotThingName,
        batteryLevel: body.batteryLevel,
        wifiSignal: body.wifiSignal,
        gpsLatitude: body.gpsLatitude,
        gpsLongitude: body.gpsLongitude,
        installedApps: body.installedApps,
        agentVersion: body.agentVersion,
        androidVersion: body.androidVersion,
        isLocked: body.isLocked,
        lastCommandAck: body.lastCommandAck,
        deviceOwner: body.deviceOwner,
        pinManaged: body.pinManaged,
        pin: body.pin,
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Failed to process telemetry" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }),
});

// Claim provision endpoint — scanner agent redeems a claim code to get IoT certs
http.route({
  path: "/claim-provision",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const code = body?.code;

      if (!code || typeof code !== "string" || code.length !== 6) {
        return new Response(
          JSON.stringify({ error: "Invalid code format" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const result = await ctx.runMutation(internal.scannerMdm.claimProvision, {
        code: code.toUpperCase(),
      });

      if (!result.success) {
        return new Response(
          JSON.stringify({ error: result.error }),
          { status: 410, headers: { "Content-Type": "application/json" } }
        );
      }

      // Retire-at-claim: now that the device has adopted this cert, retire any OTHER
      // (older) certs on the thing. Best-effort — never block/fail the claim. This is what
      // makes provisioning safe: old certs are only retired once the new one is claimed,
      // so an abandoned provision can't strand a device.
      try {
        const base = process.env.IECENTRAL_URL || "https://www.iecentral.com";
        await fetch(`${base}/api/scanner-mdm/provision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "retire",
            thingName: result.thingName,
            keepCertArn: result.certificateArn,
          }),
        });
      } catch (e) {
        console.error("retire-at-claim call failed (non-fatal):", e);
      }

      return new Response(
        JSON.stringify({
          thingName: result.thingName,
          certificatePem: result.certificatePem,
          privateKey: result.privateKey,
          iotEndpoint: result.iotEndpoint,
          rtConfigXml: result.rtConfigXml,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Failed to process claim" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }),
});

// Health check endpoint
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
