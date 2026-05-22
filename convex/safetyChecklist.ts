import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireManagePersonnel } from "./authGuards";

// Default checklist items for pickers
const DEFAULT_PICKER_CHECKLIST_ITEMS = [
  { id: "walk-around", question: "Walk completely around the picker checking for visible damage", description: "Check all sides, top, and bottom for dents, cracks, or damage", minimumSeconds: 30, order: 1 },
  { id: "horn", question: "Check that the horn is functioning", description: "Press horn button to verify it works properly", minimumSeconds: 5, order: 2 },
  { id: "lights", question: "Check that headlights and taillights work", description: "Turn on lights and visually confirm all are functioning", minimumSeconds: 10, order: 3 },
  { id: "backup-alarm", question: "Check that backup alarm is functioning", description: "Put in reverse briefly to verify alarm sounds", minimumSeconds: 5, order: 4 },
  { id: "forks", question: "Inspect forks for cracks, bends, or damage", description: "Visually inspect both forks for any deformation or damage", minimumSeconds: 15, order: 5 },
  { id: "hydraulic-fluid", question: "Check hydraulic fluid level", description: "Locate and check the hydraulic fluid reservoir level", minimumSeconds: 10, order: 6 },
  { id: "hydraulic-leaks", question: "Check for hydraulic leaks under the picker", description: "Look underneath for any fluid puddles or wet spots", minimumSeconds: 15, order: 7 },
  { id: "foot-brake", question: "Test foot brake operation", description: "Press foot brake to verify it engages properly", minimumSeconds: 10, order: 8 },
  { id: "parking-brake", question: "Test parking brake operation", description: "Engage parking brake and verify it holds", minimumSeconds: 10, order: 9 },
  { id: "battery", question: "Check battery charge level", description: "Verify battery indicator shows adequate charge", minimumSeconds: 5, order: 10 },
  { id: "seatbelt", question: "Ensure seatbelt is present and functional", description: "Check seatbelt buckle and webbing condition", minimumSeconds: 5, order: 11 },
  { id: "fire-extinguisher", question: "Check fire extinguisher is present and charged", description: "Verify extinguisher is mounted and gauge shows charged", minimumSeconds: 10, order: 12 },
];

// ============ QUERIES ============

// Get default template for equipment type
export const getDefaultTemplate = query({
  args: {
    equipmentType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const equipmentType = args.equipmentType || "picker";

    // First try to find a default template for this equipment type
    let template = await ctx.db
      .query("safetyChecklistTemplates")
      .withIndex("by_equipment_type", (q) => q.eq("equipmentType", equipmentType))
      .filter((q) => q.eq(q.field("isDefault"), true))
      .first();

    // If not found, try "all" equipment type
    if (!template) {
      template = await ctx.db
        .query("safetyChecklistTemplates")
        .withIndex("by_equipment_type", (q) => q.eq("equipmentType", "all"))
        .filter((q) => q.eq(q.field("isDefault"), true))
        .first();
    }

    // If still not found, return hardcoded default
    if (!template) {
      return {
        _id: null,
        name: "Standard Picker Checklist",
        isDefault: true,
        equipmentType: "picker",
        items: DEFAULT_PICKER_CHECKLIST_ITEMS,
      };
    }

    return template;
  },
});

// Get all templates (for admin)
export const getAllTemplates = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("safetyChecklistTemplates").collect();
  },
});

