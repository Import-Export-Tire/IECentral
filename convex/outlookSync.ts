"use node";

/**
 * Outlook / M365 calendar sync — Phase 2: PULL (Outlook -> IECentral).
 *
 * Mirrors `convex/zoomMeetings.ts`: a "use node" action that reads the account
 * with its ENCRYPTED tokens via an internalQuery, decrypts them here (Node
 * crypto only), refreshes the OAuth token when near expiry, calls Microsoft
 * Graph `calendarView`, and upserts the results via internal mutations.
 *
 * INVARIANTS
 *  - Tokens stay encrypted at rest: decrypt() is only ever called inside this
 *    node action; refreshed tokens are re-encrypt()'d before persisting.
 *  - The pull NEVER modifies IECentral-origin events. Every write goes through
 *    upsertPulledEvent / markPulledCancelled which are scoped to
 *    syncSource === "outlook" rows deduped by outlookEventId.
 *  - Refresh failure / invalid_grant -> mark reconnect_required + deactivate.
 *  - Per-account failures in the cron are isolated (try/catch per account).
 *
 * Ships DORMANT-SAFE: the cron/action only touch `outlookAccounts` rows, which
 * are empty until a user connects (gated on Azure consent).
 */

import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { decrypt, encrypt } from "../lib/email/encryption";

const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_CALENDAR_VIEW = "https://graph.microsoft.com/v1.0/me/calendarView";
const GRAPH_EVENTS = "https://graph.microsoft.com/v1.0/me/events";

// Calendar scopes (match the Phase-1 connect route).
const SCOPES = [
  "offline_access",
  "https://graph.microsoft.com/Calendars.ReadWrite",
  "https://graph.microsoft.com/User.Read",
].join(" ");

const WINDOW_BACK_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const WINDOW_FWD_MS = 180 * 24 * 60 * 60 * 1000; // 180 days
const MAX_PAGES = 10;

// Phase 3 PUSH window is FORWARD-ONLY: we only sync upcoming events out to
// Outlook (now - 1d ... now + 180d). This deliberately avoids dumping the user's
// entire IECentral history into their Outlook calendar.
const PUSH_WINDOW_BACK_MS = 1 * 24 * 60 * 60 * 1000; // 1 day (grace for events that just started)
const PUSH_WINDOW_FWD_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

interface GraphDateTime {
  dateTime?: string;
  timeZone?: string;
}
interface GraphEvent {
  id: string;
  iCalUId?: string;
  subject?: string;
  bodyPreview?: string;
  start?: GraphDateTime;
  end?: GraphDateTime;
  isAllDay?: boolean;
  isCancelled?: boolean;
  location?: { displayName?: string };
  onlineMeeting?: { joinUrl?: string } | null;
  webLink?: string;
}

/**
 * Parse a Graph dateTime as UTC ms. We request Prefer: outlook.timezone="UTC",
 * so values come back in UTC but often WITHOUT a trailing offset — append "Z"
 * if there's no explicit offset/zone.
 */
function parseGraphUtcMs(dt: GraphDateTime | undefined): number | null {
  if (!dt?.dateTime) return null;
  let s = dt.dateTime;
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasZone) s = s + "Z";
  const ms = new Date(s).getTime();
  return isNaN(ms) ? null : ms;
}

/**
 * Map an IECentral event row (from listLocalEventsToPush) to a Microsoft Graph
 * event body for create/update. Sends times as UTC (Graph stores/normalizes).
 */
function toGraphEventBody(ev: {
  title: string;
  description?: string;
  startTime: number;
  endTime: number;
  isAllDay: boolean;
  location?: string;
  meetingLink?: string;
}): Record<string, unknown> {
  // Build body: description + (if present) the meeting link appended as text.
  // We deliberately do NOT create a Graph onlineMeeting — just surface the link.
  let content = ev.description ?? "";
  if (ev.meetingLink) {
    content = content ? `${content}\n\n${ev.meetingLink}` : ev.meetingLink;
  }

  const body: Record<string, unknown> = {
    subject: ev.title,
    body: { contentType: "text", content },
    isAllDay: !!ev.isAllDay,
  };

  if (ev.isAllDay) {
    // Graph requires all-day events to start/end at UTC midnight. Snap the
    // start to 00:00:00 UTC of its day and the end to 00:00:00 UTC of the day
    // AFTER the last day (Graph's exclusive end for all-day events).
    const startDay = new Date(ev.startTime);
    const startMidnight = Date.UTC(
      startDay.getUTCFullYear(),
      startDay.getUTCMonth(),
      startDay.getUTCDate()
    );
    const endDay = new Date(ev.endTime);
    let endMidnight = Date.UTC(
      endDay.getUTCFullYear(),
      endDay.getUTCMonth(),
      endDay.getUTCDate()
    );
    // All-day end must be strictly after start (>= next midnight).
    if (endMidnight <= startMidnight) {
      endMidnight = startMidnight + 24 * 60 * 60 * 1000;
    }
    body.start = { dateTime: new Date(startMidnight).toISOString(), timeZone: "UTC" };
    body.end = { dateTime: new Date(endMidnight).toISOString(), timeZone: "UTC" };
  } else {
    body.start = { dateTime: new Date(ev.startTime).toISOString(), timeZone: "UTC" };
    body.end = { dateTime: new Date(ev.endTime).toISOString(), timeZone: "UTC" };
  }

  if (ev.location) {
    body.location = { displayName: ev.location };
  }

  return body;
}

