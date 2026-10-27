"use client";

import { useAuth } from "@/app/auth-context";
import {
  PermissionUser,
  Tier,
  getTier,
  getTierName,
  hasMinTier,
  isLocationScoped,
  hasLocationAccess,
  getMenuPermissions,
  getATSPermissions,
  getPersonnelPermissions,
  getEquipmentPermissions,
  getTimePermissions,
  getDailyLogPermissions,
  getCalendarPermissions,
  getMessagesPermissions,
  getDashboardWidgetPermissions,
  canAccessRoute,
  getAccessibleLocations,
  getResolvedPermissions,
  hasPermission as checkPerm,
  MenuPermissions,
  ATSPermissions,
  PersonnelPermissions,
  EquipmentPermissions,
  TimePermissions,
  DailyLogPermissions,
  CalendarPermissions,
  MessagesPermissions,
  DashboardWidgetPermissions,
} from "./permissions";
import { Id } from "@/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export interface UsePermissionsResult {
  // Loading state
  isLoading: boolean;

  // Basic tier info
  tier: Tier;
  tierName: string;

  // Tier checks
  hasMinTier: (minTier: Tier) => boolean;
  isLocationScoped: boolean;
  hasLocationAccess: (locationId: Id<"locations">) => boolean;

  // Permission sets
  menu: MenuPermissions;
  ats: ATSPermissions;
  personnel: PersonnelPermissions;
  equipment: EquipmentPermissions;
  time: TimePermissions;
  dailyLog: DailyLogPermissions;
  calendar: CalendarPermissions;
  messages: MessagesPermissions;
  dashboardWidgets: DashboardWidgetPermissions;

  // Utilities
  canAccessRoute: (route: string) => boolean;
  getAccessibleLocations: (locations: { _id: Id<"locations">; name: string }[]) => { _id: Id<"locations">; name: string }[];
  hasPermission: (permKey: string) => boolean;

  // Flags
  isFinalTimeApprover: boolean;
  isPayrollProcessor: boolean;
  requiresDailyLog: boolean;
  hasEmailAccess: boolean;
}

