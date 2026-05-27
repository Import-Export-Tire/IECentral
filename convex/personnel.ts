import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireAdmin, requireManagePersonnel, requireRole } from "./authGuards";

// ============ QUERIES ============

// Get all personnel (with optional filters) - Updated with location filtering v2
export const list = query({
  args: {
    department: v.optional(v.string()),
    status: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
    locationIds: v.optional(v.array(v.id("locations"))),
  },
  handler: async (ctx, args) => {
    let personnel;

    if (args.department) {
      personnel = await ctx.db
        .query("personnel")
        .withIndex("by_department", (q) => q.eq("department", args.department!))
        .collect();
    } else if (args.status) {
      personnel = await ctx.db
        .query("personnel")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else {
      personnel = await ctx.db.query("personnel").collect();
    }

    // Filter by single locationId
    if (args.locationId) {
      personnel = personnel.filter(p => p.locationId === args.locationId);
    }

    // Filter by multiple locationIds (for managers with multiple locations)
    if (args.locationIds && args.locationIds.length > 0) {
      personnel = personnel.filter(p => p.locationId && args.locationIds!.includes(p.locationId as Id<"locations">));
    }

    return personnel.sort((a, b) => a.lastName.localeCompare(b.lastName));
  },
});

// Get single personnel by ID
export const getById = query({
  args: { personnelId: v.id("personnel") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.personnelId);
  },
});

// Get personnel with their stats (write-ups count, merits count, attendance stats)
export const getWithStats = query({
  args: { personnelId: v.id("personnel") },
  handler: async (ctx, args) => {
    const personnel = await ctx.db.get(args.personnelId);
    if (!personnel) return null;

    // Get write-ups count
    const writeUps = await ctx.db
      .query("writeUps")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .collect();

    // Get merits count
    const merits = await ctx.db
      .query("merits")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .collect();

    // Get attendance records for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0];

    const attendance = await ctx.db
      .query("attendance")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .collect();

    const recentAttendance = attendance.filter(
      (a) => a.date >= thirtyDaysAgoStr
    );
    const presentDays = recentAttendance.filter(
      (a) => a.status === "present"
    ).length;
    const lateDays = recentAttendance.filter((a) => a.status === "late").length;
    const absentDays = recentAttendance.filter(
      (a) => a.status === "absent" || a.status === "no_call_no_show"
    ).length;

    // Calculate active (non-deprecated) write-ups - those within the last 60 days
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const activeWriteUps = writeUps.filter((w) => {
      const writeUpDate = new Date(w.date);
      return writeUpDate >= sixtyDaysAgo;
    }).length;

    return {
      ...personnel,
      stats: {
        writeUpsCount: writeUps.length,
        activeWriteUps: activeWriteUps,
        meritsCount: merits.length,
        attendance: {
          presentDays,
          lateDays,
          absentDays,
          totalRecorded: recentAttendance.length,
        },
      },
    };
  },
});

// Get personnel by application ID (to check if already hired)
export const getByApplicationId = query({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    const personnel = await ctx.db
      .query("personnel")
      .filter((q) => q.eq(q.field("applicationId"), args.applicationId))
      .first();
    return personnel;
  },
});

// Get all departments (unique)
export const getDepartments = query({
  handler: async (ctx) => {
    const personnel = await ctx.db.query("personnel").collect();
    const departments = [...new Set(personnel.map((p) => p.department))];
    return departments.sort();
  },
});

// Get pending tenure check-ins (due or overdue)
export const getPendingTenureCheckIns = query({
  handler: async (ctx) => {
    const personnel = await ctx.db
      .query("personnel")
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    const milestones = [
      { key: "1_day", days: 1, label: "1 Day" },
      { key: "3_day", days: 3, label: "3 Day" },
      { key: "7_day", days: 7, label: "7 Day" },
      { key: "30_day", days: 30, label: "30 Day" },
      { key: "60_day", days: 60, label: "60 Day" },
    ];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pending: {
      personnelId: Id<"personnel">;
      personnelName: string;
      department: string;
      milestone: string;
      milestoneLabel: string;
      daysOverdue: number;
      hireDate: string;
    }[] = [];

    for (const person of personnel) {
      const hireDate = new Date(person.hireDate);
      hireDate.setHours(0, 0, 0, 0);
      const daysSinceHire = Math.floor((today.getTime() - hireDate.getTime()) / (1000 * 60 * 60 * 24));

      const completedMilestones = (person.tenureCheckIns || []).map((c: { milestone: string }) => c.milestone);

      for (const milestone of milestones) {
        // Check if milestone is due (employee has worked >= milestone days)
        // and hasn't been completed yet
        if (daysSinceHire >= milestone.days && !completedMilestones.includes(milestone.key)) {
          const daysOverdue = daysSinceHire - milestone.days;
          pending.push({
            personnelId: person._id,
            personnelName: `${person.firstName} ${person.lastName}`,
            department: person.department,
            milestone: milestone.key,
            milestoneLabel: milestone.label,
            daysOverdue,
            hireDate: person.hireDate,
          });
        }
      }
    }

    // Sort by most overdue first
    pending.sort((a, b) => b.daysOverdue - a.daysOverdue);

    return pending;
  },
});

// ============ MUTATIONS ============

// Create personnel from hired applicant
export const createFromApplication = mutation({
  args: {
    applicationId: v.id("applications"),
    position: v.string(),
    department: v.string(),
    employeeType: v.string(),
    hireDate: v.string(),
    hourlyRate: v.optional(v.number()),
    notes: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    defaultScheduleTemplateId: v.optional(v.id("shiftTemplates")),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);

    // Get the application data
    const application = await ctx.db.get(args.applicationId);
    if (!application) {
      throw new Error("Application not found");
    }

    // Check if personnel already exists for this application
    const existing = await ctx.db
      .query("personnel")
      .filter((q) => q.eq(q.field("applicationId"), args.applicationId))
      .first();

    if (existing) {
      throw new Error("Personnel record already exists for this application");
    }

    const now = Date.now();

    // Create the personnel record
    const personnelId = await ctx.db.insert("personnel", {
      firstName: application.firstName,
      lastName: application.lastName,
      email: application.email,
      phone: application.phone,
      applicationId: args.applicationId,
      position: args.position,
      department: args.department,
      employeeType: args.employeeType,
      hireDate: args.hireDate,
      hourlyRate: args.hourlyRate,
      status: "active",
      notes: args.notes,
      defaultScheduleTemplateId: args.defaultScheduleTemplateId,
      createdAt: now,
      updatedAt: now,
    });

    // Update the application status to "hired"
    await ctx.db.patch(args.applicationId, {
      status: "hired",
      updatedAt: now,
    });

    // Log the hire action
    if (args.userId) {
      const user = await ctx.db.get(args.userId);
      if (user) {
        await ctx.db.insert("auditLogs", {
          action: "Hired applicant",
          actionType: "create",
          resourceType: "personnel",
          resourceId: personnelId,
          userId: args.userId,
          userEmail: user.email || "unknown",
          details: `Hired ${application.firstName} ${application.lastName} as ${args.position}`,
          timestamp: now,
        });
      }
    }

    return personnelId;
  },
});

