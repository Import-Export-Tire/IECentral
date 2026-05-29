import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// ============ FLEET OVERVIEW ============

export const getScannerFleetOverview = query({
  args: {},
  handler: async (ctx) => {
    const scanners = await ctx.db.query("scanners").collect();
    const locations = await ctx.db.query("locations").collect();
    const activeLocations = locations.filter(
      (l) => l.isActive && l.locationType === "warehouse"
    );

    const now = Date.now();
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;

    const warehouseLocationIds = new Set(activeLocations.map((l) => l._id));
    const warehouseScanners = scanners.filter((s) => warehouseLocationIds.has(s.locationId));

    const total = warehouseScanners.filter((s) => s.status !== "retired").length;
    const online = warehouseScanners.filter((s) => s.isOnline && s.status !== "retired").length;
    const offline = total - online;

    // Scanners needing attention: offline >2hrs, battery <20%, not retired
    const needsAttention = warehouseScanners.filter((s) => {
      if (s.status === "retired") return false;
      if (s.mdmStatus !== "provisioned") return false;
      const offlineTooLong = !s.isOnline && s.lastSeen && s.lastSeen < twoHoursAgo;
      const lowBattery = s.batteryLevel !== undefined && s.batteryLevel < 20;
      return offlineTooLong || lowBattery;
    }).length;

    // Per-location breakdown
    const byLocation = await Promise.all(
      activeLocations.map(async (loc) => {
        const locScanners = scanners.filter(
          (s) => s.locationId === loc._id && s.status !== "retired"
        );
        return {
          locationId: loc._id,
          locationName: loc.name,
          total: locScanners.length,
          online: locScanners.filter((s) => s.isOnline).length,
          offline: locScanners.filter((s) => !s.isOnline).length,
          assigned: locScanners.filter((s) => s.status === "assigned").length,
          available: locScanners.filter((s) => s.status === "available").length,
        };
      })
    );

    return { total, online, offline, needsAttention, byLocation };
  },
});

// ============ SCANNER QUERIES ============

export const getScannerDetail = query({
  args: { id: v.id("scanners") },
  handler: async (ctx, args) => {
    const scanner = await ctx.db.get(args.id);
    if (!scanner) return null;

    const location = await ctx.db.get(scanner.locationId);
    const assignedPerson = scanner.assignedTo
      ? await ctx.db.get(scanner.assignedTo)
      : null;

    // Get recent commands
    const commands = await ctx.db
      .query("scannerCommandLog")
      .withIndex("by_scanner", (q) => q.eq("scannerId", args.id))
      .order("desc")
      .take(20);

    // Get equipment history
    const history = await ctx.db
      .query("equipmentHistory")
      .withIndex("by_equipment", (q) =>
        q.eq("equipmentType", "scanner").eq("equipmentId", args.id)
      )
      .order("desc")
      .take(20);

    const enrichedHistory = await Promise.all(
      history.map(async (h) => {
        const performer = await ctx.db.get(h.performedBy);
        const prevPerson = h.previousAssignee
          ? await ctx.db.get(h.previousAssignee)
          : null;
        const newPerson = h.newAssignee
          ? await ctx.db.get(h.newAssignee)
          : null;
        return {
          ...h,
          performedByName: performer
            ? `${performer.name ?? performer.email}`
            : "System",
          previousAssigneeName: prevPerson
            ? `${prevPerson.firstName} ${prevPerson.lastName}`
            : null,
          newAssigneeName: newPerson
            ? `${newPerson.firstName} ${newPerson.lastName}`
            : null,
        };
      })
    );

    // Get MDM config for this location
    const mdmConfig = await ctx.db
      .query("scannerMdmConfigs")
      .withIndex("by_location", (q) => q.eq("locationId", scanner.locationId))
      .first();

    return {
      ...scanner,
      locationName: location?.name ?? "Unknown",
      assignedPersonName: assignedPerson
        ? `${assignedPerson.firstName} ${assignedPerson.lastName}`
        : null,
      commands,
      history: enrichedHistory,
      mdmConfig,
    };
  },
});

