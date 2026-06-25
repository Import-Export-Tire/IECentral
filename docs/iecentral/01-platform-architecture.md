# IECentral — Platform / Architecture / Auth / RBAC

> Internal business operations platform for **Import-Export Tire (IET)**, a tire
> distributor. This document covers the foundational layer: tech stack, the
> Next-on-Vercel + Convex + AWS topology, authentication, role-based access
> control (RBAC), the app shell/navigation, audit logging, soft-delete, user
> management, and a high-level map of the ~149-table Convex schema.
>
> Everything here was read from the actual source. Where the code and the
> documented "intended" model disagree, that is called out as a **gotcha**.

---

## 1. Tech Stack & Architecture

### 1.1 Stack summary

| Layer | Technology | Notes |
|---|---|---|
| Frontend | **Next.js 15** (App Router) + **React 19** | `app/` directory, all client-component heavy (`"use client"`). |
| Styling | **Tailwind CSS v4** (`@tailwindcss/postcss`) | iOS-style light theme is the default. |
| Backend / DB | **Convex** (`convex@^1.31`) | Reactive document DB + serverless functions (queries / mutations / actions / httpActions / crons). Production deployment: `outstanding-dalmatian-787`. |
| Hosting | **Vercel** | Builds `iecentral.com` from `origin/main`. |
| Heavy compute / storage | **AWS S3 + Lambda** | Report parsing, Office→PDF, scanner MDM (AWS IoT), Dunlop SFTP, email proxy. |
| PWA | **next-pwa** (Workbox) | Installable app, offline caching, service worker. |
| Mobile companion | Capacitor (`android/`, `companion-app/`) | Wraps the web app. |

Key dependencies of note: `@aws-sdk/client-s3`, `@aws-sdk/client-lambda`,
`@aws-sdk/s3-request-presigner`, `exceljs` / `xlsx` (report ingestion),
`imapflow` / `nodemailer` / `mailparser` (in-app email client), `sharp` /
`pdf-to-img` / `pdfjs-dist` / `@napi-rs/canvas` (Doc Hub thumbnails),
`@anthropic-ai/sdk` (Tech Wizard / AI features), `recharts`, `tiptap` (rich text),
`jspdf` (PDF generation), `@yume-chan/adb*` (WebUSB scanner provisioning).

### 1.2 How the pieces fit together

```
Browser / PWA  ──reactive ws/https──▶  Convex (outstanding-dalmatian-787)
   │                                      • queries/mutations/actions
   │                                      • schema (~149 tables)
   │                                      • crons, httpActions (webhooks)
   │
   ├──HTTP──▶  Next.js Route Handlers (app/api/**)  ──▶  AWS S3 / Lambda
   │              • report parsing, presigned uploads/downloads
   │              • Office→PDF, thumbnails, scanner MDM, Dunlop, sales
   │
   └──assets/SSR──▶  Vercel (Next.js server + static)
```

- The **React client talks to Convex directly** via `ConvexReactClient` for
  almost all CRUD and live data. The client URL is **hardcoded** in
  `app/providers.tsx`: `https://outstanding-dalmatian-787.convex.cloud`.
- **Next.js Route Handlers** (`app/api/**`, ~17 route groups) exist for work
  Convex can't/shouldn't do: AWS S3 presigned URLs, invoking Lambdas, parsing
  large spreadsheets, generating thumbnails, third-party webhooks (Indeed, Zoom,
  QuickBooks Web Connector). Most AWS-SDK usage lives in `app/api/**` (see
  `app/api/reports/*`, `app/api/documents/*`, `app/api/wtd-commission/*`,
  `app/api/dealer-rebates/*`, `app/api/dunlop/*`, `app/api/sales/*`,
  `app/api/training/*`).
- **Convex `httpActions`** (`convex/http.ts`) expose three public HTTPS
  endpoints used by AWS-side services (shared-secret authenticated):
  `/scanner-telemetry` (POST, `x-webhook-secret`), `/claim-provision` (POST,
  scanner cert claim), `/health` (GET).

### 1.3 Key config files

