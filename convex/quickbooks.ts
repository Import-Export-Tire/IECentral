import { v } from "convex/values";
import { mutation, query, action, internalQuery } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// ============ QBWC SESSION MANAGEMENT ============
// Persistent session storage for serverless environments (AWS Amplify)

export const createQbwcSession = mutation({
  args: {
    ticket: v.string(),
    username: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("qbwcSessions", {
      ticket: args.ticket,
      username: args.username,
      companyFile: "",
      requestCount: 0,
      lastRequest: null,
      createdAt: now,
      expiresAt: now + 30 * 60 * 1000, // 30 minute expiry
    });
  },
});

export const getQbwcSession = query({
  args: { ticket: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("qbwcSessions")
      .withIndex("by_ticket", (q) => q.eq("ticket", args.ticket))
      .first();
    if (!session || session.expiresAt < Date.now()) return null;
    return session;
  },
});

export const updateQbwcSession = mutation({
  args: {
    ticket: v.string(),
    companyFile: v.optional(v.string()),
    requestCount: v.optional(v.number()),
    lastRequest: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("qbwcSessions")
      .withIndex("by_ticket", (q) => q.eq("ticket", args.ticket))
      .first();
    if (!session) return;
    const updates: Record<string, unknown> = {};
    if (args.companyFile !== undefined) updates.companyFile = args.companyFile;
    if (args.requestCount !== undefined) updates.requestCount = args.requestCount;
    if (args.lastRequest !== undefined) updates.lastRequest = args.lastRequest;
    await ctx.db.patch(session._id, updates);
  },
});

export const deleteQbwcSession = mutation({
  args: { ticket: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("qbwcSessions")
      .withIndex("by_ticket", (q) => q.eq("ticket", args.ticket))
      .first();
    if (session) await ctx.db.delete(session._id);
  },
});

// ============ CONNECTION MANAGEMENT ============

// Get the current QuickBooks connection
export const getConnection = query({
  args: {},
  handler: async (ctx) => {
    const connection = await ctx.db
      .query("qbConnection")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .first();
    return connection;
  },
});