export const getScannerBySerialNumber = query({
  args: { serialNumber: v.string() },
  handler: async (ctx, args) => {
    const scanner = await ctx.db
      .query("scanners")
      .withIndex("by_serial", (q) => q.eq("serialNumber", args.serialNumber))
      .first();

    if (!scanner) return null;

    const location = await ctx.db.get(scanner.locationId);
    return {
      ...scanner,
      locationName: location?.name ?? "Unknown",
    };
  },
});

export const getScannersNeedingAttention = query({
  args: {},
  handler: async (ctx) => {
    const scanners = await ctx.db.query("scanners").collect();
    const now = Date.now();
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;

    const alerts: Array<{
      scanner: typeof scanners[0] & { locationName: string };
      reasons: string[];
    }> = [];

    for (const s of scanners) {
      if (s.status === "retired" || s.mdmStatus !== "provisioned") continue;

      const reasons: string[] = [];
      if (!s.isOnline && s.lastSeen && s.lastSeen < twoHoursAgo) {
        reasons.push("offline");
      }
      if (s.batteryLevel !== undefined && s.batteryLevel < 20) {
        reasons.push("low_battery");
      }

      if (reasons.length > 0) {
        const location = await ctx.db.get(s.locationId);
        alerts.push({
          scanner: { ...s, locationName: location?.name ?? "Unknown" },
          reasons,
        });
      }
    }

    return alerts;
  },
});

// ============ TELEMETRY ============

export const updateScannerTelemetry = internalMutation({
  args: {
    iotThingName: v.string(),
    batteryLevel: v.optional(v.number()),
    wifiSignal: v.optional(v.number()),
    gpsLatitude: v.optional(v.number()),
    gpsLongitude: v.optional(v.number()),
    installedApps: v.optional(
      v.object({
        tireTrack: v.optional(v.string()),
        rtLocator: v.optional(v.string()),
        scannerAgent: v.optional(v.string()),
      })
    ),
    agentVersion: v.optional(v.string()),
    androidVersion: v.optional(v.string()),
    isLocked: v.optional(v.boolean()),
    lastCommandAck: v.optional(v.string()),
    storageTotal: v.optional(v.number()),
    storageFree: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const scanner = await ctx.db
      .query("scanners")
      .withIndex("by_iot_thing", (q) => q.eq("iotThingName", args.iotThingName))
      .first();

    if (!scanner) return { success: false, error: "Scanner not found" };

    const now = Date.now();
    const updates: Record<string, any> = {
      isOnline: true,
      lastSeen: now,
      updatedAt: now,
    };

    if (args.batteryLevel !== undefined) updates.batteryLevel = args.batteryLevel;
    if (args.wifiSignal !== undefined) updates.wifiSignal = args.wifiSignal;
    if (args.gpsLatitude !== undefined) updates.gpsLatitude = args.gpsLatitude;
    if (args.gpsLongitude !== undefined) updates.gpsLongitude = args.gpsLongitude;
    if (args.installedApps !== undefined) updates.installedApps = args.installedApps;
    if (args.agentVersion !== undefined) updates.agentVersion = args.agentVersion;
    if (args.androidVersion !== undefined) updates.androidVersion = args.androidVersion;
    if (args.isLocked !== undefined) updates.isLocked = args.isLocked;
    if (args.storageTotal !== undefined) updates.storageTotal = args.storageTotal;
    if (args.storageFree !== undefined) updates.storageFree = args.storageFree;

    // === Alert generation ===
    const existingAlerts: Array<{
      type: string;
      message: string;
      createdAt: number;
      resolved: boolean;
    }> = scanner.scannerAlerts ?? [];

    // Keep only the last 20 alerts to avoid unbounded growth
    const recentAlerts = existingAlerts.slice(-20);

    // Low battery alert: battery drops below 15%
    if (args.batteryLevel !== undefined && args.batteryLevel < 15) {
      // Only alert if no active (unresolved) low_battery alert exists
      const hasActiveBatteryAlert = recentAlerts.some(
        (a) => a.type === "low_battery" && !a.resolved
      );
      if (!hasActiveBatteryAlert) {
        recentAlerts.push({
          type: "low_battery",
          message: `Battery critically low at ${args.batteryLevel}%`,
          createdAt: now,
          resolved: false,
        });
      }
    } else if (args.batteryLevel !== undefined && args.batteryLevel >= 15) {
      // Resolve active low_battery alerts when battery recovers
      for (const alert of recentAlerts) {
        if (alert.type === "low_battery" && !alert.resolved) {
          alert.resolved = true;
        }
      }
    }

    // Offline alert: scanner was offline for >30 min and is now back online
    if (scanner.isOnline === false && scanner.lastSeen) {
      const offlineDuration = now - scanner.lastSeen;
      const thirtyMinutes = 30 * 60 * 1000;
      if (offlineDuration > thirtyMinutes) {
        recentAlerts.push({
          type: "offline",
          message: `Scanner was offline for ${Math.round(offlineDuration / 60000)} minutes`,
          createdAt: now,
          resolved: true, // Resolved because it's back online now
        });
      }
    }

    // Low storage alert: free storage below 500MB
    if (args.storageFree !== undefined && args.storageFree < 500) {
      const hasActiveStorageAlert = recentAlerts.some(
        (a) => a.type === "low_storage" && !a.resolved
      );
      if (!hasActiveStorageAlert) {
        recentAlerts.push({
          type: "low_storage",
          message: `Storage critically low: ${args.storageFree}MB free`,
          createdAt: now,
          resolved: false,
        });
      }
    } else if (args.storageFree !== undefined && args.storageFree >= 500) {
      for (const alert of recentAlerts) {
        if (alert.type === "low_storage" && !alert.resolved) {
          alert.resolved = true;
        }
      }
    }

    updates.scannerAlerts = recentAlerts;

    await ctx.db.patch(scanner._id, updates);

    // If there's a command acknowledgement, update the command log
    if (args.lastCommandAck) {
      const command = await ctx.db
        .query("scannerCommandLog")
        .withIndex("by_scanner", (q) => q.eq("scannerId", scanner._id))
        .order("desc")
        .first();

      if (command && command.status === "sent") {
        await ctx.db.patch(command._id, {
          status: "acknowledged",
          acknowledgedAt: now,
        });
      }
    }

    return { success: true };
  },
});

