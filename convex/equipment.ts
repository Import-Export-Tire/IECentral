import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireAdmin, requireManagePersonnel } from "./authGuards";

// ============ SCANNER QUERIES ============

// Get all scanners
export const listScanners = query({
  args: {
    locationId: v.optional(v.id("locations")),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let scanners;

    if (args.locationId) {
      scanners = await ctx.db
        .query("scanners")
        .withIndex("by_location", (q) => q.eq("locationId", args.locationId!))
        .collect();
    } else {
      scanners = await ctx.db.query("scanners").collect();
    }

    if (args.status) {
      scanners = scanners.filter((s) => s.status === args.status);
    }

    // Enrich with location and personnel info
    return await Promise.all(
      scanners.map(async (scanner) => {
        const location = await ctx.db.get(scanner.locationId);
        const assignedPerson = scanner.assignedTo
          ? await ctx.db.get(scanner.assignedTo)
          : null;

        return {
          ...scanner,
          locationName: location?.name ?? "Unknown",
          assignedPersonName: assignedPerson
            ? `${assignedPerson.firstName} ${assignedPerson.lastName}`
            : null,
        };
      })
    );
  },
});

// Get single scanner
export const getScanner = query({
  args: { id: v.id("scanners") },
  handler: async (ctx, args) => {
    const scanner = await ctx.db.get(args.id);
    if (!scanner) return null;

    const location = await ctx.db.get(scanner.locationId);
    const assignedPerson = scanner.assignedTo
      ? await ctx.db.get(scanner.assignedTo)
      : null;

    return {
      ...scanner,
      locationName: location?.name ?? "Unknown",
      assignedPersonName: assignedPerson
        ? `${assignedPerson.firstName} ${assignedPerson.lastName}`
        : null,
    };
  },
});

// Get available scanners at a location
export const getAvailableScanners = query({
  args: { locationId: v.id("locations") },
  handler: async (ctx, args) => {
    const scanners = await ctx.db
      .query("scanners")
      .withIndex("by_location", (q) => q.eq("locationId", args.locationId))
      .collect();

    return scanners.filter((s) => s.status === "available");
  },
});

// ============ PICKER QUERIES ============

// Get all pickers
export const listPickers = query({
  args: {
    locationId: v.optional(v.id("locations")),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let pickers;

    if (args.locationId) {
      pickers = await ctx.db
        .query("pickers")
        .withIndex("by_location", (q) => q.eq("locationId", args.locationId!))
        .collect();
    } else {
      pickers = await ctx.db.query("pickers").collect();
    }

    if (args.status) {
      pickers = pickers.filter((p) => p.status === args.status);
    }

    // Enrich with location and personnel info
    return await Promise.all(
      pickers.map(async (picker) => {
        const location = await ctx.db.get(picker.locationId);
        const assignedPerson = picker.assignedTo
          ? await ctx.db.get(picker.assignedTo)
          : null;

        return {
          ...picker,
          locationName: location?.name ?? "Unknown",
          assignedPersonName: assignedPerson
            ? `${assignedPerson.firstName} ${assignedPerson.lastName}`
            : null,
        };
      })
    );
  },
});

// Get single picker
export const getPicker = query({
  args: { id: v.id("pickers") },
  handler: async (ctx, args) => {
    const picker = await ctx.db.get(args.id);
    if (!picker) return null;

    const location = await ctx.db.get(picker.locationId);
    const assignedPerson = picker.assignedTo
      ? await ctx.db.get(picker.assignedTo)
      : null;

    return {
      ...picker,
      locationName: location?.name ?? "Unknown",
      assignedPersonName: assignedPerson
        ? `${assignedPerson.firstName} ${assignedPerson.lastName}`
        : null,
    };
  },
});

// Get available pickers at a location
export const getAvailablePickers = query({
  args: { locationId: v.id("locations") },
  handler: async (ctx, args) => {
    const pickers = await ctx.db
      .query("pickers")
      .withIndex("by_location", (q) => q.eq("locationId", args.locationId))
      .collect();

    return pickers.filter((p) => p.status === "available");
  },
});

// Get equipment assigned to a person
export const getPersonnelEquipment = query({
  args: { personnelId: v.id("personnel") },
  handler: async (ctx, args) => {
    const scanners = await ctx.db
      .query("scanners")
      .withIndex("by_assigned", (q) => q.eq("assignedTo", args.personnelId))
      .collect();

    const pickers = await ctx.db
      .query("pickers")
      .withIndex("by_assigned", (q) => q.eq("assignedTo", args.personnelId))
      .collect();

    return { scanners, pickers };
  },
});

// ============ SCANNER MUTATIONS ============

