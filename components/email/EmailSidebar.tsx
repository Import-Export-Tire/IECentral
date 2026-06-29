"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Id, Doc } from "@/convex/_generated/dataModel";
import { useTheme } from "@/app/theme-context";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

// Dynamic import for SignatureEditor to avoid SSR issues with TipTap
const SignatureEditor = dynamic(() => import("./SignatureEditor"), {
  ssr: false,
  loading: () => (
    <div className="h-48 flex items-center justify-center">
      <svg className="w-6 h-6 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  ),
});

type EmailFolder = Doc<"emailFolders">;

// Extended account type with signature
interface EmailAccount {
  _id: Id<"emailAccounts">;
  name: string;
  emailAddress: string;
  isPrimary: boolean;
  signature?: string;
  provider?: string;
  syncStatus?: string;
  lastSyncAt?: number;
}

interface EmailSidebarProps {
  accounts: EmailAccount[];
  selectedAccountId: Id<"emailAccounts"> | null;
  onAccountSelect: (accountId: Id<"emailAccounts">) => void;
  folders: EmailFolder[];
  selectedFolderId: Id<"emailFolders"> | null;
  onFolderSelect: (folderId: Id<"emailFolders">) => void;
  onCompose: () => void;
  onSync: (fullSync?: boolean) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  userId: Id<"users">;
}

// Folder icon map
const FOLDER_ICONS: Record<string, string> = {
  inbox: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  sent: "M12 19l9 2-9-18-9 18 9-2zm0 0v-8",
  drafts: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  trash: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
  spam: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
  archive: "M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4",
  custom: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z",
};

export default function EmailSidebar({
  accounts,
  selectedAccountId,
  onAccountSelect,
  folders,
  selectedFolderId,
  onFolderSelect,
  onCompose,
  onSync,
  isCollapsed,
  onToggleCollapse,
  userId,
}: EmailSidebarProps) {
  const router = useRouter();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [isSyncing, setIsSyncing] = useState(false);

  // Modal states
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [showAccountList, setShowAccountList] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // Signature editing
  const [editingSignature, setEditingSignature] = useState(false);
  const [signatureText, setSignatureText] = useState("");
  const [isSavingSignature, setIsSavingSignature] = useState(false);

  // Mutations
  const createFolder = useMutation(api.email.folders.upsert);
  const updateSettings = useMutation(api.email.accounts.updateSettings);
  const setPrimary = useMutation(api.email.accounts.setPrimary);
  const removeAccount = useMutation(api.email.accounts.remove);

  const selectedAccount = accounts.find(a => a._id === selectedAccountId);

  const handleSync = async (fullSync = false) => {
    setIsSyncing(true);
    try {
      await onSync(fullSync);
    } finally {
      setTimeout(() => setIsSyncing(false), 2000);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !selectedAccountId) return;

    setIsCreatingFolder(true);
    try {
      await createFolder({
        accountId: selectedAccountId,
        name: newFolderName.trim(),
        path: newFolderName.trim(),
        type: "custom",
      });
      setNewFolderName("");
      setShowCreateFolder(false);
    } catch (error) {
      console.error("Failed to create folder:", error);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleSaveSignature = async () => {
    if (!selectedAccountId) return;

    setIsSavingSignature(true);
    try {
      await updateSettings({
        accountId: selectedAccountId,
        userId,
        signature: signatureText,
      });
      setEditingSignature(false);
    } catch (error) {
      console.error("Failed to save signature:", error);
    } finally {
      setIsSavingSignature(false);
    }
  };

  const handleSetPrimary = async (accountId: Id<"emailAccounts">) => {
    try {
      await setPrimary({ accountId, userId });
    } catch (error) {
      console.error("Failed to set primary:", error);
    }
  };

  const handleRemoveAccount = async (accountId: Id<"emailAccounts">) => {
    if (!confirm("Remove this email account? All synced emails will be deleted.")) return;

    try {
      await removeAccount({ accountId, userId });
      if (accountId === selectedAccountId && accounts.length > 1) {
        const nextAccount = accounts.find(a => a._id !== accountId);
        if (nextAccount) onAccountSelect(nextAccount._id);
      }
    } catch (error) {
      console.error("Failed to remove account:", error);
    }
  };

  const openSignatureEditor = () => {
    setSignatureText(selectedAccount?.signature || "");
    setEditingSignature(true);
    setShowAccountSettings(true);
  };

  if (isCollapsed) {
    return (
      <div className={`w-16 h-full flex flex-col border-r theme-border flex-shrink-0 ${isDark ? 'bg-slate-800/50' : 'bg-gray-50'}`}>
        {/* Expand button */}
        <button
          onClick={onToggleCollapse}
          className={`p-4 hover:bg-opacity-10 ${isDark ? 'hover:bg-white' : 'hover:bg-black'}`}
        >
          <svg className="w-6 h-6 theme-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>

        {/* Compose button */}
        <button
          onClick={onCompose}
          className="p-4 text-blue-500 hover:bg-blue-500/10"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>

        {/* Folder icons */}
        {folders.slice(0, 6).map((folder) => (
          <button
            key={folder._id}
            onClick={() => onFolderSelect(folder._id)}
            className={`p-4 relative ${
              selectedFolderId === folder._id
                ? isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-50 text-blue-600'
                : 'theme-text-secondary hover:bg-opacity-10'
            } ${isDark ? 'hover:bg-white' : 'hover:bg-black'}`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={FOLDER_ICONS[folder.type] || FOLDER_ICONS.custom} />
            </svg>
            {folder.unreadCount > 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 bg-blue-500 rounded-full" />
            )}
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className={`w-full h-full flex flex-col border-r theme-border flex-shrink-0 ${isDark ? 'bg-slate-800/50' : 'bg-gray-50'}`}>
        {/* Header */}
        <div className="p-4 border-b theme-border flex items-center justify-between">
          <h2 className="font-semibold theme-text-primary">Email</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleSync()}
              disabled={isSyncing}
              className={`p-2 rounded-lg transition-colors ${
                isSyncing
                  ? 'text-blue-500 animate-spin'
                  : isDark ? 'text-slate-400 hover:text-white hover:bg-slate-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
              title="Sync emails"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              onClick={onToggleCollapse}
              className={`p-2 rounded-lg transition-colors ${isDark ? 'text-slate-400 hover:text-white hover:bg-slate-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
              title="Collapse sidebar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Account Selector with Management */}
        <div className="p-3 border-b theme-border">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAccountList(!showAccountList)}
              className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left ${
                isDark ? 'bg-slate-700 hover:bg-slate-600' : 'bg-white hover:bg-gray-50 border border-gray-200'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className={`truncate font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {selectedAccount?.name || selectedAccount?.emailAddress || "Select Account"}
                </div>
                {selectedAccount && (
                  <div className={`text-xs truncate ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                    {selectedAccount.emailAddress}
                  </div>
                )}
              </div>
              <svg className={`w-4 h-4 transition-transform ${showAccountList ? 'rotate-180' : ''} ${isDark ? 'text-slate-400' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <button
              onClick={() => setShowAccountSettings(true)}
              className={`p-2 rounded-lg transition-colors ${isDark ? 'text-slate-400 hover:text-white hover:bg-slate-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
              title="Account settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>

          {/* Account dropdown */}
          {showAccountList && (
            <div className={`mt-2 rounded-lg border overflow-hidden ${isDark ? 'bg-slate-700 border-slate-600' : 'bg-white border-gray-200'}`}>
              {accounts.map((account) => (
                <button
                  key={account._id}
                  onClick={() => {
                    onAccountSelect(account._id);
                    setShowAccountList(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${
                    account._id === selectedAccountId
                      ? isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-50 text-blue-600'
                      : isDark ? 'hover:bg-slate-600 text-white' : 'hover:bg-gray-50 text-gray-900'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{account.name || account.emailAddress}</div>
                    <div className={`text-xs truncate ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                      {account.emailAddress}
                    </div>
                  </div>
                  {account.isPrimary && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">Primary</span>
                  )}
                </button>
              ))}
              {/* Add Account button */}
              <Link
                href="/email/accounts"
                className={`flex items-center gap-2 px-3 py-2 text-sm border-t ${
                  isDark ? 'border-slate-600 text-blue-400 hover:bg-slate-600' : 'border-gray-200 text-blue-600 hover:bg-gray-50'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Account
              </Link>
            </div>
          )}
        </div>

        {/* Compose Button */}
        <div className="p-3">
          <button
            onClick={onCompose}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors shadow-lg shadow-blue-500/20"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Compose
          </button>
        </div>

        {/* Folders */}
        <div className="flex-1 overflow-y-auto p-2">
          <div className="flex items-center justify-between px-2 mb-2">
            <span className={`text-xs font-medium uppercase ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
              Folders
            </span>
            <button
              onClick={() => setShowCreateFolder(true)}
              className={`p-1 rounded transition-colors ${isDark ? 'hover:bg-slate-700 text-slate-400 hover:text-white' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-700'}`}
              title="Create folder"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
          <div className="space-y-1">
            {folders.map((folder) => (
              <button
                key={folder._id}
                onClick={() => onFolderSelect(folder._id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  selectedFolderId === folder._id
                    ? isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-50 text-blue-600'
                    : isDark ? 'text-slate-300 hover:bg-slate-700/50' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={FOLDER_ICONS[folder.type] || FOLDER_ICONS.custom} />
                </svg>
                <span className="flex-1 truncate capitalize">
                  {folder.name}
                </span>
                {folder.unreadCount > 0 && (
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                    isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'
                  }`}>
                    {folder.unreadCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Bottom actions */}
        <div className="p-3 border-t theme-border space-y-1">
          <button
            onClick={openSignatureEditor}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              isDark ? 'text-slate-400 hover:text-white hover:bg-slate-700/50' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            <span className="text-sm">Signature</span>
          </button>
          <button
            onClick={() => handleSync(true)}
            disabled={isSyncing}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              isDark ? 'text-slate-400 hover:text-white hover:bg-slate-700/50' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            } ${isSyncing ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <svg className={`w-5 h-5 ${isSyncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="text-sm">Full Resync</span>
          </button>
        </div>
      </div>

      {/* Create Folder Modal */}
      {showCreateFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className={`w-full max-w-sm mx-4 rounded-xl shadow-2xl ${isDark ? 'bg-slate-800' : 'bg-white'}`}>
            <div className={`px-6 py-4 border-b ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
              <h3 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Create Folder
              </h3>
            </div>
            <div className="p-6">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name"
                autoFocus
                className={`w-full px-3 py-2 rounded-lg border ${
                  isDark
                    ? 'bg-slate-700 border-slate-600 text-white placeholder-slate-400'
                    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                } focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
                onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
              />
            </div>
            <div className={`px-6 py-4 border-t ${isDark ? 'border-slate-700' : 'border-gray-200'} flex justify-end gap-3`}>
              <button
                onClick={() => {
                  setShowCreateFolder(false);
                  setNewFolderName("");
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  isDark ? 'bg-slate-700 hover:bg-slate-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={isCreatingFolder || !newFolderName.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium"
              >
                {isCreatingFolder ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Account Settings Modal */}
      {showAccountSettings && selectedAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className={`w-full max-w-lg mx-4 rounded-xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col ${isDark ? 'bg-slate-800' : 'bg-white'}`}>
            <div className={`px-6 py-4 border-b ${isDark ? 'border-slate-700' : 'border-gray-200'} flex items-center justify-between`}>
              <h3 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Account Settings
              </h3>
              <button
                onClick={() => {
                  setShowAccountSettings(false);
                  setEditingSignature(false);
                }}
                className={`p-2 rounded-lg ${isDark ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-gray-100 text-gray-500'}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Account Info */}
              <div>
                <h4 className={`text-sm font-medium mb-2 ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                  Account
                </h4>
                <div className={`p-4 rounded-lg ${isDark ? 'bg-slate-700' : 'bg-gray-100'}`}>
                  <div className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {selectedAccount.name || selectedAccount.emailAddress}
                  </div>
                  <div className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                    {selectedAccount.emailAddress}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    {selectedAccount.isPrimary ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">Primary Account</span>
                    ) : (
                      <button
                        onClick={() => handleSetPrimary(selectedAccount._id)}
                        className="text-xs px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        Set as Primary
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Signature Editor */}
              <div>
                <h4 className={`text-sm font-medium mb-2 ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                  Email Signature
                </h4>
                {editingSignature ? (
                  <SignatureEditor
                    initialContent={signatureText}
                    onSave={async (html) => {
                      setSignatureText(html);
                      setIsSavingSignature(true);
                      try {
                        await updateSettings({
                          accountId: selectedAccount._id,
                          userId,
                          signature: html,
                        });
                        setEditingSignature(false);
                      } catch (error) {
                        console.error("Failed to save signature:", error);
                      } finally {
                        setIsSavingSignature(false);
                      }
                    }}
                    onCancel={() => setEditingSignature(false)}
                    isSaving={isSavingSignature}
                  />
                ) : (
                  <div>
                    {selectedAccount.signature ? (
                      <div
                        className={`p-3 rounded-lg border ${isDark ? 'bg-slate-700 border-slate-600' : 'bg-gray-50 border-gray-200'}`}
                        dangerouslySetInnerHTML={{ __html: selectedAccount.signature }}
                      />
                    ) : (
                      <div className={`p-3 rounded-lg border border-dashed ${isDark ? 'border-slate-600 text-slate-500' : 'border-gray-300 text-gray-500'}`}>
                        No signature configured
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setSignatureText(selectedAccount.signature || "");
                        setEditingSignature(true);
                      }}
                      className={`mt-2 text-sm ${isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'}`}
                    >
                      {selectedAccount.signature ? "Edit Signature" : "Add Signature"}
                    </button>
                  </div>
                )}
              </div>

              {/* All Accounts */}
              <div>
                <h4 className={`text-sm font-medium mb-2 ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                  All Accounts ({accounts.length})
                </h4>
                <div className="space-y-2">
                  {accounts.map((account) => (
                    <div
                      key={account._id}
                      className={`p-3 rounded-lg flex items-center justify-between ${
                        account._id === selectedAccountId
                          ? isDark ? 'bg-blue-500/20 ring-1 ring-blue-500/50' : 'bg-blue-50 ring-1 ring-blue-200'
                          : isDark ? 'bg-slate-700' : 'bg-gray-100'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className={`font-medium truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {account.emailAddress}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {account.isPrimary && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">Primary</span>
                          )}
                          <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                            {account.provider || "IMAP"}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!account.isPrimary && (
                          <button
                            onClick={() => handleSetPrimary(account._id)}
                            className={`p-1.5 rounded ${isDark ? 'hover:bg-slate-600 text-slate-400' : 'hover:bg-gray-200 text-gray-500'}`}
                            title="Set as primary"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={() => handleRemoveAccount(account._id)}
                          className={`p-1.5 rounded text-red-500 ${isDark ? 'hover:bg-red-500/20' : 'hover:bg-red-50'}`}
                          title="Remove account"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <Link
                  href="/email/accounts"
                  className={`flex items-center justify-center gap-2 mt-3 px-4 py-2 rounded-lg text-sm font-medium ${
                    isDark ? 'bg-slate-700 hover:bg-slate-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Account
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
