# Training Assignments & Completion Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track training completion per video (from in-person sessions and self-serve viewing), let managers assign videos to employees from the personnel file and see a roster, and give employees a Training menu showing only their assigned videos.

**Architecture:** Two new Convex tables (`trainingCompletions`, `trainingAssignments`) extend the existing `convex/training.ts`. Completions come from `logSession` (video-picker) or employee `markVideoComplete`. The `/training` route branches: managers (menu.training) get the library + roster; employees with assignments get an assigned-only view. Video playback auth is widened so an employee can fetch only videos assigned to them.

**Tech Stack:** Next.js (App Router, client components), Convex, React, Tailwind, HTML5 video.

**Spec:** `docs/superpowers/specs/2026-06-16-training-assignments-design.md`

**Testing note:** No automated UI test harness; the gate per task is `npx tsc --noEmit` (the new tables derive types from the local schema, and new `training.ts` exports resolve through the already-registered training module — so no `convex/_generated` edits are needed). Behavior verified manually (final task).

---

## File Structure
- **Modify** `convex/schema.ts` — add `trainingCompletions`, `trainingAssignments`; add `videoIds` to `trainingSessions`.
- **Modify** `convex/training.ts` — completion helper, updated `logSession`, progress/roster queries, assignment mutations, employee self-serve queries/mutations, `canViewVideo`.
- **Modify** `app/api/training/video-url/route.ts` — use `canViewVideo` instead of `hasTrainingAccess`.
- **Modify** `components/training/LogSessionModal.tsx` — video checklist.
- **Modify** `components/training/TrainingLibrary.tsx` — Roster view.
- **Modify** `app/personnel/[id]/page.tsx` — "Video Training" panel (progress + assign/unassign).
- **Create** `components/training/EmployeeTraining.tsx` — employee assigned-only view.
- **Modify** `app/training/page.tsx` — branch managers vs employees.
- **Modify** `components/Sidebar.tsx` — Training item in the employee nav when they have assignments.

---

## PHASE 1 — Completion model, session video-picker, profile progress, roster

## Task 1: Schema — completions, assignments, session videoIds

**Files:** Modify `convex/schema.ts`

- [ ] **Step 1: Add `videoIds` to `trainingSessions`**
In `trainingSessions: defineTable({ ... })`, after `notes: v.optional(v.string()),` add:
```ts
    videoIds: v.optional(v.array(v.id("trainingVideos"))),
```

- [ ] **Step 2: Add the two new tables**
Next to the other training tables in `defineSchema`, add:
```ts
  trainingCompletions: defineTable({
    personnelId: v.id("personnel"),
    videoId: v.id("trainingVideos"),
    segmentId: v.id("trainingSegments"),
    segmentTitle: v.string(),
    videoTitle: v.string(),
    completedAt: v.number(),
    source: v.string(), // "session" | "self"
    certifiedBy: v.optional(v.id("users")),
    sessionId: v.optional(v.id("trainingSessions")),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_video", ["videoId"])
    .index("by_segment", ["segmentId"]),

  trainingAssignments: defineTable({
    personnelId: v.id("personnel"),
    videoId: v.id("trainingVideos"),
    segmentId: v.id("trainingSegments"),
    assignedBy: v.id("users"),
    assignedAt: v.number(),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_video", ["videoId"]),
```