export const bulkUpdateOnlineStatus = internalMutation({
  args: {},
  handler: async (ctx) => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const scanners = await ctx.db
      .query("scanners")
      .withIndex("by_online", (q) => q.eq("isOnline", true))
      .collect();

    let updated = 0;
    for (const scanner of scanners) {
      if (scanner.lastSeen && scanner.lastSeen < fiveMinutesAgo) {
        await ctx.db.patch(scanner._id, { isOnline: false, updatedAt: Date.now() });
        updated++;
      }
    }

    return { updated };
  },
});

// ============ PROVISIONING ============

export const provisionScanner = mutation({
  args: {
    scannerId: v.id("scanners"),
    iotThingName: v.string(),
    iotThingArn: v.string(),
    iotCertificateArn: v.string(),
  },
  handler: async (ctx, args) => {
    const scanner = await ctx.db.get(args.scannerId);
    if (!scanner) throw new Error("Scanner not found");

    await ctx.db.patch(args.scannerId, {
      iotThingName: args.iotThingName,
      iotThingArn: args.iotThingArn,
      iotCertificateArn: args.iotCertificateArn,
      provisionedAt: Date.now(),
      mdmStatus: "provisioned",
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const deprovisionScanner = mutation({
  args: {
    scannerId: v.id("scanners"),
  },
  handler: async (ctx, args) => {
    const scanner = await ctx.db.get(args.scannerId);
    if (!scanner) throw new Error("Scanner not found");

    await ctx.db.patch(args.scannerId, {
      mdmStatus: "deprovisioned",
      isOnline: false,
      updatedAt: Date.now(),
    });

    return {
      success: true,
      certificateArn: scanner.iotCertificateArn,
      thingName: scanner.iotThingName,
    };
  },
});

// ============ COMMAND LOG ============

export const logScannerCommand = mutation({
  args: {
    scannerId: v.id("scanners"),
    command: v.string(),
    payload: v.optional(v.string()),
    userId: v.id("users"),
    userName: v.string(),
  },
  handler: async (ctx, args) => {
    const scanner = await ctx.db.get(args.scannerId);
    if (!scanner) throw new Error("Scanner not found");

    const commandId = await ctx.db.insert("scannerCommandLog", {
      scannerId: args.scannerId,
      scannerNumber: scanner.number,
      command: args.command,
      payload: args.payload,
      status: "sent",
      issuedBy: args.userId,
      issuedByName: args.userName,
      issuedAt: Date.now(),
    });

    // Update scanner with last command info
    await ctx.db.patch(args.scannerId, {
      lastCommandId: commandId,
      lastCommandStatus: "pending",
      updatedAt: Date.now(),
    });

    return { commandId };
  },
});

export const updateCommandStatus = mutation({
  args: {
    commandId: v.id("scannerCommandLog"),
    status: v.string(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const command = await ctx.db.get(args.commandId);
    if (!command) throw new Error("Command not found");

    const updates: Record<string, any> = { status: args.status };
    if (args.status === "acknowledged") updates.acknowledgedAt = Date.now();
    if (args.status === "completed") updates.completedAt = Date.now();
    if (args.errorMessage) updates.errorMessage = args.errorMessage;

    await ctx.db.patch(args.commandId, updates);

    // Update scanner's last command status
    await ctx.db.patch(command.scannerId, {
      lastCommandStatus: args.status,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const getScannerCommandHistory = query({
  args: {
    scannerId: v.id("scanners"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("scannerCommandLog")
      .withIndex("by_scanner", (q) => q.eq("scannerId", args.scannerId))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

// ============ MDM CONFIGS ============

export const getMdmConfig = query({
  args: { locationId: v.id("locations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("scannerMdmConfigs")
      .withIndex("by_location", (q) => q.eq("locationId", args.locationId))
      .first();
  },
});

export const getMdmConfigByCode = query({
  args: { locationCode: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("scannerMdmConfigs")
      .withIndex("by_code", (q) => q.eq("locationCode", args.locationCode))
      .first();
  },
});

export const listMdmConfigs = query({
  args: {},
  handler: async (ctx) => {
    const configs = await ctx.db.query("scannerMdmConfigs").collect();
    return await Promise.all(
      configs.map(async (config) => {
        const location = await ctx.db.get(config.locationId);
        return {
          ...config,
          locationName: location?.name ?? "Unknown",
        };
      })
    );
  },
});

export const upsertMdmConfig = mutation({
  args: {
    locationId: v.id("locations"),
    locationCode: v.string(),
    rtLocatorUrl: v.string(),
    defaultDeviceIdPrefix: v.string(),
    screenTimeoutMs: v.number(),
    screenRotation: v.string(),
    bloatwarePackages: v.array(v.string()),
    wifiSsid: v.optional(v.string()),
    wifiPassword: v.optional(v.string()),
    tireTrackApkSource: v.string(),
    tireTrackApkS3Key: v.optional(v.string()),
    rtLocatorApkS3Key: v.optional(v.string()),
    agentApkS3Key: v.optional(v.string()),
    currentTireTrackVersion: v.optional(v.string()),
    currentRtLocatorVersion: v.optional(v.string()),
    currentAgentVersion: v.optional(v.string()),
    rtConfigXml: v.optional(v.string()),
    notes: v.optional(v.string()),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("scannerMdmConfigs")
      .withIndex("by_location", (q) => q.eq("locationId", args.locationId))
      .first();

    const { userId, ...data } = args;
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...data,
        updatedBy: userId,
        updatedAt: now,
      });
      return { id: existing._id, created: false };
    } else {
      const id = await ctx.db.insert("scannerMdmConfigs", {
        ...data,
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
      });
      return { id, created: true };
    }
  },
});

// ============ SCANNER CREATION (enhanced for setup tool) ============

export const createScannerFromSetup = mutation({
  args: {
    number: v.string(),
    pin: v.string(),
    serialNumber: v.string(),
    model: v.string(),
    locationId: v.id("locations"),
    notes: v.optional(v.string()),
    conditionNotes: v.optional(v.string()),
    // IoT fields set during provisioning
    iotThingName: v.optional(v.string()),
    iotThingArn: v.optional(v.string()),
    iotCertificateArn: v.optional(v.string()),
    installedApps: v.optional(
      v.object({
        tireTrack: v.optional(v.string()),
        rtLocator: v.optional(v.string()),
        scannerAgent: v.optional(v.string()),
      })
    ),
    androidVersion: v.optional(v.string()),
    agentVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check for duplicate number at this location
    const existing = await ctx.db
      .query("scanners")
      .withIndex("by_number", (q) => q.eq("number", args.number))
      .collect();

    const duplicate = existing.find((s) => s.locationId === args.locationId);
    if (duplicate) {
      throw new Error(`Scanner ${args.number} already exists at this location`);
    }

    // Check for existing serial number
    if (args.serialNumber) {
      const bySerial = await ctx.db
        .query("scanners")
        .withIndex("by_serial", (q) => q.eq("serialNumber", args.serialNumber))
        .first();
      if (bySerial) {
        throw new Error(
          `Serial number ${args.serialNumber} already registered as scanner ${bySerial.number}`
        );
      }
    }

    const now = Date.now();
    const scannerId = await ctx.db.insert("scanners", {
      number: args.number,
      pin: args.pin,
      serialNumber: args.serialNumber,
      model: args.model,
      locationId: args.locationId,
      status: "available",
      purchaseDate: new Date().toISOString().split("T")[0],
      notes: args.notes ?? "Configured via scanner setup tool",
      conditionNotes: args.conditionNotes ?? "New setup",
      // IoT fields
      iotThingName: args.iotThingName,
      iotThingArn: args.iotThingArn,
      iotCertificateArn: args.iotCertificateArn,
      provisionedAt: args.iotThingName ? now : undefined,
      mdmStatus: args.iotThingName ? "provisioned" : "pending",
      isOnline: false,
      installedApps: args.installedApps,
      androidVersion: args.androidVersion,
      agentVersion: args.agentVersion,
      createdAt: now,
      updatedAt: now,
    });

    return { scannerId, number: args.number };
  },
});

// Get next available scanner number for a location
export const getNextScannerNumber = query({
  args: { locationCode: v.string() },
  handler: async (ctx, args) => {
    const scanners = await ctx.db.query("scanners").collect();
    const prefix = args.locationCode + "-";

    const existingNumbers = scanners
      .filter((s) => s.number.startsWith(prefix))
      .map((s) => {
        const num = parseInt(s.number.replace(prefix, ""), 10);
        return isNaN(num) ? 0 : num;
      });

    const maxNum = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
    const next = maxNum + 1;
    return `${prefix}${String(next).padStart(3, "0")}`;
  },
});

// ============ WEB PROVISIONING (CLAIM CODE FLOW) ============

const CLAIM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No 0/O/I/1
const CLAIM_CODE_LENGTH = 6;
const CLAIM_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function generateClaimCode(): string {
  let code = "";
  for (let i = 0; i < CLAIM_CODE_LENGTH; i++) {
    code += CLAIM_CODE_CHARS[Math.floor(Math.random() * CLAIM_CODE_CHARS.length)];
  }
  return code;
}

export const storePendingProvision = mutation({
  args: {
    scannerId: v.id("scanners"),
    thingName: v.string(),
    thingArn: v.string(),
    certificateArn: v.string(),
    certificatePem: v.string(),
    privateKey: v.string(),
    iotEndpoint: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Generate a unique code
    let code = generateClaimCode();
    const now = Date.now();

    // Ensure uniqueness among active (unclaimed, unexpired) codes
    for (let attempt = 0; attempt < 10; attempt++) {
      const existing = await ctx.db
        .query("scannerProvisionCodes")
        .withIndex("by_code", (q) => q.eq("code", code))
        .first();
      if (!existing || existing.claimed || existing.expiresAt < now) break;
      code = generateClaimCode();
    }

    await ctx.db.insert("scannerProvisionCodes", {
      code,
      scannerId: args.scannerId,
      thingName: args.thingName,
      thingArn: args.thingArn,
      certificateArn: args.certificateArn,
      certificatePem: args.certificatePem,
      privateKey: args.privateKey,
      iotEndpoint: args.iotEndpoint,
      expiresAt: now + CLAIM_CODE_TTL_MS,
      claimed: false,
      createdBy: args.userId,
      createdAt: now,
    });

    return { code, expiresAt: now + CLAIM_CODE_TTL_MS };
  },
});

export const claimProvision = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("scannerProvisionCodes")
      .withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase()))
      .first();

    if (!record) return { success: false, error: "Invalid code" };
    if (record.claimed) return { success: false, error: "Code already used" };
    if (record.expiresAt < Date.now()) return { success: false, error: "Code expired" };
    if (!record.certificatePem || !record.privateKey) {
      return { success: false, error: "Code expired" };
    }

    // Mark as claimed
    await ctx.db.patch(record._id, { claimed: true, claimedAt: Date.now() });

    // Ensure scanner is marked provisioned
    const scanner = await ctx.db.get(record.scannerId);
    if (scanner && scanner.mdmStatus !== "provisioned") {
      await ctx.db.patch(record.scannerId, {
        mdmStatus: "provisioned",
        provisionedAt: Date.now(),
        isOnline: false,
        updatedAt: Date.now(),
      });
    }

    // Fetch RT config for the scanner's location
    let rtConfigXml: string | undefined;
    if (scanner) {
      const mdmConfig = await ctx.db
        .query("scannerMdmConfigs")
        .withIndex("by_location", (q) => q.eq("locationId", scanner.locationId))
        .first();
      if (mdmConfig) {
        rtConfigXml = mdmConfig.rtConfigXml || `<RT>
    <ORIENTATION>PORTRAIT</ORIENTATION>
    <DEVICEID>${scanner.number}</DEVICEID>
    <SCALEFACTOR>3.5</SCALEFACTOR>
    <RTLMOBILEURL>${mdmConfig.rtLocatorUrl}</RTLMOBILEURL>
</RT>`;
      }
    }

    return {
      success: true,
      thingName: record.thingName,
      certificatePem: record.certificatePem,
      privateKey: record.privateKey,
      iotEndpoint: record.iotEndpoint,
      rtConfigXml,
    };
  },
});

export const getProvisionCode = query({
  args: { scannerId: v.id("scanners") },
  handler: async (ctx, args) => {
    const codes = await ctx.db
      .query("scannerProvisionCodes")
      .withIndex("by_scanner", (q) => q.eq("scannerId", args.scannerId))
      .order("desc")
      .take(1);

    if (codes.length === 0) return null;
    const latest = codes[0];
    if (latest.expiresAt < Date.now() && !latest.claimed) return null;
    return {
      code: latest.code,
      expiresAt: latest.expiresAt,
      claimed: latest.claimed,
      claimedAt: latest.claimedAt,
    };
  },
});

export const cleanupExpiredProvisionCodes = internalMutation({
  args: {},
  handler: async (ctx) => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const codes = await ctx.db.query("scannerProvisionCodes").collect();
    let cleaned = 0;
    for (const code of codes) {
      if ((code.claimed || code.expiresAt < oneDayAgo) && code.certificatePem) {
        await ctx.db.patch(code._id, { certificatePem: undefined, privateKey: undefined });
        cleaned++;
      }
    }
    return { cleaned };
  },
});

// ============ SETUP LOGS ============

export const logScannerSetupStep = mutation({
  args: {
    scannerId: v.id("scanners"),
    step: v.string(),
    status: v.string(),
    durationMs: v.optional(v.number()),
    error: v.optional(v.string()),
    browserAgent: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("scannerSetupLogs", {
      ...args,
      createdAt: Date.now(),
    });
    return { success: true };
  },
});

export const listSetupLogsByScanner = query({
  args: { scannerId: v.id("scanners"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("scannerSetupLogs")
      .withIndex("by_scanner_created", (q) => q.eq("scannerId", args.scannerId))
      .order("desc")
      .take(args.limit ?? 100);
  },
});
