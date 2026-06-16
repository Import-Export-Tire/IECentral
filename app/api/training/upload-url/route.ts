import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export const maxDuration = 30;

// Dedicated training bucket when TRAINING_S3_BUCKET is set; otherwise a segmented
// prefix in the shared bucket. Switching to a dedicated bucket later = set the env var only.
const BUCKET = process.env.TRAINING_S3_BUCKET || "ietires-dunlop-jmk-uploads";
const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }
    : {}),
});
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function POST(request: NextRequest) {
  try {
    const { filename, contentType, userId } = await request.json();
    if (!filename || !userId) return NextResponse.json({ error: "filename and userId required" }, { status: 400 });
    const ok = await convex.query(api.training.hasTrainingAccess, { userId: userId as Id<"users"> });
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const sanitized = String(filename).replace(/[^a-zA-Z0-9._() -]/g, "_");
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const key = `training/videos/${unique}-${sanitized}`;
    const command = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType || "video/mp4" });
    const url = await getSignedUrl(s3, command, { expiresIn: 900 });
    return NextResponse.json({ url, key });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
