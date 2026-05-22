import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

// Get all active documents (optionally filter by folder)
// Respects document visibility: private docs only shown to owner or shared users
export const getAll = query({
  args: {
    folderId: v.optional(v.union(v.id("documentFolders"), v.null())),
    rootOnly: v.optional(v.boolean()), // If true, only return documents not in any folder
    userId: v.optional(v.id("users")), // Current user — used for visibility filtering
  },
  handler: async (ctx, args) => {
    let documents = await ctx.db
      .query("documents")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .order("desc")
      .collect();

    // Filter by folder if specified
    if (args.folderId !== undefined) {
      documents = documents.filter((d) => d.folderId === args.folderId);
    } else if (args.rootOnly) {
      // Only return documents not in any folder
      documents = documents.filter((d) => !d.folderId);
    }

    // Apply visibility filtering if userId provided
    if (args.userId) {
      // Get groups the user belongs to for group-based sharing
      const allGroups = await ctx.db
        .query("groups")
        .withIndex("by_active", (q) => q.eq("isActive", true))
        .collect();
      const userGroupIds = new Set(
        allGroups.filter((g) => g.memberIds.includes(args.userId!)).map((g) => g._id)
      );

      documents = documents.filter((d) => {
        const vis = d.visibility || "private";
        // Community/internal docs visible to all authenticated users
        if (vis === "community" || vis === "internal") return true;
        // Docs with a public link are visible to any authenticated user — if it's
        // on the open web it shouldn't be hidden inside the app.
        if (d.isPublic) return true;
        // Owner always sees their own docs
        if (d.uploadedBy === args.userId) return true;
        // Shared with user directly
        if (d.sharedWith && d.sharedWith.includes(args.userId!)) return true;
        // Shared with a group the user belongs to
        if (d.sharedWithGroups && d.sharedWithGroups.some((gId) => userGroupIds.has(gId))) return true;
        return false;
      });
    }

    return documents;
  },
});

// Get root documents (not in any folder)
export const getRootDocuments = query({
  args: {
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    let documents = await ctx.db
      .query("documents")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .order("desc")
      .collect();

    documents = documents.filter((d) => !d.folderId);

    // Apply visibility filtering
    if (args.userId) {
      const allGroups = await ctx.db.query("groups").withIndex("by_active", (q) => q.eq("isActive", true)).collect();
      const userGroupIds = new Set(allGroups.filter((g) => g.memberIds.includes(args.userId!)).map((g) => g._id));

      documents = documents.filter((d) => {
        const vis = d.visibility || "private";
        if (vis === "community" || vis === "internal") return true;
        if (d.isPublic) return true;
        if (d.uploadedBy === args.userId) return true;
        if (d.sharedWith && d.sharedWith.includes(args.userId!)) return true;
        if (d.sharedWithGroups && d.sharedWithGroups.some((gId) => userGroupIds.has(gId))) return true;
        return false;
      });
    }

    return documents;
  },
});

// Get documents by category
export const getByCategory = query({
  args: { category: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("documents")
      .withIndex("by_category", (q) => q.eq("category", args.category))
      .filter((q) => q.eq(q.field("isActive"), true))
      .order("desc")
      .collect();
  },
});

// Full-text search across documents
export const search = query({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    if (!args.query.trim()) return [];
    const searchTerm = args.query.toLowerCase();

    // Get all active documents
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    // Filter by search term (name, description, fileName)
    let results = docs.filter(
      (d) =>
        d.name.toLowerCase().includes(searchTerm) ||
        (d.description && d.description.toLowerCase().includes(searchTerm)) ||
        d.fileName.toLowerCase().includes(searchTerm)
    );

    if (args.category) {
      results = results.filter((d) => d.category === args.category);
    }

    // Apply visibility filtering
    if (args.userId) {
      const allGroups = await ctx.db.query("groups").withIndex("by_active", (q) => q.eq("isActive", true)).collect();
      const userGroupIds = new Set(allGroups.filter((g) => g.memberIds.includes(args.userId!)).map((g) => g._id));

      results = results.filter((d) => {
        const vis = d.visibility || "private";
        if (vis === "community" || vis === "internal") return true;
        if (d.isPublic) return true;
        if (d.uploadedBy === args.userId) return true;
        if (d.sharedWith && d.sharedWith.includes(args.userId!)) return true;
        if (d.sharedWithGroups && d.sharedWithGroups.some((gId) => userGroupIds.has(gId))) return true;
        return false;
      });
    }

    return results.slice(0, 50); // Limit results
  },
});

// Get single document by ID
export const getById = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.documentId);
  },
});

// Generate upload URL for file storage
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// Get download URL for a document
export const getDownloadUrl = query({
  args: { fileId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.fileId);
  },
});

