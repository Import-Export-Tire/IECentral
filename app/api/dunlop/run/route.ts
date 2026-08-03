import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { sendPipelineAlert } from "@/lib/pipelineAlert";

const API_GATEWAY_URL = process.env.DUNLOP_API_GATEWAY_URL || "https://jzdhz2de88.execute-api.us-east-1.amazonaws.com/prod";

function getConvex() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";
  return new ConvexHttpClient(url);
}

export async function POST(request: NextRequest) {
  // Hoisted so the catch block can name the month in its alert.
  let month: string | undefined;
  try {
    const body = await request.json();
    const { s3_key, env, runBy } = body;
    month = body.month;

    if (!s3_key || !month || !env) {
      return NextResponse.json(
        { error: "s3_key, month, and env are required" },
        { status: 400 }
      );
    }

    // Fetch Falken Fanatic dealer JMK list from Convex for exclusion
    let fanaticJmks: string[] = [];
    try {
      const convex = getConvex();
      const dealers = await convex.query(api.dealerRebates.listDealers, {
        program: "falken",
        activeOnly: true,
      });
      fanaticJmks = dealers
        .filter((d: { fanaticId?: number }) => d.fanaticId)
        .map((d: { jmk: string }) => d.jmk.toLowerCase().trim())
        .filter((jmk: string) => jmk && jmk !== "0");
    } catch {
      // If Convex is unavailable, proceed without exclusions
    }

    const res = await fetch(`${API_GATEWAY_URL}/dunlop/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ s3_key, month, env, runBy, fanaticJmks }),
    });

    if (!res.ok) {
      const err = await res.text();
      await sendPipelineAlert({
        subject: `Dunlop submission FAILED to run for ${month}`,
        lines: [
          `The Dunlop run endpoint returned HTTP ${res.status} — nothing was submitted.`,
          `month: ${month}`, `s3_key: ${s3_key}`, `env: ${env}`, `runBy: ${runBy ?? "(unset)"}`,
          "", err.slice(0, 2000),
        ],
      });
      return NextResponse.json({ error: err }, { status: res.status });
    }

    const data = await res.json();

    // Alert on a recorded SFTP failure. July 2026 failed on Aug 1, was written to
    // history with sftpStatus "failed", rendered as a red badge in the UI — and sat
    // unnoticed for two days because nothing routed it to a person. The run is
    // already recorded either way; this only adds the notification.
    if (data?.sftpStatus && data.sftpStatus !== "success") {
      await sendPipelineAlert({
        subject: `Dunlop SFTP ${String(data.sftpStatus).toUpperCase()} for ${month}`,
        lines: [
          `Dunlop did NOT receive the ${month} sellout report.`,
          `sftpStatus: ${data.sftpStatus}`,
          `sourceFile: ${data.fileName ?? s3_key}`,
          `outputFile: ${data.outputFile ?? "(none)"}`,
          `rows: ${data.rows ?? "(unknown)"}`,
          `env: ${data.env ?? env}`,
          `runBy: ${data.runBy ?? runBy ?? "(unset)"}`,
          ...(Array.isArray(data.errors) && data.errors.length
            ? ["", "errors:", ...data.errors.map((e: unknown) => `- ${String(e)}`)]
            : []),
          "",
          "Resubmit by pointing /api/dunlop/run at the correct monthly file for that month.",
        ],
      });
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await sendPipelineAlert({
      subject: `Dunlop submission ERRORED for ${month ?? "(unknown month)"}`,
      lines: ["The submission threw before completing, so delivery is unconfirmed.", "", message],
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
