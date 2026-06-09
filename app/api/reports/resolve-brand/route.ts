import { NextRequest, NextResponse } from "next/server";
import { resolveBrand } from "@/lib/oeivalBrandIndex";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const itemId = request.nextUrl.searchParams.get("itemId")?.trim();
  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });
  try {
    const hit = await resolveBrand(itemId);
    if (!hit) return NextResponse.json({ found: false, itemId });
    return NextResponse.json({
      found: true,
      itemId,
      manufacturerName: hit.manufacturerName,
      description: hit.description,
      model: hit.model,
      mfgItemId: hit.mfgItemId,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "resolve failed" }, { status: 500 });
  }
}
