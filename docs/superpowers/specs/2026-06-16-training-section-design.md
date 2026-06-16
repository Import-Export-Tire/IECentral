# Training Section (TIA Videos) — Design

**Date:** 2026-06-16
**Status:** Approved, pending implementation

## Problem

The company purchased licensed TIA (Tire Industry Association) training videos (on a
branded USB drive). They want to host them in IECentral, organized into segments, and
present them to a room via a **projector**. Access must be **authorized-only** (specific
presenters/managers, not by role tier). Training completion should be recorded per
employee where possible — but **retail employees are frequently not yet in IECentral**,
so completion tracking must not require everyone to already have a personnel record.

## Decisions (confirmed)

- **Structure:** Segments, each holding one or more videos (a segment = a TIA module).
- **Access:** Authorized presenters only — an **override-only** permission, granted per user.
- **Completion:** A **Training Session** log with attendees added two ways — selected
  personnel (which also writes to their training record) **and** free-typed names for
  people not yet in the system.
- **Storage:** Video files in **S3** (existing `ietires-dunlop-jmk-uploads` bucket, `training/`
  prefix), uploaded browser→S3 via presigned PUT, played via presigned GET. Not Convex storage.

## Architectural Context (existing code this builds on)

- **Sidebar:** `components/Sidebar.tsx` — the `people-hr` nav group (id `"people-hr"`, ~L45).
  Items are permission-gated via the `routePerms` map (`permissions.menu.<key>`).
- **Permissions:** `lib/permissions.ts` — `MenuPermissions` interface + `getMenuPermissions`
  (returns per-tier booleans), `ALL_PERMISSIONS` (drives the `/users` override panel), and
  override resolution (`getRoleDefaults` → `resolvePermission` → `getResolvedPermissions`).
  An override-only permission returns `false` for all tiers (pattern like `payrollExport`).
- **S3 presigned:** `app/api/reports/upload-url/route.ts` (presigned PUT) and
  `app/api/reports/cir/download-url/route.ts` (presigned GET) — both use `S3Client` +
  `@aws-sdk/s3-request-presigner`, env `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`.
- **Training records (existing):** `convex/schema.ts` `personnel.trainingRecords`
  (`{ area, completedAt, certifiedBy? }`) + `completedTraining` (legacy). Mutation
  `convex/personnel.ts:toggleTraining` (~L878) patches both; `certifiedBy` is in the schema
  but not yet written — the session flow will populate it.
- **Library UI model:** Doc Hub (`app/documents/page.tsx` + `components/dochub/*`) — a
  context provider holding Convex queries + upload/preview handlers, a grid browser, and
  modals. The training library mirrors this structure.

## Components

### 1. Permission — `menu.training` (override-only)
- Add `training: boolean` to `MenuPermissions` (`lib/permissions.ts`).
- In `getMenuPermissions`, return `training: false` (no tier grants it).
- Add `{ key: "menu.training", label: "Training", description: "Access the Training video library", category: "personnel" }` to `ALL_PERMISSIONS`.
- Override resolution already grants it per user via `permissionOverrides["menu.training"] = true`.
- Sidebar: add a `people-hr` item `{ href: "/training", label: "Training", icon, section: "Training" }`
  and `"/training": permissions.menu.training` to the `routePerms` map.
- Page guard: `/training` (and the projector route) wrap in a guard that requires
  `permissions.menu.training` (use the existing `<Protected>` pattern + an inline
  `permissions.menu.training` check, redirecting if false), so direct-URL access is blocked.

