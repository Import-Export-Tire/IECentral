# "Act as User" (Super-Admin Impersonation) — Design

**Date:** 2026-06-15
**Status:** Approved, pending implementation

## Problem

Bill Shetler reported he couldn't see Equipment. The super admin had to manually
adjust his permission overrides and enable the base Equipment level before he could
see bin labels and tire labels. There is currently no way for a super admin to
**see the app exactly as another user sees it**, so verifying a user's effective
permissions means guessing from the admin UI rather than observing the real result.

This feature lets a super admin "Act as" another user to verify their menus, gates,
and feature visibility directly.

## Architectural Context

Auth in IECentral is entirely client-side:

- `AuthProvider` (`app/auth-context.tsx`) reads a `userId` from `localStorage`
  (`ie_central_user_id`), runs `useQuery(api.auth.getUser, { userId })`, and exposes
  the resulting `user` object.
- **Everything** downstream — `useAuth()`, `usePermissions()` (`lib/usePermissions.ts`),
  sidebar/menu visibility, `<Protected>` gates, the Equipment gate Bill hit — derives
  from that single loaded `user` object and its `role` + `permissionOverrides`.

Therefore, swapping the effective user id feeding `getUser` makes the entire app
(~100 consuming components) render as that user, with no changes to consumers.

The backend is fully "trust-the-client" today (mutations accept `userId` without
verifying the caller — see `RBAC_AUDIT_BACKEND.md`). Impersonation introduces **no new
server-side security hole**: any actor with the `localStorage` id could already swap it.
This feature is a legitimate, audited convenience layered on the existing model.

## Decisions (confirmed)

- **Scope:** Act as **any non-super-admin** user (employees, managers, admins) — useful
  for verifying permissions at every tier, not just employees. Super admins cannot be
  impersonated.
- **Behavior:** **Full actions allowed.** The session behaves fully as the target,
  including saving changes. (Accountability is provided by audit logging + a persistent
  banner, not by write-blocking.)
- **Entry point:** Per-row **"Act as"** button on the `/users` admin list.

## Components

### 1. AuthProvider impersonation state (`app/auth-context.tsx`)

- New `localStorage` key `ie_central_impersonation`, a JSON record:
  ```
  {
    realUserId, realUserName, realUserEmail,
    targetUserId, targetUserName, targetRole,
    startedAt
  }
  ```
- The real super-admin session under `ie_central_user_id` is left **untouched**.
- Compute `effectiveUserId = impersonation?.targetUserId ?? userId`. The
  `api.auth.getUser` query uses `effectiveUserId`. `user`, `useAuth()`, and
  `usePermissions()` all flow from it automatically — no consumer changes.
- New context API:
  - `isImpersonating: boolean`
  - `impersonation: { realUserName, targetUserName, targetRole } | null`
  - `startImpersonation(target: { _id, name, role })` — **guarded**: only when the
    current real user is `super_admin`, the target's role is not `super_admin`, and not
    already impersonating. Writes the record, fires the start audit log, routes to `/`.
  - `stopImpersonation()` — clears the record, fires the stop audit log, routes to `/users`.
- `logout()` clears **both** keys.
- The impersonation record **persists across page reloads** (so the admin can navigate
  freely while verifying). `effectiveUserId` resolves to the target on reload; the
  banner and Exit remain available; Exit restores the real session cleanly.

### 2. Audit logging (existing `api.auditLogs.log`)

Mutation signature already exists:
`{ action, actionType, resourceType, resourceId, userId, userEmail, details }`.

- **On start** and **on stop**, log under the **real** super admin's id/email
  (not the target's), so the trail attributes the action correctly:
  - start: `actionType: "impersonate_start"`, `resourceType: "user"`,
    `resourceId: targetUserId`, `action: "Started acting as {targetName}"`.
  - stop: `actionType: "impersonate_end"`, same resource,
    `action: "Stopped acting as {targetName}"`.
- This is the accountability record for any full actions taken while impersonating.

### 3. `ImpersonationBanner` (new component)

- Mounted next to `<SystemBanner />` in `app/providers.tsx` (inside `AuthProvider` /
  `AppShell`), following the existing banner pattern.
- Renders only when `isImpersonating`.
- High-contrast amber/orange bar (visually distinct from `SystemBanner`), fixed at top:

  > **Acting as {targetName} · {roleName} — changes save as them. [Return to {realName}]**

- Mobile-responsive. The Return button calls `stopImpersonation()`.

### 4. "Act as" button on `/users` (`app/users/page.tsx`)

- Per-row action button.
- Visible only when the real user `isSuperAdmin`, the row user's role is not
  `super_admin`, and the row is not the admin's own record.
- onClick → `startImpersonation({ _id, name, role })`.

## Non-Goals (YAGNI)

- No backend RBAC enforcement changes (tracked separately via the RBAC audit).
- No write-blocking / view-only mode (full actions were chosen).
- No impersonating other super admins.
- No nested impersonation (cannot start while already impersonating).

## Testing (manual — no UI test harness present)

1. As a super admin, click **Act as** on Bill → land on `/`; confirm Equipment / bin
   labels / tire labels visibility matches Bill's actual overrides; banner shows.
2. Click **Return to {realName}** → restored to the super admin; banner gone; back on `/users`.
3. Confirm a non-super-admin user never sees the **Act as** button, and super-admin rows
   (and own row) have no button.
4. Confirm two audit-log entries (`impersonate_start`, `impersonate_end`) attributed to
   the real super admin.
5. Reload the page while impersonating → state holds; Exit still restores cleanly.
6. `logout()` while impersonating → both keys cleared; lands on login.
