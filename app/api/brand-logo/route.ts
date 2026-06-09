import { NextRequest } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

// Brand logos live in S3 (the "database"), not the repo, so they persist + are shared
// without commits. Upload as: brand-logos/<slug>.png in this bucket. The tire label
// resolves a logo by brand name; a missing logo 404s and the label falls back to text.
// NOTE: this is the same bucket the inventory report reads — Vercel's S3 creds have
// access here (they do NOT have access to ietires-scanner-assets).
const BUCKET = process.env.BRAND_LOGO_BUCKET || "ietires-dunlop-jmk-uploads";

const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }
    : {}),
});

export const maxDuration = 30;

function slugify(s: string): string {
  return (s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const slug = (sp.get("slug") || slugify(sp.get("brand") || "")).trim();
  if (!slug) return new Response("missing slug/brand", { status: 400 });
  const key = `brand-logos/${slug}.png`;
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": res.ContentType || "image/png",
        // Cache a day at the edge/browser; logos rarely change.
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch {
    return new Response("logo not found", { status: 404 });
  }
}
