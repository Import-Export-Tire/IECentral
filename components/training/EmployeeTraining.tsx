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
          onEnded={async () => { try { await markComplete({ userId: user._id, videoId: playing.videoId }); } catch (e) { console.error("Failed to record training completion:", e); } }} />
      )}
    </div>
  );
}