### 2. Data model (Convex — `convex/schema.ts` + `convex/training.ts`)
```
trainingSegments: {
  title: string,
  description?: string,
  order: number,
  isActive: boolean,
  createdBy: Id<users>, createdAt: number, updatedAt: number,
}  // index by_order

trainingVideos: {
  segmentId: Id<trainingSegments>,
  title: string,
  s3Key: string,             // training/videos/<uuid>.<ext>
  order: number,
  durationSec?: number,
  createdBy: Id<users>, createdAt: number,
}  // index by_segment

trainingSessions: {
  segmentId: Id<trainingSegments>,
  segmentTitle: string,      // denormalized for history if a segment is renamed/deleted
  date: string,              // YYYY-MM-DD
  presenterId: Id<users>, presenterName: string,
  personnelAttendees: Id<personnel>[],
  guestAttendees: string[],  // free-typed names not yet in the system
  notes?: string,
  createdAt: number,
}  // index by_date
```
`convex/training.ts` mutations/queries: `listSegments`, `createSegment`, `updateSegment`,
`reorderSegments`, `deleteSegment`; `listVideos(segmentId)`, `addVideo`, `updateVideo`,
`deleteVideo`; `logSession`, `listSessions`. All write mutations guard on the caller having
`menu.training` (resolve the caller's permissions server-side, mirroring how the app passes a
`requestingUserId`).

### 3. Video upload + playback (S3)
- **Upload:** new `app/api/training/upload-url/route.ts` — POST `{ filename, contentType }` →
  presigned PUT to `training/videos/<uuid>-<sanitized-filename>` (expires ~15 min). Client
  PUTs the file directly to S3, then calls `addVideo` with the returned `s3Key` + title.
- **Playback:** new `app/api/training/video-url/route.ts` — GET `?key=<s3Key>` → presigned GET
  (expires ~4 hours, long enough for a training session; supports HTTP Range so the
  `<video>` element can seek). Client sets `<video src={signedUrl} controls>`.
- Both routes require an authenticated caller with `menu.training` (check via Convex like
  other protected API routes do).

### 4. Library page — `app/training/page.tsx` (+ `components/training/*`)
Mirror Doc Hub: a `TrainingProvider` (Convex queries + upload handler), a segment list/sidebar,
and a video grid for the selected segment. Authorized users can:
- Create/rename/reorder/delete segments.
- Upload videos into a segment (drag-drop → presigned PUT → `addVideo`), reorder, delete.
- Launch **projector mode** for a segment, and **Log a session**.

### 5. Projector mode — `app/training/present/[segmentId]/page.tsx`
A distraction-free fullscreen view: large `<video>`, the segment's playlist (ordered videos),
prev/next controls, autoplay-to-next on `ended`, the segment title, and minimal chrome (works
with the browser's native fullscreen). A **"Log session"** action is reachable from here.
Guarded by `menu.training`.

### 6. Completion — session logging
A "Log session" modal (from the library or projector view): pick segment (prefilled in
projector mode) + date (defaults today) + attendees. Attendees:
- **Personnel multi-select** (search active personnel) — for each selected, write/ensure a
  `trainingRecord` `{ area: segmentTitle, completedAt: now, certifiedBy: presenterId }` on
  their personnel doc (via a new `recordTrainingForSegment` mutation that sets `certifiedBy`,
  unlike the toggle), and add to `personnelAttendees`.
- **Guest names** — a free-text add-name field; stored in `guestAttendees`.
- Save creates a `trainingSessions` row. A simple **session history** list (segment, date,
  presenter, attendee count) is shown on the library page for the record.

## Out of Scope (v1)
- Individual employee self-watch / per-user assignments.
- Quizzes/assessments.
- Server-side transcoding/compression (videos uploaded as-is).
- Multipart upload for files > 5 GB (single presigned PUT covers ≤ 5 GB).
- Auto thumbnails (optional `durationSec`/thumbnail can be added later).

## Testing (manual — no UI test harness)
1. Grant `menu.training` to a test user via `/users`; confirm the Training item appears only
   for them and a non-granted user gets neither the menu item nor page access (direct URL blocked).
2. Create a segment; upload a small video; it appears in the grid and plays.
3. Launch projector mode; video plays fullscreen, next/prev works, autoplay advances.
4. Log a session: select a personnel attendee + add a guest name; confirm the personnel
   record shows the training (area = segment title, certifiedBy set) and the session appears
   in history with the guest name.
5. Delete a video/segment; confirm cleanup (metadata removed; S3 object deletion best-effort).
