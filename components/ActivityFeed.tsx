"use client";

import React from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { useTheme } from "@/app/theme-context";
import { useAuth } from "@/app/auth-context";

interface Activity {
  id: string;
  type: string;
  title: string;
  description: string;
  entityType?: string;
  entityId?: string;
  createdAt: number;
  icon: string;
  color: string;
}

const iconComponents: Record<string, (color: string) => React.ReactNode> = {
  document: (color) => (
    <svg className={`w-4 h-4 text-${color}-400`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  check: (color) => (
    <svg className={`w-4 h-4 text-${color}-400`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ),
  "check-circle": (color) => (
    <svg className={`w-4 h-4 text-${color}-400`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  calendar: (color) => (
    <svg className={`w-4 h-4 text-${color}-400`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  folder: (color) => (
    <svg className={`w-4 h-4 text-${color}-400`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  ),
  "user-add": (color) => (
    <svg className={`w-4 h-4 text-${color}-400`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
    </svg>
  ),
  "shield-check": (color) => (
    <svg className={`w-4 h-4 text-${color}-400`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  chat: (color) => (
    <svg className={`w-4 h-4 text-${color}-400`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
};

const colorStyles: Record<string, { bg: string; icon: string }> = {
  purple: { bg: "bg-purple-500/20", icon: "text-purple-400" },
  green: { bg: "bg-green-500/20", icon: "text-green-400" },
  orange: { bg: "bg-orange-500/20", icon: "text-orange-400" },
  cyan: { bg: "bg-cyan-500/20", icon: "text-cyan-400" },
  blue: { bg: "bg-blue-500/20", icon: "text-blue-400" },
  slate: { bg: "bg-slate-500/20", icon: "text-slate-400" },
};

function getEntityLink(entityType?: string, entityId?: string): string | null {
  if (!entityType || !entityId) return null;

  switch (entityType) {
    case "application":
      return `/applications/${entityId}`;
    case "project":
      return "/projects";
    case "personnel":
      return `/personnel/${entityId}`;
    default:
      return null;
  }
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

interface ActivityFeedProps {
  limit?: number;
  showHeader?: boolean;
  compact?: boolean;
}

export default function ActivityFeed({
  limit = 20,
  showHeader = true,
  compact = false,
}: ActivityFeedProps) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const isDark = theme === "dark";
  const activities = useQuery(
    api.activity.getRecentActivity,
    user ? { limit, requestingUserId: user._id } : "skip"
  );

  if (!activities) {
    return (
      <div className={`border rounded-xl p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
        {showHeader && (
          <div className="flex items-center justify-between mb-6">
            <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
              Activity Feed
            </h2>
          </div>
        )}
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500"></div>
        </div>
      </div>
    );
  }

  return (
    <div className={`border rounded-xl ${compact ? "p-4" : "p-6"} ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
      {showHeader && (
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
            Activity Feed
          </h2>
          <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            {activities.length} recent events
          </span>
        </div>
      )}

      {activities.length === 0 ? (
        <div className={`text-center py-8 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
          <svg
            className={`w-12 h-12 mx-auto mb-3 ${isDark ? "text-slate-600" : "text-gray-300"}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p>No recent activity</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map((activity: Activity) => {
            const colors = colorStyles[activity.color] || colorStyles.slate;
            const IconComponent = iconComponents[activity.icon];
            const link = getEntityLink(activity.entityType, activity.entityId);

            const content = (
              <div
                className={`flex items-start gap-3 ${compact ? "py-2" : "p-3"} rounded-lg ${
                  link
                    ? isDark
                      ? "hover:bg-slate-700/50 cursor-pointer"
                      : "hover:bg-gray-50 cursor-pointer"
                    : ""
                } transition-colors`}
              >
                <div className={`flex-shrink-0 p-2 rounded-lg ${colors.bg}`}>
                  {IconComponent ? IconComponent(activity.color) : (
                    <div className={`w-4 h-4 ${colors.icon}`} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                      {activity.title}
                    </span>
                    <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      {formatTimeAgo(activity.createdAt)}
                    </span>
                  </div>
                  <p className={`text-sm truncate ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                    {activity.description}
                  </p>
                </div>
              </div>
            );

            return link ? (
              <Link key={activity.id} href={link}>
                {content}
              </Link>
            ) : (
              <div key={activity.id}>{content}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
