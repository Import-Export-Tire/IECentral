import { NextRequest, NextResponse } from "next/server";
import { SCANNER_MDM_API_GATEWAY_URL } from "@/lib/scannerMdmGateway";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const locationCode = searchParams.get("locationCode");

    if (!locationCode) {
      return NextResponse.json(
        { error: "Missing locationCode parameter" },
        { status: 400 }
      );
    }

    const res = await fetch(
      `${SCANNER_MDM_API_GATEWAY_URL}/scanner-mdm/config/${locationCode}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      }
    );

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
