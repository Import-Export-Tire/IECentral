# ctx.auth — Server-verified identity for IECentral

**Date:** 2026-07-07
**Status:** Design (Phase 0), approved to spec
**Author:** Andy + Claude

## Problem

Every Convex function trusts a client-supplied identity. Login validates a
PBKDF2 password server-side and returns the user; the client then stashes
`userId` in `localStorage` and passes it (`requestingUserId` / `userId`) to
subsequent functions, which **trust it**. Anyone can call any function with any
`userId` and act as that user. `authGuards.ts` performs role/owner checks — but
against the spoofable id, so the guards are only as trustworthy as the caller.

Surface: ~59 Convex files pass `requestingUserId` / `userId: v.id("users")`.

## Goal / Non-goals

**Goal:** make the caller's identity **server-verified and non-spoofable**, with
the *least* disruption — keep the existing `users` table, PBKDF2 passwords, the
9-role RBAC model, `sessionEpoch`, and super-admin impersonation exactly as they
are. Functions derive identity from a trusted session, not a client argument.

**Non-goals (explicitly out):** replacing the password system, adopting a hosted
provider (Clerk) or `@convex-dev/auth`, SSO/MFA, per-device session management.
These were considered and declined in favor of minimal disruption.

## Approach (decided)

- **Custom self-issued JWT + real `ctx.auth`.** After the existing PBKDF2 check,
  login signs a short-lived JWT; the Convex client attaches it once; functions
  read the trusted user via `ctx.auth.getUserIdentity()`. No per-function token
  argument (avoids threading a token through ~59 files + hundreds of call sites).
- **Revocation via `sessionEpoch`** (already on the `users` table): the JWT
  carries the epoch; `requireAuth` rejects a token whose epoch ≠ the user's
  current epoch. Bumping the epoch (logout / password change / force-logout)
  invalidates all outstanding tokens instantly. Global revocation only.

## Decomposition (program, not one change)

- **Phase 0 — Session/identity foundation** (this spec). Self-contained;
  buildable and verifiable without touching the 59 files.
- **Phases 1…N — Migration.** File-by-file, replace "trust the arg" with
  `const me = await requireAuth(ctx)`, highest-risk first (meetings, personnel,
  documents, payroll, and the backend-security-findings backlog). Old args keep
  working during transition; drop them and enforce at the end. Each phase gets
  its own plan.

Only Phase 0 is specified here.

## Phase 0 — Detailed design

### 1. JWT issuance
- Algorithm **ES256** (asymmetric): Convex verifies with the public key (JWKS);
  only the signer holds the private key. Keys generated once; private key in env
  `AUTH_JWT_PRIVATE_KEY` (PKCS8), public key published via JWKS.
- Claims: `sub` = userId, `epoch` = `user.sessionEpoch ?? 0`, `iss`/`aud` set to
  a fixed app identifier, `exp` ≈ **60 min**. Optional `impersonatedBy` (see §6).
- Signing runs in a Convex **Node action** (`"use node"`) using `jose`
  (`SignJWT` + `importPKCS8`). A token is only ever minted together with a
  password check — never on its own.
- **Login:** a single Node action `auth.loginWithToken({ email, password })`
  verifies the password (reusing the existing PBKDF2 hash logic) and, on success,
  returns `{ success, user, token }`. The old `login` mutation stays for
  backward compatibility until all callers move over, then is removed.
- **Refresh:** `auth.refreshToken()` reads `ctx.auth` (a currently-valid token);
  if the user's epoch still matches it returns a fresh 60-min token. The client
  refreshes a few minutes before expiry.

### 2. `auth.config.ts`
Register a **custom-JWT provider** so Convex trusts our tokens:
```ts
export default {
  providers: [{ type: "customJwt", applicationID: "iecentral",
    issuer: "https://iecentral.auth", jwks: <JWKS URL or inlined public JWKS> }],
};
```
The JWKS exposes only the ES256 public key. `ctx.auth.getUserIdentity()` then
returns `{ subject: userId, ...claims }` for a valid token.

### 3. Client wiring (`app/providers.tsx`, `app/auth-context.tsx`)
- Swap `ConvexProvider` → `ConvexProviderWithAuth`, given a
  `useAuthFromContext()` hook that returns `{ isLoading, isAuthenticated,
  fetchAccessToken }`. `fetchAccessToken({ forceRefreshToken })` returns the
  stored JWT (refreshing when forced/expired).
- `auth-context` stores the JWT (localStorage) alongside the existing user; login
  saves it, logout clears it, refresh replaces it. Login/logout UX unchanged.
