"use client";

import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useTheme } from "../theme-context";

// Tier badge colors
const TIER_BADGE_COLORS: Record<number, string> = {
  5: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  4: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  3: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  2: "bg-green-500/20 text-green-400 border-green-500/30",
  1: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  0: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

// Tier background gradients for level headers
const TIER_GRADIENTS: Record<number, { dark: string; light: string }> = {
  5: { dark: "from-purple-900/30 to-purple-800/10", light: "from-purple-100 to-purple-50" },
  4: { dark: "from-cyan-900/30 to-cyan-800/10", light: "from-cyan-100 to-cyan-50" },
  3: { dark: "from-blue-900/30 to-blue-800/10", light: "from-blue-100 to-blue-50" },
  2: { dark: "from-green-900/30 to-green-800/10", light: "from-green-100 to-green-50" },
  1: { dark: "from-amber-900/30 to-amber-800/10", light: "from-amber-100 to-amber-50" },
  0: { dark: "from-slate-900/30 to-slate-800/10", light: "from-slate-100 to-slate-50" },
};

interface OrgUser {
  _id: string;
  name: string;
  email?: string;
  role: string;
  roleLabel: string;
  tier: number;
  tierBadge: string;
  managedDepartments: string[];
  managedLocationNames: string[];
  isFinalTimeApprover?: boolean;
  isPayrollProcessor?: boolean;
  requiresDailyLog?: boolean;
}

// Individual user card component
function OrgCard({ user, isDark }: { user: OrgUser; isDark: boolean }) {
  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const hasSpecialFlags = user.isFinalTimeApprover || user.isPayrollProcessor || user.requiresDailyLog;

  return (
    <div
      className={`relative p-4 rounded-xl border min-w-[180px] max-w-[220px] ${
        isDark
          ? "bg-slate-800/50 border-slate-700 hover:bg-slate-800"
          : "bg-white border-gray-200 shadow-sm hover:shadow-md"
      } transition-all`}
    >
      {/* Connector line from above */}
      <div
        className={`absolute -top-3 left-1/2 -translate-x-1/2 w-0.5 h-3 ${
          isDark ? "bg-slate-600" : "bg-gray-300"
        }`}
      />

      {/* Avatar */}
      <div className="flex justify-center mb-3">
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold ${
            isDark
              ? "bg-gradient-to-br from-cyan-400 to-blue-500"
              : "bg-gradient-to-br from-blue-500 to-blue-600"
          }`}
        >
          {initials}
        </div>
      </div>

      {/* Name */}
      <h3
        className={`text-sm font-semibold text-center truncate ${
          isDark ? "text-white" : "text-gray-900"
        }`}
      >
        {user.name}
      </h3>

      {/* Role badge */}
      <div className="flex justify-center mt-2 gap-1">
        <span
          className={`px-2 py-0.5 text-xs font-medium rounded border ${
            TIER_BADGE_COLORS[user.tier] || TIER_BADGE_COLORS[0]
          }`}
        >
          {user.tierBadge}
        </span>
        <span
          className={`px-2 py-0.5 text-xs rounded ${
            isDark ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-600"
          }`}
        >
          {user.roleLabel}
        </span>
      </div>

      {/* Special flags */}
      {hasSpecialFlags && (
        <div className="flex flex-wrap justify-center gap-1 mt-2">
          {user.isFinalTimeApprover && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              Final Approver
            </span>
          )}
          {user.isPayrollProcessor && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              Payroll
            </span>
          )}
          {user.requiresDailyLog && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-orange-500/20 text-orange-400 border border-orange-500/30">
              Daily Log
            </span>
          )}
        </div>
      )}

      {/* Managed items */}
      {(user.managedDepartments.length > 0 ||
        user.managedLocationNames.length > 0) && (
        <div
          className={`mt-3 pt-3 border-t ${
            isDark ? "border-slate-700" : "border-gray-200"
          }`}
        >
          {user.managedDepartments.length > 0 && (
            <div className="mb-1">
              <p
                className={`text-[10px] uppercase tracking-wide ${
                  isDark ? "text-slate-500" : "text-gray-400"
                }`}
              >
                Departments
              </p>
              <p
                className={`text-xs ${
                  isDark ? "text-slate-300" : "text-gray-600"
                }`}
              >
                {user.managedDepartments.join(", ")}
              </p>
            </div>
          )}
          {user.managedLocationNames.length > 0 && (
            <div>
              <p
                className={`text-[10px] uppercase tracking-wide ${
                  isDark ? "text-slate-500" : "text-gray-400"
                }`}
              >
                Locations
              </p>
              <p
                className={`text-xs ${
                  isDark ? "text-slate-300" : "text-gray-600"
                }`}
              >
                {user.managedLocationNames.join(", ")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Tier level component
function TierLevel({
  tier,
  tierLabel,
  users,
  permissions,
  isDark,
  isFirst,
}: {
  tier: number;
  tierLabel: string;
  users: OrgUser[];
  permissions: string[];
  isDark: boolean;
  isFirst: boolean;
}) {
  if (users.length === 0) return null;

  const gradient = TIER_GRADIENTS[tier] || TIER_GRADIENTS[0];

  return (
    <div className="flex flex-col items-center relative w-full">
      {/* Vertical connector from above (except first level) */}
      {!isFirst && (
        <div
          className={`w-0.5 h-6 ${isDark ? "bg-slate-600" : "bg-gray-300"}`}
        />
      )}

      {/* Tier header with permissions */}
      <div
        className={`rounded-xl px-6 py-4 mb-4 bg-gradient-to-r ${
          isDark ? gradient.dark + " border border-slate-700" : gradient.light + " border border-gray-200 shadow-sm"
        }`}
      >
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <span
            className={`px-3 py-1.5 rounded-full text-sm font-bold ${
              TIER_BADGE_COLORS[tier] || TIER_BADGE_COLORS[0]
            }`}
          >
            {tierLabel} ({users.length})
          </span>
          <div className="flex flex-wrap justify-center gap-1 max-w-lg">
            {permissions.slice(0, 4).map((perm, idx) => (
              <span
                key={idx}
                className={`px-2 py-0.5 text-[10px] rounded ${
                  isDark ? "bg-slate-700/50 text-slate-400" : "bg-white/70 text-gray-500"
                }`}
              >
                {perm}
              </span>
            ))}
            {permissions.length > 4 && (
              <span
                className={`px-2 py-0.5 text-[10px] rounded ${
                  isDark ? "bg-slate-700/50 text-slate-400" : "bg-white/70 text-gray-500"
                }`}
              >
                +{permissions.length - 4} more
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Cards container */}
      <div className="relative">
        {/* Horizontal connector line (if multiple cards) — hidden on mobile where cards stack */}
        {users.length > 1 && (
          <div
            className={`hidden sm:block absolute top-0 left-[90px] right-[90px] h-0.5 -translate-y-3 ${
              isDark ? "bg-slate-600" : "bg-gray-300"
            }`}
          />
        )}

        {/* Cards */}
        <div className="flex flex-wrap justify-center gap-4">
          {users.map((user) => (
            <OrgCard key={user._id} user={user} isDark={isDark} />
          ))}
        </div>
      </div>
    </div>
  );
}

function OrgChartContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const orgData = useQuery(api.orgChart.getOrgChartData);

  // Loading state
  if (!orgData) {
    return (
      <div
        className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}
      >
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div
            className={`text-center ${
              isDark ? "text-slate-400" : "text-gray-500"
            }`}
          >
            Loading org chart...
          </div>
        </main>
      </div>
    );
  }

  // Track if we've rendered any level (for first level detection)
  let renderedLevels = 0;

  return (
    <div
      className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}
    >
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Header */}
        <header
          className={`sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 ${
            isDark
              ? "bg-slate-900/80 border-slate-700"
              : "bg-white/80 border-gray-200"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <h1
                className={`text-xl sm:text-2xl font-bold ${
                  isDark ? "text-white" : "text-gray-900"
                }`}
              >
                Organization Chart
              </h1>
              <p
                className={`text-xs sm:text-sm mt-1 ${
                  isDark ? "text-slate-400" : "text-gray-500"
                }`}
              >
                RBAC Tier-based hierarchy (T5 - T1)
              </p>
            </div>
            <div
              className={`text-sm ${
                isDark ? "text-slate-400" : "text-gray-500"
              }`}
            >
              {orgData.totalUsers} active users
            </div>
          </div>
        </header>

        {/* Tree */}
        <div className="p-4 sm:p-8">
          <div className="flex flex-col items-center gap-6">
            {orgData.tierHierarchy.map((tier: number) => {
              const users = orgData.usersByTier[tier] || [];
              if (users.length === 0) return null;

              const isFirst = renderedLevels === 0;
              renderedLevels++;

              return (
                <TierLevel
                  key={tier}
                  tier={tier}
                  tierLabel={orgData.tierLabels[tier] || `T${tier}`}
                  users={users}
                  permissions={orgData.tierPermissions?.[tier] || []}
                  isDark={isDark}
                  isFirst={isFirst}
                />
              );
            })}
          </div>

          {/* Empty state */}
          {orgData.totalUsers === 0 && (
            <div className="text-center py-12">
              <p className={isDark ? "text-slate-500" : "text-gray-500"}>
                No users found in the organization.
              </p>
            </div>
          )}

          {/* Legend */}
          <div className={`mt-12 pt-8 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
            <h3 className={`text-sm font-semibold mb-4 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
              RBAC Tier Legend
            </h3>
            <div className="flex flex-wrap gap-4">
              {[5, 4, 3, 2, 1].map((tier) => (
                <div key={tier} className="flex items-center gap-2">
                  <span className={`px-2 py-1 text-xs font-medium rounded border ${TIER_BADGE_COLORS[tier]}`}>
                    T{tier}
                  </span>
                  <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    {tier === 5 && "Super Admin"}
                    {tier === 4 && "Admin"}
                    {tier === 3 && "Director"}
                    {tier === 2 && "Manager"}
                    {tier === 1 && "Shift Lead"}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-4 mt-3">
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Final Approver
                </span>
                <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Can give final time approval
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 text-[10px] rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  Payroll
                </span>
                <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Can process payroll exports
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 text-[10px] rounded bg-orange-500/20 text-orange-400 border border-orange-500/30">
                  Daily Log
                </span>
                <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Required to submit daily logs
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function OrgChartPage() {
  return (
    <Protected minTier={4}>
      <OrgChartContent />
    </Protected>
  );
}