// Create a new document
export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    category: v.string(),
    folderId: v.optional(v.id("documentFolders")),
    fileId: v.id("_storage"),
    fileName: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
    uploadedBy: v.id("users"),
    uploadedByName: v.string(),
    requiresSignature: v.optional(v.boolean()),
    visibility: v.optional(v.string()), // "private" | "internal" | "community" — defaults to "private"
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const { visibility: vis, ...rest } = args;
    return await ctx.db.insert("documents", {
      ...rest,
      visibility: vis || "private",
      isActive: true,
      downloadCount: 0,
      signatureCount: args.requiresSignature ? 0 : undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update document metadata
export const update = mutation({
  args: {
    documentId: v.id("documents"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    visibility: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { documentId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );
    await ctx.db.patch(documentId, {
      ...filteredUpdates,
      updatedAt: Date.now(),
    });
  },
});

// Share a document with specific users
export const shareWith = mutation({
  args: {
    documentId: v.id("documents"),
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error("Document not found");
    const existing = doc.sharedWith || [];
    const merged = [...new Set([...existing, ...args.userIds])];
    await ctx.db.patch(args.documentId, {
      sharedWith: merged,
      updatedAt: Date.now(),
    });
  },
});

// Unshare a document with a user
export const unshareWith = mutation({
  args: {
    documentId: v.id("documents"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error("Document not found");
    const updated = (doc.sharedWith || []).filter(id => id !== args.userId);
    await ctx.db.patch(args.documentId, {
      sharedWith: updated,
      updatedAt: Date.now(),
    });
  },
});

// Share a document with groups
export const shareWithGroups = mutation({
  args: {
    documentId: v.id("documents"),
    groupIds: v.array(v.id("groups")),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error("Document not found");
    const existing = doc.sharedWithGroups || [];
    const merged = [...new Set([...existing, ...args.groupIds])];
    await ctx.db.patch(args.documentId, {
      sharedWithGroups: merged,
      updatedAt: Date.now(),
    });
  },
});

// Unshare a document from a group
export const unshareWithGroup = mutation({
  args: {
    documentId: v.id("documents"),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error("Document not found");
    await ctx.db.patch(args.documentId, {
      sharedWithGroups: (doc.sharedWithGroups || []).filter((id) => id !== args.groupId),
      updatedAt: Date.now(),
    });
  },
});

// Increment download count
export const incrementDownload = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error("Document not found");
    await ctx.db.patch(args.documentId, {
      downloadCount: doc.downloadCount + 1,
    });
  },
});

// Archive a document (soft delete)
export const archive = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.documentId, {
      isActive: false,
      updatedAt: Date.now(),
    });
  },
});

// Permanently delete a document
export const remove = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (doc) {
      // Delete the file from storage
      await ctx.storage.delete(doc.fileId);
      // Delete the document record
      await ctx.db.delete(args.documentId);
    }
  },
});

// Get document categories with counts
export const getCategoryCounts = query({
  args: {},
  handler: async (ctx) => {
    const documents = await ctx.db
      .query("documents")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    const counts: Record<string, number> = {};
    for (const doc of documents) {
      counts[doc.category] = (counts[doc.category] || 0) + 1;
    }
    return counts;
  },
});

// Get archived documents (for admin view)
export const getArchived = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("documents")
      .withIndex("by_active", (q) => q.eq("isActive", false))
      .order("desc")
      .collect();
  },
});

// Restore an archived document
export const restore = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.documentId, {
      isActive: true,
      updatedAt: Date.now(),
    });
  },
});

// Action to get download URL (can be called imperatively)
export const getFileDownloadUrl = action({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args): Promise<string | null> => {
    const doc = await ctx.runQuery(api.documents.getById, { documentId: args.documentId });
    if (!doc || !doc.fileId) return null;

    try {
      const url = await ctx.storage.getUrl(doc.fileId);
      return url;
    } catch {
      return null;
    }
  },
});

// ============ EXPIRATION FEATURES ============

// Get documents expiring within the next N days
export const getExpiring = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const days = args.days ?? 30;
    const now = Date.now();
    const futureLimit = now + days * 24 * 60 * 60 * 1000;

    const documents = await ctx.db
      .query("documents")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    return documents.filter((doc) => {
      if (!doc.expiresAt) return false;
      return doc.expiresAt <= futureLimit;
    });
  },
});

// Set expiration date and alert days on a document
export const setExpiration = mutation({
  args: {
    documentId: v.id("documents"),
    expiresAt: v.number(),
    expirationAlertDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.documentId, {
      expiresAt: args.expiresAt,
      expirationAlertDays: args.expirationAlertDays ?? 30,
      updatedAt: Date.now(),
    });
  },
});

// Remove expiration from a document
export const removeExpiration = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.documentId, {
      expiresAt: undefined,
      expirationAlertDays: undefined,
      updatedAt: Date.now(),
    });
  },
});

// ============ PUBLIC DOCUMENT ACCESS ============

