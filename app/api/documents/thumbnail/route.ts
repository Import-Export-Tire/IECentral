import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { resolveFileType, isTextType } from "@/lib/fileTypes";
import sharp from "sharp";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";
const SECRET = process.env.PREVIEW_PDF_SECRET;
const LAMBDA_FN = process.env.OFFICE_PDF_LAMBDA_FUNCTION || "office-to-pdf";
const LAMBDA_REGION = process.env.OFFICE_PDF_AWS_REGION || process.env.S3_REGION || "us-east-1";
const LAMBDA_KEY = process.env.OFFICE_PDF_AWS_ACCESS_KEY_ID;
const LAMBDA_SECRET = process.env.OFFICE_PDF_AWS_SECRET_ACCESS_KEY;

// Office conversion can cold-start the LibreOffice Lambda; give the whole job room.
export const maxDuration = 300;
export const runtime = "nodejs";

const THUMB_WIDTH = 480; // px — sharp downscale target for the card image

const OFFICE_MIMES = [
  "msword",
  "wordprocessingml",
  "ms-excel",
  "spreadsheetml",
  "ms-powerpoint",
  "presentationml",
  "opendocument",
];

/** Render page 1 of a PDF to a downscaled PNG. Returns null on any failure. */
async function pdfFirstPagePng(pdfBytes: Buffer): Promise<Buffer | null> {
  try {
    const { pdf } = await import("pdf-to-img");
    const doc = await pdf(pdfBytes, { scale: 2 });
    const page = await doc.getPage(1); // 1-indexed; PNG Buffer
    return await sharp(page).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).png().toBuffer();
  } catch {
    return null;
  }
}

/** Convert an Office doc to PDF via the private LibreOffice Lambda and cache it on the doc. */
async function officeToPdf(
  convex: ConvexHttpClient,
  docId: Id<"documents">,
  fileName: string,
  srcBuf: Buffer,
): Promise<Buffer | null> {
  if (!SECRET || !LAMBDA_KEY || !LAMBDA_SECRET) return null;
  try {
    const lambda = new LambdaClient({
      region: LAMBDA_REGION,
      credentials: { accessKeyId: LAMBDA_KEY, secretAccessKey: LAMBDA_SECRET },
    });
    const invoked = await lambda.send(
      new InvokeCommand({
        FunctionName: LAMBDA_FN,
        Payload: Buffer.from(
          JSON.stringify({ secret: SECRET, filename: fileName, contentBase64: srcBuf.toString("base64") }),
        ),
      }),
    );
    if (invoked.FunctionError || !invoked.Payload) return null;
    const outer = JSON.parse(Buffer.from(invoked.Payload).toString("utf8")) as { statusCode?: number; body?: string };
    if (outer.statusCode && outer.statusCode >= 400) return null;
    const { pdfBase64 } = JSON.parse(outer.body || "{}") as { pdfBase64?: string };
    if (!pdfBase64) return null;
    const pdfBuf = Buffer.from(pdfBase64, "base64");

    // Cache the PDF rendition so the preview modal opens this Office doc instantly.
    try {
      const uploadUrl = (await convex.mutation(api.documents.generatePreviewUploadUrl, { secret: SECRET })) as string;
      const up = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: pdfBuf });
      if (up.ok) {
        const { storageId } = (await up.json()) as { storageId: string };
        await convex.mutation(api.documents.setPreviewPdf, {
          documentId: docId,
          fileId: storageId as Id<"_storage">,
          secret: SECRET,
        });
      }
    } catch {
      /* caching is best-effort */
    }
    return pdfBuf;
  } catch {
    return null;
  }
}

/**
 * POST /api/documents/thumbnail  body: { id: documentId }   header: x-preview-secret
 *
 * Generates and caches a page-1 PNG preview for a document, server-side:
 *  - image      → downscaled PNG
 *  - PDF        → page 1 rendered to PNG
 *  - Office doc → converted to PDF (cached), then page 1 rendered to PNG
 * Best-effort: any failure leaves the doc without a thumbnail (card shows its icon).
 */
