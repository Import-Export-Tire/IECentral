import { query, mutation, action, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { requireMinTier } from "./authGuards";

// Password hashing utilities (same as auth.ts)
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  const passwordKey = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    passwordKey,
    KEY_LENGTH * 8
  );

  const hashArray = new Uint8Array(hashBuffer);
  const saltHex = bufferToHex(salt);
  const hashHex = bufferToHex(hashArray);

  return `${saltHex}$${PBKDF2_ITERATIONS}$${hashHex}`;
}

async function verifyPasswordHash(
  password: string,
  storedHash: string
): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 3) {
    return false;
  }

  const [saltHex, iterationsStr, hashHex] = parts;
  const iterations = parseInt(iterationsStr, 10);
  const salt = hexToBuffer(saltHex);

  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  const passwordKey = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: iterations,
      hash: "SHA-256",
    },
    passwordKey,
    KEY_LENGTH * 8
  );

  const computedHashHex = bufferToHex(new Uint8Array(hashBuffer));

  // Constant-time comparison
  if (computedHashHex.length !== hashHex.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < computedHashHex.length; i++) {
    result |= computedHashHex.charCodeAt(i) ^ hashHex.charCodeAt(i);
  }
  return result === 0;
}

// Full-text search across folders
export const search = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    if (!args.query.trim()) return [];
    const searchTerm = args.query.toLowerCase();

    const folders = await ctx.db
      .query("documentFolders")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    return folders
      .filter(
        (f) =>
          f.name.toLowerCase().includes(searchTerm) ||
          (f.description && f.description.toLowerCase().includes(searchTerm))
      )
      .slice(0, 20);
  },
});

// ============ QUERIES ============

// Build a parentFolderId -> child folder ids map from a set of (active) folders.
function buildChildrenMap(allFolders: any[]): Map<string, string[]> {
  const childrenByParent = new Map<string, string[]>();
  for (const f of allFolders) {
    if (!f.parentFolderId) continue;
    const arr = childrenByParent.get(f.parentFolderId) ?? [];
    arr.push(f._id);
    childrenByParent.set(f.parentFolderId, arr);
  }
  return childrenByParent;
}

// Build a folderId -> direct active-document count map from a set of (active) docs.
function buildDirectDocCount(allDocs: any[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const d of allDocs) {
    if (!d.folderId) continue;
    count.set(d.folderId, (count.get(d.folderId) ?? 0) + 1);
  }
  return count;
}

// Total active documents in a folder's whole subtree (the folder + all descendants).
function countDocsInSubtree(
  folderId: string,
  childrenByParent: Map<string, string[]>,
  directCount: Map<string, number>,
): number {
  let total = directCount.get(folderId) ?? 0;
  for (const childId of childrenByParent.get(folderId) ?? []) {
    total += countDocsInSubtree(childId, childrenByParent, directCount);
  }
  return total;
}

// HIPAA-compliant folder visibility helper.
// documentCount is RECURSIVE (files in this folder + every subfolder) so a
// container folder whose files live in subfolders no longer reads "0 files".
// directDocumentCount is the count of files directly in this folder.
function getFolderWithCounts(
  folder: any,
  childrenByParent: Map<string, string[]>,
  directCount: Map<string, number>,
) {
  const subfolderCount = (childrenByParent.get(folder._id) ?? []).length;
  return {
    ...folder,
    documentCount: countDocsInSubtree(folder._id, childrenByParent, directCount),
    directDocumentCount: directCount.get(folder._id) ?? 0,
    subfolderCount,
    isProtected: !!folder.passwordHash,
  };
}

// Load the active folders + docs and build the maps the helper needs (recursive
// counts span the whole tree, so we always tally over ALL active folders/docs).
async function loadFolderCountMaps(ctx: any) {
  const allDocs = await ctx.db
    .query("documents")
    .withIndex("by_active", (q: any) => q.eq("isActive", true))
    .collect();
  const allActiveFolders = await ctx.db
    .query("documentFolders")
    .withIndex("by_active", (q: any) => q.eq("isActive", true))
    .collect();
  return {
    directCount: buildDirectDocCount(allDocs),
    childrenByParent: buildChildrenMap(allActiveFolders),
  };
}

