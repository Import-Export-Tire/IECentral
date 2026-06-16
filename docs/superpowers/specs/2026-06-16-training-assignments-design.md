# Training Platform — Assignments & Completion Tracking — Design

**Date:** 2026-06-16
**Status:** Approved, pending implementation

## Problem

The Training section (segments → videos in S3, projector mode, session logging) is live.
It now needs to become a two-sided platform:

- **Managers/presenters** organize content, present it, log in-person sessions, **assign**
  videos to employees, and see **who has completed what**.
- **Employees** get a Training menu item showing **only their assigned videos**, which they
  watch themselves; their completion is recorded.

Completion must be tracked **per video** (a session may cover only a few videos; a
certification session covers all), accumulating on the employee over time, visible on their
personnel profile and on a roster. Per the product owner: **track completed videos** (no
automatic "Certified" rollup badge — progress like "12 of 15" is sufficient).

## Decisions (confirmed)

- **Per-video completion**, not per-segment. Two completion sources: in-person **session**
  (presenter logs covered videos + attendees) and **self-serve** (employee watches an
  assigned video).
- **Assignments** are made from the **employee's personnel file** (a manager assigns
  individual videos or a whole segment to that employee).
- **Employees** see a **Training sidebar item only when they have assignments**, opening a
  view of **only their assigned videos**.
- **Same `/training` route, branched by access** (managers → library; employees → assigned-only).
- **No auto-"Certified" badge** — show completed-video progress (e.g. "ATS 2024 — 12 of 15").
- **Visibility:** employee profile panel **and** a per-segment roster on the manager library.
- **Self-serve requires a user account linked to the personnel record** (`users.personnelId`).
  Employees without accounts are tracked via in-person sessions only.

## Architectural Context (existing)

- `convex/training.ts`: segment/video/session CRUD, `logSession`, `hasTrainingAccess`,
  `requireTrainingAccess` guard (super_admin OR `permissionOverrides["menu.training"]`).
- `logSession` currently writes a segment-level record to `personnel.trainingRecords`
  (`{ area: segment.title, completedAt, certifiedBy }`). This will be **replaced** by per-video
  `trainingCompletions`.
- Personnel profile (`app/personnel/[id]/page.tsx`): shows a fixed `TRAINING_AREAS` badge
  checklist (warehouse areas) driven by `personnel.trainingRecords` — left as-is; the new
  TIA progress is a separate panel.
- `users.personnelId?: Id<"personnel">` links a login to a personnel record (see
  `app/auth-context.tsx` User interface).
- Sidebar (`components/Sidebar.tsx`): role branches — `isEmployee ? (employee nav) : … : (full
  permission-driven nav)`. Managers' Training item is in the `people-hr` group gated by
  `menu.training`. The employee nav is a separate hardcoded branch.
- Training library UI: `components/training/TrainingLibrary.tsx`, `VideoPlayerModal.tsx`,
  `LogSessionModal.tsx`; projector at `app/training/present/[segmentId]/page.tsx`.

## Components

### 1. Data model (`convex/schema.ts`)
```
trainingCompletions: {
  personnelId: Id<personnel>,
  videoId: Id<trainingVideos>,
  segmentId: Id<trainingSegments>,
  segmentTitle: string,   // denormalized for display/history
  videoTitle: string,
  completedAt: number,
  source: string,         // "session" | "self"
  certifiedBy: Id<users> | undefined, // presenter for sessions; undefined for self
  sessionId: Id<trainingSessions> | undefined,
}  // indexes: by_personnel ["personnelId"], by_video ["videoId"], by_segment ["segmentId"]

trainingAssignments: {
  personnelId: Id<personnel>,
  videoId: Id<trainingVideos>,
  segmentId: Id<trainingSegments>, // denormalized for grouping/lookup
  assignedBy: Id<users>,
  assignedAt: number,
}  // indexes: by_personnel ["personnelId"], by_video ["videoId"]
```
Assigning "a whole segment" expands to one `trainingAssignments` row per video in the segment
(keeps the employee view and completion math uniform at the video level).

### 2. Convex functions (`convex/training.ts`)
- **Completions:** a private `upsertCompletion(ctx, {personnelId, video, source, certifiedBy?, sessionId?})`
  that inserts unless a row already exists for (personnelId, videoId).
- **`logSession`** gains `videoIds: Id<trainingVideos>[]`; for each attendee × videoId it calls
  `upsertCompletion(source: "session", certifiedBy: presenter, sessionId)`. The session row
  stores `videoIds`. (Drops the old segment-level `trainingRecords` write.)
