"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export type UserRole = "super_admin" | "admin" | "warehouse_director" | "warehouse_manager" | "department_manager" | "office_manager" | "shift_lead" | "member" | "employee";

export interface User {
  _id: Id<"users">;
  email?: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  forcePasswordChange?: boolean;
  managedDepartments?: string[];
  managedLocationIds?: Id<"locations">[];
  personnelId?: Id<"personnel">; // For employee role - links to their personnel record
  requiresDailyLog?: boolean; // If true, user must fill out daily activity logs
  // RBAC floating permission flags
  isFinalTimeApprover?: boolean; // Can do final time approval
  isPayrollProcessor?: boolean; // Can export payroll data
  reportsTo?: Id<"users">; // Who this user reports to
  // Feature-level permission overrides
  permissionOverrides?: Record<string, boolean>;
  // Email client access
  hasEmailAccess?: boolean;
}

const IMPERSONATION_KEY = "ie_central_impersonation";

export interface ImpersonationRecord {
  realUserId: string;
  realUserName: string;
  realUserEmail: string;
  targetUserId: string;
  targetUserName: string;
  targetRole: string;
  startedAt: number;
}

export interface ImpersonationTarget {
  _id: Id<"users">;
  name: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (
    email: string,
    password: string
  ) => Promise<{ success: boolean; error?: string; forcePasswordChange?: boolean }>;
  logout: () => void;
  // Super-admin impersonation ("Act as user")
  isImpersonating: boolean;
  impersonation: ImpersonationRecord | null;
  startImpersonation: (target: ImpersonationTarget) => void;
  stopImpersonation: () => void;
  canEdit: boolean;
  canManageUsers: boolean;
  canManageAdmins: boolean;
  // Personnel management permissions
  canViewPersonnel: boolean;
  canManagePersonnel: boolean;
  canEditShifts: boolean;
  canViewShifts: boolean;
  // Super admin and warehouse manager - delete write-ups and attendance records
  canDeleteRecords: boolean;
  // Edit personnel info (email, phone, etc.) - super_admin and admin only
  canEditPersonnelInfo: boolean;
  // Employee portal permissions
  canManageTimeOff: boolean; // Approve/deny time off requests
  canManageCallOffs: boolean; // View and acknowledge call-offs
  canManageAnnouncements: boolean; // Create/edit announcements
  canModerateChat: boolean; // Moderate chat messages
  // Shift planning role-based permissions
  canViewAllShifts: boolean; // Can see all locations (warehouse_director and above)
  canAccessDepartmentPortal: boolean; // Department manager portal access
  // Employee portal access
  isEmployee: boolean; // Is the user an employee (not admin/manager)
  canAccessEmployeePortal: boolean; // Employee portal access
  // Office management role (limited access - no people, equipment, employee portal admin)
  isOfficeManager: boolean;
  // Super admin check for broadcast messages
  isSuperAdmin: boolean;
  // Helper to get accessible location IDs for warehouse_manager
  getAccessibleLocationIds: () => Id<"locations">[] | "all";
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  // True once ANY successful userData load has completed in this provider lifetime.
  // Intentionally not reset when impersonation switches — the session-clear guards
  // rely on this staying true to avoid false-positive clearing on stop.
  const hasLoadedUserData = useRef(false);

  const [impersonation, setImpersonation] = useState<ImpersonationRecord | null>(null);
  const router = useRouter();
  const logAudit = useMutation(api.auditLogs.log);

  const loginMutation = useMutation(api.auth.login);
  // While impersonating, the whole app loads the target user instead of the real one.
  const effectiveUserId = impersonation?.targetUserId ?? userId;
  const userData = useQuery(
    api.auth.getUser,
    effectiveUserId ? { userId: effectiveUserId as Id<"users"> } : "skip"
  );

  const performLogout = useCallback(() => {
    setUserId(null);
    localStorage.removeItem("ie_central_user_id");
    localStorage.removeItem(IMPERSONATION_KEY);
    setImpersonation(null);
    hasLoadedUserData.current = false;
    setInitialLoadComplete(true);
  }, []);

  // Load saved session on mount - using localStorage (persists across browser restarts)
  useEffect(() => {
    const savedUserId = localStorage.getItem("ie_central_user_id") || sessionStorage.getItem("ie_central_user_id");
    if (savedUserId) {
      // Migrate from sessionStorage to localStorage if needed
      if (!localStorage.getItem("ie_central_user_id")) {
        localStorage.setItem("ie_central_user_id", savedUserId);
      }
      sessionStorage.removeItem("ie_central_user_id");

      if (savedUserId.length > 0) {
        setUserId(savedUserId);
      } else {
        localStorage.removeItem("ie_central_user_id");
        setInitialLoadComplete(true);
      }
    } else {
      setInitialLoadComplete(true);
    }
  }, []);

