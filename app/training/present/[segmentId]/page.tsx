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