export function usePermissions(): UsePermissionsResult {
  const { user, isLoading: loading } = useAuth();

  // Check if user has reportees (for daily log permissions)
  const reportees = useQuery(
    api.auth.getReporteesRequiringDailyLog,
    user?._id ? { managerId: user._id } : "skip"
  );

  // Default empty permissions for loading/unauthenticated state
  const emptyPermissions: UsePermissionsResult = {
    isLoading: true,
    tier: 0,
    tierName: "Employee",
    hasMinTier: () => false,
    isLocationScoped: false,
    hasLocationAccess: () => false,
    // Auto-generate all-false menu permissions from the interface keys
    menu: Object.fromEntries(
      Object.keys(getMenuPermissions({ _id: "" as Id<"users">, role: "employee" })).map(k => [k, false])
    ) as unknown as MenuPermissions,
    ats: {
      viewApplications: false,
      changeStatus: false,
      scheduleInterviews: false,
      markHired: false,
      viewAIAnalysis: false,
      bulkUpload: false,
      manageJobListings: false,
      locationScoped: false,
    },
    personnel: {
      viewAll: false,
      create: false,
      edit: false,
      viewCallLogs: false,
      createCallLogs: false,
      viewAttendance: false,
      manageAttendance: false,
      viewWriteUps: false,
      createWriteUps: false,
      viewReviews: false,
      createReviews: false,
      viewMerits: false,
      awardMerits: false,
      locationScoped: false,
    },
    equipment: {
      viewAllLocations: false,
      viewOwnLocation: false,
      create: false,
      edit: false,
      assign: false,
      scannerFleet: false,
      viewAgreements: false,
      createAgreements: false,
      manageQRCodes: false,
      submitSafetyChecks: false,
    },
    time: {
      punchInOut: false,
      viewOwnHours: false,
      approveTime: false,
      adjustTime: false,
      finalApproval: false,
      exportPayroll: false,
      viewOvertimeTracking: false,
      manageCallOffs: false,
      approvePTO: false,
      managePTOPolicy: false,
      viewTimeChangeAuditLog: false,
      locationScoped: false,
    },
    dailyLog: {
      submitLog: false,
      viewOwnLogs: false,
      viewReporteeLogs: false,
      viewAllLogs: false,
      generateReports: false,
      exportCSV: false,
    },
    calendar: {
      view: false,
      createEvents: false,
      editOwnEvents: false,
      editAnyEvent: false,
    },
    messages: {
      sendReceive: false,
      groupMessages: false,
      viewAnnouncements: false,
      createCompanyAnnouncements: false,
      createOvertimeAnnouncements: false,
    },
    dashboardWidgets: {
      dayAtAGlance: false,
      activeProjects: false,
      recentApplications: false,
      websiteMessages: false,
      hiringAnalytics: false,
      activityFeed: false,
      tenureCheckins: false,
      financialSnapshot: false,
    },
    canAccessRoute: () => false,
    getAccessibleLocations: () => [],
    hasPermission: () => false,
    isFinalTimeApprover: false,
    isPayrollProcessor: false,
    requiresDailyLog: false,
    hasEmailAccess: false,
  };

  // If auth is still loading, return loading state
  if (loading) {
    return emptyPermissions;
  }

  // If no user (not logged in), return empty permissions but NOT loading
  // This allows the redirect to login page to happen
  if (!user) {
    return { ...emptyPermissions, isLoading: false };
  }

  const permissionUser: PermissionUser = {
    _id: user._id,
    role: user.role,
    managedLocationIds: user.managedLocationIds as Id<"locations">[] | undefined,
    managedDepartments: user.managedDepartments,
    requiresDailyLog: user.requiresDailyLog,
    isFinalTimeApprover: user.isFinalTimeApprover,
    isPayrollProcessor: user.isPayrollProcessor,
    reportsTo: user.reportsTo as Id<"users"> | undefined,
    permissionOverrides: user.permissionOverrides,
  };

  const tier = getTier(user.role);
  const hasReportees = (reportees?.length ?? 0) > 0;

  // Get resolved permissions (role defaults + overrides merged)
  const resolved = getResolvedPermissions(permissionUser);

  // Build menu permissions dynamically from resolved map
  // Any key added to MenuPermissions + getMenuPermissions will automatically work here
  const menuFromResolved = Object.fromEntries(
    Object.keys(getMenuPermissions(permissionUser)).map(key => [
      key,
      resolved[`menu.${key}`] ?? false,
    ])
  ) as unknown as MenuPermissions;

  return {
    isLoading: false,
    tier,
    tierName: getTierName(tier),
    hasMinTier: (minTier: Tier) => hasMinTier(permissionUser, minTier),
    isLocationScoped: isLocationScoped(permissionUser),
    hasLocationAccess: (locationId: Id<"locations">) => hasLocationAccess(permissionUser, locationId),
    menu: menuFromResolved,
    ats: getATSPermissions(permissionUser),
    personnel: getPersonnelPermissions(permissionUser),
    equipment: getEquipmentPermissions(permissionUser),
    time: getTimePermissions(permissionUser),
    dailyLog: getDailyLogPermissions(permissionUser, hasReportees),
    calendar: getCalendarPermissions(permissionUser),
    messages: getMessagesPermissions(permissionUser),
    dashboardWidgets: getDashboardWidgetPermissions(permissionUser),
    canAccessRoute: (route: string) => canAccessRoute(permissionUser, route),
    getAccessibleLocations: (locations) => getAccessibleLocations(permissionUser, locations),
    hasPermission: (permKey: string) => checkPerm(permissionUser, permKey),
    isFinalTimeApprover: user.isFinalTimeApprover === true,
    isPayrollProcessor: user.isPayrollProcessor === true,
    requiresDailyLog: user.requiresDailyLog === true,
    hasEmailAccess: user.hasEmailAccess !== false, // default-on; admins can explicitly disable per user by setting hasEmailAccess: false
  };
}

// Convenience hook for checking a single permission
export function useHasPermission(check: (permissions: UsePermissionsResult) => boolean): boolean {
  const permissions = usePermissions();
  if (permissions.isLoading) return false;
  return check(permissions);
}

// Convenience hook for tier check
export function useMinTier(minTier: Tier): boolean {
  const permissions = usePermissions();
  if (permissions.isLoading) return false;
  return permissions.tier >= minTier;
}
