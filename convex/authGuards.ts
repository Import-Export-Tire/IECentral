/**
 * Server-side permission guards for Convex mutations and actions.
 *
 * The IECentral auth model is "userId-arg-based": clients pass a
 * `requestingUserId` to the mutation, and the handler is responsible
 * for verifying the calling user actually has permission. There is no
 * `ctx.auth.getUserIdentity()` — Convex's built-in auth isn't wired up.
 *
 * Use these helpers at the top of every privileged handler:
 *
 *     export const someMutation = mutation({
 *       args: { ...realArgs, requestingUserId: v.id("users") },
 *       handler: async (ctx, args) => {
 *         await requireAdmin(ctx, args.requestingUserId);
 *         // ...real work...
 *       },
 *     });
 *
 * They throw a plain Error on failure so the client sees a clear
 * "Unauthorized" message instead of a silent no-op.
 */

import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

const ADMIN_ROLES = new Set(["super_admin", "admin"]);
const PERSONNEL_MANAGER_ROLES = new Set([
  "super_admin",
  "admin",
  "warehouse_director",
  "department_manager",
  "warehouse_manager",
]);

type AnyCtx = QueryCtx | { db: QueryCtx["db"] };

/**
 * Throws unless the requesting user exists, is active, and has an
 * admin or super_admin role. Use for user-management mutations,
 * destructive admin actions, and anything that should be locked to
 * the top tier.
 */
export async function requireAdmin(
  ctx: AnyCtx,
  requestingUserId: Id<"users">,
): Promise<void> {
  const user = await ctx.db.get(requestingUserId);
  if (!user) {
    throw new Error("Unauthorized: requesting user not found");
  }
  if (user.isActive === false) {
    throw new Error("Unauthorized: account is inactive");
  }
  if (!ADMIN_ROLES.has(user.role)) {
    throw new Error(
      `Unauthorized: this action requires an admin role (you are ${user.role})`,
    );
  }
}

/**
 * Throws unless the requesting user has a role that can manage
 * personnel records (super_admin, admin, warehouse_director,
 * department_manager, warehouse_manager). Mirrors the
 * `canManagePersonnel` check in app/auth-context.tsx so server and
 * client stay in sync.
 */
export async function requireManagePersonnel(
  ctx: AnyCtx,
  requestingUserId: Id<"users">,
): Promise<void> {
  const user = await ctx.db.get(requestingUserId);
  if (!user) {
    throw new Error("Unauthorized: requesting user not found");
  }
  if (user.isActive === false) {
    throw new Error("Unauthorized: account is inactive");
  }
  if (!PERSONNEL_MANAGER_ROLES.has(user.role)) {
    throw new Error(
      `Unauthorized: this action requires personnel-management privileges (you are ${user.role})`,
    );
  }
}

/**
 * Throws unless the requesting user exists, is active, and has one of
 * the specified roles. Use when the action requires a specific role
 * or a small set (e.g. "super_admin" only for destructive cleanup).
 */
export async function requireRole(
  ctx: AnyCtx,
  requestingUserId: Id<"users">,
  allowedRoles: readonly string[],
): Promise<void> {
  const user = await ctx.db.get(requestingUserId);
  if (!user) {
    throw new Error("Unauthorized: requesting user not found");
  }
  if (user.isActive === false) {
    throw new Error("Unauthorized: account is inactive");
  }
  if (!allowedRoles.includes(user.role)) {
    throw new Error(
      `Unauthorized: this action requires one of [${allowedRoles.join(", ")}] (you are ${user.role})`,
    );
  }
}
