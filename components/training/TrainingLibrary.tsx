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
