/**
 * IE Central RBAC Permission System
 *
 * Tier Levels:
 * T0 - Employee (member)
 * T1 - Shift Lead / Retail Associate (department_manager, shift_lead, retail_associate)
 * T2 - Warehouse/Store/Office/Retail Manager (warehouse_manager, office_manager, retail_manager, retail_store_manager)
 * T3 - Director (warehouse_director)
 * T4 - Admin (admin)
 * T5 - Super Admin (super_admin)
 */

import { Id } from "@/convex/_generated/dataModel";
import { REPORT_TYPES } from "@/lib/reportTypes";

// Permission override map: key is permission name, value is true (grant) or false (deny)
export type PermissionOverrides = Record<string, boolean>;

// User type for permission checks
export interface PermissionUser {
  _id: Id<"users">;
  role: string;
  managedLocationIds?: Id<"locations">[];
  managedDepartments?: string[];
  requiresDailyLog?: boolean;
  isFinalTimeApprover?: boolean;
  isPayrollProcessor?: boolean;
  reportsTo?: Id<"users">;
  permissionOverrides?: PermissionOverrides;
}

// Tier levels
export type Tier = 0 | 1 | 2 | 3 | 4 | 5;

// Map roles to tiers
export function getTier(role: string): Tier {
  switch (role) {
    case "super_admin":
      return 5;
    case "admin":
      return 4;
    case "warehouse_director":
      return 3;
    case "warehouse_manager":
    case "office_manager":
    case "retail_manager":
    case "retail_store_manager":
      return 2;
    case "department_manager":
    case "shift_lead":
    case "retail_associate":
      return 1;
    case "member":
    case "employee":
    default:
      return 0;
  }
}

// Get tier name for display
export function getTierName(tier: Tier): string {
  switch (tier) {
    case 5: return "Super Admin";
    case 4: return "Admin";
    case 3: return "Director";
    case 2: return "Manager";
    case 1: return "Shift Lead";
    case 0: return "Employee";
  }
}

// Check if user meets minimum tier requirement
export function hasMinTier(user: PermissionUser, minTier: Tier): boolean {
  return getTier(user.role) >= minTier;
}

// Check if user is location-scoped (T2 managers)
export function isLocationScoped(user: PermissionUser): boolean {
  return getTier(user.role) === 2;
}

// Check if user has access to a specific location
export function hasLocationAccess(user: PermissionUser, locationId: Id<"locations">): boolean {
  const tier = getTier(user.role);

  // T3+ sees all locations
  if (tier >= 3) return true;

  // T2 sees only their assigned locations
  if (tier === 2) {
    return user.managedLocationIds?.includes(locationId) ?? false;
  }

  // T0-T1 don't have location-based access controls for most features
  return true;
}

// ============ FEATURE PERMISSIONS ============

// Sidebar menu permissions - which menu items are visible
export interface MenuPermissions {
  // Administrative
  userManagement: boolean;
  auditLog: boolean;
  timeChangeAuditLog: boolean;
  systemSettings: boolean;
  deletedRecords: boolean;

  // ATS / Hiring
  applications: boolean;
  jobListings: boolean;
  bulkUpload: boolean;
  indeedSettings: boolean;

  // Personnel
  personnel: boolean;
  onboardingDocs: boolean;

  // Time & Attendance
  timeClock: boolean;
  callOffs: boolean;
  timeApproval: boolean;
  payrollExport: boolean;
  overtime: boolean;

  // Equipment
  equipment: boolean;
  safetyCheckQR: boolean;

  // Daily Logs
  dailyLog: boolean;

  // Calendar & Messages
  calendar: boolean;
  messages: boolean;
  announcements: boolean;

  // Doc Hub
  docHub: boolean;

  // Scheduling
  shiftPlanning: boolean;
  scheduleTemplates: boolean;
  saturdayOvertime: boolean;

  // Projects
  projects: boolean;
  suggestions: boolean;

  // Finance
  mileage: boolean;
  expenseReports: boolean;
  payrollApproval: boolean;
  quickbooks: boolean;

  // Warehouse Tools
  binLabels: boolean;

