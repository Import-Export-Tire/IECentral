import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { resolveFileType, isTextType } from "@/lib/fileTypes";

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
    // Derive a usable type from the extension when the stored type is generic
    // (octet-stream / x-msdownload), so the browser embeds PDFs/images instead of
    // downloading them. Add a UTF-8 charset for text so non-ASCII content isn't
    // mis-decoded as Latin-1.
    let contentType = resolveFileType(doc.fileType, doc.fileName) || upstream.headers.get("content-type") || "application/octet-stream";
    if (isTextType(contentType) && !contentType.includes("charset")) contentType += "; charset=utf-8";
    // RFC 5987: keep a sanitized ASCII filename and add a UTF-8-encoded one for non-ASCII names.
    const asciiName = fileName.replace(/[^\x20-\x7E]/g, "_");

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${asDownload ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "error", { status: 500 });
  }
}