// Get checklist for specific equipment (merged with any equipment-specific config)
export const getEquipmentChecklist = query({
  args: {
    equipmentType: v.string(),
    equipmentId: v.string(), // Will be cast to appropriate ID type
  },
  handler: async (ctx, args) => {
    // Get the equipment details — validate the ID with normalizeId so a
    // malformed URL parameter (e.g. an old QR code that pointed at a
    // different deployment, or a typo) returns null instead of throwing
    // and surfacing as a client-side exception.
    const tableName = args.equipmentType === "picker" ? "pickers" : "scanners";
    const equipmentIdTyped = ctx.db.normalizeId(tableName, args.equipmentId);
    if (!equipmentIdTyped) {
      return null;
    }
    const equipment = await ctx.db.get(equipmentIdTyped);

    if (!equipment) {
      return null;
    }

    // Get location name
    const location = equipment.locationId ? await ctx.db.get(equipment.locationId) : null;

    // Get default template
    let template = await ctx.db
      .query("safetyChecklistTemplates")
      .withIndex("by_equipment_type", (q) => q.eq("equipmentType", args.equipmentType))
      .filter((q) => q.eq(q.field("isDefault"), true))
      .first();

    if (!template) {
      template = await ctx.db
        .query("safetyChecklistTemplates")
        .withIndex("by_equipment_type", (q) => q.eq("equipmentType", "all"))
        .filter((q) => q.eq(q.field("isDefault"), true))
        .first();
    }

    // Get equipment-specific config
    const config = await ctx.db
      .query("equipmentChecklistConfig")
      .withIndex("by_equipment", (q) =>
        q.eq("equipmentType", args.equipmentType).eq("equipmentId", equipmentIdTyped)
      )
      .first();

    // Build merged checklist items
    let items = template?.items || DEFAULT_PICKER_CHECKLIST_ITEMS;

    // Add equipment-specific additional items
    if (config?.additionalItems && config.additionalItems.length > 0) {
      items = [...items, ...config.additionalItems];
    }

    // Sort by order
    items = items.sort((a, b) => a.order - b.order);

    return {
      equipment: {
        _id: equipment._id,
        number: equipment.number,
        model: equipment.model,
        locationId: equipment.locationId,
        locationName: location?.name || "Unknown",
        status: equipment.status,
      },
      templateId: template?._id || null,
      templateName: template?.name || "Standard Picker Checklist",
      items,
      config,
    };
  },
});

// Get personnel eligible for safety check (have "Picker Training Video" training)
export const getEligiblePersonnel = query({
  args: {
    locationId: v.optional(v.id("locations")),
  },
  handler: async (ctx, args) => {
    let personnel = await ctx.db
      .query("personnel")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    // Filter by location if specified
    if (args.locationId) {
      personnel = personnel.filter((p) => p.locationId === args.locationId);
    }

    // Filter to those with "Picker Training Video" in their training records
    personnel = personnel.filter((p) => {
      // Check new trainingRecords format
      if (p.trainingRecords && p.trainingRecords.length > 0) {
        return p.trainingRecords.some((t) => t.area === "Picker Training Video");
      }
      // Check legacy completedTraining format
      if (p.completedTraining && p.completedTraining.length > 0) {
        return p.completedTraining.includes("Picker Training Video");
      }
      return false;
    });

    // Return simplified personnel data
    return personnel.map((p) => ({
      _id: p._id,
      name: `${p.firstName} ${p.lastName}`,
      firstName: p.firstName,
      lastName: p.lastName,
      position: p.position,
      department: p.department,
      locationId: p.locationId,
    }));
  },
});

// Get completions for spot-check (manager tool)
export const getCompletionsByDate = query({
  args: {
    date: v.string(), // YYYY-MM-DD
    locationId: v.optional(v.id("locations")),
    personnelId: v.optional(v.id("personnel")),
    equipmentId: v.optional(v.string()),
    equipmentType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let completions = await ctx.db
      .query("safetyChecklistCompletions")
      .withIndex("by_date", (q) => q.eq("shiftDate", args.date))
      .collect();

    // Apply filters
    if (args.locationId) {
      completions = completions.filter((c) => c.locationId === args.locationId);
    }

    if (args.personnelId) {
      completions = completions.filter((c) => c.personnelId === args.personnelId);
    }

    if (args.equipmentId && args.equipmentType) {
      completions = completions.filter(
        (c) => c.equipmentId === args.equipmentId && c.equipmentType === args.equipmentType
      );
    }

    // Sort by completion time (most recent first)
    completions.sort((a, b) => b.completedAt - a.completedAt);

    return completions;
  },
});

