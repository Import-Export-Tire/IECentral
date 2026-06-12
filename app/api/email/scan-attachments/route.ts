import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";

/**
 * POST /api/email/scan-attachments
 * Scans all emails with hasAttachments=true but no attachment records,
 * fetches full source from IMAP, and creates attachment records.
 */
export async function POST(request: NextRequest) {
  const convex = new ConvexHttpClient(CONVEX_URL);
  let client: InstanceType<typeof ImapFlow> | null = null;

  try {
    // Get the account
    const accounts = await convex.query(api.email.accounts.listByUser, {
      userId: "jd711szqxd2fb870qa5cr92nts7xdxxh" as Id<"users">,
    });
    if (!accounts?.length) return NextResponse.json({ error: "No email accounts" });
    const account = accounts[0];

    // Get IMAP password from request body
    const body = await request.json().catch(() => ({}));
    const imapPassword = body.password;
    if (!imapPassword) return NextResponse.json({ error: "password required in body" }, { status: 400 });
    const imapHost = "svm.ietires.com";
    const imapPort = 993;

    // Get inbox folder
    const folders = await convex.query(api.email.folders.listByAccount, { accountId: account._id });
    const inbox = (folders as any[]).find((f: any) => f.type === "inbox" || f.name?.toLowerCase() === "inbox");
    if (!inbox) return NextResponse.json({ error: "No inbox folder" });

    // Get emails with hasAttachments but no attachment records
    const emailResult = await convex.query(api.email.emails.listByFolder, { folderId: inbox._id, limit: 200 });
    const emails = (emailResult as any)?.emails || [];
    const needsScan = emails.filter((e: any) => e.hasAttachments && (!e.attachments || e.attachments.length === 0));

    if (needsScan.length === 0) {
      return NextResponse.json({ message: "No emails need attachment scanning", total: emails.length });
    }

    // Connect to IMAP
    client = new ImapFlow({
      host: imapHost,
      port: imapPort,
      secure: true,
      proxy: process.env.EMAIL_PROXY_URL, // static-IP proxy for IMAP egress when set
      auth: { user: account.emailAddress, pass: imapPassword },
      logger: false,
    });
    await client.connect();

    const lock = await client.getMailboxLock("INBOX");
    const results: { subject: string; attachments: string[]; status: string }[] = [];

    try {
      for (const email of needsScan) {
        try {
          // Fetch full source by UID
          const msg = await client.fetchOne(String(email.uid), { source: true }, { uid: true });
          if (!msg || !(msg as any).source) {
            results.push({ subject: email.subject, attachments: [], status: "no source" });
            continue;
          }

          const parsed = await simpleParser((msg as any).source);
          if (!parsed.attachments || parsed.attachments.length === 0) {
            results.push({ subject: email.subject, attachments: [], status: "no attachments in source" });
            continue;
          }

          // Create attachment records
          for (const att of parsed.attachments) {
            await convex.mutation(api.email.emails.createAttachmentPublic, {
              emailId: email._id,
              fileName: att.filename || `attachment.${(att.contentType || "").split("/")[1] || "bin"}`,
              mimeType: att.contentType || "application/octet-stream",
              size: att.size || 0,
              contentId: att.contentId || undefined,
              isInline: false,
            });
          }

          results.push({
            subject: email.subject,
            attachments: parsed.attachments.map(a => a.filename || "unnamed"),
            status: "created",
          });
        } catch (err) {
          results.push({
            subject: email.subject,
            attachments: [],
            status: `error: ${err instanceof Error ? err.message : "unknown"}`,
          });
        }
      }
    } finally {
      lock.release();
    }

    return NextResponse.json({
      scanned: needsScan.length,
      results,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  } finally {
    if (client) try { await client.logout(); } catch {}
  }
}