| File | Purpose / notable contents |
|---|---|
| `next.config.ts` | Wraps config in `withPWA(...)`. Workbox runtime caching rules per asset type (`clientsClaim` + `cleanupOutdatedCaches` forced via `as any` to defeat **stale service-worker** bugs — a real production issue per the inline comment). PWA disabled in dev. `serverExternalPackages` for native modules (`sharp`, `@napi-rs/canvas`, `pdf-to-img`). `outputFileTracingIncludes` forces the canvas/pdf binaries into the `/api/documents/thumbnail` bundle (Vercel file tracer can't follow their runtime `require()`). Security headers incl. a **Content-Security-Policy** allowing Convex (`*.convex.cloud`/`wss`), AWS (`*.amazonaws.com`), Zoom, Giphy. |
| `vercel.json` | `buildCommand: "npx convex deploy --cmd 'next build'"` — **the Convex backend is deployed as part of every Vercel build**. Defines 3 Vercel **crons** (`/api/sales/refresh` daily 10:00, `/api/reports/auto-process` weekdays 09:00, `/api/dunlop/monthly-run` monthly). Bumps memory/duration on two heavy report routes (`inventory-data`: 2048MB/90s, `custom-data`: 2048MB/300s). |
| `tsconfig.json` | Strict TS, `@/*` path alias → repo root, `moduleResolution: bundler`. Excludes `tools/`, `android/`, `*.old.*`. |
| `app/layout.tsx` | Root layout. Geist fonts, PWA `<meta>` + manifest, theme-color, viewport locked (no zoom). Wraps everything in `<Providers>` + `<ServiceWorkerRefresher>`. `<html className="light">` — light default. |
| `app/providers.tsx` | The provider stack (see below). |

### 1.4 Provider stack (`app/providers.tsx`)

```
ConvexProvider
 └ ThemeProvider            (dark/light)
   └ AppearanceProvider     (modern / desktop / jmk / pipboy / amber / dracula)
     └ SidebarProvider      (mobile sidebar open/close)
       └ AuthProvider       (session, user, impersonation, permission helpers)
         └ AppShell         (chooses shell chrome by appearance)
            ├ ImpersonationBanner
            ├ SystemBanner
            ├ {children}     (the page)
            ├ GlobalSearch
            ├ KeyboardShortcuts
            └ PushNotificationPrompt
```

### 1.5 Deploy model

- **`iecentral.com` is built on Vercel from `origin/main`.**
- Because `vercel.json`'s `buildCommand` runs `npx convex deploy`, **pushing to
  `origin` deploys both the Next.js frontend and the Convex backend** in one
  step. There is no separate Convex deploy step.
- There is also an AWS Amplify config present (`amplify.yml`,
  `AMPLIFY_MIGRATION.md`) — legacy/alternate hosting; Vercel is the live path.

---

## 2. Authentication

### 2.1 The "userId-arg" auth model (the single most important design decision)

IECentral does **not** use Convex's built-in identity (`ctx.auth.getUserIdentity()`).
Instead it uses a **custom, client-trusted model**, documented verbatim at the
top of `convex/authGuards.ts`:

> "The IECentral auth model is 'userId-arg-based': clients pass a
> `requestingUserId` to the mutation, and the handler is responsible for
> verifying the calling user actually has permission. There is no
> `ctx.auth.getUserIdentity()` — Convex's built-in auth isn't wired up."

Practical consequences:
- The client stores the logged-in user's Convex `_id` in **`localStorage`**
  (key `ie_central_user_id`) and passes it as an argument to queries/mutations.
- There is **no server-issued session token, JWT, or cookie**. Whoever holds (or
  guesses/forges) a valid `users` `_id` is that user, from the backend's
  perspective, *unless* a handler explicitly re-checks.
- Privileged handlers are *supposed* to call a guard from `authGuards.ts` first.
  **Most do not** (see §3.6, the RBAC audit).

### 2.2 Password handling (`convex/auth.ts`)

- Passwords are hashed with **PBKDF2-SHA256, 100,000 iterations**, 16-byte salt,
  32-byte key, using the Web Crypto API (`crypto.subtle`). Stored format:
  `saltHex$iterations$hashHex`.
- Verification uses a **constant-time comparison** loop.
- `login` (mutation): looks up user by lowercased email (`by_email` index),
  rejects inactive accounts / missing hash / bad password, updates `lastLoginAt`,
  writes a `login` audit log, and returns `{ success, userId, forcePasswordChange }`.
  **Failure messages are deliberately generic** ("Invalid email or password").
- `changePassword`: verifies current password, sets new hash, clears
  `forcePasswordChange`.
- `createUser` / `resetUserPassword` / `deleteUser` / `updateUser`: gated by
  `requireAdmin(ctx, requestingUserId)`. New users get `forcePasswordChange: true`
  and an optional welcome email (scheduled via `internal.emails.sendNewUserWelcomeEmail`).
- `createInitialAdmin` / `seedSuperuser`: bootstrap mutations (the former is a
  public mutation that only works when no users exist; the latter upserts a
  `super_admin`/`admin` and is now an **`internalMutation`** — server-only — see
  the FIXED note below).
- `createEmployeePortalLogin` / `resetEmployeePortalPassword`: provision an
  `employee`-role login from a `personnel` record, generating a random temp
  password.

> **FIXED (since 2026-06-22):** `seedSuperuser`, `setForcePasswordChange`, and
> `setRequiresDailyLog` were previously **public mutations with no guard** —
> anyone with the Convex URL could create an admin or **overwrite any user's
> password and set their role to admin** (account takeover). All three are now
> **`internalMutation`** (`convex/auth.ts:348,393,409`), so they are no longer
> client-callable; only server code (crons / other Convex functions) can invoke
> them. `createInitialAdmin` remains safe because it self-disables once any user
> exists. This closes the headline anonymous privilege-escalation hole.

### 2.3 Client auth context (`app/auth-context.tsx`)

- `AuthProvider` reads `ie_central_user_id` from `localStorage` on mount (migrates
  any legacy `sessionStorage` value), then live-queries `api.auth.getUser`.
- Has substantial **defensive session-recovery logic**: a 5-second timeout to
  clear a "stuck" session, and a `hasLoadedUserData` ref so transient `null`
  query results during navigation don't log the user out.
- Exposes `login`, `logout`, the `user` object, and a large set of
  **derived client-side permission booleans** (`canEdit`, `canManageUsers`,
  `canManageAdmins`, `canViewPersonnel`, `canManagePersonnel`, `canEditShifts`,
  `canDeleteRecords`, `canManageTimeOff`, `canModerateChat`, `isSuperAdmin`,
  `getAccessibleLocationIds`, …). These are computed from `user.role` with a
  `withOverride(key, roleBased)` helper that lets `permissionOverrides` win.
- **Note:** this older `canXxx` boolean set in `auth-context.tsx` overlaps with,
  but is *separate from*, the newer tier/permission-key system in
  `lib/permissions.ts` (§3). Both are live; the sidebar and many pages still use
  the legacy booleans.

### 2.4 Auth pages

| Route | File | Purpose |
|---|---|---|
| `/login` | `app/login/page.tsx` | Email/password form, waits for user data to load, redirects to `/change-password` if `forcePasswordChange` else `/`. Has a "Join a Meeting" link. |
| `/change-password` | `app/change-password/page.tsx` | Calls `api.auth.changePassword`; min 8 chars, confirm match. |
| `/join`, `/join/invite` | `app/join/*` | Meeting-code entry (Zoom-style meetings), usable pre-auth. |
| `/protected.tsx` | `app/protected.tsx` | `<Protected>` wrapper component (see §3.5). |

### 2.5 Impersonation — "Act as user" (`components/ImpersonationBanner.tsx` + `auth-context.tsx`)

- A **super-admin-only** feature. `startImpersonation(target)` checks: caller is
  `super_admin`, not already impersonating, target is not a super_admin, target
  is not self. It stores an `ImpersonationRecord` in `localStorage`
  (`ie_central_impersonation`) and the entire app then loads the **target** user
  (`effectiveUserId = impersonation?.targetUserId ?? userId`).
- Start and stop are both **audit-logged** (`impersonate_start` / `impersonate_end`)
  under the *real* super-admin's id.
- A persistent amber `ImpersonationBanner` shows "Acting as <name> — changes save
  as them" with a "Return to <real name>" button. Survives reloads.

> **Gotcha:** because impersonation simply swaps the `userId` the client sends,
> all writes made while impersonating are attributed to the **target** user in
> data (only the start/stop events name the real actor).

---

## 3. RBAC & Permissions

There are effectively **two coexisting permission systems**:
1. **Legacy `canXxx` booleans** in `app/auth-context.tsx` (role string checks).
2. **Tier + permission-key system** in `lib/permissions.ts` (the "new RBAC"),
   surfaced via the `usePermissions()` hook.

### 3.1 Roles and tiers

Roles map to a numeric **tier** (`lib/permissions.ts → getTier`):

| Tier | Label | Roles |
|---|---|---|
| **T5** | Super Admin | `super_admin` |
| **T4** | Admin | `admin` |
| **T3** | Director | `warehouse_director` |
| **T2** | Manager | `warehouse_manager`, `office_manager`, `retail_manager`, `retail_store_manager` |
| **T1** | Shift Lead | `department_manager`, `shift_lead`, `retail_associate` |
| **T0** | Employee | `member`, `employee` (default/fallback) |

The `UserRole` TS union in `auth-context.tsx` is narrower than the full role set
used by `getTier` / `getUsersFormatted` — the runtime accepts more roles than the
type lists.

### 3.2 The permission model (`lib/permissions.ts`)

Three layers, resolved in this precedence (override wins):

1. **Tier-based defaults** — functions like `getMenuPermissions`,
   `getATSPermissions`, `getPersonnelPermissions`, `getEquipmentPermissions`,
   `getTimePermissions`, `getDailyLogPermissions`, `getCalendarPermissions`,
   `getMessagesPermissions`, `getDashboardWidgetPermissions` each return a typed
   boolean map computed from the user's tier (e.g. `userManagement: tier >= 4`,
   `timeApproval: tier === 2 || tier >= 5`).
