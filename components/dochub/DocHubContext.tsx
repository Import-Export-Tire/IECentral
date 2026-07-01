"use client";

import { createContext, useContext, useState, useRef, useEffect, useCallback, ReactNode } from "react";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/app/auth-context";
import { useTheme } from "@/app/theme-context";
import type { ViewMode, BreadcrumbItem, DocumentType, FolderType, RailSelection } from "./types";
import { requestThumbnail } from "@/lib/docThumbnail";

interface DocHubContextType {
  // Theme
  isDark: boolean;
  // User
  user: ReturnType<typeof useAuth>["user"];
  isAdmin: boolean;
  isSuperAdmin: boolean;
  // Navigation
  currentFolderId: Id<"documentFolders"> | null;
  setCurrentFolderId: (id: Id<"documentFolders"> | null) => void;
  breadcrumbs: BreadcrumbItem[];
  navigateToFolder: (folderId: Id<"documentFolders"> | null, folderName?: string) => void;
  navigateToRoot: () => void;
  // View
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedCategory: string | null;
  setSelectedCategory: (cat: string | null) => void;
  showArchived: boolean;
  setShowArchived: (show: boolean) => void;
  // Data
  documents: DocumentType[] | undefined;
  folderDocuments: DocumentType[] | null;
  setFolderDocuments: (docs: DocumentType[] | null) => void;
  filteredDocuments: DocumentType[] | undefined;
  myFolders: FolderType[] | undefined;
  communityFolders: FolderType[] | undefined;
  sharedFoldersWithMe: FolderType[] | undefined;
  currentFolder: FolderType | undefined;
  archivedDocuments: DocumentType[] | undefined;
  // Folder operations
  unlockedFolders: Set<string>;
  unlockFolder: (folderId: string) => void;
  handleOpenFolder: (folder: FolderType, hasAccessGrant?: boolean) => Promise<void>;
  loadFolderDocuments: (folderId: Id<"documentFolders">, isProtected: boolean) => Promise<void>;
  loadingFolderDocs: boolean;
  // Modals
  showUploadModal: boolean;
  setShowUploadModal: (show: boolean) => void;
  showFolderModal: boolean;
  setShowFolderModal: (show: boolean) => void;
  showGroupsModal: boolean;
  setShowGroupsModal: (show: boolean) => void;
  showManageDrawer: boolean;
  setShowManageDrawer: (show: boolean) => void;
  // Plain-language rail
  railSelection: RailSelection;
  setRailSelection: (sel: RailSelection) => void;
  recentDocuments: DocumentType[] | undefined;
  // Upload
  handleUpload: (file: File, name: string, description: string, category: string, expirationDate?: string, expirationAlertDays?: number, requiresSignature?: boolean, visibility?: string) => Promise<void>;
  uploading: boolean;
  // Document operations
  handleDownload: (doc: DocumentType) => Promise<void>;
  handlePreview: (doc: DocumentType) => Promise<void>;
  handleArchive: (docId: Id<"documents">) => Promise<void>;
  handleDelete: (docId: Id<"documents">) => Promise<void>;
  handleRestore: (docId: Id<"documents">) => Promise<void>;
  handleEdit: (docId: Id<"documents">, name: string, description: string, category: string) => Promise<void>;
  handleShare: (docId: Id<"documents">) => void;
  handleTogglePublic: (docId: Id<"documents">) => Promise<void>;
  // Folder operations
  handleCreateFolder: (name: string, description: string, password: string | undefined, visibility: string) => Promise<void>;
  handleUpdateFolder: (folderId: Id<"documentFolders">, name: string, description: string, visibility: string) => Promise<void>;
  handleArchiveFolder: (folderId: Id<"documentFolders">) => Promise<void>;
  handleMoveDocument: (docId: Id<"documents">, folderId: Id<"documentFolders">) => Promise<void>;
  handleMoveFolder: (folderId: Id<"documentFolders">, parentFolderId: Id<"documentFolders">) => Promise<void>;
  // Password
  handleVerifyPassword: (folderId: Id<"documentFolders">, password: string) => Promise<boolean>;
  // Preview
  previewDocument: DocumentType | null;
  previewUrl: string | null;
  previewStorageUrl: string | null;
  loadingPreview: boolean;
  closePreview: () => void;
  storageUsage: { totalBytes: number; count: number } | undefined;
  // Share
  shareDocumentId: Id<"documents"> | null;
  setShareDocumentId: (id: Id<"documents"> | null) => void;
  getPublicUrl: (slug: string) => string;
  // Context menu
  contextMenu: { x: number; y: number; doc?: DocumentType; folder?: FolderType } | null;
  setContextMenu: (menu: { x: number; y: number; doc?: DocumentType; folder?: FolderType } | null) => void;
  // Error
  error: string;
  setError: (error: string) => void;
  // Drag and drop
  isDraggingOver: boolean;
  setIsDraggingOver: (dragging: boolean) => void;
  // Version history
  handleUploadNewVersion: (docId: Id<"documents">, file: File, changeNotes?: string) => Promise<void>;
  documentVersions: any[] | undefined;
  versionHistoryDocId: Id<"documents"> | null;
  setVersionHistoryDocId: (id: Id<"documents"> | null) => void;
  // Templates
  templatesList: any[] | undefined;
  // Signatures
  signDocumentId: Id<"documents"> | null;
  setSignDocumentId: (id: Id<"documents"> | null) => void;
  handleSignDocument: (signatureData: string) => Promise<void>;
  unsignedDocuments: any[] | undefined;
  // Expiration
  handleSetExpiration: (docId: Id<"documents">, expiresAt: number, alertDays: number) => Promise<void>;
  handleRemoveExpiration: (docId: Id<"documents">) => Promise<void>;
  expiringDocuments: any[] | undefined;
  // Folder sharing
  handleGrantAccess: (folderId: Id<"documentFolders">, userId: Id<"users">) => Promise<void>;
  handleRevokeAccess: (folderId: Id<"documentFolders">, grantId: Id<"folderAccessGrants">) => Promise<void>;
  usersForSharing: any[] | undefined;
  folderAccessGrants: any[] | undefined;
  shareFolderId: Id<"documentFolders"> | null;
  setShareFolderId: (id: Id<"documentFolders"> | null) => void;
  // Folder password management
  handleSetFolderPassword: (folderId: Id<"documentFolders">, password: string) => Promise<void>;
  handleRemoveFolderPassword: (folderId: Id<"documentFolders">, password: string) => Promise<void>;
  // Search results
  folderSearchResults: FolderType[] | undefined;
  // Sidebar collapsed
  docSidebarCollapsed: boolean;
  setDocSidebarCollapsed: (collapsed: boolean) => void;
}

