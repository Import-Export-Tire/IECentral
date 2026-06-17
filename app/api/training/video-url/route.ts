import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const BUCKET = process.env.TRAINING_S3_BUCKET || "ietires-dunlop-jmk-uploads";
const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }
    : {}),
});
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";

// GET /api/training/video-url?key=training/videos/...&userId=...
export async function GET(request: NextRequest) {
  try {
    const key = request.nextUrl.searchParams.get("key");
    const userId = request.nextUrl.searchParams.get("userId");
    if (!key || !key.startsWith("training/videos/")) return NextResponse.json({ error: "valid key required" }, { status: 400 });
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
    const videoId = request.nextUrl.searchParams.get("videoId");
    if (!videoId) return NextResponse.json({ error: "videoId required" }, { status: 400 });
    const convex = new ConvexHttpClient(CONVEX_URL);
    const ok = await convex.query(api.training.canViewVideo, { userId: userId as Id<"users">, videoId: videoId as Id<"trainingVideos"> });
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const url = await getSignedUrl(s3, command, { expiresIn: 60 * 60 * 4 });
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