- **Assignments (manager, guarded by `requireTrainingAccess`):**
  - `assignVideos({ personnelId, videoIds, requestingUserId })` — upsert assignment rows (dedupe).
  - `assignSegment({ personnelId, segmentId, requestingUserId })` — assign every video in the segment.
  - `unassign({ personnelId, videoId, requestingUserId })`.
  - `listAssignmentsForPersonnel({ personnelId })` (guarded) — manager view.
- **Employee self-serve (guarded by the caller being the linked user):**
  - `myAssignedTraining({ userId })` — resolves `users.personnelId`, returns that personnel's
    assignments joined with video + completion status. Returns `[]` if no personnel link.
  - `markVideoComplete({ userId, videoId })` — verifies the video is assigned to the caller's
    personnel record, then `upsertCompletion(source: "self")`. (Does NOT require `menu.training`.)
- **Progress/roster (manager, guarded):**
  - `personnelTrainingProgress({ personnelId, requestingUserId })` — completions + assignments
    grouped by segment with counts (e.g. completed 12 / assigned 15 / segment-total 15).
  - `segmentRoster({ segmentId, requestingUserId })` — for each active personnel with any
    assignment or completion in the segment: completedCount / total.

### 3. Personnel profile panel (`app/personnel/[id]/page.tsx`)
A new **"Video Training"** card (visible to users with `menu.training`):
- Per segment the employee has assignments/completions in: progress "N of M videos", and an
  expandable list of that segment's videos with ✓ (done, with date) or ○ (assigned, not done).
- **Assign** control: pick a segment (and optionally specific videos) → `assignSegment`/`assignVideos`.
- Uses `personnelTrainingProgress` + the segment/video lists.

### 4. Employee self-serve view
- **Routing:** `app/training/page.tsx` branches: if `permissions.menu.training` → manager
  `TrainingLibrary` (existing); else if the user has assignments (`myAssignedTraining` non-empty)
  → a new `EmployeeTraining` component (assigned videos only, grouped by segment, each playable
  via the existing `VideoPlayerModal`); else the "no access" message.
- **Watch → complete:** the employee player calls `markVideoComplete` on video end (and offers a
  "Mark complete" button). Completed videos show a ✓.
- **Sidebar:** the `/training` item must also appear in the **employee** nav branch when the
  employee has assignments. Add to the employee branch gated on a lightweight
  `hasAssignedTraining` signal (a `usePermissions`-adjacent query, or `myAssignedTraining`
  length > 0). Managers keep the existing `people-hr` Training item via `menu.training`.
- **Video playback auth:** `/api/training/video-url` currently requires `hasTrainingAccess`
  (manager). Extend it to ALSO allow a user who has the requested video **assigned** (resolve
  `users.personnelId` → check `trainingAssignments`). So employees can fetch URLs only for their
  assigned videos. Add a Convex query `canViewVideo({ userId, videoId })` = manager-access OR
  video-assigned-to-their-personnel; the route calls it instead of `hasTrainingAccess`.

### 5. Session log video-picker (`components/training/LogSessionModal.tsx`)
Add a checklist of the segment's videos (from `listVideos`) with **"Select all"**; pass the
chosen `videoIds` to `logSession`. (Segment is the one the modal was opened for.)

### 6. Roster (manager library)
A **Roster** view in `TrainingLibrary` for the active segment: `segmentRoster` → table of
employees with "completed / total", sortable. (Export deferred.)

## Out of Scope (v1)
- Auto-"Certified" badges / certificates / printable proof.
- Due dates / reminders / overdue tracking on assignments.
- Quizzes/assessments. CSV export of the roster.
- A 2-level Program→Module hierarchy (flat segments suffice; Crown Forklift etc. = new segments).

## Testing (manual — no UI test harness)
1. Manager logs a session covering 3 of 15 videos for an attendee → that attendee's profile
   shows "ATS 2024 — 3 of 15", those 3 ✓.
2. Manager assigns the whole ATS segment to an employee (who has a linked user account) from
   the profile → 15 assignments created.
3. That employee logs in → sees a **Training** sidebar item → the page shows only the 15 assigned
   videos → plays one → on finish it shows ✓ and the manager roster reflects 1/15.
4. An employee NOT assigned a given video gets 403 from `/api/training/video-url` for it.
5. `segmentRoster` shows each assigned/attended employee's completed/total for the segment.
6. Manager `unassign` removes a video from the employee's view.
7. A user with no `personnelId` link and no assignments still sees the "no access" Training page.
