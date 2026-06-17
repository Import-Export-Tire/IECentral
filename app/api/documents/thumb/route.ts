import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";

export const maxDuration = 60;

/**
 * GET /api/documents/thumb?id=<documentId>
 *
 * Streams the cached page-1 PNG preview for a document (see /api/documents/thumbnail for
 * generation). Returns 404 when the doc has no thumbnail yet — the card's <img onError>
 * then falls back to the file-type icon.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return new Response("missing id", { status: 400 });
  try {
    const convex = new ConvexHttpClient(CONVEX_URL);
    const url = await convex.action(api.documents.getThumbnailUrl, { documentId: id as Id<"documents"> });
    if (!url) return new Response("no thumbnail", { status: 404 });

    const upstream = await fetch(url);
    if (!upstream.ok || !upstream.body) return new Response("upstream fetch failed", { status: 502 });

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (err) {
    console.error(`[thumb] failed for ${id}:`, err instanceof Error ? err.message : err);
    return new Response(err instanceof Error ? err.message : "error", { status: 500 });
  }
}