  // Restore an in-progress impersonation across reloads
  useEffect(() => {
    const stored = localStorage.getItem(IMPERSONATION_KEY);
    if (stored) {
      try {
        setImpersonation(JSON.parse(stored) as ImpersonationRecord);
      } catch {
        localStorage.removeItem(IMPERSONATION_KEY);
      }
    }
  }, []);

  // Timeout to clear stuck sessions - if userData is undefined for too long, clear the session
  useEffect(() => {
    if (userId && !impersonation && userData === undefined) {
      const timeout = setTimeout(() => {
        // If still loading after 5 seconds, the session is likely invalid
        if (userData === undefined && !hasLoadedUserData.current) {
          console.warn("Session validation timed out, clearing invalid session...");
          localStorage.removeItem("ie_central_user_id");
          setUserId(null);
          setInitialLoadComplete(true);
        }
      }, 5000);
      return () => clearTimeout(timeout);
    }
  }, [userId, userData, impersonation]);

  // Update loading state based on user data
  // Track successful user loads to avoid clearing session during transient null states
  useEffect(() => {
    if (userId && userData === undefined) {
      // Query is loading - keep waiting
    } else if (userId && userData) {
      // Successfully loaded user data - mark as loaded
      hasLoadedUserData.current = true;
      setInitialLoadComplete(true);
    } else if (userId && userData === null) {
      // Query returned null - only clear if we've never successfully loaded
      // This prevents logout during navigation/resubscription when queries temporarily return null
      if (!hasLoadedUserData.current && !impersonation) {
        // Never clear the real session because of a target's load state.
        // User ID doesn't match any user in database
        // This can happen if the ID is from a different table/project
        console.warn("Invalid user session detected, clearing...");
        localStorage.removeItem("ie_central_user_id");
        setUserId(null);
      }
      setInitialLoadComplete(true);
    }
  }, [userId, userData, impersonation]);

  // Compute isLoading: true if we haven't completed initial load, OR if we have a userId but query is still loading
  const isLoading = !initialLoadComplete || (effectiveUserId !== null && userData === undefined);

  const login = async (email: string, password: string) => {
    try {
      const result = await loginMutation({ email, password });
      if (result.success && result.userId) {
        setUserId(result.userId);
        localStorage.setItem("ie_central_user_id", result.userId);
        return {
          success: true,
          forcePasswordChange: result.forcePasswordChange,
        };
      }
      return { success: false, error: result.error || "Login failed" };
    } catch (error) {
      return { success: false, error: "An error occurred during login" };
    }
  };

  const logout = () => {
    performLogout();
  };

  const user: User | null = useMemo(
    () =>
      userData
        ? {
            _id: userData._id,
            email: userData.email,
            name: userData.name,
            role: userData.role as UserRole,
            isActive: userData.isActive,
            forcePasswordChange: userData.forcePasswordChange,
            managedDepartments: userData.managedDepartments,
            managedLocationIds: userData.managedLocationIds,
            personnelId: userData.personnelId,
            requiresDailyLog: userData.requiresDailyLog,
            permissionOverrides: userData.permissionOverrides as Record<string, boolean> | undefined,
          }
        : null,
    [userData]
  );

  const startImpersonation = useCallback(
    (target: ImpersonationTarget) => {
      // Only a real super admin may impersonate; never nest; never target a super admin or self.
      if (!user || user.role !== "super_admin") return;
      if (impersonation) return;
      if (target.role === "super_admin") return;
      if (target._id === user._id) return;

      const record: ImpersonationRecord = {
        realUserId: user._id,
        realUserName: user.name,
        realUserEmail: user.email || "",
        targetUserId: target._id,
        targetUserName: target.name,
        targetRole: target.role,
        startedAt: Date.now(),
      };
      localStorage.setItem(IMPERSONATION_KEY, JSON.stringify(record));
      setImpersonation(record);
      void logAudit({
        action: `Started acting as ${target.name}`,
        actionType: "impersonate_start",
        resourceType: "user",
        resourceId: target._id,
        userId: record.realUserId as Id<"users">,
        userEmail: record.realUserEmail,
        details: `${record.realUserName} began acting as ${target.name} (${target.role})`,
      }).catch(() => {});
      router.push("/");
    },
    [user, impersonation, logAudit, router]
  );

