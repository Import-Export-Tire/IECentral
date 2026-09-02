"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth, UserRole } from "@/app/auth-context";
import { useTheme } from "@/app/theme-context";
import { useSidebar } from "@/app/sidebar-context";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { usePermissions } from "@/lib/usePermissions";
import { useAppearance, type Appearance } from "@/app/appearance-context";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  requiresPermission?: "viewPersonnel" | "viewShifts" | "manageTimeOff" | "departmentPortal";
  techOnly?: boolean; // Special access for tech team emails
  external?: boolean; // Opens in new tab
  section?: string; // Section label for visual grouping within a nav group
}

interface NavGroup {
  id: string;
  label: string;
  icon: string;
  items: NavItem[];
  requiresPermission?: "viewPersonnel" | "viewShifts" | "manageTimeOff" | "departmentPortal";
}

// Top-level nav items
const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { href: "/messages", label: "Messages", icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" },
  // { href: "/email", label: "Email", icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" },
  // { href: "/calendar", label: "Calendar", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  // { href: "/meetings", label: "Meetings", icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" },
  { href: "/notifications", label: "Notifications", icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" },
];

// Collapsible nav groups
const NAV_GROUPS: NavGroup[] = [
  {
    id: "people-hr",
    label: "People & HR",
    icon: "M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z",
    requiresPermission: "viewPersonnel",
    items: [
      // Hiring
      { href: "/jobs", label: "Job Listings", icon: "M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z", section: "Hiring" },
      { href: "/applications", label: "Applications", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
      { href: "/personnel", label: "Personnel", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" },
      // Scheduling
      { href: "/shifts", label: "Shift Planning", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z", section: "Scheduling" },
      { href: "/schedule-templates", label: "Schedule Templates", icon: "M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" },
      { href: "/time-clock", label: "Time Clock", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
      { href: "/overtime", label: "Saturday Overtime", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
      // Employee Portal
      { href: "/department-portal", label: "Department Portal", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4", section: "Portal" },
      { href: "/time-off", label: "Time Off Requests", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
      { href: "/call-offs", label: "Call-Offs", icon: "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" },
      { href: "/announcements", label: "Announcements", icon: "M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" },
      { href: "/training", label: "Training", section: "Training", icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" },
    ],
  },
  {
    id: "equipment",
    label: "Equipment",
    icon: "M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z",
    requiresPermission: "viewPersonnel",
    items: [
      { href: "/equipment", label: "Equipment", icon: "M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" },
      { href: "/equipment/scanners", label: "Scanner Manager", icon: "M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" },
      { href: "/locations", label: "Locations", icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z" },
      { href: "/safety-check/manager", label: "Safety Checks", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" },
      { href: "/settings/safety-checklists", label: "Checklist Templates", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
      { href: "/bin-labels", label: "Bin Labels", icon: "M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    items: [
      { href: "/payroll", label: "Payroll Approval", icon: "M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" },
      { href: "/settings/quickbooks", label: "QuickBooks Sync", icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" },
      { href: "/expense-report", label: "Expense Report", icon: "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM10 8.5a.5.5 0 11-1 0 .5.5 0 011 0zm5 5a.5.5 0 11-1 0 .5.5 0 011 0z" },
      { href: "/mileage", label: "Mileage", icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" }, // T3+ via finance group
    ],
  },
  {
    id: "tools",
    label: "Tools",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
    items: [
      { href: "/documents", label: "Doc Hub", icon: "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" },
      { href: "/projects", label: "Projects", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
      { href: "/daily-log", label: "Daily Log", icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" },
      { href: "/reports", label: "Reports", icon: "M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
      { href: "/reports/upload", label: "Upload Reports", icon: "M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" },
      { href: "/settings/credentials", label: "Credentials", icon: "M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" },
      { href: "/scratch", label: "Scratchpad", icon: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" },
      { href: "https://tiretrack-admin.vercel.app", label: "TireTrack Admin", icon: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z", external: true },
      { href: "http://34.228.222.11/classic", label: "IE Price System", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z", external: true },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z",
    items: [
      { href: "/settings", label: "Settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" },
      { href: "/audit-log", label: "Audit Log", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
      { href: "/deleted-records", label: "Deleted Records", icon: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" }, // T4+ via permissions
      { href: "/tech-wizard", label: "Tech Wizard", icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z", techOnly: true },
      // Organization
      { href: "/users", label: "Users", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z", section: "Organization" },
      { href: "/org-chart", label: "Org Chart", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" },
      { href: "/settings/onboarding", label: "Onboarding Docs", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
      { href: "/engagement", label: "Engagement", icon: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" },
      { href: "/exit-interviews", label: "Exit Interviews", icon: "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" },
      { href: "/safety-reports", label: "See Something, Say Something", icon: "M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" },
    ],
  },
];

// Tech department emails for Tech Wizard access
const TECH_EMAILS = ["iulia.curtui@evozon.com", "nick@ietires.com", "nquinn@ietires.com"];


export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout, canViewPersonnel, canViewShifts, canManageTimeOff, canAccessDepartmentPortal } = useAuth();
  const { theme } = useTheme();
  const { appearance } = useAppearance();
  const { isOpen, close } = useSidebar();
  const [openGroups, setOpenGroups] = useState<string[]>([]); // All closed by default
  const permissions = usePermissions();

  // Hide sidebar in desktop and JMK modes — those have their own navigation
  // CSS-only themes (pipboy, amber, dracula) use the standard sidebar
  if (appearance === "desktop" || appearance === "jmk") return null;

  const isDark = theme === "dark";

  // RBAC tier checks
  const tier = permissions.tier;

  // Check if user is department manager (T1 - restricted view)
  const isDepartmentManager = user?.role === "department_manager" || user?.role === "shift_lead";

  // Check if user is warehouse manager (T2 - limited view)
  const isWarehouseManager = user?.role === "warehouse_manager";

  // Check if user is employee (T0 - portal-only view)
  const isEmployee = user?.role === "employee" || user?.role === "member" || tier === 0;

  // Get unread message count
  const unreadCount = useQuery(
    api.messages.getUnreadCount,
    user?._id ? { userId: user._id } : "skip"
  );

  // Get unread event invite count (disabled)
  // const unreadEventInvites = useQuery(
  //   api.events.getUnreadInviteCount,
  //   user?._id ? { userId: user._id } : "skip"
  // );
  const unreadEventInvites = undefined;

  // Get unread notification count
  const unreadNotificationCount = useQuery(
    api.notifications.getUnreadCount,
    user?._id ? { userId: user._id } : "skip"
  );

  // Get unread email count (disabled)
  // const unreadEmailCount = useQuery(
  //   api.email.folders.getTotalUnreadForUser,
  //   user?._id ? { userId: user._id } : "skip"
  // );
  const unreadEmailCount = undefined;

  // Get employee assigned training (for sidebar link)
  const myAssigned = useQuery(api.training.myAssignedTraining, user?._id ? { userId: user._id } : "skip");

  // Check if any item in a group is active
  const isGroupActive = (group: NavGroup) => {
    return group.items.some((item) => pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href)));
  };

  // Filter nav items based on RBAC tier permissions
  const filteredNavItems = NAV_ITEMS.filter((item) => {
    // Use menu permissions from RBAC
    if (item.href === "/messages") return permissions.menu.messages;
    if (item.href === "/email") return permissions.hasEmailAccess;
    if (item.href === "/calendar") return permissions.menu.calendar;
    if (item.href === "/notifications") return true; // All tiers
    return true;
  });

  // Groups are filtered dynamically — if all items inside are hidden by
  // per-item RBAC checks, the group itself disappears (line ~762).
  // No need for a separate group-level tier filter.
  const filteredNavGroups = NAV_GROUPS;

  // Check if user has Tech Wizard access (T5 or tech team emails)
  const hasTechAccess = tier >= 5 || TECH_EMAILS.includes(user?.email?.toLowerCase() || "");

  const toggleGroup = (groupId: string) => {
    setOpenGroups((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const handleNavClick = () => {
    // Close sidebar on mobile when nav item is clicked
    close();
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={close}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          w-64 border-r flex flex-col theme-sidebar
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          ${appearance === "pipboy" ? "!bg-[#091209] !border-[rgba(0,255,65,0.2)]"
            : appearance === "amber" ? "!bg-[#1a1000] !border-[rgba(255,176,0,0.15)]"
            : appearance === "dracula" ? "!bg-[#21222c] !border-[#44475a]"
            : isDark ? "bg-slate-800/95 lg:bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}
        `}
      >
        {/* Logo */}
        <div className={`p-4 sm:p-6 border-b flex items-center justify-between ${isDark ? "border-slate-700" : "border-gray-200"}`}>
          <div>
            <Image
              src="/logo.gif"
              alt="Import Export Tire Company"
              width={140}
              height={40}
              className="h-10 w-auto"
              priority
            />
            <span className={`text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded ${isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-cyan-100 text-cyan-700"}`}>
              BETA
            </span>
          </div>
          {/* Close button for mobile */}
          <button
            onClick={close}
            className={`lg:hidden p-2 rounded-lg transition-colors ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-700" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 sm:p-4 space-y-1 overflow-y-auto">
          {/* Employee: Portal-only navigation */}
          {isEmployee ? (
            <>
              {/* Employee Portal - Main link */}
              <Link
                href="/portal"
                onClick={handleNavClick}
                className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg transition-all ${
                  pathname === "/portal"
                    ? isDark
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "bg-blue-50 text-blue-600 border border-blue-200"
                    : isDark
                      ? "text-slate-400 hover:bg-slate-700/50 hover:text-white"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                <span className="font-medium text-sm sm:text-base">Home</span>
              </Link>

              {/* Schedule */}
              <Link
                href="/portal/schedule"
                onClick={handleNavClick}
                className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg transition-all ${
                  pathname === "/portal/schedule"
                    ? isDark
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "bg-blue-50 text-blue-600 border border-blue-200"
                    : isDark
                      ? "text-slate-400 hover:bg-slate-700/50 hover:text-white"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="font-medium text-sm sm:text-base">My Schedule</span>
              </Link>

              {/* Hours */}
              <Link
                href="/portal/hours"
                onClick={handleNavClick}
                className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg transition-all ${
                  pathname === "/portal/hours"
                    ? isDark
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "bg-blue-50 text-blue-600 border border-blue-200"
                    : isDark
                      ? "text-slate-400 hover:bg-slate-700/50 hover:text-white"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-medium text-sm sm:text-base">My Hours</span>
              </Link>

              {/* Time Off */}
              <Link
                href="/portal/time-off"
                onClick={handleNavClick}
                className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg transition-all ${
                  pathname === "/portal/time-off"
                    ? isDark
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "bg-blue-50 text-blue-600 border border-blue-200"
                    : isDark
                      ? "text-slate-400 hover:bg-slate-700/50 hover:text-white"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="font-medium text-sm sm:text-base">Time Off</span>
              </Link>

              {/* Paystubs */}
              <Link
                href="/portal/paystubs"
                onClick={handleNavClick}
                className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg transition-all ${
                  pathname === "/portal/paystubs"
                    ? isDark
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "bg-blue-50 text-blue-600 border border-blue-200"
                    : isDark
                      ? "text-slate-400 hover:bg-slate-700/50 hover:text-white"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="font-medium text-sm sm:text-base">Paystubs</span>
              </Link>

              {/* Surveys */}
              <Link
                href="/portal/surveys"
                onClick={handleNavClick}
                className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg transition-all ${
                  pathname === "/portal/surveys"
                    ? isDark
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "bg-blue-50 text-blue-600 border border-blue-200"
                    : isDark
                      ? "text-slate-400 hover:bg-slate-700/50 hover:text-white"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                <span className="font-medium text-sm sm:text-base">Surveys</span>
              </Link>

              {/* Announcements */}
              <Link
                href="/announcements"
                onClick={handleNavClick}
                className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg transition-all ${
                  pathname === "/announcements"
                    ? isDark
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "bg-blue-50 text-blue-600 border border-blue-200"
                    : isDark
                      ? "text-slate-400 hover:bg-slate-700/50 hover:text-white"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                </svg>
                <span className="font-medium text-sm sm:text-base">Announcements</span>
              </Link>

              {/* Granted modules — extra access an admin gave this employee beyond the portal
                  (set via permissionOverrides on the user; see Add/Edit User -> Module access) */}
              {([
                { permKey: "menu.timeClock", href: "/time-clock", label: "Time Clock", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
                { permKey: "menu.docHub", href: "/documents", label: "Documents", icon: "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" },
                // { permKey: "menu.calendar", href: "/calendar", label: "Calendar", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
                { permKey: "menu.messages", href: "/messages", label: "Messages", icon: "M8 10h.01M12 10h.01M16 10h.01M21 12a8 8 0 01-11.5 7.2L3 21l1.8-5.5A8 8 0 1121 12z" },
              ]).filter((m) => user?.permissionOverrides?.[m.permKey] === true).map((m) => (
                <Link
                  key={m.permKey}
                  href={m.href}
                  onClick={handleNavClick}
                  className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg transition-all ${
                    pathname === m.href
                      ? isDark ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "bg-blue-50 text-blue-600 border border-blue-200"
                      : isDark ? "text-slate-400 hover:bg-slate-700/50 hover:text-white" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={m.icon} />
                  </svg>
                  <span className="font-medium text-sm sm:text-base">{m.label}</span>
                </Link>
              ))}

              {/* Training — only shown when employee has assigned videos */}
              {myAssigned && myAssigned.length > 0 && (
                <Link href="/training" onClick={handleNavClick} className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg transition-all ${pathname === "/training" ? (isDark ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "bg-blue-50 text-blue-600 border border-blue-200") : (isDark ? "text-slate-400 hover:bg-slate-700/50 hover:text-white" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900")}`}>
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  <span className="font-medium text-sm sm:text-base">Training</span>
                </Link>
              )}
            </>
          ) : isDepartmentManager ? (
            <>
              {/* Department Portal - Main link */}
              <Link
                href="/department-portal"
                onClick={handleNavClick}
                className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg transition-all ${
                  pathname === "/department-portal"
                    ? isDark
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "bg-blue-50 text-blue-600 border border-blue-200"
                    : isDark
                      ? "text-slate-400 hover:bg-slate-700/50 hover:text-white"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                <span className="font-medium text-sm sm:text-base">My Department</span>
              </Link>

              {/* Messages */}
              <Link
                href="/messages"
                onClick={handleNavClick}
                className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg transition-all ${
                  pathname === "/messages"
                    ? isDark
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "bg-blue-50 text-blue-600 border border-blue-200"
                    : isDark
                      ? "text-slate-400 hover:bg-slate-700/50 hover:text-white"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <span className="font-medium text-sm sm:text-base truncate flex-1">Messages</span>
                {unreadCount && unreadCount > 0 && (
                  <span className="min-w-[20px] h-[20px] px-1.5 text-[11px] font-bold flex items-center justify-center rounded-full bg-red-500 text-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>

              {/* Notifications */}
              <Link
                href="/notifications"
                onClick={handleNavClick}
                className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg transition-all ${
                  pathname === "/notifications"
                    ? isDark
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "bg-blue-50 text-blue-600 border border-blue-200"
                    : isDark
                      ? "text-slate-400 hover:bg-slate-700/50 hover:text-white"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                <span className="font-medium text-sm sm:text-base truncate flex-1">Notifications</span>
                {unreadNotificationCount && unreadNotificationCount > 0 && (
                  <span className="min-w-[20px] h-[20px] px-1.5 text-[11px] font-bold flex items-center justify-center rounded-full bg-red-500 text-white">
                    {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                  </span>
                )}
              </Link>

              {/* Announcements */}
              <Link
                href="/announcements"
                onClick={handleNavClick}
                className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg transition-all ${
                  pathname === "/announcements"
                    ? isDark
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "bg-blue-50 text-blue-600 border border-blue-200"
                    : isDark
                      ? "text-slate-400 hover:bg-slate-700/50 hover:text-white"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                </svg>
                <span className="font-medium text-sm sm:text-base">Announcements</span>
              </Link>
            </>
          ) : (
            <>
              {/* Full navigation for other roles */}
              {/* Top-level nav items */}
              {filteredNavItems.map((item) => {
                const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                const isMessages = item.href === "/messages";
                const isCalendar = item.href === "/calendar";
                const isNotifications = item.href === "/notifications";
                const isEmail = item.href === "/email";
                const showMessageBadge = isMessages && unreadCount && unreadCount > 0;
                const showCalendarBadge = isCalendar && unreadEventInvites && unreadEventInvites > 0;
                const showNotificationBadge = isNotifications && unreadNotificationCount && unreadNotificationCount > 0;
                const showEmailBadge = isEmail && unreadEmailCount && unreadEmailCount > 0;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={handleNavClick}
                    className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg transition-all ${
                      isActive
                        ? isDark
                          ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                          : "bg-blue-50 text-blue-600 border border-blue-200"
                        : isDark
                          ? "text-slate-400 hover:bg-slate-700/50 hover:text-white"
                          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                  >
                    <svg
                      className="w-5 h-5 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d={item.icon}
                      />
                    </svg>
                    <span className="font-medium text-sm sm:text-base truncate flex-1">{item.label}</span>
                    {showMessageBadge && (
                      <span className="min-w-[20px] h-[20px] px-1.5 text-[11px] font-bold flex items-center justify-center rounded-full bg-red-500 text-white">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                    {showCalendarBadge && (
                      <span className="min-w-[20px] h-[20px] px-1.5 text-[11px] font-bold flex items-center justify-center rounded-full bg-amber-500 text-white">
                        {unreadEventInvites > 99 ? "99+" : unreadEventInvites}
                      </span>
                    )}
                    {showNotificationBadge && (
                      <span className="min-w-[20px] h-[20px] px-1.5 text-[11px] font-bold flex items-center justify-center rounded-full bg-red-500 text-white">
                        {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                      </span>
                    )}
                    {showEmailBadge && (
                      <span className="min-w-[20px] h-[20px] px-1.5 text-[11px] font-bold flex items-center justify-center rounded-full bg-blue-500 text-white">
                        {unreadEmailCount > 9 ? "9+" : unreadEmailCount}
                      </span>
                    )}
                  </Link>
                );
              })}

              {/* Collapsible nav groups */}
          {filteredNavGroups.map((group) => {
            const isOpen = openGroups.includes(group.id);
            const groupActive = isGroupActive(group);
            const filteredItems = group.items.filter((item) => {
              // Hide techOnly items from non-tech users
              if (item.techOnly && !hasTechAccess) return false;

              // Route-to-permission map — items without a mapping are hidden
              const routePerms: Record<string, boolean> = {
                // Hiring & HR
                "/jobs": permissions.menu.jobListings,
                "/applications": permissions.menu.applications,
                "/personnel": permissions.menu.personnel,
                "/settings/onboarding": permissions.menu.onboardingDocs,
                // Scheduling
                "/shifts": permissions.menu.shiftPlanning,
                "/schedule-templates": permissions.menu.scheduleTemplates,
                "/time-clock": permissions.menu.timeClock,
                "/overtime": permissions.menu.overtime,
                // Employee Portal
                "/department-portal": permissions.menu.departmentPortal,
                "/time-off": permissions.menu.timeCorrections,
                "/call-offs": permissions.menu.callOffs,
                "/announcements": permissions.menu.announcements,
                // Equipment
                "/equipment": permissions.menu.equipment,
                "/equipment/scanners": permissions.menu.equipment,
                "/locations": permissions.menu.locations,
                "/safety-check/manager": permissions.menu.equipment,
                "/settings/safety-checklists": permissions.menu.safetyCheckQR,
                "/bin-labels": permissions.menu.binLabels,
                // Finance
                "/payroll": permissions.menu.payrollApproval,
                "/settings/quickbooks": permissions.menu.quickbooks,
                "/expense-report": permissions.menu.expenseReports,
                "/mileage": permissions.menu.mileage,
                // Tools
                "/documents": permissions.menu.docHub,
                "/projects": permissions.menu.projects,
                "/daily-log": permissions.menu.dailyLog,
                "/reports": permissions.menu.reports,
                "/reports/upload": permissions.menu.reportUpload,
                "/settings/credentials": tier >= 5,
                "/suggestions": permissions.menu.suggestions,
                // Training
                "/training": permissions.menu.training,
                // People & Org
                "/org-chart": permissions.menu.orgChart,
                "/engagement": permissions.menu.engagement,
                "/exit-interviews": tier >= 5,
                "/safety-reports": permissions.hasPermission("safetyReports.review"),
                "/surveys": permissions.menu.surveys,
                // System
                "/users": permissions.menu.userManagement,
                "/audit-log": permissions.menu.auditLog,
                "/settings": permissions.menu.systemSettings,
                "/deleted-records": permissions.menu.deletedRecords,
                "/website-messages": permissions.menu.websiteMessages,
              };

              // Check exact match
              if (item.href in routePerms) return routePerms[item.href];

              // Tech wizard special case
              if (item.href === "/tech-wizard") return hasTechAccess;

              // External links with known permissions
              if (item.href === "https://tiretrack-admin.vercel.app") return permissions.menu.tireTrackAdmin;
              if (item.href === "http://34.228.222.11/classic") return permissions.menu.iePriceSystem;

              // Default: show if no specific rule
              return true;
            });

            // Skip groups with no visible items
            if (filteredItems.length === 0) return null;

            return (
              <div key={group.id}>
                <button
                  onClick={() => toggleGroup(group.id)}
                  className={`w-full flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg transition-all ${
                    groupActive
                      ? isDark
                        ? "bg-cyan-500/10 text-cyan-400"
                        : "bg-blue-50/50 text-blue-600"
                      : isDark
                        ? "text-slate-400 hover:bg-slate-700/50 hover:text-white"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  <svg
                    className="w-5 h-5 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d={group.icon}
                    />
                  </svg>
                  <span className="font-medium text-sm sm:text-base flex-1 text-left">{group.label}</span>
                  <svg
                    className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Nested items */}
                {isOpen && (
                  <div className="ml-4 mt-1 space-y-1">
                    {filteredItems.map((item, itemIdx) => {
                      // Render section label when section changes
                      const prevItem = itemIdx > 0 ? filteredItems[itemIdx - 1] : null;
                      const showSection = item.section && item.section !== prevItem?.section;
                      const isActive = !item.external && (pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href)));
                      const linkClass = `flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-sm ${
                        isActive
                          ? isDark
                            ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                            : "bg-blue-50 text-blue-600 border border-blue-200"
                          : isDark
                            ? "text-slate-400 hover:bg-slate-700/50 hover:text-white"
                            : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                      }`;
                      const iconAndLabel = (
                        <>
                          <svg
                            className="w-4 h-4 flex-shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d={item.icon}
                            />
                          </svg>
                          <span className="truncate">{item.label}</span>
                          {item.external && (
                            <svg className="w-3 h-3 ml-auto flex-shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          )}
                        </>
                      );
                      const linkEl = item.external ? (
                        <a
                          key={item.href}
                          href={item.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={handleNavClick}
                          className={linkClass}
                        >
                          {iconAndLabel}
                        </a>
                      ) : (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={handleNavClick}
                          className={linkClass}
                        >
                          {iconAndLabel}
                        </Link>
                      );

                      if (showSection) {
                        return (
                          <div key={item.href}>
                            <p className={`text-[10px] font-semibold uppercase tracking-wider px-3 pt-3 pb-1 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                              {item.section}
                            </p>
                            {linkEl}
                          </div>
                        );
                      }
                      return linkEl;
                    })}
                  </div>
                )}
              </div>
            );
          })}
            </>
          )}
        </nav>

        {/* User Info */}
        <div className={`p-3 sm:p-4 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
          <div className="flex items-center gap-3 px-2">
            <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0 ${isDark ? "bg-gradient-to-br from-cyan-400 to-blue-500" : "bg-gradient-to-br from-blue-500 to-blue-600"}`}>
              {user?.name?.charAt(0).toUpperCase() || "U"}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                {user?.name || "User"}
              </p>
              <p className={`text-xs truncate ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                {user?.email || ""}
              </p>
            </div>
            <button
              onClick={logout}
              className={`p-2 transition-colors flex-shrink-0 ${isDark ? "text-slate-400 hover:text-red-400" : "text-gray-400 hover:text-red-500"}`}
              title="Sign out"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

// Mobile header component with hamburger menu
export function MobileHeader() {
  const { theme } = useTheme();
  const { toggle } = useSidebar();
  const { user } = useAuth();
  const isDark = theme === "dark";
  // Render the mobile hamburger header for ALL appearances (previously gated to
  // "modern", which left pipboy/amber/dracula users with no way to open the nav).

  // Get unread notification count
  const unreadNotificationCount = useQuery(
    api.notifications.getUnreadCount,
    user?._id ? { userId: user._id } : "skip"
  );

  return (
    <div className={`lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-3 border-b ${isDark ? "bg-slate-900/95 backdrop-blur-sm border-slate-700" : "bg-white/95 backdrop-blur-sm border-gray-200"}`}>
      <button
        onClick={toggle}
        className={`p-2 rounded-lg transition-colors ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-700" : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"}`}
        aria-label="Toggle menu"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <div className="flex-1 flex items-center gap-2">
        <Image
          src="/logo.gif"
          alt="Import Export Tire Company"
          width={100}
          height={28}
          className="h-7 w-auto"
        />
        <span className={`text-[9px] font-semibold tracking-wider px-1 py-0.5 rounded ${isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-cyan-100 text-cyan-700"}`}>
          BETA
        </span>
      </div>
      {/* Notification bell for mobile */}
      <Link
        href="/notifications"
        className={`relative p-2 rounded-lg transition-colors ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-700" : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"}`}
        aria-label="Notifications"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadNotificationCount && unreadNotificationCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 text-[10px] font-bold flex items-center justify-center rounded-full bg-red-500 text-white">
            {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
          </span>
        )}
      </Link>
      {/* Search button for mobile */}
      <button
        onClick={() => {
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("openGlobalSearch"));
          }
        }}
        className={`p-2 rounded-lg transition-colors ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-700" : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"}`}
        aria-label="Search"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>
    </div>
  );
}
