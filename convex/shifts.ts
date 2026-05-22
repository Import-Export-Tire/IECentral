import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireManagePersonnel } from "./authGuards";

// ============ QUERIES ============

// Get shifts for a specific date, optionally filtered by location
export const listByDate = query({
  args: {
    date: v.string(),
    locationId: v.optional(v.id("locations")),
  },
  handler: async (ctx, args) => {
    // Get all shifts for the date first
    const allShifts = await ctx.db
      .query("shifts")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .collect();

    let shifts;
    if (args.locationId) {
      // Filter by location, but also include shifts without locationId (backwards compatibility)
      const filtered = allShifts.filter(
        (s) => s.locationId === args.locationId || !s.locationId
      );

      // Deduplicate by department - prefer shifts WITH locationId over those without
      const deptMap = new Map<string, typeof filtered[0]>();
      for (const shift of filtered) {
        const existing = deptMap.get(shift.department);
        if (!existing) {
          deptMap.set(shift.department, shift);
        } else if (!existing.locationId && shift.locationId) {
          // Replace the one without locationId with the one that has it
          deptMap.set(shift.department, shift);
        }
      }
      shifts = Array.from(deptMap.values());
    } else {
      shifts = allShifts;
    }

    // Enrich with personnel names and lead info
    const enriched = await Promise.all(
      shifts.map(async (shift) => {
        const assignedNames = await Promise.all(
          shift.assignedPersonnel.map(async (personnelId) => {
            const personnel = await ctx.db.get(personnelId);
            return personnel
              ? `${personnel.firstName} ${personnel.lastName}`
              : "Unknown";
          })
        );
        const createdBy = await ctx.db.get(shift.createdBy);

        // Get lead name if set
        let leadName: string | undefined;
        if (shift.leadId) {
          const lead = await ctx.db.get(shift.leadId);
          leadName = lead ? `${lead.firstName} ${lead.lastName}` : undefined;
        }

        return {
          ...shift,
          assignedNames,
          leadName,
          createdByName: createdBy?.name || "Unknown",
        };
      })
    );

    return enriched.sort((a, b) => a.startTime.localeCompare(b.startTime));
  },
});

// Get shifts for a date range
export const listByDateRange = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
    department: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let shifts;

    if (args.department) {
      shifts = await ctx.db
        .query("shifts")
        .withIndex("by_date_department", (q) =>
          q.eq("date", args.startDate).eq("department", args.department!)
        )
        .collect();

      // For date range, we need to filter manually since compound index
      // only works for exact matches on both fields
      const allShifts = await ctx.db.query("shifts").collect();
      shifts = allShifts.filter(
        (s) =>
          s.date >= args.startDate &&
          s.date <= args.endDate &&
          s.department === args.department
      );
    } else {
      const allShifts = await ctx.db.query("shifts").collect();
      shifts = allShifts.filter(
        (s) => s.date >= args.startDate && s.date <= args.endDate
      );
    }

    // Enrich with personnel names
    const enriched = await Promise.all(
      shifts.map(async (shift) => {
        const assignedNames = await Promise.all(
          shift.assignedPersonnel.map(async (personnelId) => {
            const personnel = await ctx.db.get(personnelId);
            return personnel
              ? `${personnel.firstName} ${personnel.lastName}`
              : "Unknown";
          })
        );
        return {
          ...shift,
          assignedNames,
        };
      })
    );

    return enriched.sort((a, b) => {
      // Sort by date first, then by start time
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.startTime.localeCompare(b.startTime);
    });
  },
});

// Get shifts for a specific personnel
export const listByPersonnel = query({
  args: {
    personnelId: v.id("personnel"),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const allShifts = await ctx.db.query("shifts").collect();

    let filtered = allShifts.filter((s) =>
      s.assignedPersonnel.includes(args.personnelId)
    );

    if (args.startDate) {
      filtered = filtered.filter((s) => s.date >= args.startDate!);
    }
    if (args.endDate) {
      filtered = filtered.filter((s) => s.date <= args.endDate!);
    }

    return filtered.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.startTime.localeCompare(b.startTime);
    });
  },
});

