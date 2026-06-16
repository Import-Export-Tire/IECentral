# Training Section (TIA Videos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A permission-gated Training section under People & HR where authorized presenters organize licensed TIA videos into segments, play them in a projector/fullscreen mode, and log per-session attendance (recording completions on personnel + free-typed guests).

**Architecture:** Convex tables hold segment/video/session metadata; the actual video files live in S3 (browser→S3 presigned PUT, playback via presigned GET). Access is an override-only `menu.training` permission. UI mirrors the Doc Hub provider/grid pattern; a separate fullscreen route is the projector mode.

**Tech Stack:** Next.js (App Router, client components), Convex, React, Tailwind, S3 (`@aws-sdk/client-s3` + `s3-request-presigner`), HTML5 `<video>`.

**Spec:** `docs/superpowers/specs/2026-06-16-training-section-design.md`

**Testing note:** No automated UI test harness (`package.json` scripts: dev/build/start/lint). Gate per task is `npx tsc --noEmit`; behavior verified manually (final task).

---

## File Structure
- **Modify** `lib/permissions.ts` — add `menu.training` (override-only).
- **Create** `convex/authGuards` addition `requireTrainingAccess` (in `convex/authGuards.ts`).
- **Modify** `components/Sidebar.tsx` — Training nav item + routePerms.
- **Modify** `convex/schema.ts` — `trainingSegments`, `trainingVideos`, `trainingSessions`.
- **Create** `convex/training.ts` — segment/video/session queries + mutations + `hasTrainingAccess`.
- **Create** `app/api/training/upload-url/route.ts`, `app/api/training/video-url/route.ts`.
- **Create** `app/training/page.tsx` + `components/training/*` (provider, segment list, video grid, modals).
- **Create** `app/training/present/[segmentId]/page.tsx` — projector mode.

---

## Task 1: `menu.training` permission (override-only) + access helpers

**Files:** Modify `lib/permissions.ts`, `convex/authGuards.ts`

- [ ] **Step 1: Add to `MenuPermissions` interface**
In `lib/permissions.ts`, the `MenuPermissions` interface ends with `iePriceSystem: boolean;` then `}`. Add before the closing brace:
```ts
  // Training (override-only — no tier grants it by default)
  training: boolean;
```

- [ ] **Step 2: Return it from `getMenuPermissions`**
In `getMenuPermissions`, add to the returned object (near the other menu keys):
```ts
    training: false, // override-only; granted per-user via permissionOverrides["menu.training"]
```

- [ ] **Step 3: Register in `ALL_PERMISSIONS`**
In the `ALL_PERMISSIONS` array, in the Personnel section (near `menu.onboardingDocs`), add:
```ts
  { key: "menu.training", label: "Training Library", description: "Access the Training video library and projector mode", category: "personnel" },
```

- [ ] **Step 4: Add `requireTrainingAccess` guard**
In `convex/authGuards.ts`, after `requireAdmin`, add:
```ts
/**
 * Throws unless the requesting user exists, is active, and has the override-only
 * `menu.training` permission. Training is not granted by any role tier — only by an
 * explicit per-user permissionOverrides["menu.training"] === true.
 */
export async function requireTrainingAccess(
  ctx: AnyCtx,
  requestingUserId: Id<"users">,
): Promise<void> {
  const user = await ctx.db.get(requestingUserId);
  if (!user) throw new Error("Unauthorized: requesting user not found");
  if (user.isActive === false) throw new Error("Unauthorized: account is inactive");
  const overrides = (user.permissionOverrides ?? {}) as Record<string, boolean>;
  if (overrides["menu.training"] !== true) {
    throw new Error("Unauthorized: training access is not granted for this account");
  }
}
```