// Create or update QuickBooks connection
export const saveConnection = mutation({
  args: {
    companyName: v.string(),
    wcUsername: v.string(),
    wcPassword: v.string(),
    syncTimeEntries: v.boolean(),
    syncPayStubs: v.boolean(),
    syncEmployees: v.boolean(),
    autoSyncEnabled: v.boolean(),
    syncIntervalMinutes: v.number(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("qbConnection")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        companyName: args.companyName,
        wcUsername: args.wcUsername,
        wcPassword: args.wcPassword,
        syncTimeEntries: args.syncTimeEntries,
        syncPayStubs: args.syncPayStubs,
        syncEmployees: args.syncEmployees,
        autoSyncEnabled: args.autoSyncEnabled,
        syncIntervalMinutes: args.syncIntervalMinutes,
        updatedAt: now,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("qbConnection", {
        companyName: args.companyName,
        wcUsername: args.wcUsername,
        wcPassword: args.wcPassword,
        isActive: true,
        syncTimeEntries: args.syncTimeEntries,
        syncPayStubs: args.syncPayStubs,
        syncEmployees: args.syncEmployees,
        autoSyncEnabled: args.autoSyncEnabled,
        syncIntervalMinutes: args.syncIntervalMinutes,
        connectionStatus: "pending",
        createdBy: args.userId,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

// Update connection status (called by Web Connector handler)
export const updateConnectionStatus = mutation({
  args: {
    status: v.string(),
    qbVersion: v.optional(v.string()),
    companyId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("qbConnection")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .first();

    if (!connection) return null;

    const now = Date.now();
    await ctx.db.patch(connection._id, {
      connectionStatus: args.status,
      qbVersion: args.qbVersion,
      companyId: args.companyId,
      lastConnectedAt: args.status === "connected" ? now : connection.lastConnectedAt,
      lastError: args.error,
      lastErrorAt: args.error ? now : undefined,
      updatedAt: now,
    });

    return connection._id;
  },
});

// ============ EMPLOYEE MAPPING ============

// Get all employee mappings with personnel info
export const getEmployeeMappings = query({
  args: {},
  handler: async (ctx) => {
    const mappings = await ctx.db.query("qbEmployeeMapping").collect();

    const result = await Promise.all(
      mappings.map(async (mapping) => {
        const personnel = await ctx.db.get(mapping.personnelId);
        return {
          ...mapping,
          personnel,
        };
      })
    );

    return result;
  },
});

// Get unmapped personnel (not yet linked to QB)
export const getUnmappedPersonnel = query({
  args: {},
  handler: async (ctx) => {
    const allPersonnel = await ctx.db
      .query("personnel")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    const mappings = await ctx.db.query("qbEmployeeMapping").collect();
    const mappedIds = new Set(mappings.map((m) => m.personnelId));

    return allPersonnel.filter((p) => !mappedIds.has(p._id) && p.employeeType !== "temp");
  },
});

// Create employee mapping
export const createEmployeeMapping = mutation({
  args: {
    personnelId: v.id("personnel"),
    qbListId: v.string(),
    qbName: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("qbEmployeeMapping", {
      personnelId: args.personnelId,
      qbListId: args.qbListId,
      qbName: args.qbName,
      isActive: true,
      isSynced: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update employee mapping
export const updateEmployeeMapping = mutation({
  args: {
    mappingId: v.id("qbEmployeeMapping"),
    qbListId: v.optional(v.string()),
    qbName: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    isSynced: v.optional(v.boolean()),
    syncError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { mappingId, ...updates } = args;
    await ctx.db.patch(mappingId, {
      ...updates,
      updatedAt: Date.now(),
      lastSyncedAt: args.isSynced ? Date.now() : undefined,
    });
  },
});

// Delete employee mapping
export const deleteEmployeeMapping = mutation({
  args: { mappingId: v.id("qbEmployeeMapping") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.mappingId);
  },
});

// ============ SYNC QUEUE MANAGEMENT ============

// Add item to sync queue
export const addToSyncQueue = mutation({
  args: {
    type: v.string(),
    action: v.string(),
    referenceId: v.string(),
    referenceType: v.string(),
    priority: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Check if already in queue
    const existing = await ctx.db
      .query("qbSyncQueue")
      .withIndex("by_reference", (q) =>
        q.eq("referenceType", args.referenceType).eq("referenceId", args.referenceId)
      )
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();

    if (existing) return existing._id;

    return await ctx.db.insert("qbSyncQueue", {
      type: args.type,
      action: args.action,
      referenceId: args.referenceId,
      referenceType: args.referenceType,
      status: "pending",
      priority: args.priority || 10,
      attempts: 0,
      maxAttempts: 3,
      createdAt: Date.now(),
    });
  },
});

// Get pending sync items
export const getPendingSyncItems = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("qbSyncQueue")
      .withIndex("by_status_priority", (q) => q.eq("status", "pending"))
      .take(args.limit || 50);
    return items;
  },
});

// Update sync queue item status
export const updateSyncQueueItem = mutation({
  args: {
    itemId: v.id("qbSyncQueue"),
    status: v.string(),
    qbRequestXml: v.optional(v.string()),
    qbResponseXml: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return;

    const updates: Record<string, unknown> = {
      status: args.status,
      lastAttemptAt: Date.now(),
    };

    if (args.qbRequestXml) updates.qbRequestXml = args.qbRequestXml;
    if (args.qbResponseXml) updates.qbResponseXml = args.qbResponseXml;
    if (args.errorMessage) updates.errorMessage = args.errorMessage;
    if (args.status === "completed") updates.completedAt = Date.now();
    if (args.status === "failed" || args.status === "processing") {
      updates.attempts = item.attempts + 1;
    }

    await ctx.db.patch(args.itemId, updates);
  },
});

// ============ SYNC LOGGING ============

// Create sync log entry
export const createSyncLog = mutation({
  args: {
    sessionId: v.string(),
    operation: v.string(),
    direction: v.string(),
    recordType: v.optional(v.string()),
    recordId: v.optional(v.string()),
    recordCount: v.optional(v.number()),
    status: v.string(),
    message: v.optional(v.string()),
    errorDetails: v.optional(v.string()),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("qbSyncLog", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

// Get recent sync logs
export const getSyncLogs = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("qbSyncLog")
      .withIndex("by_created")
      .order("desc")
      .take(args.limit || 50);
  },
});

// ============ TIME EXPORT MANAGEMENT ============

// Get pending time exports
export const getPendingTimeExports = query({
  args: {},
  handler: async (ctx) => {
    const exports = await ctx.db
      .query("qbPendingTimeExport")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    const result = await Promise.all(
      exports.map(async (exp) => {
        const personnel = await ctx.db.get(exp.personnelId);
        const mapping = await ctx.db
          .query("qbEmployeeMapping")
          .withIndex("by_personnel", (q) => q.eq("personnelId", exp.personnelId))
          .first();
        return {
          ...exp,
          personnel,
          qbMapping: mapping,
        };
      })
    );

    return result;
  },
});

// Calculate and create pending time exports for a date range
// NOTE: This now requires the pay period to be LOCKED before exports can be created
export const calculatePendingTimeExports = mutation({
  args: {
    weekStartDate: v.string(), // YYYY-MM-DD (should be Sunday)
    payPeriodStart: v.optional(v.string()), // If provided, check approval status
  },
  handler: async (ctx, args) => {
    // Check if the pay period is approved/locked (required before QB export)
    if (args.payPeriodStart) {
      const approval = await ctx.db
        .query("timesheetApprovals")
        .withIndex("by_pay_period", (q) => q.eq("payPeriodStart", args.payPeriodStart!))
        .first();

      if (!approval || approval.status !== "locked") {
        throw new Error("Pay period must be locked before exporting to QuickBooks. Please lock the pay period first.");
      }
    }

    // Get all active personnel with QB mappings
    const mappings = await ctx.db.query("qbEmployeeMapping").collect();
    const personnelIds = mappings.map((m) => m.personnelId);

    // Calculate week end date (Saturday)
    const startDate = new Date(args.weekStartDate + "T00:00:00");
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
    const weekEndDate = endDate.toISOString().split("T")[0];

    const created: Id<"qbPendingTimeExport">[] = [];

    for (const personnelId of personnelIds) {
      // Check if already exists
      const existing = await ctx.db
        .query("qbPendingTimeExport")
        .withIndex("by_personnel_week", (q) =>
          q.eq("personnelId", personnelId).eq("weekStartDate", args.weekStartDate)
        )
        .first();

      if (existing) continue;

      // Get time entries for this week
      const entries = await ctx.db
        .query("timeEntries")
        .withIndex("by_personnel", (q) => q.eq("personnelId", personnelId))
        .filter((q) =>
          q.and(
            q.gte(q.field("date"), args.weekStartDate),
            q.lte(q.field("date"), weekEndDate)
          )
        )
        .collect();

      if (entries.length === 0) continue;

      // Calculate hours from clock in/out pairs
      let totalMinutes = 0;
      const entriesByDate: Record<string, typeof entries> = {};

      for (const entry of entries) {
        if (!entriesByDate[entry.date]) entriesByDate[entry.date] = [];
        entriesByDate[entry.date].push(entry);
      }

      for (const date in entriesByDate) {
        const dayEntries = entriesByDate[date].sort((a, b) => a.timestamp - b.timestamp);
        let clockIn: number | null = null;
        let breakStart: number | null = null;
        let breakMinutes = 0;

        for (const entry of dayEntries) {
          if (entry.type === "clock_in") {
            clockIn = entry.timestamp;
          } else if (entry.type === "break_start" && clockIn) {
            breakStart = entry.timestamp;
          } else if (entry.type === "break_end" && breakStart) {
            breakMinutes += (entry.timestamp - breakStart) / 60000;
            breakStart = null;
          } else if (entry.type === "clock_out" && clockIn) {
            const workMinutes = (entry.timestamp - clockIn) / 60000 - breakMinutes;
            totalMinutes += Math.max(0, workMinutes);
            clockIn = null;
            breakMinutes = 0;
          }
        }
      }

      const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
      const regularHours = Math.min(totalHours, 40);
      const overtimeHours = Math.max(0, totalHours - 40);

      const now = Date.now();
      const id = await ctx.db.insert("qbPendingTimeExport", {
        personnelId,
        weekStartDate: args.weekStartDate,
        weekEndDate,
        totalHours,
        regularHours,
        overtimeHours,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });

      created.push(id);
    }

    return created;
  },
});

// Approve time export
export const approveTimeExport = mutation({
  args: {
    exportId: v.id("qbPendingTimeExport"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.exportId, {
      status: "approved",
      approvedBy: args.userId,
      approvedAt: now,
      updatedAt: now,
    });

    // Add to sync queue
    const exp = await ctx.db.get(args.exportId);
    if (exp) {
      await ctx.db.insert("qbSyncQueue", {
        type: "time_entry",
        action: "add",
        referenceId: args.exportId,
        referenceType: "qbPendingTimeExport",
        status: "pending",
        priority: 5,
        attempts: 0,
        maxAttempts: 3,
        createdAt: now,
      });
    }
  },
});

// Mark export as completed
export const markExportCompleted = mutation({
  args: {
    exportId: v.id("qbPendingTimeExport"),
    qbTxnId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.exportId, {
      status: "exported",
      exportedAt: now,
      qbTxnId: args.qbTxnId,
      updatedAt: now,
    });
  },
});

// ============ QBXML GENERATION ============

// Generate QWC file content.
// SECURITY: internalQuery — the .qwc payload embeds the QBWC username/password,
// so this must never be a public (client-callable) query. No app callers.
export const generateQwcFile = internalQuery({
  args: {
    appUrl: v.string(), // The URL where the SOAP service is hosted
    appName: v.string(),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("qbConnection")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .first();

    if (!connection) return null;

    // Generate a unique file ID
    const fileId = `{${crypto.randomUUID().toUpperCase()}}`;
    const ownerId = `{${crypto.randomUUID().toUpperCase()}}`;

    const qwcContent = `<?xml version="1.0"?>
<QBWCXML>
  <AppName>${args.appName}</AppName>
  <AppID></AppID>
  <AppURL>${args.appUrl}/api/qbwc</AppURL>
  <AppDescription>IE Central - QuickBooks Time &amp; Payroll Sync</AppDescription>
  <AppSupport>${args.appUrl}/support</AppSupport>
  <UserName>${connection.wcUsername}</UserName>
  <OwnerID>${ownerId}</OwnerID>
  <FileID>${fileId}</FileID>
  <QBType>QBFS</QBType>
  <Scheduler>
    <RunEveryNMinutes>${connection.syncIntervalMinutes}</RunEveryNMinutes>
  </Scheduler>
  <IsReadOnly>false</IsReadOnly>
</QBWCXML>`;

    return {
      content: qwcContent,
      fileName: `${args.appName.replace(/\s+/g, "_")}.qwc`,
      username: connection.wcUsername,
      password: connection.wcPassword,
    };
  },
});

// Generate TimeTracking Add QBXML request
export const generateTimeTrackingAddXml = query({
  args: {
    exportId: v.id("qbPendingTimeExport"),
  },
  handler: async (ctx, args) => {
    const exp = await ctx.db.get(args.exportId);
    if (!exp) return null;

    const mapping = await ctx.db
      .query("qbEmployeeMapping")
      .withIndex("by_personnel", (q) => q.eq("personnelId", exp.personnelId))
      .first();

    if (!mapping) return null;

    // Format date for QBXML (YYYY-MM-DD)
    const txnDate = exp.weekEndDate; // Use end of week as transaction date

    // Convert hours to duration format (PT#H#M)
    const hours = Math.floor(exp.totalHours);
    const minutes = Math.round((exp.totalHours - hours) * 60);
    const duration = `PT${hours}H${minutes}M`;

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <TimeTrackingAddRq>
      <TimeTrackingAdd>
        <TxnDate>${txnDate}</TxnDate>
        <EntityRef>
          <ListID>${mapping.qbListId}</ListID>
        </EntityRef>
        <Duration>${duration}</Duration>
        <Notes>Week of ${exp.weekStartDate} - Synced from IE Central</Notes>
      </TimeTrackingAdd>
    </TimeTrackingAddRq>
  </QBXMLMsgsRq>
</QBXML>`;

    return xml;
  },
});

// Generate Employee Query QBXML
export const generateEmployeeQueryXml = query({
  args: {},
  handler: async () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXML>
  <QBXMLMsgsRq onError="continueOnError">
    <EmployeeQueryRq>
      <ActiveStatus>ActiveOnly</ActiveStatus>
    </EmployeeQueryRq>
  </QBXMLMsgsRq>
</QBXML>`;

    return xml;
  },
});

// Generate Paycheck Query QBXML
export const generatePaycheckQueryXml = query({
  args: {
    fromDate: v.string(), // YYYY-MM-DD
    toDate: v.string(), // YYYY-MM-DD
  },
  handler: async (ctx, args) => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXML>
  <QBXMLMsgsRq onError="continueOnError">
    <PaycheckQueryRq>
      <TxnDateRangeFilter>
        <FromTxnDate>${args.fromDate}</FromTxnDate>
        <ToTxnDate>${args.toDate}</ToTxnDate>
      </TxnDateRangeFilter>
      <IncludeLineItems>true</IncludeLineItems>
    </PaycheckQueryRq>
  </QBXMLMsgsRq>
</QBXML>`;

    return xml;
  },
});

// ============ SYNC STATS ============

// Get sync dashboard stats
export const getSyncStats = query({
  args: {},
  handler: async (ctx) => {
    const connection = await ctx.db
      .query("qbConnection")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .first();

    const pendingQueue = await ctx.db
      .query("qbSyncQueue")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    const failedQueue = await ctx.db
      .query("qbSyncQueue")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .collect();

    const pendingExports = await ctx.db
      .query("qbPendingTimeExport")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    const approvedExports = await ctx.db
      .query("qbPendingTimeExport")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();

    const mappings = await ctx.db.query("qbEmployeeMapping").collect();
    const activePersonnel = (await ctx.db
      .query("personnel")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect()).filter((p) => p.employeeType !== "temp");

    const recentLogs = await ctx.db
      .query("qbSyncLog")
      .withIndex("by_created")
      .order("desc")
      .take(10);

    return {
      connection: connection
        ? {
            companyName: connection.companyName,
            status: connection.connectionStatus,
            lastSync: connection.lastSyncAt,
            lastConnected: connection.lastConnectedAt,
            lastError: connection.lastError,
          }
        : null,
      queue: {
        pending: pendingQueue.length,
        failed: failedQueue.length,
      },
      exports: {
        pending: pendingExports.length,
        approved: approvedExports.length,
        totalPendingHours: pendingExports.reduce((sum, e) => sum + e.totalHours, 0),
        totalApprovedHours: approvedExports.reduce((sum, e) => sum + e.totalHours, 0),
      },
      mappings: {
        total: mappings.length,
        unmapped: activePersonnel.length - mappings.length,
      },
      recentLogs,
    };
  },
});

// ============ PAY PERIOD EXPORT ============

// Get pay periods that are ready to export (locked but not yet exported to QB)
export const getExportablePayPeriods = query({
  args: {},
  handler: async (ctx) => {
    const approvals = await ctx.db
      .query("timesheetApprovals")
      .withIndex("by_status", (q) => q.eq("status", "locked"))
      .collect();

    // Filter to those not yet exported
    const exportable = approvals.filter((a) => !a.exportedToQB);

    return exportable.map((a) => ({
      payPeriodStart: a.payPeriodStart,
      payPeriodEnd: a.payPeriodEnd,
      totalEmployees: a.totalEmployees,
      totalHours: a.totalHours,
      lockedAt: a.lockedAt,
    }));
  },
});

// Export an entire locked pay period to QuickBooks queue
export const exportPayPeriodToQB = mutation({
  args: {
    payPeriodStart: v.string(),
    payPeriodEnd: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Verify pay period is locked
    const approval = await ctx.db
      .query("timesheetApprovals")
      .withIndex("by_pay_period", (q) => q.eq("payPeriodStart", args.payPeriodStart))
      .first();

    if (!approval) {
      throw new Error("Pay period not found");
    }

    if (approval.status !== "locked") {
      throw new Error("Pay period must be locked before exporting to QuickBooks");
    }

    if (approval.exportedToQB) {
      throw new Error("Pay period has already been exported to QuickBooks");
    }

    // Get all active personnel with QB mappings
    const mappings = await ctx.db.query("qbEmployeeMapping").collect();
    const personnelIds = mappings.map((m) => m.personnelId);

    const now = Date.now();
    const created: Id<"qbPendingTimeExport">[] = [];

    for (const personnelId of personnelIds) {
      // Check if already exists
      const existing = await ctx.db
        .query("qbPendingTimeExport")
        .withIndex("by_personnel_week", (q) =>
          q.eq("personnelId", personnelId).eq("weekStartDate", args.payPeriodStart)
        )
        .first();

      if (existing) continue;

      // Get time entries for this pay period
      const entries = await ctx.db
        .query("timeEntries")
        .withIndex("by_personnel", (q) => q.eq("personnelId", personnelId))
        .filter((q) =>
          q.and(
            q.gte(q.field("date"), args.payPeriodStart),
            q.lte(q.field("date"), args.payPeriodEnd)
          )
        )
        .collect();

      if (entries.length === 0) continue;

      // Calculate hours from clock in/out pairs
      let totalMinutes = 0;
      const entriesByDate: Record<string, typeof entries> = {};

      for (const entry of entries) {
        if (!entriesByDate[entry.date]) entriesByDate[entry.date] = [];
        entriesByDate[entry.date].push(entry);
      }

      for (const date in entriesByDate) {
        const dayEntries = entriesByDate[date].sort((a, b) => a.timestamp - b.timestamp);
        let clockIn: number | null = null;
        let breakStart: number | null = null;
        let breakMinutes = 0;

        for (const entry of dayEntries) {
          if (entry.type === "clock_in") {
            clockIn = entry.timestamp;
          } else if (entry.type === "break_start" && clockIn) {
            breakStart = entry.timestamp;
          } else if (entry.type === "break_end" && breakStart) {
            breakMinutes += (entry.timestamp - breakStart) / 60000;
            breakStart = null;
          } else if (entry.type === "clock_out" && clockIn) {
            const workMinutes = (entry.timestamp - clockIn) / 60000 - breakMinutes;
            totalMinutes += Math.max(0, workMinutes);
            clockIn = null;
            breakMinutes = 0;
          }
        }
      }

      const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
      const regularHours = Math.min(totalHours, 40);
      const overtimeHours = Math.max(0, totalHours - 40);

      if (totalHours > 0) {
        const id = await ctx.db.insert("qbPendingTimeExport", {
          personnelId,
          weekStartDate: args.payPeriodStart,
          weekEndDate: args.payPeriodEnd,
          totalHours,
          regularHours,
          overtimeHours,
          status: "approved", // Auto-approve since pay period is locked
          approvedBy: args.userId,
          approvedAt: now,
          createdAt: now,
          updatedAt: now,
        });

        // Add to sync queue
        await ctx.db.insert("qbSyncQueue", {
          type: "time_entry",
          action: "add",
          referenceId: id,
          referenceType: "qbPendingTimeExport",
          status: "pending",
          priority: 5,
          attempts: 0,
          maxAttempts: 3,
          createdAt: now,
        });

        created.push(id);
      }
    }

    // Mark the pay period as exported
    await ctx.db.patch(approval._id, {
      exportedToQB: true,
      exportedAt: now,
      updatedAt: now,
    });

    return {
      exportedCount: created.length,
      exportIds: created,
    };
  },
});
