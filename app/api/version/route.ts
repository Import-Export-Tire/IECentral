import { NextResponse } from "next/server";

// Always evaluated at request time so it reflects the CURRENTLY-deployed build,
// never a cached value. The client's UpdateBanner records the version it booted
// with and compares against this to detect a new deploy.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const version =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    "dev";
  return NextResponse.json(
    { version },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