  // Reports
  reports: boolean;
  reportUpload: boolean;
  surveys: boolean;

  // Organization
  orgChart: boolean;
  locations: boolean;
  engagement: boolean;

  // Portals
  departmentPortal: boolean;
  employeePortal: boolean;

  // IT & Support
  techWizard: boolean;
  websiteMessages: boolean;

  // Time Management
  timeCorrections: boolean;

  // Tools
  dealerRebates: boolean;
  dunlopReporting: boolean;
  wtdCommission: boolean;
  tireTrackAdmin: boolean;
  iePriceSystem: boolean;
}

export function getMenuPermissions(user: PermissionUser): MenuPermissions {
  const tier = getTier(user.role);
  const isRetailAssociate = user.role === "retail_associate";

  return {
    // Administrative - T4+
    userManagement: tier >= 4,
    auditLog: tier >= 4,
    timeChangeAuditLog: tier >= 5, // T5 only
    systemSettings: tier >= 4,
    deletedRecords: tier >= 4,

    // ATS / Hiring
    applications: tier >= 2, // T2+ (location-scoped for T2)
    jobListings: tier >= 4, // T4+
    bulkUpload: tier >= 4, // T4+
    indeedSettings: tier >= 4, // T4+

    // Personnel
    personnel: tier >= 2, // T2+ (location-scoped for T2)
    onboardingDocs: tier >= 4, // T4+

    // Time & Attendance
    timeClock: true, // All tiers
    callOffs: tier >= 2, // T2+ (T1 receives notifications only)
    timeApproval: tier === 2 || tier >= 5, // T2 (location) or T5
    payrollExport: user.isPayrollProcessor === true, // Flag-based
    overtime: tier >= 2, // T2+

    // Equipment
    equipment: tier >= 2, // T2+ (view only for T2-T3, full for T4+)
    safetyCheckQR: tier >= 4, // T4+

    // Daily Logs - special logic
    dailyLog: user.requiresDailyLog === true || tier >= 4,

    // Calendar & Messages - All tiers
    calendar: true,
    messages: true,
    announcements: true, // View for all, create T5 only

    // Doc Hub - T2+ or retail_associate
    docHub: tier >= 2 || isRetailAssociate,

    // Scheduling
    shiftPlanning: tier >= 2, // T2+
    scheduleTemplates: tier >= 4, // T4+
    saturdayOvertime: tier >= 2, // T2+

    // Projects - T2+
    projects: tier >= 2,
    suggestions: tier >= 2,

    // Finance
    mileage: tier >= 1, // T1+ (office managers, retail associates, etc.)
    expenseReports: tier >= 1, // T1+ (office managers, retail associates, etc.)
    payrollApproval: tier >= 4, // T4+
    quickbooks: tier >= 4, // T4+

    // Warehouse Tools - T2+
    binLabels: tier >= 2,

    // Reports - T4+
    reports: tier >= 4,
    reportUpload: tier >= 4,
    surveys: tier >= 4, // Create surveys (take surveys is all tiers)

    // Organization - T4+
    orgChart: tier >= 4,
    locations: tier >= 4,
    engagement: tier >= 4,

    // Portals
    departmentPortal: tier >= 1, // T1+
    employeePortal: true, // All tiers

    // IT & Support
    techWizard: tier >= 5, // T5 only
    websiteMessages: tier >= 4, // T4+

    // Time Management - T2+
    timeCorrections: tier >= 2,

    // Tools - T2+
    dealerRebates: tier >= 2,
    dunlopReporting: tier >= 4, // T4+ (Admin: full access, Manager: via override)
    wtdCommission: tier >= 5, // T5 only (lower tiers via access override list)
    tireTrackAdmin: tier >= 2,
    iePriceSystem: tier >= 2,
  };
}

// ============ FEATURE-SPECIFIC PERMISSIONS ============

// ATS / Hiring permissions
export interface ATSPermissions {
  viewApplications: boolean;
  changeStatus: boolean;
  scheduleInterviews: boolean;
  markHired: boolean;
  viewAIAnalysis: boolean;
  bulkUpload: boolean;
  manageJobListings: boolean;
  locationScoped: boolean;
}