- [ ] **Step 5: Typecheck & commit**
Run `cd /Users/andybarrows/IECentral && npx tsc --noEmit` (expect exit 0).
```bash
git add lib/permissions.ts convex/authGuards.ts
git commit -m "feat(training): add override-only menu.training permission + guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Sidebar Training item + page route guard

**Files:** Modify `components/Sidebar.tsx`

- [ ] **Step 1: Add the nav item**
In `components/Sidebar.tsx`, the `people-hr` nav group's `items` array (id `"people-hr"`, ~L45). Add at the end of the items array (read the array to place it after the last item):
```ts
      { href: "/training", label: "Training", section: "Training", icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" },
```

- [ ] **Step 2: Gate it in routePerms**
In the `routePerms` map (inside `filteredItems`, ~L579+), add:
```ts
                "/training": permissions.menu.training,
```

- [ ] **Step 3: Typecheck & commit**
Run `npx tsc --noEmit` (expect 0). (The page guard itself is added in Task 7; this task just wires the menu.)
```bash
git add components/Sidebar.tsx
git commit -m "feat(training): add Training item to People & HR nav (gated by menu.training)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Convex schema — training tables

**Files:** Modify `convex/schema.ts`

- [ ] **Step 1: Add three tables**
In `convex/schema.ts`, inside the `defineSchema({ ... })` object (alongside the other `defineTable` entries), add:
```ts
  trainingSegments: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    order: v.number(),
    isActive: v.boolean(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_order", ["order"]),

  trainingVideos: defineTable({
    segmentId: v.id("trainingSegments"),
    title: v.string(),
    s3Key: v.string(),
    order: v.number(),
    durationSec: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_segment", ["segmentId"]),

  trainingSessions: defineTable({
    segmentId: v.id("trainingSegments"),
    segmentTitle: v.string(),
    date: v.string(), // YYYY-MM-DD
    presenterId: v.id("users"),
    presenterName: v.string(),
    personnelAttendees: v.array(v.id("personnel")),
    guestAttendees: v.array(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_date", ["date"]),
```

- [ ] **Step 2: Typecheck & commit**
Run `npx tsc --noEmit` (expect 0). (Convex regenerates types on dev/build; tsc uses current generated types — if a generated-type error appears for the new tables, run `npx convex codegen` once, then re-run tsc. Report if codegen is unavailable.)
```bash
git add convex/schema.ts
git commit -m "feat(training): add trainingSegments/Videos/Sessions tables

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Convex `training.ts` — segments & videos + access query

**Files:** Create `convex/training.ts`

- [ ] **Step 1: Create the file with access query + segment/video CRUD**
Create `convex/training.ts`:
```ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireTrainingAccess } from "./authGuards";

// Lightweight check used by the API routes (does the user have training access?).
export const hasTrainingAccess = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.isActive === false) return false;
    const overrides = (user.permissionOverrides ?? {}) as Record<string, boolean>;
    return overrides["menu.training"] === true;
  },
});

export const listSegments = query({
  args: {},
  handler: async (ctx) => {
    const segments = await ctx.db.query("trainingSegments").withIndex("by_order").collect();
    return segments.sort((a, b) => a.order - b.order);
  },
});

export const createSegment = mutation({
  args: { title: v.string(), description: v.optional(v.string()), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireTrainingAccess(ctx, args.requestingUserId);
    const existing = await ctx.db.query("trainingSegments").collect();
    const maxOrder = existing.reduce((m, s) => Math.max(m, s.order), -1);
    const now = Date.now();
    return await ctx.db.insert("trainingSegments", {
      title: args.title, description: args.description, order: maxOrder + 1,
      isActive: true, createdBy: args.requestingUserId, createdAt: now, updatedAt: now,
    });
  },
});

export const updateSegment = mutation({
  args: { segmentId: v.id("trainingSegments"), title: v.optional(v.string()), description: v.optional(v.string()), order: v.optional(v.number()), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireTrainingAccess(ctx, args.requestingUserId);
    const { segmentId, requestingUserId: _r, ...rest } = args;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(rest)) if (val !== undefined) patch[k] = val;
    await ctx.db.patch(segmentId, patch);
    return segmentId;
  },
});

export const deleteSegment = mutation({
  args: { segmentId: v.id("trainingSegments"), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireTrainingAccess(ctx, args.requestingUserId);
    const vids = await ctx.db.query("trainingVideos").withIndex("by_segment", (q) => q.eq("segmentId", args.segmentId)).collect();
    for (const vid of vids) await ctx.db.delete(vid._id);
    await ctx.db.delete(args.segmentId);
    return { deletedVideos: vids.map((v) => v.s3Key) }; // caller deletes S3 objects best-effort
  },
});

