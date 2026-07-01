import { v } from "convex/values";
import { query } from "./_generated/server";

// Personnel export data
export const getPersonnelExport = query({
  args: {},
  handler: async (ctx) => {
    const personnel = await ctx.db.query("personnel").collect();

    return personnel.map((p) => ({
      id: p._id,
      firstName: p.firstName,
      lastName: p.lastName,
      email: p.email,
      phone: p.phone,
      position: p.position,
      department: p.department,
      employeeType: p.employeeType,
      hireDate: p.hireDate,
      status: p.status,
      terminationDate: p.terminationDate || "",
      hourlyRate: p.hourlyRate || "",
      notes: p.notes || "",
    }));
  },
});

// Applications export data
export const getApplicationsExport = query({
  args: {
    status: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let applications = await ctx.db.query("applications").collect();

    // Filter by status
    if (args.status && args.status !== "all") {
      applications = applications.filter((a) => a.status === args.status);
    }

    // Filter by date range
    if (args.startDate) {
      const start = new Date(args.startDate).getTime();
      applications = applications.filter((a) => a.createdAt >= start);
    }
    if (args.endDate) {
      const end = new Date(args.endDate).getTime() + 86400000; // Include end date
      applications = applications.filter((a) => a.createdAt <= end);
    }

    return applications.map((a) => ({
      id: a._id,
      firstName: a.firstName,
      lastName: a.lastName,
      email: a.email,
      phone: a.phone,
      appliedJobTitle: a.appliedJobTitle || "",
      status: a.status,
      overallScore: a.candidateAnalysis?.overallScore || "",
      stabilityScore: a.candidateAnalysis?.stabilityScore || "",
      recommendedAction: a.candidateAnalysis?.recommendedAction || "",
      scheduledInterviewDate: a.scheduledInterviewDate || "",
      scheduledInterviewTime: a.scheduledInterviewTime || "",
      notes: a.notes || "",
      createdAt: new Date(a.createdAt).toISOString(),
    }));
  },
});

// Hiring analytics report
export const getHiringReport = query({
  args: {
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const start = args.startDate ? new Date(args.startDate).getTime() : undefined;
    const end = args.endDate ? new Date(args.endDate).getTime() + 86400000 : undefined;

    const applications = await ctx.db
      .query("applications")
      .withIndex("by_created", (q) => {
        if (start !== undefined && end !== undefined) {
          return q.gte("createdAt", start).lte("createdAt", end);
        } else if (start !== undefined) {
          return q.gte("createdAt", start);
        } else if (end !== undefined) {
          return q.lte("createdAt", end);
        }
        return q;
      })
      .collect();

    // Group by job title
    const byJob: Record<string, { total: number; hired: number; rejected: number; pending: number }> = {};

    for (const app of applications) {
      const jobTitle = app.appliedJobTitle || "Unknown";
      if (!byJob[jobTitle]) {
        byJob[jobTitle] = { total: 0, hired: 0, rejected: 0, pending: 0 };
      }
      byJob[jobTitle].total++;
      if (app.status === "hired") byJob[jobTitle].hired++;
      else if (app.status === "rejected") byJob[jobTitle].rejected++;
      else byJob[jobTitle].pending++;
    }

    // Calculate overall stats
    const total = applications.length;
    const hired = applications.filter((a) => a.status === "hired").length;
    const rejected = applications.filter((a) => a.status === "rejected").length;
    const interviewed = applications.filter((a) =>
      ["interview_scheduled", "interviewed", "hired", "rejected"].includes(a.status)
    ).length;

    // Calculate average scores
    const withScores = applications.filter((a) => a.candidateAnalysis?.overallScore);
    const avgScore = withScores.length
      ? Math.round(withScores.reduce((sum, a) => sum + (a.candidateAnalysis?.overallScore || 0), 0) / withScores.length)
      : 0;

    const hiredWithScores = applications.filter(
      (a) => a.status === "hired" && a.candidateAnalysis?.overallScore
    );
    const avgHiredScore = hiredWithScores.length
      ? Math.round(hiredWithScores.reduce((sum, a) => sum + (a.candidateAnalysis?.overallScore || 0), 0) / hiredWithScores.length)
      : 0;

    return {
      summary: {
        totalApplications: total,
        hired,
        rejected,
        interviewed,
        pending: total - hired - rejected,
        hireRate: total ? Math.round((hired / total) * 100) : 0,
        interviewRate: total ? Math.round((interviewed / total) * 100) : 0,
        avgScore,
        avgHiredScore,
      },
      byJob: Object.entries(byJob).map(([title, stats]) => ({
        jobTitle: title,
        ...stats,
        hireRate: stats.total ? Math.round((stats.hired / stats.total) * 100) : 0,
      })),
    };
  },
});