export function getATSPermissions(user: PermissionUser): ATSPermissions {
  const tier = getTier(user.role);
  return {
    viewApplications: tier >= 2,
    changeStatus: tier >= 3, // Director+
    scheduleInterviews: tier >= 3, // Director+
    markHired: tier >= 2, // T2+
    viewAIAnalysis: tier >= 2, // T2+
    bulkUpload: tier >= 4, // T4+
    manageJobListings: tier >= 4, // T4+
    locationScoped: tier === 2, // Only T2 is scoped
  };
}

// Personnel permissions
export interface PersonnelPermissions {
  viewAll: boolean;
  create: boolean;
  edit: boolean;
  viewCallLogs: boolean;
  createCallLogs: boolean;
  viewAttendance: boolean;
  manageAttendance: boolean;
  viewWriteUps: boolean;
  createWriteUps: boolean;
  viewReviews: boolean;
  createReviews: boolean;
  viewMerits: boolean;
  awardMerits: boolean;
  locationScoped: boolean;
}

export function getPersonnelPermissions(user: PermissionUser): PersonnelPermissions {
  const tier = getTier(user.role);
  return {
    viewAll: tier >= 2,
    create: tier >= 3, // Director+
    edit: tier >= 3, // Director+
    viewCallLogs: tier >= 2,
    createCallLogs: tier >= 2,
    viewAttendance: tier >= 2,
    manageAttendance: tier >= 2,
    viewWriteUps: tier >= 2,
    createWriteUps: tier >= 2,
    viewReviews: tier >= 2,
    createReviews: tier >= 2,
    viewMerits: tier >= 2,
    awardMerits: tier >= 2,
    locationScoped: tier === 2,
  };
}

// Equipment permissions
export interface EquipmentPermissions {
  viewAllLocations: boolean;
  viewOwnLocation: boolean;
  create: boolean;
  edit: boolean;
  assign: boolean;
  viewAgreements: boolean;
  createAgreements: boolean;
  manageQRCodes: boolean;
  submitSafetyChecks: boolean;
}

export function getEquipmentPermissions(user: PermissionUser): EquipmentPermissions {
  const tier = getTier(user.role);
  const isWarehouseManager = user.role === "warehouse_manager";

  return {
    viewAllLocations: tier >= 3, // Director+
    viewOwnLocation: tier >= 2, // T2+ (view only for T2-T3)
    create: tier >= 4 || isWarehouseManager, // T4+ or warehouse_manager
    edit: tier >= 4 || isWarehouseManager, // T4+ or warehouse_manager
    assign: tier >= 4 || isWarehouseManager, // T4+ or warehouse_manager
    viewAgreements: tier >= 4, // T4+
    createAgreements: tier >= 4, // T4+
    manageQRCodes: tier >= 4, // T4+
    submitSafetyChecks: true, // All tiers
  };
}

// Time & Attendance permissions
export interface TimePermissions {
  punchInOut: boolean;
  viewOwnHours: boolean;
  approveTime: boolean;
  adjustTime: boolean;
  finalApproval: boolean;
  exportPayroll: boolean;
  viewOvertimeTracking: boolean;
  manageCallOffs: boolean;
  approvePTO: boolean;
  managePTOPolicy: boolean;
  viewTimeChangeAuditLog: boolean;
  locationScoped: boolean;
}

export function getTimePermissions(user: PermissionUser): TimePermissions {
  const tier = getTier(user.role);
  return {
    punchInOut: true, // All tiers
    viewOwnHours: true, // All tiers
    approveTime: tier === 2 || tier >= 5, // T2 (location) or T5
    adjustTime: tier === 2 || tier >= 5, // T2 (location) or T5
    finalApproval: user.isFinalTimeApprover === true, // Flag-based
    exportPayroll: user.isPayrollProcessor === true, // Flag-based
    viewOvertimeTracking: tier >= 2, // T2+
    manageCallOffs: tier >= 2, // T2+
    approvePTO: tier >= 2, // T2+
    managePTOPolicy: tier >= 4, // T4+
    viewTimeChangeAuditLog: tier >= 5, // T5 only
    locationScoped: tier === 2, // Only T2 is scoped
  };
}

