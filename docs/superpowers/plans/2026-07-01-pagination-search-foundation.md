# Pagination & Search — Foundation + Personnel Reference (Plan 1 of the project)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable pagination/search primitives and prove both techniques end-to-end on ONE real page (Personnel): cursor "Load more" browsing, Convex full-text search-as-you-type, and server-side filters — so the remaining ~14 pages + global search become short follow-on plans that reuse this pattern.

**Architecture:** Frontend primitives (`Skeleton`, `usePaginatedList`, `<LoadMoreList>`, `<SearchField>`) in `components/ui/` wrap Convex `usePaginatedQuery`. Backend: `personnel` gains a denormalized `searchText` field + a `searchIndex` + a `by_lastName` index; `personnel.list` becomes a paginated browse query with server-side filters; a new `personnel.searchPersonnel` uses the search index; a minimal `personnel.listOptions` serves dropdowns that still need everyone. `app/personnel/page.tsx` is converted to browse-vs-search modes feeding one `<LoadMoreList>`.

**Tech Stack:** Convex ^1.31.6 (`paginationOptsValidator`, `.paginate()`, `.withSearchIndex()`, `usePaginatedQuery`), Next 15 App Router, React 19, Tailwind v4, TypeScript.

## Global Constraints

- **Gate:** `npx tsc --noEmit` then `npm run build` (both pass). NO test runner; `next lint` is a no-op — do not add unit tests; verification is tsc + build + the described manual checks.
- **No behavior/data/auth changes:** same columns, same business logic, same `requireManagePersonnel`/`requestingUserId` guards on personnel queries/mutations. Only *how much* is fetched and *where* filtering happens changes.
- **Page size:** default `numItems: 50`.
- **UX:** "Load more" button (no infinite scroll, no numbered pages, no total counts). Show "Load more" until exhausted.
- **Search field:** denormalized `searchText` (lowercased `${firstName} ${lastName} ${email} ${position}`) maintained on every write that changes those fields.
- **Dropdowns are NOT paginated:** anything needing the full people list uses `personnel.listOptions` (id + name only).
- **Convex search-index rule:** a `searchIndex` has exactly one `searchField` (string) and up to 16 `filterFields`. Filters used here: `status`, `department`, `locationId`.

---

### Task 1: Shared pagination/search primitives

**Files:**
- Create: `components/ui/Skeleton.tsx`
- Create: `components/ui/usePaginatedList.ts`
- Create: `components/ui/LoadMoreList.tsx`
- Create: `components/ui/SearchField.tsx`
- Modify: `components/ui/index.ts` (barrel export — verify it exists; if not, create it exporting these)

**Interfaces:**
- Produces:
  - `Skeleton({ className }: { className?: string })` → styled pulse block.
  - `usePaginatedList(query, args, opts?: { initialNumItems?: number })` → `{ results, status, loadMore, isLoading, isDone }` where `status` is Convex's `"LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted"`. `args` may be `"skip"`. Thin wrapper over `usePaginatedQuery`.
  - `LoadMoreList<T>({ status, results, loadMore, renderItem, empty, skeleton, pageSize })` → renders items, a "Load more" button (only when `status === "CanLoadMore"`), a spinner when `"LoadingMore"`, `skeleton` on `"LoadingFirstPage"`, and `empty` when exhausted with zero results.
  - `SearchField({ value, onChange, placeholder })` → debounced (250ms) controlled search input styled to the design system.

- [ ] **Step 1: Create `components/ui/Skeleton.tsx`**
```tsx
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700/50 ${className}`} />;
}
export default Skeleton;
```

- [ ] **Step 2: Create `components/ui/usePaginatedList.ts`**
```ts
"use client";
import { usePaginatedQuery } from "convex/react";
import type { PaginatedQueryReference } from "convex/react";

