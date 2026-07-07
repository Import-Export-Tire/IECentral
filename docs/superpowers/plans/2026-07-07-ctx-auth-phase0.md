# ctx.auth Phase 0 (session/identity foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give IECentral server-verified caller identity via a self-issued ES256 JWT read through Convex `ctx.auth`, without changing the existing users table, PBKDF2 passwords, roles, or impersonation model.

**Architecture:** Login verifies the existing PBKDF2 password, then a Convex Node action signs a short-lived ES256 JWT (`sub`=userId, `epoch`=user.sessionEpoch). The Convex React client attaches it via `ConvexProviderWithAuth`; a public JWKS endpoint lets Convex verify it; functions call `requireAuth(ctx)` to get the trusted user. `sessionEpoch` is the revocation lever. No per-function token argument. This phase builds the foundation only — the ~59 files that trust `requestingUserId` are migrated in later phases.

**Tech Stack:** Next.js 15 (App Router), Convex 1.31.6, `jose` (ES256 JWT), existing PBKDF2 login in `convex/auth.ts`.

## Global Constraints

- **No test framework in this repo** — `npx tsc --noEmit` is the correctness gate; there is no jest/vitest/eslint. "Verify" steps mean tsc and/or exercising a **dev Convex deployment**, never unit tests.
- **Do not change** the `users` table password/role fields, the PBKDF2 hashing in `convex/auth.ts`, or existing `requestingUserId` args (later phases remove those).
- **Convex custom-JWT config is exact:** `{ type: "customJwt", applicationID, issuer, jwks (URL), algorithm }`. `jwks` MUST be a publicly-fetchable URL (Convex Cloud fetches it) — localhost will not work, so the JWKS endpoint is served from the deployed Vercel site and the SAME public JWKS/issuer is used by both the dev and prod Convex deployments.
- **`ctx.auth.getUserIdentity()`** returns `subject` (= `sub`) and passes custom claims through (`epoch`, `impersonatedBy`) via its `[key: string]: JSONValue` index.
- **Secrets:** `AUTH_JWT_PRIVATE_KEY` (PKCS8 PEM) set in **Convex** env (dev + prod); `AUTH_JWT_PUBLIC_JWK` (public JWK JSON, includes `kid`) set in **Vercel** env for the JWKS route. Private key never leaves Convex env.
- Do not deploy/enforce `requireAuth` on existing functions in this phase; only add the helper and a scratch verification query.

---

### Task 1: Add `jose` and generate the ES256 keypair

**Files:**
- Modify: `package.json` (add `jose` dependency)
- Create: `scripts/gen-auth-keys.mjs` (one-off keypair generator)

**Interfaces:**
- Produces: env values `AUTH_JWT_PRIVATE_KEY` (PKCS8 PEM) and `AUTH_JWT_PUBLIC_JWK` (JSON string incl. `kid: "auth-key-1"`, `alg: "ES256"`, `use: "sig"`).

- [ ] **Step 1: Install jose**

Run: `npm install jose`
Expected: `jose` appears in `package.json` dependencies; install succeeds.

- [ ] **Step 2: Create the keypair generator script**

Create `scripts/gen-auth-keys.mjs`:

```js
import { generateKeyPair, exportPKCS8, exportJWK } from "jose";

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const pkcs8 = await exportPKCS8(privateKey);
const jwk = await exportJWK(publicKey);
jwk.kid = "auth-key-1";
jwk.alg = "ES256";
jwk.use = "sig";

console.log("=== AUTH_JWT_PRIVATE_KEY (set in Convex env, dev + prod) ===");
console.log(pkcs8);
console.log("=== AUTH_JWT_PUBLIC_JWK (set in Vercel env, one line) ===");
console.log(JSON.stringify(jwk));
```

- [ ] **Step 3: Run it and capture the keys**

Run: `node scripts/gen-auth-keys.mjs`
Expected: prints a PKCS8 private key block and a one-line public JWK JSON. Save both to a password manager; do NOT commit them.

- [ ] **Step 4: Set env vars (manual, out-of-band)**

- Convex: `npx convex env set AUTH_JWT_PRIVATE_KEY "<pkcs8>"` (run for BOTH the dev deployment and, later, prod).
- Vercel: add `AUTH_JWT_PUBLIC_JWK` = the one-line JWK JSON (Preview + Production).
Expected: `npx convex env list` shows `AUTH_JWT_PRIVATE_KEY`.

- [ ] **Step 5: Commit (code only, no secrets)**

```bash
git add package.json package-lock.json scripts/gen-auth-keys.mjs
git commit -m "chore(auth): add jose + ES256 keypair generator (Phase 0)"
```

