"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useDocHub } from "./DocHubContext";

// Standalone Doc Hub groups manager (admin+ only). See every group at a glance and
// add/remove members; folder access follows group membership.
export default function GroupsModal() {
  const { isDark, user, isAdmin, usersForSharing, showGroupsModal, setShowGroupsModal } = useDocHub();
  const groups = useQuery(api.groups.list, showGroupsModal ? {} : "skip");
  const createGroup = useMutation(api.groups.create);
  const addMembers = useMutation(api.groups.addMembers);
  const removeMember = useMutation(api.groups.removeMember);
  const archiveGroup = useMutation(api.groups.archive);

  const [expandedId, setExpandedId] = useState<Id<"groups"> | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [addPick, setAddPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (!showGroupsModal || !isAdmin) return null;

  const nameOf = (id: string) => usersForSharing?.find((u) => u._id === id)?.name ?? "Unknown user";
  const close = () => { setShowGroupsModal(false); setExpandedId(null); setShowCreate(false); setNewName(""); };

  const handleCreate = async () => {
    if (!newName.trim() || !user) return;
    setBusy(true);
    try {
      await createGroup({ name: newName.trim(), color: newColor, memberIds: [], createdBy: user._id, createdByName: user.name });
      setNewName(""); setNewColor("#3b82f6"); setShowCreate(false);
    } catch (e) { console.error("Create group failed:", e); } finally { setBusy(false); }
  };
  const handleAdd = async (groupId: Id<"groups">) => {
    const uid = addPick[groupId];
    if (!uid || !user) return;
    setBusy(true);
    try {
      await addMembers({ groupId, userIds: [uid as Id<"users">], requestingUserId: user._id });
      setAddPick((p) => ({ ...p, [groupId]: "" }));
    } catch (e) { console.error("Add member failed:", e); } finally { setBusy(false); }
  };
  const handleRemove = async (groupId: Id<"groups">, uid: Id<"users">) => {
    if (!user) return;
    setBusy(true);
    try { await removeMember({ groupId, userId: uid, requestingUserId: user._id }); }
    catch (e) { console.error("Remove member failed:", e); } finally { setBusy(false); }
  };
  const handleArchive = async (groupId: Id<"groups">, name: string) => {
    if (!user) return;
    if (!confirm(`Archive group "${name}"? Members lose any folder access granted through it.`)) return;
    setBusy(true);
    try { await archiveGroup({ groupId, requestingUserId: user._id }); if (expandedId === groupId) setExpandedId(null); }
    catch (e) { console.error("Archive group failed:", e); } finally { setBusy(false); }
  };

  const card = isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200";
  const subtext = isDark ? "text-slate-400" : "text-gray-500";
  const inputCls = `px-3 py-1.5 text-sm rounded-lg border focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white placeholder-slate-500" : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"}`;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`border rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden ${card}`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
          <div>
            <h2 className={`text-base font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Doc Hub Groups</h2>
            <p className={`text-[11px] ${subtext}`}>Add people to a group to grant them the folders shared with it.</p>
          </div>
          <button onClick={close} className={`p-1.5 rounded-lg ${isDark ? "text-slate-400 hover:bg-slate-700" : "text-gray-400 hover:bg-gray-100"}`} aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {/* Create */}
          {showCreate ? (
            <div className={`p-3 rounded-xl mb-2 flex items-center gap-2 ${isDark ? "bg-slate-900/50 border border-slate-700/50" : "bg-gray-50 border border-gray-200"}`}>
              <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="w-8 h-8 rounded-lg cursor-pointer border-0 p-0 flex-shrink-0" />
              <input type="text" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Group name (e.g. Managers)" className={`flex-1 ${inputCls}`} />
              <button onClick={handleCreate} disabled={!newName.trim() || busy} className={`px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50 ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}>Create</button>
              <button onClick={() => { setShowCreate(false); setNewName(""); }} className={`px-2 py-1.5 text-xs rounded-lg ${subtext}`}>Cancel</button>
            </div>
          ) : (
            <button onClick={() => setShowCreate(true)} className={`w-full px-3 py-2 text-sm font-medium rounded-lg border border-dashed ${isDark ? "border-slate-600 text-slate-300 hover:bg-slate-700/40" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>+ New group</button>
          )}

          {groups === undefined && <p className={`text-sm text-center py-6 ${subtext}`}>Loading groups…</p>}
          {groups && groups.length === 0 && <p className={`text-sm text-center py-6 ${subtext}`}>No groups yet.</p>}

          {groups?.map((g) => {
            const expanded = expandedId === g._id;
            const available = (usersForSharing ?? []).filter((u) => !g.memberIds.includes(u._id));
            return (
              <div key={g._id} className={`rounded-xl border ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button onClick={() => setExpandedId(expanded ? null : g._id)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                    {g.color && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />}
                    <span className={`text-sm font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>{g.name}</span>
                    <span className={`text-[11px] ${subtext}`}>({g.memberIds.length})</span>
                  </button>
                  <button onClick={() => setExpandedId(expanded ? null : g._id)} className={`text-xs font-medium ${isDark ? "text-cyan-400" : "text-blue-600"}`}>{expanded ? "Hide" : "Members"}</button>
                  <button onClick={() => handleArchive(g._id, g.name)} disabled={busy} title="Archive group" className={`p-1 rounded ${isDark ? "text-slate-500 hover:text-red-400" : "text-gray-400 hover:text-red-500"}`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M10 12v4m4-4v4M5 8l1 11a2 2 0 002 2h8a2 2 0 002-2l1-11M9 8V5a1 1 0 011-1h4a1 1 0 011 1v3" /></svg>
                  </button>
                </div>
                {expanded && (
                  <div className={`px-3 pb-3 space-y-2 border-t ${isDark ? "border-slate-700/60" : "border-gray-100"}`}>
                    <div className="space-y-1 pt-2">
                      {g.memberIds.length === 0 && <p className={`text-xs ${subtext}`}>No members yet.</p>}
                      {g.memberIds.map((mid) => (
                        <div key={mid} className="flex items-center justify-between">
                          <span className={`text-xs ${isDark ? "text-slate-300" : "text-gray-700"}`}>{nameOf(mid)}</span>
                          <button onClick={() => handleRemove(g._id, mid)} disabled={busy} className={`text-[11px] ${isDark ? "text-slate-500 hover:text-red-400" : "text-gray-400 hover:text-red-500"}`}>Remove</button>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <select value={addPick[g._id] ?? ""} onChange={(e) => setAddPick((p) => ({ ...p, [g._id]: e.target.value }))} className={`flex-1 ${inputCls}`}>
                        <option value="">Add a person…</option>
                        {available.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
                      </select>
                      <button onClick={() => handleAdd(g._id)} disabled={!addPick[g._id] || busy} className={`px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50 ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}>Add</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