export function usePaginatedList<Q extends PaginatedQueryReference>(
  query: Q,
  args: Parameters<typeof usePaginatedQuery<Q>>[1],
  opts?: { initialNumItems?: number },
) {
  const { results, status, loadMore, isLoading } = usePaginatedQuery(
    query,
    args,
    { initialNumItems: opts?.initialNumItems ?? 50 },
  );
  return {
    results,
    status,
    loadMore,
    isLoading,
    isDone: status === "Exhausted",
  };
}
```
NOTE for implementer: confirm the exact generic signature of `usePaginatedQuery` against the installed `convex` types; if the generic form above fights the compiler, simplify by typing `query: any` is NOT allowed — instead import and use `PaginatedQueryReference` and let the two call sites infer. The behavior (return shape) is what matters.

- [ ] **Step 3: Create `components/ui/LoadMoreList.tsx`**
```tsx
"use client";
import type { ReactNode } from "react";

type Status = "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";

export function LoadMoreList<T>({
  status,
  results,
  loadMore,
  renderItem,
  empty,
  skeleton,
  pageSize = 50,
}: {
  status: Status;
  results: T[];
  loadMore: (n: number) => void;
  renderItem: (item: T, index: number) => ReactNode;
  empty?: ReactNode;
  skeleton?: ReactNode;
  pageSize?: number;
}) {
  if (status === "LoadingFirstPage") {
    return <>{skeleton ?? null}</>;
  }
  if (results.length === 0) {
    return <>{empty ?? null}</>;
  }
  return (
    <>
      {results.map((item, i) => renderItem(item, i))}
      {status === "CanLoadMore" && (
        <div className="flex justify-center py-4">
          <button
            onClick={() => loadMore(pageSize)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--accent-primary)] text-white hover:opacity-90"
          >
            Load more
          </button>
        </div>
      )}
      {status === "LoadingMore" && (
        <div className="flex justify-center py-4">
          <div className="w-6 h-6 border-2 border-t-transparent border-[var(--accent-primary)] rounded-full animate-spin" />
        </div>
      )}
    </>
  );
}
export default LoadMoreList;
```

- [ ] **Step 4: Create `components/ui/SearchField.tsx`**
```tsx
"use client";
import { useEffect, useState } from "react";

export function SearchField({
  value,
  onChange,
  placeholder = "Search…",
  debounceMs = 250,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  debounceMs?: number;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => { if (local !== value) onChange(local); }, debounceMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, debounceMs]);
  return (
    <div className="relative">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        className="w-full text-sm pl-9 pr-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/40"
      />
    </div>
  );
}
export default SearchField;
```

- [ ] **Step 5: Export from the barrel**
Check whether `components/ui/index.ts` exists (`ls components/ui/`). If it does, append exports for `Skeleton`, `usePaginatedList`, `LoadMoreList`, `SearchField`. If it does not, create `components/ui/index.ts` exporting them. Match the existing export style of that file.

- [ ] **Step 6: Verify**
Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit` → no errors.
Run: `npm run build` → completes. (Primitives have no consumer yet — Task 4 uses them. This step only proves they compile.)

- [ ] **Step 7: Commit**
```bash
cd /Users/andybarrows/IECentral
git add components/ui/Skeleton.tsx components/ui/usePaginatedList.ts components/ui/LoadMoreList.tsx components/ui/SearchField.tsx components/ui/index.ts
git commit -m "feat(ui): shared pagination/search primitives (Skeleton/usePaginatedList/LoadMoreList/SearchField)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: personnel search field + indexes (schema + write paths)

**Files:**
- Modify: `convex/schema.ts` (personnel table: add `searchText` field, `by_lastName` index, `search_personnel` searchIndex)
- Modify: `convex/personnel.ts` (`create`, `update`, and any bulk/import insert that sets name/email/position → also set `searchText`)

**Interfaces:**
- Produces: `personnel.searchText: v.optional(v.string())`; index `by_lastName` on `["lastName"]`; searchIndex `search_personnel` with `searchField: "searchText"`, `filterFields: ["status","department","locationId"]`.

- [ ] **Step 1: Add the field + indexes to `convex/schema.ts`**
In the `personnel: defineTable({ ... })` object, add the field alongside the others:
```ts
    searchText: v.optional(v.string()), // lowercased "firstName lastName email position" for full-text search
```
Then, on the personnel table's index chain (after the existing `.index(...)` calls, before the statement's terminating `,`), add:
```ts
    .index("by_lastName", ["lastName"])
    .searchIndex("search_personnel", {
      searchField: "searchText",
      filterFields: ["status", "department", "locationId"],
    })