// Create a new scanner
export const createScanner = mutation({
  args: {
    number: v.string(),
    pin: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    model: v.optional(v.string()),
    locationId: v.id("locations"),
    purchaseDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    conditionNotes: v.optional(v.string()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const now = Date.now();

    // Check if scanner number already exists at this location
    const existing = await ctx.db
      .query("scanners")
      .withIndex("by_location", (q) => q.eq("locationId", args.locationId))
      .collect();

    if (existing.some((s) => s.number === args.number)) {
      throw new Error(
        `Scanner #${args.number} already exists at this location`
      );
    }

    return await ctx.db.insert("scanners", {
      number: args.number,
      pin: args.pin,
      serialNumber: args.serialNumber,
      model: args.model,
      locationId: args.locationId,
      status: "available",
      purchaseDate: args.purchaseDate,
      notes: args.notes,
      conditionNotes: args.conditionNotes,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update a scanner
export const updateScanner = mutation({
  args: {
    id: v.id("scanners"),
    number: v.optional(v.string()),
    pin: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    model: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
    status: v.optional(v.string()),
    lastMaintenanceDate: v.optional(v.string()),
    purchaseDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    conditionNotes: v.optional(v.string()),
    userId: v.optional(v.id("users")), // Who made the change (for PIN tracking)
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const { id, userId, requestingUserId: _ignored, ...updates } = args;
    const now = Date.now();

    // Get current scanner to check for PIN change
    const currentScanner = await ctx.db.get(id);
    if (!currentScanner) {
      throw new Error("Scanner not found");
    }

    // Check if PIN is being changed and log it
    if (updates.pin !== undefined && updates.pin !== currentScanner.pin && userId) {
      await ctx.db.insert("equipmentHistory", {
        equipmentType: "scanner",
        equipmentId: id,
        action: "pin_change",
        previousStatus: currentScanner.status,
        newStatus: currentScanner.status,
        performedBy: userId,
        notes: `PIN changed from "${currentScanner.pin || "(none)"}" to "${updates.pin || "(none)"}"`,
        createdAt: now,
      });
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
      updatedAt: now,
    });
  },
});

// Assign scanner to personnel
export const assignScanner = mutation({
  args: {
    scannerId: v.id("scanners"),
    personnelId: v.id("personnel"),
    userId: v.id("users"), // Who performed the action
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const now = Date.now();
    const scanner = await ctx.db.get(args.scannerId);

    if (!scanner) {
      throw new Error("Scanner not found");
    }

    if (scanner.status !== "available") {
      throw new Error(
        `Scanner is not available (current status: ${scanner.status})`
      );
    }

    // Update scanner
    await ctx.db.patch(args.scannerId, {
      status: "assigned",
      assignedTo: args.personnelId,
      assignedAt: now,
      updatedAt: now,
    });

    // Create history record
    await ctx.db.insert("equipmentHistory", {
      equipmentType: "scanner",
      equipmentId: args.scannerId,
      action: "assigned",
      previousStatus: scanner.status,
      newStatus: "assigned",
      newAssignee: args.personnelId,
      performedBy: args.userId,
      notes: args.notes,
      createdAt: now,
    });

    return { success: true };
  },
});

// Unassign scanner from personnel
export const unassignScanner = mutation({
  args: {
    scannerId: v.id("scanners"),
    userId: v.id("users"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const now = Date.now();
    const scanner = await ctx.db.get(args.scannerId);

    if (!scanner) {
      throw new Error("Scanner not found");
    }

    if (!scanner.assignedTo) {
      throw new Error("Scanner is not assigned to anyone");
    }

    const previousAssignee = scanner.assignedTo;

    // Update scanner
    await ctx.db.patch(args.scannerId, {
      status: "available",
      assignedTo: undefined,
      assignedAt: undefined,
      updatedAt: now,
    });

    // Create history record
    await ctx.db.insert("equipmentHistory", {
      equipmentType: "scanner",
      equipmentId: args.scannerId,
      action: "unassigned",
      previousStatus: scanner.status,
      newStatus: "available",
      previousAssignee: previousAssignee,
      performedBy: args.userId,
      notes: args.notes,
      createdAt: now,
    });

    return { success: true };
  },
});

// ============ PICKER MUTATIONS ============

// Create a new picker
export const createPicker = mutation({
  args: {
    number: v.string(),
    pin: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    model: v.optional(v.string()),
    locationId: v.id("locations"),
    purchaseDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    conditionNotes: v.optional(v.string()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const now = Date.now();

    // Check if picker number already exists at this location
    const existing = await ctx.db
      .query("pickers")
      .withIndex("by_location", (q) => q.eq("locationId", args.locationId))
      .collect();

    if (existing.some((p) => p.number === args.number)) {
      throw new Error(`Picker #${args.number} already exists at this location`);
    }

    return await ctx.db.insert("pickers", {
      number: args.number,
      pin: args.pin,
      serialNumber: args.serialNumber,
      model: args.model,
      locationId: args.locationId,
      status: "available",
      purchaseDate: args.purchaseDate,
      notes: args.notes,
      conditionNotes: args.conditionNotes,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update a picker
export const updatePicker = mutation({
  args: {
    id: v.id("pickers"),
    number: v.optional(v.string()),
    pin: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    model: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
    status: v.optional(v.string()),
    lastMaintenanceDate: v.optional(v.string()),
    purchaseDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    conditionNotes: v.optional(v.string()),
    userId: v.optional(v.id("users")), // Who made the change (for PIN tracking)
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const { id, userId, requestingUserId: _ignored, ...updates } = args;
    const now = Date.now();

    // Get current picker to check for PIN change
    const currentPicker = await ctx.db.get(id);
    if (!currentPicker) {
      throw new Error("Picker not found");
    }

    // Check if PIN is being changed and log it
    if (updates.pin !== undefined && updates.pin !== currentPicker.pin && userId) {
      await ctx.db.insert("equipmentHistory", {
        equipmentType: "picker",
        equipmentId: id,
        action: "pin_change",
        previousStatus: currentPicker.status,
        newStatus: currentPicker.status,
        performedBy: userId,
        notes: `PIN changed from "${currentPicker.pin || "(none)"}" to "${updates.pin || "(none)"}"`,
        createdAt: now,
      });
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
      updatedAt: now,
    });
  },
});

// Assign picker to personnel
export const assignPicker = mutation({
  args: {
    pickerId: v.id("pickers"),
    personnelId: v.id("personnel"),
    userId: v.id("users"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const now = Date.now();
    const picker = await ctx.db.get(args.pickerId);

    if (!picker) {
      throw new Error("Picker not found");
    }

    if (picker.status !== "available") {
      throw new Error(
        `Picker is not available (current status: ${picker.status})`
      );
    }

    // Update picker
    await ctx.db.patch(args.pickerId, {
      status: "assigned",
      assignedTo: args.personnelId,
      assignedAt: now,
      updatedAt: now,
    });

    // Create history record
    await ctx.db.insert("equipmentHistory", {
      equipmentType: "picker",
      equipmentId: args.pickerId,
      action: "assigned",
      previousStatus: picker.status,
      newStatus: "assigned",
      newAssignee: args.personnelId,
      performedBy: args.userId,
      notes: args.notes,
      createdAt: now,
    });

    return { success: true };
  },
});

// Unassign picker from personnel
export const unassignPicker = mutation({
  args: {
    pickerId: v.id("pickers"),
    userId: v.id("users"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const now = Date.now();
    const picker = await ctx.db.get(args.pickerId);

    if (!picker) {
      throw new Error("Picker not found");
    }

    if (!picker.assignedTo) {
      throw new Error("Picker is not assigned to anyone");
    }

    const previousAssignee = picker.assignedTo;

    // Update picker
    await ctx.db.patch(args.pickerId, {
      status: "available",
      assignedTo: undefined,
      assignedAt: undefined,
      updatedAt: now,
    });

    // Create history record
    await ctx.db.insert("equipmentHistory", {
      equipmentType: "picker",
      equipmentId: args.pickerId,
      action: "unassigned",
      previousStatus: picker.status,
      newStatus: "available",
      previousAssignee: previousAssignee,
      performedBy: args.userId,
      notes: args.notes,
      createdAt: now,
    });

    return { success: true };
  },
});

// ============ EQUIPMENT HISTORY ============

// Get equipment history
export const getEquipmentHistory = query({
  args: {
    equipmentType: v.string(),
    equipmentId: v.union(v.id("scanners"), v.id("pickers")),
  },
  handler: async (ctx, args) => {
    const history = await ctx.db
      .query("equipmentHistory")
      .withIndex("by_equipment", (q) =>
        q.eq("equipmentType", args.equipmentType).eq("equipmentId", args.equipmentId)
      )
      .order("desc")
      .collect();

    // Enrich with user and personnel names
    return await Promise.all(
      history.map(async (record) => {
        const performer = await ctx.db.get(record.performedBy);
        const prevAssignee = record.previousAssignee
          ? await ctx.db.get(record.previousAssignee)
          : null;
        const newAssignee = record.newAssignee
          ? await ctx.db.get(record.newAssignee)
          : null;

        return {
          ...record,
          performedByName: performer?.name ?? "Unknown",
          previousAssigneeName: prevAssignee
            ? `${prevAssignee.firstName} ${prevAssignee.lastName}`
            : null,
          newAssigneeName: newAssignee
            ? `${newAssignee.firstName} ${newAssignee.lastName}`
            : null,
        };
      })
    );
  },
});

// Change equipment status (for maintenance, lost, retired, etc.)
export const changeEquipmentStatus = mutation({
  args: {
    equipmentType: v.string(), // "scanner" | "picker"
    equipmentId: v.union(v.id("scanners"), v.id("pickers")),
    newStatus: v.string(),
    userId: v.id("users"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const now = Date.now();

    // Get the equipment
    const equipment =
      args.equipmentType === "scanner"
        ? await ctx.db.get(args.equipmentId as typeof args.equipmentId)
        : await ctx.db.get(args.equipmentId as typeof args.equipmentId);

    if (!equipment) {
      throw new Error(`${args.equipmentType} not found`);
    }

    const previousStatus = equipment.status;

    // If setting to available, clear assignment
    const updates: Record<string, unknown> = {
      status: args.newStatus,
      updatedAt: now,
    };

    if (args.newStatus === "available") {
      updates.assignedTo = undefined;
      updates.assignedAt = undefined;
    }

    // Update equipment
    await ctx.db.patch(args.equipmentId, updates);

    // Create history record
    await ctx.db.insert("equipmentHistory", {
      equipmentType: args.equipmentType,
      equipmentId: args.equipmentId,
      action: "status_change",
      previousStatus: previousStatus,
      newStatus: args.newStatus,
      previousAssignee: equipment.assignedTo,
      performedBy: args.userId,
      notes: args.notes,
      createdAt: now,
    });

    return { success: true };
  },
});

// Retire equipment
export const retireEquipment = mutation({
  args: {
    equipmentType: v.string(), // "scanner" | "picker"
    equipmentId: v.union(v.id("scanners"), v.id("pickers")),
    reason: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.userId);
    const now = Date.now();

    const equipment =
      args.equipmentType === "scanner"
        ? await ctx.db.get(args.equipmentId as Id<"scanners">)
        : await ctx.db.get(args.equipmentId as Id<"pickers">);

    if (!equipment) {
      throw new Error(`${args.equipmentType} not found`);
    }

    const previousStatus = equipment.status;

    // Update equipment to retired
    await ctx.db.patch(args.equipmentId, {
      status: "retired",
      assignedTo: undefined,
      assignedAt: undefined,
      retiredAt: now,
      retiredReason: args.reason,
      updatedAt: now,
    });

    // Create history record
    await ctx.db.insert("equipmentHistory", {
      equipmentType: args.equipmentType,
      equipmentId: args.equipmentId,
      action: "status_change",
      previousStatus: previousStatus,
      newStatus: "retired",
      previousAssignee: equipment.assignedTo,
      performedBy: args.userId,
      notes: `Retired: ${args.reason}`,
      createdAt: now,
    });

    return { success: true };
  },
});

// Update condition notes
export const updateConditionNotes = mutation({
  args: {
    equipmentType: v.string(), // "scanner" | "picker"
    equipmentId: v.union(v.id("scanners"), v.id("pickers")),
    conditionNotes: v.string(),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    await ctx.db.patch(args.equipmentId, {
      conditionNotes: args.conditionNotes,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// ============ EQUIPMENT AGREEMENTS ============

// Generate the official equipment agreement text
export const generateAgreementText = (
  equipmentType: string,
  equipmentNumber: string,
  serialNumber: string | undefined,
  employeeName: string,
  equipmentValue: number
): string => {
  const serialDisplay = serialNumber ? ` (Serial: ${serialNumber})` : "";
  const equipmentLabel = equipmentType === "scanner" ? "Scanner" : "Picker";

  return `EQUIPMENT RESPONSIBILITY AGREEMENT

This Equipment Responsibility Agreement ("Agreement") is entered into between the Employee named below and IE Tires, LLC ("Company").

EQUIPMENT ASSIGNED:
${equipmentLabel} #${equipmentNumber}${serialDisplay}
Equipment Value: $${equipmentValue.toFixed(2)}

EMPLOYEE: ${employeeName}

TERMS AND CONDITIONS:

1. SOLE RESPONSIBILITY: The undersigned Employee acknowledges receipt of the above-described Company equipment and accepts full responsibility for its care, security, and proper use.

2. AUTHORIZED USE ONLY: This equipment is issued exclusively to the undersigned Employee. No other individual is authorized to access, operate, or use this equipment under any circumstances.

3. ON-PREMISES ONLY: This equipment must remain on Company premises at all times. Under no circumstances shall this equipment be removed from the workplace or taken to the Employee's residence.

4. DAMAGE REPORTING: The Employee shall immediately report any damage, malfunction, or defect to their supervisor. Failure to promptly report damage may result in disciplinary action and financial liability.

5. FINANCIAL LIABILITY:
   a) Failure to return equipment upon separation from employment, reassignment, or request by management will result in a deduction of up to $${equipmentValue.toFixed(2)} from the Employee's final pay.
   b) Damage resulting from intentional misconduct, gross negligence, or careless handling may result in a deduction of up to $${equipmentValue.toFixed(2)} from Employee's pay to cover replacement costs.

6. RETURN REQUIREMENT: Upon termination of employment, reassignment, or request by management, the Employee shall immediately return this equipment in the same condition as received, allowing for reasonable wear and tear.

By signing below, the Employee acknowledges that they have read, understand, and agree to abide by all terms and conditions set forth in this Agreement.

Signed electronically on ${new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })}`;
};

// Assign equipment with signed agreement
export const assignEquipmentWithAgreement = mutation({
  args: {
    equipmentType: v.string(), // "scanner" | "picker"
    equipmentId: v.union(v.id("scanners"), v.id("pickers")),
    personnelId: v.id("personnel"),
    signatureData: v.string(), // Base64 encoded signature image
    userId: v.id("users"), // Admin/manager witnessing
    userName: v.string(), // Name for display
    equipmentValue: v.optional(v.number()), // Default $100
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const now = Date.now();
    const equipmentValue = args.equipmentValue ?? 100;

    // Get equipment
    const equipment = await ctx.db.get(args.equipmentId);
    if (!equipment) {
      throw new Error(`${args.equipmentType} not found`);
    }

    if (equipment.status !== "available") {
      throw new Error(
        `Equipment is not available for assignment (current status: ${equipment.status})`
      );
    }

    // Get personnel
    const personnel = await ctx.db.get(args.personnelId);
    if (!personnel) {
      throw new Error("Personnel not found");
    }

    const employeeName = `${personnel.firstName} ${personnel.lastName}`;
    const equipmentLabel = args.equipmentType === "scanner" ? "Scanner" : "Picker";

    // Generate agreement text
    const agreementText = generateAgreementText(
      args.equipmentType,
      equipment.number,
      equipment.serialNumber,
      employeeName,
      equipmentValue
    );

    // Create agreement record
    await ctx.db.insert("equipmentAgreements", {
      equipmentType: args.equipmentType,
      equipmentId: args.equipmentId,
      personnelId: args.personnelId,
      equipmentNumber: equipment.number,
      serialNumber: equipment.serialNumber,
      equipmentValue: equipmentValue,
      agreementText: agreementText,
      signatureData: args.signatureData,
      signedAt: now,
      witnessedBy: args.userId,
      witnessedByName: args.userName,
      createdAt: now,
    });

    // Update equipment
    await ctx.db.patch(args.equipmentId, {
      status: "assigned",
      assignedTo: args.personnelId,
      assignedAt: now,
      updatedAt: now,
    });

    // Create history record
    await ctx.db.insert("equipmentHistory", {
      equipmentType: args.equipmentType,
      equipmentId: args.equipmentId,
      action: "assigned",
      previousStatus: equipment.status,
      newStatus: "assigned",
      newAssignee: args.personnelId,
      performedBy: args.userId,
      notes: `${equipmentLabel} #${equipment.number} assigned to ${employeeName} with signed agreement`,
      createdAt: now,
    });

    return { success: true };
  },
});

// Return equipment with condition check
export const returnEquipmentWithCheck = mutation({
  args: {
    equipmentType: v.string(), // "scanner" | "picker"
    equipmentId: v.union(v.id("scanners"), v.id("pickers")),
    checkedBy: v.id("users"),
    checkedByName: v.string(),
    checklist: v.object({
      physicalCondition: v.boolean(),
      screenFunctional: v.boolean(),
      buttonsWorking: v.boolean(),
      batteryCondition: v.boolean(),
      chargingPortOk: v.boolean(),
      scannerFunctional: v.boolean(),
      cleanCondition: v.boolean(),
    }),
    overallCondition: v.string(), // "excellent" | "good" | "fair" | "poor" | "damaged"
    damageNotes: v.optional(v.string()),
    repairRequired: v.boolean(),
    readyForReassignment: v.boolean(),
    deductionRequired: v.optional(v.boolean()),
    deductionAmount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.checkedBy);
    const now = Date.now();

    // Get equipment
    const equipment = await ctx.db.get(args.equipmentId);
    if (!equipment) {
      throw new Error(`${args.equipmentType} not found`);
    }

    if (!equipment.assignedTo) {
      throw new Error("Equipment is not currently assigned");
    }

    const returnedBy = equipment.assignedTo;

    // Create condition check record
    const checkId = await ctx.db.insert("equipmentConditionChecks", {
      equipmentType: args.equipmentType,
      equipmentId: args.equipmentId,
      returnedBy: returnedBy,
      checkedBy: args.checkedBy,
      checkedByName: args.checkedByName,
      checklist: args.checklist,
      overallCondition: args.overallCondition,
      damageNotes: args.damageNotes,
      repairRequired: args.repairRequired,
      readyForReassignment: args.readyForReassignment,
      deductionRequired: args.deductionRequired,
      deductionAmount: args.deductionAmount,
      checkedAt: now,
      createdAt: now,
    });

    // Determine new status
    let newStatus = "available";
    if (args.repairRequired) {
      newStatus = "maintenance";
    } else if (!args.readyForReassignment) {
      newStatus = "maintenance";
    }

    // Update condition notes on equipment
    const conditionNotes = args.damageNotes
      ? `${args.overallCondition} - ${args.damageNotes}`
      : args.overallCondition;

    // Update equipment
    await ctx.db.patch(args.equipmentId, {
      status: newStatus,
      assignedTo: undefined,
      assignedAt: undefined,
      conditionNotes: conditionNotes,
      updatedAt: now,
    });

    // Revoke the active agreement
    const agreements = await ctx.db
      .query("equipmentAgreements")
      .withIndex("by_equipment", (q) =>
        q.eq("equipmentType", args.equipmentType).eq("equipmentId", args.equipmentId)
      )
      .collect();

    const activeAgreement = agreements.find(
      (a) => a.personnelId === returnedBy && !a.revokedAt
    );

    if (activeAgreement) {
      await ctx.db.patch(activeAgreement._id, {
        revokedAt: now,
        revokedBy: args.checkedBy,
        revokedReason: "Equipment returned",
      });
    }

    // Create history record
    await ctx.db.insert("equipmentHistory", {
      equipmentType: args.equipmentType,
      equipmentId: args.equipmentId,
      action: "unassigned",
      previousStatus: equipment.status,
      newStatus: newStatus,
      previousAssignee: returnedBy,
      conditionCheckId: checkId,
      performedBy: args.checkedBy,
      notes: `Returned with condition: ${args.overallCondition}${
        args.repairRequired ? " (repair required)" : ""
      }`,
      createdAt: now,
    });

    return { success: true, conditionCheckId: checkId };
  },
});

// Get equipment agreement for specific equipment
export const getEquipmentAgreement = query({
  args: {
    equipmentType: v.string(),
    equipmentId: v.union(v.id("scanners"), v.id("pickers")),
  },
  handler: async (ctx, args) => {
    const agreements = await ctx.db
      .query("equipmentAgreements")
      .withIndex("by_equipment", (q) =>
        q.eq("equipmentType", args.equipmentType).eq("equipmentId", args.equipmentId)
      )
      .order("desc")
      .collect();

    // Return the active (non-revoked) agreement, or the most recent one
    const active = agreements.find((a) => !a.revokedAt);
    return active ?? agreements[0] ?? null;
  },
});

// Get all agreements for a personnel
export const getPersonnelAgreements = query({
  args: { personnelId: v.id("personnel") },
  handler: async (ctx, args) => {
    const agreements = await ctx.db
      .query("equipmentAgreements")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .order("desc")
      .collect();

    return agreements;
  },
});

// Get condition check history for equipment
export const getEquipmentConditionHistory = query({
  args: {
    equipmentType: v.string(),
    equipmentId: v.union(v.id("scanners"), v.id("pickers")),
  },
  handler: async (ctx, args) => {
    const checks = await ctx.db
      .query("equipmentConditionChecks")
      .withIndex("by_equipment", (q) =>
        q.eq("equipmentType", args.equipmentType).eq("equipmentId", args.equipmentId)
      )
      .order("desc")
      .collect();

    // Enrich with personnel names
    return await Promise.all(
      checks.map(async (check) => {
        const personnel = await ctx.db.get(check.returnedBy);
        return {
          ...check,
          returnedByName: personnel
            ? `${personnel.firstName} ${personnel.lastName}`
            : "Unknown",
        };
      })
    );
  },
});

// List active personnel for assignment dropdown
export const listActivePersonnel = query({
  args: {},
  handler: async (ctx) => {
    const personnel = await ctx.db
      .query("personnel")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    return personnel.map((p) => ({
      _id: p._id,
      name: `${p.firstName} ${p.lastName}`,
      position: p.position,
      department: p.department,
    }));
  },
});

// Reassign equipment from one person to another with condition check
export const reassignEquipment = mutation({
  args: {
    equipmentType: v.string(), // "scanner" | "picker"
    equipmentId: v.union(v.id("scanners"), v.id("pickers")),
    // Condition check for returning equipment
    checklist: v.object({
      physicalCondition: v.boolean(),
      screenFunctional: v.boolean(),
      buttonsWorking: v.boolean(),
      batteryCondition: v.boolean(),
      chargingPortOk: v.boolean(),
      scannerFunctional: v.boolean(),
      cleanCondition: v.boolean(),
    }),
    overallCondition: v.string(),
    damageNotes: v.optional(v.string()),
    repairRequired: v.boolean(),
    deductionRequired: v.optional(v.boolean()),
    deductionAmount: v.optional(v.number()),
    signOffSignature: v.string(), // Manager signature for condition check sign-off
    // New assignment info
    newPersonnelId: v.id("personnel"),
    newPersonnelSignature: v.string(), // New person's signature for equipment agreement
    // Who is performing this
    userId: v.id("users"),
    userName: v.string(),
    equipmentValue: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const now = Date.now();
    const equipmentValue = args.equipmentValue ?? 100;

    // Get equipment
    const equipment = await ctx.db.get(args.equipmentId);
    if (!equipment) {
      throw new Error(`${args.equipmentType} not found`);
    }

    if (!equipment.assignedTo) {
      throw new Error("Equipment is not currently assigned to anyone");
    }

    if (args.repairRequired) {
      throw new Error("Cannot reassign equipment that requires repair. Please return it first.");
    }

    const previousAssignee = equipment.assignedTo;

    // Get previous assignee info
    const prevPerson = await ctx.db.get(previousAssignee);
    const prevPersonName = prevPerson
      ? `${prevPerson.firstName} ${prevPerson.lastName}`
      : "Unknown";

    // Get new assignee info
    const newPerson = await ctx.db.get(args.newPersonnelId);
    if (!newPerson) {
      throw new Error("New personnel not found");
    }
    const newPersonName = `${newPerson.firstName} ${newPerson.lastName}`;

    // 1. Create condition check record with signature
    const conditionCheckId = await ctx.db.insert("equipmentConditionChecks", {
      equipmentType: args.equipmentType,
      equipmentId: args.equipmentId,
      returnedBy: previousAssignee,
      checkedBy: args.userId,
      checkedByName: args.userName,
      checklist: args.checklist,
      overallCondition: args.overallCondition,
      damageNotes: args.damageNotes,
      repairRequired: args.repairRequired,
      readyForReassignment: true, // We're reassigning so it's ready
      deductionRequired: args.deductionRequired,
      deductionAmount: args.deductionAmount,
      signOffSignature: args.signOffSignature,
      signOffAt: now,
      checkType: "reassign",
      reassignedTo: args.newPersonnelId,
      checkedAt: now,
      createdAt: now,
    });

    // 2. Revoke the old agreement
    const agreements = await ctx.db
      .query("equipmentAgreements")
      .withIndex("by_equipment", (q) =>
        q.eq("equipmentType", args.equipmentType).eq("equipmentId", args.equipmentId)
      )
      .collect();

    const activeAgreement = agreements.find(
      (a) => a.personnelId === previousAssignee && !a.revokedAt
    );

    if (activeAgreement) {
      await ctx.db.patch(activeAgreement._id, {
        revokedAt: now,
        revokedBy: args.userId,
        revokedReason: `Reassigned to ${newPersonName}`,
      });
    }

    // 3. Create history record for unassign
    await ctx.db.insert("equipmentHistory", {
      equipmentType: args.equipmentType,
      equipmentId: args.equipmentId,
      action: "unassigned",
      previousStatus: equipment.status,
      newStatus: "assigned", // Still assigned (to new person)
      previousAssignee: previousAssignee,
      conditionCheckId: conditionCheckId,
      performedBy: args.userId,
      notes: `Reassigned from ${prevPersonName} - Condition: ${args.overallCondition}`,
      createdAt: now,
    });

    // 4. Create new equipment agreement
    const equipmentLabel = args.equipmentType === "scanner" ? "Scanner" : "Picker";
    const agreementText = generateAgreementText(
      args.equipmentType,
      equipment.number,
      equipment.serialNumber,
      newPersonName,
      equipmentValue
    );

    await ctx.db.insert("equipmentAgreements", {
      equipmentType: args.equipmentType,
      equipmentId: args.equipmentId,
      personnelId: args.newPersonnelId,
      equipmentNumber: equipment.number,
      serialNumber: equipment.serialNumber,
      equipmentValue: equipmentValue,
      agreementText: agreementText,
      signatureData: args.newPersonnelSignature,
      signedAt: now,
      witnessedBy: args.userId,
      witnessedByName: args.userName,
      createdAt: now,
    });

    // 5. Update equipment with new assignee
    const conditionNotes = args.damageNotes
      ? `${args.overallCondition} - ${args.damageNotes}`
      : args.overallCondition;

    await ctx.db.patch(args.equipmentId, {
      assignedTo: args.newPersonnelId,
      assignedAt: now,
      conditionNotes: conditionNotes,
      updatedAt: now,
    });

    // 6. Create history record for assign
    await ctx.db.insert("equipmentHistory", {
      equipmentType: args.equipmentType,
      equipmentId: args.equipmentId,
      action: "assigned",
      previousStatus: "assigned",
      newStatus: "assigned",
      previousAssignee: previousAssignee,
      newAssignee: args.newPersonnelId,
      performedBy: args.userId,
      notes: `${equipmentLabel} #${equipment.number} reassigned from ${prevPersonName} to ${newPersonName}`,
      createdAt: now,
    });

    return {
      success: true,
      conditionCheckId,
      previousAssignee: prevPersonName,
      newAssignee: newPersonName,
    };
  },
});

// Delete equipment (superuser only - checked on frontend)
export const deleteEquipment = mutation({
  args: {
    equipmentType: v.string(), // "scanner" | "picker"
    equipmentId: v.union(v.id("scanners"), v.id("pickers")),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.userId);
    // Get equipment to verify it exists
    const equipment = await ctx.db.get(args.equipmentId);
    if (!equipment) {
      throw new Error(`${args.equipmentType} not found`);
    }

    // Delete related records
    // 1. Delete equipment history
    const history = await ctx.db
      .query("equipmentHistory")
      .withIndex("by_equipment", (q) =>
        q.eq("equipmentType", args.equipmentType).eq("equipmentId", args.equipmentId)
      )
      .collect();

    for (const record of history) {
      await ctx.db.delete(record._id);
    }

    // 2. Delete equipment agreements
    const agreements = await ctx.db
      .query("equipmentAgreements")
      .withIndex("by_equipment", (q) =>
        q.eq("equipmentType", args.equipmentType).eq("equipmentId", args.equipmentId)
      )
      .collect();

    for (const agreement of agreements) {
      await ctx.db.delete(agreement._id);
    }

    // 3. Delete condition checks
    const conditionChecks = await ctx.db
      .query("equipmentConditionChecks")
      .withIndex("by_equipment", (q) =>
        q.eq("equipmentType", args.equipmentType).eq("equipmentId", args.equipmentId)
      )
      .collect();

    for (const check of conditionChecks) {
      await ctx.db.delete(check._id);
    }

    // 4. Delete the equipment itself
    await ctx.db.delete(args.equipmentId);

    return { success: true };
  },
});

// ============ VEHICLE QUERIES ============

// List all vehicles
export const listVehicles = query({
  args: {
    locationId: v.optional(v.id("locations")),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let vehicles;

    if (args.locationId) {
      vehicles = await ctx.db
        .query("vehicles")
        .withIndex("by_location", (q) => q.eq("locationId", args.locationId!))
        .collect();
    } else {
      vehicles = await ctx.db.query("vehicles").collect();
    }

    if (args.status) {
      vehicles = vehicles.filter((v) => v.status === args.status);
    }

    // Enrich with location and personnel info
    return await Promise.all(
      vehicles.map(async (vehicle) => {
        const location = vehicle.locationId
          ? await ctx.db.get(vehicle.locationId)
          : null;
        const assignedPerson = vehicle.assignedTo
          ? await ctx.db.get(vehicle.assignedTo)
          : null;

        return {
          ...vehicle,
          locationName: location?.name ?? "Unassigned",
          assignedPersonName: assignedPerson
            ? `${assignedPerson.firstName} ${assignedPerson.lastName}`
            : null,
        };
      })
    );
  },
});

// Get single vehicle
export const getVehicle = query({
  args: { id: v.id("vehicles") },
  handler: async (ctx, args) => {
    const vehicle = await ctx.db.get(args.id);
    if (!vehicle) return null;

    const location = vehicle.locationId
      ? await ctx.db.get(vehicle.locationId)
      : null;
    const assignedPerson = vehicle.assignedTo
      ? await ctx.db.get(vehicle.assignedTo)
      : null;

    return {
      ...vehicle,
      locationName: location?.name ?? "Unassigned",
      assignedPersonName: assignedPerson
        ? `${assignedPerson.firstName} ${assignedPerson.lastName}`
        : null,
    };
  },
});

// Get vehicle by VIN
export const getVehicleByVin = query({
  args: { vin: v.string() },
  handler: async (ctx, args) => {
    const vehicle = await ctx.db
      .query("vehicles")
      .withIndex("by_vin", (q) => q.eq("vin", args.vin))
      .first();
    return vehicle;
  },
});

// ============ VEHICLE MUTATIONS ============

// Create a new vehicle
export const createVehicle = mutation({
  args: {
    vin: v.string(),
    plateNumber: v.optional(v.string()),
    year: v.optional(v.number()),
    make: v.string(),
    model: v.string(),
    trim: v.optional(v.string()),
    color: v.optional(v.string()),
    fuelType: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
    currentMileage: v.optional(v.number()),
    insurancePolicyNumber: v.optional(v.string()),
    insuranceProvider: v.optional(v.string()),
    insuranceExpirationDate: v.optional(v.string()),
    registrationExpirationDate: v.optional(v.string()),
    registrationState: v.optional(v.string()),
    purchaseDate: v.optional(v.string()),
    purchasePrice: v.optional(v.number()),
    purchasedFrom: v.optional(v.string()),
    notes: v.optional(v.string()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    // Check for duplicate VIN
    const existing = await ctx.db
      .query("vehicles")
      .withIndex("by_vin", (q) => q.eq("vin", args.vin))
      .first();

    if (existing) {
      throw new Error("A vehicle with this VIN already exists");
    }

    const now = Date.now();
    const vehicleId = await ctx.db.insert("vehicles", {
      vin: args.vin.toUpperCase(),
      plateNumber: args.plateNumber?.toUpperCase(),
      year: args.year,
      make: args.make,
      model: args.model,
      trim: args.trim,
      color: args.color,
      fuelType: args.fuelType,
      locationId: args.locationId,
      status: "active",
      currentMileage: args.currentMileage,
      lastMileageUpdate: args.currentMileage ? now : undefined,
      insurancePolicyNumber: args.insurancePolicyNumber,
      insuranceProvider: args.insuranceProvider,
      insuranceExpirationDate: args.insuranceExpirationDate,
      registrationExpirationDate: args.registrationExpirationDate,
      registrationState: args.registrationState,
      purchaseDate: args.purchaseDate,
      purchasePrice: args.purchasePrice,
      purchasedFrom: args.purchasedFrom,
      notes: args.notes,
      createdAt: now,
      updatedAt: now,
    });

    return vehicleId;
  },
});

// Update a vehicle
export const updateVehicle = mutation({
  args: {
    id: v.id("vehicles"),
    vin: v.optional(v.string()),
    plateNumber: v.optional(v.string()),
    year: v.optional(v.number()),
    make: v.optional(v.string()),
    model: v.optional(v.string()),
    trim: v.optional(v.string()),
    color: v.optional(v.string()),
    fuelType: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
    status: v.optional(v.string()),
    currentMileage: v.optional(v.number()),
    insurancePolicyNumber: v.optional(v.string()),
    insuranceProvider: v.optional(v.string()),
    insuranceExpirationDate: v.optional(v.string()),
    registrationExpirationDate: v.optional(v.string()),
    registrationState: v.optional(v.string()),
    purchaseDate: v.optional(v.string()),
    purchasePrice: v.optional(v.number()),
    purchasedFrom: v.optional(v.string()),
    lastMaintenanceDate: v.optional(v.string()),
    nextMaintenanceDue: v.optional(v.string()),
    nextMaintenanceMileage: v.optional(v.number()),
    notes: v.optional(v.string()),
    conditionNotes: v.optional(v.string()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const { id, requestingUserId: _ignored, ...updates } = args;
    const vehicle = await ctx.db.get(id);
    if (!vehicle) {
      throw new Error("Vehicle not found");
    }

    // Check for duplicate VIN if changing
    if (updates.vin && updates.vin !== vehicle.vin) {
      const existing = await ctx.db
        .query("vehicles")
        .withIndex("by_vin", (q) => q.eq("vin", updates.vin!))
        .first();
      if (existing) {
        throw new Error("A vehicle with this VIN already exists");
      }
    }

    const now = Date.now();
    const updateData: Record<string, unknown> = {
      ...updates,
      updatedAt: now,
    };

    // Track mileage updates
    if (updates.currentMileage !== undefined && updates.currentMileage !== vehicle.currentMileage) {
      updateData.lastMileageUpdate = now;
    }

    // Uppercase VIN and plate
    if (updates.vin) {
      updateData.vin = updates.vin.toUpperCase();
    }
    if (updates.plateNumber) {
      updateData.plateNumber = updates.plateNumber.toUpperCase();
    }

    await ctx.db.patch(id, updateData);
    return { success: true };
  },
});

// Assign vehicle to personnel
export const assignVehicle = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    personnelId: v.id("personnel"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle) {
      throw new Error("Vehicle not found");
    }

    const personnel = await ctx.db.get(args.personnelId);
    if (!personnel) {
      throw new Error("Personnel not found");
    }

    const now = Date.now();
    await ctx.db.patch(args.vehicleId, {
      assignedTo: args.personnelId,
      assignedAt: now,
      updatedAt: now,
    });

    return { success: true };
  },
});

// Unassign vehicle
export const unassignVehicle = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle) {
      throw new Error("Vehicle not found");
    }

    const now = Date.now();
    await ctx.db.patch(args.vehicleId, {
      assignedTo: undefined,
      assignedAt: undefined,
      updatedAt: now,
    });

    return { success: true };
  },
});

// Retire a vehicle
export const retireVehicle = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    reason: v.string(),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle) {
      throw new Error("Vehicle not found");
    }

    const now = Date.now();
    await ctx.db.patch(args.vehicleId, {
      status: "retired",
      retiredAt: now,
      retiredReason: args.reason,
      assignedTo: undefined,
      assignedAt: undefined,
      updatedAt: now,
    });

    return { success: true };
  },
});

// Update vehicle mileage
export const updateVehicleMileage = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    mileage: v.number(),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle) {
      throw new Error("Vehicle not found");
    }

    const now = Date.now();
    await ctx.db.patch(args.vehicleId, {
      currentMileage: args.mileage,
      lastMileageUpdate: now,
      updatedAt: now,
    });

    return { success: true };
  },
});

// Delete a vehicle (super_admin only)
export const deleteVehicle = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle) {
      throw new Error("Vehicle not found");
    }

    await ctx.db.delete(args.vehicleId);
    return { success: true };
  },
});

