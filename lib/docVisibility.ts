// Pure Doc Hub access predicate — mirrors the visibility logic in
// convex/documents.ts `getAll`, extracted so it can be reused by global search
// and unit-tested without Convex. A document is visible to a user when its
// visibility/sharing allows it AND it is not inside a password-protected folder
// the user can't access.
export type VisDoc = {
  uploadedBy: string;
  visibility?: string;
  isPublic?: boolean;
  sharedWith?: string[];
  sharedWithGroups?: string[];
  folderId?: string;
};

/**
 * @param lockedFolderIds password-protected folders the user neither owns nor has a grant to.
 */
export function canSeeDocument(
  doc: VisDoc,
  userId: string,
  groupIds: Set<string>,
  lockedFolderIds: Set<string>,
): boolean {
  if (doc.folderId && lockedFolderIds.has(doc.folderId)) return false;
  if (doc.uploadedBy === userId) return true;
  const vis = doc.visibility || "private";
  if (vis === "community" || vis === "internal") return true;
  if (doc.isPublic) return true;
  if (doc.sharedWith?.includes(userId)) return true;
  if (doc.sharedWithGroups?.some((g) => groupIds.has(g))) return true;
  return false;
}
