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
