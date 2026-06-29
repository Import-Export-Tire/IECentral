import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireAdmin } from "./authGuards";

// Number of PBKDF2 iterations
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

async function verifyPassword(
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

// Login mutation
export const login = mutation({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .first();

    if (!user) {
      return { success: false, error: "Invalid email or password" };
    }

    if (!user.isActive) {
      return { success: false, error: "Account is deactivated" };
    }

    if (!user.passwordHash) {
      return { success: false, error: "Invalid email or password" };
    }

    const passwordValid = await verifyPassword(args.password, user.passwordHash);
    if (!passwordValid) {
      return { success: false, error: "Invalid email or password" };
    }

    // Update last login
    await ctx.db.patch(user._id, { lastLoginAt: Date.now() });

    // Log the login event
    await ctx.db.insert("auditLogs", {
      action: "User logged in",
      actionType: "login",
      resourceType: "user",
      resourceId: user._id,
      userId: user._id,
      userEmail: user.email || "unknown",
      details: `User ${user.name} logged in`,
      timestamp: Date.now(),
    });

    return {
      success: true,
      userId: user._id,
      forcePasswordChange: user.forcePasswordChange,
    };
  },
});

// Get user by ID
export const getUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    try {
      const user = await ctx.db.get(args.userId);
      return user;
    } catch (error) {
      // Return null if user not found or ID is invalid
      console.error("Error fetching user:", error);
      return null;
    }
  },
});

// Create initial admin user (for setup)
export const createInitialAdmin = mutation({
  args: {
    email: v.string(),
    password: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if any users exist
    const existingUsers = await ctx.db.query("users").first();
    if (existingUsers) {
      return { success: false, error: "Users already exist" };
    }

    const passwordHash = await hashPassword(args.password);

    const userId = await ctx.db.insert("users", {
      email: args.email.toLowerCase(),
      passwordHash,
      name: args.name,
      role: "admin",
      isActive: true,
      forcePasswordChange: false,
      createdAt: Date.now(),
    });

    return { success: true, userId };
  },
});

// Create user (admin only)
export const createUser = mutation({
  args: {
    email: v.string(),
    password: v.string(),
    name: v.string(),
    role: v.string(),
    sendWelcomeEmail: v.optional(v.boolean()),
    // Per-user module grants to set at creation (e.g. {"menu.documents": true}),
    // so an admin can give an employee access beyond the portal in one step.
    permissionOverrides: v.optional(v.record(v.string(), v.boolean())),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);

    // Check for existing email
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .first();

    if (existing) {
      return { success: false, error: "Email already exists" };
    }

    const passwordHash = await hashPassword(args.password);

    const userId = await ctx.db.insert("users", {
      email: args.email.toLowerCase(),
      passwordHash,
      name: args.name,
      role: args.role,
      isActive: true,
      forcePasswordChange: true, // Force password change on first login
      ...(args.permissionOverrides && Object.keys(args.permissionOverrides).length > 0
        ? { permissionOverrides: args.permissionOverrides }
        : {}),
      createdAt: Date.now(),
    });

    // Send welcome email if requested
    if (args.sendWelcomeEmail) {
      await ctx.scheduler.runAfter(0, internal.emails.sendNewUserWelcomeEmail, {
        userName: args.name,
        userEmail: args.email.toLowerCase(),
        temporaryPassword: args.password,
        role: args.role,
        loginUrl: "https://iecentral.com/login",
      });
    }

    return { success: true, userId };
  },
});

// Change password
export const changePassword = mutation({
  args: {
    userId: v.id("users"),
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      return { success: false, error: "User not found" };
    }

    if (!user.passwordHash) {
      return { success: false, error: "Account not configured for password login" };
    }

    const passwordValid = await verifyPassword(
      args.currentPassword,
      user.passwordHash
    );
    if (!passwordValid) {
      return { success: false, error: "Current password is incorrect" };
    }

    const newPasswordHash = await hashPassword(args.newPassword);

    await ctx.db.patch(args.userId, {
      passwordHash: newPasswordHash,
      forcePasswordChange: false,
    });

    return { success: true };
  },
});

// Get all users (admin only)
export const getAllUsers = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("users").collect();
  },
});