// Get single shift
export const getById = query({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, args) => {
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) return null;

    const assignedPersonnel = await Promise.all(
      shift.assignedPersonnel.map(async (personnelId) => {
        const personnel = await ctx.db.get(personnelId);
        return personnel
          ? {
              _id: personnel._id,
              name: `${personnel.firstName} ${personnel.lastName}`,
              department: personnel.department,
            }
          : null;
      })
    );

    const createdBy = await ctx.db.get(shift.createdBy);

    return {
      ...shift,
      assignedPersonnelDetails: assignedPersonnel.filter((p) => p !== null),
      createdByName: createdBy?.name || "Unknown",
    };
  },
});

// Get available personnel for a shift (not already assigned)
export const getAvailablePersonnel = query({
  args: {
    date: v.string(),
    startTime: v.string(),
    endTime: v.string(),
    department: v.optional(v.string()),
    excludeShiftId: v.optional(v.id("shifts")),
  },
  handler: async (ctx, args) => {
    // Get all active personnel
    const personnel = await ctx.db
      .query("personnel")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    // Filter by department if specified
    let filtered = args.department
      ? personnel.filter((p) => p.department === args.department)
      : personnel;

    // Get all shifts for this date that overlap with the requested time
    const shiftsOnDate = await ctx.db
      .query("shifts")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .collect();

    // Filter out the current shift if editing
    const otherShifts = args.excludeShiftId
      ? shiftsOnDate.filter((s) => s._id !== args.excludeShiftId)
      : shiftsOnDate;

    // Find personnel already assigned to overlapping shifts
    const timeToMinutes = (time: string): number => {
      const [h, m] = time.split(":").map(Number);
      return h * 60 + m;
    };
    const busyPersonnelIds = new Set<string>();
    for (const shift of otherShifts) {
      // Check for time overlap (numeric comparison to avoid lexicographic issues)
      const overlaps =
        (timeToMinutes(args.startTime) < timeToMinutes(shift.endTime) && timeToMinutes(args.endTime) > timeToMinutes(shift.startTime));
      if (overlaps) {
        shift.assignedPersonnel.forEach((id) => busyPersonnelIds.add(id));
      }
    }

    // Return available personnel
    const available = filtered.filter(
      (p) => !busyPersonnelIds.has(p._id)
    );

    return available.map((p) => ({
      _id: p._id,
      name: `${p.firstName} ${p.lastName}`,
      department: p.department,
      position: p.position,
    }));
  },
});

// ============ MUTATIONS ============

// Create shift
export const create = mutation({
  args: {
    date: v.string(),
    name: v.optional(v.string()),
    startTime: v.string(),
    endTime: v.string(),
    position: v.string(),
    department: v.string(),
    locationId: v.optional(v.id("locations")),
    requiredCount: v.number(),
    assignedPersonnel: v.array(v.id("personnel")),
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.createdBy);
    const now = Date.now();

    const shiftId = await ctx.db.insert("shifts", {
      date: args.date,
      name: args.name,
      startTime: args.startTime,
      endTime: args.endTime,
      position: args.position,
      department: args.department,
      locationId: args.locationId,
      requiredCount: args.requiredCount,
      assignedPersonnel: args.assignedPersonnel,
      notes: args.notes,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });

    return shiftId;
  },
});

// Update shift
export const update = mutation({
  args: {
    shiftId: v.id("shifts"),
    name: v.optional(v.string()),
    startTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    position: v.optional(v.string()),
    department: v.optional(v.string()),
    requiredCount: v.optional(v.number()),
    assignedPersonnel: v.optional(v.array(v.id("personnel"))),
    notes: v.optional(v.string()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const { shiftId, requestingUserId: _ignored, ...updates } = args;

    const updateData: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        updateData[key] = value;
      }
    }

    await ctx.db.patch(shiftId, updateData);
    return shiftId;
  },
});