---

### Task 2: JWKS endpoint

**Files:**
- Create: `app/api/auth/jwks/route.ts`

**Interfaces:**
- Produces: `GET /api/auth/jwks` → `{ "keys": [ <public JWK> ] }`, from `AUTH_JWT_PUBLIC_JWK`.

- [ ] **Step 1: Create the route**

Create `app/api/auth/jwks/route.ts`:

```ts
import { NextResponse } from "next/server";

// Serves the public verification key so Convex (and any verifier) can validate
// our self-issued JWTs. Only the PUBLIC key is exposed here.
export function GET() {
  const raw = process.env.AUTH_JWT_PUBLIC_JWK;
  if (!raw) {
    return NextResponse.json({ error: "JWKS not configured" }, { status: 500 });
  }
  const jwk = JSON.parse(raw);
  return NextResponse.json(
    { keys: [jwk] },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify after deploy**

Push to a preview/prod deploy, then Run: `curl -s https://<deployed-host>/api/auth/jwks`
Expected: `{"keys":[{"kty":"EC","crv":"P-256","x":"...","y":"...","kid":"auth-key-1","alg":"ES256","use":"sig"}]}`

- [ ] **Step 4: Commit**

```bash
git add app/api/auth/jwks/route.ts
git commit -m "feat(auth): public JWKS endpoint for JWT verification (Phase 0)"
```

---

### Task 3: Convex custom-JWT provider config

**Files:**
- Create: `convex/auth.config.ts`

**Interfaces:**
- Produces: Convex trusts JWTs with `iss = ISSUER`, `aud = "iecentral"`, `alg = ES256`, verified against the JWKS URL. Enables `ctx.auth.getUserIdentity()`.

- [ ] **Step 1: Create the config**

Create `convex/auth.config.ts` (replace `<deployed-host>` with the real production host, e.g. `iecentral.com`):

```ts
export default {
  providers: [
    {
      type: "customJwt",
      applicationID: "iecentral",
      issuer: "https://iecentral.com",
      jwks: "https://iecentral.com/api/auth/jwks",
      algorithm: "ES256",
    },
  ],
};
```

- [ ] **Step 2: Push to the dev deployment**