- [ ] **Step 3: Typecheck & commit**
`cd /Users/andybarrows/IECentral && npx tsc --noEmit` (expect 0).
```bash
git add convex/schema.ts
git commit -m "feat(training): completions + assignments tables; session videoIds

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Convex — completion helper, logSession videoIds, progress + roster

**Files:** Modify `convex/training.ts`

- [ ] **Step 1: Add a completion helper near the top (after `userHasTrainingAccess`)**
```ts
// Insert a (personnel, video) completion unless one already exists.
async function upsertCompletion(
  ctx: any,
  args: { personnelId: any; video: any; source: string; certifiedBy?: any; sessionId?: any }
): Promise<void> {
  const existing = await ctx.db
    .query("trainingCompletions")
    .withIndex("by_personnel", (q: any) => q.eq("personnelId", args.personnelId))
    .collect();
  if (existing.some((c: any) => c.videoId === args.video._id)) return;
  await ctx.db.insert("trainingCompletions", {
    personnelId: args.personnelId,
    videoId: args.video._id,
    segmentId: args.video.segmentId,
    segmentTitle: "",
    videoTitle: args.video.title,
    completedAt: Date.now(),
    source: args.source,
    certifiedBy: args.certifiedBy,
    sessionId: args.sessionId,
  });
}
```
(`segmentTitle` is backfilled by the caller where it has the segment — see logSession. For self-serve we look it up. To keep it simple, set it from the segment in each caller; replace the empty string by passing it in.)

Refine: change the helper signature to accept `segmentTitle`:
```ts
async function upsertCompletion(
  ctx: any,
  args: { personnelId: any; video: any; segmentTitle: string; source: string; certifiedBy?: any; sessionId?: any }
): Promise<void> {
  const existing = await ctx.db
    .query("trainingCompletions")
    .withIndex("by_personnel", (q: any) => q.eq("personnelId", args.personnelId))
    .collect();
  if (existing.some((c: any) => c.videoId === args.video._id)) return;
  await ctx.db.insert("trainingCompletions", {
    personnelId: args.personnelId,
    videoId: args.video._id,
    segmentId: args.video.segmentId,
    segmentTitle: args.segmentTitle,
    videoTitle: args.video.title,
    completedAt: Date.now(),
    source: args.source,
    certifiedBy: args.certifiedBy,
    sessionId: args.sessionId,
  });
}
```

- [ ] **Step 2: Replace `logSession` to record per-video completions**
Replace the existing `logSession` mutation with:
```ts
export const logSession = mutation({
  args: {
    segmentId: v.id("trainingSegments"),
    date: v.string(),
    videoIds: v.array(v.id("trainingVideos")),
    personnelAttendees: v.array(v.id("personnel")),
    guestAttendees: v.array(v.string()),
    notes: v.optional(v.string()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireTrainingAccess(ctx, args.requestingUserId);
    const segment = await ctx.db.get(args.segmentId);
    if (!segment) throw new Error("Segment not found");
    const presenter = await ctx.db.get(args.requestingUserId);
    const now = Date.now();

    const sessionId = await ctx.db.insert("trainingSessions", {
      segmentId: args.segmentId, segmentTitle: segment.title, date: args.date,
      presenterId: args.requestingUserId, presenterName: presenter?.name ?? "Unknown",
      personnelAttendees: args.personnelAttendees, guestAttendees: args.guestAttendees,
      videoIds: args.videoIds, notes: args.notes, createdAt: now,
    });

    const videos = (await Promise.all(args.videoIds.map((id) => ctx.db.get(id)))).filter(Boolean);
    for (const personnelId of args.personnelAttendees) {
      const p = await ctx.db.get(personnelId);
      if (!p) continue;
      for (const video of videos) {
        await upsertCompletion(ctx, {
          personnelId, video, segmentTitle: segment.title,
          source: "session", certifiedBy: args.requestingUserId, sessionId,
        });
      }
    }
    return sessionId;
  },
});
```

- [ ] **Step 3: Add progress + roster queries (guarded)**
Append:
```ts
// Completions + assignments for one employee, grouped by segment, for the profile panel.
export const personnelTrainingProgress = query({
  args: { personnelId: v.id("personnel"), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    if (!(await userHasTrainingAccess(ctx, args.requestingUserId))) return [];
    const completions = await ctx.db.query("trainingCompletions")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId)).collect();
    const assignments = await ctx.db.query("trainingAssignments")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId)).collect();
    const completedVideoIds = new Set(completions.map((c) => c.videoId));
    const assignedVideoIds = new Set(assignments.map((a) => a.videoId));
    // segments referenced by either
    const segIds = Array.from(new Set([...completions.map((c) => c.segmentId), ...assignments.map((a) => a.segmentId)]));
    const out = [];
    for (const segId of segIds) {
      const seg = await ctx.db.get(segId);
      if (!seg) continue;
      const vids = await ctx.db.query("trainingVideos").withIndex("by_segment", (q) => q.eq("segmentId", segId)).collect();
      vids.sort((a, b) => a.order - b.order);
      out.push({
        segmentId: segId, title: seg.title, totalVideos: vids.length,
        videos: vids.map((v2) => ({
          videoId: v2._id, title: v2.title,
          completed: completedVideoIds.has(v2._id),
          assigned: assignedVideoIds.has(v2._id),
          completedAt: completions.find((c) => c.videoId === v2._id)?.completedAt ?? null,
        })),
        completedCount: vids.filter((v2) => completedVideoIds.has(v2._id)).length,
        assignedCount: vids.filter((v2) => assignedVideoIds.has(v2._id)).length,
      });
    }
    return out;
  },
});

