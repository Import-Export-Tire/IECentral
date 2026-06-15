# Act as User (Super-Admin Impersonation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a super admin "Act as" any non-super-admin user so the entire app renders with that user's exact permissions, to verify what they can/can't see.

**Architecture:** Layer an impersonation override on top of the existing client-side session in `AuthProvider`. The real super-admin id stays in `localStorage` (`ie_central_user_id`); a separate `ie_central_impersonation` record points the single `api.auth.getUser` query at the target. Every consumer (`useAuth`, `usePermissions`, menus, gates) flows from that query automatically, so no consumer changes are needed. A persistent banner + audit logging provide accountability since full actions are allowed.

**Tech Stack:** Next.js (App Router, client components), Convex (`api.auth.getUser`, `api.auditLogs.log`), React context, Tailwind, TypeScript.

**Testing note:** This repo has no automated UI/unit test harness (`package.json` scripts are only `dev`, `build`, `start`, `lint`). The automated gate for each task is a TypeScript typecheck (`npx tsc --noEmit`) plus `npm run lint`; behavior is verified manually against `npm run dev` per the spec's manual test plan. Tasks therefore follow a "implement → typecheck/lint → commit" rhythm rather than red/green unit tests.

**Spec:** `docs/superpowers/specs/2026-06-15-act-as-user-impersonation-design.md`

---

## File Structure

- **Modify** `app/auth-context.tsx` — add impersonation types, state, effective-user resolution, `startImpersonation` / `stopImpersonation`, audit logging, and context API. (Core change.)
- **Create** `components/ImpersonationBanner.tsx` — persistent banner shown while impersonating, with a Return button.
- **Modify** `app/providers.tsx` — mount `<ImpersonationBanner />` next to `<SystemBanner />`.
- **Modify** `app/users/page.tsx` — add per-row "Act as" buttons (desktop table + mobile cards).

---

## Task 1: Impersonation state & API in AuthProvider

**Files:**
- Modify: `app/auth-context.tsx`

- [ ] **Step 1: Add the router + audit-log imports**

At the top of `app/auth-context.tsx`, the existing imports include `useMutation`, `useQuery` from `convex/react` and `api`. Add the Next router import. After the existing `import { Id } from "@/convex/_generated/dataModel";` line, the import block should also contain:

```tsx
import { useRouter } from "next/navigation";
```

- [ ] **Step 2: Add impersonation types and the localStorage key**

Immediately after the existing `export interface User { ... }` block (before `interface AuthContextType`), add:

```tsx
const IMPERSONATION_KEY = "ie_central_impersonation";

export interface ImpersonationRecord {
  realUserId: string;
  realUserName: string;
  realUserEmail: string;
  targetUserId: string;
  targetUserName: string;
  targetRole: string;
  startedAt: number;
}

export interface ImpersonationTarget {
  _id: Id<"users">;
  name: string;
  role: string;
}
```

(`role` is typed as `string`, not `UserRole`, because `getAllUsers` returns roles such as `retail_store_manager` that are not in the `UserRole` union.)

- [ ] **Step 3: Extend the context type**

In `interface AuthContextType`, add these members (place them right after `logout: () => void;`):

```tsx
  // Super-admin impersonation ("Act as user")
  isImpersonating: boolean;
  impersonation: ImpersonationRecord | null;
  startImpersonation: (target: ImpersonationTarget) => void;
  stopImpersonation: () => void;
```

- [ ] **Step 4: Add impersonation state and router inside AuthProvider**

Inside `AuthProvider`, just after the existing `const hasLoadedUserData = useRef(false);` line, add:

```tsx
  const [impersonation, setImpersonation] = useState<ImpersonationRecord | null>(null);
  const router = useRouter();
  const logAudit = useMutation(api.auditLogs.log);
```

- [ ] **Step 5: Resolve the effective user id and point the query at it**

Replace the existing query:

```tsx
  const userData = useQuery(
    api.auth.getUser,
    userId ? { userId: userId as Id<"users"> } : "skip"
  );
```

with:

```tsx
  // While impersonating, the whole app loads the target user instead of the real one.
  const effectiveUserId = impersonation?.targetUserId ?? userId;
  const userData = useQuery(
    api.auth.getUser,
    effectiveUserId ? { userId: effectiveUserId as Id<"users"> } : "skip"
  );
```

- [ ] **Step 6: Clear impersonation on logout**

Replace the existing `performLogout` callback:

```tsx
  const performLogout = useCallback(() => {
    setUserId(null);
    localStorage.removeItem("ie_central_user_id");
    hasLoadedUserData.current = false;
    setInitialLoadComplete(true);
  }, []);
```

with:

```tsx
  const performLogout = useCallback(() => {
    setUserId(null);
    localStorage.removeItem("ie_central_user_id");
    localStorage.removeItem(IMPERSONATION_KEY);
    setImpersonation(null);
    hasLoadedUserData.current = false;
    setInitialLoadComplete(true);
  }, []);
```

- [ ] **Step 7: Load any saved impersonation record on mount**

Add a new `useEffect` immediately after the existing "Load saved session on mount" effect:

```tsx
  // Restore an in-progress impersonation across reloads
  useEffect(() => {
    const stored = localStorage.getItem(IMPERSONATION_KEY);
    if (stored) {
      try {
        setImpersonation(JSON.parse(stored) as ImpersonationRecord);
      } catch {
        localStorage.removeItem(IMPERSONATION_KEY);
      }
    }
  }, []);
```

- [ ] **Step 8: Make session-clearing logic impersonation-safe**

The timeout effect and the null-handling effect must never clear the real session because of the *target's* load state. In the timeout effect, change its guard so it only runs when not impersonating. Replace:

```tsx
  useEffect(() => {
    if (userId && userData === undefined) {
      const timeout = setTimeout(() => {
        if (userData === undefined && !hasLoadedUserData.current) {
          console.warn("Session validation timed out, clearing invalid session...");
          localStorage.removeItem("ie_central_user_id");
          setUserId(null);
          setInitialLoadComplete(true);
        }
      }, 5000);
      return () => clearTimeout(timeout);
    }
  }, [userId, userData]);
```

with:

```tsx
  useEffect(() => {
    if (userId && !impersonation && userData === undefined) {
      const timeout = setTimeout(() => {
        if (userData === undefined && !hasLoadedUserData.current) {
          console.warn("Session validation timed out, clearing invalid session...");
          localStorage.removeItem("ie_central_user_id");
          setUserId(null);
          setInitialLoadComplete(true);
        }
      }, 5000);
      return () => clearTimeout(timeout);
    }
  }, [userId, userData, impersonation]);
```

Then, in the next effect ("Update loading state based on user data"), find the branch:

```tsx
    } else if (userId && userData === null) {
      // Query returned null - only clear if we've never successfully loaded
      if (!hasLoadedUserData.current) {
        console.warn("Invalid user session detected, clearing...");
        localStorage.removeItem("ie_central_user_id");
        setUserId(null);
      }
      setInitialLoadComplete(true);
    }
```

and change its condition so impersonation never triggers a real-session clear:

```tsx
    } else if (userId && userData === null) {
      // Query returned null - only clear if we've never successfully loaded
      // Never clear the real session because of a target's load state.
      if (!hasLoadedUserData.current && !impersonation) {
        console.warn("Invalid user session detected, clearing...");
        localStorage.removeItem("ie_central_user_id");
        setUserId(null);
      }
      setInitialLoadComplete(true);
    }
```

Add `impersonation` to that effect's dependency array (it currently ends `}, [userId, userData]);` → make it `}, [userId, userData, impersonation]);`).

- [ ] **Step 9: Make isLoading account for the effective user**

Replace:

```tsx
  const isLoading = !initialLoadComplete || (userId !== null && userData === undefined);
```

with:

```tsx
  const isLoading = !initialLoadComplete || (effectiveUserId !== null && userData === undefined);
```

- [ ] **Step 10: Add startImpersonation and stopImpersonation**

Immediately after the existing `const logout = () => { performLogout(); };` line, add:

```tsx
  const startImpersonation = useCallback(
    (target: ImpersonationTarget) => {
      // Only a real super admin may impersonate; never nest; never target a super admin or self.
      if (!user || user.role !== "super_admin") return;
      if (impersonation) return;
      if (target.role === "super_admin") return;
      if (target._id === user._id) return;

      const record: ImpersonationRecord = {
        realUserId: user._id,
        realUserName: user.name,
        realUserEmail: user.email || "",
        targetUserId: target._id,
        targetUserName: target.name,
        targetRole: target.role,
        startedAt: Date.now(),
      };
      localStorage.setItem(IMPERSONATION_KEY, JSON.stringify(record));
      setImpersonation(record);
      void logAudit({
        action: `Started acting as ${target.name}`,
        actionType: "impersonate_start",
        resourceType: "user",
        resourceId: target._id,
        userId: record.realUserId as Id<"users">,
        userEmail: record.realUserEmail,
        details: `${record.realUserName} began acting as ${target.name} (${target.role})`,
      }).catch(() => {});
      router.push("/");
    },
    [user, impersonation, logAudit, router]
  );

  const stopImpersonation = useCallback(() => {
    if (!impersonation) return;
    const record = impersonation;
    localStorage.removeItem(IMPERSONATION_KEY);
    setImpersonation(null);
    void logAudit({
      action: `Stopped acting as ${record.targetUserName}`,
      actionType: "impersonate_end",
      resourceType: "user",
      resourceId: record.targetUserId,
      userId: record.realUserId as Id<"users">,
      userEmail: record.realUserEmail,
      details: `${record.realUserName} stopped acting as ${record.targetUserName} (${record.targetRole})`,
    }).catch(() => {});
    router.push("/users");
  }, [impersonation, logAudit, router]);
```

- [ ] **Step 11: Expose the new API in the provider value**

In the `<AuthContext.Provider value={{ ... }}>` object, add these entries right after `logout,`:

```tsx
        isImpersonating: impersonation !== null,
        impersonation,
        startImpersonation,
        stopImpersonation,
```

- [ ] **Step 12: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors (exit 0).

Run: `npm run lint`
Expected: no new errors for `app/auth-context.tsx`.

- [ ] **Step 13: Commit**

```bash
git add app/auth-context.tsx
git commit -m "feat(auth): add super-admin impersonation state and API

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: ImpersonationBanner component + mount

**Files:**
- Create: `components/ImpersonationBanner.tsx`
- Modify: `app/providers.tsx`

- [ ] **Step 1: Create the banner component**

Create `components/ImpersonationBanner.tsx` with exactly:

```tsx
"use client";

import { useAuth } from "@/app/auth-context";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  warehouse_director: "Warehouse Director",
  warehouse_manager: "Warehouse Manager",
  retail_store_manager: "Retail Store Manager",
  department_manager: "Department Manager",
  office_manager: "Office Manager",
  shift_lead: "Shift Lead",
  member: "Member",
  employee: "Employee",
};

export default function ImpersonationBanner() {
  const { isImpersonating, impersonation, stopImpersonation } = useAuth();

  if (!isImpersonating || !impersonation) return null;

  const roleLabel = ROLE_LABELS[impersonation.targetRole] || impersonation.targetRole;

  return (
    <div className="fixed top-0 left-0 right-0 z-[101] bg-amber-500 text-black shadow-md">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-2 min-w-0 text-sm font-medium">
          <span aria-hidden>👁</span>
          <span className="truncate">
            Acting as <strong>{impersonation.targetUserName}</strong>
            <span className="hidden sm:inline"> · {roleLabel}</span> — changes save as them.
          </span>
        </div>
        <button
          onClick={stopImpersonation}
          className="shrink-0 px-3 py-1 rounded-full bg-black/85 text-white text-xs font-semibold hover:bg-black transition-colors"
        >
          Return to {impersonation.realUserName}
        </button>
      </div>
    </div>
  );
}
```

(Uses the same `fixed top-0 ... z-[1xx]` strategy as `SystemBanner`, one level above it at `z-[101]`.)

- [ ] **Step 2: Mount it in providers**

In `app/providers.tsx`, add the import after the existing `import SystemBanner from "@/components/SystemBanner";` line:

```tsx
import ImpersonationBanner from "@/components/ImpersonationBanner";
```

Then, inside `<AppShell>`, add the banner immediately before `<SystemBanner />`:

```tsx
              <AppShell>
                <ImpersonationBanner />
                <SystemBanner />
                {children}
                <GlobalSearch />
                <KeyboardShortcuts />
                <PushNotificationPrompt />
              </AppShell>
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no new errors for the two files.

- [ ] **Step 4: Commit**

```bash
git add components/ImpersonationBanner.tsx app/providers.tsx
git commit -m "feat(auth): add impersonation banner and mount it in providers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: "Act as" buttons on the Users page

**Files:**
- Modify: `app/users/page.tsx`

- [ ] **Step 1: Pull impersonation into the page**

In `app/users/page.tsx`, the component starts with `const { user: currentUser } = useAuth();`. Replace it with:

```tsx
  const { user: currentUser, startImpersonation } = useAuth();