// Attendance report
export const getAttendanceReport = query({
  args: {
    personnelId: v.optional(v.id("personnel")),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    const attendance = args.personnelId
      ? await ctx.db
          .query("attendance")
          .withIndex("by_personnel_date", (q) =>
            q
              .eq("personnelId", args.personnelId!)
              .gte("date", args.startDate)
              .lte("date", args.endDate)
          )
          .collect()
      : await ctx.db
          .query("attendance")
          .withIndex("by_date", (q) =>
            q.gte("date", args.startDate).lte("date", args.endDate)
          )
          .collect();

    // Get personnel info
    const personnel = await ctx.db.query("personnel").collect();
    const personnelMap = new Map(personnel.map((p) => [p._id, `${p.firstName} ${p.lastName}`]));

    // Calculate stats per person
    const statsByPerson: Record<
      string,
      {
        name: string;
        present: number;
        absent: number;
        late: number;
        excused: number;
        noCallNoShow: number;
        totalHours: number;
      }
    > = {};

    for (const a of attendance) {
      const personId = a.personnelId;
      const name = personnelMap.get(personId) || "Unknown";

      if (!statsByPerson[personId]) {
        statsByPerson[personId] = {
          name,
          present: 0,
          absent: 0,
          late: 0,
          excused: 0,
          noCallNoShow: 0,
          totalHours: 0,
        };
      }

      const stats = statsByPerson[personId];
      switch (a.status) {
        case "present":
          stats.present++;
          break;
        case "absent":
          stats.absent++;
          break;
        case "late":
          stats.late++;
          break;
        case "excused":
          stats.excused++;
          break;
        case "no_call_no_show":
          stats.noCallNoShow++;
          break;
      }
      stats.totalHours += a.hoursWorked || 0;
    }

    return {
      records: attendance.map((a) => ({
        id: a._id,
        personnelId: a.personnelId,
        personnelName: personnelMap.get(a.personnelId) || "Unknown",
        date: a.date,
        status: a.status,
        scheduledStart: a.scheduledStart || "",
        scheduledEnd: a.scheduledEnd || "",
        actualStart: a.actualStart || "",
        actualEnd: a.actualEnd || "",
        hoursWorked: a.hoursWorked || 0,
        notes: a.notes || "",
      })),
      summary: Object.values(statsByPerson).map((s) => ({
        ...s,
        attendanceRate: s.present + s.late > 0
          ? Math.round(((s.present + s.late) / (s.present + s.late + s.absent + s.noCallNoShow)) * 100)
          : 0,
      })),
    };
  },
});

// Equipment report
export const getEquipmentReport = query({
  args: {},
  handler: async (ctx) => {
    const scanners = await ctx.db.query("scanners").collect();
    const pickers = await ctx.db.query("pickers").collect();
    const personnel = await ctx.db.query("personnel").collect();
    const locations = await ctx.db.query("locations").collect();

    const personnelMap = new Map(personnel.map((p) => [p._id, `${p.firstName} ${p.lastName}`]));
    const locationMap = new Map(locations.map((l) => [l._id, l.name]));

    const allEquipment = [
      ...scanners.map((s) => ({
        type: "Scanner",
        number: s.number,
        serialNumber: s.serialNumber || "",
        model: s.model || "",
        status: s.status,
        location: locationMap.get(s.locationId) || "",
        assignedTo: s.assignedTo ? personnelMap.get(s.assignedTo) || "" : "",
        lastMaintenance: s.lastMaintenanceDate || "",
        purchaseDate: s.purchaseDate || "",
        notes: s.notes || "",
      })),
      ...pickers.map((p) => ({
        type: "Picker",
        number: p.number,
        serialNumber: p.serialNumber || "",
        model: p.model || "",
        status: p.status,
        location: locationMap.get(p.locationId) || "",
        assignedTo: p.assignedTo ? personnelMap.get(p.assignedTo) || "" : "",
        lastMaintenance: p.lastMaintenanceDate || "",
        purchaseDate: p.purchaseDate || "",
        notes: p.notes || "",
      })),
    ];

    // Summary stats
    const summary = {
      totalScanners: scanners.length,
      scannersAvailable: scanners.filter((s) => s.status === "available").length,
      scannersAssigned: scanners.filter((s) => s.status === "assigned").length,
      scannersMaintenance: scanners.filter((s) => s.status === "maintenance").length,
      totalPickers: pickers.length,
      pickersAvailable: pickers.filter((p) => p.status === "available").length,
      pickersAssigned: pickers.filter((p) => p.status === "assigned").length,
      pickersMaintenance: pickers.filter((p) => p.status === "maintenance").length,
    };

    return { equipment: allEquipment, summary };
  },
});