// ============ COMPUTER / REMOTE ACCESS ============

// List all computers with remote access
export const listComputers = query({
  args: {
    status: v.optional(v.string()),
    department: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
  },
  handler: async (ctx, args) => {
    let computers = await ctx.db
      .query("equipment")
      .filter((q) =>
        q.or(
          q.eq(q.field("type"), "computer"),
          q.eq(q.field("type"), "laptop")
        )
      )
      .collect();

    if (args.status) {
      computers = computers.filter((c) => c.status === args.status);
    }
    if (args.department) {
      computers = computers.filter((c) => c.department === args.department);
    }
    if (args.locationId) {
      computers = computers.filter((c) => c.locationId === args.locationId);
    }

    // Enrich with assigned personnel name, location name, and remote URL
    const enriched = await Promise.all(
      computers.map(async (comp) => {
        let assignedToName = null;
        if (comp.assignedTo) {
          const person = await ctx.db.get(comp.assignedTo);
          assignedToName = person ? `${person.firstName} ${person.lastName}` : null;
        }

        let locationName = comp.location || null; // Fallback to legacy string location
        if (comp.locationId) {
          const location = await ctx.db.get(comp.locationId);
          locationName = location?.name || null;
        }

        return {
          ...comp,
          assignedToName,
          locationName,
          // Chrome Remote Desktop URL
          chromeRemoteUrl: comp.chromeRemoteId && comp.remoteAccessEnabled
            ? `https://remotedesktop.google.com/access/session/${comp.chromeRemoteId}`
            : null,
        };
      })
    );

    return enriched.sort((a, b) => a.name.localeCompare(b.name));
  },
});

