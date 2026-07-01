# Doc Hub UI Redesign — Design Spec

**Date:** 2026-07-01
**Owner:** Andy Barrows
**Status:** Approved direction — pending spec review

## Goal

Rebuild the Doc Hub user experience so a non-technical office-staff member can, with no training, do two things obviously: **store a document** and **share a document**. Doc Hub is the focal point of an upcoming staff presentation, so the first impression must be calm, plain-language, and uncluttered — while every existing capability remains available to admins.

## Problem (what feels "complicated" today)

Confirmed by Andy, all four are in scope:

1. **Privacy-tier jargon front-and-center.** The folder sidebar groups everything under **Public / Internal / Confidential / HIPAA** section headers (`PRIVACY_TIERS` in `components/dochub/types.ts`). This is legal/IT vocabulary that intimidates office staff and is the first thing they see.
2. **Too many competing controls.** Grid/list toggle, category filter pills, a storage meter, "Expiring Soon" and "Unsigned" sections, breadcrumbs — all on the main surface, crowding out the basics.
3. **Store/share not obvious.** Upload exists but competes with chrome; sharing is expressed as "visibility tiers," not "who can see this."
4. **Dense two-sidebar layout.** App nav + Doc Hub tier sidebar side-by-side reads as heavy on arrival.

## Non-goals

- **No data-layer rewrite.** We keep the Convex schema, queries, mutations, upload flow, previews, thumbnails, folder/group sharing, and the privacy/visibility model exactly as they are. The tiers still govern access under the hood — we only stop *showing* the jargon.
- No new permissions model. No changes to who-can-see-what rules.
- No removal of any existing capability. Everything advanced moves to an admins-only area; nothing is deleted.

## Approach

Ground-up redesign of the **presentation layer** (what staff see and touch), reusing the proven data layer. Rationale: the existing context already exposes the exact queries the new plain-language navigation needs — `getMyFolders` → **My Documents**, `getSharedFolders` → **Shared with me**, `getCommunityFolders` → **Company**. The redesign is therefore a re-skin + re-flow of the components, not a rebuild of the engine, which avoids re-introducing the bugs we fixed this cycle (group sharing, blank previews, CSP).

## Design

### 1. Layout & first impression