Run: `npx convex dev --once` (or the project's deploy path)
Expected: deploy succeeds; Convex accepts the auth config. (`issuer`/`jwks` must be publicly reachable — the JWKS route from Task 2 must be deployed first.)

- [ ] **Step 3: Commit**

```bash
git add convex/auth.config.ts
git commit -m "feat(auth): register custom-JWT provider in Convex (Phase 0)"
```

---

### Task 4: Token issuance + refresh + epoch bump (Convex Node action)

**Files:**
- Create: `convex/authTokens.ts` (`"use node"`)
- Modify: `convex/auth.ts` (add internal `bumpEpoch` + confirm `login` return shape)

**Interfaces:**
- Consumes: existing `api.auth.login({ email, password })` → `{ success, user, sessionEpoch, forcePasswordChange, error }`.
- Produces:
  - `api.authTokens.loginWithToken({ email, password })` → `{ success: boolean, user?, token?: string, forcePasswordChange?: boolean, error?: string }`
  - `api.authTokens.refreshToken()` → `{ token: string } | { error: string }` (reads `ctx.auth`)
  - `internal.auth.bumpEpoch({ userId })` (invalidates all tokens for a user)

- [ ] **Step 1: Confirm the `login` return shape**

Read `convex/auth.ts` `login` mutation. Confirm it returns `user` (with `_id`) and the current epoch. Note the exact field names (used below as `res.user._id` and `res.sessionEpoch`).

- [ ] **Step 2: Add `bumpEpoch` to `convex/auth.ts`**

```ts
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Invalidate every outstanding JWT for a user (logout / password change / force-logout).
export const bumpEpoch = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return;
    await ctx.db.patch(args.userId, { sessionEpoch: (user.sessionEpoch ?? 0) + 1 });
  },
});
```

- [ ] **Step 3: Create `convex/authTokens.ts`**

```ts
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { SignJWT, importPKCS8 } from "jose";

const ISSUER = "https://iecentral.com";
const AUDIENCE = "iecentral";
const ALG = "ES256";
const TTL = "60m";

async function sign(userId: string, epoch: number, impersonatedBy?: string): Promise<string> {
  const pem = process.env.AUTH_JWT_PRIVATE_KEY;
  if (!pem) throw new Error("AUTH_JWT_PRIVATE_KEY not configured");
  const key = await importPKCS8(pem, ALG);
  const payload: Record<string, unknown> = { epoch };
  if (impersonatedBy) payload.impersonatedBy = impersonatedBy;
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: ALG, kid: "auth-key-1" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(key);
}

export const loginWithToken = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, args): Promise<{ success: boolean; user?: unknown; token?: string; forcePasswordChange?: boolean; error?: string }> => {
    const res = await ctx.runMutation(api.auth.login, { email: args.email, password: args.password });
    if (!res.success || !res.user) return { success: false, error: res.error ?? "Invalid email or password" };
    const token = await sign(String(res.user._id), Number(res.sessionEpoch ?? 0));
    return { success: true, user: res.user, token, forcePasswordChange: res.forcePasswordChange };
  },
});

export const refreshToken = action({
  args: {},
  handler: async (ctx): Promise<{ token: string } | { error: string }> => {
    const ident = await ctx.auth.getUserIdentity();
    if (!ident) return { error: "Not authenticated" };
    // Re-issue only if the session is still valid (epoch unchanged).
    const check = await ctx.runQuery(api.authTokens.epochOk, {
      userId: ident.subject, epoch: Number(ident.epoch ?? 0),
    });
    if (!check.ok) return { error: "Session expired" };
    const token = await sign(ident.subject, Number(ident.epoch ?? 0),
      ident.impersonatedBy ? String(ident.impersonatedBy) : undefined);
    return { token };
  },
});
```

- [ ] **Step 4: Add the `epochOk` query (same file needs a non-node query — put it in `convex/auth.ts`)**

Node actions can't run queries defined in the same `"use node"` file cleanly; add to `convex/auth.ts`:

```ts
import { query } from "./_generated/server";

export const epochOk = query({
  args: { userId: v.string(), epoch: v.number() },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId as Id<"users">);
    const ok = !!user && user.isActive !== false && (user.sessionEpoch ?? 0) === args.epoch;
    return { ok };
  },
});
```

Update the `refreshToken` reference to `api.auth.epochOk` (not `api.authTokens.epochOk`).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Verify against dev deployment**

From a scratch Node script or the Convex dashboard, call `authTokens.loginWithToken` with a real test account.
Expected: `{ success: true, token: "<jwt>" }`. Paste the JWT into jwt.io → header `alg: ES256, kid: auth-key-1`; payload has `sub`, `epoch`, `iss`, `aud: iecentral`, `exp`.

- [ ] **Step 7: Commit**

```bash
git add convex/authTokens.ts convex/auth.ts
git commit -m "feat(auth): issue/refresh ES256 JWTs + epoch bump (Phase 0)"
```

---

### Task 5: `requireAuth` / `requireRole` / `getActor` helpers

**Files:**
- Modify: `convex/authGuards.ts`

**Interfaces:**
- Produces:
  - `requireAuth(ctx): Promise<Doc<"users">>` — trusted current user; throws if unauthenticated/revoked.
  - `requireRole(ctx, roles: string[]): Promise<Doc<"users">>`
  - `getActor(ctx): Promise<{ user: Doc<"users">; realUserId: Id<"users">; isImpersonating: boolean }>`

- [ ] **Step 1: Add helpers to `convex/authGuards.ts`**

```ts
import { QueryCtx, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

export async function requireAuth(ctx: Ctx): Promise<Doc<"users">> {
  const ident = await ctx.auth.getUserIdentity();
  if (!ident) throw new Error("Not authenticated");
  const user = await ctx.db.get(ident.subject as Id<"users">);
  if (!user || user.isActive === false) throw new Error("Not authenticated");
  if ((user.sessionEpoch ?? 0) !== Number(ident.epoch ?? 0)) throw new Error("Session expired");
  return user;
}

export async function requireRole(ctx: Ctx, roles: string[]): Promise<Doc<"users">> {
  const user = await requireAuth(ctx);
  if (!roles.includes(user.role)) throw new Error("Forbidden");
  return user;
}

export async function getActor(ctx: Ctx) {
  const ident = await ctx.auth.getUserIdentity();
  if (!ident) throw new Error("Not authenticated");
  const user = await requireAuth(ctx);
  const realUserId = (ident.impersonatedBy ? String(ident.impersonatedBy) : ident.subject) as Id<"users">;
  return { user, realUserId, isImpersonating: !!ident.impersonatedBy };
}
```

- [ ] **Step 2: Add a scratch verification query in `convex/authGuards.ts`**

```ts
import { query } from "./_generated/server";

// TEMPORARY — Phase 0 verification only; removed in Task 8.
export const whoAmI = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    return { _id: user._id, name: user.name, role: user.role };
  },
});
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add convex/authGuards.ts
git commit -m "feat(auth): requireAuth/requireRole/getActor + scratch whoAmI (Phase 0)"
```

---

### Task 6: Client wiring — attach the JWT to Convex

**Files:**
- Create: `lib/authTokenStore.ts` (framework-free subscribable token store — breaks the AuthProvider↔Convex circular dependency)
- Modify: `app/providers.tsx` (use `ConvexProviderWithAuth`)
- Modify: `app/auth-context.tsx` (login stores the JWT; refresh; logout clears)

**Interfaces:**
- Consumes: `api.authTokens.loginWithToken`, `api.authTokens.refreshToken`.
- Produces: a signed-in session where `ctx.auth.getUserIdentity()` resolves in Convex functions.

- [ ] **Step 1: Create the token store**

Create `lib/authTokenStore.ts`:

```ts
// Standalone store so the Convex auth adapter can read the token without
// depending on React context (AuthProvider itself needs the Convex client).
let token: string | null = null;
const listeners = new Set<() => void>();

export const authTokenStore = {
  get: () => token,
  set: (t: string | null) => { token = t; listeners.forEach((l) => l()); },
  subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
};

const KEY = "ie_central_jwt";
export function loadPersistedToken() {
  if (typeof window !== "undefined") token = window.localStorage.getItem(KEY);
  return token;
}
export function persistToken(t: string | null) {
  authTokenStore.set(t);
  if (typeof window !== "undefined") {
    if (t) window.localStorage.setItem(KEY, t);
    else window.localStorage.removeItem(KEY);
  }
}
```

- [ ] **Step 2: Wire `ConvexProviderWithAuth` in `app/providers.tsx`**

Replace the `ConvexProvider` usage with:

```tsx
"use client";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithAuth } from "convex/react";
import { useCallback, useSyncExternalStore } from "react";
import { authTokenStore, loadPersistedToken } from "@/lib/authTokenStore";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function useConvexAuthAdapter() {
  const token = useSyncExternalStore(
    authTokenStore.subscribe,
    () => authTokenStore.get(),
    () => null,
  );
  const fetchAccessToken = useCallback(async (_args: { forceRefreshToken: boolean }) => {
    return authTokenStore.get() ?? loadPersistedToken();
  }, []);
  return { isLoading: false, isAuthenticated: !!token, fetchAccessToken };
}

// Wrap children:
// <ConvexProviderWithAuth client={convex} useAuth={useConvexAuthAdapter}>{children}</ConvexProviderWithAuth>
```

Keep any existing providers (theme, auth-context) INSIDE `ConvexProviderWithAuth` so they can use Convex hooks. On module load (client), call `loadPersistedToken()` so a returning user's token is present.

- [ ] **Step 3: Update `app/auth-context.tsx` login/logout/refresh**

- On login: call `api.authTokens.loginWithToken` (via a Convex `useAction`) instead of `api.auth.login`; on success `persistToken(res.token)` and keep the existing user-state logic.
- On logout: `persistToken(null)` (plus existing clearing).
- Add a refresh timer: every ~50 min (before the 60-min TTL) call `refreshToken`; on `{ token }` `persistToken(token)`, on `{ error }` force logout.

```tsx
// inside AuthProvider:
import { persistToken } from "@/lib/authTokenStore";
const loginWithToken = useAction(api.authTokens.loginWithToken);
const refresh = useAction(api.authTokens.refreshToken);
// login(): const res = await loginWithToken({ email, password });
//          if (res.success && res.token) persistToken(res.token);
// logout(): persistToken(null);
// useEffect: const id = setInterval(async () => {
//   const r = await refresh({}); if ("token" in r) persistToken(r.token); else logout();
// }, 50*60*1000); return () => clearInterval(id);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/authTokenStore.ts app/providers.tsx app/auth-context.tsx
git commit -m "feat(auth): attach self-issued JWT to Convex client (Phase 0)"
```

---

### Task 7: Server-side impersonation

**Files:**
- Modify: `convex/authTokens.ts` (add `startImpersonation`, `stopImpersonation`)
- Modify: `app/auth-context.tsx` (start/stop call the actions, swap the token)

**Interfaces:**
- Consumes: `getActor` / `requireRole` (Task 5), `sign` (Task 4).
- Produces:
  - `api.authTokens.startImpersonation({ targetUserId })` → `{ token }` — super-admin only.
  - `api.authTokens.stopImpersonation()` → `{ token }` — re-issues the real user's token.

- [ ] **Step 1: Add the actions to `convex/authTokens.ts`**

```ts
export const startImpersonation = action({
  args: { targetUserId: v.id("users") },
  handler: async (ctx, args): Promise<{ token?: string; error?: string }> => {
    const ident = await ctx.auth.getUserIdentity();
    if (!ident) return { error: "Not authenticated" };
    const check = await ctx.runQuery(api.auth.canImpersonate, {
      realUserId: ident.subject, targetUserId: args.targetUserId,
    });
    if (!check.ok) return { error: check.error ?? "Forbidden" };
    // impersonatedBy = the real super-admin; sub = the target being acted as.
    const token = await sign(String(args.targetUserId), Number(check.targetEpoch ?? 0), ident.subject);
    return { token };
  },
});

export const stopImpersonation = action({
  args: {},
  handler: async (ctx): Promise<{ token?: string; error?: string }> => {
    const ident = await ctx.auth.getUserIdentity();
    if (!ident || !ident.impersonatedBy) return { error: "Not impersonating" };
    const realId = String(ident.impersonatedBy);
    const info = await ctx.runQuery(api.auth.getEpoch, { userId: realId });
    if (!info.exists) return { error: "Account not found" };
    const token = await sign(realId, Number(info.epoch ?? 0));
    return { token };
  },
});
```

- [ ] **Step 2: Add `canImpersonate` query to `convex/auth.ts`**

```ts
export const canImpersonate = query({
  args: { realUserId: v.string(), targetUserId: v.id("users") },
  handler: async (ctx, args) => {
    const real = await ctx.db.get(args.realUserId as Id<"users">);
    if (!real || real.role !== "super_admin") return { ok: false, error: "Forbidden" };
    const target = await ctx.db.get(args.targetUserId);
    if (!target) return { ok: false, error: "Target not found" };
    return { ok: true, targetEpoch: target.sessionEpoch ?? 0 };
  },
});
```

Add a small `getEpoch` query to `convex/auth.ts` so `stopImpersonation` can read the real user's current epoch:

```ts
export const getEpoch = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId as Id<"users">);
    return { exists: !!user, epoch: user?.sessionEpoch ?? 0 };
  },
});
```

- [ ] **Step 3: Wire `app/auth-context.tsx` impersonation to swap the token**

`startImpersonation(target)`: call the action, `persistToken(res.token)`, keep the existing impersonation record UI state. `stopImpersonation()`: call the action, `persistToken(res.token)`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add convex/authTokens.ts convex/auth.ts app/auth-context.tsx
git commit -m "feat(auth): server-side impersonation via re-issued JWT (Phase 0)"
```

---

### Task 8: End-to-end verification + remove scratch query

**Files:**
- Modify: `convex/authGuards.ts` (remove `whoAmI` after verification)

**Interfaces:** none produced; this task proves the foundation works.

- [ ] **Step 1: Deploy Phase 0 to the dev/preview environment**

Push the branch; ensure JWKS route is live and `AUTH_JWT_PRIVATE_KEY` (Convex) + `AUTH_JWT_PUBLIC_JWK` (Vercel) are set for that environment.

- [ ] **Step 2: Run the spec's verification checklist against the running app**

1. Log in → confirm a JWT is persisted (localStorage `ie_central_jwt`) and `authGuards.whoAmI` (call from the browser console via the Convex client, or dashboard) returns the correct user.
2. `whoAmI` while logged out → throws "Not authenticated".
3. Bump epoch (call `internal.auth.bumpEpoch` from the dashboard for the test user) → `whoAmI` throws "Session expired"; logging in again works.
4. Wait past/refresh near TTL → refresh issues a new token, no interruption.
5. Super-admin `startImpersonation(target)` → `whoAmI` returns the target; `getActor` shows `isImpersonating` + real id. Non-super-admin → "Forbidden".
6. A guest `/join` (public) still works with no token.

Record the observed outputs for each (this is the evidence the phase is safe to build on).

- [ ] **Step 3: Remove the scratch `whoAmI` query**

Delete the `whoAmI` query from `convex/authGuards.ts`.

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit
git add convex/authGuards.ts
git commit -m "chore(auth): remove Phase 0 scratch verification query"
```

---

## Self-Review notes (coverage)

- Spec §1 issuance → Task 4; §2 auth.config → Task 3; §3 client wiring → Task 6; §4 requireAuth/guards → Task 5; §5 revocation (bumpEpoch/epoch check) → Tasks 4+5; §6 impersonation → Task 7; §7 public allowlist → not code (documented; enforced in later phases as files migrate); JWKS infra (implied by §2) → Tasks 1+2; verification plan → Task 8.
- Not in Phase 0 (correctly deferred to migration phases): converting the ~59 `requestingUserId` functions to `requireAuth`, and removing those args.