// Assign personnel to shift
export const assignPersonnel = mutation({
  args: {
    shiftId: v.id("shifts"),
    personnelId: v.id("personnel"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) throw new Error("Shift not found");

    if (shift.assignedPersonnel.includes(args.personnelId)) {
      throw new Error("Personnel already assigned to this shift");
    }

    await ctx.db.patch(args.shiftId, {
      assignedPersonnel: [...shift.assignedPersonnel, args.personnelId],
      updatedAt: Date.now(),
    });

    return args.shiftId;
  },
});

// Remove personnel from shift
export const unassignPersonnel = mutation({
  args: {
    shiftId: v.id("shifts"),
    personnelId: v.id("personnel"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) throw new Error("Shift not found");

    await ctx.db.patch(args.shiftId, {
      assignedPersonnel: shift.assignedPersonnel.filter(
        (id) => id !== args.personnelId
      ),
      updatedAt: Date.now(),
    });

    return args.shiftId;
  },
});

// Set department lead
export const setLead = mutation({
  args: {
    shiftId: v.id("shifts"),
    personnelId: v.id("personnel"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) throw new Error("Shift not found");

    await ctx.db.patch(args.shiftId, {
      leadId: args.personnelId,
      updatedAt: Date.now(),
    });

    return args.shiftId;
  },
});

// Remove department lead
export const removeLead = mutation({
  args: {
    shiftId: v.id("shifts"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) throw new Error("Shift not found");

    await ctx.db.patch(args.shiftId, {
      leadId: undefined,
      updatedAt: Date.now(),
    });

    return args.shiftId;
  },
});

// Copy shifts from one date to another
export const copyFromDate = mutation({
  args: {
    sourceDate: v.string(),
    targetDate: v.string(),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.createdBy);
    const sourceShifts = await ctx.db
      .query("shifts")
      .withIndex("by_date", (q) => q.eq("date", args.sourceDate))
      .collect();

    const now = Date.now();
    const createdIds: string[] = [];

    for (const shift of sourceShifts) {
      const newShiftId = await ctx.db.insert("shifts", {
        date: args.targetDate,
        name: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
        position: shift.position,
        department: shift.department,
        requiredCount: shift.requiredCount,
        assignedPersonnel: [], // Don't copy assignments
        notes: shift.notes,
        createdBy: args.createdBy,
        createdAt: now,
        updatedAt: now,
      });
      createdIds.push(newShiftId);
    }

    return createdIds;
  },
});