export const listVideos = query({
  args: { segmentId: v.id("trainingSegments") },
  handler: async (ctx, args) => {
    const vids = await ctx.db.query("trainingVideos").withIndex("by_segment", (q) => q.eq("segmentId", args.segmentId)).collect();
    return vids.sort((a, b) => a.order - b.order);
  },
});

export const addVideo = mutation({
  args: { segmentId: v.id("trainingSegments"), title: v.string(), s3Key: v.string(), durationSec: v.optional(v.number()), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireTrainingAccess(ctx, args.requestingUserId);
    const existing = await ctx.db.query("trainingVideos").withIndex("by_segment", (q) => q.eq("segmentId", args.segmentId)).collect();
    const maxOrder = existing.reduce((m, v2) => Math.max(m, v2.order), -1);
    return await ctx.db.insert("trainingVideos", {
      segmentId: args.segmentId, title: args.title, s3Key: args.s3Key, order: maxOrder + 1,
      durationSec: args.durationSec, createdBy: args.requestingUserId, createdAt: Date.now(),
    });
  },
});

export const updateVideo = mutation({
  args: { videoId: v.id("trainingVideos"), title: v.optional(v.string()), order: v.optional(v.number()), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireTrainingAccess(ctx, args.requestingUserId);
    const { videoId, requestingUserId: _r, ...rest } = args;
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) if (val !== undefined) patch[k] = val;
    await ctx.db.patch(videoId, patch);
    return videoId;
  },
});

export const deleteVideo = mutation({
  args: { videoId: v.id("trainingVideos"), requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireTrainingAccess(ctx, args.requestingUserId);
    const vid = await ctx.db.get(args.videoId);
    await ctx.db.delete(args.videoId);
    return { s3Key: vid?.s3Key }; // caller deletes S3 object best-effort
  },
});
```

- [ ] **Step 2: Typecheck & commit**
Run `npx tsc --noEmit` (expect 0).
```bash
git add convex/training.ts
git commit -m "feat(training): convex segment/video CRUD + hasTrainingAccess

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Convex `training.ts` — session logging + completion

**Files:** Modify `convex/training.ts`

- [ ] **Step 1: Append session query + logSession mutation**
Append to `convex/training.ts`:
```ts
export const listSessions = query({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.db.query("trainingSessions").withIndex("by_date").collect();
    return sessions.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  },
});

// Log a training session and record completion on each selected personnel record.
export const logSession = mutation({
  args: {
    segmentId: v.id("trainingSegments"),
    date: v.string(),
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

    // Write a training record on each personnel attendee (sets certifiedBy = presenter).
    for (const personnelId of args.personnelAttendees) {
      const p = await ctx.db.get(personnelId);
      if (!p) continue;
      const area = segment.title;
      const records = (p.trainingRecords ?? []).filter((r) => r.area !== area);
      records.push({ area, completedAt: now, certifiedBy: args.requestingUserId });
      const legacy = Array.from(new Set([...(p.completedTraining ?? []), area]));
      await ctx.db.patch(personnelId, { trainingRecords: records, completedTraining: legacy, updatedAt: now });
    }

    return await ctx.db.insert("trainingSessions", {
      segmentId: args.segmentId, segmentTitle: segment.title, date: args.date,
      presenterId: args.requestingUserId, presenterName: presenter?.name ?? "Unknown",
      personnelAttendees: args.personnelAttendees, guestAttendees: args.guestAttendees,
      notes: args.notes, createdAt: now,
    });
  },
});
```

- [ ] **Step 2: Typecheck & commit**
Run `npx tsc --noEmit` (expect 0). (Confirm `trainingRecords` items accept `certifiedBy` — the schema field exists.)
```bash
git add convex/training.ts
git commit -m "feat(training): logSession writes attendance + personnel training records

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: S3 API routes — upload + playback (access-gated)

**Files:** Create `app/api/training/upload-url/route.ts`, `app/api/training/video-url/route.ts`

- [ ] **Step 1: Upload URL route**
Create `app/api/training/upload-url/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export const maxDuration = 30;