// Per-segment roster: every active personnel with any assignment or completion in the segment.
export const segmentRoster = query({
  args: { segmentId: v.id("trainingSegments"), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    if (!(await userHasTrainingAccess(ctx, args.requestingUserId))) return [];
    const vids = await ctx.db.query("trainingVideos").withIndex("by_segment", (q) => q.eq("segmentId", args.segmentId)).collect();
    const total = vids.length;
    const completions = await ctx.db.query("trainingCompletions").withIndex("by_segment", (q) => q.eq("segmentId", args.segmentId)).collect();
    const assignments = await ctx.db.query("trainingAssignments").withIndex("by_video").collect();
    const segAssignments = assignments.filter((a) => a.segmentId === args.segmentId);
    const byPersonnel = new Map<string, { completed: Set<string>; assigned: number }>();
    for (const c of completions) {
      const e = byPersonnel.get(c.personnelId) ?? { completed: new Set<string>(), assigned: 0 };
      e.completed.add(c.videoId); byPersonnel.set(c.personnelId, e);
    }
    for (const a of segAssignments) {
      const e = byPersonnel.get(a.personnelId) ?? { completed: new Set<string>(), assigned: 0 };
      e.assigned += 1; byPersonnel.set(a.personnelId, e);
    }
    const rows = [];
    for (const [personnelId, e] of byPersonnel) {
      const p = await ctx.db.get(personnelId as any);
      if (!p || (p as any).status === "terminated") continue;
      rows.push({ personnelId, name: `${(p as any).lastName}, ${(p as any).firstName}`, completed: e.completed.size, total });
    }
    rows.sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
    return rows;
  },
});
```

- [ ] **Step 4: Typecheck & commit**
`npx tsc --noEmit` (expect 0).
```bash
git add convex/training.ts
git commit -m "feat(training): per-video completions in logSession + progress/roster queries

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: LogSessionModal — video checklist

**Files:** Modify `components/training/LogSessionModal.tsx`

- [ ] **Step 1: Add video selection + pass videoIds**
Add a videos query, selection state, a "Select all" control, and pass `videoIds` to `logSession`. Add after the `personnel` query line:
```tsx
  const videos = useQuery(api.training.listVideos, user ? { segmentId, requestingUserId: user._id } : "skip") || [];
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());
  const toggleVideo = (id: string) => setSelectedVideos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
```
NOTE: `listVideos` currently takes only `{ segmentId }`. If it does NOT accept `requestingUserId`, call it as `{ segmentId }`. Read `convex/training.ts` `listVideos` args and match exactly. (As of this plan it is `args: { segmentId: v.id("trainingSegments") }` — so call `useQuery(api.training.listVideos, { segmentId })`.)

Use `useQuery(api.training.listVideos, { segmentId })`.

In `save()`, add `videoIds: [...selectedVideos] as Id<"trainingVideos">[]` to the `logSession({...})` call.

