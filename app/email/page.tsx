"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "../auth-context";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id, Doc } from "@/convex/_generated/dataModel";
import EmailSidebar from "@/components/email/EmailSidebar";
import EmailList from "@/components/email/EmailList";
import EmailView from "@/components/email/EmailView";
import EmailComposer from "@/components/email/EmailComposer";

// Auto-fetch interval in milliseconds (2 minutes)
const AUTO_FETCH_INTERVAL = 2 * 60 * 1000;

type EmailFolder = Doc<"emailFolders">;
type Email = Doc<"emails">;

// Stripped-down account type from listByUser query (excludes sensitive fields)
interface EmailAccount {
  _id: Id<"emailAccounts">;
  userId: Id<"users">;
  name: string;
  emailAddress: string;
  provider: string;
  oauthProvider?: string;
  lastSyncAt?: number;
  syncStatus: string;
  syncError?: string;
  isActive: boolean;
  isPrimary: boolean;
  signature?: string;
  createdAt: number;
  updatedAt: number;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
}

export default function EmailPage() {
  const { user } = useAuth();
  const [selectedAccountId, setSelectedAccountId] = useState<Id<"emailAccounts"> | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<Id<"emailFolders"> | null>(null);
  const [selectedEmailId, setSelectedEmailId] = useState<Id<"emails"> | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showEmailSidebar, setShowEmailSidebar] = useState(false);
  const [showComposeModal, setShowComposeModal] = useState(false);
  const [composeMode, setComposeMode] = useState<"compose" | "reply" | "reply_all" | "forward">("compose");

  // Get user's email accounts
  const accounts = useQuery(
    api.email.accounts.listByUser,
    user?._id ? { userId: user._id } : "skip"
  );

  // Get folders for selected account
  const folders = useQuery(
    api.email.folders.listByAccount,
    selectedAccountId ? { accountId: selectedAccountId } : "skip"
  );

  // Pagination state
  const [emailCursor, setEmailCursor] = useState<number | null>(null);
  const [loadedEmails, setLoadedEmails] = useState<Email[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Get emails for selected folder
  const emailsResult = useQuery(
    api.email.emails.listByFolder,
    selectedFolderId ? { folderId: selectedFolderId, limit: 50, cursor: emailCursor ?? undefined } : "skip"
  );

  // Reset loaded emails when folder changes
  useEffect(() => {
    setLoadedEmails([]);
    setEmailCursor(null);
  }, [selectedFolderId]);

  // Accumulate emails when loading more
  useEffect(() => {
    if (emailsResult?.emails) {
      if (emailCursor === null) {
        // Initial load - replace all
        setLoadedEmails(emailsResult.emails);
      } else {
        // Loading more - append
        setLoadedEmails(prev => [...prev, ...emailsResult.emails]);
      }
      setIsLoadingMore(false);
    }
  }, [emailsResult, emailCursor]);

  // Load more handler
  const handleLoadMore = () => {
    if (emailsResult?.hasMore && emailsResult.nextCursor) {
      setIsLoadingMore(true);
      setEmailCursor(emailsResult.nextCursor);
    }
  };

  // Use loaded emails for display
  const displayEmails = loadedEmails.length > 0 ? loadedEmails : emailsResult?.emails || [];

  // Get selected email details
  const selectedEmail = useQuery(
    api.email.emails.get,
    selectedEmailId ? { emailId: selectedEmailId } : "skip"
  );

  // Trigger sync action
  const triggerSync = useAction(api.email.sync.triggerSync);

  // Mark as read mutation
  const markAsRead = useMutation(api.email.emails.markAsRead);

  // Clear sync error mutation
  const clearSyncError = useMutation(api.email.accounts.clearSyncError);

  // Set default account when accounts load
  useEffect(() => {
    if (accounts && accounts.length > 0 && !selectedAccountId) {
      const primary = accounts.find(a => a.isPrimary) || accounts[0];
      setSelectedAccountId(primary._id);
    }
  }, [accounts, selectedAccountId]);

  // Set default folder (inbox) when folders load
  useEffect(() => {
    if (folders && folders.length > 0 && !selectedFolderId) {
      const inbox = folders.find(f => f.type === "inbox");
      if (inbox) {
        setSelectedFolderId(inbox._id);
      }
    }
  }, [folders, selectedFolderId]);

  // Mark email as read when selected
  useEffect(() => {
    if (selectedEmail && !selectedEmail.isRead) {
      markAsRead({ emailId: selectedEmail._id });
    }
  }, [selectedEmail, markAsRead]);

  // Sync state
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const syncInProgress = useRef(false);
  const autoFetchInterval = useRef<NodeJS.Timeout | null>(null);
  const initialSyncDone = useRef<Set<string>>(new Set());

  // Handle sync
  const handleSync = useCallback(async (fullSync = false, isAutoFetch = false) => {
    if (!selectedAccountId || syncInProgress.current) return;

    syncInProgress.current = true;
    if (!isAutoFetch) {
      setIsSyncing(true);
    }
    setSyncError(null);

    try {
      const result = await triggerSync({ accountId: selectedAccountId, fullSync });
      if (!isAutoFetch) {
        console.log("Sync result:", result);
      }
      if (!result.success) {
        setSyncError(result.error || "Sync failed");
      } else {
        setLastSyncTime(new Date());
      }
    } catch (error) {
      console.error("Sync failed:", error);
      if (!isAutoFetch) {
        setSyncError(error instanceof Error ? error.message : "Sync failed");
      }
    } finally {
      syncInProgress.current = false;
      if (!isAutoFetch) {
        setIsSyncing(false);
      }
    }
  }, [selectedAccountId, triggerSync]);

  // Initial sync when the email page opens / an account is selected.
  // Run it as a VISIBLE sync (isAutoFetch=false) so the "Syncing emails..."
  // spinner shows — server-side cron polling is intentionally infrequent, so
  // opening the page is the fast path to fresh mail.
  useEffect(() => {
    if (selectedAccountId && !initialSyncDone.current.has(selectedAccountId)) {
      initialSyncDone.current.add(selectedAccountId);
      // Small delay to let UI settle
      const timeout = setTimeout(() => {
        handleSync(false, false);
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [selectedAccountId, handleSync]);

  // Auto-fetch: Periodic sync every 2 minutes
  useEffect(() => {
    if (selectedAccountId) {
      // Clear any existing interval
      if (autoFetchInterval.current) {
        clearInterval(autoFetchInterval.current);
      }

      // Set up new interval
      autoFetchInterval.current = setInterval(() => {
        handleSync(false, true);
      }, AUTO_FETCH_INTERVAL);

      return () => {
        if (autoFetchInterval.current) {
          clearInterval(autoFetchInterval.current);
          autoFetchInterval.current = null;
        }
      };
    }
  }, [selectedAccountId, handleSync]);

  // Auto-fetch: Sync when window regains focus (if more than 1 minute since last sync)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && selectedAccountId) {
        const now = new Date();
        const timeSinceLastSync = lastSyncTime ? now.getTime() - lastSyncTime.getTime() : Infinity;
        // Only sync if more than 1 minute since last sync
        if (timeSinceLastSync > 60 * 1000) {
          handleSync(false, true);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [selectedAccountId, lastSyncTime, handleSync]);

  // Handle folder selection
  const handleFolderSelect = (folderId: Id<"emailFolders">) => {
    setSelectedFolderId(folderId);
    setSelectedEmailId(null);
  };

  // Handle email selection
  const handleEmailSelect = (emailId: Id<"emails">) => {
    setSelectedEmailId(emailId);
  };

  // Handle back to list (mobile)
  const handleBackToList = () => {
    setSelectedEmailId(null);
  };

  // Handle compose actions
  const handleCompose = () => {
    setComposeMode("compose");
    setShowComposeModal(true);
  };

  const handleReply = () => {
    setComposeMode("reply");
    setShowComposeModal(true);
  };

  const handleReplyAll = () => {
    setComposeMode("reply_all");
    setShowComposeModal(true);
  };

  const handleForward = () => {
    setComposeMode("forward");
    setShowComposeModal(true);
  };

  const handleCloseCompose = () => {
    setShowComposeModal(false);
    setComposeMode("compose");
  };

  const selectedAccount = accounts?.find(a => a._id === selectedAccountId);

  return (
    <Protected requireFlag="hasEmailAccess">
      <div className="h-screen theme-bg-primary flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden h-full">
          {/* Mobile Header */}
          <MobileHeader />

          <div className="flex-1 flex overflow-hidden">
          {/* Sync Error Banner */}
          {!isSyncing && (selectedAccount?.syncError || syncError) && (
            <div className="absolute top-0 left-0 right-0 z-40 bg-red-500/10 border-b border-red-500/20 p-3 flex items-center justify-center gap-2 text-red-400 text-sm">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>Sync Error: {syncError || selectedAccount?.syncError}</span>
              <button
                onClick={() => {
                  setSyncError(null);
                  if (selectedAccountId && selectedAccount?.syncError) {
                    clearSyncError({ accountId: selectedAccountId });
                  }
                }}
                className="ml-2 hover:text-red-300"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Syncing Indicator */}
          {isSyncing && (
            <div className="absolute top-0 left-0 right-0 z-40 bg-blue-500/10 border-b border-blue-500/20 p-3 flex items-center justify-center gap-2 text-blue-400 text-sm">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span>Syncing emails...</span>
            </div>
          )}

          {/* Email Sidebar - hidden on mobile */}
          <div className="hidden lg:block">
            <EmailSidebar
              accounts={accounts || []}
              selectedAccountId={selectedAccountId}
              onAccountSelect={setSelectedAccountId}
              folders={folders || []}
              selectedFolderId={selectedFolderId}
              onFolderSelect={handleFolderSelect}
              onCompose={handleCompose}
              onSync={handleSync}
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              userId={user?._id as Id<"users">}
            />
          </div>

          {/* Mobile Email Sidebar Overlay */}
          {showEmailSidebar && (
            <div className="lg:hidden fixed inset-0 z-50">
              <div className="absolute inset-0 bg-black/50" onClick={() => setShowEmailSidebar(false)} />
              <div className="relative z-10 h-full w-72">
                <EmailSidebar
                  accounts={accounts || []}
                  selectedAccountId={selectedAccountId}
                  onAccountSelect={(id) => { setSelectedAccountId(id); setShowEmailSidebar(false); }}
                  folders={folders || []}
                  selectedFolderId={selectedFolderId}
                  onFolderSelect={(id) => { handleFolderSelect(id); setShowEmailSidebar(false); }}
                  onCompose={() => { handleCompose(); setShowEmailSidebar(false); }}
                  onSync={handleSync}
                  isCollapsed={false}
                  onToggleCollapse={() => setShowEmailSidebar(false)}
                  userId={user?._id as Id<"users">}
                />
              </div>
            </div>
          )}

          {/* Email List */}
          <div className={`${selectedEmailId ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-96 h-full border-r theme-border flex-shrink-0`}>
            {/* Mobile toolbar for email list */}
            <div className="lg:hidden flex items-center gap-2 p-3 border-b theme-border">
              <button
                onClick={() => setShowEmailSidebar(true)}
                className="p-2 rounded-lg theme-text-tertiary hover:theme-text-primary hover:theme-bg-hover transition-colors"
                title="Folders"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </button>
              <span className="font-medium theme-text-primary text-sm flex-1">
                {folders?.find(f => f._id === selectedFolderId)?.name || "Inbox"}
              </span>
              <button
                onClick={handleCompose}
                className="p-2 rounded-lg text-blue-500 hover:bg-blue-500/10 transition-colors"
                title="Compose"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            </div>
            <EmailList
              emails={displayEmails}
              selectedEmailId={selectedEmailId}
              onEmailSelect={handleEmailSelect}
              isLoading={!emailsResult && loadedEmails.length === 0}
              folder={folders?.find(f => f._id === selectedFolderId)}
              hasMore={emailsResult?.hasMore}
              onLoadMore={handleLoadMore}
              isLoadingMore={isLoadingMore}
            />
          </div>

          {/* Email View */}
          <div className={`${selectedEmailId ? 'flex' : 'hidden lg:flex'} flex-1 flex-col h-full min-w-0`}>
            {selectedEmail && user?._id ? (
              <EmailView
                email={selectedEmail}
                userId={user._id}
                onBack={handleBackToList}
                onReply={handleReply}
                onReplyAll={handleReplyAll}
                onForward={handleForward}
              />
            ) : selectedEmail ? (
              <div className="flex-1 flex items-center justify-center theme-bg-secondary">
                <svg className="animate-spin w-8 h-8 theme-text-secondary" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center theme-bg-secondary">
                <div className="text-center">
                  <svg className="w-16 h-16 mx-auto mb-4 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <p className="theme-text-secondary">Select an email to read</p>
                </div>
              </div>
            )}
          </div>

          {/* No Accounts State */}
          {accounts && accounts.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-50">
              <div className="theme-bg-primary rounded-xl p-8 max-w-md mx-4 shadow-xl">
                <div className="text-center">
                  <svg className="w-16 h-16 mx-auto mb-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <h2 className="text-xl font-semibold theme-text-primary mb-2">Connect Your Email</h2>
                  <p className="theme-text-secondary mb-6">
                    Get started by connecting your email account. We support Gmail, Outlook, Yahoo, iCloud, and custom IMAP servers.
                  </p>
                  <a
                    href="/email/accounts"
                    className="inline-flex items-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Add Email Account
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Compose Modal */}
          {showComposeModal && selectedAccountId && user && (
            <EmailComposer
              accountId={selectedAccountId}
              userId={user._id}
              mode={composeMode}
              replyToEmail={composeMode !== "compose" ? selectedEmail || undefined : undefined}
              onClose={handleCloseCompose}
              onSent={() => {
                // Optionally refresh the folder
              }}
            />
          )}
          </div>
        </main>
      </div>
    </Protected>
  );
}
