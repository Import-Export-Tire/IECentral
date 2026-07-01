# Pagination & Search Scalability — Design Spec

**Date:** 2026-07-01
**Owner:** Andy Barrows
**Status:** Approved direction — pending spec review

## Goal

Stop IECentral from loading whole tables into the browser and from scanning whole tables on every search keystroke. Move browsing lists to **cursor pagination** and search-as-you-type to **Convex full-text search indexes**, behind **shared reusable primitives** so every page gets identical UX and shrinks in size. Comprehensive coverage of every current full-`.collect()` page consumer.

## Problem

Two distinct scalability defects, both confirmed in code:

1. **Whole tables streamed to the client.** List pages call a query that does `ctx.db.query(table).collect()` (no limit) and then filter/sort/search **client-side**. Example: `app/personnel/page.tsx:40` → `personnel.list {}` → `.collect()` → all department/status/location/search/temp/terminated filtering happens in the browser (`:87–113`). Convex re-delivers the *entire* result set on any row change. ~15 pages do this (`auth.getAllUsers`, `applications.*`, `auditLogs.getAll`, attendance/time-clock, messages, projects, call-offs, exit-interviews, website-messages, calendar, suggestions, settings).
2. **Full-table scans per search keystroke.** `search.globalSearch` (`convex/search.ts:90`) collects 8 tables and does JS `.includes()` on every keystroke; `messages.searchLinkableItems` collects 5; `documents.search` and each page's search box scan too.

As data grows (a multi-location tire company adding staff, daily attendance ~36k rows/yr/100 staff, an append-only audit log, ATS applications) these degrade linearly and inflate load time.

## Non-goals

- **Not** changing *what* data each page shows, its columns, or its business logic — only *how much* is fetched and *where* filtering happens.
- **Not** auth/authorization (the separate ctx.auth project). Existing `requestingUserId`/guard behavior on these queries is preserved as-is.
- **Not** a general decomposition of the monolith pages beyond the list-section extraction that pagination naturally requires.
- **Not** numbered pages or total counts (Convex totals are expensive and fight the reactive model). Show "N loaded" / "Load more", not "N of M".

## Approach (chosen: reusable primitives + convention, then roll out)

Build the pattern once, apply it everywhere in waves.

### Backend convention

- **Browsing lists → `paginate()`.** Convert each full-`.collect()` list query to accept `paginationOpts: { numItems, cursor }` and return Convex's `{ page, isDone, continueCursor }`, reading through an appropriate index. Filters (department, status, location, date range, etc.) become **query args** applied via indexed ranges where an index exists, or `.filter()` on the already-narrowed index range otherwise. Default `numItems: 50`.
- **Search-as-you-type → `searchIndex`.** Add a Convex `searchIndex` to each searched table on its primary text field, with `filterFields` for the equality filters a page needs (e.g. personnel: search on a `searchText` or `name` field, `filterFields: ["status","department","locationId"]`). Rewrite `globalSearch`, `messages.searchLinkableItems`, `documents.search`, and per-page search boxes to `withSearchIndex(...)` — ranked, capped, no scan. Search queries also support `paginate()`, so "Load more" works in search mode too.
- **Where a full list is genuinely needed** (dropdowns / pickers — assignee selects, the sharing user list, department filters): do **not** paginate those. Provide a **minimal-projection** query (id + label only) or drive them from the search index (typeahead). `auth.getAllUsers` is consumed both by the `/users` management page (paginate) *and* by dropdowns (needs all) — split into a paginated `listUsers` for the page and keep/repoint dropdowns to a minimal `listUserOptions`.

### Frontend primitives (new, in `components/ui/`)

- **`usePaginatedList(queryRef, args, { pageSize })`** — thin wrapper over Convex `usePaginatedQuery`; returns `{ items, status, loadMore, isLoading, isDone }`.
- **`<LoadMoreList>`** — renders items via a render-prop/children, a "Load more" button (hidden when `isDone`), a skeleton on first load, and a friendly empty state. One component, consistent everywhere.
- **`<SearchField>`** — debounced (250ms) input that drives a search-index query; clears back to browse mode when empty.
- **Page pattern:** each list page holds a `searchTerm` + `filters` state; when `searchTerm` is non-empty it renders results from the **search query**, otherwise from the **paginated browse query**; both feed the same `<LoadMoreList>`. Filters pass to whichever query is active.