- `ConvexHttpClient` in Next API routes: user-triggered routes attach the JWT
  (`convex.setAuth(token)`); cron/webhook routes use `internal*` functions with
  no user identity.

### 4. `requireAuth` and guards (`convex/authGuards.ts`)
```ts
// Returns the trusted, current user. Throws if unauthenticated or revoked.
async function requireAuth(ctx): Promise<Doc<"users">> {
  const ident = await ctx.auth.getUserIdentity();
  if (!ident) throw new ConvexError("Not authenticated");
  const user = await ctx.db.get(ident.subject as Id<"users">);
  if (!user || !user.isActive) throw new ConvexError("Not authenticated");
  const tokenEpoch = Number(ident.epoch ?? 0);
  if ((user.sessionEpoch ?? 0) !== tokenEpoch) throw new ConvexError("Session expired");
  return user;
}
```
Plus `requireRole(ctx, roles[])` and a reworked `requireSelfOrManager(ctx,
targetUserId)` that derives the **actor** from `requireAuth(ctx)` instead of a
passed arg. Existing guard call sites migrate to these in the later phases.

### 5. Revocation
`sessionEpoch` on `users` is the single source of truth. A `bumpEpoch(userId)`
internal helper is called on logout, password change, and an admin
"force-logout". Any token minted before the bump fails the epoch check.

### 6. Impersonation (server-side)
- `startImpersonation({ targetUserId })` — an action that calls `requireAuth`,
  asserts the caller is `super_admin`, and returns a JWT with `sub =
  targetUserId`, `epoch = target.sessionEpoch`, and `impersonatedBy = realUserId`.
- `requireAuth` returns the effective (target) user; a companion
  `getActor(ctx)` exposes `{ effectiveUser, realUserId, isImpersonating }` for
  audit logging. Stop → re-issue the real user's token.
- Replaces today's client-only `localStorage` impersonation (which the server
  never verified).

### 7. Public functions (allowlist)
These intentionally do **not** call `requireAuth`; everything else must:
`auth.loginWithToken`, `auth.refreshToken`, guest `/join` paths
(`meetingParticipants.join` with code/token, `meetings.getByJoinCode`,
`meetingInvites.getByToken`), careers `applications.submitApplication`, and the
public safety-report submission. This list is enumerated and reviewed as part of
Phase 0; anything not on it is authenticated once its file is migrated.

## Data model changes
- **No new tables.** Reuse `users.sessionEpoch` (exists). Add nothing to schema
  for Phase 0. (Per-device sessions table is a deferred optional enhancement.)
- New env vars: `AUTH_JWT_PRIVATE_KEY` (PKCS8), and the public JWKS (inlined in
  `auth.config.ts` or served at a stable URL).

## Migration / rollout strategy
1. Ship Phase 0 on a branch; do **not** enforce `requireAuth` broadly yet.
2. Client attaches the JWT from day one, so both worlds coexist: existing
   functions keep accepting `requestingUserId`; newly-migrated functions call
   `requireAuth`. No mixed-state security gap because migrated functions stop
   trusting the arg entirely.
3. Verify the foundation end-to-end (below) before migrating any surface.
4. Later phases migrate file groups; final cleanup removes the now-unused
   `requestingUserId` args.

## Verification plan (Phase 0, before any migration)
Because a mistake here can lock everyone out, verify against a real deployment
(dev/preview) before merging:
1. Log in → confirm a JWT is issued and `ctx.auth.getUserIdentity()` resolves in
   a scratch authenticated query.
2. Call a scratch `requireAuth` query while logged in → returns the correct user;
   while logged out → throws "Not authenticated".
3. Bump epoch (simulate password change) → the old token's `requireAuth` throws
   "Session expired"; re-login works.
4. Refresh near expiry → new token, no interruption.
5. Impersonation: super-admin starts → effective identity is target,
   `impersonatedBy` present; non-super-admin attempt → rejected.
6. A public function (guest `/join`) still works with no token.

## Risks
- **Lockout** — mitigated by branch + full end-to-end verification before merge,
  and by keeping the old `login` path until the JWT path is proven.
- **Key management** — private key only in env; JWKS exposes public key only;
  rotating the key bumps all sessions (acceptable, rare).
- **Clock skew** on `exp`/`epoch` — allow small `exp` leeway; epoch is exact.
- **API-route callers** must attach the token; enumerated in §3.

## Open questions
None blocking Phase 0. Deferred (not in scope): per-device session list, MFA,
SSO, and the eventual removal timeline for `requestingUserId` args (handled in
migration phases).