// Create personnel manually (not from application)
export const create = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    phone: v.string(),
    position: v.string(),
    department: v.string(),
    employeeType: v.string(),
    hireDate: v.string(),
    hourlyRate: v.optional(v.number()),
    locationId: v.optional(v.id("locations")),
    emergencyContact: v.optional(
      v.object({
        name: v.string(),
        phone: v.string(),
        relationship: v.string(),
      })
    ),
    notes: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const now = Date.now();

    const personnelId = await ctx.db.insert("personnel", {
      firstName: args.firstName,
      lastName: args.lastName,
      email: args.email,
      phone: args.phone,
      position: args.position,
      department: args.department,
      employeeType: args.employeeType,
      hireDate: args.hireDate,
      hourlyRate: args.hourlyRate,
      locationId: args.locationId,
      status: "active",
      emergencyContact: args.emergencyContact,
      notes: args.notes,
      createdAt: now,
      updatedAt: now,
    });

    // Log the creation
    if (args.userId) {
      const user = await ctx.db.get(args.userId);
      if (user) {
        await ctx.db.insert("auditLogs", {
          action: "Created personnel",
          actionType: "create",
          resourceType: "personnel",
          resourceId: personnelId,
          userId: args.userId,
          userEmail: user.email || "unknown",
          details: `Created personnel record for ${args.firstName} ${args.lastName}`,
          timestamp: now,
        });
      }
    }

    return personnelId;
  },
});

// Update personnel
export const update = mutation({
  args: {
    personnelId: v.id("personnel"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    position: v.optional(v.string()),
    department: v.optional(v.string()),
    employeeType: v.optional(v.string()),
    hireDate: v.optional(v.string()), // Only super_admin should be able to edit this
    hourlyRate: v.optional(v.number()),
    status: v.optional(v.string()),
    emergencyContact: v.optional(
      v.object({
        name: v.string(),
        phone: v.string(),
        relationship: v.string(),
      })
    ),
    notes: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
    defaultScheduleTemplateId: v.optional(v.id("shiftTemplates")),
    userId: v.optional(v.id("users")),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const { personnelId, userId, requestingUserId: _ignored, ...updates } = args;

    const existing = await ctx.db.get(personnelId);
    if (!existing) {
      throw new Error("Personnel not found");
    }

    // Build the update object with only defined values
    const now = Date.now();
    const updateData: Record<string, unknown> = { updatedAt: now };
    const changedFields: string[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        updateData[key] = value;
        // Track what changed for audit log
        if (key !== "userId" && existing[key as keyof typeof existing] !== value) {
          changedFields.push(key);
        }
      }
    }

    await ctx.db.patch(personnelId, updateData);

    // Sync changes to corresponding user account (for org chart updates)
    const updatedPersonnel = await ctx.db.get(personnelId);
    if (updatedPersonnel) {
      // Find user by email or personnelId link
      let linkedUser = await ctx.db
        .query("users")
        .withIndex("by_personnel", (q) => q.eq("personnelId", personnelId))
        .first();

      if (!linkedUser && updatedPersonnel.email) {
        linkedUser = await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", updatedPersonnel.email.toLowerCase()))
          .first();
      }

      if (linkedUser) {
        const userUpdates: Record<string, unknown> = {};

        // Sync name if firstName or lastName changed
        if (updates.firstName !== undefined || updates.lastName !== undefined) {
          const newName = `${updatedPersonnel.firstName} ${updatedPersonnel.lastName}`;
          if (linkedUser.name !== newName) {
            userUpdates.name = newName;
          }
        }

        // Sync location to managedLocationIds for warehouse managers
        if (updates.locationId !== undefined && linkedUser.role === "warehouse_manager") {
          const currentLocations = linkedUser.managedLocationIds || [];
          if (updates.locationId && !currentLocations.includes(updates.locationId)) {
            userUpdates.managedLocationIds = [...currentLocations, updates.locationId];
          }
        }

        // Sync department to managedDepartments for department managers
        if (updates.department !== undefined && linkedUser.role === "department_manager") {
          const currentDepts = linkedUser.managedDepartments || [];
          if (updates.department && !currentDepts.includes(updates.department)) {
            userUpdates.managedDepartments = [...currentDepts, updates.department];
          }
        }

        // Apply user updates if any
        if (Object.keys(userUpdates).length > 0) {
          await ctx.db.patch(linkedUser._id, userUpdates);
        }
      }
    }

    // Log the update
    if (userId && changedFields.length > 0) {
      const user = await ctx.db.get(userId);
      if (user) {
        await ctx.db.insert("auditLogs", {
          action: "Updated personnel",
          actionType: "update",
          resourceType: "personnel",
          resourceId: personnelId,
          userId: userId,
          userEmail: user.email || "unknown",
          details: `Updated ${existing.firstName} ${existing.lastName}: ${changedFields.join(", ")}`,
          timestamp: now,
        });
      }
    }

    return personnelId;
  },
});

// Set all tenure check-ins as complete for a single personnel
export const setAllTenureCheckInsComplete = mutation({
  args: {
    personnelId: v.id("personnel"),
    completedByName: v.string(),
    notes: v.optional(v.string()),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const personnel = await ctx.db.get(args.personnelId);
    if (!personnel) {
      throw new Error("Personnel not found");
    }

    const milestones = ["1_day", "3_day", "7_day", "30_day", "60_day"];
    const currentCheckIns = personnel.tenureCheckIns || [];
    const completedMilestones = currentCheckIns.map((c: { milestone: string }) => c.milestone);

    // Find missing milestones and create check-ins for them
    const newCheckIns = milestones
      .filter(m => !completedMilestones.includes(m))
      .map(milestone => ({
        milestone,
        completedAt: Date.now(),
        completedByName: args.completedByName,
        notes: args.notes,
      }));

    if (newCheckIns.length > 0) {
      await ctx.db.patch(args.personnelId, {
        tenureCheckIns: [...currentCheckIns, ...newCheckIns],
        updatedAt: Date.now(),
      });
    }

    return { added: newCheckIns.length };
  },
});