// Get user's own folders (My Folders)
export const getMyFolders = query({
  args: {
    userId: v.id("users"),
    parentFolderId: v.optional(v.union(v.id("documentFolders"), v.null())),
  },
  handler: async (ctx, args) => {
    const allFolders = await ctx.db
      .query("documentFolders")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    // Filter to user's own folders
    let filteredFolders = allFolders.filter((f) => f.createdBy === args.userId);

    // Filter by parent folder
    if (args.parentFolderId === null) {
      filteredFolders = filteredFolders.filter((f) => !f.parentFolderId);
    } else if (args.parentFolderId) {
      filteredFolders = filteredFolders.filter((f) => f.parentFolderId === args.parentFolderId);
    }

    // Get (recursive) document counts and subfolder counts
    const { directCount, childrenByParent } = await loadFolderCountMaps(ctx);
    return filteredFolders.map((folder) => getFolderWithCounts(folder, childrenByParent, directCount));
  },
});

// Get community/public folders (visible to all users)
export const getCommunityFolders = query({
  args: {
    parentFolderId: v.optional(v.union(v.id("documentFolders"), v.null())),
  },
  handler: async (ctx, args) => {
    const allFolders = await ctx.db
      .query("documentFolders")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    // Filter to community folders
    let filteredFolders = allFolders.filter((f) => f.visibility === "community");

    // Filter by parent folder
    if (args.parentFolderId === null) {
      filteredFolders = filteredFolders.filter((f) => !f.parentFolderId);
    } else if (args.parentFolderId) {
      filteredFolders = filteredFolders.filter((f) => f.parentFolderId === args.parentFolderId);
    }

    // Get (recursive) document counts and subfolder counts
    const { directCount, childrenByParent } = await loadFolderCountMaps(ctx);
    return filteredFolders.map((folder) => getFolderWithCounts(folder, childrenByParent, directCount));
  },
});

// Legacy: Get all active folders (for backward compatibility during migration)
// This should only be used by admins for folder management, not viewing contents
export const getAll = query({
  args: {
    parentFolderId: v.optional(v.union(v.id("documentFolders"), v.null())),
    userId: v.optional(v.id("users")), // If provided, filter by user access
  },
  handler: async (ctx, args) => {
    const folders = await ctx.db
      .query("documentFolders")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .order("desc")
      .collect();

    // Filter by parent folder
    let filteredFolders = folders.filter((f) => {
      if (args.parentFolderId === undefined) {
        return true;
      } else if (args.parentFolderId === null) {
        return !f.parentFolderId;
      } else {
        return f.parentFolderId === args.parentFolderId;
      }
    });

    // If userId provided, filter to folders user has access to
    if (args.userId) {
      const userId = args.userId; // Capture for type narrowing
      // Get all grants for this user
      const grants = await ctx.db
        .query("folderAccessGrants")
        .withIndex("by_user", (q) => q.eq("grantedToUserId", userId))
        .filter((q) => q.eq(q.field("isRevoked"), false))
        .collect();
      const grantedFolderIds = new Set(grants.map((g) => g.folderId));

      // Filter to: own folders, shared folders, or community folders
      filteredFolders = filteredFolders.filter((f) =>
        f.createdBy === userId ||
        grantedFolderIds.has(f._id) ||
        f.visibility === "community"
      );
    }

    // Get document counts and subfolder counts for each folder
    const foldersWithCounts = await Promise.all(
      filteredFolders.map(async (folder) => {
        const docs = await ctx.db
          .query("documents")
          .withIndex("by_folder", (q) => q.eq("folderId", folder._id))
          .filter((q) => q.eq(q.field("isActive"), true))
          .collect();

        // Count subfolders
        const subfolders = folders.filter(
          (f) => f.parentFolderId === folder._id && f.isActive
        );

        return {
          ...folder,
          documentCount: docs.length,
          subfolderCount: subfolders.length,
          isProtected: !!folder.passwordHash,
        };
      })
    );

    return foldersWithCounts;
  },
});

// Get folder by ID (metadata only)
export const getById = query({
  args: { folderId: v.id("documentFolders") },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder) return null;

    const docs = await ctx.db
      .query("documents")
      .withIndex("by_folder", (q) => q.eq("folderId", folder._id))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    const { passwordHash, ...safeFolder } = folder;
    return {
      ...safeFolder,
      documentCount: docs.length,
      isProtected: !!passwordHash,
    };
  },
});