  const stopImpersonation = useCallback(() => {
    if (!impersonation) return;
    const record = impersonation;
    localStorage.removeItem(IMPERSONATION_KEY);
    setImpersonation(null);
    void logAudit({
      action: `Stopped acting as ${record.targetUserName}`,
      actionType: "impersonate_end",
      resourceType: "user",
      resourceId: record.targetUserId,
      userId: record.realUserId as Id<"users">,
      userEmail: record.realUserEmail,
      details: `${record.realUserName} stopped acting as ${record.targetUserName} (${record.targetRole})`,
    }).catch(() => {});
    router.push("/users");
  }, [impersonation, logAudit, router]);

  // Super Admin, Admin & Warehouse Director have full edit access
  const canEdit =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director" ||
    user?.role === "department_manager" ||
    user?.role === "member";

  // Helper: check permissionOverrides first, then fall back to role-based check
  const overrides = user?.permissionOverrides || {};
  const withOverride = (key: string, roleBased: boolean): boolean => {
    if (key in overrides) return overrides[key];
    return roleBased;
  };

  // Super Admin, Admin & Warehouse Director can manage users
  const canManageUsers =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director";

  // Super Admin can create/edit admin users
  const canManageAdmins = user?.role === "super_admin";

  // Personnel management permissions
  const canViewPersonnel = withOverride("viewPersonnel",
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director" ||
    user?.role === "department_manager" ||
    user?.role === "warehouse_manager"
  );

  const canManagePersonnel = withOverride("managePersonnel",
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director" ||
    user?.role === "department_manager" ||
    user?.role === "warehouse_manager"
  );

  // Edit shifts
  const canEditShifts = withOverride("viewShifts",
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director" ||
    user?.role === "warehouse_manager"
  );

  // View shifts
  const canViewShifts = withOverride("viewShifts",
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director" ||
    user?.role === "warehouse_manager" ||
    user?.role === "member"
  );

  // Can view ALL locations (warehouse_director and above)
  const canViewAllShifts =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director";

  // Department manager portal access
  const canAccessDepartmentPortal = withOverride("departmentPortal",
    user?.role === "department_manager"
  );

  // Employee portal access
  const isEmployee = user?.role === "employee";
  const canAccessEmployeePortal = user?.role === "employee";

  // Office management role - limited access (no people, equipment, employee portal admin)
  const isOfficeManager = user?.role === "office_manager";

  // Super admin check (for broadcast messages and other super admin features)
  const isSuperAdmin = user?.role === "super_admin";

  // Helper to get accessible location IDs for warehouse_manager
  const getAccessibleLocationIds = (): Id<"locations">[] | "all" => {
    if (canViewAllShifts) {
      return "all";
    }
    if (user?.role === "warehouse_manager") {
      return user.managedLocationIds || [];
    }
    return [];
  };

  // Super admin only - can delete write-ups and attendance records
  const canDeleteRecords = user?.role === "super_admin";

  // Edit personnel info (email, phone, etc.) - super_admin, admin, warehouse_director
  const canEditPersonnelInfo =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director";

  // Employee portal admin permissions
  // Manage time off requests
  const canManageTimeOff = withOverride("manageTimeOff",
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director"
  );

  // Manage call-offs
  const canManageCallOffs = withOverride("manageCallOffs",
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director" ||
    user?.role === "department_manager" ||
    user?.role === "warehouse_manager"
  );

  // Manage announcements
  const canManageAnnouncements = withOverride("manageAnnouncements",
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director"
  );

  // Moderate chat
  const canModerateChat = withOverride("moderateChat",
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director" ||
    user?.role === "department_manager"
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        logout,
        isImpersonating: impersonation !== null,
        impersonation,
        startImpersonation,
        stopImpersonation,
        canEdit,
        canManageUsers,
        canManageAdmins,
        canViewPersonnel,
        canManagePersonnel,
        canEditShifts,
        canViewShifts,
        canDeleteRecords,
        canEditPersonnelInfo,
        canManageTimeOff,
        canManageCallOffs,
        canManageAnnouncements,
        canModerateChat,
        canViewAllShifts,
        canAccessDepartmentPortal,
        isEmployee,
        canAccessEmployeePortal,
        isOfficeManager,
        isSuperAdmin,
        getAccessibleLocationIds,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