// Get computers with active remote access
export const getRemoteAccessComputers = query({
  args: {},
  handler: async (ctx) => {
    const computers = await ctx.db
      .query("equipment")
      .filter((q) =>
        q.and(
          q.eq(q.field("remoteAccessEnabled"), true),
          q.or(
            q.eq(q.field("type"), "computer"),
            q.eq(q.field("type"), "laptop")
          )
        )
      )
      .collect();

    // Enrich with assigned personnel name
    const enriched = await Promise.all(
      computers.map(async (comp) => {
        let assignedToName = null;
        if (comp.assignedTo) {
          const person = await ctx.db.get(comp.assignedTo);
          assignedToName = person ? `${person.firstName} ${person.lastName}` : null;
        }
        return {
          ...comp,
          assignedToName,
          chromeRemoteUrl: comp.chromeRemoteId
            ? `https://remotedesktop.google.com/access/session/${comp.chromeRemoteId}`
            : null,
        };
      })
    );

    return enriched.sort((a, b) => a.name.localeCompare(b.name));
  },
});

// Create a new computer
export const createComputer = mutation({
  args: {
    name: v.string(), // Identifier
    type: v.string(), // "computer" | "laptop"
    serialNumber: v.optional(v.string()),
    manufacturer: v.optional(v.string()),
    model: v.optional(v.string()),
    operatingSystem: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    macAddress: v.optional(v.string()),
    ethernetPort: v.optional(v.string()), // Ethernet port if applicable
    adminPassword: v.optional(v.string()), // Admin password
    userPassword: v.optional(v.string()), // User password
    chromeRemoteId: v.optional(v.string()),
    remoteAccessEnabled: v.boolean(),
    remoteAccessCode: v.optional(v.string()), // Auth code for remote connection
    remoteAccessNotes: v.optional(v.string()), // Remote connection info
    assignedTo: v.optional(v.id("personnel")),
    department: v.optional(v.string()),
    location: v.optional(v.string()),
    locationId: v.optional(v.id("locations")), // Reference to locations table
    purchaseDate: v.optional(v.string()),
    warrantyExpiration: v.optional(v.string()),
    notes: v.optional(v.string()),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const now = Date.now();

    const computerId = await ctx.db.insert("equipment", {
      name: args.name,
      type: args.type,
      serialNumber: args.serialNumber,
      manufacturer: args.manufacturer,
      model: args.model,
      operatingSystem: args.operatingSystem,
      ipAddress: args.ipAddress,
      macAddress: args.macAddress,
      ethernetPort: args.ethernetPort,
      adminPassword: args.adminPassword,
      userPassword: args.userPassword,
      chromeRemoteId: args.chromeRemoteId,
      remoteAccessEnabled: args.remoteAccessEnabled,
      remoteAccessCode: args.remoteAccessCode,
      remoteAccessNotes: args.remoteAccessNotes,
      assignedTo: args.assignedTo,
      department: args.department,
      location: args.location,
      locationId: args.locationId,
      status: "active",
      purchaseDate: args.purchaseDate,
      warrantyExpiration: args.warrantyExpiration,
      notes: args.notes,
      createdBy: args.userId,
      createdAt: now,
      updatedAt: now,
    });

    return computerId;
  },
});