// Daily Log permissions
export interface DailyLogPermissions {
  submitLog: boolean;
  viewOwnLogs: boolean;
  viewReporteeLogs: boolean;
  viewAllLogs: boolean; // Admin view
  generateReports: boolean;
  exportCSV: boolean;
}

export function getDailyLogPermissions(user: PermissionUser, hasReportees: boolean = false): DailyLogPermissions {
  const tier = getTier(user.role);
  const requiresLog = user.requiresDailyLog === true;

  return {
    submitLog: requiresLog,
    viewOwnLogs: requiresLog,
    viewReporteeLogs: hasReportees && tier >= 1, // T1+ with reportees
    viewAllLogs: tier >= 4 && !requiresLog, // T4+ only if they don't require their own log
    generateReports: tier >= 2, // T2+
    exportCSV: tier >= 4, // T4+
  };
}

// Calendar permissions
export interface CalendarPermissions {
  view: boolean;
  createEvents: boolean;
  editOwnEvents: boolean;
  editAnyEvent: boolean;
}

export function getCalendarPermissions(user: PermissionUser): CalendarPermissions {
  const tier = getTier(user.role);
  return {
    view: true, // All tiers
    createEvents: true, // All tiers
    editOwnEvents: true, // All tiers (creator only)
    editAnyEvent: tier >= 4, // T4+
  };
}

// Messages permissions
export interface MessagesPermissions {
  sendReceive: boolean;
  groupMessages: boolean;
  viewAnnouncements: boolean;
  createCompanyAnnouncements: boolean;
  createOvertimeAnnouncements: boolean;
}

export function getMessagesPermissions(user: PermissionUser): MessagesPermissions {
  const tier = getTier(user.role);
  return {
    sendReceive: true, // All tiers
    groupMessages: true, // All tiers
    viewAnnouncements: true, // All tiers
    createCompanyAnnouncements: tier >= 5, // T5 only
    createOvertimeAnnouncements: tier >= 2, // T2+
  };
}

// Dashboard widget permissions
export interface DashboardWidgetPermissions {
  dayAtAGlance: boolean;
  activeProjects: boolean;
  recentApplications: boolean;
  websiteMessages: boolean;
  hiringAnalytics: boolean;
  activityFeed: boolean;
  tenureCheckins: boolean;
  financialSnapshot: boolean;
}

export function getDashboardWidgetPermissions(user: PermissionUser): DashboardWidgetPermissions {
  const tier = getTier(user.role);
  return {
    dayAtAGlance: true, // All tiers
    activeProjects: tier >= 2, // T2+
    recentApplications: tier >= 2, // T2+
    websiteMessages: tier >= 4, // T4+
    hiringAnalytics: tier >= 2, // T2+
    activityFeed: tier >= 2, // T2+
    tenureCheckins: tier >= 2, // T2+
    financialSnapshot: tier >= 5, // T5 only (super admin)
  };
}

// ============ PERMISSION OVERRIDE SYSTEM ============

// All available permissions with categories for UI display
export interface PermissionDefinition {
  key: string;
  label: string;
  description: string;
  category: string;
}

export const PERMISSION_CATEGORIES = [
  { key: "admin", label: "Administrative" },
  { key: "ats", label: "ATS / Hiring" },
  { key: "personnel", label: "Personnel" },
  { key: "time", label: "Time & Attendance" },
  { key: "equipment", label: "Equipment" },
  { key: "scheduling", label: "Scheduling" },
  { key: "finance", label: "Finance" },
  { key: "communication", label: "Calendar & Messages" },
  { key: "documents", label: "Documents & Tools" },
  { key: "projects", label: "Projects" },
  { key: "reports", label: "Reports & Organization" },
  { key: "portals", label: "Portals" },
  { key: "it", label: "IT & Support" },
] as const;

