import { NextRequest, NextResponse } from "next/server";

const API_GATEWAY_URL = process.env.DUNLOP_API_GATEWAY_URL || "https://jzdhz2de88.execute-api.us-east-1.amazonaws.com/prod";

// Dry-run SFTP connectivity check. The Lambda reads credentials from
// Secrets Manager itself, so this body carries only the environment name —
// no password crosses the wire in either direction.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const env = body?.env === "dev" ? "dev" : "prod";

    const res = await fetch(`${API_GATEWAY_URL}/dunlop/settings/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ env }),
    });

    if (!res.ok) {
      // A 403/404 here almost always means the test Lambda hasn't been
      // deployed to the stack yet — say so rather than surfacing a bare
      // "Missing Authentication Token" from API Gateway.
      if (res.status === 403 || res.status === 404) {
        return NextResponse.json(
          { error: "Test endpoint not found — the dunlop-test-sftp Lambda may not be deployed yet." },
          { status: 501 }
        );
      }
      return NextResponse.json({ error: await res.text() }, { status: res.status });
    }

    return NextResponse.json(await res.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
