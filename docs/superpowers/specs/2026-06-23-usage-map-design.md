# IECentral Usage Map — Design

**Date:** 2026-06-23
**Status:** Approved for planning
**Owner:** Andy

## Goal

A super-admin-only dashboard that answers two questions:

1. **Engagement / adoption** — who logs in, how often, who's active vs. dormant. (Available immediately from existing `users.lastLoginAt` + a login usage event.)
2. **Feature popularity** — which areas of IECentral get used the most, overall and **per user**, shown as a user × feature **heatmap** (the "usage map"). (Builds up from new lightweight tracking; no historical backfill.)

Visibility: **super-admin only** (tier 5). Today that is just Andy. If another super-admin is ever added and this should stay private, swap the guard for a hard check against Andy's user id — noted as a one-line change, not built now.

## Non-goals (YAGNI)

- No per-second/real-time analytics — daily granularity, dashboard reads a rollup.
- No tracking of every distinct route — top-level sections plus a defined set of sub-features only.
- No external analytics service — all in Convex, consistent with "nothing leaves our infra."
- No historical backfill — tracking starts when this ships.

## Data model

One new rollup table. Each tracked event upserts a **daily per-user per-feature counter** (not one row per event), keeping volume small and dashboards fast.

```ts
featureUsage: defineTable({
  userId: v.id("users"),
  userName: v.string(),          // denormalized for the dashboard
  featureKey: v.string(),        // e.g. "reports.inventory", "email.send", "dochub.folder", "login"
  section: v.string(),           // top-level bucket, e.g. "Reports", "Email", "Doc Hub"
  label: v.string(),             // human label, e.g. "Inventory Report"
  date: v.string(),              // "YYYY-MM-DD" (America/New_York day)
  count: v.number(),             // events that user/feature/day
  lastAt: v.number(),            // last event timestamp (ms)
})
  .index("by_user_feature_date", ["userId", "featureKey", "date"]) // upsert lookup
  .index("by_date", ["date"])                                      // dashboard range scan
  .index("by_user", ["userId"]),
```

`featureKey` taxonomy (the sub-features confirmed in brainstorming):

- **Sections** (default): one key per sidebar area — `reports`, `email`, `dochub`, `personnel`, `timeClock`, `scanners`, `meetings`, `dailyLog`, `safety`, `settings`, … (route-prefix → section map).
- **Report types** — `reports.<type>` from the `?type=` query param on `/reports` (Inventory, Dealer Rebates, Dunlop, WTD Commission, Sales, Turnover, …).
- **Doc Hub folders** — `dochub.folder.<folderId>` (label = folder name) when a folder is opened.
- **HR sub-areas** — `personnel.reviews`, `personnel.writeUps`, `applications`, `timeOff`, `payroll` (by route).
- **Email actions** — `email` (open, route) plus explicit `email.send` / `email.compose` events.
- **Login** — `login`, recorded in the existing `auth.login` mutation.

A single source-of-truth map (`lib/usageFeatures.ts`) translates `pathname + query` → `{ featureKey, section, label }`, so the route→feature logic lives in one place and the dashboard can label keys consistently.

## Capture

Two entry points, one mutation.

- **`recordUsage` mutation** — args `{ requestingUserId, featureKey, section, label }`. Verifies the user exists and is active (records the caller's *own* usage; not super-admin gated — everyone is tracked). Upserts the `(userId, featureKey, date)` row: increment `count`, set `lastAt`, create if absent. `date` computed server-side in America/New_York.
- **`useUsageTracking` hook** — mounted once in the app shell. On `pathname`/query change it derives the feature via `lib/usageFeatures.ts` and calls `recordUsage`, with:
  - **dedupe**: skip if the same `featureKey` was recorded < 30s ago (client-side ref) — avoids double counts from re-renders/StrictMode.
  - **skip** unauthenticated / public routes (`/login`, `/join`, `/report`, `/public/*`).
- **Explicit events** — a thin `trackEvent(featureKey)` helper for non-navigation actions (initially just `email.send`; `report.run` optional later). Sprinkled at the call site.

Volume estimate: ~50 internal users × ~100 nav events/day, deduped → low thousands of upserts/day. Comfortable for Convex.

## Dashboard — `/usage` (super-admin only)

`<Protected requiredRoles={["super_admin"]}>`; iOS-admin aesthetic (system font, grouped cards, `#007AFF`); charts via `recharts` (already a dependency). All data from one query.

- **`getUsageSummary({ requestingUserId, days })`** — `requireRole(super_admin)`. Scans `featureUsage` by `by_date` over the range and returns:
  - `activeUsers`, `dormantUsers` (active = any event in range; dormant = users with none),
  - `loginsByDay` (for the trend),
  - `topFeatures` (featureKey → total count, label, section),
  - `perUser` (userId, name, lastLoginAt, totalEvents, top features),
  - `heatmap` (matrix: users × top ~20 features with counts).

Layout (top → bottom):

1. **Range selector** — 7 / 30 / 90 days.
2. **Engagement strip** — cards: Active users, Dormant users, Logins (with a small logins-over-time line/bar).
3. **Top features** — horizontal bar leaderboard (most-used areas across everyone).
4. **Usage map (heatmap)** — rows = users (sorted by total activity), columns = top ~20 features, each cell shaded by that user's count for that feature (CSS-grid heatmap; hover shows exact count). The centerpiece.
5. **Per-user table** — name, last login, total activity, top 3 features; sortable.

## Auth summary

- `recordUsage`: authenticated active user, records own usage. (Low-stakes; a spoofed `requestingUserId` could only mis-attribute a usage count.)
- `getUsageSummary` + the `/usage` page: **super-admin only**.

## Files

- `convex/schema.ts` — add `featureUsage` table.
- `convex/usage.ts` — `recordUsage` mutation, `getUsageSummary` query.
- `convex/auth.ts` — record a `login` event in `login`.
- `lib/usageFeatures.ts` — route/query → `{ featureKey, section, label }` map + helpers.
- `lib/useUsageTracking.ts` — the shell hook (dedupe, skip rules) + `trackEvent` helper.
- App shell (`components/shell/*` or `app/providers.tsx`) — mount the hook.
- `app/email/*` — one `trackEvent("email.send")` at send.
- `app/usage/page.tsx` + small dashboard components (engagement strip, heatmap, per-user table).
- Sidebar — add a "Usage" link visible only to super-admin.

## Future (not now)

- Retention/purge or monthly rollup of `featureUsage` if the table grows large.
- More explicit events (`report.run`, specific Doc Hub actions).
- Hard-lock to Andy's user id if multiple super-admins exist.
