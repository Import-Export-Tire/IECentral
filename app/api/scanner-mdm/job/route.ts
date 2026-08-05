import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const API_GATEWAY_URL = process.env.SCANNER_MDM_API_GATEWAY_URL;

function getConvexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not configured");
  return new ConvexHttpClient(url);
}

// Creates a durable AWS IoT Job (survives an offline scanner) rather than the
// fire-and-forget cmd/scanners/# path used by /api/scanner-mdm/command. `wipe` is
// deliberately rejected here — a queued factory-reset that fires days later when someone
// finally powers a device back on is dangerous, so wipe stays on the direct command path.
export async function POST(request: NextRequest) {
  if (!API_GATEWAY_URL) {
    return NextResponse.json(
      { error: "SCANNER_MDM_API_GATEWAY_URL not configured" },
      { status: 500 }
    );
  }

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

    // One outstanding command at a time, per scanner. Enforced here rather than only in the
    // page, because the failure mode is a human sending a second command when the first shows
    // no sign of having landed — a second browser tab does that just as easily. `override`
    // exists so a job wedged QUEUED against a scanner that never comes back can't lock the
    // fleet console out permanently.
    if (body.thingName && !body.override) {
      try {
        const pending = await getConvexClient().query(
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

    // `override` is this route's own flag — keep it out of the job document the Lambda builds.
    const { override: _override, ...forwarded } = body;
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
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