// Generate a URL-friendly slug from a name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50);
}

// Toggle public access for a document
export const togglePublic = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error("Document not found");

    const isPublic = !doc.isPublic;

    if (isPublic) {
      // Turning ON public access - generate a slug
      // Convert document ID to string for slicing
      const idString = String(args.documentId);
      const publicSlug = generateSlug(doc.name) + "-" + idString.slice(-6);
      await ctx.db.patch(args.documentId, {
        isPublic: true,
        publicSlug,
        updatedAt: Date.now(),
      });
      return { isPublic: true, publicSlug };
    } else {
      // Turning OFF public access - keep the slug but mark as not public
      await ctx.db.patch(args.documentId, {
        isPublic: false,
        updatedAt: Date.now(),
      });
      return { isPublic: false, publicSlug: doc.publicSlug };
    }
  },
});

// Get public document by slug (no auth required)
export const getPublicBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("documents")
      .withIndex("by_public_slug", (q) => q.eq("publicSlug", args.slug))
      .first();

    if (!doc || !doc.isPublic || !doc.isActive) {
      return null;
    }

    return doc;
  },
});

// Get public document file URL by slug (no auth required)
export const getPublicFileUrl = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("documents")
      .withIndex("by_public_slug", (q) => q.eq("publicSlug", args.slug))
      .first();

    if (!doc || !doc.isPublic || !doc.isActive) {
      return null;
    }

    return await ctx.storage.getUrl(doc.fileId);
  },
});

// ============ VERSION HISTORY ============

// Get all versions for a document, sorted by version desc
export const getVersions = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const versions = await ctx.db
      .query("documentVersions")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();

    // Sort by version descending
    return versions.sort((a, b) => b.version - a.version);
  },
});

// Upload a new version of a document
export const uploadNewVersion = mutation({
  args: {
    documentId: v.id("documents"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
    changeNotes: v.optional(v.string()),
    uploadedBy: v.id("users"),
    uploadedByName: v.string(),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error("Document not found");

    // Get existing versions to determine the next version number
    const existingVersions = await ctx.db
      .query("documentVersions")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();

    const maxVersion = existingVersions.length > 0
      ? Math.max(...existingVersions.map((v) => v.version))
      : 0;

    // Archive the current file as a version
    await ctx.db.insert("documentVersions", {
      documentId: args.documentId,
      version: maxVersion + 1,
      fileId: doc.fileId,
      fileName: doc.fileName,
      fileSize: doc.fileSize,
      fileType: doc.fileType,
      changeNotes: "Archived before new upload",
      uploadedBy: doc.uploadedBy,
      uploadedByName: doc.uploadedByName,
      createdAt: doc.updatedAt,
    });

    // Replace the document's file with the new one
    await ctx.db.patch(args.documentId, {
      fileId: args.fileId,
      fileName: args.fileName,
      fileType: args.fileType,
      fileSize: args.fileSize,
      uploadedBy: args.uploadedBy,
      uploadedByName: args.uploadedByName,
      updatedAt: Date.now(),
    });

    // Create the new version entry
    const newVersionId = await ctx.db.insert("documentVersions", {
      documentId: args.documentId,
      version: maxVersion + 2,
      fileId: args.fileId,
      fileName: args.fileName,
      fileSize: args.fileSize,
      fileType: args.fileType,
      changeNotes: args.changeNotes,
      uploadedBy: args.uploadedBy,
      uploadedByName: args.uploadedByName,
      createdAt: Date.now(),
    });

    return newVersionId;
  },
});

// Restore a previous version
export const restoreVersion = mutation({
  args: {
    documentId: v.id("documents"),
    versionId: v.id("documentVersions"),
    restoredBy: v.id("users"),
    restoredByName: v.string(),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error("Document not found");

    const version = await ctx.db.get(args.versionId);
    if (!version) throw new Error("Version not found");
    if (version.documentId !== args.documentId) throw new Error("Version does not belong to this document");

    // Get max version number
    const existingVersions = await ctx.db
      .query("documentVersions")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();

    const maxVersion = existingVersions.length > 0
      ? Math.max(...existingVersions.map((v) => v.version))
      : 0;

    // Archive current file as a new version
    await ctx.db.insert("documentVersions", {
      documentId: args.documentId,
      version: maxVersion + 1,
      fileId: doc.fileId,
      fileName: doc.fileName,
      fileSize: doc.fileSize,
      fileType: doc.fileType,
      changeNotes: "Archived before restore",
      uploadedBy: doc.uploadedBy,
      uploadedByName: doc.uploadedByName,
      createdAt: doc.updatedAt,
    });

    // Restore the selected version's file to the document
    await ctx.db.patch(args.documentId, {
      fileId: version.fileId,
      fileName: version.fileName,
      fileType: version.fileType,
      fileSize: version.fileSize,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});
