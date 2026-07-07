import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";

/**
 * Extract Zoom meeting details from email body text.
 */
function parseZoomInvite(subject: string, bodyText: string, bodyHtml: string) {
  const text = bodyText || bodyHtml?.replace(/<[^>]+>/g, " ") || "";

  // Extract Zoom join URL
  const urlMatch = text.match(/https:\/\/[\w.-]*zoom\.us\/j\/(\d+)(\?[^\s"<)]+)?/i);
  if (!urlMatch) return null;

  const joinUrl = urlMatch[0];
  const meetingId = parseInt(urlMatch[1]);

  // Extract passcode
  const passcodeMatch = text.match(/(?:passcode|password|pwd)[:\s]*(\S+)/i);
  const passcode = passcodeMatch ? passcodeMatch[1] : undefined;

  // Extract meeting time from .ics-style content or email body
  let startTime: Date | null = null;
  let endTime: Date | null = null;

  // Try DTSTART/DTEND format (from .ics content in email body)
  const dtstartMatch = text.match(/DTSTART[^:]*:(\d{8}T\d{6}Z?)/);
  const dtendMatch = text.match(/DTEND[^:]*:(\d{8}T\d{6}Z?)/);
  if (dtstartMatch) {
    const dt = dtstartMatch[1];
    startTime = new Date(`${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}T${dt.slice(9,11)}:${dt.slice(11,13)}:${dt.slice(13,15)}Z`);
  }
  if (dtendMatch) {
    const dt = dtendMatch[1];
    endTime = new Date(`${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}T${dt.slice(9,11)}:${dt.slice(11,13)}:${dt.slice(13,15)}Z`);
  }

  // Try common date/time patterns: "April 7, 2026 10:00 AM Eastern"
  if (!startTime) {
    const dateTimeMatch = text.match(
      /(?:date|time|when|start)[:\s]*(?:\w+day,?\s+)?(\w+ \d{1,2},?\s*\d{4})\s+(?:at\s+)?(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i
    );
    if (dateTimeMatch) {
      const parsed = new Date(`${dateTimeMatch[1]} ${dateTimeMatch[2]}`);
      if (!isNaN(parsed.getTime())) {
        startTime = parsed;
        endTime = new Date(parsed.getTime() + 60 * 60 * 1000); // Default 1 hour
      }
    }
  }

  // Try "Mon Apr 7, 2026 2:00 PM - 3:00 PM (EST)" pattern
  if (!startTime) {
    const rangeMatch = text.match(
      /(\w{3,9}\s+\d{1,2},?\s*\d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i
    );
    if (rangeMatch) {
      const s = new Date(`${rangeMatch[1]} ${rangeMatch[2]}`);
      const e = new Date(`${rangeMatch[1]} ${rangeMatch[3]}`);
      if (!isNaN(s.getTime())) startTime = s;
      if (!isNaN(e.getTime())) endTime = e;
    }
  }

  // Clean up title from subject line
  let title = subject
    .replace(/^(Re:|Fwd:|FW:|Invitation:)\s*/gi, "")
    .replace(/^Zoom\s*[-–]\s*/i, "")
    .trim();
  if (!title) title = "Zoom Meeting";

  return {
    title,
    joinUrl,
    meetingId,
    passcode,
    startTime,
    endTime,
  };
}

/**
 * POST /api/calendar/zoom-sync
 * Scans connected email for Zoom invites and creates calendar events.
 * Body: { userId }
 */
export async function POST(request: Request) {
  try {
    const { userId } = await request.json();
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

    const convex = new ConvexHttpClient(CONVEX_URL);

    // 1. Get user's email accounts
    const accounts = await convex.query(api.email.accounts.listByUser, { userId: userId as Id<"users"> });
    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ error: "No email accounts connected", synced: 0 });
    }

    // 2. Get existing zoom-synced events to avoid duplicates
    const existingEvents = await convex.query(api.events.listMyEvents, { userId: userId as Id<"users"> });
    // Key by string so a number-vs-string mismatch can't defeat dedup.
    const existingZoomIds = new Set(
      (existingEvents as any[])
        .filter((e: any) => e.zoomMeetingId != null)
        .map((e: any) => String(e.zoomMeetingId))
    );

    let synced = 0;
    let scanned = 0;
    const results: { title: string; date: string; status: string }[] = [];

    // 3. For each email account, find Zoom invite emails
    for (const account of accounts) {
      // Get inbox folder
      const folders = await convex.query(api.email.folders.listByAccount, { accountId: account._id });
      const inbox = (folders as any[]).find((f: any) => f.name?.toLowerCase() === "inbox" || f.type === "inbox");
      if (!inbox) continue;

      // Get recent emails (last 30 days)
      const emailResult = await convex.query(api.email.emails.listByFolder, {
        folderId: inbox._id,
        limit: 200,
      });
      const emails = (emailResult as any)?.emails || emailResult || [];

      for (const email of (emails as any[])) {
        scanned++;
        // Check if from Zoom or contains Zoom link
        // email.from is { name?, address } per convex/schema.ts — not a string
        const fromAddress = (email.from?.address || email.from?.name || "").toString();
        const fromZoom = fromAddress.toLowerCase().includes("zoom.us");
        const hasZoomLink = (email.bodyText || email.bodyHtml || "").includes("zoom.us/j/");
        if (!fromZoom && !hasZoomLink) continue;

        // Parse meeting details
        const meeting = parseZoomInvite(
          email.subject || "",
          email.bodyText || "",
          email.bodyHtml || ""
        );
        if (!meeting) continue;

        // Skip if already synced (across runs, now that zoomMeetingId is persisted)
        if (meeting.meetingId != null && existingZoomIds.has(String(meeting.meetingId))) {
          results.push({ title: meeting.title, date: meeting.startTime?.toISOString() || "unknown", status: "already exists" });
          continue;
        }

        // Skip if no valid time (use email date as fallback)
        if (!meeting.startTime) {
          if (email.date) {
            meeting.startTime = new Date(email.date);
            meeting.endTime = new Date(email.date + 60 * 60 * 1000);
          } else {
            results.push({ title: meeting.title, date: "unknown", status: "no time found" });
            continue;
          }
        }

        // Skip past meetings (more than 24h ago)
        if (meeting.startTime.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
          results.push({ title: meeting.title, date: meeting.startTime.toISOString(), status: "past meeting" });
          continue;
        }

        // 4. Create calendar event
        try {
          const numericZoomId =
            meeting.meetingId != null && !Number.isNaN(Number(meeting.meetingId))
              ? Number(meeting.meetingId)
              : undefined;
          await convex.mutation(api.events.create, {
            title: meeting.title,
            description: meeting.passcode ? `Passcode: ${meeting.passcode}` : undefined,
            startTime: meeting.startTime.getTime(),
            endTime: (meeting.endTime || new Date(meeting.startTime.getTime() + 60 * 60 * 1000)).getTime(),
            isAllDay: false,
            meetingLink: meeting.joinUrl,
            meetingType: "zoom",
            zoomMeetingId: numericZoomId,
            inviteeIds: [],
            userId: userId as Id<"users">,
          });

          if (meeting.meetingId != null) existingZoomIds.add(String(meeting.meetingId));
          synced++;
          results.push({ title: meeting.title, date: meeting.startTime.toISOString(), status: "created" });
        } catch (err) {
          results.push({ title: meeting.title, date: meeting.startTime.toISOString(), status: `error: ${err instanceof Error ? err.message : "unknown"}` });
        }
      }
    }

    return NextResponse.json({ synced, scanned, results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Sync failed" }, { status: 500 });
  }
}
