import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";
const LAMBDA_URL = process.env.OFFICE_PDF_LAMBDA_URL;
const SECRET = process.env.PREVIEW_PDF_SECRET;

// LibreOffice cold-converts can take a while; give the whole round-trip room.
export const maxDuration = 60;

const PDF_HEADERS = (fileName: string) => ({
  "Content-Type": "application/pdf",
  "Content-Disposition": `inline; filename="${fileName.replace(/["\r\n]/g, "")}.pdf"`,
  // Cache the rendition in the browser too; the canonical cache is the stored PDF.
  "Cache-Control": "private, max-age=300",
});

/**
 * GET /api/documents/office-pdf?id=<documentId>
 *
 * Returns a PDF rendition of an Office doc (Word/Excel/PowerPoint) so it can preview
 * and print inline like any other PDF — no third-party viewer, nothing leaves our infra.
 * Renditions are produced once by an in-house LibreOffice Lambda and cached in Convex
 * storage (documents.previewPdfFileId); subsequent requests stream the cached PDF.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return new Response("missing id", { status: 400 });
  const docId = id as Id<"documents">;

  try {
    const convex = new ConvexHttpClient(CONVEX_URL);
    const doc = (await convex.query(api.documents.getById, { documentId: docId })) as
      | { fileName?: string; name?: string; fileType?: string }
      | null;
    if (!doc) return new Response("not found", { status: 404 });

    const fileName = (doc.fileName || doc.name || "document").replace(/\.[^.]+$/, "");

    // 1) Cache hit — stream the stored rendition.
    const cachedUrl = await convex.action(api.documents.getPreviewPdfUrl, { documentId: docId });
    if (cachedUrl) {
      const cached = await fetch(cachedUrl);
      if (cached.ok && cached.body) {
        return new Response(cached.body, { status: 200, headers: PDF_HEADERS(fileName) });
      }
      // fall through to re-convert if the cached object vanished
    }

    // 2) Need to convert — requires the Lambda to be configured.
    if (!LAMBDA_URL || !SECRET) {
      return new Response("conversion not configured", { status: 503 });
    }

    // Fetch the original Office file bytes.
    const srcUrl = await convex.action(api.documents.getFileDownloadUrl, { documentId: docId });
    if (!srcUrl) return new Response("source unavailable", { status: 404 });
    const srcResp = await fetch(srcUrl);
    if (!srcResp.ok) return new Response("source fetch failed", { status: 502 });
    const srcBuf = Buffer.from(await srcResp.arrayBuffer());

    // 3) Convert via the LibreOffice Lambda.
    const lambdaResp = await fetch(LAMBDA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-convert-secret": SECRET },
      body: JSON.stringify({ filename: doc.fileName || `${fileName}.docx`, contentBase64: srcBuf.toString("base64") }),
    });
    if (!lambdaResp.ok) {
      const detail = await lambdaResp.text().catch(() => "");
      return new Response(`conversion failed: ${detail.slice(0, 300)}`, { status: 502 });
    }
    const { pdfBase64 } = (await lambdaResp.json()) as { pdfBase64?: string };
    if (!pdfBase64) return new Response("conversion returned no pdf", { status: 502 });
    const pdfBuf = Buffer.from(pdfBase64, "base64");

    // 4) Cache the rendition in Convex storage and link it to the document.
    try {
      const uploadUrl = (await convex.mutation(api.documents.generatePreviewUploadUrl, { secret: SECRET })) as string;
      const up = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: pdfBuf,
      });
      if (up.ok) {
        const { storageId } = (await up.json()) as { storageId: string };
        await convex.mutation(api.documents.setPreviewPdf, {
          documentId: docId,
          fileId: storageId as Id<"_storage">,
          secret: SECRET,
        });
      }
    } catch {
      // Caching is best-effort; we still serve the freshly converted PDF below.
    }

    // 5) Stream the freshly converted PDF.
    return new Response(pdfBuf, { status: 200, headers: PDF_HEADERS(fileName) });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "error", { status: 500 });
  }
}