// Terminate personnel
export const terminate = mutation({
  args: {
    personnelId: v.id("personnel"),
    terminationDate: v.string(),
    terminationReason: v.string(),
    userId: v.optional(v.id("users")),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const existing = await ctx.db.get(args.personnelId);
    if (!existing) {
      throw new Error("Personnel not found");
    }

    const now = Date.now();
    await ctx.db.patch(args.personnelId, {
      status: "terminated",
      terminationDate: args.terminationDate,
      terminationReason: args.terminationReason,
      updatedAt: now,
    });

    // Check if this person has a user account (department_manager) and deactivate it
    const userAccount = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", existing.email.toLowerCase()))
      .first();

    if (userAccount && userAccount.role === "department_manager") {
      await ctx.db.patch(userAccount._id, {
        isActive: false,
      });

      // Log the user deactivation
      if (args.userId) {
        const adminUser = await ctx.db.get(args.userId);
        if (adminUser) {
          await ctx.db.insert("auditLogs", {
            action: "Deactivated department manager account",
            actionType: "update",
            resourceType: "user",
            resourceId: userAccount._id,
            userId: args.userId,
            userEmail: adminUser.email || "unknown",
            details: `Auto-deactivated user account for ${existing.firstName} ${existing.lastName} due to termination`,
            timestamp: now,
          });
        }
      }
    }

    // Log the termination
    if (args.userId) {
      const user = await ctx.db.get(args.userId);
      if (user) {
        await ctx.db.insert("auditLogs", {
          action: "Terminated personnel",
          actionType: "delete",
          resourceType: "personnel",
          resourceId: args.personnelId,
          userId: args.userId,
          userEmail: user.email || "unknown",
          details: `Terminated ${existing.firstName} ${existing.lastName}: ${args.terminationReason}`,
          timestamp: now,
        });
      }
    }

    // Create exit interview record and send survey email
    if (existing.email) {
      // Check if exit interview already exists
      const existingInterview = await ctx.db
        .query("exitInterviews")
        .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
        .first();

      let exitInterviewId: Id<"exitInterviews">;

      if (existingInterview) {
        exitInterviewId = existingInterview._id;
      } else {
        // Create new exit interview
        exitInterviewId = await ctx.db.insert("exitInterviews", {
          personnelId: args.personnelId,
          personnelName: `${existing.firstName} ${existing.lastName}`,
          department: existing.department,
          position: existing.position,
          hireDate: existing.hireDate,
          terminationDate: args.terminationDate,
          terminationReason: args.terminationReason,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        });
      }

      // Schedule email to be sent (slight delay to ensure DB write is complete)
      await ctx.scheduler.runAfter(1000, internal.emails.sendExitInterviewEmail, {
        employeeName: `${existing.firstName} ${existing.lastName}`,
        employeeEmail: existing.email,
        exitInterviewId: exitInterviewId,
        terminationDate: args.terminationDate,
        position: existing.position,
        department: existing.department,
      });
    }

    return args.personnelId;
  },
});

// Rehire a terminated employee
export const rehire = mutation({
  args: {
    personnelId: v.id("personnel"),
    rehireDate: v.string(), // YYYY-MM-DD
    position: v.string(),
    department: v.string(),
    employeeType: v.string(), // full_time, part_time, etc.
    hourlyRate: v.optional(v.number()),
    rehireReason: v.optional(v.string()),
    userId: v.id("users"), // Who authorized the rehire (also acts as requestingUserId)
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const existing = await ctx.db.get(args.personnelId);
    if (!existing) {
      throw new Error("Personnel not found");
    }

    if (existing.status !== "terminated") {
      throw new Error("Only terminated employees can be rehired");
    }

    const authorizedBy = await ctx.db.get(args.userId);
    if (!authorizedBy) {
      throw new Error("Authorizing user not found");
    }

    const now = Date.now();

    // Store previous termination info in employment history
    const employmentHistory = existing.employmentHistory || [];

    // Build terminated entry, only including defined values
    const terminatedEntry: {
      action: string;
      date: string;
      reason?: string;
      position?: string;
      department?: string;
    } = {
      action: "terminated",
      date: existing.terminationDate || new Date().toISOString().split("T")[0],
    };
    if (existing.terminationReason) terminatedEntry.reason = existing.terminationReason;
    if (existing.position) terminatedEntry.position = existing.position;
    if (existing.department) terminatedEntry.department = existing.department;
    employmentHistory.push(terminatedEntry);

    // Build rehire entry, only including defined values
    const rehireEntry: {
      action: string;
      date: string;
      reason?: string;
      position?: string;
      department?: string;
      authorizedBy?: string;
      authorizedById?: typeof args.userId;
    } = {
      action: "rehired",
      date: args.rehireDate,
      position: args.position,
      department: args.department,
      authorizedBy: authorizedBy.name,
      authorizedById: args.userId,
    };
    if (args.rehireReason) rehireEntry.reason = args.rehireReason;
    employmentHistory.push(rehireEntry);

    // Update personnel record
    await ctx.db.patch(args.personnelId, {
      status: "active",
      position: args.position,
      department: args.department,
      employeeType: args.employeeType,
      hourlyRate: args.hourlyRate,
      hireDate: args.rehireDate, // Update hire date to rehire date
      originalHireDate: existing.originalHireDate || existing.hireDate, // Preserve original hire date
      terminationDate: undefined,
      terminationReason: undefined,
      employmentHistory,
      rehiredAt: now,
      rehiredBy: args.userId,
      updatedAt: now,
    });

    // Reactivate user account if they had one
    const userAccount = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", existing.email.toLowerCase()))
      .first();

    if (userAccount && !userAccount.isActive) {
      await ctx.db.patch(userAccount._id, {
        isActive: true,
      });

      // Log user reactivation
      await ctx.db.insert("auditLogs", {
        action: "Reactivated user account",
        actionType: "update",
        resourceType: "user",
        resourceId: userAccount._id,
        userId: args.userId,
        userEmail: authorizedBy.email || "unknown",
        details: `Reactivated user account for ${existing.firstName} ${existing.lastName} due to rehire`,
        timestamp: now,
      });
    }

    // Log the rehire action
    await ctx.db.insert("auditLogs", {
      action: "Rehired personnel",
      actionType: "create",
      resourceType: "personnel",
      resourceId: args.personnelId,
      userId: args.userId,
      userEmail: authorizedBy.email || "unknown",
      details: `Rehired ${existing.firstName} ${existing.lastName} as ${args.position} in ${args.department}. Authorized by: ${authorizedBy.name}`,
      timestamp: now,
    });

    return args.personnelId;
  },
});