```

- [ ] **Step 2: Add a shared `searchText` helper in `convex/personnel.ts`**
Near the top of `convex/personnel.ts` (after imports), add:
```ts
function personnelSearchText(p: { firstName: string; lastName: string; email: string; position: string }) {
  return `${p.firstName} ${p.lastName} ${p.email} ${p.position}`.toLowerCase();
}
```

- [ ] **Step 3: Set `searchText` on create**
In `create` (`convex/personnel.ts:296`), in the `ctx.db.insert("personnel", { ... })` object, add:
```ts
      searchText: personnelSearchText({ firstName: args.firstName, lastName: args.lastName, email: args.email, position: args.position }),
```

- [ ] **Step 4: Set `searchText` on update**
Read `update` (`convex/personnel.ts:371`). It patches personnel fields. After computing the patch (or in the patch object), recompute `searchText` from the effective values. Because `update` may patch a subset, load the existing doc first (it likely already does, or add `const existing = await ctx.db.get(args.id)`) and compute:
```ts
      searchText: personnelSearchText({
        firstName: args.firstName ?? existing.firstName,
        lastName: args.lastName ?? existing.lastName,
        email: args.email ?? existing.email,
        position: args.position ?? existing.position,
      }),
```
Match the actual arg names/optionality in `update` (they may be required, not optional — if required, just use `args.*`).

- [ ] **Step 5: Cover any bulk/import write path**
Run: `grep -n 'insert("personnel"' convex/personnel.ts`. For EVERY `insert("personnel", {...})` besides `create` (e.g. an import/bulkCreate/convert-from-application path), add the same `searchText: personnelSearchText({...})` line using that call site's name/email/position values. If a path lacks `position`, pass `position: ""` — do not omit the field's inputs.

- [ ] **Step 6: Backfill existing rows (one-time internal mutation)**
Add to `convex/personnel.ts`:
```ts
import { internalMutation } from "./_generated/server";
export const backfillSearchText = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("personnel").collect();
    for (const p of all) {
      await ctx.db.patch(p._id, { searchText: personnelSearchText(p) });
    }
    return { updated: all.length };
  },
});
```
(If `internalMutation` is already imported, don't duplicate the import.)

- [ ] **Step 7: Verify**
Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit` → no errors.
Run: `npm run build` → completes.
Then run the backfill against the deployment the executor is targeting (dev by default): `npx convex run personnel:backfillSearchText '{}'` and confirm it returns `{ updated: N }`. (For prod, this is run during rollout with the prod deploy key — note it in the report; do not run against prod without explicit approval.)

