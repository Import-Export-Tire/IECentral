import { NextRequest, NextResponse } from "next/server";
import { checkInventoryToken } from "@/lib/inventoryAuth";
import { searchTires } from "@/lib/oeivalBrandIndex";

export const maxDuration = 30;

/**
 * GET /api/inventory/search?q=...
 *
 * Catalog search for the scanner's sidewall lookup, so a counter holding an
 * unrecognised UPC can find the tire by what is printed on it. Needed because
 * only 480 of W09's 56,107 catalog items are in stock — a tire on the floor may
 * be any catalog item, so the frozen baseline is not a sufficient search index.
 */
export async function GET(request: NextRequest) {
  const authFail = checkInventoryToken(request);
  if (authFail) {
    return NextResponse.json(
      {
        error:
          authFail === 503
            ? "INVENTORY_SNAPSHOT_TOKEN not configured"
            : "Unauthorized",
      },
      { status: authFail }
    );
  }

  const q = request.nextUrl.searchParams.get("q") || "";
  if (q.trim().length < 2) return NextResponse.json({ results: [] });

  try {
    return NextResponse.json({ results: await searchTires(q, 40) });
  } catch (err) {
    console.error(`[inventory/search] failed for q=${q}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "search failed", results: [] },
      { status: 500 }
    );
  }
}
