import { NextResponse } from "next/server";
import { S3Client, ListObjectsV2Command, GetObjectCommand, ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = "ietires-dunlop-jmk-uploads";

const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }
    : {}),
});

/**
 * GET /api/dealer-rebates/list
 * Lists auto-generated dealer rebate CSVs from S3 with download URLs.
 */
export async function GET() {
  try {
    const reports: {
      program: string;
      fileName: string;
      key: string;
      size: number;
      date: string;
      downloadUrl: string;
    }[] = [];

    for (const program of ["falken", "milestar"]) {
      const prefix = `dealer-rebates/${program}/`;
      let continuationToken: string | undefined = undefined;

      do {
        const res: ListObjectsV2CommandOutput = await s3.send(
            new ListObjectsV2Command({
              Bucket: BUCKET,
              Prefix: prefix,
              ContinuationToken: continuationToken,
            })
        );

        for (const obj of res.Contents || []) {
          if (!obj.Key || !obj.Key.endsWith(".csv")) continue;
          const fileName = obj.Key.split("/").pop() || "report.csv";
          const downloadUrl = await getSignedUrl(
              s3,
              new GetObjectCommand({
                Bucket: BUCKET,
                Key: obj.Key,
                ResponseContentDisposition: `attachment; filename="${fileName}"`,
                ResponseContentType: "text/csv",
              }),
              { expiresIn: 3600 }
          );
          reports.push({
            program: program === "falken" ? "Falken Fanatic" : "Milestar Momentum",
            fileName,
            key: obj.Key,
            size: obj.Size || 0,
            date: obj.LastModified?.toISOString() || "",
            downloadUrl,
          });
        }

        continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (continuationToken);
    }

    reports.sort((a, b) => b.date.localeCompare(a.date));

    return NextResponse.json({ reports });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to list reports" }, { status: 500 });
  }
}