/**
 * Phase 3 PUSH: push this user's IECentral-origin events out to Outlook. Runs
 * AFTER the pull, reusing the SAME fresh accessToken (no second refresh).
 *
 * Returns the count of events pushed (created/updated/deleted). Per-event
 * try/catch isolates failures so one bad event cannot abort the rest.
 *
 * INVARIANTS (enforced by listLocalEventsToPush + the gate here):
 *  - Never pushes syncSource:"outlook" events (loop prevention).
 *  - Never pushes isReminder / isPrivate events.
 *  - The `updatedAt > (outlookSyncedAt ?? 0)` gate skips unchanged events so we
 *    don't re-PATCH / re-create on every cycle (no churn).
 *  - Pushed rows keep syncSource:"iecentral" so the pull keeps ignoring them.
 */
async function runPush(
  ctx: any,
  userId: any,
  accessToken: string
): Promise<number> {
  const now = Date.now();
  const start = now - PUSH_WINDOW_BACK_MS;
  const end = now + PUSH_WINDOW_FWD_MS;

  const toPush: Array<{
    _id: any;
    title: string;
    description?: string;
    startTime: number;
    endTime: number;
    isAllDay: boolean;
    location?: string;
    meetingLink?: string;
    isCancelled: boolean;
    updatedAt: number;
    outlookEventId?: string;
    outlookSyncedAt?: number;
  }> = await ctx.runQuery(internal.outlookAccounts.listLocalEventsToPush, {
    userId,
    start,
    end,
  });

  let pushed = 0;
  for (const ev of toPush) {
    try {
      const syncedAt = ev.outlookSyncedAt ?? 0;
      const changed = ev.updatedAt > syncedAt;

      if (ev.isCancelled) {
        // DELETE: only if it was ever pushed and the cancellation isn't yet
        // reflected. The changed-gate stops re-deletes on later cycles.
        if (!ev.outlookEventId || !changed) continue;
        const res: Response = await fetch(`${GRAPH_EVENTS}/${ev.outlookEventId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        // 404 = already gone in Outlook -> treat as success.
        if (!res.ok && res.status !== 404) {
          const txt = await res.text();
          console.log(
            `[outlookSync] push DELETE failed for event ${ev._id}: ${res.status} - ${txt.slice(0, 200)}`
          );
          continue;
        }
        await ctx.runMutation(internal.outlookAccounts.setPushResult, {
          eventId: ev._id,
          outlookSyncedAt: Date.now(),
        });
        pushed++;
        continue;
      }

      const graphBody = toGraphEventBody(ev);

      if (!ev.outlookEventId) {
        // CREATE
        const res: Response = await fetch(GRAPH_EVENTS, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(graphBody),
        });
        if (!res.ok) {
          const txt = await res.text();
          console.log(
            `[outlookSync] push CREATE failed for event ${ev._id}: ${res.status} - ${txt.slice(0, 200)}`
          );
          continue;
        }
        const created: any = await res.json();
        await ctx.runMutation(internal.outlookAccounts.setPushResult, {
          eventId: ev._id,
          outlookEventId: created.id,
          outlookICalUId: created.iCalUId || undefined,
          outlookWeblink: created.webLink || undefined,
          outlookSyncedAt: Date.now(),
        });
        pushed++;
      } else {
        // UPDATE — only when the local row changed since the last push.
        if (!changed) continue;
        const res: Response = await fetch(`${GRAPH_EVENTS}/${ev.outlookEventId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(graphBody),
        });
        if (!res.ok) {
          const txt = await res.text();
          console.log(
            `[outlookSync] push PATCH failed for event ${ev._id}: ${res.status} - ${txt.slice(0, 200)}`
          );
          continue;
        }
        const updated: any = await res.json().catch(() => ({}));
        await ctx.runMutation(internal.outlookAccounts.setPushResult, {
          eventId: ev._id,
          outlookEventId: updated.id || ev.outlookEventId,
          outlookICalUId: updated.iCalUId || undefined,
          outlookWeblink: updated.webLink || undefined,
          outlookSyncedAt: Date.now(),
        });
        pushed++;
      }
    } catch (err) {
      console.log(
        `[outlookSync] push error for event ${ev._id}: ${
          err instanceof Error ? err.message : "unknown"
        }`
      );
      // continue with the rest
    }
  }

  return pushed;
}

