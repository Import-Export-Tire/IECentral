# Doc Hub UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Doc Hub presentation layer so non-technical office staff can obviously store and share documents — plain-language navigation, prominent Upload/Share, advanced controls behind an admins-only Manage drawer, mobile-first — reusing the existing Convex data layer unchanged.

**Architecture:** `DocHubContext` (all Convex queries/mutations/state) stays the data source. We add three small pieces of view state to it (`railSelection`, `showManageDrawer`, `recentDocuments`), then replace the presentation components: a plain-language left rail (`DocHubRail`) and mobile nav (`MobileNav`) replace the tier sidebar; `FileBrowser` gets a simplified top bar + rail-driven content; an admins-only `ManageDrawer` houses everything technical; `ShareAccessModal` is re-labeled to plain "Who can see this?" language. No backend/schema/query changes.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v4, TypeScript, Convex (`outstanding-dalmatian-787`). Client components (`"use client"`).

## Global Constraints

- **No backend changes.** Do not modify anything under `convex/`, the Convex schema, or query/mutation signatures. Reuse existing queries: `getMyFolders`, `getSharedFolders`, `getCommunityFolders`, `documents.getAll`, `getStorageUsage`, `getExpiring`, `documentSignatures.getUnsignedForUser`.
- **No new dependencies.**
- **Verification gate is `npx tsc --noEmit` then `npm run build`.** There is NO component test runner and `next lint` is a no-op — do not add or expect unit tests. Each task's "test" is a clean typecheck + build plus the described manual verification.
- **Styling matches the existing codebase pattern:** conditional `isDark` Tailwind classes (light default). Light accent is `blue-600`/`blue-50`/`blue-100`; dark accent is `cyan-500`/`cyan-400`. Cards are rounded-xl/2xl with `border-gray-200` (light) / `border-slate-700/50` (dark).
- **Plain-language rule:** the words "tier", "HIPAA", "confidential", "internal" (as a visibility label) must NOT appear in any staff-facing text. Staff-facing sharing choices are exactly: **Only me**, **Everyone at the company**, **Specific people or groups**.
- **Admin gate:** `isAdmin` (from context) === `user.role === "admin" || "super_admin"`. Manage and all advanced controls are gated behind `isAdmin`.
- **Deploy model:** single PR to `main`; Vercel builds Convex + Next from `origin/main`. `tsc` + `build` must pass before push.

---

### Task 1: Add view-state to DocHubContext (railSelection, showManageDrawer, recentDocuments)

**Files:**
- Modify: `components/dochub/DocHubContext.tsx`

**Interfaces:**
- Produces (added to `DocHubContextType` and provider value):
  - `railSelection: RailSelection` where `type RailSelection = "mine" | "shared" | "company" | "recent"`
  - `setRailSelection: (sel: RailSelection) => void`
  - `showManageDrawer: boolean`
  - `setShowManageDrawer: (show: boolean) => void`
  - `recentDocuments: DocumentType[] | undefined` — the user's root documents sorted by `updatedAt` desc, capped at 24.
- Consumes: nothing new (uses existing `documents` query already in the provider).

- [ ] **Step 1: Export the `RailSelection` type from `types.ts`**

Add to `components/dochub/types.ts` (right after the `export type ViewMode = "grid" | "list";` line, currently line 146):

```typescript
export type RailSelection = "mine" | "shared" | "company" | "recent";
```

- [ ] **Step 2: Import `RailSelection` in the context**

In `components/dochub/DocHubContext.tsx`, update the type import (line 9) to include `RailSelection`:

```typescript
import type { ViewMode, BreadcrumbItem, DocumentType, FolderType, RailSelection } from "./types";
```

- [ ] **Step 3: Declare the new fields in `DocHubContextType`**

In `components/dochub/DocHubContext.tsx`, inside the `interface DocHubContextType`, add these lines immediately after the `showGroupsModal`/`setShowGroupsModal` pair (currently lines 55-56):

```typescript
  showManageDrawer: boolean;
  setShowManageDrawer: (show: boolean) => void;
  // Plain-language rail
  railSelection: RailSelection;
  setRailSelection: (sel: RailSelection) => void;
  recentDocuments: DocumentType[] | undefined;
```

- [ ] **Step 4: Add the state + computed value in the provider**

In `DocHubProvider`, add state next to the other modal state (after `const [showGroupsModal, setShowGroupsModal] = useState(false);`, currently line 163):

```typescript
  const [showManageDrawer, setShowManageDrawer] = useState(false);
  const [railSelection, setRailSelection] = useState<RailSelection>("mine");
```

Then, immediately BEFORE the `return (` of the provider (currently line 679, right after the `filteredDocuments` computation block ends at line 677), add:

```typescript
  // Recent = the user's root documents, most-recently-updated first (client-side; no new query).
  const recentDocuments = documents
    ? [...documents].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 24)
    : undefined;
```

- [ ] **Step 5: Expose the new fields in the provider value**

In the `value={{ ... }}` object, on the line that currently reads `showGroupsModal, setShowGroupsModal,` (line 687), add after it:

```typescript
      showManageDrawer, setShowManageDrawer,
      railSelection, setRailSelection, recentDocuments,
```

- [ ] **Step 6: Verify typecheck + build**

Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: build completes ("Compiled successfully" / route list printed). No behavior change yet (fields added but unused).

- [ ] **Step 7: Commit**

```bash
cd /Users/andybarrows/IECentral
git add components/dochub/DocHubContext.tsx components/dochub/types.ts
git commit -m "feat(dochub): add rail selection, manage-drawer, recent-docs view state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: New plain-language left rail (`DocHubRail`)

**Files:**
- Create: `components/dochub/DocHubRail.tsx`
- Modify: `components/dochub/index.ts`

**Interfaces:**
- Consumes from context: `isDark`, `isAdmin`, `railSelection`, `setRailSelection`, `navigateToRoot`, `setShowManageDrawer` (all from Task 1 + existing).
- Produces: default export `DocHubRail` (desktop rail, hidden below `md`).

- [ ] **Step 1: Create `components/dochub/DocHubRail.tsx`**

```tsx
"use client";

import { useDocHub } from "./DocHubContext";
import type { RailSelection } from "./types";

type RailItem = { key: RailSelection; label: string; icon: string };