// Update computer
export const updateComputer = mutation({
  args: {
    computerId: v.id("equipment"),
    name: v.optional(v.string()),
    type: v.optional(v.string()), // "computer" | "laptop"
    serialNumber: v.optional(v.string()),
    manufacturer: v.optional(v.string()),
    model: v.optional(v.string()),
    operatingSystem: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    macAddress: v.optional(v.string()),
    ethernetPort: v.optional(v.string()),
    adminPassword: v.optional(v.string()),
    userPassword: v.optional(v.string()),
    chromeRemoteId: v.optional(v.string()),
    remoteAccessEnabled: v.optional(v.boolean()),
    remoteAccessCode: v.optional(v.string()),
    remoteAccessNotes: v.optional(v.string()),
    assignedTo: v.optional(v.id("personnel")),
    department: v.optional(v.string()),
    location: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
    status: v.optional(v.string()),
    purchaseDate: v.optional(v.string()),
    warrantyExpiration: v.optional(v.string()),
    notes: v.optional(v.string()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const { computerId, requestingUserId: _ignored, ...updates } = args;

    // Filter out undefined values
    const filteredUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        filteredUpdates[key] = value;
      }
    }

    await ctx.db.patch(computerId, {
      ...filteredUpdates,
      updatedAt: Date.now(),
    });

    return computerId;
  },
});