// Dedicated training bucket when TRAINING_S3_BUCKET is set; otherwise a segmented
// prefix in the shared bucket. Switching to a dedicated bucket later = set the env var only.
const BUCKET = process.env.TRAINING_S3_BUCKET || "ietires-dunlop-jmk-uploads";
const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }
    : {}),
});
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function POST(request: NextRequest) {
  try {
    const { filename, contentType, userId } = await request.json();
    if (!filename || !userId) return NextResponse.json({ error: "filename and userId required" }, { status: 400 });
    const ok = await convex.query(api.training.hasTrainingAccess, { userId: userId as Id<"users"> });
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const sanitized = String(filename).replace(/[^a-zA-Z0-9._() -]/g, "_");
    const rand = Math.abs(Array.from(sanitized).reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, Date.parse(new Date().toISOString()) & 0xffff));
    const key = `training/videos/${rand}-${sanitized}`;
    const command = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType || "video/mp4" });
    const url = await getSignedUrl(s3, command, { expiresIn: 900 });
    return NextResponse.json({ url, key });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Playback URL route**
Create `app/api/training/video-url/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const BUCKET = process.env.TRAINING_S3_BUCKET || "ietires-dunlop-jmk-uploads";
const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }
    : {}),
});
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// GET /api/training/video-url?key=training/videos/...&userId=...
export async function GET(request: NextRequest) {
  try {
    const key = request.nextUrl.searchParams.get("key");
    const userId = request.nextUrl.searchParams.get("userId");
    if (!key || !key.startsWith("training/videos/")) return NextResponse.json({ error: "valid key required" }, { status: 400 });
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
    const ok = await convex.query(api.training.hasTrainingAccess, { userId: userId as Id<"users"> });
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const url = await getSignedUrl(s3, command, { expiresIn: 60 * 60 * 4 }); // 4h — long enough for a session; supports Range
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Typecheck & commit**
Run `npx tsc --noEmit` (expect 0).
```bash
git add app/api/training/upload-url/route.ts app/api/training/video-url/route.ts
git commit -m "feat(training): S3 presigned upload + access-gated playback routes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Training library page + components

**Files:** Create `app/training/page.tsx`, `components/training/TrainingLibrary.tsx`, `components/training/VideoPlayerModal.tsx`

This mirrors the Doc Hub page shell. Read `app/documents/page.tsx`, `app/personnel/page.tsx` (for `usePermissions`/`useAuth` usage and theme classes), and `app/reports/insurance-eligibility/page.tsx` for the header/Protected pattern.

- [ ] **Step 1: Player modal component**
Create `components/training/VideoPlayerModal.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/app/auth-context";

export default function VideoPlayerModal({ s3Key, title, onClose }: { s3Key: string; title: string; onClose: () => void }) {
  const { user } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!user) return;
    fetch(`/api/training/video-url?key=${encodeURIComponent(s3Key)}&userId=${user._id}`)
      .then((r) => r.json())
      .then((d) => (d.url ? setUrl(d.url) : setError(d.error || "Failed to load video")))
      .catch(() => setError("Failed to load video"));
  }, [s3Key, user]);
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-black rounded-xl w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2 text-white">
          <span className="font-medium truncate">{title}</span>
          <button onClick={onClose} className="px-2 py-1 text-sm">✕</button>
        </div>
        {error ? <div className="p-8 text-center text-red-400">{error}</div>
          : url ? <video src={url} controls autoPlay className="w-full max-h-[80vh] rounded-b-xl" />
          : <div className="p-8 text-center text-slate-400">Loading…</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Library component**
Create `components/training/TrainingLibrary.tsx`. It: lists segments (`api.training.listSegments`), lets the user select one, lists its videos (`api.training.listVideos`), supports create-segment, upload-video (presigned PUT flow), play (opens `VideoPlayerModal`), launch projector (`/training/present/<id>`), and a "Log session" button (opens the Task 9 modal). Upload flow:
```tsx
"use client";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/app/auth-context";
import Link from "next/link";
import VideoPlayerModal from "./VideoPlayerModal";