### Real-time & correctness

- `usePaginatedQuery` stays reactive per loaded page (new/edited rows in loaded pages update live). Acceptable and expected.
- Sort order moves to the index (e.g. personnel by `lastName` via a `by_lastName` index) so pagination is stable.
- No total counts; "Load more" disappears at `isDone`.

## Comprehensive consumer inventory

**Search indexes (search-as-you-type):**
- `search.globalSearch` → personnel, applications, users, scanners, pickers, projects, announcements
- `messages.searchLinkableItems` → projects, applications, personnel, documents, conversations
- `documents.search` (Doc Hub search box)
- Per-page search boxes currently filtering client-side: personnel, users, applications (and any list page with a search input adopted below)

**Paginated browse lists (full `.collect()` today):**
- `personnel.list` → `app/personnel/page.tsx`
- `auth.getAllUsers` → `app/users/page.tsx` (split page vs. dropdown, see above)
- `applications.*` list + stats → `app/applications/page.tsx`
- `auditLogs.getAll` → audit log page (add `by_actionType`/`by_resourceType`/compound indexes)
- attendance / `timeClock` lists → time-clock page; `reports.getAttendanceReport` (use `by_date` range, not user-pagination)
- `applications`/`reports.getHiringReport` (date-range index)
- `messages` conversation list + `getMessages` per thread → `app/messages/page.tsx`
- `projects.getAll` → projects page (also denormalize task counts — kills the N+1)
- `callOffs`, `exitInterviews`, `contactMessages`/`dealerInquiries` (website messages), calendar `events`, `suggestions`
- Backend-only full-`users`-scans in dispatch paths (`notifications` `:122/:168`, `announcements` `:534`) → add `by_role` index or pass target ids (same initiative, no UI change)

Exact per-page filter sets and the precise index definitions are finalized in the implementation plan; this spec fixes the pattern and the coverage.

## Rollout waves (inside this one project)

1. **Foundation:** the three frontend primitives + the backend convention; add search indexes + convert `globalSearch`/`searchLinkableItems`/`documents.search`. (Biggest per-query win; establishes the pattern.)
2. **Highest-traffic lists:** personnel, users (page vs dropdown split), applications, audit log.
3. **Remaining lists:** attendance/time-clock + reports date-indexing, messages, projects (+task-count denormalization), call-offs, exit-interviews, website-messages, calendar, suggestions; backend dispatch `by_role` index.

Each wave ends green (`tsc` + `build`) and is independently shippable.

## Error / loading / empty states

- First load → skeleton (new shared `Skeleton`), not blank/"Loading…".
- `loadMore` in flight → button shows a spinner, disabled.
- Empty → friendly per-list empty state via `<LoadMoreList>`.
- Search with no matches → "No results for '<term>'".
- Query errors surface via the existing page error affordance (no silent swallow).

## Testing / verification

No component test runner; gate is `npx tsc --noEmit` + `npm run build`, plus manual per-page checks each wave: (a) browse shows first page + "Load more" appends + stops at end; (b) each filter narrows server-side (verify via network/among results); (c) search returns correct ranked matches and respects filters; (d) dropdowns still list everyone; (e) real-time: editing a loaded row updates live.

## Open items (resolve during planning, not blockers)

- Per-table search field: search an existing text column vs. add a denormalized `searchText` field kept in sync on write (needed when matching spans multiple fields like name+email+position). Default: denormalized `searchText` where multi-field, maintained in the table's create/update mutations.
- Page size per list (default 50; long rows like messages may use 25).
- Whether `messages.getMessages` (per-thread) needs pagination now or only the conversation list (threads can be long — likely yes, reverse-cursor).