2. **Flag-based** — boolean user fields independent of tier:
   `isFinalTimeApprover`, `isPayrollProcessor`, `requiresDailyLog`,
   `hasEmailAccess` (default-on). E.g. `payrollExport` requires
   `isPayrollProcessor === true`.
3. **Per-user overrides** — `user.permissionOverrides: Record<string, boolean>`.
   `resolvePermission()` returns the override if the key is present, else the role
   default. `getResolvedPermissions()` merges all defaults + overrides into a flat
   map.

- **Permission keys** are namespaced strings: `menu.*`, `ats.*`, `personnel.*`,
  `equipment.*`, `time.*`, `calendar.*`, `messages.*`, `dashboard.*`,
  `dealerRebates.*`, `dunlopReporting.*`, and one `report.<id>` per report type
  (generated from `lib/reportTypes.ts`). `ALL_PERMISSIONS` + `PERMISSION_CATEGORIES`
  drive the admin override-editing UI.
- **Override-only permissions:** `menu.training` is granted by **no tier** except
  super_admin — everyone else needs an explicit `permissionOverrides["menu.training"] = true`
  (enforced server-side by `requireTrainingAccess`).
- **Location scoping:** T2 managers are location-scoped
  (`isLocationScoped`, `hasLocationAccess`, `getAccessibleLocations`): they only
  see their `managedLocationIds`; T3+ see all locations.
- `canAccessRoute(user, route)` maps ~50 routes to a `menu.*` key for route-level
  checks (defaults to allow for unmapped routes like `/login`).

### 3.3 `usePermissions()` hook (`lib/usePermissions.ts`)

The client-side entry point. Reads `useAuth().user`, queries
`getReporteesRequiringDailyLog` (for daily-log permissions), and returns a rich
object: `tier`, `tierName`, `hasMinTier`, `isLocationScoped`, the typed permission
sets (`menu`, `ats`, `personnel`, `equipment`, `time`, `dailyLog`, `calendar`,
`messages`, `dashboardWidgets`), utilities (`canAccessRoute`,
`getAccessibleLocations`, `hasPermission(key)`), and the flags. Returns an
all-false "loading/unauthenticated" object until auth resolves. Menu permissions
are built dynamically from the resolved override map so new keys auto-wire.

### 3.4 Server-side guards (`convex/authGuards.ts`)

Helper functions meant to be called at the top of privileged handlers; each throws
a plain `Error` on failure:

