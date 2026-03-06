"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
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
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (
    email: string,
    password: string
  ) => Promise<{ success: boolean; error?: string; forcePasswordChange?: boolean }>;
  logout: () => void;
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
  // Track if we've ever successfully loaded user data for this session
  // This prevents clearing the session during transient null states (navigation, resubscription)
  const hasLoadedUserData = useRef(false);

  const loginMutation = useMutation(api.auth.login);
  const userData = useQuery(
    api.auth.getUser,
    userId ? { userId: userId as Id<"users"> } : "skip"
  );

  const performLogout = useCallback(() => {
    setUserId(null);
    sessionStorage.removeItem("ie_central_user_id");
    hasLoadedUserData.current = false;
    setInitialLoadComplete(true);
  }, []);

  // Load saved session on mount - using sessionStorage (clears on browser close)
  useEffect(() => {
    // Clear any old localStorage data (migration to sessionStorage)
    if (typeof window !== "undefined") {
      localStorage.removeItem("ie_central_user_id");
    }

    const savedUserId = sessionStorage.getItem("ie_central_user_id");
    if (savedUserId) {
      // Basic validation - Convex user IDs should be a specific format
      // Clear invalid IDs that might be from other tables/projects
      if (savedUserId.length > 0) {
        setUserId(savedUserId);
      } else {
        sessionStorage.removeItem("ie_central_user_id");
        setInitialLoadComplete(true);
      }
    } else {
      setInitialLoadComplete(true);
    }
  }, []);

  // Timeout to clear stuck sessions - if userData is undefined for too long, clear the session
  useEffect(() => {
    if (userId && userData === undefined) {
      const timeout = setTimeout(() => {
        // If still loading after 5 seconds, the session is likely invalid
        if (userData === undefined && !hasLoadedUserData.current) {
          console.warn("Session validation timed out, clearing invalid session...");
          sessionStorage.removeItem("ie_central_user_id");
          setUserId(null);
          setInitialLoadComplete(true);
        }
      }, 5000);
      return () => clearTimeout(timeout);
    }
  }, [userId, userData]);

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
      if (!hasLoadedUserData.current) {
        // User ID in sessionStorage doesn't match any user in database
        // This can happen if the ID is from a different table/project
        console.warn("Invalid user session detected, clearing...");
        sessionStorage.removeItem("ie_central_user_id");
        setUserId(null);
      }
      setInitialLoadComplete(true);
    }
  }, [userId, userData]);

  // Compute isLoading: true if we haven't completed initial load, OR if we have a userId but query is still loading
  const isLoading = !initialLoadComplete || (userId !== null && userData === undefined);

  const login = async (email: string, password: string) => {
    try {
      const result = await loginMutation({ email, password });
      if (result.success && result.userId) {
        setUserId(result.userId);
        // Use sessionStorage - clears when browser/tab closes (force login on every visit)
        sessionStorage.setItem("ie_central_user_id", result.userId);
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

  const user: User | null = userData
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
      }
    : null;

  // Super Admin, Admin & Warehouse Director have full edit access
  const canEdit =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director" ||
    user?.role === "department_manager" ||
    user?.role === "member";

  // Super Admin, Admin & Warehouse Director can manage users
  const canManageUsers =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director";

  // Super Admin can create/edit admin users
  const canManageAdmins = user?.role === "super_admin";

  // Personnel management permissions
  // View personnel: super_admin, admin, warehouse_director, department_manager, warehouse_manager
  const canViewPersonnel =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director" ||
    user?.role === "department_manager" ||
    user?.role === "warehouse_manager";

  // Manage personnel (add, edit, delete records): super_admin, admin, warehouse_director, department_manager, warehouse_manager
  const canManagePersonnel =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director" ||
    user?.role === "department_manager" ||
    user?.role === "warehouse_manager";

  // Edit shifts: super_admin, admin, warehouse_director, warehouse_manager
  const canEditShifts =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director" ||
    user?.role === "warehouse_manager";

  // View shifts: super_admin, admin, warehouse_director, warehouse_manager, member
  const canViewShifts =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director" ||
    user?.role === "warehouse_manager" ||
    user?.role === "member";

  // Can view ALL locations (warehouse_director and above)
  const canViewAllShifts =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director";

  // Department manager portal access (read-only view of their department)
  const canAccessDepartmentPortal =
    user?.role === "department_manager";

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
  // Manage time off requests: super_admin, admin, warehouse_director only
  // (Warehouse managers and department managers cannot approve - goes through directors)
  const canManageTimeOff =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director";

  // Manage call-offs: super_admin, admin, warehouse_director, department_manager, warehouse_manager
  const canManageCallOffs =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director" ||
    user?.role === "department_manager" ||
    user?.role === "warehouse_manager";

  // Manage announcements: super_admin, admin, warehouse_director
  const canManageAnnouncements =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director";

  // Moderate chat: super_admin, admin, warehouse_director, department_manager
  const canModerateChat =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "warehouse_director" ||
    user?.role === "department_manager";

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        logout,
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