Render a videos checklist block (before the Attendees block):
```tsx
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium">Videos covered</label>
          <button type="button" onClick={() => setSelectedVideos(new Set(videos.map((v) => v._id)))} className="text-xs text-[#007AFF]">Select all</button>
        </div>
        <div className="max-h-40 overflow-y-auto border rounded-lg p-2 mb-3">
          {videos.map((v) => (
            <label key={v._id} className="flex items-center gap-2 py-1 text-sm">
              <input type="checkbox" checked={selectedVideos.has(v._id)} onChange={() => toggleVideo(v._id)} />
              {v.title}
            </label>
          ))}
          {videos.length === 0 && <p className="text-xs text-gray-500">No videos in this segment.</p>}
        </div>
```

- [ ] **Step 2: Typecheck & commit**
`npx tsc --noEmit` (expect 0).
```bash
git add components/training/LogSessionModal.tsx
git commit -m "feat(training): session log video checklist (which videos were covered)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Personnel profile — Video Training progress panel (read-only)

**Files:** Modify `app/personnel/[id]/page.tsx`

- [ ] **Step 1: Query progress + render the panel**
Near the other `useQuery` calls (after the `personnel` query, ~line 351), add:
```tsx
  const trainingProgress = useQuery(
    api.training.personnelTrainingProgress,
    user ? { personnelId, requestingUserId: user._id } : "skip"
  ) || [];