// Toggle training completion for a training area (with date tracking)
export const toggleTraining = mutation({
  args: {
    personnelId: v.id("personnel"),
    trainingArea: v.string(),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const personnel = await ctx.db.get(args.personnelId);
    if (!personnel) {
      throw new Error("Personnel not found");
    }

    // Use the new trainingRecords field
    const currentRecords = personnel.trainingRecords || [];
    let newRecords: { area: string; completedAt: number }[];

    // Also update legacy completedTraining field for backward compatibility
    const currentTraining = personnel.completedTraining || [];
    let newTraining: string[];

    const existingRecord = currentRecords.find((r) => r.area === args.trainingArea);

    if (existingRecord) {
      // Remove training
      newRecords = currentRecords.filter((r) => r.area !== args.trainingArea);
      newTraining = currentTraining.filter((t) => t !== args.trainingArea);
    } else {
      // Add training with current timestamp
      newRecords = [...currentRecords, { area: args.trainingArea, completedAt: Date.now() }];
      newTraining = [...currentTraining, args.trainingArea];
    }

    await ctx.db.patch(args.personnelId, {
      trainingRecords: newRecords,
      completedTraining: newTraining,
      updatedAt: Date.now(),
    });

    return args.personnelId;
  },
});

// Record a tenure milestone check-in
export const recordTenureCheckIn = mutation({
  args: {
    personnelId: v.id("personnel"),
    milestone: v.string(), // "1_day" | "3_day" | "7_day" | "30_day" | "60_day"
    completedBy: v.id("users"),
    completedByName: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.completedBy);
    const personnel = await ctx.db.get(args.personnelId);
    if (!personnel) {
      throw new Error("Personnel not found");
    }

    const validMilestones = ["1_day", "3_day", "7_day", "30_day", "60_day"];
    if (!validMilestones.includes(args.milestone)) {
      throw new Error("Invalid milestone. Must be one of: 1_day, 3_day, 7_day, 30_day, 60_day");
    }

    const currentCheckIns = personnel.tenureCheckIns || [];

    // Check if this milestone is already recorded
    const existingCheckIn = currentCheckIns.find((c) => c.milestone === args.milestone);
    if (existingCheckIn) {
      throw new Error(`${args.milestone} check-in has already been recorded`);
    }

    // Add the new check-in
    const newCheckIn = {
      milestone: args.milestone,
      completedAt: Date.now(),
      completedBy: args.completedBy,
      completedByName: args.completedByName,
      notes: args.notes,
    };

    await ctx.db.patch(args.personnelId, {
      tenureCheckIns: [...currentCheckIns, newCheckIn],
      updatedAt: Date.now(),
    });

    return args.personnelId;
  },
});

// Remove a tenure milestone check-in (in case of error)
export const removeTenureCheckIn = mutation({
  args: {
    personnelId: v.id("personnel"),
    milestone: v.string(),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const personnel = await ctx.db.get(args.personnelId);
    if (!personnel) {
      throw new Error("Personnel not found");
    }

    const currentCheckIns = personnel.tenureCheckIns || [];
    const newCheckIns = currentCheckIns.filter((c) => c.milestone !== args.milestone);

    await ctx.db.patch(args.personnelId, {
      tenureCheckIns: newCheckIns,
      updatedAt: Date.now(),
    });

    return args.personnelId;
  },
});

// Record a 90-day review for an employee
export const markNinetyDayReview = mutation({
  args: {
    personnelId: v.id("personnel"),
    completedBy: v.id("users"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.completedBy);
    const reviewer = await ctx.db.get(args.completedBy);
    if (!reviewer) throw new Error("Reviewer not found");
    const employee = await ctx.db.get(args.personnelId);
    if (!employee) throw new Error("Personnel not found");
    await ctx.db.patch(args.personnelId, {
      ninetyDayReview: {
        completedAt: Date.now(),
        completedBy: args.completedBy,
        completedByName: reviewer.name,
        notes: args.notes,
      },
      updatedAt: Date.now(),
    });
    return args.personnelId;
  },
});