// Get formatted user list for display
export const getUsersFormatted = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const locations = await ctx.db.query("locations").collect();

    const locationMap = new Map(locations.map(l => [l._id, l.name]));

    const tierMap: Record<string, { tier: number; label: string }> = {
      super_admin: { tier: 5, label: "T5 - Super Admin" },
      admin: { tier: 4, label: "T4 - Admin" },
      warehouse_director: { tier: 3, label: "T3 - Director" },
      warehouse_manager: { tier: 2, label: "T2 - Warehouse Manager" },
      office_manager: { tier: 2, label: "T2 - Office Manager" },
      retail_manager: { tier: 2, label: "T2 - Retail Manager" },
      retail_store_manager: { tier: 2, label: "T2 - Retail Store Manager" },
      department_manager: { tier: 1, label: "T1 - Department Manager" },
      shift_lead: { tier: 1, label: "T1 - Shift Lead" },
      retail_associate: { tier: 1, label: "T1 - Retail Associate" },
      member: { tier: 0, label: "T0 - Member" },
      employee: { tier: 0, label: "T0 - Employee" },
    };

    return users
      .sort((a, b) => {
        const tierA = tierMap[a.role]?.tier ?? -1;
        const tierB = tierMap[b.role]?.tier ?? -1;
        if (tierB !== tierA) return tierB - tierA;
        return a.name.localeCompare(b.name);
      })
      .map(user => ({
        name: user.name,
        email: user.email || "N/A",
        role: tierMap[user.role]?.label || user.role,
        tier: tierMap[user.role]?.tier ?? 0,
        status: user.isActive ? "Active" : "Inactive",
        locations: user.managedLocationIds?.map(id => locationMap.get(id) || "Unknown").join(", ") || "",
        departments: user.managedDepartments?.join(", ") || "",
        flags: [
          user.requiresDailyLog ? "Daily Log" : null,
          user.isFinalTimeApprover ? "Final Time Approver" : null,
          user.isPayrollProcessor ? "Payroll Processor" : null,
        ].filter(Boolean).join(", ") || "",
        lastLogin: user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : "Never",
      }));
  },
});

// Seed superuser (bypasses existing user check)
// SECURITY: internalMutation, NOT a public mutation. This creates/elevates an
// admin and can overwrite an existing user's password — if exposed to clients it
// is a one-call account-takeover. Run it from the Convex dashboard/CLI only.
export const seedSuperuser = internalMutation({
  args: {
    email: v.string(),
    password: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if this email already exists
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .first();

    if (existing) {
      // Update existing user to admin with new password
      const passwordHash = await hashPassword(args.password);
      await ctx.db.patch(existing._id, {
        passwordHash,
        role: "admin",
        isActive: true,
        forcePasswordChange: false,
      });
      return { success: true, userId: existing._id, action: "updated" };
    }

    // Create new superuser
    const passwordHash = await hashPassword(args.password);

    const userId = await ctx.db.insert("users", {
      email: args.email.toLowerCase(),
      passwordHash,
      name: args.name,
      role: "admin",
      isActive: true,
      forcePasswordChange: false,
      createdAt: Date.now(),
    });

    return { success: true, userId, action: "created" };
  },
});

// Set forcePasswordChange flag for a user.
// SECURITY: internalMutation — patches an arbitrary userId with no caller check.
// Unused by the app; keep off the public API.
export const setForcePasswordChange = internalMutation({
  args: {
    userId: v.id("users"),
    forcePasswordChange: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      forcePasswordChange: args.forcePasswordChange,
    });
    return { success: true };
  },
});

// Set requiresDailyLog flag for a user (admin only).
// SECURITY: internalMutation — patches an arbitrary userId with no caller check.
// Unused by the app; keep off the public API.
export const setRequiresDailyLog = internalMutation({
  args: {
    userId: v.id("users"),
    requiresDailyLog: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      requiresDailyLog: args.requiresDailyLog,
    });
    return { success: true };
  },
});

// Update user (admin only)
export const updateUser = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
    title: v.optional(v.string()),
    email: v.optional(v.string()),
    role: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    requiresDailyLog: v.optional(v.boolean()),
    managedLocationIds: v.optional(v.array(v.id("locations"))),
    managedDepartments: v.optional(v.array(v.string())),
    reportsTo: v.optional(v.union(v.id("users"), v.null())), // Who this user reports to
    personnelId: v.optional(v.id("personnel")), // Link to personnel record
    // RBAC floating permissions
    isFinalTimeApprover: v.optional(v.boolean()),
    isPayrollProcessor: v.optional(v.boolean()),
    // Feature-level permission overrides
    permissionOverrides: v.optional(v.record(v.string(), v.boolean())),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);

    const { userId, title, requiresDailyLog, managedLocationIds, managedDepartments, reportsTo, personnelId, isFinalTimeApprover, isPayrollProcessor, permissionOverrides, requestingUserId: _ignored, ...updates } = args;

    // If email is being updated, check for duplicates
    if (updates.email) {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", updates.email!.toLowerCase()))
        .first();

      if (existing && existing._id !== userId) {
        return { success: false, error: "Email already exists" };
      }
      updates.email = updates.email.toLowerCase();
    }

    // Build updates object
    const cleanUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) cleanUpdates.name = updates.name;
    if (title !== undefined) cleanUpdates.title = title;
    if (updates.email !== undefined) cleanUpdates.email = updates.email;
    if (updates.role !== undefined) cleanUpdates.role = updates.role;
    if (updates.isActive !== undefined) cleanUpdates.isActive = updates.isActive;
    if (requiresDailyLog !== undefined) cleanUpdates.requiresDailyLog = requiresDailyLog;
    if (managedLocationIds !== undefined) cleanUpdates.managedLocationIds = managedLocationIds;
    if (managedDepartments !== undefined) cleanUpdates.managedDepartments = managedDepartments;
    if (reportsTo !== undefined) cleanUpdates.reportsTo = reportsTo === null ? undefined : reportsTo;
    if (personnelId !== undefined) cleanUpdates.personnelId = personnelId;
    // RBAC floating permissions
    if (isFinalTimeApprover !== undefined) cleanUpdates.isFinalTimeApprover = isFinalTimeApprover;
    if (isPayrollProcessor !== undefined) cleanUpdates.isPayrollProcessor = isPayrollProcessor;
    // Permission overrides
    if (permissionOverrides !== undefined) cleanUpdates.permissionOverrides = permissionOverrides;

    await ctx.db.patch(userId, cleanUpdates);
    return { success: true };
  },
});