```
Immediately after the Training Badges section's closing `</div>` (~line 1674, before the `{/* Linked Application Card */}` comment), insert a new card:
```tsx
            {/* Video Training (TIA) */}
            <div className={`rounded-xl p-6 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
              <h3 className={`text-lg font-semibold mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>Video Training</h3>
              {trainingProgress.length === 0 ? (
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>No video training assigned or completed yet.</p>
              ) : (
                <div className="space-y-4 mt-3">
                  {trainingProgress.map((seg) => (
                    <div key={seg.segmentId}>
                      <div className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-gray-800"}`}>
                        {seg.title} — {seg.completedCount} of {seg.totalVideos} videos
                      </div>
                      <ul className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                        {seg.videos.map((v) => (
                          <li key={v.videoId} className={`text-xs flex items-center gap-1.5 ${v.completed ? (isDark ? "text-green-400" : "text-green-700") : (isDark ? "text-slate-500" : "text-gray-500")}`}>
                            <span>{v.completed ? "✓" : v.assigned ? "○" : "·"}</span> {v.title}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
```

- [ ] **Step 2: Typecheck & commit**
`npx tsc --noEmit` (expect 0).
```bash
git add "app/personnel/[id]/page.tsx"
git commit -m "feat(training): Video Training progress panel on personnel profile

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Roster view in the manager library

**Files:** Modify `components/training/TrainingLibrary.tsx`

- [ ] **Step 1: Add a Roster toggle + table**
Add state `const [showRoster, setShowRoster] = useState(false);` and a roster query
`const roster = useQuery(api.training.segmentRoster, activeSegment && user ? { segmentId: activeSegment, requestingUserId: user._id } : "skip") || [];`.
In the action row (next to Projector Mode / Upload / Log session), add:
```tsx
              <button onClick={() => setShowRoster((v) => !v)} className="px-3 py-1.5 rounded-full text-xs font-semibold theme-text-secondary theme-bg-hover">{showRoster ? "Hide roster" : "Roster"}</button>
```
Below the videos grid (inside the `activeSegment` block), add:
```tsx
            {showRoster && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold theme-text-secondary mb-2">Completion roster</h3>
                {roster.length === 0 ? <p className="theme-text-muted text-xs">No assignments or completions for this segment yet.</p> : (
                  <table className="w-full text-sm">
                    <thead><tr className="theme-text-muted text-left"><th className="py-1">Employee</th><th className="py-1">Completed</th></tr></thead>
                    <tbody>
                      {roster.map((r) => (
                        <tr key={r.personnelId} className="border-t theme-border-secondary">
                          <td className="py-1 theme-text-primary">{r.name}</td>
                          <td className="py-1 theme-text-secondary">{r.completed} / {r.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
```

- [ ] **Step 2: Typecheck & commit**
`npx tsc --noEmit` (expect 0).
```bash
git add components/training/TrainingLibrary.tsx
git commit -m "feat(training): per-segment completion roster in the library

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## PHASE 2 — Assignments + employee self-serve

## Task 6: Convex — assignments + employee self-serve + canViewVideo

**Files:** Modify `convex/training.ts`

- [ ] **Step 1: Assignment mutations (manager-guarded)**
Append:
```ts
export const assignVideos = mutation({
  args: { personnelId: v.id("personnel"), videoIds: v.array(v.id("trainingVideos")), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireTrainingAccess(ctx, args.requestingUserId);
    const existing = await ctx.db.query("trainingAssignments").withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId)).collect();
    const have = new Set(existing.map((a) => a.videoId));
    const now = Date.now();
    for (const videoId of args.videoIds) {
      if (have.has(videoId)) continue;
      const video = await ctx.db.get(videoId);
      if (!video) continue;
      await ctx.db.insert("trainingAssignments", { personnelId: args.personnelId, videoId, segmentId: video.segmentId, assignedBy: args.requestingUserId, assignedAt: now });
    }
    return args.personnelId;
  },
});

export const assignSegment = mutation({
  args: { personnelId: v.id("personnel"), segmentId: v.id("trainingSegments"), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireTrainingAccess(ctx, args.requestingUserId);
    const vids = await ctx.db.query("trainingVideos").withIndex("by_segment", (q) => q.eq("segmentId", args.segmentId)).collect();
    const existing = await ctx.db.query("trainingAssignments").withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId)).collect();
    const have = new Set(existing.map((a) => a.videoId));
    const now = Date.now();
    for (const video of vids) {
      if (have.has(video._id)) continue;
      await ctx.db.insert("trainingAssignments", { personnelId: args.personnelId, videoId: video._id, segmentId: args.segmentId, assignedBy: args.requestingUserId, assignedAt: now });
    }
    return args.personnelId;
  },
});

export const unassign = mutation({
  args: { personnelId: v.id("personnel"), videoId: v.id("trainingVideos"), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireTrainingAccess(ctx, args.requestingUserId);
    const rows = await ctx.db.query("trainingAssignments").withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId)).collect();
    for (const r of rows) if (r.videoId === args.videoId) await ctx.db.delete(r._id);
    return args.personnelId;
  },
});
```

- [ ] **Step 2: Employee self-serve queries/mutations**
Append:
```ts
// Resolve the caller's personnel record, return assigned videos + completion state, grouped by segment.
export const myAssignedTraining = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || !user.personnelId) return [];
    const personnelId = user.personnelId;
    const assignments = await ctx.db.query("trainingAssignments").withIndex("by_personnel", (q) => q.eq("personnelId", personnelId)).collect();
    if (assignments.length === 0) return [];
    const completions = await ctx.db.query("trainingCompletions").withIndex("by_personnel", (q) => q.eq("personnelId", personnelId)).collect();
    const done = new Set(completions.map((c) => c.videoId));
    const bySeg = new Map<string, any[]>();
    for (const a of assignments) {
      const video = await ctx.db.get(a.videoId);
      if (!video) continue;
      const arr = bySeg.get(a.segmentId) ?? [];
      arr.push({ videoId: video._id, title: video.title, s3Key: video.s3Key, order: video.order, completed: done.has(video._id) });
      bySeg.set(a.segmentId, arr);
    }
    const out = [];
    for (const [segId, vids] of bySeg) {
      const seg = await ctx.db.get(segId as any);
      vids.sort((a, b) => a.order - b.order);
      out.push({ segmentId: segId, title: (seg as any)?.title ?? "Training", videos: vids });
    }
    return out;
  },
});

// True if the user is a manager OR the video is assigned to the user's personnel record.
export const canViewVideo = query({
  args: { userId: v.id("users"), videoId: v.id("trainingVideos") },
  handler: async (ctx, args) => {
    if (await userHasTrainingAccess(ctx, args.userId)) return true;
    const user = await ctx.db.get(args.userId);
    if (!user || !user.personnelId) return false;
    const rows = await ctx.db.query("trainingAssignments").withIndex("by_personnel", (q) => q.eq("personnelId", user.personnelId!)).collect();
    return rows.some((r) => r.videoId === args.videoId);
  },
});

