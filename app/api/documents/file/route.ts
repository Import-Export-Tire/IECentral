import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";

export const maxDuration = 60;

/**
 * GET /api/documents/file?id=<documentId>[&dl=1]
 *
 * Same-origin proxy for a Doc Hub file. Streams the file from Convex storage with
 * the correct Content-Type and an INLINE Content-Disposition by default — so it
 * embeds/prints in the browser instead of triggering a download (dl=1 forces a
 * download). Being same-origin also avoids the CORS / X-Frame-Options issues that
 * broke the previous direct-to-storage preview embeds.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return new Response("missing id", { status: 400 });
  const asDownload = request.nextUrl.searchParams.get("dl") === "1";
  try {
    const convex = new ConvexHttpClient(CONVEX_URL);
    const doc = (await convex.query(api.documents.getById, { documentId: id as Id<"documents"> })) as
      | { fileName?: string; name?: string; fileType?: string }
      | null;
    if (!doc) return new Response("not found", { status: 404 });
    const url = await convex.action(api.documents.getFileDownloadUrl, { documentId: id as Id<"documents"> });
    if (!url) return new Response("file unavailable", { status: 404 });

    const upstream = await fetch(url);
    if (!upstream.ok || !upstream.body) return new Response("upstream fetch failed", { status: 502 });

    const fileName = (doc.fileName || doc.name || "file").replace(/["\r\n]/g, "");
    const contentType = doc.fileType || upstream.headers.get("content-type") || "application/octet-stream";

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${asDownload ? "attachment" : "inline"}; filename="${fileName}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "error", { status: 500 });
  }
}
