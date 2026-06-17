"use client";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/app/auth-context";
import Link from "next/link";
import VideoPlayerModal from "./VideoPlayerModal";
import LogSessionModal from "./LogSessionModal";

export default function TrainingLibrary() {
  const { user } = useAuth();
  const segments = useQuery(api.training.listSegments, user ? { requestingUserId: user._id } : "skip") || [];
  const [activeSegment, setActiveSegment] = useState<Id<"trainingSegments"> | null>(null);
  const videos = useQuery(api.training.listVideos, activeSegment && user ? { segmentId: activeSegment, requestingUserId: user._id } : "skip") || [];
  const createSegment = useMutation(api.training.createSegment);
  const addVideo = useMutation(api.training.addVideo);
  const sessions = useQuery(api.training.listSessions, user ? { requestingUserId: user._id } : "skip") || [];
  const [playing, setPlaying] = useState<{ s3Key: string; title: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [logging, setLogging] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const roster = useQuery(api.training.segmentRoster, activeSegment && user ? { segmentId: activeSegment, requestingUserId: user._id } : "skip") || [];

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
              <Link href={`/training/present/${activeSegment}`} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold" style={{ backgroundColor: "#111827", color: "#ffffff" }}>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
                Projector Mode
              </Link>
              <label className="px-3 py-1.5 rounded-full text-xs font-semibold text-[#007AFF] bg-[#007AFF]/10 cursor-pointer">
                {uploading ? "Uploading…" : "+ Upload video"}
                <input type="file" accept="video/*" className="hidden" disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.currentTarget.value = ""; }} />
              </label>
              <button onClick={() => setLogging(true)} className="px-3 py-1.5 rounded-full text-xs font-semibold text-amber-700 bg-amber-100">Log session</button>
              <button onClick={() => setShowRoster((v) => !v)} className="px-3 py-1.5 rounded-full text-xs font-semibold theme-text-secondary theme-bg-hover">{showRoster ? "Hide roster" : "Roster"}</button>
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
            <div className="mt-6">
              <h3 className="text-sm font-semibold theme-text-secondary mb-2">Session history</h3>
              {sessions.filter((s) => s.segmentId === activeSegment).length === 0 ? (
                <p className="theme-text-muted text-xs">No sessions logged yet.</p>
              ) : (
                <ul className="space-y-1">
                  {sessions.filter((s) => s.segmentId === activeSegment).map((s) => (
                    <li key={s._id} className="text-xs theme-text-secondary">
                      {s.date} · {s.presenterName} · {s.personnelAttendees.length + s.guestAttendees.length} attendees
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
      {playing && <VideoPlayerModal s3Key={playing.s3Key} title={playing.title} onClose={() => setPlaying(null)} />}
      {logging && activeSegment && <LogSessionModal segmentId={activeSegment} onClose={() => setLogging(false)} />}
    </div>
  );
}
