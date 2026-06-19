"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Protected from "./protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "./auth-context";
import { useTheme } from "./theme-context";
import { usePermissions } from "@/lib/usePermissions";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { SearchButton } from "@/components/GlobalSearch";
import ActivityFeed from "@/components/ActivityFeed";
import EmailWidget from "@/components/EmailWidget";
import FinancialSnapshotWidget from "@/components/FinancialSnapshotWidget";
import SafetyReportsWidget from "@/components/SafetyReportsWidget";
import { Id } from "@/convex/_generated/dataModel";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Combined type for website messages
interface WebsiteMessage {
  _id: string;
  type: "contact" | "dealer";
  name: string;
  email: string;
  subject?: string;
  businessName?: string;
  status: string;
  createdAt: number;
}

// Broadcast message interface
interface BroadcastMessage {
  _id: Id<"broadcastMessages">;
  title: string;
  content: string;
  type: string;
  priority: string;
  createdByName: string;
  createdAt: number;
}

// Dashboard cards info
const DASHBOARD_CARDS = [
  { id: "dayAtGlance", label: "Day at a Glance", description: "Today's calendar events and schedule" },
  { id: "projects", label: "Active Projects", description: "Your active and recent projects" },
  { id: "applications", label: "Recent Applications", description: "New job applications" },
  { id: "websiteMessages", label: "Website Messages", description: "Contact forms and dealer inquiries" },
  { id: "hiringAnalytics", label: "Hiring Analytics", description: "Hiring metrics and upcoming interviews" },
  { id: "activityFeed", label: "Activity Feed", description: "Recent system activity" },
  { id: "tenureCheckIns", label: "Tenure Check-ins", description: "Due employee milestone reviews" },
  { id: "email", label: "Email", description: "Recent unread emails from your inbox" },
  { id: "financialSnapshot", label: "Financial Snapshot", description: "Sales KPIs and revenue breakdown (super admin)" },
  { id: "safetyReports", label: "Safety Reports", description: "Anonymous See Something, Say Something reports (super admin)" },
];