// Update Chrome Remote Desktop settings
export const updateChromeRemote = mutation({
  args: {
    computerId: v.id("equipment"),
    chromeRemoteId: v.string(),
    remoteAccessEnabled: v.boolean(),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    await ctx.db.patch(args.computerId, {
      chromeRemoteId: args.chromeRemoteId,
      remoteAccessEnabled: args.remoteAccessEnabled,
      updatedAt: Date.now(),
    });

    return args.computerId;
  },
});

// Delete computer
export const deleteComputer = mutation({
  args: {
    computerId: v.id("equipment"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const computer = await ctx.db.get(args.computerId);
    if (!computer) {
      throw new Error("Computer not found");
    }

    await ctx.db.delete(args.computerId);
    return { success: true };
  },
});

// ============ MOBILE APP - EMPLOYEE EQUIPMENT ============

// Get all equipment assigned to an employee with agreements and full details
export const getMyEquipment = query({
  args: { personnelId: v.id("personnel") },
  handler: async (ctx, args) => {
    // Get assigned scanners
    const scanners = await ctx.db
      .query("scanners")
      .withIndex("by_assigned", (q) => q.eq("assignedTo", args.personnelId))
      .collect();

    // Get assigned pickers
    const pickers = await ctx.db
      .query("pickers")
      .withIndex("by_assigned", (q) => q.eq("assignedTo", args.personnelId))
      .collect();

    // Get all agreements for this personnel
    const agreements = await ctx.db
      .query("equipmentAgreements")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .collect();

    // Enrich scanners with their agreements
    const enrichedScanners = await Promise.all(
      scanners.map(async (scanner) => {
        const location = await ctx.db.get(scanner.locationId);
        // Find the active agreement for this scanner
        const agreement = agreements.find(
          (a) =>
            a.equipmentType === "scanner" &&
            a.equipmentId === scanner._id &&
            !a.revokedAt
        );
        return {
          _id: scanner._id,
          type: "scanner" as const,
          number: scanner.number,
          pin: scanner.pin,
          model: scanner.model,
          serialNumber: scanner.serialNumber,
          locationName: location?.name ?? "Unknown",
          assignedAt: scanner.assignedAt,
          conditionNotes: scanner.conditionNotes,
          status: scanner.status,
          agreement: agreement
            ? {
                _id: agreement._id,
                agreementText: agreement.agreementText,
                signedAt: agreement.signedAt,
                signatureData: agreement.signatureData,
                equipmentValue: agreement.equipmentValue,
                witnessedByName: agreement.witnessedByName,
              }
            : null,
        };
      })
    );

    // Enrich pickers with their agreements
    const enrichedPickers = await Promise.all(
      pickers.map(async (picker) => {
        const location = await ctx.db.get(picker.locationId);
        // Find the active agreement for this picker
        const agreement = agreements.find(
          (a) =>
            a.equipmentType === "picker" &&
            a.equipmentId === picker._id &&
            !a.revokedAt
        );
        return {
          _id: picker._id,
          type: "picker" as const,
          number: picker.number,
          pin: picker.pin,
          model: picker.model,
          serialNumber: picker.serialNumber,
          locationName: location?.name ?? "Unknown",
          assignedAt: picker.assignedAt,
          conditionNotes: picker.conditionNotes,
          status: picker.status,
          agreement: agreement
            ? {
                _id: agreement._id,
                agreementText: agreement.agreementText,
                signedAt: agreement.signedAt,
                signatureData: agreement.signatureData,
                equipmentValue: agreement.equipmentValue,
                witnessedByName: agreement.witnessedByName,
              }
            : null,
        };
      })
    );

    // Combine and sort by assignment date (most recent first)
    const allEquipment = [...enrichedScanners, ...enrichedPickers].sort(
      (a, b) => (b.assignedAt ?? 0) - (a.assignedAt ?? 0)
    );

    return allEquipment;
  },
});
