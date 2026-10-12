import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { pinRejectReason } from "@/lib/scanners/pin";
import { canRemoteSetPin, REMOTE_PIN_UNAVAILABLE } from "@/lib/scanners/fleet";

const API_GATEWAY_URL =
  process.env.SCANNER_MDM_API_GATEWAY_URL ||
  "https://7brylwlei6.execute-api.us-east-1.amazonaws.com/prod";

function getConvexClient() {
  const url =
    process.env.NEXT_PUBLIC_CONVEX_URL ||
    "https://outstanding-dalmatian-787.convex.cloud";
  return new ConvexHttpClient(url);
}

// Creates a durable AWS IoT Job (survives an offline scanner) rather than the
// fire-and-forget cmd/scanners/# path used by /api/scanner-mdm/command. `wipe` is
// deliberately rejected here — a queued factory-reset that fires days later when someone
// finally powers a device back on is dangerous, so wipe stays on the direct command path.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const hasTarget = !!body.thingName || (Array.isArray(body.thingNames) && body.thingNames.length > 0);
    if (!hasTarget || !body.command) {
      return NextResponse.json(
        { error: "Missing thingName (or thingNames) or command" },
        { status: 400 }
      );
    }

    if (body.command === "wipe") {
      return NextResponse.json(
        { error: "wipe is not available via Jobs — use /api/scanner-mdm/command" },
        { status: 400 }
      );
    }

    if (body.command === "update_pin") {
      const pin = typeof body.payload?.pin === "string" ? body.payload.pin : "";
      const reason = pinRejectReason(pin);
      if (reason) {
        return NextResponse.json({ error: reason }, { status: 400 });
      }
    }

    const convex = getConvexClient();

    if (body.command === "update_pin") {
      try {
        const fleet = await convex.query(api.equipment.listScanners, {});
        const scanner =
          (typeof body.scannerId === "string"
            ? fleet.find((s) => s._id === body.scannerId)
            : undefined) ||
          (typeof body.thingName === "string"
            ? fleet.find((s) => s.iotThingName === body.thingName)
            : undefined);
        if (!scanner || !canRemoteSetPin(scanner)) {
          return NextResponse.json({ error: REMOTE_PIN_UNAVAILABLE }, { status: 403 });
        }
      } catch (err) {
        console.error("[scanner-mdm/job] device-owner check failed:", err);
        return NextResponse.json({ error: REMOTE_PIN_UNAVAILABLE }, { status: 403 });
      }
    }

    // One outstanding command at a time, per scanner. Enforced here rather than only in the
    // page, because the failure mode is a human sending a second command when the first shows
    // no sign of having landed — a second browser tab does that just as easily. `override`
    // exists so a job wedged QUEUED against a scanner that never comes back can't lock the
    // fleet console out permanently.
    if (body.thingName && !body.override) {
      try {
        const pending = await convex.query(
          api.scannerMdm.getPendingJobsByThingName,
          { thingName: body.thingName }
        );
        if (pending.length > 0) {
          const p = pending[0];
          return NextResponse.json(
            {
              error: `A ${p.command.replace(/_/g, " ")} command is still ${p.status === "QUEUED" ? "waiting for this scanner to check in" : "running"} (sent ${new Date(p.createdAt).toLocaleString()}). Wait for it to finish — a second command runs in addition to it, not instead of it.`,
              pendingJob: p,
            },
            { status: 409 }
          );
        }
      } catch (err) {
        // A guard that can't be evaluated must not block the command outright — an operator
        // locked out of Remote Control by a Convex hiccup is worse than a rare duplicate.
        console.error("[scanner-mdm/job] pending-job check failed, allowing send:", err);
      }
    }

    // Don't send scannerId/createdBy through to the lambda.
    const {
      override: _override,
      scannerId: scannerIdArg,
      createdBy: createdByArg,
      userId: _userId,
      requestingUserId: _requestingUserId,
      ...forwarded
    } = body;
    const res = await fetch(`${API_GATEWAY_URL}/scanner-mdm/job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(forwarded),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: err }, { status: res.status });
    }

    const data = await res.json();

    // Record the job as queued. AWS already has it, so don't fail this request if convex write fails.
    try {
      const jobId = typeof data.jobId === "string" ? data.jobId : null;
      if (jobId && typeof scannerIdArg === "string") {
        await convex.mutation(api.scannerMdm.recordJob, {
          scannerId: scannerIdArg as Id<"scanners">,
          jobId,
          command: body.command,
          payload: body.payload,
          createdBy:
            typeof createdByArg === "string"
              ? (createdByArg as Id<"users">)
              : undefined,
        });
      }
    } catch (err) {
      console.error("[scanner-mdm/job] recordJob failed after AWS create:", err);
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