| Guard | Allows |
|---|---|
| `requireAdmin` | `super_admin`, `admin` (active) |
| `requireManagePersonnel` | `super_admin`, `admin`, `warehouse_director`, `department_manager`, `warehouse_manager` |
| `requireSelfOrManager(ownerId)` | the resource owner, else falls back to `requireManagePersonnel` |
| `requireTrainingAccess` | `super_admin` or `permissionOverrides["menu.training"] === true` |
| `requireRole(roles[])` | any explicit role list |
| `requireMinTier(ctx, userId, n)` | any user whose tier (via `ROLE_TIER`) is `>= n` |

All guards re-fetch the user via `ctx.db.get(requestingUserId)` and reject
inactive accounts.

> **New (security pass, since 2026-06-22):** `requireMinTier` was added
> (`convex/authGuards.ts:180`) to gate a handler to the **same tier its page already
> requires** (mirrors `getTier` in `lib/permissions.ts`, via the local `ROLE_TIER`
> map; `tierOf` is the non-throwing variant used by global search). It is the fix
> surface for queries that feed admin screens but must not leak to lower tiers —
> e.g. `equipment.listComputers` / `getRemoteAccessComputers` (tier 2,
> `equipment.ts:1685,1742`) and the `deletedRecords` read queries (tier 4, §5.2).

### 3.5 Route protection (`app/protected.tsx`)

`<Protected>` wraps page content and supports: `requireAdmin` (legacy),
`requiredRoles[]` (legacy), `minTier` (new RBAC), and `requireFlag`
(`isFinalTimeApprover` | `isPayrollProcessor` | `requiresDailyLog` |
`hasEmailAccess`). Unauthenticated → redirect `/login`; authorized-but-lacking →
redirect `/`. Shows a spinner while auth/permissions load. **This is client-side
gating only.**

### 3.6 Groups (`convex/groups.ts`)

A lightweight **messaging/distribution** grouping (not an RBAC primitive):
`groups` records hold `name`, `color`, `memberIds[]`, `isActive`. CRUD (`list`,
`getForUser`, `create`, `addMembers`, `removeMember`, `archive`) used for group
messaging/announcements. **None of these mutations carry a permission guard.**

### 3.7 RBAC audit conclusions (`RBAC_AUDIT.md` + `RBAC_AUDIT_BACKEND.md`)

Two audits exist in the repo root. **Both conclude the system is NOT remediated.**

**Frontend audit (`RBAC_AUDIT.md`)** — 92 routes, 89 permission keys across 13
categories, 3 layers. Findings:
- Route protection is uneven (18 tier-gated, 2 role-gated, 4 flag-gated, ~50
  generic-`Protected`, 8 intentionally open).
- **~81 of 89 permission keys are "dead"** — defined but never checked on the
  frontend (most dashboard-widget, document, and ATS-action keys).
- Most **mutations are ungated on the frontend**, relying entirely on (unverified)
  backend enforcement. Dashboard widget toggles, the announcements page (uses the
  legacy `canManageAnnouncements` instead of `menu.announcements`), and Dunlop
  action gates are flagged as the top concerns.
- Conclusion: frontend RBAC is **dependent on backend enforcement**; frontend-only
  fixes are insufficient.

**Backend audit (`RBAC_AUDIT_BACKEND.md`)** — 565+ mutations/actions across 78
Convex files. Findings (severity-rated):
- **~97% of mutations have no explicit permission check.** Only a handful (the
  auth mutations) validate the caller.
- **~280 mutations are identity-spoofing vulnerabilities**: they accept a `userId`
  arg (for audit attribution) but **never verify it grants permission**.
- **7 CRITICAL** findings incl. `auth.updateUser` (anyone can promote any account
  to `super_admin` / set `permissionOverrides` — identity takeover),
  `auth.createUser` (backdoor super-admin creation), `personnel.terminate`
  (fire/deactivate anyone), `personnel.create/update` (pay-rate fraud),
  `mileage.create` + `expenseReports.approve` (self-approved reimbursement fraud),
  `locations.update` (change PIN/alarm/gate codes), `safetyChecklist.submit`
  (falsify compliance records). Plus 6 HIGH.
- Crons and the HTTP webhooks **are** protected (server-only / shared-secret); the
  exposure is the client-callable mutations.
- Recommendation: introduce a standard server-side permission helper and lock down
  auth → financial/personnel → all CRUD, est. 4-6 weeks. **Status: not remediated.**

> The `convex/authGuards.ts` helpers in §3.4 are the *intended* fix surface, but
> at audit time were applied to only a small fraction of handlers (notably the
> `auth.*` user-management mutations now call `requireAdmin`).

**Security-hardening pass (`docs/iecentral/SECURITY-FINDINGS.md`, 2026-06-22).** A
follow-up read of the backend (665 mutations, ~195 guard call-sites) re-confirmed
the audit and **fixed the most dangerous anonymous-disclosure / takeover items**.
Fixed in that pass:

| Item | Before | Now |
|---|---|---|
| `auth.seedSuperuser` | anon could create an admin or overwrite any user's password + role (takeover) | → `internalMutation` |
| `auth.setForcePasswordChange`, `auth.setRequiresDailyLog` | public, patch any userId, no check | → `internalMutation` |
| `quickbooks.generateQwcFile` | public query leaking QBWC username + plaintext password | → `internalQuery` |
| `zoomAccounts.getWithCredentials` | public query returning any user's Zoom OAuth tokens | → `internalQuery` (+ action repointed to `internal.*`) |
| `documentFolders.getFolderWithPassword`, `getDocumentsInternal` | public — leaked folder `passwordHash` / bypassed folder access control | → `internalQuery` |
| `locations.list`/`listActive`/`listActiveWarehouses`/`get`/`getByName` | public queries returned every location's PIN/alarm/gate codes, wifi password, security notes | secrets **stripped** from public queries; guarded `locations.listWithSecurity` (`requireAdmin`) added for the admin page (`locations.ts:13,72`) |
| `equipment.listComputers`/`getRemoteAccessComputers` | public — returned every computer's admin/user passwords + remote-access code/URL | gated to **tier 2** via `requireMinTier` (`equipment.ts:1685,1742`) |
| `deletedRecords.getDeletedRecords`/`getDeletionAuditLog`/`getDeletedRecordCounts` | public — full JSON snapshots of soft-deleted records (incl. secrets) | gated to **tier 4** via `requireMinTier` (`deletedRecords.ts:36,65,325`) |