export async function POST(request: NextRequest) {
  // This route is the trusted server-side holder of PREVIEW_PDF_SECRET (used for its own
  // Convex calls below). Callers only ask us to generate a thumbnail for an existing doc id —
  // idempotent and harmless — so no inbound secret is required.
  if (!SECRET) return new Response("not configured", { status: 503 });

  let id: string | undefined;
  try {
    ({ id } = (await request.json()) as { id?: string });
  } catch {
    /* fall through */
  }
  if (!id) return new Response("missing id", { status: 400 });
  const docId = id as Id<"documents">;

  try {
    const convex = new ConvexHttpClient(CONVEX_URL);
    const doc = (await convex.query(api.documents.getById, { documentId: docId })) as
      | { fileName?: string; name?: string; fileType?: string }
      | null;
    if (!doc) return new Response("not found", { status: 404 });

    const mime = resolveFileType(doc.fileType, doc.fileName).toLowerCase();
    const isImage = mime.startsWith("image/");
    const isPdf = mime.includes("pdf");
    const isOffice = OFFICE_MIMES.some((m) => mime.includes(m));
    // Text/markdown/csv/json/etc. are rendered to a readable page via the same Lambda
    // (LibreOffice) by handing it a .txt, then page-1 → PNG like any other doc.
    const isText = !isImage && !isPdf && !isOffice && isTextType(mime);
    if (!isImage && !isPdf && !isOffice && !isText) return new Response(null, { status: 204 }); // no body allowed on 204

    // Fetch the original file bytes.
    const docWithFile = doc as { fileName?: string; name?: string; fileType?: string; fileId?: string } | null;
    if (!docWithFile?.fileId) return new Response("source unavailable", { status: 404 });
    const srcUrl = await convex.query(api.documents.getDownloadUrl, { fileId: docWithFile.fileId as Id<"_storage"> });
    if (!srcUrl) return new Response("source unavailable", { status: 404 });
    const srcResp = await fetch(srcUrl);
    if (!srcResp.ok) return new Response("source fetch failed", { status: 502 });
    const srcBuf = Buffer.from(await srcResp.arrayBuffer());

    // Produce the PNG.
    let png: Buffer | null = null;
    if (isImage) {
      try {
        png = await sharp(srcBuf).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).png().toBuffer();
      } catch {
        png = null;
      }
    } else if (isPdf) {
      png = await pdfFirstPagePng(srcBuf);
    } else {
      // Office docs keep their real extension; text-likes are forced to .txt so LibreOffice
      // renders them as a plain-text page rather than failing on an unknown type (e.g. .md).
      const base = (doc.fileName || doc.name || "document").replace(/\.[^.]+$/, "");
      const lambdaName = isText ? `${base}.txt` : doc.fileName || `${base}.docx`;
      const pdfBuf = await officeToPdf(convex, docId, lambdaName, srcBuf);
      if (pdfBuf) png = await pdfFirstPagePng(pdfBuf);
    }
    if (!png) {
      console.warn(`[thumbnail] generation produced no image for ${docId} (${mime})`);
      return new Response("generation failed", { status: 502 });
    }

    // Store the thumbnail and link it to the document.
    const uploadUrl = (await convex.mutation(api.documents.generateThumbnailUploadUrl, { secret: SECRET })) as string;
    const up = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "image/png" }, body: new Uint8Array(png) });
    if (!up.ok) return new Response("thumbnail upload failed", { status: 502 });
    const { storageId } = (await up.json()) as { storageId: string };
    await convex.mutation(api.documents.setThumbnail, {
      documentId: docId,
      fileId: storageId as Id<"_storage">,
      secret: SECRET,
    });

    return Response.json({ ok: true });
  } catch (err) {
    console.error(`[thumbnail] failed for ${docId}:`, err instanceof Error ? err.message : err);
    return new Response(err instanceof Error ? err.message : "error", { status: 500 });
  }
}
