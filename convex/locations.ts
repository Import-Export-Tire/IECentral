import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireAdmin } from "./authGuards";

// ============ QUERIES ============

// Get all locations
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("locations")
      .order("asc")
      .collect();
  },
});

// Get active locations only
export const listActive = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("locations")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();
  },
});

// Get active warehouse locations only
export const listActiveWarehouses = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db
      .query("locations")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();
    return all.filter((l) => l.locationType === "warehouse");
  },
});

// Get single location by ID
export const get = query({
  args: { id: v.id("locations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Get location by name
export const getByName = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("locations")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first();
  },
});

// ============ MUTATIONS ============

// Create a new location
export const create = mutation({
  args: {
    name: v.string(),
    locationType: v.optional(v.string()), // "warehouse" | "retail" | "office" | "distribution"
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    phone: v.optional(v.string()),
    // Security codes
    pinCode: v.optional(v.string()),
    alarmCode: v.optional(v.string()),
    gateCode: v.optional(v.string()),
    wifiPassword: v.optional(v.string()),
    securityNotes: v.optional(v.string()),
    departments: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const now = Date.now();

    // Check if location with same name already exists
    const existing = await ctx.db
      .query("locations")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first();

    if (existing) {
      throw new Error(`Location with name "${args.name}" already exists`);
    }

    return await ctx.db.insert("locations", {
      name: args.name,
      locationType: args.locationType,
      address: args.address,
      city: args.city,
      state: args.state,
      zipCode: args.zipCode,
      phone: args.phone,
      pinCode: args.pinCode,
      alarmCode: args.alarmCode,
      gateCode: args.gateCode,
      wifiPassword: args.wifiPassword,
      securityNotes: args.securityNotes,
      departments: args.departments,
      notes: args.notes,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update a location
export const update = mutation({
  args: {
    id: v.id("locations"),
    name: v.optional(v.string()),
    locationType: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    phone: v.optional(v.string()),
    // Security codes
    pinCode: v.optional(v.string()),
    alarmCode: v.optional(v.string()),
    gateCode: v.optional(v.string()),
    wifiPassword: v.optional(v.string()),
    securityNotes: v.optional(v.string()),
    departments: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    warehouseManagerName: v.optional(v.string()),
    warehouseManagerPhone: v.optional(v.string()),
    warehouseManagerEmail: v.optional(v.string()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const { id, requestingUserId: _ignored, ...updates } = args;

    // If name is being updated, check for duplicates
    if (updates.name) {
      const existing = await ctx.db
        .query("locations")
        .withIndex("by_name", (q) => q.eq("name", updates.name!))
        .first();

      if (existing && existing._id !== id) {
        throw new Error(`Location with name "${updates.name}" already exists`);
      }
    }

    // Filter out undefined values
    const cleanUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    }

    return await ctx.db.patch(id, {
      ...cleanUpdates,
      updatedAt: Date.now(),
    });
  },
});

// Delete a location (soft delete by setting isActive to false)
export const deactivate = mutation({
  args: {
    id: v.id("locations"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    // Check if any personnel are assigned to this location
    const personnelAtLocation = await ctx.db
      .query("personnel")
      .filter((q) => q.eq(q.field("locationId"), args.id))
      .first();

    if (personnelAtLocation) {
      throw new Error("Cannot deactivate location with assigned personnel. Reassign personnel first.");
    }

    // Check if any equipment is at this location
    const scannersAtLocation = await ctx.db
      .query("scanners")
      .withIndex("by_location", (q) => q.eq("locationId", args.id))
      .first();

    const pickersAtLocation = await ctx.db
      .query("pickers")
      .withIndex("by_location", (q) => q.eq("locationId", args.id))
      .first();

    if (scannersAtLocation || pickersAtLocation) {
      throw new Error("Cannot deactivate location with assigned equipment. Move equipment first.");
    }

    return await ctx.db.patch(args.id, {
      isActive: false,
      updatedAt: Date.now(),
    });
  },
});

// Reactivate a location
export const reactivate = mutation({
  args: {
    id: v.id("locations"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    return await ctx.db.patch(args.id, {
      isActive: true,
      updatedAt: Date.now(),
    });
  },
});

// Seed initial locations (Latrobe, Chestnut, Everson)
export const seedLocations = mutation({
  args: { requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const now = Date.now();
    const initialLocations = [
      { name: "Latrobe" },
      { name: "Chestnut" },
      { name: "Everson" },
    ];

    const created = [];

    for (const loc of initialLocations) {
      // Check if already exists
      const existing = await ctx.db
        .query("locations")
        .withIndex("by_name", (q) => q.eq("name", loc.name))
        .first();

      if (!existing) {
        const id = await ctx.db.insert("locations", {
          name: loc.name,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        created.push({ id, name: loc.name });
      }
    }

    return { created, message: `Created ${created.length} new locations` };
  },
});
