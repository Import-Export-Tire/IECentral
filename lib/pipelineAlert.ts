// lib/pipelineAlert.ts
//
// One place to raise a human-visible alert when a sellout-pipeline run goes wrong.
//
// Exists because every failure in the 2026-08-03 incident was SILENT rather than
// subtle: five production deploys failed over an hour, July's Dunlop SFTP failed
// on Aug 1 and sat visible-but-unread in a table for two days, a monthly upload
// overwrote a daily submission file, and dedup quietly dropped 6 tires. In every
// case the system recorded the problem and nothing routed it to a person.
//
// Recipients come from PIPELINE_ALERT_TO (comma-separated). If it is unset the
// alert is logged loudly instead of silently dropped — and callers should still
// surface failure through their own status code, never rely on the email alone.

const FROM = "Import Export Tire Co <alerts@notifications.iecentral.com>";

export interface PipelineAlert {
  /** Short, specific subject line — this is what someone sees in their inbox. */
  subject: string;
  /** One fact per line. Include the numbers; "something failed" is not actionable. */
  lines: string[];
}

export async function sendPipelineAlert({ subject, lines }: PipelineAlert): Promise<
  { sent: true; to: string[] } | { sent: false; reason: string }
> {
  const to = (process.env.PIPELINE_ALERT_TO || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const body = lines.join("\n");

  if (to.length === 0) {
    console.error(
      `[pipeline-alert] PIPELINE_ALERT_TO is unset — alert NOT delivered.\n${subject}\n${body}`,
    );
    return { sent: false, reason: "PIPELINE_ALERT_TO is not configured" };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error(`[pipeline-alert] RESEND_API_KEY is unset — alert NOT delivered.\n${subject}\n${body}`);
    return { sent: false, reason: "RESEND_API_KEY is not configured" };
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: FROM,
      to,
      subject,
      text: body,
    });
    return { sent: true, to };
  } catch (e) {
    // Never let alerting failure mask the thing being alerted about.
    console.error("[pipeline-alert] send failed", e, subject, body);
    return { sent: false, reason: String(e) };
  }
}