const RAIL_ITEMS: RailItem[] = [
  { key: "mine", label: "My Documents", icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" },
  { key: "shared", label: "Shared with me", icon: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2-5.24M5 8a3 3 0 002 5.24" },
  { key: "company", label: "Company", icon: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { key: "recent", label: "Recent", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
];

export default function DocHubRail() {
  const { isDark, isAdmin, railSelection, setRailSelection, navigateToRoot, setShowManageDrawer } = useDocHub();

  const select = (key: RailSelection) => {
    navigateToRoot();       // exit any open folder when switching sections
    setRailSelection(key);
  };

  return (
    <div className={`hidden md:flex w-56 flex-shrink-0 border-r flex-col h-full ${
      isDark ? "bg-slate-900/50 border-slate-700/50" : "bg-gray-50/80 border-gray-200"
    }`}>
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {RAIL_ITEMS.map(item => {
          const active = railSelection === item.key;
          return (
            <button
              key={item.key}
              onClick={() => select(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                active
                  ? isDark ? "bg-cyan-500/15 text-cyan-400" : "bg-blue-50 text-blue-700"
                  : isDark ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50" : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
              </svg>
              {item.label}
            </button>
          );
        })}
      </nav>

      {isAdmin && (
        <div className={`p-3 border-t ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
          <button
            onClick={() => setShowManageDrawer(true)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              isDark ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50" : "text-gray-500 hover:text-gray-800 hover:bg-gray-100"
            }`}
          >
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Manage
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Export it from the barrel**

In `components/dochub/index.ts`, add an export line alongside the other component exports:

```typescript
export { default as DocHubRail } from "./DocHubRail";
export { default as ManageDrawer } from "./ManageDrawer";
export { default as MobileNav } from "./MobileNav";
```

(All three new components are exported here now; `ManageDrawer` and `MobileNav` are created in Tasks 3 and 5. If you are executing tasks strictly in order and `npm run build` runs between tasks, add only the `DocHubRail` line in this task and add the other two lines in their respective tasks. If a reviewer runs the build now with all three lines present, it will fail until Tasks 3 and 5 exist — so add only the `DocHubRail` export in this task.)

Concretely, in THIS task add only:

```typescript
export { default as DocHubRail } from "./DocHubRail";
```

- [ ] **Step 3: Verify typecheck + build**

Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit`
Expected: no errors (the component is not yet rendered, but it compiles).
Run: `npm run build`
Expected: build completes.

- [ ] **Step 4: Commit**

```bash
cd /Users/andybarrows/IECentral
git add components/dochub/DocHubRail.tsx components/dochub/index.ts
git commit -m "feat(dochub): plain-language left rail (My Documents/Shared/Company/Recent + Manage)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: New admins-only Manage drawer (`ManageDrawer`)

**Files:**
- Create: `components/dochub/ManageDrawer.tsx`
- Modify: `components/dochub/index.ts`

**Interfaces:**
- Consumes from context: `isDark`, `isAdmin`, `showManageDrawer`, `setShowManageDrawer`, `storageUsage`, `expiringDocuments`, `unsignedDocuments`, `selectedCategory`, `setSelectedCategory`, `viewMode`, `setViewMode`, `showArchived`, `setShowArchived`, `setShowGroupsModal`, `currentFolderId`.
- Produces: default export `ManageDrawer` (right-side slide-over; renders null unless `isAdmin && showManageDrawer`).

- [ ] **Step 1: Create `components/dochub/ManageDrawer.tsx`**

```tsx
"use client";

import { useDocHub } from "./DocHubContext";
import { CATEGORIES, formatFileSize } from "./types";

export default function ManageDrawer() {
  const {
    isDark, isAdmin, showManageDrawer, setShowManageDrawer,
    storageUsage, expiringDocuments, unsignedDocuments,
    selectedCategory, setSelectedCategory, viewMode, setViewMode,
    showArchived, setShowArchived, setShowGroupsModal, currentFolderId,
  } = useDocHub();

  if (!isAdmin || !showManageDrawer) return null;

  const close = () => setShowManageDrawer(false);
  const sectionTitle = `text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-slate-500" : "text-gray-400"}`;
  const card = `rounded-xl p-3 ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={close}>
      <div className={`absolute inset-0 ${isDark ? "bg-black/60" : "bg-black/30"} backdrop-blur-sm`} />
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-sm h-full overflow-y-auto shadow-2xl ${isDark ? "bg-slate-900 border-l border-slate-700" : "bg-white border-l border-gray-200"}`}
      >
        {/* Header */}
        <div className={`sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b ${isDark ? "bg-slate-900 border-slate-700" : "bg-white border-gray-200"}`}>
          <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Manage</h2>
          <button onClick={close} className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Storage */}
          <div>
            <h3 className={sectionTitle}>Storage</h3>
            <div className={card}>
              <div className="flex items-center justify-between">
                <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>Used</span>
                <span className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  {storageUsage ? formatFileSize(storageUsage.totalBytes) : "…"}
                </span>
              </div>
              {storageUsage && (
                <p className={`text-xs mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  {storageUsage.count} {storageUsage.count === 1 ? "file" : "files"}
                </p>
              )}
            </div>
          </div>

          {/* Attention */}
          <div>
            <h3 className={sectionTitle}>Needs attention</h3>
            <div className="space-y-2">
              <div className={`flex items-center justify-between ${card}`}>
                <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>Expiring soon</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-700"}`}>
                  {expiringDocuments?.length ?? 0}
                </span>
              </div>
              <div className={`flex items-center justify-between ${card}`}>
                <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>Needs signature</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isDark ? "bg-rose-500/20 text-rose-400" : "bg-rose-100 text-rose-700"}`}>
                  {unsignedDocuments?.length ?? 0}
                </span>
              </div>
            </div>
          </div>

          {/* View */}
          <div>
            <h3 className={sectionTitle}>View</h3>
            <div className={`flex rounded-lg border w-max ${isDark ? "border-slate-700" : "border-gray-200"}`}>
              <button
                onClick={() => setViewMode("grid")}
                className={`px-3 py-1.5 text-sm rounded-l-lg transition-colors ${viewMode === "grid" ? (isDark ? "bg-slate-700 text-white" : "bg-gray-100 text-gray-900") : (isDark ? "text-slate-400" : "text-gray-400")}`}
              >Grid</button>
              <button
                onClick={() => setViewMode("list")}
                className={`px-3 py-1.5 text-sm rounded-r-lg transition-colors ${viewMode === "list" ? (isDark ? "bg-slate-700 text-white" : "bg-gray-100 text-gray-900") : (isDark ? "text-slate-400" : "text-gray-400")}`}
              >List</button>
            </div>
          </div>

          {/* Category filter */}
          <div>
            <h3 className={sectionTitle}>Filter by category</h3>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors ${!selectedCategory ? (isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-blue-100 text-blue-700") : (isDark ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-100")}`}
              >All</button>
              {CATEGORIES.map(cat => (
                <button
                  key={cat.value}
                  onClick={() => setSelectedCategory(selectedCategory === cat.value ? null : cat.value)}
                  className={`px-2.5 py-1 text-xs rounded-full transition-colors ${selectedCategory === cat.value ? (isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-blue-100 text-blue-700") : (isDark ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-100")}`}
                >{cat.label}</button>
              ))}
            </div>
          </div>

          {/* Groups + archived */}
          <div>
            <h3 className={sectionTitle}>Advanced</h3>
            <div className="space-y-2">
              <button
                onClick={() => { setShowGroupsModal(true); close(); }}
                className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${isDark ? "bg-slate-800/50 text-slate-200 hover:bg-slate-800" : "bg-gray-50 text-gray-800 hover:bg-gray-100"}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2-5.24M5 8a3 3 0 002 5.24" />
                </svg>
                Manage groups
              </button>
              {!currentFolderId && (
                <button
                  onClick={() => setShowArchived(!showArchived)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${showArchived ? (isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-700") : (isDark ? "bg-slate-800/50 text-slate-200 hover:bg-slate-800" : "bg-gray-50 text-gray-800 hover:bg-gray-100")}`}
                >
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                    </svg>
                    {showArchived ? "Viewing archived" : "Show archived"}
                  </span>
                </button>
              )}
            </div>
            <p className={`text-xs mt-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
              Privacy levels and password protection are set per folder from its Share panel.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Export it from the barrel**

In `components/dochub/index.ts`, add:

```typescript
export { default as ManageDrawer } from "./ManageDrawer";
```

- [ ] **Step 3: Verify typecheck + build**

Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: build completes.

- [ ] **Step 4: Commit**

```bash
cd /Users/andybarrows/IECentral
git add components/dochub/ManageDrawer.tsx components/dochub/index.ts
git commit -m "feat(dochub): admins-only Manage drawer (storage, attention, view, categories, groups, archived)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Rewrite `FileBrowser` — simple top bar + rail-driven content

**Files:**
- Modify (full rewrite): `components/dochub/FileBrowser.tsx`

**Interfaces:**
- Consumes from context: `isDark`, `viewMode`, `filteredDocuments`, `recentDocuments`, `railSelection`, `myFolders`, `communityFolders`, `sharedFoldersWithMe`, `showArchived`, `setShowUploadModal`, `setShowFolderModal`, `isDraggingOver`, `setIsDraggingOver`, `handleUpload`, `currentFolderId`, `loadingFolderDocs`, `error`, `setError`, `searchQuery`, `setSearchQuery`, `folderSearchResults`.
- Consumes existing components: `Breadcrumbs`, `HelpModal`, `FileGridCard`, `FileListRow`, `FolderGridCard`, `FolderListRow` (from `./FileCard`).
- Produces: default export `FileBrowser`.

This rewrite: (a) replaces the dense toolbar with a clean top bar (title/context, wide Search, New folder, Upload); (b) removes the category pills, grid/list toggle, archived toggle, and Upload-Folder button from the default surface (they live in the Manage drawer now); (c) shows folders + documents according to `railSelection` at root, and normal folder contents when inside a folder; (d) keeps drag-and-drop upload and the inline drop-zone; (e) shows friendly per-section empty states.

- [ ] **Step 1: Replace the entire contents of `components/dochub/FileBrowser.tsx`**

```tsx
"use client";

import { useCallback, useRef } from "react";
import { useDocHub } from "./DocHubContext";
import Breadcrumbs from "./Breadcrumbs";
import HelpModal from "./HelpModal";
import { FileGridCard, FileListRow, FolderGridCard, FolderListRow } from "./FileCard";
import type { DocumentType, FolderType } from "./types";

function DropZoneOverlay() {
  const { isDark } = useDocHub();
  return (
    <div className={`absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed transition-all ${
      isDark ? "bg-cyan-500/5 border-cyan-500/40" : "bg-blue-500/5 border-blue-500/40"
    }`}>
      <div className="text-center">
        <svg className={`w-12 h-12 mx-auto mb-3 ${isDark ? "text-cyan-400" : "text-blue-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className={`text-sm font-medium ${isDark ? "text-cyan-300" : "text-blue-600"}`}>Drop files to upload</p>
      </div>
    </div>
  );
}

// Friendly, action-oriented empty state per rail section.
function EmptyState({ section }: { section: string }) {
  const { isDark, setShowUploadModal, currentFolderId } = useDocHub();
  const canUpload = section === "mine" || section === "recent" || !!currentFolderId;
  const message = currentFolderId
    ? "This folder is empty."
    : section === "shared"
      ? "Nothing's been shared with you yet."
      : section === "company"
        ? "No company documents yet."
        : "No documents yet.";
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className={`p-6 rounded-2xl mb-4 ${isDark ? "bg-slate-800/40" : "bg-gray-50"}`}>
        <svg className={`w-14 h-14 ${isDark ? "text-slate-600" : "text-gray-300"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
      </div>
      <p className={`text-base font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>{message}</p>
      {canUpload && (
        <>
          <p className={`text-sm mb-4 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Drop a file here, or click to add your first one.</p>
          <button
            onClick={() => setShowUploadModal(true)}
            className={`px-5 py-2.5 text-sm font-semibold rounded-xl transition-colors ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
          >
            Upload a document
          </button>
        </>
      )}
    </div>
  );
}

function ListHeader() {
  const { isDark } = useDocHub();
  return (
    <div className={`flex items-center gap-4 px-4 py-2 text-xs font-medium uppercase tracking-wider border-b ${isDark ? "text-slate-500 border-slate-700/50" : "text-gray-400 border-gray-100"}`}>
      <span className="w-5" />
      <span className="flex-1">Name</span>
      <span className="hidden md:block w-20">Category</span>
      <span className="hidden sm:block w-20 text-right">Size</span>
      <span className="hidden lg:block w-28 text-right">Modified</span>
      <span className="w-16" />
    </div>
  );
}

export default function FileBrowser() {
  const {
    isDark, viewMode, filteredDocuments, recentDocuments, railSelection,
    myFolders, communityFolders, sharedFoldersWithMe, showArchived,
    setShowUploadModal, setShowFolderModal, isDraggingOver, setIsDraggingOver,
    handleUpload, currentFolderId, loadingFolderDocs, error, setError,
    searchQuery, setSearchQuery, folderSearchResults,
  } = useDocHub();

  const dropRef = useRef<HTMLDivElement>(null);
  const isSearching = !!searchQuery.trim();
  const atRoot = !currentFolderId;

  // Which folders to show. At root, follow the rail selection. Inside a folder,
  // show that folder's children (any visibility), matching the server queries which
  // are already scoped by parentFolderId.
  const rootFolders: FolderType[] =
    railSelection === "mine" ? (myFolders || [])
    : railSelection === "shared" ? ((sharedFoldersWithMe || []).filter(Boolean) as FolderType[])
    : railSelection === "company" ? (communityFolders || [])
    : []; // recent → no folders

  const inFolderFolders: FolderType[] = [
    ...(myFolders || []),
    ...(communityFolders || []).filter(cf => !myFolders?.find(mf => mf._id === cf._id)),
    ...((sharedFoldersWithMe || []).filter(
      sf => sf && !myFolders?.find(mf => mf._id === sf._id) && !communityFolders?.find(cf => cf._id === sf._id)
    ) as FolderType[]),
  ];

  const allFolders: FolderType[] = isSearching
    ? (folderSearchResults || [])
    : showArchived ? []
    : atRoot ? rootFolders : inFolderFolders;

  // Which documents to show. At root, only "mine" and "recent" carry loose documents;
  // "shared"/"company" are folder-oriented at the root level.
  const docsToShow: DocumentType[] | undefined =
    isSearching || showArchived || !atRoot
      ? filteredDocuments
      : railSelection === "recent"
        ? recentDocuments
        : railSelection === "mine"
          ? filteredDocuments
          : []; // shared/company root

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) setIsDraggingOver(true);
  }, [setIsDraggingOver]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (dropRef.current && !dropRef.current.contains(e.relatedTarget as Node)) setIsDraggingOver(false);
  }, [setIsDraggingOver]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setIsDraggingOver(false);
    if (e.dataTransfer.getData("application/dochub-type")) return; // internal drag
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      const name = file.name.replace(/\.[^/.]+$/, "");
      await handleUpload(file, name, "", "other");
    }
  }, [setIsDraggingOver, handleUpload]);

  const showEmpty = !loadingFolderDocs && allFolders.length === 0 && (!docsToShow || docsToShow.length === 0);

  return (
    <div
      ref={dropRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex-1 flex flex-col h-full overflow-hidden relative"
    >
      {isDraggingOver && <DropZoneOverlay />}

      {/* Top bar */}
      <div className={`flex-shrink-0 border-b ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
        <div className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-3">
          <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Documents</h1>
          <div className="relative flex-1 min-w-[180px] max-w-md order-3 sm:order-2 w-full sm:w-auto">
            <svg className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? "text-slate-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search documents…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full text-sm pl-9 pr-3 py-2 rounded-xl border focus:outline-none focus:ring-2 ${
                isDark ? "bg-slate-800/50 border-slate-700 text-white placeholder-slate-500 focus:ring-cyan-500/50" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-blue-500/40"
              }`}
            />
          </div>
          <div className="flex items-center gap-2 ml-auto order-2 sm:order-3">
            <HelpModal />
            <button
              onClick={() => setShowFolderModal(true)}
              className={`hidden sm:flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl transition-colors ${isDark ? "bg-slate-700 text-slate-200 hover:bg-slate-600" : "bg-gray-100 text-gray-800 hover:bg-gray-200"}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
              New folder
            </button>
            <button
              onClick={() => setShowUploadModal(true)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-colors ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Upload</span>
            </button>
          </div>
        </div>
        {/* Breadcrumb only when inside a folder */}
        {!atRoot && (
          <div className="px-4 sm:px-6 pb-3">
            <Breadcrumbs />
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className={`mx-4 sm:mx-6 mt-4 flex items-center gap-3 px-4 py-3 rounded-xl text-sm ${isDark ? "bg-red-500/10 border border-red-500/20 text-red-400" : "bg-red-50 border border-red-200 text-red-600"}`}>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="flex-1">{error}</span>
          <button onClick={() => setError("")} className="text-xs font-medium hover:underline">Dismiss</button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loadingFolderDocs ? (
          <div className="flex items-center justify-center py-20">
            <div className={`w-8 h-8 border-2 border-t-transparent rounded-full animate-spin ${isDark ? "border-cyan-500" : "border-blue-500"}`} />
          </div>
        ) : showEmpty ? (
          <EmptyState section={railSelection} />
        ) : (
          <div className="p-4 sm:p-6">
            {/* Folders */}
            {allFolders.length > 0 && (
              <div className="mb-6">
                <h3 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  {isSearching ? "Matching folders" : "Folders"}
                </h3>
                {viewMode === "grid" ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {allFolders.map(folder => <FolderGridCard key={folder._id} folder={folder} />)}
                  </div>
                ) : (
                  <div className={`rounded-xl border ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
                    {allFolders.map((folder, i) => (
                      <div key={folder._id}>
                        {i > 0 && <div className={`border-t ${isDark ? "border-slate-700/30" : "border-gray-100"}`} />}
                        <FolderListRow folder={folder} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Files */}
            {docsToShow && docsToShow.length > 0 && (
              <div>
                {allFolders.length > 0 && (
                  <h3 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    {isSearching ? "Matching files" : "Files"}
                  </h3>
                )}
                {viewMode === "grid" ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                    {docsToShow.map(doc => <FileGridCard key={doc._id} doc={doc} />)}
                  </div>
                ) : (
                  <div className={`rounded-xl border overflow-hidden ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
                    <ListHeader />
                    {docsToShow.map((doc, i) => (
                      <div key={doc._id}>
                        {i > 0 && <div className={`border-t ${isDark ? "border-slate-700/30" : "border-gray-100"}`} />}
                        <FileListRow doc={doc} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Inline drop-zone hint (desktop only; keeps "store" obvious) */}
            {atRoot && !isSearching && (railSelection === "mine" || railSelection === "recent") && (
              <button
                onClick={() => setShowUploadModal(true)}
                className={`hidden md:flex mt-6 w-full items-center justify-center gap-2 py-6 rounded-xl border-2 border-dashed text-sm transition-colors ${isDark ? "border-slate-700 text-slate-500 hover:border-cyan-500/40 hover:text-cyan-400" : "border-gray-200 text-gray-400 hover:border-blue-400 hover:text-blue-500"}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Drop files here to upload — or click to choose
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck + build**

Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit`
Expected: no errors. (Note: `FolderUploadModal`, `CATEGORIES`, `setViewMode`, `setSelectedCategory`, `isAdmin`, `archivedDocuments` are intentionally no longer used here — they moved to the Manage drawer. Confirm no "unused import" type errors; TS does not error on unused imports by default, but remove any import that becomes unused to keep the file clean — this rewrite already drops them.)
Run: `npm run build`
Expected: build completes. FileBrowser still renders alongside the OLD `DocHubSidebar` (page not yet updated) — the top bar + rail-driven content appears; the old tier sidebar is still to its left until Task 7. That's expected mid-plan.

- [ ] **Step 3: Commit**

```bash
cd /Users/andybarrows/IECentral
git add components/dochub/FileBrowser.tsx
git commit -m "feat(dochub): simplify FileBrowser — clean top bar, rail-driven content, friendly empty states

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: New mobile navigation (`MobileNav`)

**Files:**
- Create: `components/dochub/MobileNav.tsx`
- Modify: `components/dochub/index.ts`

**Interfaces:**
- Consumes from context: `isDark`, `isAdmin`, `railSelection`, `setRailSelection`, `navigateToRoot`, `currentFolderId`, `setShowUploadModal`, `setShowManageDrawer`.
- Produces: default export `MobileNav` — a segmented section selector shown below `md`, plus a floating Upload button.

- [ ] **Step 1: Create `components/dochub/MobileNav.tsx`**

```tsx
"use client";

import { useDocHub } from "./DocHubContext";
import type { RailSelection } from "./types";

const ITEMS: { key: RailSelection; label: string }[] = [
  { key: "mine", label: "Mine" },
  { key: "shared", label: "Shared" },
  { key: "company", label: "Company" },
  { key: "recent", label: "Recent" },
];

export default function MobileNav() {
  const { isDark, isAdmin, railSelection, setRailSelection, navigateToRoot, setShowUploadModal, setShowManageDrawer } = useDocHub();

  return (
    <>
      {/* Section selector — horizontal scroll, below md only */}
      <div className={`md:hidden flex-shrink-0 border-b overflow-x-auto ${isDark ? "border-slate-700/50 bg-slate-900/40" : "border-gray-200 bg-gray-50/60"}`}>
        <div className="flex items-center gap-1 px-3 py-2 min-w-max">
          {ITEMS.map(item => {
            const active = railSelection === item.key;
            return (
              <button
                key={item.key}
                onClick={() => { navigateToRoot(); setRailSelection(item.key); }}
                className={`px-3 py-1.5 text-sm font-medium rounded-full whitespace-nowrap transition-colors ${
                  active
                    ? isDark ? "bg-cyan-500 text-white" : "bg-blue-600 text-white"
                    : isDark ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {item.label}
              </button>
            );
          })}
          {isAdmin && (
            <button
              onClick={() => setShowManageDrawer(true)}
              className={`px-3 py-1.5 text-sm font-medium rounded-full whitespace-nowrap transition-colors ml-1 ${isDark ? "text-slate-400 hover:bg-slate-800" : "text-gray-500 hover:bg-gray-100"}`}
            >
              Manage
            </button>
          )}
        </div>
      </div>

      {/* Floating Upload button — below md only */}
      <button
        onClick={() => setShowUploadModal(true)}
        className={`md:hidden fixed bottom-5 right-5 z-30 w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-colors ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
        aria-label="Upload document"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </>
  );
}
```

- [ ] **Step 2: Export it from the barrel**

In `components/dochub/index.ts`, add:

```typescript
export { default as MobileNav } from "./MobileNav";
```

- [ ] **Step 3: Verify typecheck + build**

Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: build completes.

- [ ] **Step 4: Commit**

```bash
cd /Users/andybarrows/IECentral
git add components/dochub/MobileNav.tsx components/dochub/index.ts
git commit -m "feat(dochub): mobile section selector + floating upload FAB

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Re-label ShareAccessModal to plain "Who can see this?" language

**Files:**
- Modify: `components/dochub/ShareAccessModal.tsx`

**Interfaces:**
- No signature changes. Only user-facing copy and the folder-visibility control's labels change. All mutation calls, group logic, and access-grant logic stay exactly as-is.

Goal: remove tier/team jargon from the folder-share panel. The three visibility buttons become **Only me** / **Everyone at the company** / **Specific people or groups**, mapping to `private` / `community` / `internal` respectively (unchanged values). The panel title becomes "Who can see this?".

- [ ] **Step 1: Rename the folder panel heading**

In `components/dochub/ShareAccessModal.tsx`, find (around line 106):

```tsx
              <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Manage Access</h2>
```

Replace with:

```tsx
              <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Who can see this?</h2>
```

- [ ] **Step 2: Rename the visibility section label**

Find (around line 121-123):

```tsx
              <label className={`block text-xs font-medium mb-2 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                Folder Visibility {savingVisibility && <span className="ml-1 opacity-60">Saving...</span>}
              </label>
```

Replace with:

```tsx
              <label className={`block text-xs font-medium mb-2 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                Who can see this folder? {savingVisibility && <span className="ml-1 opacity-60">Saving…</span>}
              </label>
```

- [ ] **Step 3: Relabel the three visibility buttons**

The three buttons currently read `Private`, `Team`, `Everyone` (button label text on lines ~136, ~149, ~162). Change ONLY the visible text inside each button (leave every className, onClick, and the `handleVisibilityChange("private"|"internal"|"community")` calls unchanged):

- The `private` button text `Private` → `Only me`
- The `internal` button text `Team` → `Specific people`
- The `community` button text `Everyone` → `Everyone`

Concretely, change the line that reads `                  Private` (after its closing `</svg>`, ~line 136) to `                  Only me`, and the line `                  Team` (~line 149) to `                  Specific people`. Leave `                  Everyone` as-is.

- [ ] **Step 4: Rewrite the helper caption under the buttons**

Find (around lines 165-169):

```tsx
              <p className={`text-xs mt-1.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                {folderVisibility === "private" && "Only you can see this folder. Share with specific people below."}
                {folderVisibility === "internal" && "All team members can see this folder."}
                {folderVisibility === "community" && "Everyone in the organization can see this folder."}
              </p>
```

Replace with:

```tsx
              <p className={`text-xs mt-1.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                {folderVisibility === "private" && "Only you can see this folder. Add specific people or groups below to share it."}
                {folderVisibility === "internal" && "Only the specific people and groups you choose below can see this folder."}
                {folderVisibility === "community" && "Everyone at the company can see this folder."}
              </p>
```

- [ ] **Step 5: Soften the document-share modal public-link copy**

Find (around line 541):

```tsx
                  {doc.isPublic ? "Anyone with the link can view" : "Only team members can access"}
```

Replace with:

```tsx
                  {doc.isPublic ? "Anyone with the link can view" : "Only people at the company can access"}
```

- [ ] **Step 6: Verify typecheck + build**

Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: build completes.

- [ ] **Step 7: Commit**

```bash
cd /Users/andybarrows/IECentral
git add components/dochub/ShareAccessModal.tsx
git commit -m "feat(dochub): plain-language sharing — 'Who can see this?' (Only me / Specific people / Everyone)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Wire the new layout into the Documents page

**Files:**
- Modify: `app/documents/page.tsx`
- Delete: `components/dochub/DocHubSidebar.tsx`
- Modify: `components/dochub/index.ts`

**Interfaces:**
- Consumes: `DocHubRail`, `MobileNav`, `ManageDrawer` (Tasks 2/5/3), plus existing `FileBrowser`, `ContextMenu`, `PreviewModal`, `UploadModal`, `FolderModal`, `ShareAccessModal`, `GroupsModal`.

- [ ] **Step 1: Update the imports and layout in `app/documents/page.tsx`**

Replace the import block (lines 7-17) with:

```tsx
import {
  DocHubProvider,
  DocHubRail,
  MobileNav,
  FileBrowser,
  ContextMenu,
  PreviewModal,
  UploadModal,
  FolderModal,
  ShareAccessModal,
  GroupsModal,
  ManageDrawer,
} from "@/components/dochub";
```

Then replace the layout body (lines 45-62, the `<DocHubProvider> … </DocHubProvider>` block) with:

```tsx
        <DocHubProvider>
          <DocDeepLink />
          <MobileNav />
          <div className="flex-1 flex overflow-hidden">
            {/* Plain-language rail (desktop) */}
            <DocHubRail />

            {/* File Browser — top bar, rail-driven content, cards */}
            <FileBrowser />
          </div>

          {/* Modals & Overlays */}
          <ContextMenu />
          <PreviewModal />
          <UploadModal />
          <FolderModal />
          <ShareAccessModal />
          <GroupsModal />
          <ManageDrawer />
        </DocHubProvider>
```

- [ ] **Step 2: Remove the old sidebar export and delete the file**

In `components/dochub/index.ts`, delete the line that exports `DocHubSidebar` (e.g. `export { default as DocHubSidebar } from "./DocHubSidebar";`).

Then delete the file:

```bash
cd /Users/andybarrows/IECentral
git rm components/dochub/DocHubSidebar.tsx
```

- [ ] **Step 3: Confirm no remaining references to the old sidebar**

Run: `cd /Users/andybarrows/IECentral && grep -rn "DocHubSidebar" --include="*.ts" --include="*.tsx" .`
Expected: no matches. If any remain, remove them.

- [ ] **Step 4: Verify typecheck + build**

Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: build completes.

- [ ] **Step 5: Manual verification (desktop)**

Run: `cd /Users/andybarrows/IECentral && npm run dev` and open `http://localhost:3000/documents`.
Verify:
- Left rail shows **My Documents / Shared with me / Company / Recent**; no Public/Internal/Confidential/HIPAA sections anywhere.
- Clicking each rail item swaps the content set; opening a folder shows a breadcrumb; the rail selection persists.
- Top bar has **Search**, **New folder**, **Upload**; Upload and drag-drop both add documents.
- Clicking **Share** on a folder shows the "Who can see this?" panel with **Only me / Specific people / Everyone**.
- **Manage** appears in the rail only for admin/super_admin, and the drawer exposes storage, expiring/needs-signature counts, view toggle, category filter, Manage groups, and Show archived.
- Sign in mentally as a non-admin (or temporarily check with a member account): no Manage entry, no advanced controls.

- [ ] **Step 6: Manual verification (mobile)**

In the browser devtools device toolbar, test at 375px, 390px, and 768px:
- No permanent left rail; a horizontal section selector (Mine/Shared/Company/Recent, + Manage for admins) sits under the header.
- A floating round Upload button is bottom-right and opens the upload modal.
- Folder and file cards are single-column; the page does not scroll horizontally at any width.

- [ ] **Step 7: Commit**

```bash
cd /Users/andybarrows/IECentral
git add app/documents/page.tsx components/dochub/index.ts
git commit -m "feat(dochub): wire new rail + mobile nav + manage drawer; retire tier sidebar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Layout & first impression → Tasks 4 (top bar) + 7 (single-rail layout). ✓
- Plain-language nav (My Documents/Shared/Company/Recent), tiers hidden → Tasks 1, 2, 4, 7. ✓
- Storing obvious (Upload button + drop-zone + FAB) → Tasks 4 (button + inline drop-zone + drag), 5 (FAB). ✓
- Sharing obvious ("Who can see this?", Only me/Everyone/Specific people/groups) → Task 6. ✓
- Advanced/admin in Manage (storage, expiring, unsigned, categories, view toggle, groups, archived, precise privacy note) → Task 3. ✓ (Precise per-folder privacy stays in the Share panel, noted in the drawer caption — matches spec §5.)
- Mobile first-class (dropdown/segmented nav, FAB, single-column, no h-scroll) → Tasks 4 (responsive top bar/grids), 5, 7 (verification). ✓
- Empty states → Task 4 `EmptyState`. ✓
- Reuse data layer, no backend changes → Global Constraints; all tasks touch only `components/dochub/*` + `app/documents/page.tsx`. ✓
- Starred omitted from v1 → not built (spec decision). ✓
- Manage as drawer → Task 3. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code or exact string replacements. ✓

**Type consistency:** `RailSelection = "mine" | "shared" | "company" | "recent"` defined in `types.ts` (Task 1) and consumed identically in `DocHubContext`, `DocHubRail`, `MobileNav`, `FileBrowser`. `recentDocuments: DocumentType[] | undefined` produced in Task 1, consumed in Task 4. `showManageDrawer`/`setShowManageDrawer` produced in Task 1, consumed in Tasks 2/3/5. Existing context field names (`filteredDocuments`, `myFolders`, `communityFolders`, `sharedFoldersWithMe`, `setShowFolderModal`, `setShowUploadModal`, `folderSearchResults`, `navigateToRoot`, etc.) verified against the current `DocHubContext.tsx`. ✓

**Note on index.ts sequencing:** Task 2 Step 2 intentionally adds only the `DocHubRail` export (not all three) so each intermediate build stays green; `ManageDrawer` and `MobileNav` exports are added in their own tasks (3 and 5).

---

## Access-control hardening (decoupled scope — added 2026-07-01)

Decision: **full `ctx.auth` wiring is a separate project** (IECentral has no auth provider; identity is a client-supplied `requestingUserId` arg). Tasks 8–10 below close the **practical, high-value Doc Hub gaps** using the app's existing `requestingUserId` trust model — consistent with how mutations are already guarded (`convex/authGuards.ts`). They do NOT attempt server-derived identity.

**Constraints for these tasks:**
- Use the existing helpers from `convex/authGuards.ts` (verified signatures): `requireAdmin(ctx, requestingUserId)`, `requireManagePersonnel(ctx, requestingUserId)`, `requireMinTier(ctx, requestingUserId, minTier)`, `requireSelfOrManager(ctx, requestingUserId, ownerUserId)`. Import them at the top of the Convex file (other functions in these files already import from `./authGuards`).
- When a query gains a required `requestingUserId`, every caller in `components/dochub/DocHubContext.tsx` must pass it and use `user ? {…, requestingUserId: user._id} : "skip"` so it never fires without a user.
- **Explicitly deferred to the ctx.auth project (do NOT attempt here):** folder mutation guards (`create`/`update`/`archive`/`grantAccess`/`revokeAccess`/`setPassword`/`moveDocument`/`moveFolder`), the `getAll`/`search` untrusted-`userId` residual, and the `/api/documents/file` proxy route. These are recorded in `docs/iecentral/SECURITY-FINDINGS.md` as remaining Doc Hub items (Task 10 Step 5).

---

### Task 8: Guard the unguarded Doc Hub read queries

**Files:**
- Modify: `convex/documents.ts` (`getArchived`, `getExpiring`, `getStorageUsage`)
- Modify: `convex/documentFolders.ts` (`getById`, `getUsersForSharing`)
- Modify: `components/dochub/DocHubContext.tsx` (update the callers)

**Interfaces:**
- `getArchived`, `getExpiring`, `getStorageUsage` gain `requestingUserId: v.id("users")` and require manager+.
- `getUsersForSharing` gains `requestingUserId: v.id("users")` and requires an active user (min tier 0).
- `getById` return value no longer includes `passwordHash`.

- [ ] **Step 1: Strip `passwordHash` from `getById` (documentFolders.ts)**

Current return:
```typescript
    return {
      ...folder,
      documentCount: docs.length,
      isProtected: !!folder.passwordHash,
    };
```
Replace with (destructure the hash out so it is never sent to the client):
```typescript
    const { passwordHash, ...safeFolder } = folder;
    return {
      ...safeFolder,
      documentCount: docs.length,
      isProtected: !!passwordHash,
    };
```

- [ ] **Step 2: Guard `getArchived`, `getExpiring`, `getStorageUsage` (documents.ts)**

At the top of `convex/documents.ts`, ensure `requireManagePersonnel` is imported from `./authGuards` (add it to the existing authGuards import).

`getArchived` — add the arg + guard:
```typescript
export const getArchived = query({
  args: { requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    return await ctx.db
      .query("documents")
      .withIndex("by_active", (q) => q.eq("isActive", false))
      .order("desc")
      .collect();
  },
});
```

`getExpiring` — add `requestingUserId`, keep `days`:
```typescript
export const getExpiring = query({
  args: { days: v.optional(v.number()), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const days = args.days ?? 30;
    const now = Date.now();
    const futureLimit = now + days * 24 * 60 * 60 * 1000;
    const documents = await ctx.db
      .query("documents")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();
    return documents.filter((doc) => {
      if (!doc.expiresAt) return false;
      return doc.expiresAt <= futureLimit;
    });
  },
});
```

`getStorageUsage`:
```typescript
export const getStorageUsage = query({
  args: { requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();
    let totalBytes = 0;
    for (const d of docs) totalBytes += d.fileSize || 0;
    return { totalBytes, count: docs.length };
  },
});
```

- [ ] **Step 3: Guard `getUsersForSharing` (documentFolders.ts)**

At the top of `convex/documentFolders.ts`, ensure `requireMinTier` is imported from `./authGuards`.
```typescript
export const getUsersForSharing = query({
  args: { requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireMinTier(ctx, args.requestingUserId, 0); // must be a real, active user
    const users = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
    return users.map((u) => ({ _id: u._id, name: u.name, email: u.email, role: u.role }));
  },
});
```

- [ ] **Step 4: Update the callers in `DocHubContext.tsx`**

`getExpiring`, `getStorageUsage`, `getArchived`, `getUsersForSharing` are queried in the provider. Change them so they only fire for the right users and pass `requestingUserId`:

```typescript
  const documents = useQuery(api.documents.getAll, user ? { rootOnly: true, userId: user._id } : "skip") as DocumentType[] | undefined;
  const archivedDocuments = useQuery(api.documents.getArchived, isAdmin && user ? { requestingUserId: user._id } : "skip") as DocumentType[] | undefined;
  const expiringDocuments = useQuery(api.documents.getExpiring, isAdmin && user ? { days: 90, requestingUserId: user._id } : "skip");
  const storageUsage = useQuery(api.documents.getStorageUsage, isAdmin && user ? { requestingUserId: user._id } : "skip");
```
and
```typescript
  const usersForSharing = useQuery(api.documentFolders.getUsersForSharing, user ? { requestingUserId: user._id } : "skip");
```
(`isAdmin` is already computed in the provider. `archived`/`expiring`/`storage` feed the admins-only Manage drawer, so gating them to `isAdmin` is correct and prevents the manager guard from throwing for non-admins.)

- [ ] **Step 5: Verify typecheck + build**

Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit`
Expected: no errors. (If `requireManagePersonnel`/`requireMinTier` were already imported, don't duplicate the import.)
Run: `npm run build`
Expected: build completes.

- [ ] **Step 6: Commit**

```bash
cd /Users/andybarrows/IECentral
git add convex/documents.ts convex/documentFolders.ts components/dochub/DocHubContext.tsx
git commit -m "fix(dochub/security): guard archived/expiring/storage/user-directory reads; stop leaking folder passwordHash

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Secure `getFileDownloadUrl` with an access check

**Files:**
- Modify: `convex/documents.ts` (`getFileDownloadUrl` action)
- Modify: `components/dochub/DocHubContext.tsx` (the `getFileDownloadUrl` caller in `handleDownload`)

**Interfaces:**
- `getFileDownloadUrl` gains `requestingUserId: v.id("users")` and returns `null` when the caller isn't allowed to see the document.

Problem: today any logged-in caller who knows a `documentId` gets a signed URL, with zero checks. The fix must add an access check that **mirrors the existing visibility rules already implemented in `getAll` (convex/documents.ts, the block that filters by `visibility`/`isPublic`/owner/`sharedWith`/`sharedWithGroups`)** and the folder-access rules in `getProtectedDocuments`/`grantAccess` — so legitimate downloads (owner, community/internal docs, docs shared to the user directly or via a group, docs in folders shared to the user) still work, and only genuinely-unauthorized calls return null.

- [ ] **Step 1: Read the source-of-truth access rules**

Before writing code, read these in `convex/documents.ts` and `convex/documentFolders.ts`:
- `getAll`'s visibility filter (how it decides a doc is visible to a `userId`: owner, `isPublic`, `visibility === "community"`, `visibility === "internal"`, `sharedWith` includes the user, `sharedWithGroups` intersects the user's groups).
- `getProtectedDocuments`'s folder-access logic (owner / `folderAccessGrants` / `sharedWithGroups` / correct password).

- [ ] **Step 2: Add an `internalQuery` that returns whether a user may download a document**

Add to `convex/documents.ts` (use `internalQuery` from `./_generated/server` — it's already used elsewhere in the file for the preview cache; import it if not present):

```typescript
export const canUserDownload = internalQuery({
  args: { documentId: v.id("documents"), userId: v.id("users") },
  handler: async (ctx, args): Promise<boolean> => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc || !doc.isActive) return false;
    const user = await ctx.db.get(args.userId);
    if (!user || user.isActive === false) return false;

    // Owner or public/company-wide docs.
    if (doc.uploadedBy === args.userId) return true;
    if (doc.isPublic) return true;
    if (doc.visibility === "community" || doc.visibility === "internal") return true;

    // Directly shared with this user.
    if ((doc.sharedWith ?? []).some((id) => id === args.userId)) return true;

    // Shared with a group this user belongs to.
    const groupIds = (doc.sharedWithGroups ?? []) as Id<"groups">[];
    if (groupIds.length) {
      for (const gid of groupIds) {
        const group = await ctx.db.get(gid);
        if (group && (group.memberIds ?? []).some((m: Id<"users">) => m === args.userId)) return true;
      }
    }

    // Doc lives in a folder the user can reach (owner, grant, community/internal, or group-shared).
    if (doc.folderId) {
      const folder = await ctx.db.get(doc.folderId);
      if (folder) {
        if (folder.createdBy === args.userId) return true;
        if (folder.visibility === "community" || folder.visibility === "internal") return true;
        const fGroups = (folder.sharedWithGroups ?? []) as Id<"groups">[];
        for (const gid of fGroups) {
          const group = await ctx.db.get(gid);
          if (group && (group.memberIds ?? []).some((m: Id<"users">) => m === args.userId)) return true;
        }
        const grants = await ctx.db
          .query("folderAccessGrants")
          .withIndex("by_folder", (q) => q.eq("folderId", folder._id))
          .collect();
        if (grants.some((g) => g.grantedToUserId === args.userId && !g.isRevoked)) return true;
      }
    }
    return false;
  },
});
```

NOTE for the implementer: verify the real field names against the schema/`getAll` while writing this — `doc.sharedWith`, `doc.sharedWithGroups`, `group.memberIds`, `folder.sharedWithGroups`, `folderAccessGrants` index `by_folder`, and `grant.isRevoked`/`grant.grantedToUserId` are used elsewhere in these two files; match them exactly. If `getAll` uses a different mechanism for any rule, mirror `getAll`.

- [ ] **Step 3: Gate the action on it**

```typescript
export const getFileDownloadUrl = action({
  args: { documentId: v.id("documents"), requestingUserId: v.id("users") },
  handler: async (ctx, args): Promise<string | null> => {
    const allowed = await ctx.runQuery(internal.documents.canUserDownload, {
      documentId: args.documentId,
      userId: args.requestingUserId,
    });
    if (!allowed) return null;
    const doc = await ctx.runQuery(api.documents.getById, { documentId: args.documentId });
    if (!doc || !doc.fileId) return null;
    try {
      return await ctx.storage.getUrl(doc.fileId);
    } catch {
      return null;
    }
  },
});
```
Ensure `internal` is imported (`import { api, internal } from "./_generated/api";` — the file already imports `api`; add `internal` if missing).

- [ ] **Step 4: Update the caller in `DocHubContext.tsx`**

In `handleDownload`, the call `await getFileDownloadUrl({ documentId: doc._id })` becomes:
```typescript
      if (!user) return;
      const url = await getFileDownloadUrl({ documentId: doc._id, requestingUserId: user._id });
```
(There is already a `user` in scope via the provider; guard with `if (!user) return;` at the top of `handleDownload` if not already present, and add `user` to its `useCallback` deps.)

- [ ] **Step 5: Verify typecheck + build**

Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: build completes.

- [ ] **Step 6: Commit**

```bash
cd /Users/andybarrows/IECentral
git add convex/documents.ts components/dochub/DocHubContext.tsx
git commit -m "fix(dochub/security): access-check getFileDownloadUrl (owner/visibility/share/group/folder)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Doc Hub route guard, hidden-by-default staff access, and key unification

**Files:**
- Modify: `app/documents/page.tsx` (route guard)
- Modify: `lib/permissions.ts` (unify the Doc Hub permission key; add to `ALL_PERMISSIONS` if needed)
- Modify: `components/Sidebar.tsx` (employee-section grant key, if it uses the old key)
- Modify: `docs/iecentral/SECURITY-FINDINGS.md` (log deferred items)

**Interfaces:** No new exported functions. Behavior: a user who lacks Doc Hub permission is redirected away from `/documents`; the employee-grant key and the T1+ menu key are the same key end-to-end.

- [ ] **Step 1: Understand the current key split**

Read in `lib/permissions.ts`: `GRANTABLE_EMPLOYEE_MODULES` (uses `menu.documents`), `getMenuPermissions` (produces `docHub`, i.e. `menu.docHub`), `ALL_PERMISSIONS` (has `menu.docHub`, not `menu.documents`), and `resolvePermission`. Read `lib/usePermissions.ts` to see the shape the client consumes (`permissions.menu.docHub`). Read the employee-nav filter in `components/Sidebar.tsx` (around line 417-422) which filters on `permissionOverrides["menu.documents"] === true`.

Decision (already made): **unify on `menu.docHub`.** The employee grant, the sidebar link (both employee and T1+), the permission editor list, and the route guard all use `menu.docHub`.

- [ ] **Step 2: Unify the key in `lib/permissions.ts`**

- In `GRANTABLE_EMPLOYEE_MODULES`, change the Doc Hub entry's `permKey` from `"menu.documents"` to `"menu.docHub"` (leave its `label`/`href`).
- Confirm `menu.docHub` exists in `ALL_PERMISSIONS` (it does — keep it). Remove any now-dead `menu.documents` reference if present.
- Leave `getMenuPermissions`' `docHub: tier >= 2 || isRetailAssociate` default as-is (that is the default access; per-person grants come via `permissionOverrides["menu.docHub"]`).

- [ ] **Step 3: Fix the employee-nav grant key in `components/Sidebar.tsx`**

In the employee (T0) nav section (around line 417-422), the Doc Hub module entry's `permKey` (currently `"menu.documents"`) must become `"menu.docHub"` so a granted employee's override key matches the unified key. Change only that key string.

- [ ] **Step 4: Add the route guard on `/documents`**

In `app/documents/page.tsx`, add a permission gate so a user without Doc Hub access can't reach the page by URL. Use the existing client permission hook the same way the sidebar does. Concretely, add an inner guard component:

```tsx
import { usePermissions } from "@/lib/usePermissions";
import { useRouter } from "next/navigation";
```
and gate `DocumentsContent` (or wrap its body) so that once permissions have loaded, if `!permissions.menu.docHub` it redirects to `/`:

```tsx
function DocHubGate({ children }: { children: React.ReactNode }) {
  const permissions = usePermissions();
  const router = useRouter();
  useEffect(() => {
    if (!permissions.isLoading && !permissions.menu.docHub) router.push("/");
  }, [permissions.isLoading, permissions.menu.docHub, router]);
  if (permissions.isLoading) return null;
  if (!permissions.menu.docHub) return null;
  return <>{children}</>;
}
```
Wrap the Doc Hub content with `<DocHubGate>` inside the existing `<Protected>` (Protected still handles the not-logged-in case). Verify the exact shape of `usePermissions()` (`.isLoading`, `.menu.docHub`) against `lib/usePermissions.ts` and adjust property access to match.

- [ ] **Step 5: Log the deferred access-control items**

Append a dated section to `docs/iecentral/SECURITY-FINDINGS.md` (create the file if missing) listing the items explicitly deferred to the ctx.auth project: folder mutations unguarded (`create`/`update`/`archive`/`grantAccess`/`revokeAccess`/`setPassword`/`removePassword`/`moveDocument`/`moveFolder`); `getAll`/`search` accept an untrusted `userId`; the `/api/documents/file` proxy route serves any document id without an access check; and the systemic root cause (no `ctx.auth`; client-supplied `requestingUserId`). One line each.

- [ ] **Step 6: Verify typecheck + build**

Run: `cd /Users/andybarrows/IECentral && npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: build completes.

- [ ] **Step 7: Commit**

```bash
cd /Users/andybarrows/IECentral
git add app/documents/page.tsx lib/permissions.ts components/Sidebar.tsx docs/iecentral/SECURITY-FINDINGS.md
git commit -m "feat(dochub): route guard + unify menu.docHub key; log deferred backend auth gaps

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review addendum (Tasks 8–10)

- **Fix depth honored:** Tasks 8–9 close the read-side leaks (download URL, archived/expiring/storage, user directory, passwordHash) via the existing `requestingUserId` model; Task 10 adds the route guard + hidden-by-default staff + key unification. Full `ctx.auth` is explicitly a separate project; deferred items logged (Task 10 Step 5). ✓
- **Manage stays role-based admin** (no new `documents.manage` key) — per decision. ✓
- **Caller consistency:** every query that gained `requestingUserId` has its `DocHubContext.tsx` caller updated with `"skip"` guards (Task 8 Step 4, Task 9 Step 4). ✓
- **Type consistency:** helper signatures copied verbatim from `convex/authGuards.ts`. `internalQuery`/`internal` usage flagged for import verification. Field names in Task 9 flagged for schema verification against `getAll`. ✓
