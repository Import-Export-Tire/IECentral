import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";

/**
 * POST /api/calendar/outlook-sync
 * Pulls the user's Outlook / M365 calendar into IECentral (Phase 2).
 * Body: { userId }
 * Mirrors app/api/calendar/zoom-sync/route.ts.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await request.json();
    if (!userId) {
      return NextResponse.json({ error: "userId required", synced: 0 }, { status: 400 });
    }

    const convex = new ConvexHttpClient(CONVEX_URL);
    const result = await convex.action(api.outlookSync.pullForUser, {
      userId: userId as Id<"users">,
    });

    return NextResponse.json({ synced: result.synced ?? 0, error: result.error });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed", synced: 0 },
      { status: 500 }
    );
  }
}