**Still open** (per SECURITY-FINDINGS): `auditLogs.log` (forgeable),
`scannerMdm.logScannerCommand`, `quickbooks.saveConnection`,
`ftpConnections.getWithCredentials`/`create`/`update`, the payroll/time-approval
bypass set, cross-user HR writes, `messages.*` / `documents.getDownloadUrl` /
`documentFolders.*`, etc. **The system is still NOT fully remediated** — the pass
stopped the worst secret-leaks but most CRUD remains guard-by-omission.

---

## 4. App Shell & Navigation

### 4.1 Appearance system

`AppearanceContext` (`app/appearance-context.tsx`) persists an `appearance` value
to `localStorage`: `modern` | `desktop` | `jmk` | `pipboy` | `amber` | `dracula`.
`ThemeContext` (`app/theme-context.tsx`) is an orthogonal **dark/light** toggle,
persisted under the versioned key `theme-v2` (bumped from the unversioned `theme`
to force the new iOS light default onto existing dark-saved users).

### 4.2 Shell chooser (`components/shell/AppShell.tsx`)

- If `?shell=none` in the URL → render bare children (used by iframe windows in
  Desktop mode).
- On mobile (`<768px`) → always bare children (the `modern` mobile layout).
- Otherwise switch on appearance: `desktop` → `DesktopShell`, `jmk` → `JMKShell`,
  `pipboy`/`amber`/`dracula` → a themed wrapper div, default → bare.

Three shells:
- **`DesktopShell.tsx`** — a full **windowing-manager OS metaphor**: draggable
  desktop icons (positions saved to `localStorage`), multi-window with
  drag/resize/minimize/maximize/z-order, a Start menu, taskbar with clock and
  pinned quick-launch, and selectable wallpapers. The *focused* window renders the
  real React `children`; background windows render the same route in an
  `<iframe src="…?shell=none">`.
- **`JMKShell.tsx`** — a terminal/"JMK" themed chrome.
- The `modern` default uses the standard **`components/Sidebar.tsx`**.

### 4.3 Sidebar (`components/Sidebar.tsx`, ~892 lines)

The primary navigation. Nav items are grouped into collapsible sections ("People
& HR", "Equipment", etc.) with optional `section` sub-headers (Hiring, Scheduling,
Portal, Organization, Training, …). Visibility is driven by a mix of
`useAuth()` legacy booleans, `usePermissions()` tier/menu checks, and live Convex
queries. Top-level items include Dashboard, Messages, Email, Calendar, Meetings,
Notifications, and the grouped business modules (Jobs, Applications, Personnel,
Shifts, Time Clock, Users, Org Chart, Reports, Equipment, Doc Hub, Safety
reports, Training, etc.).

### 4.4 Global search (`components/GlobalSearch.tsx` + `convex/search.ts`)

> **Substantially rewritten since the original doc.** Global search was previously
> a brute-force, *unfiltered* scan returning results regardless of who could open
> them. It is now **permission-aware**: every bucket is gated to the same rule its
> area enforces, so a result appears only if the requesting user could actually
> open the target.

**Backend (`convex/search.ts → globalSearch`)** — a `query` that now takes
`{ requestingUserId, searchQuery }` (`search.ts:22`). It still `.collect()`s each
source table and does a `toLowerCase()` substring match (no search index yet), but
with these additions:

- **Caller resolution & gating.** It loads the requesting user, bails if missing/
  inactive, and computes their tier via `tierOf(user.role)` from `authGuards.ts`
  (`search.ts:28-31`). Buckets are then tier-gated:
  - **Doc Hub documents** — all authenticated users, but each candidate is run
    through the **visibility predicate** (`search.ts:63-86`, see below).
  - **Personnel + applications** — `tier >= 2` (`search.ts:89`).
  - **Users** — `tier >= 4` (`search.ts:111`).
  - **Scanners + pickers** (equipment) — `tier >= 2` (`search.ts:124`).
  - **Projects** — visible if the user is the creator, is in `sharedWith`, or is
    `tier >= 4` (`search.ts:148`).
  - **Announcements, locations** — all authenticated users (`search.ts:154,163`).
    (Location *results* are just name + a `/locations` link; the secret fields are
    not part of the search payload — see §3.7 on the locations lockdown.)
- **Doc Hub visibility predicate (`lib/docVisibility.ts → canSeeDocument`).** This
  pure helper was **extracted from `convex/documents.ts`'s `getAll` so the same
  rule can be reused by search and unit-tested without Convex** (`docVisibility.ts:1-31`).
  A doc is visible when: it is **not** inside a password-protected folder the user
  neither owns nor has an un-revoked `folderAccessGrants` grant to; AND (the user
  uploaded it, OR its `visibility` is `community`/`internal`, OR `isPublic`, OR the
  user is in `sharedWith`, OR the user is in a group listed in `sharedWithGroups`).
  `globalSearch` pre-computes the user's group memberships and the set of
  `lockedFolders` before the doc loop (`search.ts:36-57`) and passes them in.
