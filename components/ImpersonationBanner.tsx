"use client";

import { useAuth } from "@/app/auth-context";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  warehouse_director: "Warehouse Director",
  warehouse_manager: "Warehouse Manager",
  retail_store_manager: "Retail Store Manager",
  department_manager: "Department Manager",
  office_manager: "Office Manager",
  shift_lead: "Shift Lead",
  member: "Member",
  employee: "Employee",
};

export default function ImpersonationBanner() {
  const { isImpersonating, impersonation, stopImpersonation } = useAuth();

  if (!isImpersonating || !impersonation) return null;

  const roleLabel = ROLE_LABELS[impersonation.targetRole] || impersonation.targetRole;

  return (
    <div className="fixed top-0 left-0 right-0 z-[101] bg-amber-500 text-black shadow-md">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-2 min-w-0 text-sm font-medium">
          <span aria-hidden>👁</span>
          <span className="truncate">
            Acting as <strong>{impersonation.targetUserName}</strong>
            <span className="hidden sm:inline"> · {roleLabel}</span> — changes save as them.
          </span>
        </div>
        <button
          onClick={stopImpersonation}
          className="shrink-0 px-3 py-1 rounded-full bg-black/85 text-white text-xs font-semibold hover:bg-black transition-colors"
        >
          Return to {impersonation.realUserName}
        </button>
      </div>
    </div>
  );
}