const DocHubContext = createContext<DocHubContextType | null>(null);

export function useDocHub() {
  const ctx = useContext(DocHubContext);
  if (!ctx) throw new Error("useDocHub must be used within DocHubProvider");
  return ctx;
}

export function DocHubProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const isDark = theme === "dark";
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const isSuperAdmin = user?.role === "super_admin";

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [docSidebarCollapsed, setDocSidebarCollapsed] = useState(() =>
    typeof window !== "undefined" && window.innerWidth < 1024
  );

  // Navigation state
  const [currentFolderId, setCurrentFolderId] = useState<Id<"documentFolders"> | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([{ id: null, name: "Doc Hub" }]);
  const [folderDocuments, setFolderDocuments] = useState<DocumentType[] | null>(null);
  const [loadingFolderDocs, setLoadingFolderDocs] = useState(false);

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showGroupsModal, setShowGroupsModal] = useState(false);
  const [showManageDrawer, setShowManageDrawer] = useState(false);
  const [railSelection, setRailSelection] = useState<RailSelection>("mine");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  // Preview
  const [previewDocument, setPreviewDocument] = useState<DocumentType | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Share
  const [shareDocumentId, setShareDocumentId] = useState<Id<"documents"> | null>(null);
  const [shareFolderId, setShareFolderId] = useState<Id<"documentFolders"> | null>(null);

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; doc?: DocumentType; folder?: FolderType } | null>(null);

  // Drag
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Unlocked folders
  const [unlockedFolders, setUnlockedFolders] = useState<Set<string>>(new Set());

  // Version history
  const [versionHistoryDocId, setVersionHistoryDocId] = useState<Id<"documents"> | null>(null);

  // Signature
  const [signDocumentId, setSignDocumentId] = useState<Id<"documents"> | null>(null);

  // Load unlocked folders from sessionStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = sessionStorage.getItem("unlockedFolders");
      if (stored) {
        try {
          setUnlockedFolders(new Set(JSON.parse(stored)));
        } catch (e) {
          console.error("Failed to parse unlocked folders", e);
        }
      }
    }
  }, []);

  const unlockFolder = (folderId: string) => {
    const newUnlocked = new Set(unlockedFolders);
    newUnlocked.add(folderId);
    setUnlockedFolders(newUnlocked);
    if (typeof window !== "undefined") {
      sessionStorage.setItem("unlockedFolders", JSON.stringify([...newUnlocked]));
    }
  };

  // Queries
  const documents = useQuery(api.documents.getAll, user ? { rootOnly: true, userId: user._id } : "skip") as DocumentType[] | undefined;
  const archivedDocuments = useQuery(api.documents.getArchived, isAdmin && user ? { requestingUserId: user._id } : "skip") as DocumentType[] | undefined;
  const expiringDocuments = useQuery(api.documents.getExpiring, isAdmin && user ? { days: 90, requestingUserId: user._id } : "skip");
  const storageUsage = useQuery(api.documents.getStorageUsage, isAdmin && user ? { requestingUserId: user._id } : "skip");
  const templatesList = useQuery(api.documentTemplates.list, {});

  const myFolders = useQuery(
    api.documentFolders.getMyFolders,
    user ? { userId: user._id, parentFolderId: currentFolderId ?? null } : "skip"
  ) as FolderType[] | undefined;

  const communityFolders = useQuery(api.documentFolders.getCommunityFolders, {
    parentFolderId: currentFolderId ?? null,
  }) as FolderType[] | undefined;

  const sharedFoldersWithMe = useQuery(
    api.documentFolders.getSharedFolders,
    user ? { userId: user._id, parentFolderId: currentFolderId ?? null } : "skip"
  ) as FolderType[] | undefined;

  const currentFolder = useQuery(
    api.documentFolders.getById,
    currentFolderId ? { folderId: currentFolderId } : "skip"
  ) as FolderType | undefined;

  const unsignedDocuments = useQuery(
    api.documentSignatures.getUnsignedForUser,
    user ? { userId: user._id } : "skip"
  );

  const documentVersions = useQuery(
    api.documents.getVersions,
    versionHistoryDocId ? { documentId: versionHistoryDocId } : "skip"
  );

  const folderAccessGrantsData = useQuery(
    api.documentFolders.getFolderAccessGrants,
    shareFolderId ? { folderId: shareFolderId } : "skip"
  );

  const usersForSharing = useQuery(api.documentFolders.getUsersForSharing, user ? { requestingUserId: user._id } : "skip");

  // Mutations
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const createDocument = useMutation(api.documents.create);
  const updateDocument = useMutation(api.documents.update);
  const archiveDocument = useMutation(api.documents.archive);
  const restoreDocument = useMutation(api.documents.restore);
  const removeDocument = useMutation(api.documents.remove);
  const incrementDownload = useMutation(api.documents.incrementDownload);
  const getFileDownloadUrl = useAction(api.documents.getFileDownloadUrl);
  const togglePublicMutation = useMutation(api.documents.togglePublic);
  const uploadNewVersionMutation = useMutation(api.documents.uploadNewVersion);
  const setExpirationMutation = useMutation(api.documents.setExpiration);
  const removeExpirationMutation = useMutation(api.documents.removeExpiration);
  const createFolder = useMutation(api.documentFolders.create);
  const updateFolder = useMutation(api.documentFolders.update);
  const archiveFolderMutation = useMutation(api.documentFolders.archive);
  const moveFolderMutation = useMutation(api.documentFolders.moveFolder);
  const moveDocumentToFolder = useMutation(api.documentFolders.moveDocument);
  const getProtectedDocuments = useAction(api.documentFolders.getProtectedDocuments);
  const verifyFolderPassword = useAction(api.documentFolders.verifyPassword);
  const grantFolderAccess = useMutation(api.documentFolders.grantAccess);
  const revokeFolderAccess = useMutation(api.documentFolders.revokeAccess);
  const setFolderPasswordMutation = useMutation(api.documentFolders.setPassword);
  const removeFolderPasswordMutation = useMutation(api.documentFolders.removePassword);
  const signDocumentMutation = useMutation(api.documentSignatures.sign);

  // Navigation
  const navigateToFolder = useCallback((folderId: Id<"documentFolders"> | null, folderName?: string) => {
    if (folderId === null) {
      setBreadcrumbs([{ id: null, name: "Doc Hub" }]);
      setCurrentFolderId(null);
      setFolderDocuments(null);
    } else {
      setCurrentFolderId(folderId);
      setBreadcrumbs(prev => {
        const existingIndex = prev.findIndex(b => b.id === folderId);
        if (existingIndex >= 0) return prev.slice(0, existingIndex + 1);
        return [...prev, { id: folderId, name: folderName || "Folder" }];
      });
    }
  }, []);

  const navigateToRoot = useCallback(() => {
    setBreadcrumbs([{ id: null, name: "Doc Hub" }]);
    setCurrentFolderId(null);
    setFolderDocuments(null);
  }, []);

  // Folder operations
  const loadFolderDocuments = useCallback(async (folderId: Id<"documentFolders">, isProtected: boolean) => {
    setLoadingFolderDocs(true);
    try {
      const result = await getProtectedDocuments({
        folderId,
        password: "",
        userId: user?._id,
        userName: user?.name,
        userEmail: user?.email,
      });
      if (result.success && result.documents) {
        setFolderDocuments(result.documents as DocumentType[]);
      } else if (!result.success) {
        setError(result.error || "Access denied");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load folder documents");
    } finally {
      setLoadingFolderDocs(false);
    }
  }, [getProtectedDocuments, user]);

  const handleOpenFolder = useCallback(async (folder: FolderType, hasAccessGrant = false) => {
    const hasAccessFromSharing = sharedFoldersWithMe?.some(f => f?._id === folder._id) || false;
    const effectiveHasAccess = hasAccessGrant || hasAccessFromSharing;

    if (folder.isProtected && !unlockedFolders.has(folder._id) && !effectiveHasAccess && folder.createdBy !== user?._id) {
      // Need password — caller should show password modal
      return;
    }

    navigateToFolder(folder._id, folder.name);
    await loadFolderDocuments(folder._id, folder.isProtected);
  }, [sharedFoldersWithMe, unlockedFolders, user, navigateToFolder, loadFolderDocuments]);

  const handleVerifyPassword = useCallback(async (folderId: Id<"documentFolders">, password: string): Promise<boolean> => {
    try {
      const result = await getProtectedDocuments({
        folderId,
        password,
        userId: user?._id,
        userName: user?.name,
        userEmail: user?.email,
      });
      if (result.success && result.documents) {
        unlockFolder(folderId);
        setFolderDocuments(result.documents as DocumentType[]);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [getProtectedDocuments, user]);

  // Upload
  const handleUpload = useCallback(async (
    file: File, name: string, description: string, category: string,
    expirationDate?: string, expirationAlertDays?: number, requiresSignature?: boolean, visibility?: string
  ) => {
    if (!user) return;
    setUploading(true);
    setError("");
    try {
      const uploadUrl = await generateUploadUrl({ requestingUserId: user._id });
      if (!uploadUrl) throw new Error("Failed to generate upload URL");

      const { getFileMimeType } = await import("./types");
      const mimeType = getFileMimeType(file);

      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": mimeType },
        body: file,
      });
      if (!response.ok) throw new Error(`Upload failed: ${response.status}`);

      const result = await response.json();
      if (!result.storageId) throw new Error("No storage ID returned");

      const newDocId = await createDocument({
        name,
        description: description || undefined,
        category,
        folderId: currentFolderId || undefined,
        fileId: result.storageId,
        fileName: file.name,
        fileType: mimeType,
        fileSize: file.size,
        uploadedBy: user._id,
        uploadedByName: user.name,
        requiresSignature: requiresSignature || undefined,
        visibility: visibility || "private",
      });

      if (expirationDate && newDocId) {
        await setExpirationMutation({
          documentId: newDocId,
          expiresAt: new Date(expirationDate).getTime(),
          expirationAlertDays: expirationAlertDays || 30,
          requestingUserId: user._id,
        });
      }

      // Generate the card thumbnail (and, for Office docs, the cached PDF) server-side.
      if (newDocId) requestThumbnail(newDocId);

      setShowUploadModal(false);

      if (currentFolderId) {
        setTimeout(async () => {
          await loadFolderDocuments(currentFolderId, currentFolder?.isProtected || false);
        }, 100);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [user, generateUploadUrl, createDocument, currentFolderId, currentFolder, setExpirationMutation, loadFolderDocuments]);

  // Document operations
  const handleDownload = useCallback(async (doc: DocumentType) => {
    if (!user) return;
    try {
      const url = await getFileDownloadUrl({ documentId: doc._id, requestingUserId: user._id });
      if (!url) { setError("Could not get download URL"); return; }
      await incrementDownload({ documentId: doc._id });
      // Force download via fetch + blob to avoid browser opening the file
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = doc.fileName || doc.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  }, [getFileDownloadUrl, incrementDownload, user]);

  // Keep track of the storage URL separately from the blob URL so we can
  // (a) hand the storage URL to Microsoft's Office Online viewer (which
  //     requires a publicly fetchable URL), and (b) offer "Open in new tab"
  // as a fallback when iframe preview misbehaves.
  const [previewStorageUrl, setPreviewStorageUrl] = useState<string | null>(null);
  const previewBlobUrlRef = useRef<string | null>(null);

  const revokeBlobUrl = useCallback(() => {
    if (previewBlobUrlRef.current) {
      URL.revokeObjectURL(previewBlobUrlRef.current);
      previewBlobUrlRef.current = null;
    }
  }, []);

  const handlePreview = useCallback(async (doc: DocumentType) => {
    setPreviewDocument(doc);
    setLoadingPreview(true);
    setPreviewUrl(null);
    setPreviewStorageUrl(null);
    revokeBlobUrl();
    try {
      // Serve through the same-origin proxy, which streams the file INLINE with the
      // right Content-Type. Same-origin + inline avoids the CORS / X-Frame-Options /
      // attachment-disposition problems that broke the old direct-to-storage embeds,
      // and lets us print straight from an iframe (no download). Absolute URL so the
      // Microsoft Office Online viewer can fetch it server-side too.
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const proxyUrl = `${origin}/api/documents/file?id=${doc._id}`;
      setPreviewStorageUrl(proxyUrl);
      setPreviewUrl(proxyUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
      setPreviewDocument(null);
    } finally {
      setLoadingPreview(false);
    }
  }, [revokeBlobUrl]);

  const closePreview = useCallback(() => {
    setPreviewDocument(null);
    setPreviewUrl(null);
    setPreviewStorageUrl(null);
    revokeBlobUrl();
  }, [revokeBlobUrl]);

  const handleArchive = useCallback(async (docId: Id<"documents">) => {
    if (!user) return;
    try { await archiveDocument({ documentId: docId, requestingUserId: user._id }); }
    catch (err) { setError(err instanceof Error ? err.message : "Archive failed"); }
  }, [archiveDocument, user]);

  const handleDelete = useCallback(async (docId: Id<"documents">) => {
    if (!user) return;
    try { await removeDocument({ documentId: docId, requestingUserId: user._id }); }
    catch (err) { setError(err instanceof Error ? err.message : "Delete failed"); }
  }, [removeDocument, user]);

  const handleRestore = useCallback(async (docId: Id<"documents">) => {
    if (!user) return;
    try { await restoreDocument({ documentId: docId, requestingUserId: user._id }); }
    catch (err) { setError(err instanceof Error ? err.message : "Restore failed"); }
  }, [restoreDocument, user]);

  const handleEdit = useCallback(async (docId: Id<"documents">, name: string, description: string, category: string) => {
    if (!user) return;
    try {
      await updateDocument({ documentId: docId, name, description, category, requestingUserId: user._id });
    } catch (err) { setError(err instanceof Error ? err.message : "Update failed"); }
  }, [updateDocument, user]);

  const handleShare = useCallback((docId: Id<"documents">) => {
    setShareDocumentId(docId);
  }, []);

  const handleTogglePublic = useCallback(async (docId: Id<"documents">) => {
    if (!user) return;
    try { await togglePublicMutation({ documentId: docId, requestingUserId: user._id }); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to toggle public access"); }
  }, [togglePublicMutation, user]);

  // Folder operations
  const handleCreateFolder = useCallback(async (name: string, description: string, password: string | undefined, visibility: string) => {
    if (!user) return;
    try {
      await createFolder({
        name,
        description: description || undefined,
        password: password || undefined,
        visibility,
        parentFolderId: currentFolderId || undefined,
        createdBy: user._id,
        createdByName: user.name,
      });
      setShowFolderModal(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to create folder"); }
  }, [user, createFolder, currentFolderId]);

  const handleUpdateFolder = useCallback(async (folderId: Id<"documentFolders">, name: string, description: string, visibility: string) => {
    try {
      await updateFolder({ folderId, name, description: description || undefined, visibility });
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to update folder"); }
  }, [updateFolder]);

  const handleArchiveFolder = useCallback(async (folderId: Id<"documentFolders">) => {
    try { await archiveFolderMutation({ folderId }); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to archive folder"); }
  }, [archiveFolderMutation]);

  const handleMoveDocument = useCallback(async (docId: Id<"documents">, folderId: Id<"documentFolders">) => {
    try { await moveDocumentToFolder({ documentId: docId, folderId }); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to move document"); }
  }, [moveDocumentToFolder]);

  const handleMoveFolder = useCallback(async (folderId: Id<"documentFolders">, parentFolderId: Id<"documentFolders">) => {
    try { await moveFolderMutation({ folderId, parentFolderId }); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to move folder"); }
  }, [moveFolderMutation]);

  // Version history
  const handleUploadNewVersion = useCallback(async (docId: Id<"documents">, file: File, changeNotes?: string) => {
    if (!user) return;
    try {
      const uploadUrl = await generateUploadUrl({ requestingUserId: user._id });
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const { storageId } = await result.json();
      await uploadNewVersionMutation({
        documentId: docId,
        fileId: storageId,
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
        fileSize: file.size,
        changeNotes: changeNotes || undefined,
        uploadedBy: user._id,
        uploadedByName: user.name,
      });
      // The file changed — regenerate the (now stale) card thumbnail / cached PDF.
      requestThumbnail(docId);
    } catch (err) { setError(err instanceof Error ? err.message : "Version upload failed"); }
  }, [user, generateUploadUrl, uploadNewVersionMutation]);

  // Signatures
  const handleSignDocument = useCallback(async (signatureData: string) => {
    if (!signDocumentId || !user) return;
    try {
      await signDocumentMutation({
        documentId: signDocumentId,
        userId: user._id,
        signatureData,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      });
      setSignDocumentId(null);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to sign document"); }
  }, [signDocumentId, user, signDocumentMutation]);

  // Expiration
  const handleSetExpiration = useCallback(async (docId: Id<"documents">, expiresAt: number, alertDays: number) => {
    if (!user) return;
    try {
      await setExpirationMutation({ documentId: docId, expiresAt, expirationAlertDays: alertDays, requestingUserId: user._id });
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to set expiration"); }
  }, [setExpirationMutation, user]);

  const handleRemoveExpiration = useCallback(async (docId: Id<"documents">) => {
    if (!user) return;
    try { await removeExpirationMutation({ documentId: docId, requestingUserId: user._id }); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to remove expiration"); }
  }, [removeExpirationMutation, user]);

  // Folder sharing
  const handleGrantAccess = useCallback(async (folderId: Id<"documentFolders">, userId: Id<"users">) => {
    if (!user) return;
    try {
      const targetUser = usersForSharing?.find(u => u._id === userId);
      await grantFolderAccess({
        folderId,
        grantedToUserId: userId,
        grantedToUserName: targetUser?.name || "Unknown",
        grantedByUserId: user._id,
        grantedByUserName: user.name,
      });
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to grant access"); }
  }, [user, grantFolderAccess, usersForSharing]);

  const handleRevokeAccess = useCallback(async (folderId: Id<"documentFolders">, grantId: Id<"folderAccessGrants">) => {
    if (!user) return;
    try {
      await revokeFolderAccess({ grantId, revokedByUserId: user._id });
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to revoke access"); }
  }, [user, revokeFolderAccess]);

  // Folder password
  const handleSetFolderPassword = useCallback(async (folderId: Id<"documentFolders">, password: string) => {
    try { await setFolderPasswordMutation({ folderId, password }); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to set password"); }
  }, [setFolderPasswordMutation]);

  const handleRemoveFolderPassword = useCallback(async (folderId: Id<"documentFolders">, password: string) => {
    try { await removeFolderPasswordMutation({ folderId, currentPassword: password }); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to remove password"); }
  }, [removeFolderPasswordMutation]);

  const getPublicUrl = useCallback((slug: string) => {
    if (typeof window !== "undefined") return `${window.location.origin}/public/doc/${slug}`;
    return `/public/doc/${slug}`;
  }, []);

  // Search queries (server-side)
  const searchResults = useQuery(
    api.documents.search,
    searchQuery.trim() && user ? { query: searchQuery, category: selectedCategory || undefined, userId: user._id } : "skip"
  ) as DocumentType[] | undefined;
  const folderSearchResults = useQuery(
    api.documentFolders.search,
    searchQuery.trim() ? { query: searchQuery } : "skip"
  ) as FolderType[] | undefined;

  // Computed: filtered documents
  // When searching, use server-side search results; otherwise filter loaded docs
  const sourceDocuments = showArchived ? archivedDocuments : currentFolderId ? folderDocuments : documents;
  const filteredDocuments = searchQuery.trim()
    ? searchResults
    : sourceDocuments?.filter((d) => {
        if (selectedCategory && d.category !== selectedCategory) return false;
        return true;
      });

  // Recent = the user's root documents, most-recently-updated first (client-side; no new query).
  const recentDocuments = documents
    ? [...documents].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 24)
    : undefined;

  return (
    <DocHubContext.Provider value={{
      isDark, user, isAdmin, isSuperAdmin,
      currentFolderId, setCurrentFolderId, breadcrumbs, navigateToFolder, navigateToRoot,
      viewMode, setViewMode, searchQuery, setSearchQuery, selectedCategory, setSelectedCategory, showArchived, setShowArchived,
      documents, folderDocuments, setFolderDocuments, filteredDocuments, myFolders, communityFolders, sharedFoldersWithMe, currentFolder, archivedDocuments,
      unlockedFolders, unlockFolder, handleOpenFolder, loadFolderDocuments, loadingFolderDocs,
      showUploadModal, setShowUploadModal, showFolderModal, setShowFolderModal,
      showGroupsModal, setShowGroupsModal,
      showManageDrawer, setShowManageDrawer,
      railSelection, setRailSelection, recentDocuments,
      handleUpload, uploading,
      handleDownload, handlePreview, handleArchive, handleDelete, handleRestore, handleEdit, handleShare, handleTogglePublic,
      handleCreateFolder, handleUpdateFolder, handleArchiveFolder, handleMoveDocument, handleMoveFolder,
      handleVerifyPassword,
      previewDocument, previewUrl, previewStorageUrl, loadingPreview, closePreview,
      storageUsage,
      shareDocumentId, setShareDocumentId, getPublicUrl,
      contextMenu, setContextMenu,
      error, setError,
      isDraggingOver, setIsDraggingOver,
      handleUploadNewVersion, documentVersions, versionHistoryDocId, setVersionHistoryDocId,
      templatesList,
      signDocumentId, setSignDocumentId, handleSignDocument, unsignedDocuments,
      handleSetExpiration, handleRemoveExpiration, expiringDocuments,
      handleGrantAccess, handleRevokeAccess, usersForSharing, folderAccessGrants: folderAccessGrantsData, shareFolderId, setShareFolderId,
      handleSetFolderPassword, handleRemoveFolderPassword,
      folderSearchResults,
      docSidebarCollapsed, setDocSidebarCollapsed,
    }}>
      {children}
    </DocHubContext.Provider>
  );
}