- **Caps & shape.** `PER = 6` per source (so one bucket can't crowd out the rest),
  `TOTAL = 30` overall (`search.ts:16-17`). Each result is
  `{ type, id, title, subtitle, href, icon, category }`; categories are `Documents`,
  `People`, `Operations` (and `Tires`, added client-side). Returns
  `{ results, totalCount }`.

**Deep-links.** Result `href`s point straight at the target:
- Documents → `/documents?doc=<id>` (Doc Hub opens the **preview** for that doc).
- Personnel → `/personnel/<id>`; applications → `/applications/<id>`.
- Users → `/users`; equipment → `/equipment`; projects → `/projects`;
  announcements → `/announcements`; locations → `/locations`.
- Tires → `/reports/inventory?search=<itemId>` (jumps the inventory report to that
  item — see below).

**Frontend (`components/GlobalSearch.tsx`).** Opened with **Cmd/Ctrl-K** (or the
`openGlobalSearch()` custom-event helper / `SearchButton`). Notable behavior:
- **250 ms debounce** on the query (`GlobalSearch.tsx:107-111`); the Convex query is
  `"skip"`ped until there are ≥ 2 chars **and** a logged-in user, and it passes the
  current `user._id` as `requestingUserId` (`GlobalSearch.tsx:113-116`).
- **Tires are merged client-side**, because tire data lives in **S3, not Convex**.
  Only users with the `menu.reports` permission (`usePermissions()`) fire a `fetch`
  to **`/api/reports/tire-search?q=…`**; the top 6 hits are mapped into `tire`-typed
  results deep-linking to the inventory report (`GlobalSearch.tsx:119-142`).
- **Grouped, ordered results.** DB + tire results are merged and sorted by a fixed
  category order `["People","Documents","Tires","Operations"]`, memoized so the
  array reference is stable (an inline array would reset the keyboard selection on
  every render) (`GlobalSearch.tsx:147-153`). Category sub-headers render when the
  category changes (`GlobalSearch.tsx:266-273`).
- **Arrow-key navigation.** ↑/↓ move `selectedIndex` (clamped), Enter opens the
  selected result, Esc closes; selection resets when results change
  (`GlobalSearch.tsx:190-210`). A "Showing top matches — refine your search" hint
  appears when `totalCount` exceeds the rendered count.

> **Scaling note (unchanged):** `globalSearch` still `.collect()`s whole tables and
> filters in memory — fine at current volume, a cliff later. The win is correctness/
> security (per-bucket gating + the visibility predicate), not yet indexing.

### 4.5 Keyboard shortcuts (`components/KeyboardShortcuts.tsx`)

Global key handler (ignored while typing in inputs): `?` opens the shortcuts
modal; `g` then `h/p/m/n/r/s` navigates (Home/Projects/Messages/Notifications/
Reports/Settings); `Esc` closes. `Cmd/Ctrl-K` (search) is documented here but
handled by `GlobalSearch`. Exposes an `openKeyboardShortcuts()` helper via a
custom window event.

### 4.6 System banners (`components/SystemBanner.tsx` + `convex/systemBanners.ts`)

Site-wide announcement bars. `systemBanners.getActive` returns non-expired active
banners; the component filters by device (`showOnMobile`/`showOnDesktop`) and
**per-banner dismissal persisted in `localStorage` (`dismissedBanners`)**. Types:
`info|warning|error|success` (color-coded), optional link, optional `expiresAt`,
optional `dismissible`. CRUD (`create/update/toggle/remove`) — **note these
mutations take a `userId` for `create` but have no permission guard.**

---

## 5. Audit Logging & Soft-Delete

### 5.1 Audit logs (`convex/auditLogs.ts`, `app/audit-log`)

- `auditLogs` table: `action`, `actionType`, `resourceType`, `resourceId`,
  `userId`, `userEmail`, `details`, `timestamp`.
- `log` (mutation) inserts an entry — called throughout the app (login,
  impersonation, soft-delete/restore, password resets, etc.). **No guard** on
  `log` itself.
- Queries: `getAll` (filter by actionType/resourceType/user/date-range, paginated
  — note it `.collect()`s all logs then filters/paginates in memory),
  `getByResource`, `getActionTypes`, `getResourceTypes`, `getUsers`.
- `app/audit-log` is the admin viewer (gated to T4+ via `menu.auditLog`).
- A separate **email audit log** (`emailAuditLog` table) and a weekly cleanup cron
  exist for the email client.

### 5.2 Soft-delete & restore (`convex/deletedRecords.ts`, `app/deleted-records`)

- Supports a fixed allowlist of tables: `personnel`, `users`, `jobs`,
  `applications`, `announcements`, `events`, `documents`, `projects`, `equipment`.
- `softDeleteRecord` (admin/super_admin): serializes the original row into
  `deletedRecords.recordData` (JSON), builds a human summary, deletes the
  original, and writes an audit entry.
- `restoreRecord` (**super_admin only**): re-inserts the JSON into the original
  table (stripping `_id`/`_creationTime`, so it gets a **new id**), marks the
  archive `restoredAt`/`restoredBy`, audits it.
- `permanentlyDelete` (**super_admin only**, "GDPR/compliance"): audits then
  removes the archive row.
- Queries: `getDeletedRecords`, `getDeletionAuditLog`, `getDeletedRecordCounts` —
  **now gated by `requireMinTier(ctx, requestingUserId, 4)`** (`deletedRecords.ts:36,65,325`),
  matching the T4+ `/deleted-records` page. Previously these were public queries
  that returned full JSON snapshots of soft-deleted rows (including any secrets in
  them) to any anonymous caller — that leak is closed (§3.7 / SECURITY-FINDINGS).

> **GOTCHA — split auth model within this one file.** The **read queries** above
> use the project's standard **userId-arg model** (a `requestingUserId` + a
> `requireMinTier` guard). But the **write mutations** (`softDeleteRecord`,
> `restoreRecord`, `permanentlyDelete`) still use **`ctx.auth.getUserIdentity()`**
> (Convex built-in auth) to identify the caller, then look the user up by email
> (`deletedRecords.ts:86,184,281`). Per `authGuards.ts`, Convex built-in auth is
> **not wired up** in this project — so `getUserIdentity()` returns `null` and
> these mutations **fail closed** ("Not authenticated") for everyone through the
> normal client path. Net effect: the soft-delete/restore *writes* appear
> effectively non-functional via the standard client, even though the *reads* are
> now properly gated. Verify before relying on the write path.