/**
 * Core sync logic (pull THEN push). Returns { synced, error }. Wraps its body in
 * try/catch so a failure records syncError rather than throwing out of the cron
 * loop. `synced` counts pull upserts + push operations (both directions).
 */
async function runSync(
  ctx: any,
  userId: any
): Promise<{ synced: number; error?: string }> {
  try {
    const acct = await ctx.runQuery(internal.outlookAccounts.getWithCredentials, {
      userId,
    });
    if (!acct || !acct.isActive) {
      return { synced: 0, error: "not connected" };
    }

    // 1. Decrypt tokens (Node only).
    let accessToken: string;
    let refreshToken: string;
    try {
      accessToken = decrypt(acct.accessToken);
      refreshToken = decrypt(acct.refreshToken);
    } catch {
      await ctx.runMutation(internal.outlookAccounts.setSyncStatus, {
        userId,
        syncError: "reconnect_required",
        deactivate: true,
      });
      return { synced: 0, error: "reconnect_required" };
    }

    // 2. Refresh if near expiry.
    if (acct.tokenExpiresAt < Date.now() + 60_000) {
      if (!refreshToken) {
        await ctx.runMutation(internal.outlookAccounts.setSyncStatus, {
          userId,
          syncError: "reconnect_required",
          deactivate: true,
        });
        return { synced: 0, error: "reconnect_required" };
      }
      const clientId = process.env.MICROSOFT_CLIENT_ID!;
      const clientSecret = process.env.MICROSOFT_CLIENT_SECRET!;
      const refreshRes = await fetch(MICROSOFT_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          scope: SCOPES,
        }),
      });

      if (!refreshRes.ok) {
        // invalid_grant (or the Phase-1 edge where no real refresh token was
        // stored) -> require reconnect and go dormant.
        await ctx.runMutation(internal.outlookAccounts.setSyncStatus, {
          userId,
          syncError: "reconnect_required",
          deactivate: true,
        });
        return { synced: 0, error: "reconnect_required" };
      }

      const tokens = await refreshRes.json();
      accessToken = tokens.access_token;
      const newRefresh = tokens.refresh_token || refreshToken;
      const tokenExpiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1000;
      await ctx.runMutation(internal.outlookAccounts.updateTokens, {
        accountId: acct._id,
        accessToken: encrypt(accessToken),
        refreshToken: encrypt(newRefresh),
        tokenExpiresAt,
      });
    }

    // 3. Fetch the rolling window from Graph calendarView, following paging.
    const now = Date.now();
    const start = now - WINDOW_BACK_MS;
    const end = now + WINDOW_FWD_MS;
    const params = new URLSearchParams({
      startDateTime: new Date(start).toISOString(),
      endDateTime: new Date(end).toISOString(),
      $top: "250",
      $select:
        "id,iCalUId,subject,bodyPreview,start,end,isAllDay,location,onlineMeeting,webLink,isCancelled",
    });
    let url: string | null = `${GRAPH_CALENDAR_VIEW}?${params.toString()}`;

    const graphEvents: GraphEvent[] = [];
    let pages = 0;
    while (url && pages < MAX_PAGES) {
      const res: Response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'outlook.timezone="UTC"',
        },
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Graph calendarView error: ${res.status} - ${txt.slice(0, 300)}`);
      }
      const data: any = await res.json();
      if (Array.isArray(data.value)) graphEvents.push(...data.value);
      url = data["@odata.nextLink"] || null;
      pages++;
    }
    if (url && pages >= MAX_PAGES) {
      console.log(
        `[outlookSync] pagination capped at ${MAX_PAGES} pages for user ${userId}; more events may exist`
      );
    }

    // 4. Map + upsert each Graph event.
    const returnedIds = new Set<string>();
    let synced = 0;
    for (const ev of graphEvents) {
      if (!ev.id) continue;
      const startMs = parseGraphUtcMs(ev.start);
      const endMs = parseGraphUtcMs(ev.end);
      if (startMs === null || endMs === null) continue;
      returnedIds.add(ev.id);

      await ctx.runMutation(internal.outlookAccounts.upsertPulledEvent, {
        userId,
        outlookEventId: ev.id,
        outlookICalUId: ev.iCalUId || undefined,
        outlookWeblink: ev.webLink || undefined,
        title: ev.subject || "(no subject)",
        description: ev.bodyPreview || undefined,
        startTime: startMs,
        endTime: endMs,
        isAllDay: !!ev.isAllDay,
        location: ev.location?.displayName || undefined,
        meetingLink: ev.onlineMeeting?.joinUrl || undefined,
        isCancelled: ev.isCancelled === true,
      });
      if (ev.isCancelled !== true) synced++;
    }

    // 5. Detect deletions: any outlook-sourced event we hold in the window that
    // was NOT returned by this pull (and isn't already cancelled) -> soft-cancel.
    const heldIds: string[] = await ctx.runQuery(
      internal.outlookAccounts.listPulledIdsInWindow,
      { userId, start, end }
    );
    for (const id of heldIds) {
      if (!returnedIds.has(id)) {
        await ctx.runMutation(internal.outlookAccounts.markPulledCancelled, {
          userId,
          outlookEventId: id,
        });
      }
    }

    // 6. PUSH (IECentral -> Outlook), reusing the SAME fresh accessToken from
    // the pull above (do NOT refresh a second time). Push failures are isolated
    // per-event inside runPush and won't throw.
    let pushed = 0;
    try {
      pushed = await runPush(ctx, userId, accessToken);
    } catch (pushErr) {
      // runPush already isolates per-event errors; a throw here is unexpected.
      console.log(
        `[outlookSync] push pass failed for user ${userId}: ${
          pushErr instanceof Error ? pushErr.message : "unknown"
        }`
      );
    }

    // 7. Record success.
    await ctx.runMutation(internal.outlookAccounts.setSyncStatus, {
      userId,
      lastSyncAt: Date.now(),
      syncError: undefined,
    });

    return { synced: synced + pushed, error: undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync failed";
    try {
      await ctx.runMutation(internal.outlookAccounts.setSyncStatus, {
        userId,
        syncError: message,
      });
    } catch {
      // best-effort status write
    }
    return { synced: 0, error: message };
  }
}

/**
 * Public action for the manual "Sync now" route.
 */
export const pullForUser = action({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<{ synced: number; error?: string }> => {
    return await runSync(ctx, args.userId);
  },
});

/**
 * Internal action variant so the cron can call it per account via runAction.
 */
export const pullForUserInternal = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<{ synced: number; error?: string }> => {
    return await runSync(ctx, args.userId);
  },
});

/**
 * Cron entry point: pull all active accounts. Per-account failures are isolated
 * (try/catch per account), and an overlap guard skips accounts already syncing.
 */
export const pullAll = internalAction({
  args: {},
  handler: async (ctx): Promise<Array<{ userId: string; synced: number; error?: string }>> => {
    const accounts: Array<{ userId: any }> = await ctx.runQuery(
      internal.outlookAccounts.listActiveAccounts,
      {}
    );
    const results: Array<{ userId: string; synced: number; error?: string }> = [];
    for (const account of accounts) {
      try {
        // Overlap guard: atomically claim the sync lock; skip if already syncing.
        const claimed: boolean = await ctx.runMutation(
          internal.outlookAccounts.tryClaimSync,
          { userId: account.userId }
        );
        if (!claimed) {
          results.push({ userId: String(account.userId), synced: 0, error: "already syncing" });
          continue;
        }
        try {
          const r = await ctx.runAction(internal.outlookSync.pullForUserInternal, {
            userId: account.userId,
          });
          results.push({ userId: String(account.userId), synced: r.synced, error: r.error });
        } finally {
          await ctx.runMutation(internal.outlookAccounts.releaseSync, {
            userId: account.userId,
          });
        }
      } catch (err) {
        results.push({
          userId: String(account.userId),
          synced: 0,
          error: err instanceof Error ? err.message : "unknown error",
        });
      }
    }
    return results;
  },
});