// Employee marks an assigned video complete (self-serve). Verifies assignment.
export const markVideoComplete = mutation({
  args: { userId: v.id("users"), videoId: v.id("trainingVideos") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || !user.personnelId) throw new Error("No personnel record linked to this account");
    const personnelId = user.personnelId;
    const assignments = await ctx.db.query("trainingAssignments").withIndex("by_personnel", (q) => q.eq("personnelId", personnelId)).collect();
    if (!assignments.some((a) => a.videoId === args.videoId)) throw new Error("This video is not assigned to you");
    const video = await ctx.db.get(args.videoId);
    if (!video) throw new Error("Video not found");
    const segment = await ctx.db.get(video.segmentId);
    await upsertCompletion(ctx, { personnelId, video, segmentTitle: (segment as any)?.title ?? "", source: "self" });
    return args.videoId;
  },
});
```

- [ ] **Step 3: Typecheck & commit**
`npx tsc --noEmit` (expect 0).
```bash
git add convex/training.ts
git commit -m "feat(training): assignments + employee self-serve queries/mutations + canViewVideo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Profile — assign / unassign controls

**Files:** Modify `app/personnel/[id]/page.tsx`

- [ ] **Step 1: Wire assignment mutations + segment list**
Add near the other mutations:
```tsx
  const segments = useQuery(api.training.listSegments) || [];
  const assignSegment = useMutation(api.training.assignSegment);
  const unassignVideo = useMutation(api.training.unassign);
  const [assignSeg, setAssignSeg] = useState("");
```
In the "Video Training" card (Task 4), under the heading add (gated to managers via `canManagePersonnel`):
```tsx
              {canManagePersonnel && (
                <div className="flex items-center gap-2 mt-2 mb-3">
                  <select value={assignSeg} onChange={(e) => setAssignSeg(e.target.value)} className={`px-2 py-1 text-xs rounded border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "border-gray-300"}`}>
                    <option value="">Assign a program…</option>
                    {segments.map((s) => <option key={s._id} value={s._id}>{s.title}</option>)}
                  </select>
                  <button disabled={!assignSeg} onClick={async () => { if (assignSeg && user) { await assignSegment({ personnelId, segmentId: assignSeg as Id<"trainingSegments">, requestingUserId: user._id }); setAssignSeg(""); } }} className="px-2 py-1 text-xs rounded-full text-white disabled:opacity-50" style={{ backgroundColor: "#007AFF" }}>Assign</button>
                </div>
              )}
```
In each video `<li>` (Task 4 list), when `canManagePersonnel && v.assigned`, add an unassign affordance:
```tsx
                            {canManagePersonnel && v.assigned && !v.completed && (
                              <button onClick={async () => { if (user) await unassignVideo({ personnelId, videoId: v.videoId, requestingUserId: user._id }); }} className="ml-1 text-[10px] text-red-500">remove</button>
                            )}
```

