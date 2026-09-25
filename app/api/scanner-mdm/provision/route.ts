import { NextRequest, NextResponse } from "next/server";
import { SCANNER_MDM_API_GATEWAY_URL } from "@/lib/scannerMdmGateway";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const res = await fetch(`${SCANNER_MDM_API_GATEWAY_URL}/scanner-mdm/provision`, {
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
