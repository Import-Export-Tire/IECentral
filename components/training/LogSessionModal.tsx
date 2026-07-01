"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/app/auth-context";

export default function LogSessionModal({ segmentId, onClose }: { segmentId: Id<"trainingSegments">; onClose: () => void }) {
  const { user } = useAuth();
  const personnel = useQuery(api.personnel.listOptions) || [];
  const videos = useQuery(api.training.listVideos, user ? { segmentId, requestingUserId: user._id } : "skip") || [];
  const logSession = useMutation(api.training.logSession);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());
  const [guests, setGuests] = useState<string[]>([]);
  const [guestInput, setGuestInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Pre-check all videos once they load.
  useEffect(() => {
    if (videos.length > 0) setSelectedVideos(new Set(videos.map((v) => v._id)));
  }, [videos.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleVideo = (id: string) => setSelectedVideos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await logSession({
        segmentId, date,
        videoIds: [...selectedVideos] as Id<"trainingVideos">[],
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
        {videos.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium">Videos covered</label>
              <button type="button" onClick={() => setSelectedVideos(new Set(videos.map((v) => v._id)))} className="text-xs text-[#007AFF]">Select all</button>
            </div>
            <div className="max-h-36 overflow-y-auto border rounded-lg p-2 mb-3">
              {videos.map((v) => (
                <label key={v._id} className="flex items-center gap-2 py-1 text-sm">
                  <input type="checkbox" checked={selectedVideos.has(v._id)} onChange={() => toggleVideo(v._id)} />
                  {v.title}
                </label>
              ))}
            </div>
          </>
        )}
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