// Get completion history for personnel profile
export const getPersonnelCompletions = query({
  args: {
    personnelId: v.id("personnel"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;

    const completions = await ctx.db
      .query("safetyChecklistCompletions")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .order("desc")
      .take(limit);

    return completions;
  },
});

// Get completion history for equipment profile
export const getEquipmentCompletions = query({
  args: {
    equipmentType: v.string(),
    equipmentId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    const equipmentId = args.equipmentType === "picker"
      ? args.equipmentId as Id<"pickers">
      : args.equipmentId as Id<"scanners">;

    const completions = await ctx.db
      .query("safetyChecklistCompletions")
      .withIndex("by_equipment", (q) =>
        q.eq("equipmentType", args.equipmentType).eq("equipmentId", equipmentId)
      )
      .order("desc")
      .take(limit);

    return completions;
  },
});

// Check if personnel completed checklist for equipment today
export const hasCompletedToday = query({
  args: {
    personnelId: v.id("personnel"),
    equipmentType: v.string(),
    equipmentId: v.string(),
  },
  handler: async (ctx, args) => {
    const today = new Date().toISOString().split("T")[0];
    const equipmentId = args.equipmentType === "picker"
      ? args.equipmentId as Id<"pickers">
      : args.equipmentId as Id<"scanners">;

    const completion = await ctx.db
      .query("safetyChecklistCompletions")
      .withIndex("by_personnel_date", (q) =>
        q.eq("personnelId", args.personnelId).eq("shiftDate", today)
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("equipmentType"), args.equipmentType),
          q.eq(q.field("equipmentId"), equipmentId)
        )
      )
      .first();

    return completion !== null;
  },
});

// ============ MUTATIONS ============