// Sortable card component for settings modal
function SortableCard({
  card,
  enabled,
  onToggle,
  isDark,
}: {
  card: { id: string; label: string; description: string };
  enabled: boolean;
  onToggle: () => void;
  isDark: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-4 rounded-lg border cursor-default transition-colors ${
        enabled
          ? isDark ? "bg-cyan-500/10 border-cyan-500/30" : "bg-blue-50 border-blue-200"
          : isDark ? "bg-slate-900/50 border-slate-700" : "bg-gray-50 border-gray-200"
      }`}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className={`cursor-grab active:cursor-grabbing p-1 rounded ${isDark ? "text-slate-500 hover:text-slate-300" : "text-gray-400 hover:text-gray-600"}`}
        title="Drag to reorder"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
        </svg>
      </button>

      <div className="flex-1 min-w-0">
        <p className={`font-medium text-sm ${isDark ? "text-white" : "text-gray-900"}`}>{card.label}</p>
        <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{card.description}</p>
      </div>

      <label className="cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={onToggle} className="sr-only" />
        <div className={`relative w-11 h-6 rounded-full transition-colors ${
          enabled ? (isDark ? "bg-cyan-500" : "bg-blue-500") : (isDark ? "bg-slate-600" : "bg-gray-300")
        }`}>
          <div className={`absolute w-5 h-5 bg-white rounded-full top-0.5 transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`} />
        </div>
      </label>
    </div>
  );
}

function DashboardContent() {
  const { user, isOfficeManager, isSuperAdmin } = useAuth();
  const { theme } = useTheme();
  const router = useRouter();
  const isDark = theme === "dark";
  const permissions = usePermissions();
  const widgets = permissions.dashboardWidgets;

  // UI State
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [broadcastForm, setBroadcastForm] = useState({
    title: "",
    content: "",
    type: "info",
    priority: "normal",
    targetRoles: [] as string[],
  });

  // Redirect department managers to their portal
  const isDepartmentManager = user?.role === "department_manager";
  // Redirect employees to their portal
  const isEmployee = user?.role === "employee";

  useEffect(() => {
    if (isDepartmentManager) {
      router.replace("/department-portal");
    } else if (isEmployee) {
      router.replace("/portal");
    }
  }, [isDepartmentManager, isEmployee, router]);

  const shouldSkipQueries = isDepartmentManager || isEmployee;
  // Office managers only see projects - skip other queries
  const shouldSkipPeopleQueries = shouldSkipQueries || isOfficeManager;

  const projects = useQuery(api.projects.getAll, shouldSkipQueries ? "skip" : (user?._id ? { userId: user._id } : {}));
  const applications = useQuery(api.applications.getRecent, shouldSkipPeopleQueries ? "skip" : undefined);
  const upcomingInterviews = useQuery(api.applications.getUpcomingInterviews, shouldSkipPeopleQueries ? "skip" : undefined);
  const recentInterviews = useQuery(api.applications.getRecentInterviews, shouldSkipPeopleQueries ? "skip" : undefined);
  const hiringAnalytics = useQuery(api.applications.getHiringAnalytics, shouldSkipPeopleQueries ? "skip" : undefined);
  const scoreHistory = useQuery(api.applications.getScoreHistory, shouldSkipPeopleQueries ? "skip" : { months: 6 });
  const contactMessages = useQuery(api.contactMessages.getRecent, shouldSkipPeopleQueries ? "skip" : undefined);
  const dealerInquiries = useQuery(api.dealerInquiries.getRecent, shouldSkipPeopleQueries ? "skip" : undefined);
  const pendingTenureCheckIns = useQuery(api.personnel.getPendingTenureCheckIns, shouldSkipPeopleQueries ? "skip" : undefined);

  // Today's events for Day at a Glance
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const todayEvents = useQuery(
    api.events.listMyEvents,
    shouldSkipQueries || !user?._id ? "skip" : {
      userId: user._id,
      startDate: todayStart.getTime(),
      endDate: todayEnd.getTime(),
    }
  );

  // Daily log reminder - check if today's log is submitted
  const today = new Date().toISOString().split("T")[0];
  const todaysDailyLog = useQuery(
    api.dailyLogs.getByDate,
    user?.requiresDailyLog && user?._id ? { userId: user._id, date: today } : "skip"
  );
  // Check if it's after 3pm (15:00)
  const [showDailyLogReminder, setShowDailyLogReminder] = useState(false);
  useEffect(() => {
    const checkTime = () => {
      const now = new Date();
      const hour = now.getHours();
      // Show reminder after 3pm if daily log not submitted
      const shouldShow = hour >= 15 &&
        user?.requiresDailyLog === true &&
        todaysDailyLog !== undefined &&
        !todaysDailyLog?.isSubmitted;
      setShowDailyLogReminder(shouldShow);
    };
    checkTime();
    const interval = setInterval(checkTime, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [todaysDailyLog, user?.requiresDailyLog]);

  // Broadcast messages
  const broadcastMessages = useQuery(
    api.broadcastMessages.getActiveForUser,
    user ? { userId: user._id, userRole: user.role } : "skip"
  ) as BroadcastMessage[] | undefined;
  const dismissBroadcast = useMutation(api.broadcastMessages.dismiss);
  const createBroadcast = useMutation(api.broadcastMessages.create);

  // Dashboard settings
  const dashboardSettings = useQuery(
    api.dashboardSettings.getSettingsWithDefaults,
    user ? { userId: user._id, userRole: user.role } : "skip"
  );
  const saveSettings = useMutation(api.dashboardSettings.saveSettings);
  const toggleCard = useMutation(api.dashboardSettings.toggleCard);
  const resetSettings = useMutation(api.dashboardSettings.resetToDefaults);

  // Check if a card is enabled
  const isCardEnabled = (cardId: string) => {
    if (!dashboardSettings) return true;
    return dashboardSettings.enabledCards.includes(cardId);
  };

  // Get ordered cards for settings modal
  const [settingsCardOrder, setSettingsCardOrder] = useState<string[]>([]);
  useEffect(() => {
    if (dashboardSettings?.cardOrder) {
      // Start from saved order, add any new cards not yet in order
      const saved = dashboardSettings.cardOrder;
      const allIds = DASHBOARD_CARDS.map((c) => c.id);
      const ordered = [...saved.filter((id: string) => allIds.includes(id))];
      for (const id of allIds) {
        if (!ordered.includes(id)) ordered.push(id);
      }
      setSettingsCardOrder(ordered);
    } else {
      setSettingsCardOrder(DASHBOARD_CARDS.map((c) => c.id));
    }
  }, [dashboardSettings]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Handle drag end — reorder and persist
  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !user) return;

      const oldIndex = settingsCardOrder.indexOf(active.id as string);
      const newIndex = settingsCardOrder.indexOf(over.id as string);
      const newOrder = arrayMove(settingsCardOrder, oldIndex, newIndex);
      setSettingsCardOrder(newOrder);

      // Persist
      await saveSettings({
        userId: user._id,
        enabledCards: dashboardSettings?.enabledCards ?? DASHBOARD_CARDS.map((c) => c.id),
        cardOrder: newOrder,
      });
    },
    [settingsCardOrder, user, saveSettings, dashboardSettings]
  );

  // Handle card toggle
  const handleToggleCard = async (cardId: string) => {
    if (!user) return;
    await toggleCard({
      userId: user._id,
      userRole: user.role,
      cardId,
    });
  };

  // Handle broadcast dismiss
  const handleDismissBroadcast = async (messageId: Id<"broadcastMessages">) => {
    if (!user) return;
    await dismissBroadcast({
      messageId,
      userId: user._id,
    });
  };

  // Handle create broadcast
  const handleCreateBroadcast = async () => {
    if (!user) return;
    await createBroadcast({
      title: broadcastForm.title,
      content: broadcastForm.content,
      type: broadcastForm.type,
      priority: broadcastForm.priority,
      targetRoles: broadcastForm.targetRoles.length > 0 ? broadcastForm.targetRoles : undefined,
      createdBy: user._id,
      createdByName: user.name,
    });
    setBroadcastForm({
      title: "",
      content: "",
      type: "info",
      priority: "normal",
      targetRoles: [],
    });
    setShowBroadcastModal(false);
  };

  // Show loading while redirecting
  if (isDepartmentManager || isEmployee) {
    return (
      <div className={`flex h-screen items-center justify-center ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto mb-4"></div>
          <p className={isDark ? "text-slate-400" : "text-gray-500"}>Redirecting to your portal...</p>
        </div>
      </div>
    );
  }

  // Combine and sort website messages
  const websiteMessages: WebsiteMessage[] = [
    ...(contactMessages?.map((m) => ({
      _id: m._id,
      type: "contact" as const,
      name: m.name,
      email: m.email,
      subject: m.subject,
      status: m.status,
      createdAt: m.createdAt,
    })) || []),
    ...(dealerInquiries?.map((i) => ({
      _id: i._id,
      type: "dealer" as const,
      name: i.contactName,
      email: i.email,
      businessName: i.businessName,
      status: i.status,
      createdAt: i.createdAt,
    })) || []),
  ].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);

  const newMessageCount = (contactMessages?.filter((m) => m.status === "new").length || 0) +
    (dealerInquiries?.filter((i) => i.status === "new").length || 0);

  // Calculate stats
  const projectStats = {
    total: projects?.length || 0,
    inProgress: projects?.filter((p) => p.status === "in_progress").length || 0,
    completed: projects?.filter((p) => p.status === "done").length || 0,
    behindSchedule:
      projects?.filter((p) => p.aiTimelineAnalysis?.isOnSchedule === false)
        .length || 0,
  };

  const applicationStats = {
    total: applications?.length || 0,
    new: applications?.filter((a) => a.status === "new").length || 0,
    pending:
      applications?.filter((a) =>
        ["reviewed", "contacted"].includes(a.status)
      ).length || 0,
  };

  return (
    <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        {/* Mobile Header */}
        <MobileHeader />

        {/* Header */}
        <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className={`text-xl sm:text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                Welcome to IECentral, {user?.name?.split(" ")[0] || "User"}
              </h1>
              <p className={`text-xs sm:text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                {new Date().toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              <SearchButton />
              {/* Help Button */}
              <button
                onClick={() => setShowHelp(true)}
                className={`p-2 rounded-lg transition-colors ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-700" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}
                title="Dashboard Help"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
              {/* Settings Button */}
              <button
                onClick={() => setShowSettings(true)}
                className={`p-2 rounded-lg transition-colors ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-700" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}
                title="Customize Dashboard"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              {/* Create Broadcast Button (Super Admin only) */}
              {isSuperAdmin && (
                <button
                  onClick={() => setShowBroadcastModal(true)}
                  className={`hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${isDark ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30" : "bg-blue-100 text-blue-600 hover:bg-blue-200"}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                  </svg>
                  <span className="text-sm font-medium">Broadcast</span>
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-8 space-y-6 sm:space-y-8">
          {/* Broadcast Messages */}
          {broadcastMessages && broadcastMessages.length > 0 && (
            <div className="space-y-3">
              {broadcastMessages.map((msg) => (
                <div
                  key={msg._id}
                  className={`relative rounded-xl p-4 border ${
                    msg.type === "warning"
                      ? isDark ? "bg-amber-500/10 border-amber-500/30" : "bg-amber-50 border-amber-200"
                      : msg.type === "success"
                        ? isDark ? "bg-green-500/10 border-green-500/30" : "bg-green-50 border-green-200"
                        : msg.type === "update"
                          ? isDark ? "bg-purple-500/10 border-purple-500/30" : "bg-purple-50 border-purple-200"
                          : isDark ? "bg-cyan-500/10 border-cyan-500/30" : "bg-blue-50 border-blue-200"
                  }`}
                >
                  <button
                    onClick={() => handleDismissBroadcast(msg._id)}
                    className={`absolute top-3 right-3 p-1 rounded-lg transition-colors ${
                      isDark ? "text-slate-400 hover:text-white hover:bg-slate-700" : "text-gray-400 hover:text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <div className="flex items-start gap-3 pr-8">
                    <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                      msg.type === "warning"
                        ? "bg-amber-500/20"
                        : msg.type === "success"
                          ? "bg-green-500/20"
                          : msg.type === "update"
                            ? "bg-purple-500/20"
                            : isDark ? "bg-cyan-500/20" : "bg-blue-100"
                    }`}>
                      <svg className={`w-4 h-4 ${
                        msg.type === "warning"
                          ? "text-amber-400"
                          : msg.type === "success"
                            ? "text-green-400"
                            : msg.type === "update"
                              ? "text-purple-400"
                              : isDark ? "text-cyan-400" : "text-blue-600"
                      }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {msg.type === "warning" ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        ) : msg.type === "success" ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        ) : msg.type === "update" ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                        )}
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className={`font-semibold ${
                          msg.type === "warning"
                            ? isDark ? "text-amber-300" : "text-amber-700"
                            : msg.type === "success"
                              ? isDark ? "text-green-300" : "text-green-700"
                              : msg.type === "update"
                                ? isDark ? "text-purple-300" : "text-purple-700"
                                : isDark ? "text-cyan-300" : "text-blue-700"
                        }`}>
                          {msg.title}
                        </h3>
                        {msg.priority === "high" && (
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                            isDark ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-600"
                          }`}>
                            Important
                          </span>
                        )}
                      </div>
                      <p className={`text-sm ${
                        msg.type === "warning"
                          ? isDark ? "text-amber-200/80" : "text-amber-600"
                          : msg.type === "success"
                            ? isDark ? "text-green-200/80" : "text-green-600"
                            : msg.type === "update"
                              ? isDark ? "text-purple-200/80" : "text-purple-600"
                              : isDark ? "text-cyan-200/80" : "text-blue-600"
                      }`}>
                        {msg.content}
                      </p>
                      <p className={`text-xs mt-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                        Posted by {msg.createdByName} on {new Date(msg.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Daily Log Reminder */}
          {showDailyLogReminder && (
            <Link href="/daily-log">
              <div className={`rounded-xl p-4 border cursor-pointer transition-all hover:scale-[1.01] ${
                isDark ? "bg-gradient-to-r from-amber-500/10 to-orange-500/10 border-amber-500/30 hover:border-amber-500/50" : "bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200 hover:border-amber-300"
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                      <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${isDark ? "text-amber-300" : "text-amber-700"}`}>
                        Daily Log Reminder
                      </p>
                      <p className={`text-sm ${isDark ? "text-amber-200/80" : "text-amber-600"}`}>
                        {todaysDailyLog ? "Your draft is saved - click here to submit your daily log before leaving." : "Don't forget to fill out your daily activity log before leaving today!"}
                      </p>
                    </div>
                  </div>
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-700"}`}>
                    <span className="text-sm font-medium">Submit Log</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>
          )}

          {/* Day at a Glance - Calendar Events */}
          {isCardEnabled("dayAtGlance") && (
            <div className={`border rounded-xl p-4 sm:p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isDark ? "bg-emerald-500/20" : "bg-emerald-100"}`}>
                    <svg className={`w-5 h-5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                      Day at a Glance
                    </h2>
                    <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                      {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                    </p>
                  </div>
                </div>
                <a
                  href="/calendar"
                  className={`text-sm transition-colors ${isDark ? "text-emerald-400 hover:text-emerald-300" : "text-emerald-600 hover:text-emerald-700"}`}
                >
                  View Calendar
                </a>
              </div>

              {!todayEvents ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500"></div>
                </div>
              ) : todayEvents.length === 0 ? (
                <div className={`text-center py-8 rounded-lg ${isDark ? "bg-slate-900/50" : "bg-gray-50"}`}>
                  <svg className={`w-12 h-12 mx-auto mb-3 ${isDark ? "text-slate-600" : "text-gray-300"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    No events scheduled for today
                  </p>
                  <a href="/calendar" className={`text-sm mt-2 inline-block ${isDark ? "text-emerald-400 hover:text-emerald-300" : "text-emerald-600 hover:text-emerald-700"}`}>
                    + Schedule an event
                  </a>
                </div>
              ) : (
                <div className="space-y-3">
                  {todayEvents.slice(0, 5).map((event) => {
                    const startTime = new Date(event.startTime);
                    const endTime = new Date(event.endTime);
                    const isAllDay = event.isAllDay;
                    const isPast = endTime.getTime() < Date.now();
                    const isOngoing = startTime.getTime() <= Date.now() && endTime.getTime() >= Date.now();

                    return (
                      <div
                        key={event._id}
                        className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                          isPast
                            ? isDark ? "bg-slate-900/30 border-slate-700/30 opacity-60" : "bg-gray-50/50 border-gray-100 opacity-60"
                            : isOngoing
                              ? isDark ? "bg-emerald-500/10 border-emerald-500/30" : "bg-emerald-50 border-emerald-200"
                              : isDark ? "bg-slate-900/50 border-slate-700/50" : "bg-gray-50 border-gray-100"
                        }`}
                      >
                        <div className={`flex-shrink-0 w-16 text-center py-1 rounded ${
                          isOngoing
                            ? isDark ? "bg-emerald-500/20" : "bg-emerald-100"
                            : isDark ? "bg-slate-800" : "bg-white"
                        }`}>
                          {isAllDay ? (
                            <span className={`text-xs font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>All Day</span>
                          ) : (
                            <>
                              <p className={`text-sm font-semibold ${isOngoing ? (isDark ? "text-emerald-400" : "text-emerald-600") : (isDark ? "text-white" : "text-gray-900")}`}>
                                {startTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                              </p>
                              <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                {endTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                              </p>
                            </>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className={`text-sm font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                              {event.title}
                            </h4>
                            {isOngoing && (
                              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-600"}`}>
                                Now
                              </span>
                            )}
                          </div>
                          {event.location && (
                            <p className={`text-xs mt-1 flex items-center gap-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              {event.location}
                            </p>
                          )}
                          {event.meetingLink && (
                            <a
                              href={event.meetingLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`text-xs mt-1 flex items-center gap-1 ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              Join Meeting
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {todayEvents.length > 5 && (
                    <a
                      href="/calendar"
                      className={`block text-center text-sm py-2 ${isDark ? "text-emerald-400 hover:text-emerald-300" : "text-emerald-600 hover:text-emerald-700"}`}
                    >
                      +{todayEvents.length - 5} more events
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Stats Grid - Only show if projects or applications cards are enabled */}
          {((widgets.activeProjects && isCardEnabled("projects")) || (widgets.recentApplications && isCardEnabled("applications"))) && (
          <div className={`grid grid-cols-2 md:grid-cols-2 ${!widgets.recentApplications ? "lg:grid-cols-3" : "lg:grid-cols-4"} gap-3 sm:gap-6`}>
            {/* Projects Stats - Only show if projects card enabled and permission granted */}
            {widgets.activeProjects && isCardEnabled("projects") && (
            <>
            <div className={`border rounded-xl p-4 sm:p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
              <div className="flex items-center justify-between mb-2 sm:mb-4">
                <h3 className={`text-xs sm:text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Active Projects
                </h3>
                <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center ${isDark ? "bg-cyan-500/20" : "bg-blue-100"}`}>
                  <svg
                    className={`w-4 h-4 sm:w-5 sm:h-5 ${isDark ? "text-cyan-400" : "text-blue-600"}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    />
                  </svg>
                </div>
              </div>
              <p className={`text-2xl sm:text-3xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                {projectStats.inProgress}
              </p>
              <p className={`text-xs sm:text-sm mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                {projectStats.total} total projects
              </p>
            </div>

            {/* Completed */}
            <div className={`border rounded-xl p-4 sm:p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
              <div className="flex items-center justify-between mb-2 sm:mb-4">
                <h3 className={`text-xs sm:text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Completed
                </h3>
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                  <svg
                    className="w-4 h-4 sm:w-5 sm:h-5 text-green-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              </div>
              <p className={`text-2xl sm:text-3xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                {projectStats.completed}
              </p>
              <p className={`text-xs sm:text-sm mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>projects done</p>
            </div>

            {/* Behind Schedule */}
            <div className={`border rounded-xl p-4 sm:p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
              <div className="flex items-center justify-between mb-2 sm:mb-4">
                <h3 className={`text-xs sm:text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Behind Schedule
                </h3>
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                  <svg
                    className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400"
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
                </div>
              </div>
              <p className={`text-2xl sm:text-3xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                {projectStats.behindSchedule}
              </p>
              <p className={`text-xs sm:text-sm mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>need attention</p>
            </div>
            </>
            )}

            {/* Applications - Hide based on RBAC permissions and check card setting */}
            {widgets.recentApplications && isCardEnabled("applications") && (
              <div className={`border rounded-xl p-4 sm:p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
                <div className="flex items-center justify-between mb-2 sm:mb-4">
                  <h3 className={`text-xs sm:text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    New Applications
                  </h3>
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                    <svg
                      className="w-4 h-4 sm:w-5 sm:h-5 text-purple-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                  </div>
                </div>
                <p className={`text-2xl sm:text-3xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                  {applicationStats.new}
                </p>
                <p className={`text-xs sm:text-sm mt-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  {applicationStats.total} total
                </p>
              </div>
            )}
          </div>
          )}

          {/* Content Sections */}
          {((widgets.activeProjects && isCardEnabled("projects")) || (widgets.recentApplications && isCardEnabled("applications"))) && (
          <div className={`grid grid-cols-1 ${!widgets.recentApplications ? "" : "lg:grid-cols-2"} gap-4 sm:gap-6`}>
            {/* Recent Projects */}
            {widgets.activeProjects && isCardEnabled("projects") && (
            <div className={`border rounded-xl p-4 sm:p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <h2 className={`text-base sm:text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Recent Projects
                </h2>
                <a
                  href="/projects"
                  className={`text-sm transition-colors ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}
                >
                  View all
                </a>
              </div>
              <div className="space-y-3 sm:space-y-4">
                {projects?.slice(0, 5).map((project) => (
                  <div
                    key={project._id}
                    className={`flex items-center justify-between p-3 sm:p-4 rounded-lg border ${isDark ? "bg-slate-900/50 border-slate-700/50" : "bg-gray-50 border-gray-100"}`}
                  >
                    <div className="flex-1 min-w-0">
                      <h3 className={`text-sm sm:text-base font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                        {project.name}
                      </h3>
                      <p className={`text-xs sm:text-sm truncate ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                        {project.description}
                      </p>
                    </div>
                    <div className="ml-2 sm:ml-4">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded-full whitespace-nowrap ${
                          project.status === "done"
                            ? "bg-green-500/20 text-green-400"
                            : project.status === "in_progress"
                              ? isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-blue-100 text-blue-600"
                              : project.status === "review"
                                ? "bg-amber-500/20 text-amber-400"
                                : isDark ? "bg-slate-500/20 text-slate-400" : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {project.status.replace("_", " ")}
                      </span>
                    </div>
                  </div>
                )) || (
                  <p className={`text-center py-8 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    No projects yet
                  </p>
                )}
              </div>
            </div>
            )}

            {/* Recent Applications - Hide based on RBAC permissions and check card setting */}
            {widgets.recentApplications && isCardEnabled("applications") && (
              <div className={`border rounded-xl p-4 sm:p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
                <div className="flex items-center justify-between mb-4 sm:mb-6">
                  <h2 className={`text-base sm:text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                    Recent Applications
                  </h2>
                  <a
                    href="/applications"
                    className={`text-sm transition-colors ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}
                  >
                    View all
                  </a>
                </div>
                <div className="space-y-3 sm:space-y-4">
                  {applications?.slice(0, 5).map((app) => (
                    <div
                      key={app._id}
                      className={`flex items-center justify-between p-3 sm:p-4 rounded-lg border ${isDark ? "bg-slate-900/50 border-slate-700/50" : "bg-gray-50 border-gray-100"}`}
                    >
                      <div className="flex-1 min-w-0">
                        <h3 className={`text-sm sm:text-base font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                          {app.firstName} {app.lastName}
                        </h3>
                        <p className={`text-xs sm:text-sm truncate ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                          {app.appliedJobTitle}
                        </p>
                      </div>
                      <div className="ml-2 sm:ml-4 flex items-center gap-1 sm:gap-2">
                        {app.candidateAnalysis && (
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded-full ${
                              app.candidateAnalysis.overallScore >= 70
                                ? "bg-green-500/20 text-green-400"
                                : app.candidateAnalysis.overallScore >= 50
                                  ? "bg-amber-500/20 text-amber-400"
                                  : "bg-red-500/20 text-red-400"
                            }`}
                          >
                            {app.candidateAnalysis.overallScore}%
                          </span>
                        )}
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded-full ${
                            app.status === "new"
                              ? isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-blue-100 text-blue-600"
                              : app.status === "reviewed"
                                ? "bg-amber-500/20 text-amber-400"
                                : isDark ? "bg-slate-500/20 text-slate-400" : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {app.status}
                        </span>
                      </div>
                    </div>
                  )) || (
                    <p className={`text-center py-8 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      No applications yet
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
          )}

          {/* Website Messages & Hiring Analytics - Hide based on RBAC permissions and check card settings */}
          {((widgets.websiteMessages && isCardEnabled("websiteMessages")) || (widgets.hiringAnalytics && isCardEnabled("hiringAnalytics"))) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            {/* Website Messages */}
            {widgets.websiteMessages && isCardEnabled("websiteMessages") && (
            <div className={`border rounded-xl p-4 sm:p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <h2 className={`text-base sm:text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Website Messages
                </h2>
                <div className="flex items-center gap-2">
                  {newMessageCount > 0 && (
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-blue-100 text-blue-600"}`}>
                      {newMessageCount} new
                    </span>
                  )}
                  <Link
                    href="/website-messages"
                    className={`text-sm transition-colors ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}
                  >
                    View all
                  </Link>
                </div>
              </div>
              <div className="space-y-3">
                {websiteMessages.length > 0 ? (
                  websiteMessages.map((msg) => (
                    <Link
                      key={`${msg.type}-${msg._id}`}
                      href={`/website-messages?type=${msg.type}&id=${msg._id}`}
                      className={`block p-4 rounded-lg border transition-colors ${isDark ? "bg-slate-900/50 border-slate-700/50 hover:border-slate-600" : "bg-gray-50 border-gray-100 hover:border-gray-300"}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className={`font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                              {msg.type === "dealer" ? msg.businessName : msg.name}
                            </h3>
                            <span className={`px-2 py-0.5 text-xs rounded-full flex-shrink-0 ${
                              msg.type === "dealer"
                                ? isDark ? "bg-purple-500/20 text-purple-400" : "bg-purple-100 text-purple-600"
                                : isDark ? "bg-slate-600/50 text-slate-300" : "bg-gray-200 text-gray-600"
                            }`}>
                              {msg.type === "dealer" ? "Dealer" : "Contact"}
                            </span>
                            {msg.status === "new" && (
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isDark ? "bg-cyan-400" : "bg-blue-500"}`}></span>
                            )}
                          </div>
                          <p className={`text-sm truncate ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                            {msg.type === "dealer" ? msg.name : msg.subject}
                          </p>
                        </div>
                        <p className={`text-xs ml-4 flex-shrink-0 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                          {new Date(msg.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </p>
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className={`text-center py-8 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    <svg className={`w-12 h-12 mx-auto mb-3 ${isDark ? "text-slate-600" : "text-gray-300"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <p>No website messages</p>
                  </div>
                )}
              </div>
            </div>
            )}

            {/* Hiring Analytics */}
            {widgets.hiringAnalytics && isCardEnabled("hiringAnalytics") && (
            <div className={`border rounded-xl p-4 sm:p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <h2 className={`text-base sm:text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Hiring Analytics
                </h2>
                <div className="flex items-center gap-3">
                  {upcomingInterviews && upcomingInterviews.length > 0 && (
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${isDark ? "bg-orange-500/20 text-orange-400" : "bg-orange-100 text-orange-600"}`}>
                      {upcomingInterviews.length} interviews
                    </span>
                  )}
                </div>
              </div>
              {hiringAnalytics ? (
                <div className="space-y-4">
                  {/* Score Comparisons - More compact */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="text-center">
                      <p className={`text-xs mb-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Hired Avg</p>
                      <p className={`text-xl font-bold ${hiringAnalytics.hiredStats.avgOverallScore !== null ? (hiringAnalytics.hiredStats.avgOverallScore >= 70 ? "text-green-400" : hiringAnalytics.hiredStats.avgOverallScore >= 50 ? "text-amber-400" : "text-red-400") : isDark ? "text-slate-500" : "text-gray-400"}`}>
                        {hiringAnalytics.hiredStats.avgOverallScore !== null ? `${hiringAnalytics.hiredStats.avgOverallScore}%` : "—"}
                      </p>
                      <p className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                        {hiringAnalytics.hiredStats.count} hired
                      </p>
                    </div>
                    <div className="text-center">
                      <p className={`text-xs mb-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Interviewed</p>
                      <p className={`text-xl font-bold ${hiringAnalytics.interviewedStats.avgOverallScore !== null ? (hiringAnalytics.interviewedStats.avgOverallScore >= 70 ? "text-green-400" : hiringAnalytics.interviewedStats.avgOverallScore >= 50 ? "text-amber-400" : "text-red-400") : isDark ? "text-slate-500" : "text-gray-400"}`}>
                        {hiringAnalytics.interviewedStats.avgOverallScore !== null ? `${hiringAnalytics.interviewedStats.avgOverallScore}%` : "—"}
                      </p>
                      <p className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                        {hiringAnalytics.interviewedStats.count} total
                      </p>
                    </div>
                    <div className="text-center">
                      <p className={`text-xs mb-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Rejected</p>
                      <p className={`text-xl font-bold ${hiringAnalytics.rejectedStats.avgOverallScore !== null ? (hiringAnalytics.rejectedStats.avgOverallScore >= 70 ? "text-green-400" : hiringAnalytics.rejectedStats.avgOverallScore >= 50 ? "text-amber-400" : "text-red-400") : isDark ? "text-slate-500" : "text-gray-400"}`}>
                        {hiringAnalytics.rejectedStats.avgOverallScore !== null ? `${hiringAnalytics.rejectedStats.avgOverallScore}%` : "—"}
                      </p>
                      <p className={`text-xs ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                        {hiringAnalytics.rejectedStats.count} total
                      </p>
                    </div>
                  </div>

                  {/* Applicant Score Trend Graph */}
                  {scoreHistory && scoreHistory.history.length > 0 && (
                    <div className={`p-3 rounded-lg border ${isDark ? "bg-slate-900/50 border-slate-700" : "bg-gray-50 border-gray-100"}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          Applicant Score Trend
                        </span>
                        {scoreHistory.trend !== "stable" && (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            scoreHistory.trend === "up"
                              ? "bg-green-500/20 text-green-400"
                              : "bg-red-500/20 text-red-400"
                          }`}>
                            {scoreHistory.trend === "up" ? "↑ Improving" : "↓ Declining"}
                          </span>
                        )}
                      </div>
                      <div className="h-24">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={scoreHistory.history} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                            <XAxis
                              dataKey="monthLabel"
                              tick={{ fontSize: 10, fill: isDark ? "#64748b" : "#9ca3af" }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              domain={[0, 100]}
                              tick={{ fontSize: 10, fill: isDark ? "#64748b" : "#9ca3af" }}
                              axisLine={false}
                              tickLine={false}
                              width={30}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: isDark ? "#1e293b" : "#ffffff",
                                border: isDark ? "1px solid #334155" : "1px solid #e5e7eb",
                                borderRadius: "8px",
                                fontSize: "12px",
                              }}
                              labelStyle={{ color: isDark ? "#f1f5f9" : "#111827", fontWeight: 600 }}
                              formatter={(value, name) => {
                                const labels: Record<string, string> = {
                                  avgScore: "Avg Score",
                                  avgHiredScore: "Hired Avg",
                                };
                                return [`${value}%`, labels[String(name)] || name];
                              }}
                            />
                            <Line
                              type="monotone"
                              dataKey="avgScore"
                              stroke={isDark ? "#22d3ee" : "#0ea5e9"}
                              strokeWidth={2}
                              dot={{ fill: isDark ? "#22d3ee" : "#0ea5e9", strokeWidth: 0, r: 3 }}
                              activeDot={{ r: 5 }}
                            />
                            <Line
                              type="monotone"
                              dataKey="avgHiredScore"
                              stroke={isDark ? "#4ade80" : "#22c55e"}
                              strokeWidth={2}
                              strokeDasharray="4 2"
                              dot={{ fill: isDark ? "#4ade80" : "#22c55e", strokeWidth: 0, r: 3 }}
                              activeDot={{ r: 5 }}
                              connectNulls
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex items-center justify-center gap-4 mt-2">
                        <div className="flex items-center gap-1">
                          <div className={`w-3 h-0.5 ${isDark ? "bg-cyan-400" : "bg-sky-500"}`}></div>
                          <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>All Applicants</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className={`w-3 h-0.5 ${isDark ? "bg-green-400" : "bg-green-500"}`} style={{ borderTop: "2px dashed" }}></div>
                          <span className={`text-[10px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>Hired</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Conversion Rates - Compact */}
                  <div className={`p-3 rounded-lg border ${isDark ? "bg-slate-900/50 border-slate-700" : "bg-gray-50 border-gray-100"}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>App → Interview</span>
                      <span className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{hiringAnalytics.conversionRates.interviewRate}%</span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Interview → Hired</span>
                      <span className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{hiringAnalytics.conversionRates.hireRate}%</span>
                    </div>
                    <div className={`flex items-center justify-between mt-2 pt-2 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                      <span className={`text-xs font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>Overall Rate</span>
                      <span className={`text-sm font-bold ${isDark ? "text-cyan-400" : "text-blue-600"}`}>{hiringAnalytics.conversionRates.overallHireRate}%</span>
                    </div>
                  </div>

                  {/* Recent Interviews (Last 2 Weeks) - Show prominently */}
                  {recentInterviews && recentInterviews.length > 0 && (
                    <div className={`pt-3 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                      <div className="flex items-center justify-between mb-2">
                        <p className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>Recent Interviews (Last 2 Weeks)</p>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-600"}`}>
                          {recentInterviews.length} total
                        </span>
                      </div>
                      <div className="space-y-2">
                        {recentInterviews.slice(0, 5).map((interview) => (
                          <Link
                            key={interview._id}
                            href={`/applications/${interview._id}`}
                            className={`flex items-center justify-between p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700/50 bg-slate-800/30" : "hover:bg-gray-100 bg-gray-50"}`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                                {interview.firstName} {interview.lastName}
                              </p>
                              <p className={`text-xs truncate ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                                {interview.appliedJobTitle}
                              </p>
                            </div>
                            <div className="flex items-center gap-3 ml-2 flex-shrink-0">
                              {interview.candidateScore && (
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                                  interview.candidateScore >= 70
                                    ? isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-600"
                                    : interview.candidateScore >= 50
                                    ? isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-600"
                                    : isDark ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-600"
                                }`}>
                                  {interview.candidateScore}%
                                </span>
                              )}
                              <div className="text-right">
                                <p className={`text-xs font-medium ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                                  {new Date(interview.interviewDate).toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                  })}
                                </p>
                                <p className={`text-[10px] capitalize ${
                                  interview.status === "hired"
                                    ? isDark ? "text-green-400" : "text-green-600"
                                    : interview.status === "rejected"
                                    ? isDark ? "text-red-400" : "text-red-600"
                                    : isDark ? "text-slate-500" : "text-gray-500"
                                }`}>
                                  {interview.status}
                                </p>
                              </div>
                            </div>
                          </Link>
                        ))}
                        {recentInterviews.length > 5 && (
                          <Link
                            href="/applications?status=interviewed"
                            className={`block text-center text-xs py-1 ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}
                          >
                            View all {recentInterviews.length} recent interviews
                          </Link>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Upcoming Interviews Section */}
                  {upcomingInterviews && upcomingInterviews.length > 0 && (
                    <div className={`pt-3 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                      <p className={`text-xs font-medium mb-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Upcoming Interviews</p>
                      <div className="space-y-2">
                        {upcomingInterviews.slice(0, 3).map((interview) => (
                          <Link
                            key={interview._id}
                            href={`/applications/${interview._id}`}
                            className={`flex items-center justify-between p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700/50" : "hover:bg-gray-100"}`}
                          >
                            <div className="min-w-0">
                              <p className={`text-sm font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                                {interview.firstName} {interview.lastName}
                              </p>
                              <p className={`text-xs truncate ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                                {interview.appliedJobTitle}
                              </p>
                            </div>
                            <div className="text-right ml-2 flex-shrink-0">
                              <p className={`text-xs font-medium ${isDark ? "text-orange-400" : "text-orange-600"}`}>
                                {interview.scheduledInterviewDate && new Date(interview.scheduledInterviewDate + "T00:00:00").toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </p>
                              <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                                {interview.scheduledInterviewTime}
                              </p>
                            </div>
                          </Link>
                        ))}
                        {upcomingInterviews.length > 3 && (
                          <Link
                            href="/applications?status=interview_scheduled"
                            className={`block text-center text-xs py-1 ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}
                          >
                            View all {upcomingInterviews.length} interviews
                          </Link>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className={`text-center py-8 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  <svg className={`w-12 h-12 mx-auto mb-3 ${isDark ? "text-slate-600" : "text-gray-300"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <p>Loading analytics...</p>
                </div>
              )}
            </div>
            )}
          </div>
          )}

          {/* Financial Snapshot Widget - T5 only */}
          {widgets.financialSnapshot && isCardEnabled("financialSnapshot") && (
            <FinancialSnapshotWidget />
          )}

          {/* Safety Reports (See Something, Say Something) - super admin only, toggleable */}
          {isSuperAdmin && isCardEnabled("safetyReports") && <SafetyReportsWidget />}

          {/* Email Widget */}
          {isCardEnabled("email") && user?.hasEmailAccess && (
            <EmailWidget />
          )}

          {/* Activity Feed & Tenure Check-ins */}
          {((widgets.activityFeed && isCardEnabled("activityFeed")) || (widgets.tenureCheckins && isCardEnabled("tenureCheckIns"))) && (
          <div className={`grid grid-cols-1 ${!widgets.tenureCheckins ? "" : "lg:grid-cols-2"} gap-4 sm:gap-6`}>
            {widgets.activityFeed && isCardEnabled("activityFeed") && <ActivityFeed limit={15} />}

            {/* Pending Tenure Check-ins - Hide based on RBAC permissions and check card setting */}
            {widgets.tenureCheckins && isCardEnabled("tenureCheckIns") && pendingTenureCheckIns && pendingTenureCheckIns.length > 0 && (
              <div className={`border rounded-xl p-4 sm:p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
                <div className="flex items-center justify-between mb-4 sm:mb-6">
                  <h2 className={`text-base sm:text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                    Due Tenure Check-ins
                  </h2>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-600"}`}>
                    {pendingTenureCheckIns.length} pending
                  </span>
                  <Link
                    href="/personnel"
                    className={`text-sm transition-colors ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}
                  >
                    View all
                  </Link>
                </div>
              </div>
              <div className="space-y-3">
                {pendingTenureCheckIns.slice(0, 8).map((item, idx) => (
                  <Link
                    key={`${item.personnelId}-${item.milestone}-${idx}`}
                    href={`/personnel/${item.personnelId}`}
                    className={`block p-4 rounded-lg border transition-colors ${isDark ? "bg-slate-900/50 border-slate-700/50 hover:border-slate-600" : "bg-gray-50 border-gray-100 hover:border-gray-300"}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className={`font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                            {item.personnelName}
                          </h3>
                          <span className={`px-2 py-0.5 text-xs rounded-full flex-shrink-0 ${
                            item.daysOverdue > 7
                              ? isDark ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-600"
                              : item.daysOverdue > 0
                                ? isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-600"
                                : isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-600"
                          }`}>
                            {item.milestoneLabel} Check-in
                          </span>
                        </div>
                        <p className={`text-sm truncate ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                          {item.department}
                        </p>
                      </div>
                      <div className="text-right ml-4 flex-shrink-0">
                        <p className={`text-xs font-medium ${
                          item.daysOverdue > 7
                            ? isDark ? "text-red-400" : "text-red-600"
                            : item.daysOverdue > 0
                              ? isDark ? "text-amber-400" : "text-amber-600"
                              : isDark ? "text-green-400" : "text-green-600"
                        }`}>
                          {item.daysOverdue === 0 ? "Due today" : `${item.daysOverdue} days overdue`}
                        </p>
                        <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                          Hired {new Date(item.hireDate).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
                {pendingTenureCheckIns.length > 8 && (
                  <Link
                    href="/personnel"
                    className={`block text-center text-sm py-2 ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}
                  >
                    View all {pendingTenureCheckIns.length} pending check-ins
                  </Link>
                )}
              </div>
            </div>
          )}
          </div>
          )}

        </div>
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`w-full max-w-lg rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
            <div className="flex items-center justify-between mb-6">
              <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                Customize Your Dashboard
              </h2>
              <button
                onClick={() => setShowSettings(false)}
                className={`p-2 rounded-lg transition-colors ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-700" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className={`text-sm mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Toggle cards on/off and drag to reorder. Changes are saved automatically.
            </p>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={settingsCardOrder} strategy={verticalListSortingStrategy}>
                <div className="space-y-2 mb-6">
                  {settingsCardOrder.map((cardId) => {
                    const card = DASHBOARD_CARDS.find((c) => c.id === cardId);
                    if (!card) return null;
                    // Hide cards based on RBAC permissions
                    if (card.id === "projects" && !widgets.activeProjects) return null;
                    if (card.id === "applications" && !widgets.recentApplications) return null;
                    if (card.id === "websiteMessages" && !widgets.websiteMessages) return null;
                    if (card.id === "hiringAnalytics" && !widgets.hiringAnalytics) return null;
                    if (card.id === "tenureCheckIns" && !widgets.tenureCheckins) return null;
                    if (card.id === "activityFeed" && !widgets.activityFeed) return null;
                    if (card.id === "email" && !user?.hasEmailAccess) return null;
                    if (card.id === "financialSnapshot" && !widgets.financialSnapshot) return null;
                    if (card.id === "safetyReports" && !isSuperAdmin) return null;
                    return (
                      <SortableCard
                        key={card.id}
                        card={card}
                        enabled={isCardEnabled(card.id)}
                        onToggle={() => handleToggleCard(card.id)}
                        isDark={isDark}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>

            <div className={`flex items-center justify-between pt-4 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
              <button
                onClick={async () => {
                  if (user) {
                    await resetSettings({ userId: user._id });
                  }
                }}
                className={`text-sm transition-colors ${isDark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-700"}`}
              >
                Reset to defaults
              </button>
              <button
                onClick={() => setShowSettings(false)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-500 text-white hover:bg-blue-600"}`}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Help Modal */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`w-full max-w-lg rounded-xl p-6 max-h-[90vh] overflow-y-auto ${isDark ? "bg-slate-800" : "bg-white"}`}>
            <div className="flex items-center justify-between mb-6">
              <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                Dashboard Help
              </h2>
              <button
                onClick={() => setShowHelp(false)}
                className={`p-2 rounded-lg transition-colors ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-700" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-6">
              {/* Customization */}
              <div>
                <h3 className={`font-medium mb-2 flex items-center gap-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                  <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Customize Your Dashboard
                </h3>
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Click the gear icon in the header to choose which cards appear on your dashboard.
                  Toggle cards on/off based on what&apos;s most relevant to your role. Your preferences
                  are saved automatically and persist across sessions.
                </p>
              </div>

              {/* Broadcast Messages */}
              <div>
                <h3 className={`font-medium mb-2 flex items-center gap-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                  <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                  </svg>
                  Broadcast Messages
                </h3>
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Important announcements and updates appear at the top of your dashboard.
                  Click the X to dismiss a message after you&apos;ve read it. Messages may be
                  targeted to specific roles, so you&apos;ll only see what&apos;s relevant to you.
                </p>
              </div>

              {/* Available Cards */}
              <div>
                <h3 className={`font-medium mb-2 flex items-center gap-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                  Available Dashboard Cards
                </h3>
                <ul className={`text-sm space-y-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  <li><strong>Active Projects</strong> - Your current projects and their status</li>
                  <li><strong>Recent Applications</strong> - New job applications to review</li>
                  <li><strong>Website Messages</strong> - Contact forms and dealer inquiries</li>
                  <li><strong>Hiring Analytics</strong> - Metrics and upcoming interviews</li>
                  <li><strong>Activity Feed</strong> - Recent system activity</li>
                  <li><strong>Tenure Check-ins</strong> - Due employee milestone reviews</li>
                </ul>
              </div>

              {/* Tips */}
              <div className={`p-4 rounded-lg ${isDark ? "bg-slate-700/50" : "bg-gray-100"}`}>
                <p className={`text-sm font-medium mb-2 ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                  Pro Tips
                </p>
                <ul className={`text-sm space-y-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  <li>• Press <kbd className={`px-1.5 py-0.5 rounded ${isDark ? "bg-slate-600" : "bg-gray-200"}`}>Ctrl+K</kbd> to open global search</li>
                  <li>• Your dashboard settings are unique to you</li>
                  <li>• Click &quot;Reset to defaults&quot; to restore original layout</li>
                </ul>
              </div>
            </div>

            <div className={`mt-6 pt-4 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
              <button
                onClick={() => setShowHelp(false)}
                className={`w-full px-4 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-500 text-white hover:bg-blue-600"}`}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Broadcast Create Modal (Super Admin) */}
      {showBroadcastModal && isSuperAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`w-full max-w-lg rounded-xl p-6 ${isDark ? "bg-slate-800" : "bg-white"}`}>
            <div className="flex items-center justify-between mb-6">
              <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                Create Broadcast Message
              </h2>
              <button
                onClick={() => setShowBroadcastModal(false)}
                className={`p-2 rounded-lg transition-colors ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-700" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  Title
                </label>
                <input
                  type="text"
                  value={broadcastForm.title}
                  onChange={(e) => setBroadcastForm({ ...broadcastForm, title: e.target.value })}
                  placeholder="e.g., New Feature Released"
                  className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-400" : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"}`}
                />
              </div>

              {/* Content */}
              <div>
                <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  Message
                </label>
                <textarea
                  value={broadcastForm.content}
                  onChange={(e) => setBroadcastForm({ ...broadcastForm, content: e.target.value })}
                  placeholder="Write your message here..."
                  rows={3}
                  className={`w-full px-3 py-2 rounded-lg border resize-none ${isDark ? "bg-slate-700 border-slate-600 text-white placeholder-slate-400" : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"}`}
                />
              </div>

              {/* Type & Priority */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Type
                  </label>
                  <select
                    value={broadcastForm.type}
                    onChange={(e) => setBroadcastForm({ ...broadcastForm, type: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                  >
                    <option value="info">Info</option>
                    <option value="update">Update</option>
                    <option value="success">Success</option>
                    <option value="warning">Warning</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Priority
                  </label>
                  <select
                    value={broadcastForm.priority}
                    onChange={(e) => setBroadcastForm({ ...broadcastForm, priority: e.target.value })}
                    className={`w-full px-3 py-2 rounded-lg border ${isDark ? "bg-slate-700 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High (Important)</option>
                  </select>
                </div>
              </div>

              {/* Target Roles */}
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  Target Roles <span className={isDark ? "text-slate-500" : "text-gray-400"}>(leave empty for all)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {["super_admin", "admin", "office_manager", "warehouse_manager"].map((role) => (
                    <button
                      key={role}
                      onClick={() => {
                        const roles = broadcastForm.targetRoles.includes(role)
                          ? broadcastForm.targetRoles.filter((r) => r !== role)
                          : [...broadcastForm.targetRoles, role];
                        setBroadcastForm({ ...broadcastForm, targetRoles: roles });
                      }}
                      className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                        broadcastForm.targetRoles.includes(role)
                          ? isDark ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-400" : "bg-blue-100 border-blue-300 text-blue-600"
                          : isDark ? "bg-slate-700 border-slate-600 text-slate-300" : "bg-gray-100 border-gray-200 text-gray-600"
                      }`}
                    >
                      {role.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className={`flex items-center justify-end gap-3 mt-6 pt-4 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
              <button
                onClick={() => setShowBroadcastModal(false)}
                className={`px-4 py-2 rounded-lg transition-colors ${isDark ? "text-slate-400 hover:text-white" : "text-gray-500 hover:text-gray-700"}`}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBroadcast}
                disabled={!broadcastForm.title || !broadcastForm.content}
                className={`px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-500 text-white hover:bg-blue-600"}`}
              >
                Send Broadcast
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <Protected>
      <DashboardContent />
    </Protected>
  );
}
