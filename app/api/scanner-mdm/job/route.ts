import { NextRequest, NextResponse } from "next/server";

const API_GATEWAY_URL = process.env.SCANNER_MDM_API_GATEWAY_URL;

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

    const res = await fetch(`${API_GATEWAY_URL}/scanner-mdm/job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
