"use client";

import React, { useState } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "../auth-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { Id } from "@/convex/_generated/dataModel";
import { useWebPush } from "@/lib/useWebPush";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

const typeIcons: Record<string, React.ReactNode> = {
  tenure_check_in: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  write_up_follow_up: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  review_due: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  default: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ),
};

// Data-driven: type colors are semantic, not theme-only — keep as-is
const typeColors: Record<string, { bg: string; text: string }> = {
  tenure_check_in: { bg: "bg-amber-500/20", text: "text-amber-400" },
  write_up_follow_up: { bg: "bg-red-500/20", text: "text-red-400" },
  review_due: { bg: "bg-green-500/20", text: "text-green-400" },
  default: { bg: "bg-[#007AFF]/10", text: "text-[#007AFF]" },
};

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

function NotificationsContent() {
  const { user } = useAuth();

  const [filter, setFilter] = useState<"all" | "unread">("all");
  const { isSupported: pushSupported, isSubscribed: pushSubscribed, subscribeToPush, unsubscribeFromPush, isLoading: pushLoading } = useWebPush(user?._id);

  const notifications = useQuery(
    api.notifications.getByUser,
    user?._id ? { userId: user._id } : "skip"
  );

  const markAsRead = useMutation(api.notifications.markAsRead);
  const markAllAsRead = useMutation(api.notifications.markAllAsRead);
  const dismiss = useMutation(api.notifications.dismiss);

  const handleMarkAsRead = async (notificationId: Id<"notifications">) => {
    await markAsRead({ notificationId });
  };

  const handleMarkAllAsRead = async () => {
    if (user?._id) {
      await markAllAsRead({ userId: user._id });
    }
  };

  const handleDismiss = async (notificationId: Id<"notifications">) => {
    await dismiss({ notificationId });
  };

  const filteredNotifications = notifications?.filter((n) =>
    filter === "all" ? true : !n.isRead
  );

  const unreadCount = notifications?.filter((n) => !n.isRead).length || 0;

  return (
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Header */}
        <header className="sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">
                Notifications
              </h1>
              <p className="text-xs sm:text-sm mt-1 theme-text-tertiary">
                {unreadCount > 0 ? `${unreadCount} unread` : "All caught up!"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMarkAllAsRead}
                >
                  Mark all as read
                </Button>
              )}
              {pushSupported && (
                <button
                  onClick={pushSubscribed ? unsubscribeFromPush : subscribeToPush}
                  disabled={pushLoading}
                  className={`p-2 rounded-lg transition-colors ${
                    pushSubscribed
                      ? "text-[#007AFF] bg-[#007AFF]/10"
                      : "theme-text-tertiary hover:theme-text-primary hover:bg-gray-100 dark:hover:bg-slate-700"
                  }`}
                  title={pushSubscribed ? "Push notifications enabled" : "Enable push notifications"}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-8">
          {/* Filter Tabs */}
          <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit bg-gray-100 dark:bg-slate-800">
            <button
              onClick={() => setFilter("all")}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                filter === "all"
                  ? "bg-white dark:bg-slate-700 theme-text-primary shadow-sm"
                  : "theme-text-tertiary hover:theme-text-secondary"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter("unread")}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                filter === "unread"
                  ? "bg-white dark:bg-slate-700 theme-text-primary shadow-sm"
                  : "theme-text-tertiary hover:theme-text-secondary"
              }`}
            >
              Unread
              {unreadCount > 0 && (
                <span className="ui-badge ui-badge-blue px-1.5 py-0.5">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>

          {/* Notifications List */}
          <Card padding="sm" className="overflow-hidden p-0">
            {!notifications ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#007AFF]"></div>
              </div>
            ) : filteredNotifications && filteredNotifications.length > 0 ? (
              <div className="divide-y theme-border-secondary">
                {filteredNotifications.map((notification) => {
                  const colors = typeColors[notification.type] || typeColors.default;
                  const icon = typeIcons[notification.type] || typeIcons.default;

                  return (
                    <div
                      key={notification._id}
                      className={`p-4 sm:p-5 transition-colors ${
                        !notification.isRead
                          ? "bg-[#007AFF]/5"
                          : ""
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        {/* Type icon — data-driven color kept */}
                        <div className={`flex-shrink-0 p-2.5 rounded-xl ${colors.bg} ${colors.text}`}>
                          {icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h3 className="font-medium theme-text-primary">
                                {notification.title}
                              </h3>
                              <p className="text-sm mt-0.5 theme-text-secondary">
                                {notification.message}
                              </p>
                            </div>
                            <span className="flex-shrink-0 text-xs theme-text-tertiary">
                              {formatTimeAgo(notification.createdAt)}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-3">
                            {notification.link && (
                              <Link
                                href={notification.link}
                                onClick={() => !notification.isRead && handleMarkAsRead(notification._id)}
                                className="text-sm font-medium text-[#007AFF] hover:opacity-80"
                              >
                                View Details
                              </Link>
                            )}
                            {!notification.isRead && (
                              <button
                                onClick={() => handleMarkAsRead(notification._id)}
                                className="text-sm theme-text-tertiary hover:theme-text-secondary"
                              >
                                Mark as read
                              </button>
                            )}
                            <button
                              onClick={() => handleDismiss(notification._id)}
                              className="text-sm theme-text-tertiary hover:text-red-500"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                        {/* Unread indicator dot */}
                        {!notification.isRead && (
                          <div className="flex-shrink-0 w-2 h-2 rounded-full bg-[#007AFF] mt-1"></div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 theme-text-tertiary">
                <svg
                  className="w-16 h-16 mx-auto mb-4 opacity-30"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
                <p className="text-lg font-medium mb-1 theme-text-secondary">
                  {filter === "unread" ? "No unread notifications" : "No notifications"}
                </p>
                <p className="text-sm">
                  {filter === "unread"
                    ? "You're all caught up!"
                    : "You'll see notifications about check-ins, reviews, and more here."}
                </p>
              </div>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <Protected>
      <NotificationsContent />
    </Protected>
  );
}
