import { NextRequest, NextResponse } from "next/server";
import { searchTires } from "@/lib/oeivalBrandIndex";

export const maxDuration = 30;

/**
 * GET /api/reports/tire-search?q=...
 * Free-text search over the OEIVAL catalog (brand / model / size / itemId) for the
 * tire-label picker — lets a user find an untagged tire by what's on the sidewall
 * and select it instead of typing fields manually. Returns up to ~40 matches.
 */
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q") || "";
    if (q.trim().length < 2) return NextResponse.json({ results: [] });
    const results = await searchTires(q, 40);
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "search failed", results: [] }, { status: 500 });
  }
}
