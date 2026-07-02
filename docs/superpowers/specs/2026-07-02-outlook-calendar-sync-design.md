# Outlook / M365 Calendar Sync — Scoping & Design

**Status:** Scoping (pre-implementation). One decision needed from Andy before a plan is written: **sync direction** (see §6).
**Goal:** Keep a user's IECentral calendar (`convex/events.ts`) in sync with their Outlook / Microsoft 365 calendar via Microsoft Graph, using per-user OAuth — mirroring the existing Zoom and Microsoft-email OAuth flows already in the app.

---

## 1. Context / what already exists

- IECentral calendar: `events` table + `app/calendar/page.tsx` (now with Day/Week/Month views, reminders, private "Busy" events).
- **A Microsoft Azure AD app is ALREADY registered and in production** for the in-app email client:
  - Env: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_AUTH_URL`, `MICROSOFT_TOKEN_URL`, `MICROSOFT_GRAPH_URL`.
  - Flow: `app/api/email/oauth/microsoft/route.ts` (init) + `.../callback/route.ts`, using the `/common/` endpoint, CSRF state in an httpOnly cookie, scopes `Mail.ReadWrite Mail.Send User.Read offline_access`.
- Zoom OAuth is the closest structural precedent for a *calendar* integration: `app/api/zoom/oauth/route.ts` + `callback`, token storage in `convex/zoomAccounts.ts` (`zoomAccounts` table), a sync action, and the `/api/calendar/zoom-sync` route. **We mirror this shape.**

### Headline finding — no new Azure app required
Because the Azure AD app already exists and calendar access is a **delegated** Graph permission, we do **not** need a new registration. Setup reduces to: add `Calendars.ReadWrite` to that app's delegated API permissions and have users re-consent (the OAuth scope string just gains one entry). This removes the biggest blocker noted in prior planning.

---

## 2. Azure setup (Andy — one-time, in the Azure Portal)

On the **existing** app registration (the one behind `MICROSOFT_CLIENT_ID`):
1. **API permissions → Add a permission → Microsoft Graph → Delegated permissions →** add `Calendars.ReadWrite`. (`offline_access` and `User.Read` are already granted.)
2. If the tenant requires admin consent, click **Grant admin consent** for the org (otherwise each user consents on first connect).
3. **Redirect URIs → Add:** `https://iecentral.com/api/calendar/outlook/oauth/callback` (and a localhost variant for dev if desired). Existing email redirect URIs stay as-is.
4. No new client secret needed — reuse `MICROSOFT_CLIENT_SECRET`. (If you'd rather isolate calendar from email, you *can* register a separate app and add `OUTLOOK_CLIENT_ID/SECRET` — not necessary, just an option.)

That's the entire external setup. Everything else is code.

---

## 3. Architecture (mirrors Zoom OAuth)

New pieces, all patterned on the Zoom/email flows:

- **`app/api/calendar/outlook/oauth/route.ts`** — initiate: build the Graph consent URL with scopes `https://graph.microsoft.com/Calendars.ReadWrite offline_access User.Read`, CSRF state cookie (`oauth_state_outlook`), redirect to `login.microsoftonline.com/common/oauth2/v2.0/authorize`. Reuses `MICROSOFT_CLIENT_ID`.
- **`app/api/calendar/outlook/oauth/callback/route.ts`** — exchange `code` → tokens at `MICROSOFT_TOKEN_URL`, fetch `/me` for the account email, store tokens (see §4), redirect back to `/calendar`.
- **`convex/outlookAccounts.ts`** — `getByUser`, `connect` (store tokens), `disconnect`, `refreshIfNeeded` (refresh-token grant when `expiresAt` near). Encrypt tokens at rest (the email/eBay integrations already established an encryption pattern — reuse it; do not store plaintext refresh tokens).
- **`convex/outlookSync.ts`** (action) — the sync engine (§5). Calls Graph `/me/calendarview` (or `/me/events`) with a time window; upserts into `events`; optionally pushes local events to Graph.
- **`app/api/calendar/outlook-sync/route.ts`** — POST `{ userId }` to trigger a manual sync (mirrors `/api/calendar/zoom-sync`), plus a "Connect Outlook" / "Sync now" button in the calendar header next to the Zoom button.
- **Cron** — a Convex scheduled function to sync connected users on an interval (e.g. every 15 min), with an overlap guard (the email sync's 5-min cron + overlap-guard pattern is the reference).

---

## 4. Data model

**`outlookAccounts`** (new table):
```
userId: Id<"users">
outlookEmail: string
accessTokenEnc: string        // encrypted
refreshTokenEnc: string       // encrypted
expiresAt: number             // ms; refresh before this
scope: string
deltaLink?: string            // Graph delta token for incremental sync
syncDirection: "in" | "out" | "both"   // per §6 decision (or a global default)
lastSyncedAt?: number
connectedAt: number
```

**`events`** — add optional link fields so synced events dedupe and round-trip without duplicating:
```
outlookEventId?: string       // Graph event id (this user's mailbox)
outlookICalUId?: string       // stable across mailboxes; use for cross-user dedupe
outlookWeblink?: string       // deep link back to Outlook
syncSource?: "iecentral" | "outlook"   // who created it, for conflict rules
```
Reminders (`isReminder`) and private ("Busy") events: **do not push these to Outlook by default** (they're personal); make that a per-mode toggle later if wanted. A private event, if ever pushed, maps to Graph `sensitivity: "private"`.

---

## 5. Sync mechanics

- **Pull (Outlook → IECentral):** Graph `GET /me/calendarView?startDateTime=…&endDateTime=…` (expands recurrences) or delta query `GET /me/calendarView/delta` using stored `deltaLink` for incremental updates. For each Graph event: upsert an `events` row keyed by `outlookEventId` (create if new, patch if changed, soft-cancel if deleted). Map Graph fields → our schema (subject→title, bodyPreview→description, start/end→ms timestamps honoring the event timezone, location, onlineMeeting.joinUrl→meetingLink, isAllDay).
- **Push (IECentral → Outlook):** for local events with `syncSource: "iecentral"` and no `outlookEventId`, `POST /me/events`; on local edit, `PATCH`; on cancel, `DELETE`. Store the returned id back on the row.
- **Dedup / loops:** always write the counterpart id back immediately so the next sync round recognizes the event as already-synced and doesn't re-create it. Use `outlookICalUId` to avoid duplicates when the same meeting appears via multiple paths.
- **Conflicts (two-way only):** last-writer-wins by `updatedAt` is the simplest v1; note it in the plan. Never overwrite a field that's blank on one side and set on the other without a rule.
- **Token refresh:** before any Graph call, `refreshIfNeeded`; on 401, refresh once and retry; on invalid_grant (revoked consent) mark the account disconnected and surface a "reconnect Outlook" prompt.
- **Windowing:** sync a rolling window (e.g. −1 month … +6 months) to bound work, same spirit as the existing calendar `dateRange`.

---

## 6. THE decision: sync direction

| Option | What it does | Effort | Risk |
|---|---|---|---|
| **A. One-way: Outlook → IECentral** (read-only import) | Your Outlook events appear in IECentral; IECentral never writes to Outlook | Lowest | Lowest — can't damage the mailbox |
| **B. One-way: IECentral → Outlook** (export) | IECentral events get pushed into Outlook; Outlook changes ignored | Low–med | Med — writes to mailbox |
| **C. Two-way** | Both directions kept in sync, with conflict rules | Highest | Highest — loops/dupes/conflicts to get right |

**Recommendation:** ship **A first** (safe, immediately useful — your work calendar shows up in IECentral), then add push to reach **C** as a Phase 2 once the pull path is proven. This is the standard way to de-risk calendar sync. But if the primary pain is "events I make in IECentral should land in Outlook," we'd start with **B**.

---

## 7. Suggested phasing

- **Phase 1 — Connect + Pull (Option A):** Azure permission add, OAuth connect/disconnect, `outlookAccounts`, pull sync + manual "Sync now" button + cron, event mapping & dedupe. Delivers value on its own.
- **Phase 2 — Push (reach two-way / Option C):** push local → Outlook, write-back ids, conflict rule, sensitivity mapping for private events, decide reminder handling.
- **Phase 3 — Polish:** delta-token incremental sync, per-user direction toggle in Settings, reconnect UX, sync status/errors surfaced in the calendar.

---

## 8. Open items (besides §6)
- Confirm we reuse the existing Azure app vs. a dedicated calendar app registration (recommend reuse).
- Which calendar to sync — primary only (v1) vs. selectable calendars (later).
- Whether to ever push IECentral reminders/private events to Outlook (default: no).
- Encryption helper to reuse for token-at-rest (confirm the one used by email/eBay integrations).