// Submit completed checklist
export const submitChecklist = mutation({
  args: {
    equipmentType: v.string(),
    equipmentId: v.string(),
    personnelId: v.id("personnel"),
    templateId: v.optional(v.id("safetyChecklistTemplates")),
    responses: v.array(v.object({
      itemId: v.string(),
      question: v.string(),
      passed: v.boolean(),
      response: v.optional(v.string()), // "yes" | "no" | "na"
      notes: v.optional(v.string()),
      damageReported: v.optional(v.boolean()),
      damageDetails: v.optional(v.string()),
      timeSpent: v.number(),
      completedAt: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    // Get equipment details
    const equipmentIdTyped = args.equipmentType === "picker"
      ? args.equipmentId as Id<"pickers">
      : args.equipmentId as Id<"scanners">;

    const equipment = args.equipmentType === "picker"
      ? await ctx.db.get(equipmentIdTyped as Id<"pickers">)
      : await ctx.db.get(equipmentIdTyped as Id<"scanners">);

    if (!equipment) {
      throw new Error("Equipment not found");
    }

    // Get personnel details
    const personnel = await ctx.db.get(args.personnelId);
    if (!personnel) {
      throw new Error("Personnel not found");
    }

    // Calculate totals
    const allPassed = args.responses.every((r) => r.passed);
    const totalTimeSpent = args.responses.reduce((sum, r) => sum + r.timeSpent, 0);

    // Collect issues (failed items and damage reports)
    const issues = args.responses
      .filter((r) => !r.passed || r.damageReported)
      .map((r) => ({
        itemId: r.itemId,
        description: r.damageDetails || r.notes || `Failed: ${r.question}`,
      }));

    // Get today's date
    const shiftDate = new Date().toISOString().split("T")[0];

    // Create completion record
    const completionId = await ctx.db.insert("safetyChecklistCompletions", {
      equipmentType: args.equipmentType,
      equipmentId: equipmentIdTyped,
      equipmentNumber: equipment.number,
      personnelId: args.personnelId,
      personnelName: `${personnel.firstName} ${personnel.lastName}`,
      templateId: args.templateId,
      responses: args.responses,
      allPassed,
      totalTimeSpent,
      issues: issues.length > 0 ? issues : undefined,
      shiftDate,
      locationId: equipment.locationId,
      completedAt: Date.now(),
    });

    return {
      success: true,
      completionId,
      allPassed,
      totalTimeSpent,
      issueCount: issues.length,
    };
  },
});

// Create or update template (admin)
export const upsertTemplate = mutation({
  args: {
    id: v.optional(v.id("safetyChecklistTemplates")),
    name: v.string(),
    equipmentType: v.string(),
    isDefault: v.boolean(),
    items: v.array(v.object({
      id: v.string(),
      question: v.string(),
      description: v.optional(v.string()),
      minimumSeconds: v.number(),
      order: v.number(),
      // Damage reporting fields
      responseType: v.optional(v.string()), // "yes_no" | "yes_no_na" | "condition_report"
      requiresDetailsOn: v.optional(v.string()), // "yes" | "no" | "na" | "always" | "never"
      detailsPrompt: v.optional(v.string()),
      expectedAnswer: v.optional(v.string()), // "yes" | "no" - expected passing answer (defaults to "yes")
    })),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const now = Date.now();

    // If setting as default, unset any existing default for this equipment type
    if (args.isDefault) {
      const existingDefaults = await ctx.db
        .query("safetyChecklistTemplates")
        .withIndex("by_equipment_type", (q) => q.eq("equipmentType", args.equipmentType))
        .filter((q) => q.eq(q.field("isDefault"), true))
        .collect();

      for (const template of existingDefaults) {
        if (!args.id || template._id !== args.id) {
          await ctx.db.patch(template._id, { isDefault: false, updatedAt: now });
        }
      }
    }

    if (args.id) {
      // Update existing
      await ctx.db.patch(args.id, {
        name: args.name,
        equipmentType: args.equipmentType,
        isDefault: args.isDefault,
        items: args.items,
        updatedAt: now,
      });
      return args.id;
    } else {
      // Create new
      return await ctx.db.insert("safetyChecklistTemplates", {
        name: args.name,
        equipmentType: args.equipmentType,
        isDefault: args.isDefault,
        items: args.items,
        createdAt: now,
        updatedAt: now,
        createdBy: args.userId,
      });
    }
  },
});

// Delete template (admin)
export const deleteTemplate = mutation({
  args: {
    id: v.id("safetyChecklistTemplates"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const template = await ctx.db.get(args.id);
    if (!template) {
      throw new Error("Template not found");
    }

    if (template.isDefault) {
      throw new Error("Cannot delete the default template. Set another template as default first.");
    }

    await ctx.db.delete(args.id);
    return { success: true };
  },
});

// Configure equipment-specific checklist items (admin)
export const configureEquipmentChecklist = mutation({
  args: {
    equipmentType: v.string(),
    equipmentId: v.string(),
    templateId: v.optional(v.id("safetyChecklistTemplates")),
    additionalItems: v.optional(v.array(v.object({
      id: v.string(),
      question: v.string(),
      description: v.optional(v.string()),
      minimumSeconds: v.number(),
      order: v.number(),
      responseType: v.optional(v.string()),
      requiresDetailsOn: v.optional(v.string()),
      detailsPrompt: v.optional(v.string()),
      expectedAnswer: v.optional(v.string()), // "yes" | "no" - expected passing answer (defaults to "yes")
    }))),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const equipmentIdTyped = args.equipmentType === "picker"
      ? args.equipmentId as Id<"pickers">
      : args.equipmentId as Id<"scanners">;

    const now = Date.now();

    // Check if config already exists
    const existing = await ctx.db
      .query("equipmentChecklistConfig")
      .withIndex("by_equipment", (q) =>
        q.eq("equipmentType", args.equipmentType).eq("equipmentId", equipmentIdTyped)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        templateId: args.templateId,
        additionalItems: args.additionalItems,
        updatedAt: now,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("equipmentChecklistConfig", {
        equipmentType: args.equipmentType,
        equipmentId: equipmentIdTyped,
        templateId: args.templateId,
        additionalItems: args.additionalItems,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

// Add personnel-specific requirements (admin)
export const addPersonnelOverride = mutation({
  args: {
    equipmentType: v.string(),
    equipmentId: v.string(),
    personnelId: v.id("personnel"),
    additionalItems: v.array(v.object({
      id: v.string(),
      question: v.string(),
      minimumSeconds: v.number(),
      responseType: v.optional(v.string()),
      requiresDetailsOn: v.optional(v.string()),
      detailsPrompt: v.optional(v.string()),
      expectedAnswer: v.optional(v.string()), // "yes" | "no" - expected passing answer (defaults to "yes")
    })),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const equipmentIdTyped = args.equipmentType === "picker"
      ? args.equipmentId as Id<"pickers">
      : args.equipmentId as Id<"scanners">;

    const now = Date.now();

    // Get or create equipment config
    let config = await ctx.db
      .query("equipmentChecklistConfig")
      .withIndex("by_equipment", (q) =>
        q.eq("equipmentType", args.equipmentType).eq("equipmentId", equipmentIdTyped)
      )
      .first();

    if (!config) {
      const configId = await ctx.db.insert("equipmentChecklistConfig", {
        equipmentType: args.equipmentType,
        equipmentId: equipmentIdTyped,
        personnelOverrides: [{
          personnelId: args.personnelId,
          additionalItems: args.additionalItems,
        }],
        createdAt: now,
        updatedAt: now,
      });
      return configId;
    }

    // Update existing config
    const overrides = config.personnelOverrides || [];
    const existingIndex = overrides.findIndex((o) => o.personnelId === args.personnelId);

    if (existingIndex >= 0) {
      overrides[existingIndex] = {
        personnelId: args.personnelId,
        additionalItems: args.additionalItems,
      };
    } else {
      overrides.push({
        personnelId: args.personnelId,
        additionalItems: args.additionalItems,
      });
    }

    await ctx.db.patch(config._id, {
      personnelOverrides: overrides,
      updatedAt: now,
    });

    return config._id;
  },
});

// Fix historical completion records where "no" should be the passing answer
// This handles questions like "Are you under the influence?" where No = Pass
export const fixHistoricalCompletions = mutation({
  args: {
    questionPatterns: v.array(v.string()), // Patterns to match (e.g., ["influence", "drugs", "alcohol", "impaired"])
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    // Get all completions
    const completions = await ctx.db.query("safetyChecklistCompletions").collect();

    let updatedCount = 0;
    let recordsUpdated = 0;

    for (const completion of completions) {
      let needsUpdate = false;
      const updatedResponses = completion.responses.map((response) => {
        // Check if this question matches any of the patterns where "no" should be passing
        const questionLower = response.question.toLowerCase();
        const shouldNoBePass = args.questionPatterns.some((pattern) =>
          questionLower.includes(pattern.toLowerCase())
        );

        if (shouldNoBePass && response.response === "no" && !response.passed) {
          // This was incorrectly marked as failed - fix it
          needsUpdate = true;
          updatedCount++;
          return { ...response, passed: true };
        }

        return response;
      });

      if (needsUpdate) {
        // Recalculate allPassed
        const allPassed = updatedResponses.every((r) => r.passed);

        // Recalculate issues (only items that are now failed)
        const issues = updatedResponses
          .filter((r) => !r.passed || r.damageReported)
          .map((r) => ({
            itemId: r.itemId,
            description: r.damageDetails || r.notes || `Failed: ${r.question}`,
          }));

        await ctx.db.patch(completion._id, {
          responses: updatedResponses,
          allPassed,
          issues: issues.length > 0 ? issues : undefined,
        });

        recordsUpdated++;
      }
    }

    return {
      totalCompletions: completions.length,
      recordsUpdated,
      responsesFixed: updatedCount,
    };
  },
});

// Create default template (seed data)
export const createDefaultTemplate = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    // Check if default already exists
    const existing = await ctx.db
      .query("safetyChecklistTemplates")
      .withIndex("by_equipment_type", (q) => q.eq("equipmentType", "picker"))
      .filter((q) => q.eq(q.field("isDefault"), true))
      .first();

    if (existing) {
      return { exists: true, templateId: existing._id };
    }

    const now = Date.now();
    const templateId = await ctx.db.insert("safetyChecklistTemplates", {
      name: "Standard Picker Safety Checklist",
      isDefault: true,
      equipmentType: "picker",
      items: DEFAULT_PICKER_CHECKLIST_ITEMS,
      createdAt: now,
      updatedAt: now,
      createdBy: args.userId,
    });

    return { exists: false, templateId };
  },
});
