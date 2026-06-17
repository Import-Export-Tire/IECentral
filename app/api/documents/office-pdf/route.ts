import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";
const SECRET = process.env.PREVIEW_PDF_SECRET;
// The converter Lambda is private — invoked directly via the SDK with a dedicated
// invoke-only IAM user (no public endpoint, since Doc Hub holds HR PII).
const LAMBDA_FN = process.env.OFFICE_PDF_LAMBDA_FUNCTION || "office-to-pdf";
const LAMBDA_REGION = process.env.OFFICE_PDF_AWS_REGION || process.env.S3_REGION || "us-east-1";
const LAMBDA_KEY = process.env.OFFICE_PDF_AWS_ACCESS_KEY_ID;
const LAMBDA_SECRET = process.env.OFFICE_PDF_AWS_SECRET_ACCESS_KEY;

// LibreOffice cold-converts can take a while; give the whole round-trip room.
// 60s was too tight for cold starts (the route got killed mid-conversion); 300s is the Pro/Fluid max.
export const maxDuration = 300;

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

    // 2) Need to convert — requires the Lambda + invoke creds to be configured.
    if (!SECRET || !LAMBDA_KEY || !LAMBDA_SECRET) {
      return new Response("conversion not configured", { status: 503 });
    }

    // Fetch the original Office file bytes.
    const srcUrl = await convex.action(api.documents.getFileDownloadUrl, { documentId: docId });
    if (!srcUrl) return new Response("source unavailable", { status: 404 });
    const srcResp = await fetch(srcUrl);
    if (!srcResp.ok) return new Response("source fetch failed", { status: 502 });
    const srcBuf = Buffer.from(await srcResp.arrayBuffer());

    // 3) Convert via the private LibreOffice Lambda (direct SDK invoke; IAM is the
    // boundary, the secret is passed in-payload as defense in depth).
    const lambda = new LambdaClient({
      region: LAMBDA_REGION,
      credentials: { accessKeyId: LAMBDA_KEY, secretAccessKey: LAMBDA_SECRET },
    });
    const invoked = await lambda.send(
      new InvokeCommand({
        FunctionName: LAMBDA_FN,
        Payload: Buffer.from(
          JSON.stringify({
            secret: SECRET,
            filename: doc.fileName || `${fileName}.docx`,
            contentBase64: srcBuf.toString("base64"),
          })
        ),
      })
    );
    if (invoked.FunctionError || !invoked.Payload) {
      return new Response(`conversion failed: ${invoked.FunctionError || "no payload"}`, { status: 502 });
    }
    // The handler returns proxy-style { statusCode, body: JSON.stringify({pdfBase64}) }.
    const outer = JSON.parse(Buffer.from(invoked.Payload).toString("utf8")) as { statusCode?: number; body?: string };
    if (outer.statusCode && outer.statusCode >= 400) {
      return new Response(`conversion failed: ${(outer.body || "").slice(0, 300)}`, { status: 502 });
    }
    const { pdfBase64 } = JSON.parse(outer.body || "{}") as { pdfBase64?: string };
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