export const ALL_PERMISSIONS: PermissionDefinition[] = [
  // Administrative
  { key: "menu.userManagement", label: "User Management", description: "View and manage user accounts", category: "admin" },
  { key: "menu.auditLog", label: "Audit Log", description: "View system audit logs", category: "admin" },
  { key: "menu.timeChangeAuditLog", label: "Time Change Audit Log", description: "View time change audit trail", category: "admin" },
  { key: "menu.systemSettings", label: "System Settings", description: "Manage system configuration", category: "admin" },
  { key: "menu.deletedRecords", label: "Deleted Records", description: "View and restore deleted records", category: "admin" },

  // ATS / Hiring
  { key: "menu.applications", label: "View Applications", description: "Access job applications", category: "ats" },
  { key: "menu.jobListings", label: "Job Listings", description: "Create and manage job postings", category: "ats" },
  { key: "menu.bulkUpload", label: "Bulk Upload", description: "Bulk upload applications", category: "ats" },
  { key: "menu.indeedSettings", label: "Indeed Settings", description: "Configure Indeed integration", category: "ats" },
  { key: "ats.changeStatus", label: "Change Application Status", description: "Update application statuses", category: "ats" },
  { key: "ats.scheduleInterviews", label: "Schedule Interviews", description: "Schedule candidate interviews", category: "ats" },

  // Personnel
  { key: "menu.personnel", label: "View Personnel", description: "Access personnel records", category: "personnel" },
  { key: "menu.onboardingDocs", label: "Onboarding Documents", description: "Manage onboarding document templates", category: "personnel" },
  { key: "personnel.create", label: "Create Personnel", description: "Add new personnel records", category: "personnel" },
  { key: "personnel.edit", label: "Edit Personnel", description: "Modify personnel records", category: "personnel" },
  { key: "personnel.createWriteUps", label: "Create Write-Ups", description: "Create employee write-ups", category: "personnel" },
  { key: "personnel.createReviews", label: "Create Reviews", description: "Create employee reviews", category: "personnel" },
  { key: "personnel.awardMerits", label: "Award Merits", description: "Award merit points to employees", category: "personnel" },

  // Time & Attendance
  { key: "menu.timeClock", label: "Time Clock", description: "Clock in/out access", category: "time" },
  { key: "menu.callOffs", label: "Call-Offs", description: "View and manage call-offs", category: "time" },
  { key: "menu.timeApproval", label: "Time Approval", description: "Approve employee timesheets", category: "time" },
  { key: "menu.payrollExport", label: "Payroll Export", description: "Export payroll data", category: "time" },
  { key: "menu.overtime", label: "Overtime Tracking", description: "View overtime reports", category: "time" },
  { key: "menu.timeCorrections", label: "Time Corrections", description: "Submit and manage time corrections", category: "time" },
  { key: "time.finalApproval", label: "Final Time Approval", description: "Final approval on timesheets", category: "time" },
  { key: "time.adjustTime", label: "Adjust Time", description: "Modify employee time entries", category: "time" },

  // Equipment
  { key: "menu.equipment", label: "Equipment", description: "View and manage equipment", category: "equipment" },
  { key: "menu.safetyCheckQR", label: "Safety Check QR", description: "Manage safety check QR codes", category: "equipment" },
  { key: "equipment.create", label: "Create Equipment", description: "Add new equipment records", category: "equipment" },
  { key: "equipment.edit", label: "Edit Equipment", description: "Modify equipment records", category: "equipment" },

  // Scheduling
  { key: "menu.shiftPlanning", label: "Shift Planning", description: "View and manage shift schedules", category: "scheduling" },
  { key: "menu.scheduleTemplates", label: "Schedule Templates", description: "Create and manage schedule templates", category: "scheduling" },
  { key: "menu.saturdayOvertime", label: "Saturday Overtime", description: "Manage Saturday overtime scheduling", category: "scheduling" },
  { key: "menu.dailyLog", label: "Daily Log", description: "Submit and view daily activity logs", category: "scheduling" },

  // Finance
  { key: "menu.mileage", label: "Mileage", description: "Submit mileage reports", category: "finance" },
  { key: "menu.expenseReports", label: "Expense Reports", description: "Submit expense reports", category: "finance" },
  { key: "menu.payrollApproval", label: "Payroll Approval", description: "Approve payroll batches", category: "finance" },
  { key: "menu.quickbooks", label: "QuickBooks", description: "QuickBooks integration settings", category: "finance" },

  // Calendar & Messages
  { key: "menu.calendar", label: "Calendar", description: "View and create calendar events", category: "communication" },
  { key: "menu.messages", label: "Messages", description: "Send and receive messages", category: "communication" },
  { key: "menu.announcements", label: "Announcements", description: "View announcements", category: "communication" },
  { key: "messages.createCompanyAnnouncements", label: "Create Company Announcements", description: "Post company-wide announcements", category: "communication" },
  { key: "messages.createOvertimeAnnouncements", label: "Create Overtime Announcements", description: "Post overtime opportunity announcements", category: "communication" },
  { key: "calendar.editAnyEvent", label: "Edit Any Calendar Event", description: "Edit events created by other users", category: "communication" },

  // Documents & Tools
  { key: "menu.docHub", label: "Doc Hub", description: "Access document repository", category: "documents" },
  { key: "menu.binLabels", label: "Bin Labels", description: "Generate warehouse bin labels", category: "documents" },

  // Projects
  { key: "menu.projects", label: "Projects", description: "View and manage projects", category: "projects" },
  { key: "menu.suggestions", label: "Suggestions", description: "View and submit suggestions", category: "projects" },

  // Reports & Organization
  { key: "menu.reports", label: "Reports", description: "Access system reports", category: "reports" },
  { key: "menu.reportUpload", label: "Upload Reports", description: "Upload JMK report files", category: "reports" },
  { key: "menu.surveys", label: "Surveys", description: "Create and manage surveys", category: "reports" },
  { key: "menu.orgChart", label: "Org Chart", description: "View organization chart", category: "reports" },
  { key: "menu.locations", label: "Locations", description: "Manage locations", category: "reports" },
  { key: "menu.engagement", label: "Engagement", description: "View engagement metrics", category: "reports" },

  // Portals
  { key: "menu.departmentPortal", label: "Department Portal", description: "Access department portal", category: "portals" },
  { key: "menu.employeePortal", label: "Employee Portal", description: "Access employee portal", category: "portals" },

  // IT & Support
  { key: "menu.techWizard", label: "Tech Wizard", description: "AI tech support wizard", category: "it" },
  { key: "menu.websiteMessages", label: "Website Messages", description: "View website contact form messages", category: "it" },

  // Tools
  { key: "menu.dealerRebates", label: "Dealer Rebates", description: "Access dealer rebate upload tool", category: "documents" },
  { key: "menu.dunlopReporting", label: "Dunlop Reporting", description: "Access Dunlop sellout reporting tool", category: "documents" },
  { key: "dunlopReporting.envToggle", label: "Dunlop Env Toggle", description: "Switch between dev and prod SFTP environments", category: "documents" },
  { key: "dunlopReporting.rerun", label: "Dunlop Re-run", description: "Re-run a previous Dunlop sellout submission", category: "documents" },
  { key: "dunlopReporting.deleteHistory", label: "Dunlop Delete History", description: "Delete Dunlop run history entries", category: "documents" },
  { key: "menu.wtdCommission", label: "WTD Commission", description: "Access WTD commission report tool", category: "documents" },
  { key: "menu.tireTrackAdmin", label: "TireTrack Admin", description: "Access TireTrack admin panel", category: "documents" },
  { key: "menu.iePriceSystem", label: "IE Price System", description: "Access IE Price System tool", category: "documents" },
  { key: "dealerRebates.deactivateDealers", label: "Deactivate Dealers", description: "Deactivate or reactivate dealers in the rebate tool", category: "documents" },
  { key: "dealerRebates.deleteUploads", label: "Delete Upload History", description: "Delete past upload records from the rebate tool", category: "documents" },
  { key: "dealerRebates.viewStats", label: "View Rebate Stats", description: "View rebate statistics and analytics", category: "documents" },

  // Dashboard Widgets
  { key: "dashboard.activeProjects", label: "Active Projects Widget", description: "Show active projects on dashboard", category: "reports" },
  { key: "dashboard.recentApplications", label: "Recent Applications Widget", description: "Show recent applications on dashboard", category: "reports" },
  { key: "dashboard.websiteMessages", label: "Website Messages Widget", description: "Show website messages on dashboard", category: "reports" },
  { key: "dashboard.hiringAnalytics", label: "Hiring Analytics Widget", description: "Show hiring analytics on dashboard", category: "reports" },
  { key: "dashboard.activityFeed", label: "Activity Feed Widget", description: "Show activity feed on dashboard", category: "reports" },
  { key: "dashboard.tenureCheckins", label: "Tenure Check-ins Widget", description: "Show tenure check-ins on dashboard", category: "reports" },
  { key: "dashboard.financialSnapshot", label: "Financial Snapshot Widget", description: "Show financial KPIs on dashboard (super admin only)", category: "reports" },
  // Per-report access — one toggle per report (defaults preserve current visibility).
  ...REPORT_TYPES.map((r) => ({
    key: `report.${r.id}`,
    label: `Report: ${r.title}`,
    description: `Access the "${r.title}" report`,
    category: "reports",
  })),
];

