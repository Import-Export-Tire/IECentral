"use client";

import { useAuth } from "./auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { usePermissions } from "@/lib/usePermissions";
import { Tier } from "@/lib/permissions";

interface ProtectedProps {
  children: React.ReactNode;
  requireAdmin?: boolean; // Deprecated: use minTier instead
  requiredRoles?: string[]; // Array of allowed roles (for backwards compatibility)
  minTier?: Tier; // Minimum tier required (0-5)
  requireFlag?: "isFinalTimeApprover" | "isPayrollProcessor" | "requiresDailyLog" | "hasEmailAccess"; // Require specific flag
  requirePermission?: string; // Require a resolved permission key (role default OR per-user override), e.g. "safetyReports.review"
}

export default function Protected({
  children,
  requireAdmin = false,
  requiredRoles,
  minTier,
  requireFlag,
  requirePermission
}: ProtectedProps) {
  const { user, isLoading } = useAuth();
  const permissions = usePermissions();
  const router = useRouter();

  // Check if user has required role (legacy support)
  const hasRequiredRole = () => {
    if (!user) return false;
    if (!requiredRoles || requiredRoles.length === 0) return true;
    return requiredRoles.includes(user.role);
  };

  // Check tier-based access
  const hasRequiredTier = () => {
    if (minTier === undefined) return true;
    return permissions.tier >= minTier;
  };

  // Check flag-based access
  const hasRequiredFlag = () => {
    if (!requireFlag) return true;
    if (requireFlag === "isFinalTimeApprover") return permissions.isFinalTimeApprover;
    if (requireFlag === "isPayrollProcessor") return permissions.isPayrollProcessor;
    if (requireFlag === "requiresDailyLog") return permissions.requiresDailyLog;
    if (requireFlag === "hasEmailAccess") return permissions.hasEmailAccess;
    return true;
  };

  // Determine if user has access
  const hasAccess = () => {
    if (!user) return false;

    // A resolved permission (role default OR per-user override) grants access on
    // its own — this is how a scoped grant lets a non-admin in past a role gate.
    if (requirePermission && permissions.hasPermission(requirePermission)) return true;

    // Check legacy requireAdmin
    if (requireAdmin && user.role !== "admin" && user.role !== "super_admin") return false;

    // Check required roles (legacy)
    if (requiredRoles && !hasRequiredRole()) return false;

    // Check tier-based access (new RBAC)
    if (!hasRequiredTier()) return false;

    // Check flag-based access
    if (!hasRequiredFlag()) return false;

    return true;
  };

  useEffect(() => {
    if (!isLoading && !permissions.isLoading && !user) {
      router.push("/login");
    }
    if (!isLoading && !permissions.isLoading && user && !hasAccess()) {
      router.push("/");
    }
  }, [user, isLoading, router, permissions.isLoading, permissions.tier]);

  if (isLoading || permissions.isLoading) {
    return (
      <div className="min-h-screen theme-bg-primary flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--accent-primary)] mx-auto mb-4"></div>
          <p className="theme-text-tertiary">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || !hasAccess()) {
    return null;
  }

  return <>{children}</>;
}
