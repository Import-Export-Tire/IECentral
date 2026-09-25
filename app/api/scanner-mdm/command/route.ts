import { NextRequest, NextResponse } from "next/server";
import { SCANNER_MDM_API_GATEWAY_URL } from "@/lib/scannerMdmGateway";

export async function POST(request: NextRequest) {

  try {
    const body = await request.json();

    // Validate required fields
    if (!body.thingName || !body.command || !body.scannerId) {
      return NextResponse.json(
        { error: "Missing required fields: thingName, command, scannerId" },
        { status: 400 }
      );
    }

    // Dangerous commands require explicit confirmation
    const dangerousCommands = ["wipe"];
    if (dangerousCommands.includes(body.command) && !body.confirmed) {
      return NextResponse.json(
        { error: "Dangerous command requires explicit confirmation" },
        { status: 400 }
      );
    }

    const res = await fetch(`${SCANNER_MDM_API_GATEWAY_URL}/scanner-mdm/command`, {
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