// Clear a recorded 90-day review (admin correction)
export const clearNinetyDayReview = mutation({
  args: {
    personnelId: v.id("personnel"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    await ctx.db.patch(args.personnelId, {
      ninetyDayReview: undefined,
      updatedAt: Date.now(),
    });
    return args.personnelId;
  },
});

// Record an annual review for an employee. cycleYear is the calendar year
// of the anniversary the review covers (e.g. 2026 for an employee hired
// 2024-03-15 reviewing their 2026-03-15 anniversary).
export const markAnnualReview = mutation({
  args: {
    personnelId: v.id("personnel"),
    cycleYear: v.number(),
    completedBy: v.id("users"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.completedBy);
    const reviewer = await ctx.db.get(args.completedBy);
    if (!reviewer) throw new Error("Reviewer not found");
    const employee = await ctx.db.get(args.personnelId);
    if (!employee) throw new Error("Personnel not found");
    const existing = employee.annualReviews || [];
    const filtered = existing.filter((r) => r.cycleYear !== args.cycleYear);
    await ctx.db.patch(args.personnelId, {
      annualReviews: [
        ...filtered,
        {
          cycleYear: args.cycleYear,
          completedAt: Date.now(),
          completedBy: args.completedBy,
          completedByName: reviewer.name,
          notes: args.notes,
        },
      ],
      updatedAt: Date.now(),
    });
    return args.personnelId;
  },
});

// Remove the recorded annual review for a specific cycle year (admin correction)
export const clearAnnualReview = mutation({
  args: {
    personnelId: v.id("personnel"),
    cycleYear: v.number(),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const employee = await ctx.db.get(args.personnelId);
    if (!employee) throw new Error("Personnel not found");
    const existing = employee.annualReviews || [];
    await ctx.db.patch(args.personnelId, {
      annualReviews: existing.filter((r) => r.cycleYear !== args.cycleYear),
      updatedAt: Date.now(),
    });
    return args.personnelId;
  },
});

// Bulk mark all tenure check-ins complete for personnel hired before a date
export const bulkCompleteTenureCheckIns = mutation({
  args: {
    beforeDate: v.string(), // YYYY-MM-DD format
    completedByName: v.string(),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const allPersonnel = await ctx.db
      .query("personnel")
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    const milestones = ["1_day", "3_day", "7_day", "30_day", "60_day"];
    const cutoffDate = new Date(args.beforeDate);
    cutoffDate.setHours(0, 0, 0, 0);

    let updated = 0;
    const results: { name: string; milestonesAdded: number }[] = [];

    for (const person of allPersonnel) {
      const hireDate = new Date(person.hireDate);
      hireDate.setHours(0, 0, 0, 0);

      // Only process if hired before the cutoff date
      if (hireDate < cutoffDate) {
        const currentCheckIns = person.tenureCheckIns || [];
        const completedMilestones = currentCheckIns.map((c: { milestone: string }) => c.milestone);

        // Find milestones that aren't already completed
        const missingMilestones = milestones.filter(m => !completedMilestones.includes(m));

        if (missingMilestones.length > 0) {
          // Add all missing milestones
          const newCheckIns = missingMilestones.map(milestone => ({
            milestone,
            completedAt: Date.now(),
            completedByName: args.completedByName,
            notes: "Bulk completed for employees hired before " + args.beforeDate,
          }));

          await ctx.db.patch(person._id, {
            tenureCheckIns: [...currentCheckIns, ...newCheckIns],
            updatedAt: Date.now(),
          });

          updated++;
          results.push({
            name: `${person.firstName} ${person.lastName}`,
            milestonesAdded: missingMilestones.length,
          });
        }
      }
    }

    return { updated, results };
  },
});

// Clear all tenure check-ins from all personnel
export const clearAllTenureCheckIns = mutation({
  args: { requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const allPersonnel = await ctx.db.query("personnel").collect();

    let cleared = 0;
    for (const person of allPersonnel) {
      if (person.tenureCheckIns && person.tenureCheckIns.length > 0) {
        await ctx.db.patch(person._id, {
          tenureCheckIns: [],
          updatedAt: Date.now(),
        });
        cleared++;
      }
    }

    return { cleared, total: allPersonnel.length };
  },
});

// Remove duplicate personnel records (keeps the oldest by createdAt)
export const removeDuplicates = mutation({
  args: { requestingUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const allPersonnel = await ctx.db.query("personnel").collect();

    // Group by email (lowercase)
    const byEmail: Record<string, typeof allPersonnel> = {};
    for (const person of allPersonnel) {
      const email = person.email.toLowerCase();
      if (!byEmail[email]) {
        byEmail[email] = [];
      }
      byEmail[email].push(person);
    }

    let deleted = 0;
    for (const [email, records] of Object.entries(byEmail)) {
      if (records.length > 1) {
        // Sort by createdAt, keep the oldest
        records.sort((a, b) => a.createdAt - b.createdAt);
        // Delete all but the first (oldest)
        for (let i = 1; i < records.length; i++) {
          await ctx.db.delete(records[i]._id);
          deleted++;
        }
      }
    }

    return { deleted, remaining: allPersonnel.length - deleted };
  },
});

// Fully unset terminationDate + terminationReason on a personnel record.
// The standard `update` mutation skips undefined args and won't accept "" for
// these fields, so the only way to clear them is this dedicated mutation that
// passes `undefined` to ctx.db.patch (which Convex treats as field-removal).
export const clearTermination = mutation({
  args: {
    personnelId: v.id("personnel"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    await ctx.db.patch(args.personnelId, {
      terminationDate: undefined,
      terminationReason: undefined,
      updatedAt: Date.now(),
    });
    return args.personnelId;
  },
});

// Bulk upsert personnel: match by (firstName + lastName + hireDate); overwrite
// matched rows with the supplied values, insert new rows when no match. Used
// by the XLSX upload UI under /personnel/import.
export const bulkUpsert = mutation({
  args: {
    requestingUserId: v.id("users"),
    employees: v.array(
      v.object({
        firstName: v.string(),
        lastName: v.string(),
        hireDate: v.string(),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        position: v.optional(v.string()),
        department: v.optional(v.string()),
        employeeType: v.optional(v.string()),
        positionType: v.optional(v.string()),
        hourlyRate: v.optional(v.number()),
        status: v.optional(v.string()),
        terminationDate: v.optional(v.string()),
        terminationReason: v.optional(v.string()),
        notes: v.optional(v.string()),
        // Location is looked up by name (case-insensitive); pass the location's
        // display name (e.g. "R20" or "Akron Retail") and the mutation resolves it.
        locationName: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const now = Date.now();

    const allPersonnel = await ctx.db.query("personnel").collect();
    const locations = await ctx.db.query("locations").collect();

    const locByName = new Map<string, Id<"locations">>();
    for (const l of locations) {
      locByName.set(l.name.toLowerCase().trim(), l._id);
    }

    const keyFn = (fn: string, ln: string, hd: string) =>
      `${fn.trim().toLowerCase()}|${ln.trim().toLowerCase()}|${hd.trim()}`;
    const byKey = new Map<string, (typeof allPersonnel)[number]>();
    for (const p of allPersonnel) {
      byKey.set(keyFn(p.firstName, p.lastName, p.hireDate), p);
    }

    const results = {
      inserted: 0,
      updated: 0,
      errors: [] as { row: number; reason: string }[],
      unknownLocations: [] as string[],
    };

    for (let i = 0; i < args.employees.length; i++) {
      const e = args.employees[i];
      if (!e.firstName?.trim() || !e.lastName?.trim() || !e.hireDate?.trim()) {
        results.errors.push({ row: i, reason: "Missing firstName, lastName, or hireDate" });
        continue;
      }

      let locationId: Id<"locations"> | undefined;
      if (e.locationName?.trim()) {
        locationId = locByName.get(e.locationName.toLowerCase().trim());
        if (!locationId && !results.unknownLocations.includes(e.locationName)) {
          results.unknownLocations.push(e.locationName);
        }
      }

      const existing = byKey.get(keyFn(e.firstName, e.lastName, e.hireDate));

      if (existing) {
        const patch: Record<string, unknown> = { updatedAt: now };
        // Only patch fields the caller actually provided (undefined = leave alone)
        if (e.email !== undefined) patch.email = e.email.toLowerCase().trim();
        if (e.phone !== undefined) patch.phone = e.phone.trim();
        if (e.position !== undefined) patch.position = e.position.trim();
        if (e.department !== undefined) patch.department = e.department.trim();
        if (e.employeeType !== undefined) patch.employeeType = e.employeeType.trim();
        if (e.positionType !== undefined) patch.positionType = e.positionType.trim();
        if (e.hourlyRate !== undefined) patch.hourlyRate = e.hourlyRate;
        if (e.status !== undefined) patch.status = e.status.trim();
        if (e.terminationDate !== undefined) patch.terminationDate = e.terminationDate.trim();
        if (e.terminationReason !== undefined) patch.terminationReason = e.terminationReason.trim();
        if (e.notes !== undefined) patch.notes = e.notes.trim();
        if (locationId !== undefined) patch.locationId = locationId;
        await ctx.db.patch(existing._id, patch);
        results.updated++;
      } else {
        // Insert requires all base fields with reasonable defaults
        await ctx.db.insert("personnel", {
          firstName: e.firstName.trim(),
          lastName: e.lastName.trim(),
          email: (e.email || "").toLowerCase().trim(),
          phone: (e.phone || "").trim(),
          position: (e.position || "").trim(),
          department: (e.department || "").trim(),
          employeeType: (e.employeeType || "full_time").trim(),
          hireDate: e.hireDate.trim(),
          status: (e.status || "active").trim(),
          ...(e.positionType ? { positionType: e.positionType.trim() } : {}),
          ...(e.hourlyRate !== undefined ? { hourlyRate: e.hourlyRate } : {}),
          ...(locationId ? { locationId } : {}),
          ...(e.terminationDate ? { terminationDate: e.terminationDate.trim() } : {}),
          ...(e.terminationReason ? { terminationReason: e.terminationReason.trim() } : {}),
          ...(e.notes ? { notes: e.notes.trim() } : {}),
          createdAt: now,
          updatedAt: now,
        });
        results.inserted++;
      }
    }

    return results;
  },
});

// Bulk import personnel (skips duplicates by email)
export const bulkImport = mutation({
  args: {
    employees: v.array(
      v.object({
        firstName: v.string(),
        lastName: v.string(),
        email: v.string(),
        phone: v.string(),
        position: v.string(),
        department: v.string(),
        employeeType: v.string(),
        hireDate: v.string(),
      })
    ),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    const now = Date.now();
    const results = {
      imported: 0,
      skipped: 0,
      skippedEmails: [] as string[],
    };

    for (const employee of args.employees) {
      // Check if email already exists
      const existing = await ctx.db
        .query("personnel")
        .withIndex("by_email", (q) => q.eq("email", employee.email.toLowerCase()))
        .first();

      if (existing) {
        results.skipped++;
        results.skippedEmails.push(employee.email);
        continue;
      }

      // Create the personnel record
      await ctx.db.insert("personnel", {
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email.toLowerCase(),
        phone: employee.phone,
        position: employee.position,
        department: employee.department,
        employeeType: employee.employeeType,
        hireDate: employee.hireDate,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });

      results.imported++;
    }

    return results;
  },
});

// Delete personnel (hard delete - use with caution)
export const remove = mutation({
  args: {
    personnelId: v.id("personnel"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Super-admin only — hard delete cascades through write-ups,
    // attendance, merits, and reviews. Admins can Terminate (soft) but
    // shouldn't be able to destroy history.
    await requireRole(ctx, args.requestingUserId, ["super_admin"]);
    // Delete associated records first
    const writeUps = await ctx.db
      .query("writeUps")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .collect();
    for (const writeUp of writeUps) {
      await ctx.db.delete(writeUp._id);
    }

    const attendance = await ctx.db
      .query("attendance")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .collect();
    for (const record of attendance) {
      await ctx.db.delete(record._id);
    }

    const merits = await ctx.db
      .query("merits")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .collect();
    for (const merit of merits) {
      await ctx.db.delete(merit._id);
    }

    const reviews = await ctx.db
      .query("performanceReviews")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .collect();
    for (const review of reviews) {
      await ctx.db.delete(review._id);
    }

    // Finally delete the personnel record
    await ctx.db.delete(args.personnelId);

    return args.personnelId;
  },
});

// ============ RESUME & JOB MATCHING ============

// Search for personnel by email or name (used by bulk upload to find matches)
export const searchByEmailOrName = query({
  args: {
    email: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // First try email match (exact)
    if (args.email) {
      const byEmail = await ctx.db
        .query("personnel")
        .withIndex("by_email", (q) => q.eq("email", args.email!.toLowerCase()))
        .first();
      if (byEmail) return byEmail;
    }

    // If no email match, try name match
    if (args.firstName && args.lastName) {
      const allPersonnel = await ctx.db.query("personnel").collect();
      const nameMatch = allPersonnel.find(
        (p) =>
          p.firstName.toLowerCase() === args.firstName!.toLowerCase() &&
          p.lastName.toLowerCase() === args.lastName!.toLowerCase()
      );
      if (nameMatch) return nameMatch;
    }

    return null;
  },
});

// Update personnel resume text and AI analysis
export const updateResumeAndAnalysis = mutation({
  args: {
    personnelId: v.id("personnel"),
    resumeText: v.string(),
    jobMatchAnalysis: v.optional(v.object({
      suggestedPositions: v.array(v.object({
        jobId: v.optional(v.id("jobs")),
        jobTitle: v.string(),
        score: v.number(),
        matchedKeywords: v.array(v.string()),
        reasoning: v.string(),
      })),
      extractedSkills: v.array(v.string()),
      summary: v.string(),
      analyzedAt: v.number(),
    })),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.requestingUserId);
    const now = Date.now();

    await ctx.db.patch(args.personnelId, {
      resumeText: args.resumeText,
      resumeUpdatedAt: now,
      jobMatchAnalysis: args.jobMatchAnalysis,
      updatedAt: now,
    });

    return args.personnelId;
  },
});

// ============ PHONE CALL LOGS ============

// Log a phone call to a personnel member
export const logCall = mutation({
  args: {
    personnelId: v.id("personnel"),
    calledBy: v.id("users"),
    calledByName: v.string(),
    outcome: v.optional(v.string()), // "answered" | "no_answer" | "voicemail" | "busy" | "wrong_number"
    duration: v.optional(v.number()), // Duration in minutes
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.calledBy);
    const now = Date.now();

    const callLogId = await ctx.db.insert("personnelCallLogs", {
      personnelId: args.personnelId,
      calledAt: now,
      calledBy: args.calledBy,
      calledByName: args.calledByName,
      outcome: args.outcome,
      duration: args.duration,
      notes: args.notes,
      createdAt: now,
    });

    return callLogId;
  },
});

// Get call logs for a specific personnel member
export const getCallLogs = query({
  args: {
    personnelId: v.id("personnel"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query("personnelCallLogs")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .order("desc")
      .take(args.limit ?? 50);

    return logs;
  },
});

// Get recent call logs across all personnel (for activity feed)
export const getRecentCallLogs = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query("personnelCallLogs")
      .withIndex("by_called_at")
      .order("desc")
      .take(args.limit ?? 20);

    // Enrich with personnel info
    return await Promise.all(
      logs.map(async (log) => {
        const personnel = await ctx.db.get(log.personnelId);
        return {
          ...log,
          personnelName: personnel
            ? `${personnel.firstName} ${personnel.lastName}`
            : "Unknown",
          personnelPhone: personnel?.phone,
        };
      })
    );
  },
});

// Delete a call log (admin only)
export const deleteCallLog = mutation({
  args: {
    callLogId: v.id("personnelCallLogs"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.requestingUserId);
    await ctx.db.delete(args.callLogId);
    return { success: true };
  },
});

// ============ SCHEDULE ASSIGNMENT ============

// Update schedule assignment for an employee
export const updateScheduleAssignment = mutation({
  args: {
    personnelId: v.id("personnel"),
    defaultScheduleTemplateId: v.optional(v.id("shiftTemplates")),
    schedulePreferences: v.optional(v.object({
      maxHoursPerWeek: v.optional(v.number()),
      preferredShifts: v.optional(v.array(v.string())),
      unavailableDays: v.optional(v.array(v.string())),
      notes: v.optional(v.string()),
    })),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const { personnelId, userId, ...updates } = args;

    const existing = await ctx.db.get(personnelId);
    if (!existing) {
      throw new Error("Personnel not found");
    }

    const now = Date.now();
    const updateData: Record<string, unknown> = { updatedAt: now };

    if (updates.defaultScheduleTemplateId !== undefined) {
      updateData.defaultScheduleTemplateId = updates.defaultScheduleTemplateId;
    }

    if (updates.schedulePreferences !== undefined) {
      updateData.schedulePreferences = updates.schedulePreferences;
    }

    await ctx.db.patch(personnelId, updateData);

    // Log the update
    const user = await ctx.db.get(userId);
    await ctx.db.insert("auditLogs", {
      action: "Updated schedule assignment",
      actionType: "update",
      resourceType: "personnel",
      resourceId: personnelId,
      userId,
      userEmail: user?.email ?? "unknown",
      details: `Updated schedule for ${existing.firstName} ${existing.lastName}`,
      timestamp: now,
    });

    return personnelId;
  },
});

// Clear schedule assignment (remove from template)
export const clearScheduleAssignment = mutation({
  args: {
    personnelId: v.id("personnel"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const existing = await ctx.db.get(args.personnelId);
    if (!existing) {
      throw new Error("Personnel not found");
    }

    const now = Date.now();

    await ctx.db.patch(args.personnelId, {
      defaultScheduleTemplateId: undefined,
      updatedAt: now,
    });

    // Log the update
    const user = await ctx.db.get(args.userId);
    await ctx.db.insert("auditLogs", {
      action: "Cleared schedule assignment",
      actionType: "update",
      resourceType: "personnel",
      resourceId: args.personnelId,
      userId: args.userId,
      userEmail: user?.email ?? "unknown",
      details: `Cleared schedule for ${existing.firstName} ${existing.lastName}`,
      timestamp: now,
    });

    return args.personnelId;
  },
});

// Get employees by schedule template
export const getByScheduleTemplate = query({
  args: {
    templateId: v.id("shiftTemplates"),
  },
  handler: async (ctx, args) => {
    const personnel = await ctx.db
      .query("personnel")
      .withIndex("by_schedule_template", (q) => q.eq("defaultScheduleTemplateId", args.templateId))
      .collect();

    return personnel
      .filter((p) => p.status === "active")
      .sort((a, b) => a.lastName.localeCompare(b.lastName));
  },
});

// Bulk assign schedule template to multiple employees
export const bulkAssignSchedule = mutation({
  args: {
    personnelIds: v.array(v.id("personnel")),
    templateId: v.id("shiftTemplates"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const now = Date.now();
    const template = await ctx.db.get(args.templateId);
    if (!template) {
      throw new Error("Schedule template not found");
    }

    for (const personnelId of args.personnelIds) {
      await ctx.db.patch(personnelId, {
        defaultScheduleTemplateId: args.templateId,
        updatedAt: now,
      });
    }

    // Log the bulk update
    const user = await ctx.db.get(args.userId);
    await ctx.db.insert("auditLogs", {
      action: "Bulk schedule assignment",
      actionType: "update",
      resourceType: "personnel",
      resourceId: args.templateId,
      userId: args.userId,
      userEmail: user?.email ?? "unknown",
      details: `Assigned ${args.personnelIds.length} employees to schedule template "${template.name}"`,
      timestamp: now,
    });

    return { success: true, count: args.personnelIds.length };
  },
});

// ============ SCHEDULE OVERRIDES ============

// Get schedule overrides for a personnel
export const getScheduleOverrides = query({
  args: {
    personnelId: v.id("personnel"),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let overrides = await ctx.db
      .query("scheduleOverrides")
      .withIndex("by_personnel", (q) => q.eq("personnelId", args.personnelId))
      .collect();

    // Filter by date range if provided
    if (args.startDate) {
      overrides = overrides.filter((o) => o.date >= args.startDate!);
    }
    if (args.endDate) {
      overrides = overrides.filter((o) => o.date <= args.endDate!);
    }

    // Enrich with swap personnel name if applicable
    const enriched = await Promise.all(
      overrides.map(async (override) => {
        let swapWithName: string | undefined;
        if (override.swapWithPersonnelId) {
          const swapPerson = await ctx.db.get(override.swapWithPersonnelId);
          if (swapPerson) {
            swapWithName = `${swapPerson.firstName} ${swapPerson.lastName}`;
          }
        }
        return {
          ...override,
          swapWithName,
        };
      })
    );

    return enriched.sort((a, b) => a.date.localeCompare(b.date));
  },
});

// Get all pending schedule overrides (for approval)
export const getPendingScheduleOverrides = query({
  args: {},
  handler: async (ctx) => {
    const overrides = await ctx.db
      .query("scheduleOverrides")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    // Enrich with personnel names
    const enriched = await Promise.all(
      overrides.map(async (override) => {
        const personnel = await ctx.db.get(override.personnelId);
        let swapWithName: string | undefined;
        if (override.swapWithPersonnelId) {
          const swapPerson = await ctx.db.get(override.swapWithPersonnelId);
          if (swapPerson) {
            swapWithName = `${swapPerson.firstName} ${swapPerson.lastName}`;
          }
        }
        return {
          ...override,
          personnelName: personnel
            ? `${personnel.firstName} ${personnel.lastName}`
            : "Unknown",
          swapWithName,
        };
      })
    );

    return enriched.sort((a, b) => a.date.localeCompare(b.date));
  },
});

// Create a schedule override
export const createScheduleOverride = mutation({
  args: {
    personnelId: v.id("personnel"),
    date: v.string(),
    overrideType: v.string(), // "day_off" | "modified_hours" | "extra_shift" | "swap"
    startTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    swapWithPersonnelId: v.optional(v.id("personnel")),
    originalShiftId: v.optional(v.id("shifts")),
    reason: v.optional(v.string()),
    notes: v.optional(v.string()),
    autoApprove: v.optional(v.boolean()), // If admin creates it, auto-approve
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const now = Date.now();
    const personnel = await ctx.db.get(args.personnelId);
    if (!personnel) {
      throw new Error("Personnel not found");
    }

    // Validate override type
    const validTypes = ["day_off", "modified_hours", "extra_shift", "swap"];
    if (!validTypes.includes(args.overrideType)) {
      throw new Error(`Invalid override type: ${args.overrideType}`);
    }

    // For modified_hours and extra_shift, require times
    if (
      (args.overrideType === "modified_hours" ||
        args.overrideType === "extra_shift") &&
      (!args.startTime || !args.endTime)
    ) {
      throw new Error("Start and end times are required for this override type");
    }

    // For swap, require swap partner
    if (args.overrideType === "swap" && !args.swapWithPersonnelId) {
      throw new Error("Swap partner is required for swap overrides");
    }

    const status = args.autoApprove ? "approved" : "pending";

    const overrideId = await ctx.db.insert("scheduleOverrides", {
      personnelId: args.personnelId,
      date: args.date,
      overrideType: args.overrideType,
      startTime: args.startTime,
      endTime: args.endTime,
      swapWithPersonnelId: args.swapWithPersonnelId,
      originalShiftId: args.originalShiftId,
      status,
      reason: args.reason,
      requestedBy: args.autoApprove ? undefined : args.userId,
      approvedBy: args.autoApprove ? args.userId : undefined,
      approvedAt: args.autoApprove ? now : undefined,
      notes: args.notes,
      createdBy: args.userId,
      createdAt: now,
      updatedAt: now,
    });

    // Log the action
    const user = await ctx.db.get(args.userId);
    await ctx.db.insert("auditLogs", {
      action: `Schedule override created (${args.overrideType})`,
      actionType: "create",
      resourceType: "scheduleOverrides",
      resourceId: overrideId,
      userId: args.userId,
      userEmail: user?.email ?? "unknown",
      details: `Created ${args.overrideType} override for ${personnel.firstName} ${personnel.lastName} on ${args.date}`,
      timestamp: now,
    });

    return overrideId;
  },
});

// Approve a schedule override
export const approveScheduleOverride = mutation({
  args: {
    overrideId: v.id("scheduleOverrides"),
    userId: v.id("users"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const now = Date.now();
    const override = await ctx.db.get(args.overrideId);
    if (!override) {
      throw new Error("Override not found");
    }

    if (override.status !== "pending") {
      throw new Error("Only pending overrides can be approved");
    }

    await ctx.db.patch(args.overrideId, {
      status: "approved",
      approvedBy: args.userId,
      approvedAt: now,
      notes: args.notes ?? override.notes,
      updatedAt: now,
    });

    // Log the action
    const user = await ctx.db.get(args.userId);
    const personnel = await ctx.db.get(override.personnelId);
    await ctx.db.insert("auditLogs", {
      action: "Schedule override approved",
      actionType: "update",
      resourceType: "scheduleOverrides",
      resourceId: args.overrideId,
      userId: args.userId,
      userEmail: user?.email ?? "unknown",
      details: `Approved ${override.overrideType} override for ${personnel?.firstName ?? "Unknown"} ${personnel?.lastName ?? ""} on ${override.date}`,
      timestamp: now,
    });

    return { success: true };
  },
});

// Deny a schedule override
export const denyScheduleOverride = mutation({
  args: {
    overrideId: v.id("scheduleOverrides"),
    userId: v.id("users"),
    denialReason: v.string(),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const now = Date.now();
    const override = await ctx.db.get(args.overrideId);
    if (!override) {
      throw new Error("Override not found");
    }

    if (override.status !== "pending") {
      throw new Error("Only pending overrides can be denied");
    }

    await ctx.db.patch(args.overrideId, {
      status: "denied",
      approvedBy: args.userId,
      approvedAt: now,
      denialReason: args.denialReason,
      updatedAt: now,
    });

    // Log the action
    const user = await ctx.db.get(args.userId);
    const personnel = await ctx.db.get(override.personnelId);
    await ctx.db.insert("auditLogs", {
      action: "Schedule override denied",
      actionType: "update",
      resourceType: "scheduleOverrides",
      resourceId: args.overrideId,
      userId: args.userId,
      userEmail: user?.email ?? "unknown",
      details: `Denied ${override.overrideType} override for ${personnel?.firstName ?? "Unknown"} ${personnel?.lastName ?? ""} on ${override.date}. Reason: ${args.denialReason}`,
      timestamp: now,
    });

    return { success: true };
  },
});

// Delete a schedule override
export const deleteScheduleOverride = mutation({
  args: {
    overrideId: v.id("scheduleOverrides"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagePersonnel(ctx, args.userId);
    const now = Date.now();
    const override = await ctx.db.get(args.overrideId);
    if (!override) {
      throw new Error("Override not found");
    }

    await ctx.db.delete(args.overrideId);

    // Log the action
    const user = await ctx.db.get(args.userId);
    const personnel = await ctx.db.get(override.personnelId);
    await ctx.db.insert("auditLogs", {
      action: "Schedule override deleted",
      actionType: "delete",
      resourceType: "scheduleOverrides",
      resourceId: args.overrideId,
      userId: args.userId,
      userEmail: user?.email ?? "unknown",
      details: `Deleted ${override.overrideType} override for ${personnel?.firstName ?? "Unknown"} ${personnel?.lastName ?? ""} on ${override.date}`,
      timestamp: now,
    });

    return { success: true };
  },
});