---

## 6. Users Management

- **There is no `convex/users.ts`.** All user CRUD lives in **`convex/auth.ts`**
  (see §2.2): `getAllUsers`, `getUsersFormatted`, `getUser`, `createUser`,
  `updateUser`, `resetUserPassword`, `deleteUser`, `getReportees`,
  `getReporteesRequiringDailyLog`, plus the employee-portal provisioning
  mutations. The admin-facing ones gate on `requireAdmin`.
- `getUsersFormatted` is the display query: sorts by tier then name and emits a
  `T#`-labeled role, status, managed locations/departments, and **flags** (Daily
  Log / Final Time Approver / Payroll Processor).
- The **`users` schema row** carries: `email`, `passwordHash`, `name`, `title`,
  `role`, `isActive`, `forcePasswordChange`, `lastLoginAt`, `createdAt`,
  `managedLocationIds[]`, `managedDepartments[]`, `reportsTo`, `personnelId`
  (links to a `personnel` record for employee logins), `requiresDailyLog`,
  `isFinalTimeApprover`, `isPayrollProcessor`, `permissionOverrides`,
  `hasEmailAccess`. Indexes: `by_email`, `by_reports_to`, `by_personnel`.
- The admin UI is **`app/users/page.tsx`** (~1,376 lines): create/edit users,
  assign roles/locations/departments, toggle flags, edit the per-user
  `permissionOverrides` (driven by `ALL_PERMISSIONS`), reset passwords, and
  launch **"Act as user"** impersonation (super_admin only).

---

## 7. Convex Schema Overview (`convex/schema.ts`, ~149 tables, 3,662 lines)

A high-level grouping of the table families (representative tables, not exhaustive):

| Family | Representative tables |
|---|---|
| **Platform / auth / RBAC** | `users`, `groups`, `credentials`, `systemBanners`, `auditLogs`, `deletedRecords`, `userDashboardSettings` |
| **ATS / hiring** | `jobs`, `applications`, `applicationActivity`, `offerLetters`, `indeedWebhookLogs`, `indeedJobMappings`, `contactMessages`, `dealerInquiries` |
| **Personnel / HR** | `personnel`, `personnelCallLogs`, `writeUps`, `attendance`, `merits`, `performanceReviews`, `employeeReviews`, `exitInterviews`, `onboardingDocuments`, `documentSignatures` |
| **Time & attendance / payroll** | `timeEntries`, `timeCorrections`, `timesheetApprovals`, `timeOffRequests`, `callOffs`, `overtimeOffers`, `overtimeResponses`, `ptoPolicies`, `ptoBalances`, `payStubs`, `payrollCompanies` |
| **Scheduling** | `shifts`, `shiftTemplates`, `shiftDailyTasks`, `scheduleOverrides`, `holidays`, `dailyLogs`, `dailyTaskTemplates`, `dailyTaskCompletions` |
| **Projects / collaboration** | `projects`, `tasks`, `projectNotes`, `projectSuggestions` |
| **Messaging / comms** | `conversations`, `messages`, `typingIndicators`, `chatRooms`, `chatMessages`, `broadcastMessages`, `announcements`, `announcementReads`, `notifications` |
| **Email client** | `emailAccounts`, `emailFolders`, `emails`, `emailAttachments`, `emailDrafts`, `emailSendQueue`, `emailLabels`, `emailTemplates`, `sharedMailboxes`, `emailContacts`, `emailAnalytics`, `emailAuditLog`, `emailSearchIndex`, `emailDomainConfigs`, … (~20 tables) |
| **Calendar / meetings** | `events`, `eventInvites`, `calendarShares`, `meetings`, `meetingParticipants`, `meetingInvites`, `meetingNotes`, `meetingSignals`, `zoomAccounts` |
| **Doc Hub** | `documents`, `documentVersions`, `documentTemplates`, `docHubSignatures`, `documentFolders`, `folderAccessGrants`, `folderAccessLog`, `userFolderOrder` |
| **Equipment / fleet** | `equipment`, `equipmentAgreements`, `equipmentConditionChecks`, `equipmentHistory`, `equipmentChecklistConfig`, `vehicles`, `safetyChecklistTemplates`, `safetyChecklistCompletions` |
| **Scanner MDM (Zebra/IoT)** | `scanners`, `pickers`, `scannerMdmConfigs`, `scannerCommandLog`, `scannerProvisionCodes`, `scannerSetupLogs`, `scannerLockPolicy` |
| **Reports / data ingestion** | `jmkReportTypes`, `jmkUploadHistory`, `reportUploadAccess`, `reportDataUploads`, `savedReportConfigs`, `cirReportRuns`, `inventoryAdjustments`, `inventoryItems`, `tireCatalog`, `salesHistory`, `scratchpadCodes`, `ftpConnections` |
| **Tools / finance** | `dealerRebateDealers`, `dealerRebateUploads`, `dealerRebateMonthly`, `wtdCommissionCustomers`, `wtdCommissionAccess`, `wtdCommissionReports`, `mileageEntries`, `expenseReports` |
| **QuickBooks integration** | `qbConnection`, `qbEmployeeMapping`, `qbSyncQueue`, `qbSyncLog`, `qbPendingTimeExport`, `qbwcSessions` |
| **Surveys / engagement** | `surveyCampaigns`, `surveyAssignments`, `surveyResponses` |
| **Training** | `trainingSegments`, `trainingVideos`, `trainingSessions`, `trainingCompletions`, `trainingAssignments` |
| **Safety reporting** | `safetyReports` ("See Something, Say Something" anonymous reports) |
| **Push / labels / misc** | `employeePushTokens`, `webPushSubscriptions`, `labelWorkOrders`, `techWizardChats` |

