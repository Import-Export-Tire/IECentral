import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import sharp from "sharp";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";
const SECRET = process.env.PREVIEW_PDF_SECRET;

export const maxDuration = 60;
export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024; // reject absurd uploads before processing

/**
 * POST /api/safety-reports/photo  (public; body = raw image bytes)
 *
 * Accepts an optional photo for an anonymous safety report. Re-encodes it with sharp —
 * which auto-rotates, caps the size, and **drops all EXIF/metadata** (GPS, timestamp,
 * device) so the photo can't deanonymize the reporter — then stores it in Convex and
 * returns { fileId } for the form to attach on submit.
 */
export async function POST(request: NextRequest) {
  if (!SECRET) return new Response("not configured", { status: 503 });
  try {
    const inputType = request.headers.get("content-type") || "";
    if (!inputType.startsWith("image/")) return new Response("expected an image", { status: 400 });
    const buf = Buffer.from(await request.arrayBuffer());
    if (!buf.length) return new Response("empty body", { status: 400 });
    if (buf.length > MAX_BYTES) return new Response("image too large", { status: 413 });

    // Re-encode: strip metadata (default), auto-rotate per the original orientation, cap to
    // 1600px on the long edge, output JPEG. No .withMetadata() call = no EXIF carried over.
    let out: Buffer;
    try {
      out = await sharp(buf)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch {
      return new Response("could not process image", { status: 422 });
    }

    const convex = new ConvexHttpClient(CONVEX_URL);
    const uploadUrl = (await convex.mutation(api.safetyReports.generatePhotoUploadUrl, { secret: SECRET })) as string;
    const up = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array(out) });
    if (!up.ok) return new Response("storage upload failed", { status: 502 });
    const { storageId } = (await up.json()) as { storageId: string };

    return Response.json({ fileId: storageId as Id<"_storage"> });
  } catch (err) {
    console.error("[safety-reports/photo] failed:", err instanceof Error ? err.message : err);
    return new Response(err instanceof Error ? err.message : "error", { status: 500 });
  }
}
