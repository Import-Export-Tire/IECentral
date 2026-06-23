import { Id } from "@/convex/_generated/dataModel";

// Privacy tier definitions
export const PRIVACY_TIERS = {
  public: {
    label: "Public / Community",
    color: "emerald",
    bgLight: "bg-emerald-50",
    bgDark: "bg-emerald-500/10",
    borderLight: "border-emerald-200",
    borderDark: "border-emerald-500/30",
    textLight: "text-emerald-700",
    textDark: "text-emerald-400",
    dotLight: "bg-emerald-500",
    dotDark: "bg-emerald-400",
    icon: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    description: "Visible to all users",
  },
  internal: {
    label: "Internal",
    color: "blue",
    bgLight: "bg-blue-50",
    bgDark: "bg-blue-500/10",
    borderLight: "border-blue-200",
    borderDark: "border-blue-500/30",
    textLight: "text-blue-700",
    textDark: "text-blue-400",
    dotLight: "bg-blue-500",
    dotDark: "bg-blue-400",
    icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
    description: "Employees only",
  },
  confidential: {
    label: "Confidential / Financial",
    color: "amber",
    bgLight: "bg-amber-50",
    bgDark: "bg-amber-500/10",
    borderLight: "border-amber-200",
    borderDark: "border-amber-500/30",
    textLight: "text-amber-700",
    textDark: "text-amber-400",
    dotLight: "bg-amber-500",
    dotDark: "bg-amber-400",
    icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
    description: "Manager+ with audit trail",
  },
  hipaa: {
    label: "HIPAA / Restricted",
    color: "red",
    bgLight: "bg-red-50",
    bgDark: "bg-red-500/10",
    borderLight: "border-red-200",
    borderDark: "border-red-500/30",
    textLight: "text-red-700",
    textDark: "text-red-400",
    dotLight: "bg-red-500",
    dotDark: "bg-red-400",
    icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
    description: "Encrypted, access logged, specific users",
  },
} as const;

export type PrivacyTier = keyof typeof PRIVACY_TIERS;

export const CATEGORIES = [
  { value: "forms", label: "Forms", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { value: "policies", label: "Policies", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" },
  { value: "sops", label: "SOPs", icon: "M4 6h16M4 10h16M4 14h16M4 18h16" },
  { value: "templates", label: "Templates", icon: "M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" },
  { value: "training", label: "Training", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
  { value: "other", label: "Other", icon: "M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" },
] as const;

// File type helpers
export function getFileIcon(fileType: string): string {
  if (fileType.includes("pdf")) return "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z";
  if (fileType.includes("image")) return "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z";
  if (fileType.includes("spreadsheet") || fileType.includes("excel")) return "M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z";
  if (fileType.includes("word") || fileType.includes("document")) return "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z";
  return "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z";
}

export function getFileColor(fileType: string, isDark: boolean): string {
  if (fileType.includes("pdf")) return isDark ? "text-red-400" : "text-red-500";
  if (fileType.includes("image")) return isDark ? "text-purple-400" : "text-purple-500";
  if (fileType.includes("spreadsheet") || fileType.includes("excel")) return isDark ? "text-emerald-400" : "text-emerald-500";
  if (fileType.includes("word") || fileType.includes("document")) return isDark ? "text-blue-400" : "text-blue-500";
  return isDark ? "text-slate-400" : "text-gray-500";
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function canPreview(fileType: string): boolean {
  return fileType.includes("pdf") || fileType.includes("image") || isOfficeDocument(fileType);
}

export function isOfficeDocument(fileType: string): boolean {
  return (
    fileType.includes("word") ||
    fileType.includes("document") ||
    fileType.includes("msword") ||
    fileType.includes("spreadsheet") ||
    fileType.includes("excel") ||
    fileType.includes("presentation") ||
    fileType.includes("powerpoint")
  );
}

export function getFileMimeType(file: File): string {
  if (file.type && file.type !== "application/octet-stream") {
    return file.type;
  }
  const ext = file.name.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt: "text/plain",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    csv: "text/csv",
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}

// Map old visibility to new privacy tiers
export function visibilityToTier(visibility?: string, isProtected?: boolean): PrivacyTier {
  if (isProtected) return "hipaa";
  if (visibility === "community") return "public";
  if (visibility === "private") return "confidential";
  if (visibility === "internal") return "internal";
  // Legacy folders without explicit visibility
  return "internal";
}

export type ViewMode = "grid" | "list";

export interface BreadcrumbItem {
  id: Id<"documentFolders"> | null;
  name: string;
}

export type DocumentType = {
  _id: Id<"documents">;
  _creationTime: number;
  name: string;
  description?: string;
  category: string;
  folderId?: Id<"documentFolders">;
  fileId: Id<"_storage">;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedBy: Id<"users">;
  uploadedByName: string;
  isActive: boolean;
  downloadCount: number;
  isPublic?: boolean;
  publicSlug?: string;
  expiresAt?: number;
  expirationAlertDays?: number;
  requiresSignature?: boolean;
  signatureCount?: number;
  createdAt: number;
  updatedAt: number;
};

export type FolderType = {
  _id: Id<"documentFolders">;
  _creationTime: number;
  name: string;
  description?: string;
  passwordHash?: string;
  parentFolderId?: Id<"documentFolders">;
  visibility?: string;
  sharedWithGroups?: Id<"groups">[];
  createdBy: Id<"users">;
  createdByName: string;
  isActive: boolean;
  isProtected: boolean;
  documentCount: number; // recursive: files in this folder + all subfolders
  directDocumentCount?: number; // files directly in this folder
  subfolderCount?: number;
  createdAt: number;
  updatedAt: number;
};

// "3 folders · 12 files" / "5 files" / "2 folders" / "Empty" — reflects nested
// content so a container folder whose files live in subfolders isn't shown as "0 files".
export function folderCountLabel(folder: { subfolderCount?: number; documentCount?: number }): string {
  const folders = folder.subfolderCount ?? 0;
  const files = folder.documentCount ?? 0;
  const parts: string[] = [];
  if (folders > 0) parts.push(`${folders} ${folders === 1 ? "folder" : "folders"}`);
  if (files > 0) parts.push(`${files} ${files === 1 ? "file" : "files"}`);
  return parts.length ? parts.join(" · ") : "Empty";
}