// Get users who report to a specific user (reportees)
export const getReportees = query({
  args: { managerId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_reports_to", (q) => q.eq("reportsTo", args.managerId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

// Get reportees who require daily logs
export const getReporteesRequiringDailyLog = query({
  args: { managerId: v.id("users") },
  handler: async (ctx, args) => {
    const reportees = await ctx.db
      .query("users")
      .withIndex("by_reports_to", (q) => q.eq("reportsTo", args.managerId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    return reportees.filter(u => u.requiresDailyLog === true);
  },
});

// Reset user password (admin only) - sets a new password and forces change
export const resetUserPassword = mutation({
  args: {
    userId: v.id("users"),
    newPassword: v.string(),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);

    const passwordHash = await hashPassword(args.newPassword);

    await ctx.db.patch(args.userId, {
      passwordHash,
      forcePasswordChange: true,
    });

    return { success: true };
  },
});

// Delete user (admin only)
export const deleteUser = mutation({
  args: {
    userId: v.id("users"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);

    // Don't allow admins to delete themselves — they'd lock themselves out
    if (args.userId === args.requestingUserId) {
      throw new Error("Cannot delete your own account");
    }

    await ctx.db.delete(args.userId);
    return { success: true };
  },
});

// Generate a random temporary password
function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let password = "";
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// Create employee portal login from personnel record
export const createEmployeePortalLogin = mutation({
  args: {
    personnelId: v.id("personnel"),
  },
  handler: async (ctx, args) => {
    // Get the personnel record
    const personnel = await ctx.db.get(args.personnelId);
    if (!personnel) {
      return { success: false, error: "Personnel record not found" };
    }

    if (!personnel.email) {
      return { success: false, error: "Personnel record has no email address" };
    }

    // Check if user already exists with this email
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", personnel.email!.toLowerCase()))
      .first();

    if (existingUser) {
      // If user exists but not linked, link them
      if (!existingUser.personnelId) {
        await ctx.db.patch(existingUser._id, {
          personnelId: args.personnelId,
          role: "employee",
        });
        return {
          success: true,
          userId: existingUser._id,
          message: "Existing account linked to personnel record",
          alreadyExists: true,
        };
      }
      return { success: false, error: "A portal login already exists for this email" };
    }

    // Generate temporary password
    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    // Create the user account
    const userId = await ctx.db.insert("users", {
      email: personnel.email.toLowerCase(),
      passwordHash,
      name: `${personnel.firstName} ${personnel.lastName}`,
      role: "employee",
      isActive: true,
      forcePasswordChange: true,
      personnelId: args.personnelId,
      createdAt: Date.now(),
    });

    return {
      success: true,
      userId,
      tempPassword,
      message: "Portal login created successfully",
    };
  },
});

// Check if personnel has portal login
export const getPersonnelPortalLogin = query({
  args: {
    personnelId: v.id("personnel"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .first();

    return user ? {
      userId: user._id,
      email: user.email,
      isActive: user.isActive,
    } : null;
  },
});

// Reset employee portal password (generates new temp password, forces change)
export const resetEmployeePortalPassword = mutation({
  args: {
    personnelId: v.id("personnel"),
    adminUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Find the user linked to this personnel
    const user = await ctx.db
      .query("users")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .first();

    if (!user) {
      return { success: false, error: "No portal login found for this employee" };
    }

    // Generate new temporary password
    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    // Update the user with new password and force change
    await ctx.db.patch(user._id, {
      passwordHash,
      forcePasswordChange: true,
    });

    // Log the action
    const admin = await ctx.db.get(args.adminUserId);
    const personnel = await ctx.db.get(args.personnelId);
    await ctx.db.insert("auditLogs", {
      action: "Reset employee portal password",
      actionType: "update",
      resourceType: "users",
      resourceId: user._id,
      userId: args.adminUserId,
      userEmail: admin?.email ?? "unknown",
      details: `Reset portal password for ${personnel?.firstName ?? "Unknown"} ${personnel?.lastName ?? ""}`,
      timestamp: Date.now(),
    });

    return {
      success: true,
      tempPassword,
      message: "Password reset successfully. Employee will need to change it on next login.",
    };
  },
});