/**
 * Get all role-default permissions as a flat map.
 * Uses existing tier-based functions to compute defaults, then flattens into a single map.
 */
export function getRoleDefaults(user: PermissionUser): Record<string, boolean> {
  const menu = getMenuPermissions(user);
  const ats = getATSPermissions(user);
  const personnel = getPersonnelPermissions(user);
  const equip = getEquipmentPermissions(user);
  const time = getTimePermissions(user);
  const cal = getCalendarPermissions(user);
  const msg = getMessagesPermissions(user);
  const dash = getDashboardWidgetPermissions(user);

  const defaults: Record<string, boolean> = {};

  // Menu permissions
  for (const [key, value] of Object.entries(menu)) {
    defaults[`menu.${key}`] = value;
  }

  // ATS permissions
  for (const [key, value] of Object.entries(ats)) {
    if (key !== "locationScoped") defaults[`ats.${key}`] = value;
  }

  // Personnel permissions
  for (const [key, value] of Object.entries(personnel)) {
    if (key !== "locationScoped") defaults[`personnel.${key}`] = value;
  }

  // Equipment permissions
  for (const [key, value] of Object.entries(equip)) {
    defaults[`equipment.${key}`] = value;
  }

  // Time permissions
  for (const [key, value] of Object.entries(time)) {
    if (key !== "locationScoped") defaults[`time.${key}`] = value;
  }

  // Calendar permissions
  for (const [key, value] of Object.entries(cal)) {
    defaults[`calendar.${key}`] = value;
  }

  // Messages permissions
  for (const [key, value] of Object.entries(msg)) {
    defaults[`messages.${key}`] = value;
  }

  // Dashboard permissions
  for (const [key, value] of Object.entries(dash)) {
    defaults[`dashboard.${key}`] = value;
  }

  // Dealer Rebates permissions - T4+ (admin/super admin)
  const tier = getTier(user.role);
  defaults["dealerRebates.deactivateDealers"] = tier >= 4;
  defaults["dealerRebates.deleteUploads"] = tier >= 5; // super admin only
  defaults["dealerRebates.viewStats"] = tier >= 3; // director+

  // Dunlop Reporting permissions
  defaults["dunlopReporting.envToggle"] = tier >= 4; // admin+
  defaults["dunlopReporting.rerun"] = tier >= 4; // admin+
  defaults["dunlopReporting.deleteHistory"] = tier >= 5; // super admin only

  // Per-report permissions. Preserve current visibility as the default: reports are
  // admin-only (T4+), with sensitive/admin reports super-admin only (T5). Per-user
  // overrides let specific people be granted (or denied) individual reports.
  const reportTier = getTier(user.role);
  for (const r of REPORT_TYPES) {
    const sensitive = r.superAdminOnly || r.group === "admin";
    defaults[`report.${r.id}`] = sensitive ? reportTier >= 5 : reportTier >= 4;
  }

  return defaults;
}

