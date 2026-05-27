export interface ReportType {
  id: string;
  title: string;
  description: string;
  icon: string; // SVG path
  href: string;
  group: "hr" | "operations" | "sales" | "inventory" | "vendor" | "saved" | "admin";
  external?: boolean; // Links to existing page outside /reports/
  superAdminOnly?: boolean; // Card hidden unless user is super_admin (tier 5)
}

export const REPORT_GROUPS = [
  { id: "hr", label: "HR & Hiring", icon: "M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" },
  { id: "operations", label: "Operations", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  { id: "inventory", label: "Inventory", icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
  { id: "sales", label: "Sales & Finance", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { id: "saved", label: "Saved Configurations", icon: "M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" },
  { id: "vendor", label: "Vendor Reports", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" },
  { id: "admin", label: "Administration", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" },
] as const;

export const REPORT_TYPES: ReportType[] = [
  // HR & Hiring
  {
    id: "personnel",
    title: "Personnel",
    description: "Export personnel records — contacts, departments, status",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
    href: "/reports?view=personnel",
    group: "hr",
  },
  {
    id: "applications",
    title: "Applications",
    description: "Job applications with candidate scores and interview status",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    href: "/reports?view=applications",
    group: "hr",
  },
  {
    id: "hiring",
    title: "Hiring Analytics",
    description: "Conversion rates, job metrics, hiring funnel analysis",
    icon: "M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    href: "/reports?view=hiring",
    group: "hr",
  },
  {
    id: "personnel-roster",
    title: "Personnel Roster (PDF)",
    description: "Printable roster of personnel by location — for HR to verify who is and isn't listed",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
    href: "/reports/personnel-roster",
    group: "hr",
    external: true,
  },
  {
    id: "insurance-eligibility",
    title: "60-Day Insurance Eligibility",
    description: "Personnel whose insurance eligibility (1st of month after 60 days) is coming up or just passed",
    icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
    href: "/reports/insurance-eligibility",
    group: "hr",
    external: true,
  },
  {
    id: "ninety-day-reviews",
    title: "Review Tracker",
    description: "90-day reviews and annual reviews — overdue, upcoming, and completed",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
    href: "/reports/ninety-day-reviews",
    group: "hr",
    external: true,
  },
  {
    id: "turnover",
    title: "Turnover Dashboard",
    description: "Hires vs terminations by month, tenure-at-termination curves, by-location term rates, top reasons",
    icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
    href: "/reports/turnover",
    group: "hr",
    external: true,
  },
  {
    id: "exit-interviews-report",
    title: "Exit Interview Report",
    description: "Trends, ratings, and PDF export for sharing with leadership (super-admin only)",
    icon: "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
    href: "/reports/exit-interviews",
    group: "admin",
    external: true,
    superAdminOnly: true,
  },
  // Operations
  {
    id: "attendance",
    title: "Attendance",
    description: "Time tracking, late arrivals, attendance records",
    icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
    href: "/reports?view=attendance",
    group: "operations",
  },
  {
    id: "equipment",
    title: "Equipment",
    description: "Scanner and picker inventory with assignments",
    icon: "M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z",
    href: "/reports?view=equipment",
    group: "operations",
  },
  {
    id: "weekly",
    title: "Weekly Overview",
    description: "Weekly summary of daily activity logs",
    icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
    href: "/reports?view=weekly",
    group: "operations",
  },
  // Sales & Finance
  {
    id: "wtd-commission",
    title: "WTD Commission",
    description: "Daily commission reports for WTD customers",
    icon: "M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z",
    href: "/tools/wtd-commission",
    group: "vendor",
    external: true,
  },
  {
    id: "dunlop-reporting",
    title: "Dunlop Sellout Reporter",
    description: "Monthly sellout reporting to SRNA via SFTP",
    icon: "M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12",
    href: "/dunlop-reporting",
    group: "vendor",
    external: true,
  },
  {
    id: "dealer-rebates",
    title: "Dealer Rebates",
    description: "Falken/Milestar rebate processing and tracking",
    icon: "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM10 8.5a.5.5 0 11-1 0 .5.5 0 011 0zm5 5a.5.5 0 11-1 0 .5.5 0 011 0z",
    href: "/dealer-rebates",
    group: "vendor",
    external: true,
  },
  // JMK Data Reports
  {
    id: "inventory",
    title: "Inventory Report",
    description: "Current inventory by warehouse, brand, product type with costs and quantities",
    icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
    href: "/reports/inventory",
    group: "inventory",
    external: true,
  },
  {
    id: "controller-inventory-report",
    title: "Controller Inventory Report (CIR)",
    description: "PDF inventory report filtered by location and selected brands — for retail-store reviews",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    href: "/reports/inventory/filtered",
    group: "inventory",
    external: true,
  },
  {
    id: "sales-dashboard",
    title: "Sales Dashboard",
    description: "Tires sold by location with WoW / MoM / YTD delta pills, stacked monthly chart, weekly trend",
    icon: "M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
    href: "/reports/sales-dashboard",
    group: "sales",
    external: true,
  },
  {
    id: "sales-by-day",
    title: "Sales by Day & Location",
    description: "Daily/weekly/monthly sales by store with line, area, and bar charts — Dollars or Tires",
    icon: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
    href: "/reports/sales-by-day",
    group: "sales",
    external: true,
  },
  {
    id: "sales-history",
    title: "Sales History",
    description: "Monthly sales by item with brand, model, and warehouse filtering",
    icon: "M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    href: "/reports/sales-history",
    group: "sales",
    external: true,
  },
  // Custom Report Builder
  {
    id: "custom",
    title: "Custom Report",
    description: "Build a custom report from uploaded JMK data — pick sources, columns, and date ranges",
    icon: "M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4",
    href: "/reports/custom",
    group: "sales",
    external: true,
  },
  // Operations — Website Messages
  {
    id: "website-messages",
    title: "Website Messages",
    description: "Contact forms and dealer inquiries from ietires.com",
    icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
    href: "/website-messages",
    group: "operations",
    external: true,
  },
];