A single calm workspace (the app's global nav stays as-is; we remove the *second*, Doc-Hub-specific dense sidebar and replace it with a minimal rail):

- **Top bar:** page title "Documents", a wide **Search** field, and the two everyday actions pinned top-right: **Upload** (primary, filled `--accent-primary` #007AFF) and **New folder** (secondary).
- **Left rail:** a short, plain-language list (see §2). Collapses to a dropdown on mobile.
- **Content:** breadcrumb (only when inside a folder), a "Folders" section (folder cards), then a "Files" section (file cards with thumbnails), and an always-present drop-zone in the files area.
- Visual language follows the established iOS admin aesthetic: system font, grouped white cards on `--bg` gray, generous whitespace, `components/ui/` primitives (Card/Button) and `.ui-*` classes. Honors light/dark and existing theme variables.

### 2. Plain-language navigation (replaces tier sections)

The rail shows plain destinations, not privacy tiers:

| Rail item | Backed by (existing query) |
|---|---|
| **My Documents** | `documentFolders.getMyFolders` + `documents.getAll` (root, user's own) |
| **Shared with me** | `documentFolders.getSharedFolders` |
| **Company** | `documentFolders.getCommunityFolders` |
| **Recent** | `documents.getAll` sorted by recency (client-side; no new query) |
| **Starred** | *Deferred* — see Open Questions. Omitted from v1 unless a `starred` flag already exists. |

`PRIVACY_TIERS` labels/sections disappear from the sidebar. The tier a folder belongs to becomes a quiet property surfaced only in the Share panel (§4) and, for admins, in the Manage area (§5).

### 3. Storing (upload) made obvious

Two always-available paths so a first-timer cannot miss it:
- The **Upload** button in the top bar (opens the existing `UploadModal`).
- A **drop-zone** rendered in the files area of the content pane ("Drop files here to upload — or click Upload above"), wired to the existing `handleUpload`. The current full-pane drag-over highlight is preserved.

Uploads land in the folder the user is currently viewing (existing `currentFolderId` behavior). No change to the upload mechanics, categorization, or storage.

### 4. Sharing made obvious

- Every file and folder card shows a clear **Share** affordance.
- Share opens a simplified panel titled **"Who can see this?"** with three plain choices that map onto the existing visibility model:
  - **Only me** → `visibility: "private"`
  - **Everyone at the company** → `visibility: "community"`
  - **Specific people or groups** → `visibility: "internal"` + the existing people/group picker (reuses `ShareAccessModal` internals: `usersForSharing`, groups, folder access grants).
- The words "tier", "HIPAA", "confidential" do not appear in the staff-facing panel. (Admins can still set the precise tier from Manage.)
- This is a re-label + re-group of the existing `ShareAccessModal`, not new sharing logic.

### 5. Advanced / admin — the "Manage" area

Everything technical still exists but moves behind a **Manage** entry at the bottom of the rail, visible only when `isAdmin` (`admin` or `super_admin`). Manage contains:

- Storage meter (`getStorageUsage`)
- Expiring Soon (`getExpiring`) and Unsigned (`documentSignatures.getUnsignedForUser`)
- Category filters and grid/list view toggle
- Group management (existing `GroupsModal`)
- Password-protected folders and precise privacy-tier controls
- Archived documents (`getArchived`) / restore

Staff never see these. Admins lose nothing — same powers, one click away.

### 6. Mobile (first-class requirement)

- Left rail collapses into a **top dropdown/segmented selector** (My Documents / Shared with me / Company); no permanent sidebar on small screens.
- **Upload** remains reachable as a floating action button (bottom-right) in addition to the top bar.
- Folder and file cards go **single-column**; thumbnails scale to full card width.
- Top bar wraps: title on row one, full-width search on row two, actions accessible via the FAB and an overflow.
- Drop-zone hidden on touch (tap-to-upload only); category pills already `hidden md:flex`.
- Verified at 375px (iPhone SE), 390px, and 768px breakpoints. No horizontal scroll at any width.

## Component architecture

Reuse `DocHubContext` (all queries/mutations/state) unchanged as the data source. Rebuild the presentation components:

- **`DocHubSidebar.tsx`** → rewritten as the plain-language rail (`My Documents / Shared with me / Company / Recent`, plus admins-only `Manage`). Tier-section rendering removed. A `railSelection` state drives which folder set the content pane shows.
- **`FileBrowser.tsx`** → simplified content pane: breadcrumb (in-folder only), Folders grid, Files grid, drop-zone. Category pills + grid/list toggle removed from the default surface (relocated to Manage). Reads the active rail selection.
- **`ShareAccessModal.tsx`** → re-labeled to the "Who can see this?" three-choice panel; existing people/group logic retained; admin-only precise-tier control gated behind `isAdmin`.
- **New `ManageDrawer.tsx`** (admins only) → houses storage, expiring, unsigned, categories/view, groups, archived, precise tiers. Opened from the rail's Manage entry.
- **New `MobileNav.tsx`** → the top dropdown/segmented selector + FAB for small screens.
- **`DocHubContext.tsx`** → add `railSelection` state (`"mine" | "shared" | "company" | "recent"`) + setter; no query changes.
- Untouched: `UploadModal`, `PreviewModal`, `FileCard`, `Breadcrumbs`, `FolderModal`, `GroupsModal` (now opened from Manage), `HelpModal`, all of `convex/`.

Each component keeps one clear responsibility; the rail decides *what set* to show, the content pane decides *how* to show it, modals own their single task.

## Error handling & edge cases

- **Empty states** (important for the presentation): each rail destination shows a friendly empty state with the primary action — e.g. My Documents empty → "No documents yet. Click Upload to add your first one." with the drop-zone visible. Shared with me empty → "Nothing's been shared with you yet."
- **Loading:** existing `undefined` query states render skeleton cards, not layout jumps.
- **Permission:** non-admins never receive the Manage entry (client gate); server guards already enforce group/folder mutations (`requireAdmin`).
- **Upload failure:** preserve current behavior (existing "Connection lost" surface); no regression.

## Testing / verification

No component test runner exists in this repo. Gate is `npx tsc --noEmit` + `npm run build`, plus manual verification:

1. `tsc` and `build` clean.
2. Desktop: each rail destination lists the correct folders/files; Upload (button + drop-zone) works; Share panel sets the right visibility; Manage visible only to admins and exposes every relocated feature.
3. Mobile (375 / 390 / 768): dropdown nav switches sets; FAB uploads; single-column cards; no horizontal scroll.
4. Regression: previews, thumbnails, group sharing, and expiring/unsigned (in Manage) still function.

## Open questions

- **Starred:** no evidence of a `starred` flag today. v1 **omits** Starred from the rail; add later if desired. (Recent is derivable client-side and stays.)
- **Manage as drawer vs. dedicated route:** spec assumes a right-side **drawer** (`ManageDrawer.tsx`) to keep staff and admins on one page. Flag if a separate `/documents/manage` route is preferred.

## Rollout

Single PR merged to `main` (per the repo's deploy model — Vercel builds Convex + Next from `origin/main`; Preview deploys can't build without the deploy key). `tsc` + `build` must pass before push.