- [ ] **Step 8: Commit**
```bash
cd /Users/andybarrows/IECentral
git add convex/schema.ts convex/personnel.ts
git commit -m "feat(personnel): add searchText + search/by_lastName indexes; maintain on write; backfill

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: paginated + search personnel queries

**Files:**
- Modify: `convex/personnel.ts` (rework `list`; add `searchPersonnel`; add `listOptions`)

**Interfaces:**
- Produces:
  - `personnel.list({ paginationOpts, status?, department?, locationIds? })` → Convex paginated result `{ page, isDone, continueCursor }`, ordered by `lastName`.
  - `personnel.searchPersonnel({ paginationOpts, term, status?, department?, locationId? })` → paginated search-index result.
  - `personnel.listOptions({})` → `Array<{ _id, firstName, lastName }>` (minimal; for dropdowns).
- Consumes: the `by_lastName` index and `search_personnel` searchIndex from Task 2.

- [ ] **Step 1: Import the pagination validator**
At the top of `convex/personnel.ts`, add (if not present):
```ts
import { paginationOptsValidator } from "convex/server";
```

- [ ] **Step 2: Replace `list` with a paginated browse query**
Replace the existing `export const list = query({...})` (`convex/personnel.ts:` the current full-`.collect()` handler) with:
```ts
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(v.string()),
    department: v.optional(v.string()),
    locationIds: v.optional(v.array(v.id("locations"))),
  },
  handler: async (ctx, args) => {
    // Browse ordered by lastName. Filters that aren't the index key are applied
    // with .filter() on the index range (correctness preserved; still bounded by paginate).
    let q = ctx.db.query("personnel").withIndex("by_lastName").order("asc");
    const result = await q
      .filter((f) => {
        const conds = [] as any[];
        if (args.status) conds.push(f.eq(f.field("status"), args.status));
        if (args.department) conds.push(f.eq(f.field("department"), args.department));
        return conds.length ? f.and(...conds) : true;
      })
      .paginate(args.paginationOpts);
    // locationIds is a set-membership filter (no single-eq) — apply in JS on the page.
    if (args.locationIds && args.locationIds.length > 0) {
      const set = new Set(args.locationIds.map(String));
      result.page = result.page.filter((p) => p.locationId && set.has(String(p.locationId)));
    }
    return result;
  },
});
```
NOTE: keep any existing auth guard that `list` had (if it took `requestingUserId`/guard, preserve it by adding the arg + guard call back — check the original before replacing).

- [ ] **Step 3: Add the search query**
```ts
export const searchPersonnel = query({
  args: {
    paginationOpts: paginationOptsValidator,
    term: v.string(),
    status: v.optional(v.string()),
    department: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("personnel")
      .withSearchIndex("search_personnel", (s) => {
        let q = s.search("searchText", args.term.toLowerCase());
        if (args.status) q = q.eq("status", args.status);
        if (args.department) q = q.eq("department", args.department);
        if (args.locationId) q = q.eq("locationId", args.locationId);
        return q;
      })
      .paginate(args.paginationOpts);
  },
});
```

- [ ] **Step 4: Add the dropdown-options query**
```ts
export const listOptions = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("personnel").withIndex("by_lastName").order("asc").collect();
    return all.map((p) => ({ _id: p._id, firstName: p.firstName, lastName: p.lastName }));
  },
});
```
(This intentionally still collects — it's the minimal-projection escape hatch for dropdowns; acceptable because it returns only id+name. If a dropdown only needs active people, callers filter client-side or we add a status arg later.)

- [ ] **Step 5: Verify**
Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit` → no errors.
Run: `npm run build` → completes. (Consumers updated in Task 4; the app may still reference the old `list` shape until then — if `build` fails because `app/personnel/page.tsx` calls `list` without `paginationOpts`, that is expected and is fixed in Task 4. To keep this task independently green, DO Task 4 in the same branch and verify the build at the end of Task 4; note this coupling in the report.)

