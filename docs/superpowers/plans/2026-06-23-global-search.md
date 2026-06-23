# Global Search Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the top-bar global search permission-aware and broaden it to Doc Hub, tires/inventory, and operations — surfacing only what each user can access.

**Architecture:** Rewrite the Convex `globalSearch` query to take `requestingUserId` and gate every bucket by tier + per-record visibility (also fixes today's leak). Add Doc Hub as a new DB source. Merge S3 tire results client-side (tier-4 only) via the existing tire-search API. Render results grouped by category.

**Tech Stack:** Convex, Next.js 15 App Router, React 19, Tailwind.

## Global Constraints

- Permission gates by tier (`getTier`/`ROLE_TIER`): personnel/applicants/equipment ≥2; users/tires/reports ≥4; Doc Hub by document visibility; announcements/locations all-auth; projects owner/shared/≥4.
- `globalSearch` MUST require `requestingUserId: v.id("users")` and never return a bucket the user fails the gate for.
- Doc Hub: include an active doc if visibility is community/internal, or isPublic, or uploadedBy===user, or sharedWith includes user, or sharedWithGroups ∩ user groups — AND not inside a password-protected folder the user neither owns nor has a non-revoked grant to.
- Equipment results expose only name/number/model/status (no secrets).
- Verification: pure helpers get a node test; Convex/React get `npx tsc --noEmit` (`-p convex/tsconfig.json` and `-p tsconfig.json`); UI is manual. No JS test runner in repo.
- Commit per task; push deploys Convex + Vercel from origin/main.

---

### Task 1: Pure Doc Hub visibility helper (`lib/docVisibility.ts`)

Extract the access predicate so it's unit-testable independent of Convex.

**Files:** Create `lib/docVisibility.ts`; Test `/tmp/docvis.test.mjs`.

**Interfaces — Produces:**
- `type VisDoc = { uploadedBy: string; visibility?: string; isPublic?: boolean; sharedWith?: string[]; sharedWithGroups?: string[]; folderId?: string }`
- `canSeeDocument(doc: VisDoc, userId: string, groupIds: Set<string>, lockedFolderIds: Set<string>): boolean` — `lockedFolderIds` = password-protected folders the user can't access.

- [ ] **Step 1: Write it**

```ts
// lib/docVisibility.ts
export type VisDoc = {
  uploadedBy: string; visibility?: string; isPublic?: boolean;
  sharedWith?: string[]; sharedWithGroups?: string[]; folderId?: string;
};
export function canSeeDocument(doc: VisDoc, userId: string, groupIds: Set<string>, lockedFolderIds: Set<string>): boolean {
  if (doc.folderId && lockedFolderIds.has(doc.folderId)) return false; // protected folder, no access
  if (doc.uploadedBy === userId) return true;
  const vis = doc.visibility || "private";
  if (vis === "community" || vis === "internal") return true;
  if (doc.isPublic) return true;
  if (doc.sharedWith?.includes(userId)) return true;
  if (doc.sharedWithGroups?.some((g) => groupIds.has(g))) return true;
  return false;
}
```

- [ ] **Step 2: Test (expect all true)**

```js
// /tmp/docvis.test.mjs — run: npx tsx /tmp/docvis.test.mjs
import { canSeeDocument } from "/Users/andybarrows/IECentral/lib/docVisibility.ts";
const g = new Set(["g1"]); const locked = new Set(["fLocked"]);
const t = (v,m)=>console.log(m, v);
t(canSeeDocument({uploadedBy:"u1",visibility:"private"}, "u1", g, locked)===true, "owner sees:");
t(canSeeDocument({uploadedBy:"u2",visibility:"community"}, "u1", g, locked)===true, "community:");
t(canSeeDocument({uploadedBy:"u2",visibility:"private",sharedWith:["u1"]}, "u1", g, locked)===true, "shared:");
t(canSeeDocument({uploadedBy:"u2",visibility:"private",sharedWithGroups:["g1"]}, "u1", g, locked)===true, "group:");
t(canSeeDocument({uploadedBy:"u2",visibility:"private"}, "u1", g, locked)===false, "private hidden:");
t(canSeeDocument({uploadedBy:"u1",folderId:"fLocked"}, "u1", g, locked)===false, "locked folder hidden:");
```
Run: `cd /Users/andybarrows/IECentral && npx tsx /tmp/docvis.test.mjs` — every line `true`.

- [ ] **Step 3: Commit** — `git add lib/docVisibility.ts && git commit -m "feat(search): pure Doc Hub visibility predicate"`

---

### Task 2: `tierOf` helper + permission-aware `globalSearch` rewrite

**Files:** Modify `convex/authGuards.ts` (export `tierOf`); rewrite `convex/search.ts`.

**Interfaces:**
- Consumes: `canSeeDocument` (Task 1).
- Produces: `tierOf(role: string): number`; `globalSearch({ requestingUserId, searchQuery })` returning `{ results: Array<{type,id,title,subtitle,href,icon,category}>, totalCount }` where `category ∈ "People"|"Documents"|"Operations"`.

- [ ] **Step 1:** In `convex/authGuards.ts`, after `ROLE_TIER`, add:

```ts
export function tierOf(role: string): number { return ROLE_TIER[role] ?? 0; }
```

- [ ] **Step 2:** Rewrite `convex/search.ts` handler. Add the arg + guard, compute tier, gate each bucket, add Doc Hub, tag `category`, cap 6/category & 30 total. Key structure:

```ts
import { v } from "convex/values";
import { query } from "./_generated/server";
import { tierOf } from "./authGuards";
import { canSeeDocument } from "../lib/docVisibility";

export const globalSearch = query({
  args: { requestingUserId: v.id("users"), searchQuery: v.string() },
  handler: async (ctx, args) => {
    const q = args.searchQuery.toLowerCase().trim();
    if (!q) return { results: [], totalCount: 0 };
    const user = await ctx.db.get(args.requestingUserId);
    if (!user || user.isActive === false) return { results: [], totalCount: 0 };
    const tier = tierOf(user.role);
    const uid = args.requestingUserId as unknown as string;

    type R = { type: string; id: string; title: string; subtitle: string; href: string; icon: string; category: string };
    const out: R[] = [];
    const PER = 6;

    // Doc Hub (all auth, visibility-filtered)
    const groups = await ctx.db.query("groups").withIndex("by_active", (g)=>g.eq("isActive", true)).collect();
    const groupIds = new Set(groups.filter((g)=>g.memberIds.includes(args.requestingUserId)).map((g)=>g._id as unknown as string));
    const grants = await ctx.db.query("folderAccessGrants").withIndex("by_user", (x)=>x.eq("grantedToUserId", args.requestingUserId)).filter((x)=>x.eq(x.field("isRevoked"), false)).collect();
    const grantedFolders = new Set(grants.map((x)=>x.folderId as unknown as string));
    const folders = await ctx.db.query("documentFolders").withIndex("by_active", (x)=>x.eq("isActive", true)).collect();
    const locked = new Set(folders.filter((f)=>f.passwordHash && (f.createdBy as unknown as string)!==uid && !grantedFolders.has(f._id as unknown as string)).map((f)=>f._id as unknown as string));
    const docs = await ctx.db.query("documents").withIndex("by_active", (x)=>x.eq("isActive", true)).collect();
    let dc = 0;
    for (const d of docs) {
      if (dc >= PER) break;
      if (!(d.name?.toLowerCase().includes(q) || d.description?.toLowerCase().includes(q) || d.fileName?.toLowerCase().includes(q))) continue;
      if (!canSeeDocument({ uploadedBy: d.uploadedBy as unknown as string, visibility: d.visibility, isPublic: d.isPublic, sharedWith: (d.sharedWith||[]).map(String), sharedWithGroups: (d.sharedWithGroups||[]).map(String), folderId: d.folderId ? String(d.folderId) : undefined }, uid, groupIds, locked)) continue;
      out.push({ type: "document", id: d._id, title: d.name, subtitle: "Document", href: `/documents?doc=${d._id}`, icon: "document", category: "Documents" });
      dc++;
    }

    // People & HR
    if (tier >= 2) {
      const personnel = await ctx.db.query("personnel").collect();
      let n=0; for (const p of personnel){ if(n>=PER)break; const full=`${p.firstName} ${p.lastName}`.toLowerCase(); if(full.includes(q)||p.position?.toLowerCase().includes(q)||p.department?.toLowerCase().includes(q)){ out.push({type:"personnel",id:p._id,title:`${p.firstName} ${p.lastName}`,subtitle:`${p.position??""} - ${p.department??""}`,href:`/personnel/${p._id}`,icon:"user",category:"People"}); n++; } }
      const apps = await ctx.db.query("applications").collect();
      let a=0; for (const ap of apps){ if(a>=PER)break; const full=`${ap.firstName} ${ap.lastName}`.toLowerCase(); if(full.includes(q)||ap.email?.toLowerCase().includes(q)){ out.push({type:"application",id:ap._id,title:`${ap.firstName} ${ap.lastName}`,subtitle:`Applicant - ${ap.status}`,href:`/applications/${ap._id}`,icon:"document",category:"People"}); a++; } }
    }
    if (tier >= 4) {
      const users = await ctx.db.query("users").collect();
      let n=0; for (const u of users){ if(n>=PER)break; if(u.name?.toLowerCase().includes(q)||u.email?.toLowerCase().includes(q)){ out.push({type:"user",id:u._id,title:u.name,subtitle:`${u.role} - ${u.email}`,href:"/users",icon:"users",category:"People"}); n++; } }
    }

    // Operations
    if (tier >= 2) {
      const scanners = await ctx.db.query("scanners").collect();
      let s=0; for (const sc of scanners){ if(s>=PER)break; if(sc.number?.toLowerCase().includes(q)||sc.serialNumber?.toLowerCase().includes(q)||sc.model?.toLowerCase().includes(q)){ out.push({type:"equipment",id:sc._id,title:`Scanner #${sc.number}`,subtitle:`${sc.model||"Scanner"} - ${sc.status}`,href:"/equipment",icon:"device",category:"Operations"}); s++; } }
      const pickers = await ctx.db.query("pickers").collect();
      let p2=0; for (const pk of pickers){ if(p2>=PER)break; if(pk.number?.toLowerCase().includes(q)||pk.serialNumber?.toLowerCase().includes(q)||pk.model?.toLowerCase().includes(q)){ out.push({type:"equipment",id:pk._id,title:`Picker #${pk.number}`,subtitle:`${pk.model||"Picker"} - ${pk.status}`,href:"/equipment",icon:"device",category:"Operations"}); p2++; } }
    }
    const projects = await ctx.db.query("projects").collect();
    let pc=0; for (const pr of projects){ if(pc>=PER)break; const canSee = (pr.createdBy as unknown as string)===uid || (pr.sharedWith||[]).map(String).includes(uid) || tier>=4; if(canSee && (pr.name.toLowerCase().includes(q)||pr.description?.toLowerCase().includes(q))){ out.push({type:"project",id:pr._id,title:pr.name,subtitle:`Project - ${pr.status}`,href:"/projects",icon:"folder",category:"Operations"}); pc++; } }
    const anns = await ctx.db.query("announcements").collect();
    let ac=0; for (const an of anns){ if(ac>=PER)break; if((an.title?.toLowerCase().includes(q))||(an.content?.toLowerCase().includes(q))){ out.push({type:"announcement",id:an._id,title:an.title,subtitle:"Announcement",href:"/announcements",icon:"document",category:"Operations"}); ac++; } }
    const locs = await ctx.db.query("locations").collect();
    let lc=0; for (const lo of locs){ if(lc>=PER)break; if(lo.name?.toLowerCase().includes(q)){ out.push({type:"location",id:lo._id,title:lo.name,subtitle:"Location",href:"/locations",icon:"folder",category:"Operations"}); lc++; } }

    return { results: out.slice(0, 30), totalCount: out.length };
  },
});
```

(Verify field names against schema while implementing: `announcements.title/content`, `applications.status`. Adjust if a field is named differently.)

- [ ] **Step 3:** `npx tsc --noEmit -p convex/tsconfig.json 2>&1 | grep -i "error TS" || echo clean` → `clean`.
- [ ] **Step 4: Commit** — `git add convex/authGuards.ts convex/search.ts && git commit -m "feat(search): permission-aware globalSearch + Doc Hub"`

---

### Task 3: GlobalSearch client — userId, debounce, grouped UI, tire merge

**Files:** Modify `components/GlobalSearch.tsx`.

**Interfaces — Consumes:** `api.search.globalSearch` (Task 2), `useAuth` (`app/auth-context`), `usePermissions` (`lib/usePermissions`), `/api/reports/tire-search`.

- [ ] **Step 1:** Add imports `useAuth`, `usePermissions`. Update `SearchResult` to include `category: string` and broaden `type` to include `"document"|"announcement"|"location"|"tire"`. Add the new icons (`document` exists; add `device`, `users` if missing — they exist in `typeIcons`).

- [ ] **Step 2:** Debounce + auth-gated query:

```tsx
const { user } = useAuth();
const { menu } = usePermissions();
const [debounced, setDebounced] = useState("");
useEffect(() => { const t = setTimeout(() => setDebounced(query), 250); return () => clearTimeout(t); }, [query]);
const searchResults = useQuery(
  api.search.globalSearch,
  debounced.length >= 2 && user ? { requestingUserId: user._id, searchQuery: debounced } : "skip",
);
const dbResults = (searchResults?.results || []) as SearchResult[];
```

- [ ] **Step 3:** Tire merge (tier-4 only) via effect:

```tsx
const [tireResults, setTireResults] = useState<SearchResult[]>([]);
useEffect(() => {
  if (!menu.reports || debounced.length < 2) { setTireResults([]); return; }
  let cancelled = false;
  fetch(`/api/reports/tire-search?q=${encodeURIComponent(debounced)}`)
    .then((r) => r.json())
    .then((d) => { if (cancelled) return; setTireResults((d.results || []).slice(0, 6).map((t: { itemId: string; brand: string; model: string; sizeDesc: string }) => ({
      type: "tire", id: t.itemId, title: `${t.brand} ${t.model}`.trim(), subtitle: t.sizeDesc || t.itemId,
      href: `/reports/inventory/filtered?q=${encodeURIComponent(t.itemId)}`, icon: "device", category: "Tires" }))); })
    .catch(() => { if (!cancelled) setTireResults([]); });
  return () => { cancelled = true; };
}, [debounced, menu.reports]);
const results = [...dbResults, ...tireResults];
```

- [ ] **Step 4:** Render grouped. Replace the flat `.map` with a grouped render that preserves the flat `results` array for keyboard nav (compute a flat index per item). Group order: `["People","Documents","Tires","Operations"]`. For each non-empty category, render a small header then its items; track a running flat index so `selectedIndex` highlighting + Enter still line up with `results`.

- [ ] **Step 5:** `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "error TS" || echo clean` → `clean`.
- [ ] **Step 6: Commit** — `git add components/GlobalSearch.tsx && git commit -m "feat(search): grouped results, debounce, tire merge"`

---

### Task 4: Deep-links — Doc Hub `?doc=` open + inventory `?q=` prefill

**Files:** Modify `components/dochub/DocHubContext.tsx` (or `app/documents/page.tsx`); modify `app/reports/inventory/filtered/page.tsx`.

- [ ] **Step 1: Doc Hub.** On mount, read `?doc=<id>` from `useSearchParams()` and open that document's preview (set the selected/preview document state the context already uses). Wrap the page in `<Suspense>` if Next complains about `useSearchParams`. If wiring the in-app open is non-trivial, fall back to navigating the doc result to the file proxy `/api/documents/file?id=<id>` instead (update the href in Task 2) — decide while reading the context.

- [ ] **Step 2: Inventory.** In `app/reports/inventory/filtered/page.tsx`, read `?q=<itemId>` from `useSearchParams()` and initialize the existing item search-filter state with it (the page already filters rows by a `hay` string including itemId). Confirm the state variable name and seed it from the param.

- [ ] **Step 3:** `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "error TS" || echo clean` → `clean`.
- [ ] **Step 4: Commit + push** — `git add -A && git commit -m "feat(search): doc + inventory deep-links" && git push origin main`

- [ ] **Step 5: Manual verification.** As a tier-4 user: search a brand → see Tires group → click → inventory filtered. Search a doc name → opens in Doc Hub. As a low-tier user: confirm personnel/users do NOT appear, Doc Hub only shows accessible docs.

---

## Self-Review

- **Spec coverage:** permission gating per bucket (Task 2) ✓; Doc Hub source + visibility (Tasks 1–2) ✓; tires tier-4 client merge → inventory (Task 3) ✓; grouped + debounced UI (Task 3) ✓; leak fix via requestingUserId (Task 2) ✓; deep-links (Task 4) ✓.
- **Placeholder scan:** Task 4 Step 1 has a documented fallback (file-proxy href) rather than a TBD — concrete either way. Field-name verifications in Task 2 are explicit checks, not gaps.
- **Type consistency:** result shape `{type,id,title,subtitle,href,icon,category}` consistent across Tasks 2–3; `canSeeDocument` signature consistent between Tasks 1–2.