export default function TrainingLibrary() {
  const { user } = useAuth();
  const segments = useQuery(api.training.listSegments) || [];
  const [activeSegment, setActiveSegment] = useState<Id<"trainingSegments"> | null>(null);
  const videos = useQuery(api.training.listVideos, activeSegment ? { segmentId: activeSegment } : "skip") || [];
  const createSegment = useMutation(api.training.createSegment);
  const addVideo = useMutation(api.training.addVideo);
  const [playing, setPlaying] = useState<{ s3Key: string; title: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (file: File) => {
    if (!user || !activeSegment) return;
    setUploading(true);
    try {
      const res = await fetch("/api/training/upload-url", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, userId: user._id }),
      });
      const { url, key, error } = await res.json();
      if (!url) throw new Error(error || "Upload URL failed");
      const put = await fetch(url, { method: "PUT", headers: { "Content-Type": file.type || "video/mp4" }, body: file });
      if (!put.ok) throw new Error("Upload to storage failed");
      await addVideo({ segmentId: activeSegment, title: file.name.replace(/\.[^.]+$/, ""), s3Key: key, requestingUserId: user._id });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Upload failed");
    } finally { setUploading(false); }
  };

  return (
    <div className="flex gap-6 p-6">
      {/* Segment list */}
      <div className="w-64 shrink-0 space-y-2">
        <button onClick={async () => {
          const title = prompt("New segment title");
          if (title && user) await createSegment({ title, requestingUserId: user._id });
        }} className="w-full px-3 py-2 rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: "#007AFF" }}>+ New Segment</button>
        {segments.map((s) => (
          <button key={s._id} onClick={() => setActiveSegment(s._id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm ${activeSegment === s._id ? "bg-[#007AFF]/10 text-[#007AFF]" : "theme-bg-hover theme-text-secondary"}`}>{s.title}</button>
        ))}
      </div>
      {/* Videos */}
      <div className="flex-1">
        {!activeSegment ? <p className="theme-text-muted">Select a segment.</p> : (
          <>
            <div className="flex items-center gap-3 mb-4">
              <Link href={`/training/present/${activeSegment}`} className="px-3 py-1.5 rounded-full text-xs font-semibold text-white" style={{ backgroundColor: "#111" }}>▶ Projector mode</Link>
              <label className="px-3 py-1.5 rounded-full text-xs font-semibold text-[#007AFF] bg-[#007AFF]/10 cursor-pointer">
                {uploading ? "Uploading…" : "+ Upload video"}
                <input type="file" accept="video/*" className="hidden" disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.currentTarget.value = ""; }} />
              </label>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {videos.map((vid) => (
                <button key={vid._id} onClick={() => setPlaying({ s3Key: vid.s3Key, title: vid.title })}
                  className="theme-bg-card border theme-border-primary rounded-xl p-4 text-left hover:shadow-md transition">
                  <div className="text-3xl mb-2">🎬</div>
                  <div className="text-sm font-medium theme-text-primary truncate">{vid.title}</div>
                </button>
              ))}
              {videos.length === 0 && <p className="theme-text-muted text-sm col-span-full">No videos yet — upload one.</p>}
            </div>
          </>
        )}
      </div>
      {playing && <VideoPlayerModal s3Key={playing.s3Key} title={playing.title} onClose={() => setPlaying(null)} />}
    </div>
  );
}
```

- [ ] **Step 3: Page shell with access guard**
Create `app/training/page.tsx`:
```tsx
"use client";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { usePermissions } from "@/lib/usePermissions";
import Link from "next/link";
import TrainingLibrary from "@/components/training/TrainingLibrary";

function Content() {
  const permissions = usePermissions();
  if (permissions.isLoading) return <div className="p-8 theme-text-muted">Loading…</div>;
  if (!permissions.menu.training) {
    return <div className="p-8"><p className="theme-text-primary font-medium">You don’t have access to Training.</p><Link href="/" className="text-[#007AFF] text-sm">Back to dashboard</Link></div>;
  }
  return (
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        <header className="sticky top-0 z-10 border-b theme-border-primary theme-bg-card px-6 py-4">
          <h1 className="text-xl font-bold theme-text-primary">Training</h1>
          <p className="text-xs theme-text-muted">TIA training videos · authorized presenters only</p>
        </header>
        <TrainingLibrary />
      </main>
    </div>
  );
}

export default function TrainingPage() {
  return <Protected><Content /></Protected>;
}
```

- [ ] **Step 4: Typecheck & commit**
Run `npx tsc --noEmit` (expect 0). If `theme-*` utility classes differ, mirror the exact classes used in `app/personnel/page.tsx`.
```bash
git add app/training/page.tsx components/training/VideoPlayerModal.tsx components/training/TrainingLibrary.tsx
git commit -m "feat(training): library page (segments, upload, play) gated by menu.training

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Projector mode

**Files:** Create `app/training/present/[segmentId]/page.tsx`

- [ ] **Step 1: Fullscreen player**
Create `app/training/present/[segmentId]/page.tsx`:
```tsx
"use client";
import { use, useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { usePermissions } from "@/lib/usePermissions";
import { useAuth } from "@/app/auth-context";
import Link from "next/link";

export default function PresentPage({ params }: { params: Promise<{ segmentId: string }> }) {
  const { segmentId } = use(params);
  const { user } = useAuth();
  const permissions = usePermissions();
  const videos = useQuery(api.training.listVideos, { segmentId: segmentId as Id<"trainingSegments"> }) || [];
  const [idx, setIdx] = useState(0);
  const [url, setUrl] = useState<string | null>(null);

  const current = videos[idx];
  useEffect(() => {
    if (!current || !user) { setUrl(null); return; }
    fetch(`/api/training/video-url?key=${encodeURIComponent(current.s3Key)}&userId=${user._id}`)
      .then((r) => r.json()).then((d) => setUrl(d.url || null)).catch(() => setUrl(null));
  }, [current, user]);

  if (!permissions.isLoading && !permissions.menu.training) return <div className="p-8 text-white bg-black h-screen">No access. <Link href="/" className="underline">Home</Link></div>;

  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 text-sm">
        <Link href="/training" className="text-slate-400 hover:text-white">← Exit</Link>
        <span className="truncate">{current?.title ?? "No videos"}</span>
        <span className="text-slate-500">{videos.length ? `${idx + 1} / ${videos.length}` : ""}</span>
      </div>
      <div className="flex-1 flex items-center justify-center">
        {url ? (
          <video key={current?._id} src={url} controls autoPlay className="max-h-full max-w-full"
            onEnded={() => { if (idx < videos.length - 1) setIdx(idx + 1); }} />
        ) : <div className="text-slate-500">{videos.length ? "Loading…" : "This segment has no videos."}</div>}
      </div>
      <div className="flex items-center justify-center gap-4 py-3">
        <button onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0} className="px-4 py-2 rounded-lg bg-white/10 disabled:opacity-30">◀ Prev</button>
        <button onClick={() => setIdx(Math.min(videos.length - 1, idx + 1))} disabled={idx >= videos.length - 1} className="px-4 py-2 rounded-lg bg-white/10 disabled:opacity-30">Next ▶</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck & commit**
Run `npx tsc --noEmit` (expect 0).
```bash
git add "app/training/present/[segmentId]/page.tsx"
git commit -m "feat(training): fullscreen projector mode with segment playlist

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Session logging modal + history

**Files:** Create `components/training/LogSessionModal.tsx`; Modify `components/training/TrainingLibrary.tsx`

- [ ] **Step 1: Log-session modal**
Create `components/training/LogSessionModal.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/app/auth-context";

export default function LogSessionModal({ segmentId, onClose }: { segmentId: Id<"trainingSegments">; onClose: () => void }) {
  const { user } = useAuth();
  const personnel = useQuery(api.personnel.list, { status: "active" }) || [];
  const logSession = useMutation(api.training.logSession);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [guests, setGuests] = useState<string[]>([]);
  const [guestInput, setGuestInput] = useState("");
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await logSession({
        segmentId, date,
        personnelAttendees: [...selected] as Id<"personnel">[],
        guestAttendees: guests,
        requestingUserId: user._id,
      });
      onClose();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed to log session"); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-3">Log training session</h3>
        <label className="block text-sm font-medium mb-1">Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg mb-3" />
        <label className="block text-sm font-medium mb-1">Attendees (employees)</label>
        <div className="max-h-48 overflow-y-auto border rounded-lg p-2 mb-3">
          {personnel.map((p) => (
            <label key={p._id} className="flex items-center gap-2 py-1 text-sm">
              <input type="checkbox" checked={selected.has(p._id)} onChange={() => toggle(p._id)} />
              {p.lastName}, {p.firstName}
            </label>
          ))}
        </div>
        <label className="block text-sm font-medium mb-1">Guests not in the system</label>
        <div className="flex gap-2 mb-2">
          <input value={guestInput} onChange={(e) => setGuestInput(e.target.value)} placeholder="Type a name" className="flex-1 px-3 py-2 border rounded-lg" />
          <button onClick={() => { if (guestInput.trim()) { setGuests([...guests, guestInput.trim()]); setGuestInput(""); } }} className="px-3 py-2 rounded-lg bg-gray-100 text-sm">Add</button>
        </div>
        <div className="flex flex-wrap gap-1 mb-4">
          {guests.map((g, i) => <span key={i} className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">{g} <button onClick={() => setGuests(guests.filter((_, j) => j !== i))}>✕</button></span>)}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-100 text-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "#007AFF" }}>{saving ? "Saving…" : "Log session"}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into the library**
In `components/training/TrainingLibrary.tsx`, import `LogSessionModal`, add `const [logging, setLogging] = useState(false);`, add a "Log session" button next to the projector/upload buttons (shown when a segment is active) that calls `setLogging(true)`, and render `{logging && activeSegment && <LogSessionModal segmentId={activeSegment} onClose={() => setLogging(false)} />}`. Also add a small **session history** list under the videos using `const sessions = useQuery(api.training.listSessions) || [];` filtered to the active segment, showing date · presenter · (`personnelAttendees.length + guestAttendees.length`) attendees.

- [ ] **Step 3: Typecheck & commit**
Run `npx tsc --noEmit` (expect 0).
```bash
git add components/training/LogSessionModal.tsx components/training/TrainingLibrary.tsx
git commit -m "feat(training): log-session modal (personnel + guests) and history

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: End-to-end manual verification

**Files:** none

- [ ] **Step 1: Build** — `cd /Users/andybarrows/IECentral && npx next build 2>&1 | tail -15` — completes, no errors.
- [ ] **Step 2: Access gating** — Without `menu.training`, confirm no Training nav item and `/training` shows "no access". Grant `menu.training` to a test user in `/users`; the item appears and the page loads.
- [ ] **Step 3: Segment + upload** — create a segment; upload a small `.mp4`; it appears as a card and plays in the modal.
- [ ] **Step 4: Projector mode** — open projector mode; video plays fullscreen; Next/Prev work; autoplay advances on end.
- [ ] **Step 5: Log session** — log a session with one personnel attendee + one guest name; confirm (a) the session appears in history with the attendee count, and (b) the personnel attendee's profile shows the training (area = segment title, `certifiedBy` set).
- [ ] **Step 6: Negative auth** — hit `/api/training/video-url?key=training/videos/...&userId=<non-granted user>` and confirm 403.

---

## Self-Review Notes
- **Spec coverage:** override-only permission (T1) ✓ sidebar item + page guard (T2/T7) ✓ schema (T3) ✓ segment/video CRUD (T4) ✓ session logging writing personnel records + certifiedBy (T5) ✓ S3 upload + access-gated playback (T6) ✓ library UI segments/upload/play (T7) ✓ projector mode (T8) ✓ guests + history (T9) ✓ manual tests (T10) ✓.
- **Type consistency:** field/arg names (`segmentId`, `s3Key`, `personnelAttendees`, `guestAttendees`, `requestingUserId`) consistent across schema, `convex/training.ts`, API routes, and components. `hasTrainingAccess`/`requireTrainingAccess` used consistently. `menu.training` identical in permissions, sidebar, guards, page.
- **Scheduling/sizing notes:** Single presigned PUT covers ≤ 5 GB (spec out-of-scope: multipart). Playback URL is 4 h and Range-capable for projector seeking. S3 object deletion on segment/video delete is best-effort (mutations return the `s3Key`s; a follow-up could call a delete route — not required for v1).
