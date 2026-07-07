import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const BUCKET = "iecentral-meeting-recordings";
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";

function getS3Client() {
  return new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, meetingId, filename, userId } = body;

    if (!meetingId) {
      return NextResponse.json({ error: "meetingId is required" }, { status: 400 });
    }

    // Access control: only the host or a participant of THIS meeting may get a
    // presigned URL. Without this, anyone with a meeting ID could download the raw
    // audio of a private meeting or overwrite its recording.
    if (!userId) {
      return NextResponse.json({ error: "Sign-in required" }, { status: 401 });
    }
    const convex = new ConvexHttpClient(CONVEX_URL);
    const allowed = await convex.query(api.meetingParticipants.isMember, {
      meetingId: meetingId as Id<"meetings">,
      userId: userId as Id<"users">,
    });
    if (!allowed) {
      return NextResponse.json({ error: "Not authorized for this meeting" }, { status: 403 });
    }

    const s3 = getS3Client();
    const key = `recordings/${meetingId}/${filename || "audio.webm"}`;

    if (action === "download") {
      const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
      const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
      return NextResponse.json({ url, key });
    }

    // Default: generate upload URL
    const command = new PutObjectCommand({ Bucket: BUCKET, Key: key });
    const url = await getSignedUrl(s3, command, { expiresIn: 900 });
    return NextResponse.json({ url, key });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