// Delete shift
export const remove = mutation({
  args: {
    shiftId: v.id("shifts"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    await ctx.db.delete(args.shiftId);
    return args.shiftId;
  },
});

// Bulk delete shifts for a date
export const removeByDate = mutation({
  args: {
    date: v.string(),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const shifts = await ctx.db
      .query("shifts")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .collect();

    for (const shift of shifts) {
      await ctx.db.delete(shift._id);
    }

    return shifts.length;
  },
});

// ============ DAILY TASKS ============

// Get daily tasks for a date (optionally filter by department)
export const getDailyTasks = query({
  args: {
    date: v.string(),
    department: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
  },
  handler: async (ctx, args) => {
    if (args.department) {
      // Get tasks for specific department
      const tasks = await ctx.db
        .query("shiftDailyTasks")
        .withIndex("by_date_department", (q) =>
          q.eq("date", args.date).eq("department", args.department!)
        )
        .first();
      return tasks ? [tasks] : [];
    } else {
      // Get all tasks for the date
      const tasks = await ctx.db
        .query("shiftDailyTasks")
        .withIndex("by_date", (q) => q.eq("date", args.date))
        .collect();
      return tasks;
    }
  },
});

// Get all daily tasks grouped by department for a date
export const getDailyTasksByDate = query({
  args: {
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const tasks = await ctx.db
      .query("shiftDailyTasks")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .collect();

    // Return as a map of department -> tasks
    const tasksByDept: Record<string, { id: string; text: string; completed?: boolean }[]> = {};
    for (const task of tasks) {
      tasksByDept[task.department] = task.tasks;
    }
    return tasksByDept;
  },
});

// Add a single task to a department for a date
export const addDailyTask = mutation({
  args: {
    date: v.string(),
    department: v.string(),
    taskText: v.string(),
    locationId: v.optional(v.id("locations")),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const now = Date.now();
    const taskId = `task_${now}_${Math.random().toString(36).substr(2, 9)}`;

    // Check if record exists for this date/department
    const existing = await ctx.db
      .query("shiftDailyTasks")
      .withIndex("by_date_department", (q) =>
        q.eq("date", args.date).eq("department", args.department)
      )
      .first();

    if (existing) {
      // Add to existing tasks
      await ctx.db.patch(existing._id, {
        tasks: [...existing.tasks, { id: taskId, text: args.taskText }],
        updatedAt: now,
      });
      return existing._id;
    } else {
      // Create new record
      return await ctx.db.insert("shiftDailyTasks", {
        date: args.date,
        department: args.department,
        locationId: args.locationId,
        tasks: [{ id: taskId, text: args.taskText }],
        createdBy: args.userId,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

// Remove a task from a department
export const removeDailyTask = mutation({
  args: {
    date: v.string(),
    department: v.string(),
    taskId: v.string(),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const existing = await ctx.db
      .query("shiftDailyTasks")
      .withIndex("by_date_department", (q) =>
        q.eq("date", args.date).eq("department", args.department)
      )
      .first();

    if (!existing) {
      throw new Error("No tasks found for this date/department");
    }

    const updatedTasks = existing.tasks.filter((t) => t.id !== args.taskId);

    if (updatedTasks.length === 0) {
      // Delete the entire record if no tasks left
      await ctx.db.delete(existing._id);
    } else {
      await ctx.db.patch(existing._id, {
        tasks: updatedTasks,
        updatedAt: Date.now(),
      });
    }

    return { success: true };
  },
});

// Toggle task completion status
export const toggleDailyTaskComplete = mutation({
  args: {
    date: v.string(),
    department: v.string(),
    taskId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("shiftDailyTasks")
      .withIndex("by_date_department", (q) =>
        q.eq("date", args.date).eq("department", args.department)
      )
      .first();

    if (!existing) {
      throw new Error("No tasks found for this date/department");
    }

    const updatedTasks = existing.tasks.map((t) => {
      if (t.id === args.taskId) {
        return { ...t, completed: !t.completed };
      }
      return t;
    });

    await ctx.db.patch(existing._id, {
      tasks: updatedTasks,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Set all tasks for a department (replace)
export const setDailyTasks = mutation({
  args: {
    date: v.string(),
    department: v.string(),
    tasks: v.array(
      v.object({
        id: v.string(),
        text: v.string(),
        completed: v.optional(v.boolean()),
      })
    ),
    locationId: v.optional(v.id("locations")),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const now = Date.now();

    const existing = await ctx.db
      .query("shiftDailyTasks")
      .withIndex("by_date_department", (q) =>
        q.eq("date", args.date).eq("department", args.department)
      )
      .first();

    if (existing) {
      if (args.tasks.length === 0) {
        // Delete if no tasks
        await ctx.db.delete(existing._id);
        return null;
      }
      await ctx.db.patch(existing._id, {
        tasks: args.tasks,
        updatedAt: now,
      });
      return existing._id;
    } else if (args.tasks.length > 0) {
      return await ctx.db.insert("shiftDailyTasks", {
        date: args.date,
        department: args.department,
        locationId: args.locationId,
        tasks: args.tasks,
        createdBy: args.userId,
        createdAt: now,
        updatedAt: now,
      });
    }

    return null;
  },
});

// Get all unique departments from shifts (for department manager assignment)
export const getDepartments = query({
  handler: async (ctx) => {
    const shifts = await ctx.db.query("shifts").collect();
    const departments = [...new Set(shifts.map((s) => s.department))];

    // Include default departments even if no shifts exist yet
    const defaultDepartments = [
      "Shipping",
      "Receiving",
      "Inventory",
      "Purchases",
      "Janitorial",
      "Ecommerce",
      "Retail",
    ];

    // Combine and dedupe
    const allDepartments = [...new Set([...defaultDepartments, ...departments])];
    return allDepartments.sort();
  },
});