// Get documents in unprotected folder
export const getDocumentsInFolder = query({
  args: { folderId: v.id("documentFolders") },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder || !folder.isActive) {
      return null;
    }

    // If folder is protected, don't return documents via query
    if (folder.passwordHash) {
      return { error: "Folder is password protected" };
    }

    const documents = await ctx.db
      .query("documents")
      .withIndex("by_folder", (q) => q.eq("folderId", args.folderId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .order("desc")
      .collect();

    return { documents };
  },
});

// ============ MUTATIONS ============

// Create a new folder (password optional)
export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    password: v.optional(v.string()),
    parentFolderId: v.optional(v.id("documentFolders")),
    visibility: v.optional(v.string()), // "private" | "community"
    createdBy: v.id("users"),
    createdByName: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let passwordHash: string | undefined;

    if (args.password) {
      passwordHash = await hashPassword(args.password);
    }

    // Default to private for password-protected folders
    const visibility = args.visibility || (passwordHash ? "private" : "private");

    return await ctx.db.insert("documentFolders", {
      name: args.name,
      description: args.description,
      passwordHash,
      parentFolderId: args.parentFolderId,
      visibility,
      createdBy: args.createdBy,
      createdByName: args.createdByName,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update folder metadata (name, description, visibility)
export const update = mutation({
  args: {
    folderId: v.id("documentFolders"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    visibility: v.optional(v.string()), // "private" | "community"
  },
  handler: async (ctx, args) => {
    const { folderId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );

    await ctx.db.patch(folderId, {
      ...filteredUpdates,
      updatedAt: Date.now(),
    });
  },
});

// Update shared groups on a folder
export const updateSharedGroups = mutation({
  args: {
    folderId: v.id("documentFolders"),
    groupIds: v.array(v.id("groups")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.folderId, {
      sharedWithGroups: args.groupIds,
      updatedAt: Date.now(),
    });
  },
});

// Set or change password on a folder
export const setPassword = mutation({
  args: {
    folderId: v.id("documentFolders"),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const passwordHash = await hashPassword(args.password);
    await ctx.db.patch(args.folderId, {
      passwordHash,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

// Remove password protection from a folder
export const removePassword = mutation({
  args: {
    folderId: v.id("documentFolders"),
    currentPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder || !folder.passwordHash) {
      return { success: false, error: "Folder not found or not protected" };
    }

    const valid = await verifyPasswordHash(args.currentPassword, folder.passwordHash);
    if (!valid) {
      return { success: false, error: "Invalid password" };
    }

    await ctx.db.patch(args.folderId, {
      passwordHash: undefined,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

// Archive a folder (soft delete) - only if empty
export const archive = mutation({
  args: { folderId: v.id("documentFolders") },
  handler: async (ctx, args) => {
    // Check if folder has documents
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_folder", (q) => q.eq("folderId", args.folderId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    if (docs.length > 0) {
      throw new Error("Cannot archive folder with documents. Move or delete documents first.");
    }

    // Check if folder has subfolders
    const subfolders = await ctx.db
      .query("documentFolders")
      .withIndex("by_parent", (q) => q.eq("parentFolderId", args.folderId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    if (subfolders.length > 0) {
      throw new Error("Cannot archive folder with subfolders. Move or delete subfolders first.");
    }

    await ctx.db.patch(args.folderId, {
      isActive: false,
      updatedAt: Date.now(),
    });
  },
});

// Permanently delete a folder (moves documents back to root)
export const remove = mutation({
  args: { folderId: v.id("documentFolders") },
  handler: async (ctx, args) => {
    // Move all documents in this folder back to root (no folder)
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_folder", (q) => q.eq("folderId", args.folderId))
      .collect();

    for (const doc of docs) {
      await ctx.db.patch(doc._id, { folderId: undefined });
    }

    // Delete the folder
    await ctx.db.delete(args.folderId);
  },
});

// Move document to folder
export const moveDocument = mutation({
  args: {
    documentId: v.id("documents"),
    folderId: v.union(v.id("documentFolders"), v.null()),
  },
  handler: async (ctx, args) => {
    // Guard: if the document was already deleted (e.g. a stale client card),
    // patching a missing id throws a generic server error. Return quietly so
    // the UI doesn't surface a scary "Server Error" for a no-op.
    const doc = await ctx.db.get(args.documentId);
    if (!doc) return;
    await ctx.db.patch(args.documentId, {
      folderId: args.folderId ?? undefined,
      updatedAt: Date.now(),
    });
  },
});

// Move a folder into another folder (nested folders)
export const moveFolder = mutation({
  args: {
    folderId: v.id("documentFolders"),
    parentFolderId: v.union(v.id("documentFolders"), v.null()),
  },
  handler: async (ctx, args) => {
    // Prevent moving a folder into itself
    if (args.folderId === args.parentFolderId) {
      throw new Error("Cannot move a folder into itself");
    }

    // Prevent circular references - check if target is a descendant
    if (args.parentFolderId) {
      let current = await ctx.db.get(args.parentFolderId);
      while (current?.parentFolderId) {
        if (current.parentFolderId === args.folderId) {
          throw new Error("Cannot move a folder into its own descendant");
        }
        current = await ctx.db.get(current.parentFolderId);
      }
    }

    await ctx.db.patch(args.folderId, {
      parentFolderId: args.parentFolderId ?? undefined,
      updatedAt: Date.now(),
    });
  },
});

// ============ ACTIONS (for password-protected operations) ============

// Internal query to get folder with password hash (for action use).
// SECURITY: internalQuery — a public query here returns passwordHash and
// enables offline brute-force of protected-folder passwords.
export const getFolderWithPassword = internalQuery({
  args: { folderId: v.id("documentFolders") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.folderId);
  },
});

// Internal query to get documents (used by action).
// SECURITY: internalQuery — a public query here bypasses folder password /
// access control and returns every document in any protected folder.
export const getDocumentsInternal = internalQuery({
  args: { folderId: v.id("documentFolders") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("documents")
      .withIndex("by_folder", (q) => q.eq("folderId", args.folderId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .order("desc")
      .collect();
  },
});

// Verify folder password
export const verifyPassword = action({
  args: {
    folderId: v.id("documentFolders"),
    password: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    const folder = await ctx.runQuery(internal.documentFolders.getFolderWithPassword, {
      folderId: args.folderId,
    });

    if (!folder) {
      return { success: false, error: "Folder not found" };
    }

    if (!folder.passwordHash) {
      // Folder is not protected
      return { success: true };
    }

    const valid = await verifyPasswordHash(args.password, folder.passwordHash);
    if (!valid) {
      return { success: false, error: "Invalid password" };
    }

    return { success: true };
  },
});

// HIPAA-compliant: Get documents from protected folder
// Access is granted if: owner, has password, has access grant, or community folder
// Super admin does NOT bypass password (HIPAA minimum necessary principle)
export const getProtectedDocuments = action({
  args: {
    folderId: v.id("documentFolders"),
    password: v.string(),
    userId: v.optional(v.id("users")),
    userName: v.optional(v.string()),
    userEmail: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string; documents?: unknown[]; accessMethod?: string }> => {
    try {
      const folder = await ctx.runQuery(internal.documentFolders.getFolderWithPassword, {
        folderId: args.folderId,
      });

      if (!folder) {
        return { success: false, error: "Folder not found" };
      }

      // Normalize visibility - treat undefined/null as "private"
      const folderVisibility = folder.visibility || "private";

      // FAST PATH: Community folders are accessible to everyone - no auth needed
      if (folderVisibility === "community") {
        const documents = await ctx.runQuery(internal.documentFolders.getDocumentsInternal, {
          folderId: args.folderId,
        });
        return { success: true, documents, accessMethod: "community" };
      }

      let accessMethod = "";
      let hasAccess = false;

      // 1. Check if user is the owner (creator)
      if (args.userId && folder.createdBy === args.userId) {
        hasAccess = true;
        accessMethod = "owner";
      }

      // 3. Check if user has been granted access (only for password-protected folders)
      if (!hasAccess && args.userId && folder.passwordHash) {
        try {
          const accessCheck = await ctx.runQuery(api.documentFolders.checkUserAccess, {
            folderId: args.folderId,
            userId: args.userId,
          });
          if (accessCheck.hasAccess) {
            hasAccess = true;
            accessMethod = "grant";
          }
        } catch (e) {
          // Continue if access check fails - try other methods
          console.error("Access check error:", e);
        }
      }

      // 3b. Check if user belongs to a group that has access
      if (!hasAccess && args.userId && folder.sharedWithGroups && folder.sharedWithGroups.length > 0) {
        try {
          const allGroups = await ctx.runQuery(api.groups.list);
          const userGroups = allGroups.filter((g: { memberIds: string[] }) => g.memberIds.includes(args.userId!));
          const hasGroupAccess = userGroups.some((g: { _id: string }) => folder.sharedWithGroups!.includes(g._id as any));
          if (hasGroupAccess) {
            hasAccess = true;
            accessMethod = "grant";
          }
        } catch (e) {
          console.error("Group access check error:", e);
        }
      }

      // 3c. Check if folder visibility is "internal" (all employees)
      if (!hasAccess && args.userId && folderVisibility === "internal") {
        hasAccess = true;
        accessMethod = "community";
      }

      // 4. Check password if still no access
      if (!hasAccess && folder.passwordHash && args.password) {
        try {
          const valid = await verifyPasswordHash(args.password, folder.passwordHash);
          if (valid) {
            hasAccess = true;
            accessMethod = "password";
          } else {
            // Log failed password attempt
            if (args.userId && args.userName) {
              const userId = args.userId;
              const userName = args.userName;
              await ctx.runMutation(api.documentFolders.logFolderAccess, {
                folderId: args.folderId,
                folderName: folder.name,
                userId,
                userName,
                userEmail: args.userEmail,
                action: "password_attempt",
                accessMethod: "password",
                success: false,
              });
            }
            return { success: false, error: "Invalid password" };
          }
        } catch (e) {
          console.error("Password verification error:", e);
          return { success: false, error: "Password verification failed" };
        }
      }

      // 5. If folder has no password and is private, only owner can access
      if (!hasAccess && !folder.passwordHash && folderVisibility !== "community") {
        // Private unprotected folder - only owner
        if (args.userId && folder.createdBy === args.userId) {
          hasAccess = true;
          accessMethod = "owner";
        }
      }

      if (!hasAccess) {
        return { success: false, error: "Access denied. You need permission or the password to view this folder." };
      }

      // Log successful access (only if we have user info)
      if (args.userId && args.userName) {
        try {
          const userId = args.userId;
          const userName = args.userName;
          await ctx.runMutation(api.documentFolders.logFolderAccess, {
            folderId: args.folderId,
            folderName: folder.name,
            userId,
            userName,
            userEmail: args.userEmail,
            action: "view",
            accessMethod: accessMethod || "unknown",
            success: true,
          });
        } catch (e) {
          // Don't fail the request if logging fails
          console.error("Failed to log access:", e);
        }
      }

      // Fetch documents via internal query
      const documents = await ctx.runQuery(internal.documentFolders.getDocumentsInternal, {
        folderId: args.folderId,
      });

      return { success: true, documents, accessMethod };
    } catch (e) {
      console.error("getProtectedDocuments error:", e);
      return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
    }
  },
});

// Log folder access (for HIPAA compliance)
export const logFolderAccess = mutation({
  args: {
    folderId: v.id("documentFolders"),
    folderName: v.string(),
    userId: v.id("users"),
    userName: v.string(),
    userEmail: v.optional(v.string()),
    action: v.string(),
    accessMethod: v.string(),
    success: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("folderAccessLog", {
      folderId: args.folderId,
      folderName: args.folderName,
      userId: args.userId,
      userName: args.userName,
      userEmail: args.userEmail,
      action: args.action,
      accessMethod: args.accessMethod,
      success: args.success,
      timestamp: Date.now(),
    });
  },
});

// Get access logs for a folder (for admins)
export const getFolderAccessLogs = query({
  args: {
    folderId: v.id("documentFolders"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query("folderAccessLog")
      .withIndex("by_folder", (q) => q.eq("folderId", args.folderId))
      .order("desc")
      .take(args.limit || 100);

    return logs;
  },
});

// ============ FOLDER SHARING ============

// Get all access grants for a folder
export const getFolderAccessGrants = query({
  args: { folderId: v.id("documentFolders") },
  handler: async (ctx, args) => {
    const grants = await ctx.db
      .query("folderAccessGrants")
      .withIndex("by_folder", (q) => q.eq("folderId", args.folderId))
      .collect();

    // Filter out revoked grants and return active ones
    return grants.filter((g) => !g.isRevoked);
  },
});

// Check if a user has access to a folder (via grant)
export const checkUserAccess = query({
  args: {
    folderId: v.id("documentFolders"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const grants = await ctx.db
      .query("folderAccessGrants")
      .withIndex("by_folder_user", (q) =>
        q.eq("folderId", args.folderId).eq("grantedToUserId", args.userId)
      )
      .collect();

    // Check for active, non-expired grant
    const now = Date.now();
    const activeGrant = grants.find(
      (g) => !g.isRevoked && (!g.expiresAt || g.expiresAt > now)
    );

    return { hasAccess: !!activeGrant, grant: activeGrant || null };
  },
});

// Grant access to a folder
export const grantAccess = mutation({
  args: {
    folderId: v.id("documentFolders"),
    grantedToUserId: v.id("users"),
    grantedToUserName: v.string(),
    grantedByUserId: v.id("users"),
    grantedByUserName: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Check if grant already exists
    const existing = await ctx.db
      .query("folderAccessGrants")
      .withIndex("by_folder_user", (q) =>
        q.eq("folderId", args.folderId).eq("grantedToUserId", args.grantedToUserId)
      )
      .filter((q) => q.eq(q.field("isRevoked"), false))
      .first();

    if (existing) {
      // Update existing grant
      await ctx.db.patch(existing._id, {
        expiresAt: args.expiresAt,
        grantedAt: Date.now(),
        grantedByUserId: args.grantedByUserId,
        grantedByUserName: args.grantedByUserName,
      });
      return existing._id;
    }

    // Create new grant
    return await ctx.db.insert("folderAccessGrants", {
      folderId: args.folderId,
      grantedToUserId: args.grantedToUserId,
      grantedToUserName: args.grantedToUserName,
      grantedByUserId: args.grantedByUserId,
      grantedByUserName: args.grantedByUserName,
      grantedAt: Date.now(),
      expiresAt: args.expiresAt,
      isRevoked: false,
    });
  },
});

// Revoke access to a folder
export const revokeAccess = mutation({
  args: {
    grantId: v.id("folderAccessGrants"),
    revokedByUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.grantId, {
      isRevoked: true,
      revokedAt: Date.now(),
      revokedByUserId: args.revokedByUserId,
    });
  },
});

// Get all folders shared with a user
export const getSharedFolders = query({
  args: {
    userId: v.id("users"),
    // Parent-aware like getMyFolders/getCommunityFolders so shared subfolders nest
    // under their parent instead of all appearing flat at the root.
    parentFolderId: v.optional(v.union(v.id("documentFolders"), v.null())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Build a map of folders the user can access via sharing, keyed by folder id so a
    // folder shared BOTH directly and via a group only appears once (direct grant wins).
    // value carries the display metadata the UI expects (grantedAt / grantedByUserName / expiresAt).
    const meta = new Map<
      string,
      { folder: any; grantedAt?: number; grantedByUserName?: string; expiresAt?: number }
    >();

    // 1) Direct per-user grants (folderAccessGrants).
    const grants = await ctx.db
      .query("folderAccessGrants")
      .withIndex("by_user", (q) => q.eq("grantedToUserId", args.userId))
      .filter((q) => q.eq(q.field("isRevoked"), false))
      .collect();
    for (const grant of grants) {
      if (grant.expiresAt && grant.expiresAt <= now) continue;
      const folder = await ctx.db.get(grant.folderId);
      if (!folder || !folder.isActive) continue;
      meta.set(folder._id, {
        folder,
        grantedAt: grant.grantedAt,
        grantedByUserName: grant.grantedByUserName,
        expiresAt: grant.expiresAt,
      });
    }

    // 2) Group-based sharing: any folder whose sharedWithGroups includes a group the
    //    user is a member of. (This was previously ignored, so "share with a group"
    //    granted no folder access through the listing.)
    const userGroups = (
      await ctx.db
        .query("groups")
        .withIndex("by_active", (q) => q.eq("isActive", true))
        .collect()
    ).filter((g) => g.memberIds.includes(args.userId));
    if (userGroups.length > 0) {
      const groupNameById = new Map(userGroups.map((g) => [g._id as string, g.name]));
      const userGroupIds = new Set(userGroups.map((g) => g._id as string));
      const allFolders = await ctx.db
        .query("documentFolders")
        .withIndex("by_active", (q) => q.eq("isActive", true))
        .collect();
      for (const folder of allFolders) {
        if (meta.has(folder._id)) continue; // a direct grant already covers it
        const viaGroupIds = (folder.sharedWithGroups ?? []).filter((gid) =>
          userGroupIds.has(gid as string)
        );
        if (viaGroupIds.length === 0) continue;
        const viaNames = viaGroupIds
          .map((gid) => groupNameById.get(gid as string))
          .filter(Boolean);
        meta.set(folder._id, {
          folder,
          grantedAt: folder._creationTime,
          grantedByUserName: viaNames.length ? `Group: ${viaNames.join(", ")}` : "Group",
          expiresAt: undefined,
        });
      }
    }

    // Filter to the requested level (mirrors getMyFolders): undefined = all levels
    // (back-compat), null = top-level only, an id = direct children of that folder.
    const atLevel = [...meta.values()].filter(({ folder }) => {
      if (args.parentFolderId === undefined) return true;
      if (args.parentFolderId === null) return !folder.parentFolderId;
      return folder.parentFolderId === args.parentFolderId;
    });

    // Use the SAME recursive count helper as getMyFolders/getCommunityFolders so a
    // shared CONTAINER folder (0 direct files, but files in subfolders) shows its real
    // "N folders · M files" instead of reading "Empty". (Previously this counted only
    // direct files and never set subfolderCount, so containers looked empty.)
    const { directCount, childrenByParent } = await loadFolderCountMaps(ctx);
    const sharedFolders = atLevel.map(({ folder, grantedAt, grantedByUserName, expiresAt }) => ({
      ...getFolderWithCounts(folder, childrenByParent, directCount),
      grantedAt,
      grantedByUserName,
      expiresAt,
    }));

    return sharedFolders.filter(Boolean);
  },
});

// Get all users for sharing dropdown
export const getUsersForSharing = query({
  args: { requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireMinTier(ctx, args.requestingUserId, 0); // must be a real, active user
    const users = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
    return users.map((u) => ({ _id: u._id, name: u.name, email: u.email, role: u.role }));
  },
});

// ============ FOLDER ORDERING (PER USER) ============

// Get user's folder order for a section
export const getFolderOrder = query({
  args: {
    userId: v.id("users"),
    section: v.string(), // "myFolders" | "shared" | "community"
  },
  handler: async (ctx, args) => {
    const order = await ctx.db
      .query("userFolderOrder")
      .withIndex("by_user_section", (q) =>
        q.eq("userId", args.userId).eq("section", args.section)
      )
      .first();

    return order?.folderIds || [];
  },
});

// Get all folder orders for a user (all sections at once)
export const getAllFolderOrders = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query("userFolderOrder")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Return as a map of section -> folderIds
    const orderMap: Record<string, string[]> = {};
    for (const order of orders) {
      orderMap[order.section] = order.folderIds as string[];
    }
    return orderMap;
  },
});

// Save user's folder order for a section
export const saveFolderOrder = mutation({
  args: {
    userId: v.id("users"),
    section: v.string(), // "myFolders" | "shared" | "community"
    folderIds: v.array(v.id("documentFolders")),
  },
  handler: async (ctx, args) => {
    // Check if order already exists for this user+section
    const existing = await ctx.db
      .query("userFolderOrder")
      .withIndex("by_user_section", (q) =>
        q.eq("userId", args.userId).eq("section", args.section)
      )
      .first();

    if (existing) {
      // Update existing order
      await ctx.db.patch(existing._id, {
        folderIds: args.folderIds,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    // Create new order
    return await ctx.db.insert("userFolderOrder", {
      userId: args.userId,
      section: args.section,
      folderIds: args.folderIds,
      updatedAt: Date.now(),
    });
  },
});