---

## 8. Integrations

| Integration | Where | How |
|---|---|---|
| **AWS S3** | `app/api/**` route handlers | Presigned upload/download URLs and direct object reads via `@aws-sdk/client-s3` + `s3-request-presigner` (reports, Doc Hub, training video, dealer-rebates, WTD commission, CIR). |
| **AWS Lambda** | `app/api/**` | `@aws-sdk/client-lambda` `InvokeCommand` for Office→PDF (`aws/office-to-pdf`, private LibreOffice Lambda), Dunlop SFTP (`aws/dunlop-reporter`), email proxy (`aws/email-proxy`), scanner MDM (`aws/scanner-mdm`). |
| **AWS IoT (scanner MDM)** | `convex/http.ts` + `aws/scanner-mdm` | Zebra TC51 devices POST telemetry to the Convex `/scanner-telemetry` httpAction (shared secret `SCANNER_WEBHOOK_SECRET`) and claim certs via `/claim-provision`. |
| **Email (IMAP/SMTP)** | `convex/email/*`, `aws/email-proxy` | `imapflow`/`nodemailer`/`mailparser`; OAuth tokens & IMAP passwords encrypted with `EMAIL_ENCRYPTION_KEY`. Synced by crons (every 5 min). |
| **QuickBooks** | `convex/quickbooks.ts`, `app/api/qbwc` | QuickBooks Web Connector session handling. |
| **Indeed / Zoom / Giphy / Anthropic** | various | Indeed ATS webhooks, Zoom meetings, Giphy in chat, Anthropic for Tech Wizard / AI features (CSP-allowlisted). |

### 8.1 Scheduled jobs

- **Vercel crons** (`vercel.json`): sales refresh (daily 10:00), report
  auto-process (weekdays 09:00), Dunlop monthly run.
- **Convex crons** (`convex/crons.ts`): auto-archive done projects, auto-expire
  old applications, weekly daily-log digest, monthly dealer-rebate cleanup, a
  large set of **email** jobs (sync every 5 min, process scheduled/snoozed sends
  every minute, retry every 5 min, plus daily/weekly/monthly cleanups), and
  scanner MDM jobs (expire provision codes, mark scanners offline every 5 min).

---

## 9. Notable Gotchas & Design Decisions (quick reference)

1. **Client-trusted "userId-arg" auth** — no server session/JWT; the logged-in
   `users._id` lives in `localStorage` and is passed as a function argument.
   Security depends entirely on each handler calling an `authGuards` helper, and
   most do not (§3.7).
2. **Two RBAC systems coexist** — legacy `canXxx` booleans in `auth-context.tsx`
   vs. the tier/permission-key system in `lib/permissions.ts`. Know which a page
   uses before changing access.
3. **`deletedRecords.ts` write mutations use `ctx.auth.getUserIdentity()`** — the
   only handlers relying on Convex built-in auth, which isn't wired up, so the
   soft-delete/restore *writes* fail closed via the normal path. (The *read*
   queries were switched to the userId-arg model + `requireMinTier(4)` in the
   security pass — see §5.2.)
4. **Unguarded sensitive mutations (partially remediated).** A 2026-06-22 security
   pass made `seedSuperuser`/`setForcePasswordChange`/`setRequiresDailyLog`
   `internal*`, locked down credential-leaking queries (QBWC, Zoom tokens, folder
   passwords), stripped location security codes from public queries, and tier-gated
   the computer-password + deleted-record queries (§3.7). **But** `groups.*`,
   `systemBanners.*`, `auditLogs.log`, and the bulk of app CRUD still have no
   permission check (the backend audit's ~97%-ungated finding stands).
5. **Convex deploys on every Vercel build** (`buildCommand` runs `npx convex
   deploy`). Pushing `origin/main` ships frontend *and* backend together.
6. **Hardcoded Convex URL** in `app/providers.tsx` (not read from env), so the
   client always targets the `outstanding-dalmatian-787` production deployment.
7. **Service-worker staleness is a known production hazard** — `clientsClaim` +
   `cleanupOutdatedCaches` are deliberately forced in `next.config.ts`.
8. **`globalSearch` and `auditLogs.getAll` `.collect()` whole tables** then filter
   in memory — fine now, a scaling cliff later. Global search results **are now
   permission-filtered** (per-bucket tier gating + a Doc Hub visibility predicate,
   §4.4); it's the indexing, not the security, that's still pending.
9. **Impersonation attributes writes to the target user** in the data; only the
   start/stop events record the real super-admin.
10. **Heavy report routes need raised limits** (2048MB / up to 300s in
    `vercel.json`); large workbooks must be streamed, not loaded whole, to avoid
    OOM on the serverless function.
```