```

- [ ] **Step 2: Add a helper to decide who can be impersonated**

Just after that line, add:

```tsx
  const canActAs = (target: { _id: Id<"users">; role: string }) =>
    currentUser?.role === "super_admin" &&
    target.role !== "super_admin" &&
    target._id !== currentUser?._id;
```

- [ ] **Step 3: Add the "Act as" button to the desktop table row actions**

In the desktop table, the row actions live in `<div className="flex items-center justify-end gap-1">`, containing the Edit / Reset / Delete buttons. Add the "Act as" button as the FIRST child of that div (before the Edit button):

```tsx
                          {canActAs(user as { _id: Id<"users">; role: string }) && (
                            <button
                              onClick={() =>
                                startImpersonation({ _id: user._id, name: user.name, role: user.role })
                              }
                              className="px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 rounded-full transition-colors"
                              title={`Act as ${user.name}`}
                            >
                              Act as
                            </button>
                          )}
```

- [ ] **Step 4: Add the "Act as" button to the mobile card actions**

In the mobile cards, the actions live in `<div className="mt-3 pt-3 border-t theme-border-secondary flex gap-2">` with Edit / Reset PW / Delete buttons. Add this as the FIRST child of that div (before the Edit button):

```tsx
                    {canActAs(user as { _id: Id<"users">; role: string }) && (
                      <button
                        onClick={() =>
                          startImpersonation({ _id: user._id, name: user.name, role: user.role })
                        }
                        className="flex-1 px-3 py-2 text-xs font-medium text-amber-700 bg-amber-50 rounded-full transition-colors"
                      >
                        Act as
                      </button>
                    )}
```

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no new errors for `app/users/page.tsx`.

- [ ] **Step 6: Commit**

```bash
git add app/users/page.tsx
git commit -m "feat(users): add 'Act as' button to user rows for super admins

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Open the app and log in as a super admin (e.g. Andy).

- [ ] **Step 2: Verify the entry point gating**

Go to `/users`. Confirm:
- An amber **Act as** button appears on every row EXCEPT super-admin rows and your own row.
- (Optional) Temporarily log in as a non-super-admin and confirm `/users` is inaccessible / shows no Act-as buttons.

- [ ] **Step 3: Act as the reported user (Bill Shetler) and verify permissions render**

Click **Act as** on Bill. Confirm:
- You are routed to `/` and the amber banner reads `Acting as Bill … — changes save as them.`
- The sidebar/menus and the **Equipment** area (bin labels, tire labels) render exactly per Bill's `permissionOverrides` — i.e. you now see what he sees.

- [ ] **Step 4: Verify reload persistence**

Hard-refresh the page while impersonating. Confirm the banner and target view persist (still acting as Bill).

- [ ] **Step 5: Return to your own session**

Click **Return to {realName}** in the banner. Confirm:
- You are routed to `/users`, the banner is gone, and your super-admin menus are back.

- [ ] **Step 6: Verify audit logging**

Go to `/audit-log`. Confirm two entries attributed to the real super admin: one `impersonate_start` and one `impersonate_end`, both referencing the target user.

- [ ] **Step 7: Verify logout clears impersonation**

Act as someone again, then log out. Confirm you land on the login page and that, after logging back in, you are NOT still impersonating (no banner).

- [ ] **Step 8: Final no-op commit / branch is ready**

No code changes in this task. The branch `feature/act-as-user-impersonation` is ready to merge/deploy.

---

## Self-Review Notes

- **Spec coverage:** AuthProvider state/effective-user (Task 1) ✓ scope=any non-super-admin (guard in `startImpersonation` + `canActAs`) ✓ full actions (no write-blocking added) ✓ audit start/stop under real id (Task 1, Step 10) ✓ persistent banner (Task 2) ✓ `/users` entry point desktop+mobile (Task 3) ✓ persistence across reload (Task 1, Step 7) ✓ logout clears (Task 1, Step 6) ✓ no nesting / no super-admin target (guards) ✓ manual test plan (Task 4) ✓.
- **Type consistency:** `ImpersonationRecord` / `ImpersonationTarget` shapes match every call site; `startImpersonation(target)` is called with `{ _id, name, role }` in Task 3 and consumed in Task 1; `role` is `string` throughout to accommodate roles outside the `UserRole` union.
- **No backend changes** required — `api.auth.getUser` and `api.auditLogs.log` already exist with the signatures used.
