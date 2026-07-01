"use client";

import { useState, useEffect } from "react";
import { useDocHub } from "./DocHubContext";
import { Id } from "@/convex/_generated/dataModel";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

export default function ShareAccessModal() {
  const {
    isDark, user, isAdmin, shareFolderId, setShareFolderId,
    folderAccessGrants, usersForSharing,
    handleGrantAccess, handleRevokeAccess, handleUpdateFolder,
    // Share document
    shareDocumentId, setShareDocumentId,
    handleTogglePublic, getPublicUrl,
    documents, folderDocuments,
  } = useDocHub();

  const [selectedUserId, setSelectedUserId] = useState<Id<"users"> | "">("");
  const [granting, setGranting] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Inline group creation
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("#3b82f6");
  const [newGroupMembers, setNewGroupMembers] = useState<Id<"users">[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  // Group editing
  const [editingGroupId, setEditingGroupId] = useState<Id<"groups"> | null>(null);

  // Groups data
  const allGroups = useQuery(api.groups.list);
  const updateFolderSharedGroups = useMutation(api.documentFolders.updateSharedGroups);
  const createGroupMutation = useMutation(api.groups.create);
  const updateGroupMutation = useMutation(api.groups.update);
  const addGroupMembers = useMutation(api.groups.addMembers);
  const removeGroupMember = useMutation(api.groups.removeMember);
  const archiveGroupMutation = useMutation(api.groups.archive);

  // Fetch current folder data when modal is open
  const folderData = useQuery(
    api.documentFolders.getById,
    shareFolderId ? { folderId: shareFolderId } : "skip"
  );

  const [folderVisibility, setFolderVisibility] = useState<string>("private");
  const [savingVisibility, setSavingVisibility] = useState(false);

  // Sync folder visibility when data loads
  useEffect(() => {
    if (folderData) {
      setFolderVisibility(folderData.visibility || "private");
    }
  }, [folderData]);

  // === FOLDER ACCESS MODAL ===
  if (shareFolderId) {
    const activeGrants = folderAccessGrants?.filter(g => !g.isRevoked) || [];

    const handleGrant = async () => {
      if (!selectedUserId || selectedUserId === "") return;
      setGranting(true);
      try {
        await handleGrantAccess(shareFolderId, selectedUserId as Id<"users">);
        setSelectedUserId("");
      } finally {
        setGranting(false);
      }
    };

    const handleVisibilityChange = async (newVis: string) => {
      setFolderVisibility(newVis);
      setSavingVisibility(true);
      try {
        await handleUpdateFolder(
          shareFolderId,
          folderData?.name || "",
          folderData?.description || "",
          newVis
        );
      } finally {
        setSavingVisibility(false);
      }
    };

    const close = () => {
      setShareFolderId(null);
      setSelectedUserId("");
    };

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={close}>
        <div className={`absolute inset-0 ${isDark ? "bg-black/70" : "bg-black/40"} backdrop-blur-sm`} />

        <div
          onClick={(e) => e.stopPropagation()}
          className={`relative w-full max-w-md mx-4 rounded-2xl overflow-hidden ${
            isDark ? "bg-slate-900 border border-slate-700" : "bg-white border border-gray-200 shadow-2xl"
          }`}
        >
          {/* Header */}
          <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
            <div>
              <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Who can see this?</h2>
              {folderData && (
                <p className={`text-xs mt-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>{folderData.name}</p>
              )}
            </div>
            <button onClick={close} className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-6 space-y-5">
            {/* Folder Visibility */}
            <div>
              <label className={`block text-xs font-medium mb-2 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                Who can see this folder? {savingVisibility && <span className="ml-1 opacity-60">Saving…</span>}
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleVisibilityChange("private")}
                  className={`px-3 py-2.5 text-xs font-medium rounded-xl border transition-all text-center ${
                    folderVisibility === "private"
                      ? isDark ? "bg-slate-700/80 border-slate-500 text-white" : "bg-gray-100 border-gray-400 text-gray-900"
                      : isDark ? "border-slate-700 text-slate-400 hover:border-slate-600" : "border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  <svg className="w-4 h-4 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Only me
                </button>
                <button
                  onClick={() => handleVisibilityChange("internal")}
                  className={`px-3 py-2.5 text-xs font-medium rounded-xl border transition-all text-center ${
                    folderVisibility === "internal"
                      ? isDark ? "bg-blue-500/20 border-blue-500/40 text-blue-400" : "bg-blue-50 border-blue-300 text-blue-700"
                      : isDark ? "border-slate-700 text-slate-400 hover:border-slate-600" : "border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  <svg className="w-4 h-4 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  Specific people
                </button>
                <button
                  onClick={() => handleVisibilityChange("community")}
                  className={`px-3 py-2.5 text-xs font-medium rounded-xl border transition-all text-center ${
                    folderVisibility === "community"
                      ? isDark ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400" : "bg-emerald-50 border-emerald-300 text-emerald-700"
                      : isDark ? "border-slate-700 text-slate-400 hover:border-slate-600" : "border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  <svg className="w-4 h-4 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064" />
                  </svg>
                  Everyone
                </button>
              </div>
              <p className={`text-xs mt-1.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                {folderVisibility === "private" && "Only you can see this folder. Add specific people or groups below to share it."}
                {folderVisibility === "internal" && "Only the specific people and groups you choose below can see this folder."}
                {folderVisibility === "community" && "Everyone at the company can see this folder."}
              </p>
            </div>

            {/* Divider */}
            <div className={`border-t ${isDark ? "border-slate-700/50" : "border-gray-100"}`} />

            {/* Share with groups */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                  Groups
                </label>
                {isAdmin && (
                <button
                  onClick={() => {
                    setShowCreateGroup(!showCreateGroup);
                    setEditingGroupId(null);
                    setNewGroupName("");
                    setNewGroupColor("#3b82f6");
                    setNewGroupMembers([]);
                  }}
                  className={`text-xs font-medium flex items-center gap-1 transition-colors ${
                    isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"
                  }`}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New Group
                </button>
                )}
              </div>

              {/* Inline create/edit group */}
              {(showCreateGroup || editingGroupId) && (
                <div className={`p-3 rounded-xl mb-3 space-y-3 ${isDark ? "bg-slate-800/60 border border-slate-700/50" : "bg-gray-50 border border-gray-200"}`}>
                  <div className="flex gap-2">
                    {/* Color picker */}
                    <div className="flex flex-col items-center gap-1">
                      <input
                        type="color"
                        value={newGroupColor}
                        onChange={(e) => setNewGroupColor(e.target.value)}
                        className="w-8 h-8 rounded-lg cursor-pointer border-0 p-0"
                      />
                    </div>
                    <input
                      type="text"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="Group name (e.g. Management, Warehouse)"
                      className={`flex-1 px-3 py-1.5 text-sm rounded-lg border focus:outline-none focus:ring-1 ${
                        isDark
                          ? "bg-slate-900/50 border-slate-600 text-white placeholder-slate-500 focus:ring-cyan-500/50"
                          : "bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-blue-500/50"
                      }`}
                      autoFocus
                    />
                  </div>

                  {/* Member selection */}
                  <div>
                    <label className={`text-[11px] font-medium mb-1 block ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      Members ({newGroupMembers.length} selected)
                    </label>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {usersForSharing?.map(u => {
                        const isMember = newGroupMembers.includes(u._id);
                        return (
                          <button
                            key={u._id}
                            type="button"
                            onClick={() => {
                              setNewGroupMembers(prev =>
                                isMember ? prev.filter(id => id !== u._id) : [...prev, u._id]
                              );
                            }}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors text-left ${
                              isMember
                                ? isDark ? "bg-cyan-500/10 text-cyan-300" : "bg-blue-50 text-blue-700"
                                : isDark ? "text-slate-400 hover:bg-slate-700/50" : "text-gray-600 hover:bg-gray-100"
                            }`}
                          >
                            <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                              isMember
                                ? isDark ? "bg-cyan-500 border-cyan-500" : "bg-blue-600 border-blue-600"
                                : isDark ? "border-slate-600" : "border-gray-300"
                            }`}>
                              {isMember && (
                                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </span>
                            <span className="truncate">{u.name}</span>
                            <span className={`ml-auto text-[10px] ${isDark ? "text-slate-600" : "text-gray-400"}`}>{u.email}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowCreateGroup(false); setEditingGroupId(null); }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg ${isDark ? "text-slate-400 hover:text-slate-300" : "text-gray-500 hover:text-gray-700"}`}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        if (!newGroupName.trim() || !user) return;
                        setCreatingGroup(true);
                        try {
                          if (editingGroupId) {
                            await updateGroupMutation({ groupId: editingGroupId, name: newGroupName, color: newGroupColor, requestingUserId: user._id });
                            // Sync members: remove then add
                            const existing = allGroups?.find(g => g._id === editingGroupId);
                            if (existing) {
                              for (const id of existing.memberIds) {
                                if (!newGroupMembers.includes(id)) {
                                  await removeGroupMember({ groupId: editingGroupId, userId: id, requestingUserId: user._id });
                                }
                              }
                              const toAdd = newGroupMembers.filter(id => !existing.memberIds.includes(id));
                              if (toAdd.length) await addGroupMembers({ groupId: editingGroupId, userIds: toAdd, requestingUserId: user._id });
                            }
                          } else {
                            await createGroupMutation({
                              name: newGroupName,
                              color: newGroupColor,
                              memberIds: newGroupMembers,
                              createdBy: user._id,
                              createdByName: user.name,
                            });
                          }
                          setShowCreateGroup(false);
                          setEditingGroupId(null);
                          setNewGroupName("");
                          setNewGroupColor("#3b82f6");
                          setNewGroupMembers([]);
                        } finally {
                          setCreatingGroup(false);
                        }
                      }}
                      disabled={!newGroupName.trim() || creatingGroup}
                      className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${
                        isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"
                      }`}
                    >
                      {creatingGroup ? "..." : editingGroupId ? "Save Group" : "Create Group"}
                    </button>
                  </div>
                </div>
              )}

              {/* Existing groups — toggle sharing */}
              {allGroups && allGroups.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {allGroups.map(group => {
                    const isShared = folderData?.sharedWithGroups?.includes(group._id) || false;
                    return (
                      <div key={group._id} className="flex items-center">
                        <button
                          onClick={async () => {
                            if (!folderData) return;
                            const currentGroups = folderData.sharedWithGroups || [];
                            const newGroups = isShared
                              ? currentGroups.filter((id: any) => id !== group._id)
                              : [...currentGroups, group._id];
                            await updateFolderSharedGroups({
                              folderId: shareFolderId,
                              groupIds: newGroups,
                            });
                          }}
                          className={`flex items-center gap-1.5 pl-3 pr-2 py-1.5 text-xs font-medium rounded-l-full border transition-all ${
                            isShared
                              ? isDark
                                ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-400"
                                : "bg-blue-50 border-blue-300 text-blue-700"
                              : isDark
                                ? "border-slate-700 text-slate-400 hover:border-slate-600"
                                : "border-gray-200 text-gray-500 hover:border-gray-300"
                          }`}
                        >
                          {group.color && (
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: group.color }} />
                          )}
                          {group.name}
                          {isShared && (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                          <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                            ({group.memberIds.length})
                          </span>
                        </button>
                        {/* Edit button (admin+) */}
                        {isAdmin ? (
                        <button
                          onClick={() => {
                            setEditingGroupId(group._id);
                            setShowCreateGroup(false);
                            setNewGroupName(group.name);
                            setNewGroupColor(group.color || "#3b82f6");
                            setNewGroupMembers([...group.memberIds]);
                          }}
                          className={`p-1.5 border border-l-0 rounded-r-full transition-colors ${
                            isDark
                              ? isShared ? "border-cyan-500/40 text-slate-500 hover:text-cyan-400" : "border-slate-700 text-slate-600 hover:text-slate-400"
                              : isShared ? "border-blue-300 text-gray-400 hover:text-blue-600" : "border-gray-200 text-gray-400 hover:text-gray-600"
                          }`}
                          title="Edit group"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        ) : (
                          <span className={`p-1.5 border border-l-0 rounded-r-full ${isShared ? (isDark ? "border-cyan-500/40" : "border-blue-300") : (isDark ? "border-slate-700" : "border-gray-200")}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : !showCreateGroup && (
                <p className={`text-xs text-center py-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  No groups yet — create one above
                </p>
              )}
            </div>

            {/* Grant access to specific users */}
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                Share with specific people
              </label>
              <div className="flex gap-2">
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value as any)}
                  className={`flex-1 px-3 py-2 text-sm rounded-xl border focus:outline-none focus:ring-2 ${
                    isDark
                      ? "bg-slate-800/50 border-slate-700 text-white focus:ring-cyan-500/50"
                      : "bg-gray-50 border-gray-200 text-gray-900 focus:ring-blue-500/50"
                  }`}
                >
                  <option value="">Select a user...</option>
                  {usersForSharing?.map(u => (
                    <option key={u._id} value={u._id}>{u.name} ({u.email})</option>
                  ))}
                </select>
                <button
                  onClick={handleGrant}
                  disabled={!selectedUserId || granting}
                  className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors disabled:opacity-50 ${
                    isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  {granting ? "..." : "Share"}
                </button>
              </div>
            </div>

            {/* Current access grants */}
            <div>
              <label className={`block text-xs font-medium mb-2 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                People with access
              </label>
              {activeGrants.length > 0 ? (
                <div className="space-y-2">
                  {activeGrants.map(grant => (
                    <div
                      key={grant._id}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl ${
                        isDark ? "bg-slate-800/50" : "bg-gray-50"
                      }`}
                    >
                      <div>
                        <p className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                          {grant.grantedToUserName}
                        </p>
                        <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                          Shared by {grant.grantedByUserName} &middot; {new Date(grant.grantedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRevokeAccess(shareFolderId, grant._id)}
                        className={`px-2 py-1 text-xs font-medium rounded-lg transition-colors ${
                          isDark ? "text-red-400 hover:bg-red-500/10" : "text-red-600 hover:bg-red-50"
                        }`}
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={`text-sm py-3 text-center ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  No individual access grants yet
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // === DOCUMENT SHARE MODAL ===
  if (shareDocumentId) {
    const doc = documents?.find(d => d._id === shareDocumentId) ||
                folderDocuments?.find(d => d._id === shareDocumentId);

    if (!doc) {
      // Defer state update to avoid setting state during render
      setTimeout(() => setShareDocumentId(null), 0);
      return null;
    }

    const publicUrl = doc.publicSlug ? getPublicUrl(doc.publicSlug) : null;

    const copyUrl = async () => {
      if (!publicUrl) return;
      try {
        await navigator.clipboard.writeText(publicUrl);
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
      } catch {}
    };

    const close = () => {
      setShareDocumentId(null);
      setCopiedUrl(false);
    };

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={close}>
        <div className={`absolute inset-0 ${isDark ? "bg-black/70" : "bg-black/40"} backdrop-blur-sm`} />

        <div
          onClick={(e) => e.stopPropagation()}
          className={`relative w-full max-w-md mx-4 rounded-2xl overflow-hidden ${
            isDark ? "bg-slate-900 border border-slate-700" : "bg-white border border-gray-200 shadow-2xl"
          }`}
        >
          <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
            <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Share Document</h2>
            <button onClick={close} className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-6 space-y-4">
            <div className={`flex items-center gap-3 p-3 rounded-xl ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`}>
              <svg className={`w-8 h-8 ${isDark ? "text-slate-400" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>{doc.name}</p>
                <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>{doc.fileName}</p>
              </div>
            </div>

            {/* Public toggle */}
            <div className={`flex items-center justify-between p-3 rounded-xl ${isDark ? "bg-slate-800/50" : "bg-gray-50"}`}>
              <div>
                <p className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>Public Link</p>
                <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  {doc.isPublic ? "Anyone with the link can view" : "Only people at the company can access"}
                </p>
              </div>
              <button
                onClick={() => handleTogglePublic(doc._id)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  doc.isPublic
                    ? isDark ? "bg-cyan-500" : "bg-blue-600"
                    : isDark ? "bg-slate-700" : "bg-gray-300"
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow-sm ${
                  doc.isPublic ? "translate-x-5" : ""
                }`} />
              </button>
            </div>

            {/* Public URL */}
            {doc.isPublic && publicUrl && (
              <div>
                <label className={`block text-xs font-medium mb-1.5 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                  Shareable Link
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={publicUrl}
                    readOnly
                    className={`flex-1 px-3 py-2 text-sm rounded-xl border font-mono ${
                      isDark
                        ? "bg-slate-800/50 border-slate-700 text-slate-300"
                        : "bg-gray-50 border-gray-200 text-gray-700"
                    }`}
                  />
                  <button
                    onClick={copyUrl}
                    className={`px-3 py-2 text-sm font-medium rounded-xl transition-colors ${
                      copiedUrl
                        ? isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700"
                        : isDark ? "bg-slate-700 text-slate-300 hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                    }`}
                  >
                    {copiedUrl ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