- [ ] **Step 2: Typecheck & commit**
`npx tsc --noEmit` (expect 0).
```bash
git add "app/personnel/[id]/page.tsx"
git commit -m "feat(training): assign programs + unassign videos from the personnel profile

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Playback route — allow assigned-video access

**Files:** Modify `app/api/training/video-url/route.ts`

- [ ] **Step 1: Use `canViewVideo`**
The route currently checks `api.training.hasTrainingAccess` with only `userId`. It needs the videoId. Change the client callers to also pass `videoId`, and the route to call `canViewVideo`. In the route handler, after reading `key` and `userId`, also read `const videoId = request.nextUrl.searchParams.get("videoId");` and replace the access check:
```ts
    if (!videoId) return NextResponse.json({ error: "videoId required" }, { status: 400 });
    const ok = await convex.query(api.training.canViewVideo, { userId: userId as Id<"users">, videoId: videoId as Id<"trainingVideos"> });
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
```
(Keep the existing `key.startsWith("training/videos/")` and `userId` checks.)

- [ ] **Step 2: Update existing callers to pass videoId**
- `components/training/VideoPlayerModal.tsx`: it currently takes `{ s3Key, title }`. Add a `videoId: Id<"trainingVideos">` prop and append `&videoId=${videoId}` to the fetch URL. Update the call sites in `TrainingLibrary.tsx` (the `playing` state) to include `videoId: vid._id`.
- `app/training/present/[segmentId]/page.tsx`: append `&videoId=${current._id}` to its video-url fetch.

Read each file and thread `videoId` through. Exact: the fetch becomes
`fetch(\`/api/training/video-url?key=${encodeURIComponent(s3Key)}&userId=${user._id}&videoId=${videoId}\`)`.

- [ ] **Step 3: Typecheck & build & commit**
`npx tsc --noEmit` (expect 0).
```bash
git add app/api/training/video-url/route.ts components/training/VideoPlayerModal.tsx components/training/TrainingLibrary.tsx "app/training/present/[segmentId]/page.tsx"
git commit -m "feat(training): gate playback by canViewVideo (manager OR assigned)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Employee self-serve view + sidebar item + route branch

**Files:** Create `components/training/EmployeeTraining.tsx`; Modify `app/training/page.tsx`, `components/Sidebar.tsx`

- [ ] **Step 1: EmployeeTraining component**
Create `components/training/EmployeeTraining.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/app/auth-context";
import VideoPlayerModal from "./VideoPlayerModal";

export default function EmployeeTraining() {
  const { user } = useAuth();
  const groups = useQuery(api.training.myAssignedTraining, user ? { userId: user._id } : "skip") || [];
  const markComplete = useMutation(api.training.markVideoComplete);
  const [playing, setPlaying] = useState<{ s3Key: string; title: string; videoId: Id<"trainingVideos"> } | null>(null);

  return (
    <div className="p-6 space-y-6">
      {groups.length === 0 && <p className="theme-text-muted">No training assigned to you yet.</p>}
      {groups.map((g) => (
        <div key={g.segmentId}>
          <h2 className="text-sm font-semibold theme-text-secondary mb-2">{g.title}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {g.videos.map((v) => (
              <button key={v.videoId} onClick={() => setPlaying({ s3Key: v.s3Key, title: v.title, videoId: v.videoId })}
                className="theme-bg-card border theme-border-primary rounded-xl p-4 text-left hover:shadow-md transition">
                <div className="text-3xl mb-2">{v.completed ? "✅" : "🎬"}</div>
                <div className="text-sm font-medium theme-text-primary truncate">{v.title}</div>
                <div className="text-xs theme-text-muted">{v.completed ? "Completed" : "Not yet watched"}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
      {playing && user && (
        <VideoPlayerModal s3Key={playing.s3Key} title={playing.title} videoId={playing.videoId}
          onClose={() => setPlaying(null)}
          onEnded={async () => { await markComplete({ userId: user._id, videoId: playing.videoId }); }} />
      )}
    </div>
  );
}
```
NOTE: This requires `VideoPlayerModal` to accept a `videoId` prop (added in Task 8) and an optional `onEnded` callback. Add to `VideoPlayerModal`: prop `onEnded?: () => void` and on the `<video>` element `onEnded={onEnded}`.

- [ ] **Step 2: Branch the page**
In `app/training/page.tsx` `Content()`, replace the `!permissions.menu.training` branch so employees with assignments get the employee view:
```tsx
  const { user } = useAuth(); // add import { useAuth } from "@/app/auth-context"
  const myTraining = useQuery(api.training.myAssignedTraining, user ? { userId: user._id } : "skip");
  if (permissions.isLoading) return <div className="p-8 theme-text-muted">Loading…</div>;
  if (!permissions.menu.training) {
    if (myTraining && myTraining.length > 0) {
      return (
        <div className="flex h-screen theme-bg-primary"><Sidebar /><main className="flex-1 overflow-y-auto"><MobileHeader />
          <header className="sticky top-0 z-10 border-b theme-border-primary theme-bg-card px-6 py-4"><h1 className="text-xl font-bold theme-text-primary">My Training</h1><p className="text-xs theme-text-muted">Videos assigned to you</p></header>
          <EmployeeTraining /></main></div>
      );
    }
    return <div className="p-8"><p className="theme-text-primary font-medium">You don’t have access to Training.</p><Link href="/" className="text-[#007AFF] text-sm">Back to dashboard</Link></div>;
  }
```
Add imports: `import { useQuery } from "convex/react";`, `import { api } from "@/convex/_generated/api";`, `import EmployeeTraining from "@/components/training/EmployeeTraining";`, and `useAuth`.

- [ ] **Step 3: Sidebar employee Training item**
In `components/Sidebar.tsx`, inside the `isEmployee ? ( <> ... </> )` branch (before its closing `</>` at ~line 410), add a Training link shown only when the employee has assignments. Add near the top hooks:
```tsx
  const myAssigned = useQuery(api.training.myAssignedTraining, user?._id ? { userId: user._id } : "skip");
```
Then in the employee branch add:
```tsx
            {myAssigned && myAssigned.length > 0 && (
              <Link href="/training" onClick={handleNavClick} className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg transition-all ${pathname === "/training" ? (isDark ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "bg-blue-50 text-blue-600 border border-blue-200") : (isDark ? "text-slate-400 hover:bg-slate-700/50 hover:text-white" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900")}`}>
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                <span className="font-medium text-sm sm:text-base">Training</span>
              </Link>
            )}
```

- [ ] **Step 4: Build & commit**
`cd /Users/andybarrows/IECentral && npx next build 2>&1 | tail -15` (must complete; `/training` compiles).
```bash
git add components/training/EmployeeTraining.tsx components/training/VideoPlayerModal.tsx app/training/page.tsx components/Sidebar.tsx
git commit -m "feat(training): employee self-serve assigned-video view + sidebar item

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: End-to-end manual verification

**Files:** none

- [ ] **Step 1:** `npx next build` completes clean.
- [ ] **Step 2:** As a manager, Log session on ATS covering 3 of 15 videos for one attendee → that attendee's profile "Video Training" shows "ATS 2024 — 3 of 15", those 3 ✓.
- [ ] **Step 3:** On an employee's profile (one with a linked user account), assign the ATS program → 15 ○ appear; roster (library) shows them 0/15 (or 3/15 if also attended).
- [ ] **Step 4:** Log in as that employee → a **Training** sidebar item appears → page shows only the 15 assigned videos → play one to the end → it flips to ✅ and the manager roster shows +1.
- [ ] **Step 5:** Confirm `/api/training/video-url` returns 403 for an employee requesting a video NOT assigned to them (and 200 for an assigned one).
- [ ] **Step 6:** Unassign a video from the profile → it disappears from the employee's view.
- [ ] **Step 7:** A user with no personnel link / no assignments still sees the "no access" Training page; no sidebar item.

---

## Self-Review Notes
- **Spec coverage:** completions table + two sources (T1/T2/T6) ✓ assignments table (T1/T6) ✓ session video-picker (T3) ✓ profile progress panel (T4) + assign/unassign (T7) ✓ roster (T5) ✓ employee self-serve view + sidebar + route branch (T9) ✓ playback auth widened to assigned (T8) ✓ "track completed, no auto-cert" (progress strings, no badge) ✓ manual tests (T10) ✓.
- **Type consistency:** `trainingCompletions`/`trainingAssignments` field names identical across schema (T1), Convex (T2/T6), and consumers; `videoIds` arg threaded from LogSessionModal (T3) → logSession (T2); `canViewVideo({userId,videoId})` matches the route call (T8); `myAssignedTraining({userId})` shape matches EmployeeTraining + sidebar (T9); `VideoPlayerModal` gains `videoId` (T8) + `onEnded` (T9) used consistently.
- **No `_generated` edits needed:** new tables derive from local schema; new `training.ts` exports resolve through the already-registered `training` module import in `convex/_generated/api.d.ts`.
- **Phase split:** Phase 1 (T1–T5) ships manager-side tracking on its own; Phase 2 (T6–T9) adds assignments + employee self-serve.