/**
 * Resolve a single permission: override wins over role default.
 */
export function resolvePermission(
  permKey: string,
  roleDefaults: Record<string, boolean>,
  overrides?: PermissionOverrides
): boolean {
  if (overrides && permKey in overrides) {
    return overrides[permKey];
  }
  return roleDefaults[permKey] ?? false;
}

/**
 * Get all resolved permissions for a user (role defaults + overrides merged).
 */
export function getResolvedPermissions(user: PermissionUser): Record<string, boolean> {
  const defaults = getRoleDefaults(user);
  const resolved: Record<string, boolean> = { ...defaults };

  if (user.permissionOverrides) {
    for (const [key, value] of Object.entries(user.permissionOverrides)) {
      resolved[key] = value;
    }
  }

  return resolved;
}

/**
 * Check a single resolved permission for a user.
 */
export function hasPermission(user: PermissionUser, permKey: string): boolean {
  const defaults = getRoleDefaults(user);
  return resolvePermission(permKey, defaults, user.permissionOverrides);
}

// ============ UTILITY FUNCTIONS ============

// Check if user can access a route
export function canAccessRoute(user: PermissionUser, route: string): boolean {
  const resolved = getResolvedPermissions(user);

  // Map routes to permission keys
  const routeMap: Record<string, string> = {
    "/users": "menu.userManagement",
    "/audit-log": "menu.auditLog",
    "/settings": "menu.systemSettings",
    "/deleted-records": "menu.deletedRecords",
    "/applications": "menu.applications",
    "/jobs": "menu.jobListings",
    "/applications/bulk-upload": "menu.bulkUpload",
    "/personnel": "menu.personnel",
    "/settings/onboarding": "menu.onboardingDocs",
    "/time-clock": "menu.timeClock",
    "/call-offs": "menu.callOffs",
    "/payroll": "menu.payrollApproval",
    "/overtime": "menu.overtime",
    "/equipment": "menu.equipment",
    "/daily-log": "menu.dailyLog",
    "/calendar": "menu.calendar",
    "/messages": "menu.messages",
    "/announcements": "menu.announcements",
    "/documents": "menu.docHub",
    "/shifts": "menu.shiftPlanning",
    "/schedule-templates": "menu.scheduleTemplates",
    "/projects": "menu.projects",
    "/suggestions": "menu.suggestions",
    "/mileage": "menu.mileage",
    "/expense-report": "menu.expenseReports",
    "/settings/quickbooks": "menu.quickbooks",
    "/bin-labels": "menu.binLabels",
    "/reports": "menu.reports",
    "/org-chart": "menu.orgChart",
    "/locations": "menu.locations",
    "/engagement": "menu.engagement",
    "/department-portal": "menu.departmentPortal",
    "/portal": "menu.employeePortal",
    "/tech-wizard": "menu.techWizard",
    "/website-messages": "menu.websiteMessages",
    "/time-off": "menu.timeCorrections",
    "/dealer-rebates": "menu.dealerRebates",
    "/dunlop-reporting": "menu.dunlopReporting",
    "/tools/wtd-commission": "menu.wtdCommission",
  };

  // Check exact match first
  if (routeMap[route]) {
    return resolved[routeMap[route]] ?? false;
  }

  // Check prefix matches for dynamic routes
  for (const [routePrefix, permKey] of Object.entries(routeMap)) {
    if (route.startsWith(routePrefix)) {
      return resolved[permKey] ?? false;
    }
  }

  // Default allow for unmapped routes (login, change-password, etc.)
  return true;
}

// Get user's accessible locations
export function getAccessibleLocations(
  user: PermissionUser,
  allLocations: { _id: Id<"locations">; name: string }[]
): { _id: Id<"locations">; name: string }[] {
  const tier = getTier(user.role);

  // T3+ sees all locations
  if (tier >= 3) return allLocations;

  // T2 sees only their assigned locations
  if (tier === 2 && user.managedLocationIds) {
    return allLocations.filter(loc => user.managedLocationIds!.includes(loc._id));
  }

  // T0-T1 typically don't need location filtering
  return allLocations;
}
