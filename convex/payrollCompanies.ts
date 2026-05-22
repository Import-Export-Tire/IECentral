import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireAdmin } from "./authGuards";

// Get all payroll companies
export const getAll = query({
  args: {},
  handler: async (ctx) => {
    const companies = await ctx.db
      .query("payrollCompanies")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    // Get personnel counts for each company
    const enriched = await Promise.all(
      companies.map(async (company) => {
        // Count personnel in this company's departments OR directly assigned
        const personnel = await ctx.db
          .query("personnel")
          .withIndex("by_status", (q) => q.eq("status", "active"))
          .collect();

        const employeeCount = personnel.filter((p) => {
          // Direct assignment takes precedence
          if (p.payrollCompanyId) {
            return p.payrollCompanyId === company._id;
          }
          // Fall back to department matching
          return company.departments.includes(p.department);
        }).length;

        return {
          ...company,
          employeeCount,
        };
      })
    );

    return enriched;
  },
});

// Get a single company by ID
export const getById = query({
  args: { companyId: v.id("payrollCompanies") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.companyId);
  },
});

// Get employees for a specific company
export const getCompanyEmployees = query({
  args: { companyId: v.id("payrollCompanies") },
  handler: async (ctx, args) => {
    const company = await ctx.db.get(args.companyId);
    if (!company) return [];

    const personnel = await ctx.db
      .query("personnel")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    return personnel.filter((p) => {
      // Direct assignment takes precedence
      if (p.payrollCompanyId) {
        return p.payrollCompanyId === args.companyId;
      }
      // Fall back to department matching
      return company.departments.includes(p.department);
    });
  },
});

// Create a new payroll company
export const create = mutation({
  args: {
    name: v.string(),
    code: v.string(),
    departments: v.array(v.string()),
    qbCompanyName: v.optional(v.string()),
    payPeriodReference: v.optional(v.string()),
    payPeriodDays: v.optional(v.number()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const now = Date.now();

    // Check for duplicate code
    const existing = await ctx.db
      .query("payrollCompanies")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .first();

    if (existing) {
      throw new Error(`A company with code "${args.code}" already exists`);
    }

    return await ctx.db.insert("payrollCompanies", {
      name: args.name,
      code: args.code,
      departments: args.departments,
      qbCompanyName: args.qbCompanyName,
      payPeriodReference: args.payPeriodReference,
      payPeriodDays: args.payPeriodDays,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update a payroll company
export const update = mutation({
  args: {
    companyId: v.id("payrollCompanies"),
    name: v.optional(v.string()),
    code: v.optional(v.string()),
    departments: v.optional(v.array(v.string())),
    qbCompanyName: v.optional(v.string()),
    qbConnectionId: v.optional(v.id("qbConnection")),
    payPeriodReference: v.optional(v.string()),
    payPeriodDays: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const { companyId, requestingUserId: _ignored, ...updates } = args;

    // Check for duplicate code if changing code
    if (updates.code) {
      const existing = await ctx.db
        .query("payrollCompanies")
        .withIndex("by_code", (q) => q.eq("code", updates.code!))
        .first();

      if (existing && existing._id !== companyId) {
        throw new Error(`A company with code "${updates.code}" already exists`);
      }
    }

    await ctx.db.patch(companyId, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

// Delete a payroll company (soft delete by deactivating)
export const deactivate = mutation({
  args: {
    companyId: v.id("payrollCompanies"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    await ctx.db.patch(args.companyId, {
      isActive: false,
      updatedAt: Date.now(),
    });
  },
});

// Assign employee to a company
export const assignEmployee = mutation({
  args: {
    personnelId: v.id("personnel"),
    companyId: v.id("payrollCompanies"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    await ctx.db.patch(args.personnelId, {
      payrollCompanyId: args.companyId,
    });
  },
});

// Unassign employee from company (will use department matching)
export const unassignEmployee = mutation({
  args: {
    personnelId: v.id("personnel"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    await ctx.db.patch(args.personnelId, {
      payrollCompanyId: undefined,
    });
  },
});

// Bulk assign employees by department to a company
export const bulkAssignByDepartment = mutation({
  args: {
    companyId: v.id("payrollCompanies"),
    departments: v.array(v.string()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const personnel = await ctx.db
      .query("personnel")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    const matching = personnel.filter((p) =>
      args.departments.includes(p.department) && !p.payrollCompanyId
    );

    let updated = 0;
    for (const person of matching) {
      await ctx.db.patch(person._id, {
        payrollCompanyId: args.companyId,
      });
      updated++;
    }

    return { updated };
  },
});

// Get all unique departments from personnel (for setup)
export const getAllDepartments = query({
  args: {},
  handler: async (ctx) => {
    const personnel = await ctx.db.query("personnel").collect();
    const departments = [...new Set(personnel.map((p) => p.department))].sort();
    return departments;
  },
});

// Get employees not assigned to any company
export const getUnassignedEmployees = query({
  args: {},
  handler: async (ctx) => {
    const companies = await ctx.db
      .query("payrollCompanies")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    const personnel = await ctx.db
      .query("personnel")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    // Get all departments that belong to some company
    const assignedDepartments = new Set<string>();
    for (const company of companies) {
      for (const dept of company.departments) {
        assignedDepartments.add(dept);
      }
    }

    // Find employees not directly assigned AND not in any company department
    const unassigned = personnel.filter((p) => {
      if (p.payrollCompanyId) return false; // Directly assigned
      if (assignedDepartments.has(p.department)) return false; // In a company's department
      return true;
    });

    return unassigned;
  },
});
