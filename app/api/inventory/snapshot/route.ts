import { NextRequest, NextResponse } from "next/server";
import { checkInventoryToken } from "@/lib/inventoryAuth";
import { readLocationSnapshot, SnapshotCacheMissing } from "@/lib/inventorySnapshot";

export const maxDuration = 60;

/**
 * GET /api/inventory/snapshot?location=W09
 *
 * Countable tire stock for one location, from the OEIVAL cache, with JMK
 * placeholder/non-tire product types excluded. Consumed by TireTrack's
 * count-batch open action to freeze an immutable comparison baseline.
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

  const location = request.nextUrl.searchParams.get("location") || "";
  if (!/^[A-Za-z0-9]{2,8}$/.test(location)) {
    return NextResponse.json({ error: "location required, e.g. W09" }, { status: 400 });
  }

  try {
    const snap = await readLocationSnapshot(location);
    // Logged because a wrong count here silently produces a wrong variance
    // report. Seeing 485 instead of 480 for W09 means the tire filter regressed.
    console.log(
      `[inventory/snapshot] ${snap.location} file=${snap.fileDate} ` +
        `items=${snap.count} excludedNonTires=${snap.excludedNonTires} ` +
        `excludedUnits=${snap.excludedUnits}`
    );
    return NextResponse.json(snap);
  } catch (err) {
    if (err instanceof SnapshotCacheMissing) {
      console.warn(`[inventory/snapshot] cache missing for ${location}: ${err.message}`);
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error(`[inventory/snapshot] failed for ${location}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "snapshot failed" },
      { status: 500 }
    );
  }
}
