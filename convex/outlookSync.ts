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

// Calendar scopes (match the Phase-1 connect route).
const SCOPES = [
  "offline_access",
  "https://graph.microsoft.com/Calendars.ReadWrite",
  "https://graph.microsoft.com/User.Read",
].join(" ");

const WINDOW_BACK_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const WINDOW_FWD_MS = 180 * 24 * 60 * 60 * 1000; // 180 days
const MAX_PAGES = 10;

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
 * Core pull logic. Returns { synced, error }. Wraps its body in try/catch so a
 * failure records syncError rather than throwing out of the cron loop.
 */
async function runPull(
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

    // 6. Record success.
    await ctx.runMutation(internal.outlookAccounts.setSyncStatus, {
      userId,
      lastSyncAt: Date.now(),
      syncError: undefined,
    });

    return { synced, error: undefined };
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
    return await runPull(ctx, args.userId);
  },
});

/**
 * Internal action variant so the cron can call it per account via runAction.
 */
export const pullForUserInternal = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<{ synced: number; error?: string }> => {
    return await runPull(ctx, args.userId);
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
