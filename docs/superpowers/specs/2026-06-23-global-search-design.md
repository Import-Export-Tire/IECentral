# IECentral Global Search Expansion — Design

**Date:** 2026-06-23
**Status:** Approved for planning
**Owner:** Andy

## Goal

Expand the top-bar global search so one box finds **everything the user is allowed to
see** — Doc Hub documents, People & HR, Operations, and the tire/inventory catalog — with
results **permission-filtered per user** ("see it in search only if you could open it"). This
also closes a current data leak: today `convex/search.ts › globalSearch` does full table
scans and returns **all** projects/personnel/applicants/users to **any** caller, with no
permission check and no `requestingUserId`.

## Permission model (the core requirement)

Each bucket is gated to the same rule its area already enforces. Tiers come from
`getTier` in `lib/permissions.ts` (super_admin 5, admin 4, warehouse_director 3,
warehouse/office/retail_* 2, department_manager/shift_lead 1, member/employee 0):

| Bucket | Result types | Visible to |
|---|---|---|
| People & HR | personnel, applicants (ATS) | tier ≥ 2 |
| | users | tier ≥ 4 |
| Operations | equipment (scanners, pickers), announcements, locations | tier ≥ 2 for equipment; all authenticated for announcements/locations (no secret fields) |
| | projects | owner OR shared-with OR tier ≥ 4 |
| Doc Hub | documents | anyone — filtered to docs the user can access (see below) |
| Tires / inventory | OEIVAL catalog | tier ≥ 4 (`reports` permission) |

**Doc Hub visibility** mirrors `documents.getAll`: include an active document if its
`visibility` is `community`/`internal`, or `isPublic`, or `uploadedBy === user`, or
`sharedWith` includes the user, or `sharedWithGroups` intersects the user's groups —
**and** the document is not inside a password-protected folder the user neither owns nor
has a (non-revoked) `folderAccessGrants` grant to.

## Architecture

Two result sources, merged in the client:

### 1. Convex — `convex/search.ts › globalSearch({ requestingUserId, searchQuery })`

Rewrite the existing query to be permission-aware:

- Add `requestingUserId: v.id("users")` arg. Load the user; compute `tier` via a new
  exported `tierOf(role)` helper in `convex/authGuards.ts` (reuses the existing `ROLE_TIER`
  map added for `requireMinTier`).
- For each bucket, **only scan + include results the user passes the gate for** (skip the
  query entirely otherwise — cheaper and safe).
- **New Doc Hub source:** scan active `documents`, keep those matching the query in
  `name`/`description`/`fileName`, then apply the visibility + folder-access filter above
  (load the user's `groups` and `folderAccessGrants` once; cache protected-folder ids).
- Each result gains a `category` field: `"People" | "Documents" | "Operations"`. Existing
  fields stay: `{ type, id, title, subtitle, href, icon, category }`.
- Equipment results expose only `name/number/model/status` (never computer passwords).
- Cap per category (e.g. 6 each) and overall (e.g. 24); return `{ results, totalCount }`.

Result `href`s: personnel `/personnel/<id>`, applicant `/applications/<id>`, user
`/users`, document opens the doc (`/documents?doc=<id>` — confirm the Doc Hub deep-link
param), project `/projects`, equipment `/equipment`, announcement `/announcements`,
location `/locations`.

### 2. Tires — client-merged from the existing API (S3-backed, not in Convex)

Tires live in the S3 OEIVAL catalog and are searched by `searchTires` via
`/api/reports/tire-search?q=`. The Convex query can't read S3, so:

- In `components/GlobalSearch.tsx`, **only when the user has the `reports` permission**
  (tier ≥ 4, via `getMenuPermissions`/`usePermissions`), also call
  `/api/reports/tire-search?q=<query>` and merge those into a **"Tires"** group.
- A tire result links to the **inventory report filtered to that item**:
  `/reports?type=inventory&item=<itemId>`. **Implementation note:** verify the inventory
  report view reads an `item` query param and pre-filters to it; if not, add that param
  (small change in the reports/inventory page).
- The tire-search API stays open as today (the tire-label picker uses it for tier < 4
  warehouse users); the tier-4 gate for *global search* is applied client-side.

## Frontend — `components/GlobalSearch.tsx`

- Add `useAuth`; pass `requestingUserId: user._id` to `globalSearch` (skip when no user).
- **Debounce** the input ~250ms and require **≥ 2 chars** before querying (matches the
  tire API's min length and avoids scanning on every keystroke).
- Fetch tire results (when permissioned) in parallel; merge.
- Render results **grouped by category** with a small header per group
  (People · Documents · Tires · Operations), each capped, with the existing icon set.
  Keyboard up/down + Enter to open still works.

## Performance & scope (YAGNI)

- Keep the current **full-scan** approach (it's fine at IECentral's data sizes) plus the
  client debounce. Convex full-text **search indexes** are noted as a future optimization
  if search ever feels slow — not built now.
- **No command-palette navigation** (e.g. "jump to Settings") — records/content only, per
  the request.
- No new tables. No changes to how the tire-label picker uses the tire API.

## Security

This rewrite **fixes the existing leak**: `globalSearch` becomes `requestingUserId`-gated
and permission-filtered, so personnel/users/applicants are no longer returned to
unauthorized callers. (Tracked in `docs/iecentral/SECURITY-FINDINGS.md`.)

## Files

- `convex/search.ts` — rewrite `globalSearch` (arg, gating, Doc Hub, categories, caps).
- `convex/authGuards.ts` — export `tierOf(role): number` (from existing `ROLE_TIER`).
- `components/GlobalSearch.tsx` — userId, debounce, tire merge, grouped UI.
- Reports inventory view — support an `item` query param to deep-link a tire (verify/add).