- [ ] **Step 6: Commit**
```bash
cd /Users/andybarrows/IECentral
git add convex/personnel.ts
git commit -m "feat(personnel): paginated list + search-index query + minimal listOptions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: convert the Personnel page to the primitives

**Files:**
- Modify: `app/personnel/page.tsx`
- Modify: any other consumer of `api.personnel.list` (grep first) to use `api.personnel.listOptions` if it only needs the people list for a dropdown.

**Interfaces:**
- Consumes: `usePaginatedList`, `LoadMoreList`, `SearchField`, `Skeleton` (Task 1); `personnel.list`, `personnel.searchPersonnel`, `personnel.listOptions` (Task 3).

- [ ] **Step 1: Find all consumers of the old `personnel.list`**
Run: `grep -rn "api.personnel.list\b" app/ components/`. Any consumer that is NOT the personnel page and only needs a people list for a dropdown/count must switch to `api.personnel.listOptions`. Fix each (they currently expect an array; `listOptions` returns `{_id,firstName,lastName}[]`).

- [ ] **Step 2: Rewrite the personnel page's data layer**
Read `app/personnel/page.tsx`. It currently does `const personnel = useQuery(api.personnel.list, {}) || []` then client-side filters (`filterDepartment`, `filterStatus`, `searchTerm`, `showTerminated`, `showTempsOnly`) and sorts. Replace the data source with browse-vs-search modes:
- Keep the existing filter state (`filterDepartment`, `filterStatus`, etc.).
- `const searching = searchTerm.trim().length > 0;`
- Browse: `const browse = usePaginatedList(api.personnel.list, searching ? "skip" : { status: filterStatus === "all" ? undefined : filterStatus, department: filterDepartment === "all" ? undefined : filterDepartment, locationIds: <existing location scope or undefined> }, { initialNumItems: 50 });`
- Search: `const search = usePaginatedList(api.personnel.searchPersonnel, searching ? { term: searchTerm.trim(), status: filterStatus === "all" ? undefined : filterStatus, department: filterDepartment === "all" ? undefined : filterDepartment } : "skip", { initialNumItems: 50 });`
- `const active = searching ? search : browse;`
- Render the list via `<LoadMoreList status={active.status} results={active.results} loadMore={active.loadMore} renderItem={(person) => <existing row/card JSX for `person`>} skeleton={<Skeleton className="h-16 w-full mb-2" /> repeated} empty={<existing empty state or "No people found">} />`.
- Replace the current search `<input>` with `<SearchField value={searchTerm} onChange={setSearchTerm} placeholder="Search people…" />`.
- REMOVE the client-side `.filter(...)`/`.sort(...)` chains that the server now handles (status/department/search). Keep any *purely presentational* grouping the page does (e.g. terminated vs active) ONLY if it can be expressed via the `status` filter; otherwise `showTerminated` maps to `status: "terminated"` browse.
- The `showTempsOnly` toggle: employeeType isn't a search filterField; keep it as a client-side filter on the current page's results (acceptable — it's a rare toggle), OR note it as a follow-up. Do NOT silently drop it.

- [ ] **Step 3: Preserve counts/headers honestly**
The page shows headcounts (e.g. active count). With pagination you can't show a true total cheaply. Replace any "N people" total that was `personnel.length` with either the loaded count ("Showing N") or remove the total. Do NOT display a wrong/partial number as if it were the total.

- [ ] **Step 4: Verify (this is the build-green checkpoint for Tasks 3+4)**
Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit` → no errors.
Run: `npm run build` → completes.
Manual (dev server, `/personnel`): (a) list shows first 50 + "Load more" appends and stops; (b) department/status filters narrow results (server-side); (c) typing in search returns name/email/position matches; clearing returns to browse; (d) any dropdown that used the full people list still lists everyone; (e) editing a visible person updates live.

- [ ] **Step 5: Commit**
```bash
cd /Users/andybarrows/IECentral
git add app/personnel/page.tsx
# plus any dropdown consumers changed in Step 1
git commit -m "feat(personnel): paginated + search-indexed personnel page via shared primitives

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (this plan = Foundation wave):** primitives ✓ (Task 1); search-index technique ✓ (Task 2 schema + Task 3 `searchPersonnel`); pagination technique ✓ (Task 3 `list` + Task 4 `LoadMoreList`); server-side filters ✓ (Task 3/4); dropdown escape hatch ✓ (`listOptions`); "Load more"/no-totals ✓ (Task 1 `LoadMoreList`, Task 4 Step 3); denormalized `searchText` maintained on all write paths ✓ (Task 2 Steps 3–5) + backfill ✓ (Step 6). Global search rewrite and the other ~14 pages are explicitly OUT of this plan → follow-on plans (Wave 2/3) reuse Task 1's primitives + Task 2/3's pattern.

**Placeholder scan:** No TBD/TODO. Task 4's page rewrite is specified as precise behavior + interfaces (the current page is large and existing; the implementer reads it and applies the named primitives/queries) — the exact primitive APIs and query args are fully given. The `usePaginatedList` generic and the `update`/import arg names carry explicit "verify against actual" notes because they depend on installed types / unread arg lists; that is a verification instruction, not a placeholder.

**Type consistency:** `search_personnel`/`searchText`/`by_lastName` named identically across Tasks 2–3. `usePaginatedList` return `{results,status,loadMore,isLoading,isDone}` matches `LoadMoreList` props and Task 4 usage. Status union identical in `usePaginatedList` and `LoadMoreList`. `listOptions` shape (`{_id,firstName,lastName}`) stated in Task 3 and consumed in Task 4 Step 1.

**Coupling note:** Tasks 3 and 4 are build-green together (Task 3 changes `list`'s signature; the page is fixed in Task 4). The plan states this and puts the authoritative build check at the end of Task 4 — the executor should treat Tasks 3+4 as a pair for the build gate while still committing them separately.
