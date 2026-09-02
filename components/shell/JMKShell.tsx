"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/app/auth-context";
import { useAppearance } from "@/app/appearance-context";

interface MenuItem {
  key: string;
  label: string;
  href?: string;
  children?: MenuItem[];
  description?: string;
}

const MAIN_MENU: MenuItem[] = [
  {
    key: "1", label: "Main", description: "Dashboard, Messages, Notifications",
    children: [
      { key: "1", label: "Dashboard", href: "/" },
      { key: "2", label: "Messages", href: "/messages" },
      { key: "3", label: "Notifications", href: "/notifications" },
    ],
  },
  {
    key: "2", label: "Tools", description: "Doc Hub, Projects, Daily Log, Reports, Credentials",
    children: [
      { key: "1", label: "Doc Hub", href: "/documents" },
      { key: "2", label: "Projects", href: "/projects" },
      { key: "3", label: "Daily Log", href: "/daily-log" },
      { key: "4", label: "Reports", href: "/reports" },
      { key: "5", label: "Dealer Rebates", href: "/dealer-rebates" },
      { key: "6", label: "Dunlop Reporting", href: "/dunlop-reporting" },
      { key: "7", label: "Credentials", href: "/settings/credentials" },
    ],
  },
  {
    key: "3", label: "Hiring & HR", description: "Job Listings, Applications, Personnel",
    children: [
      { key: "1", label: "Job Listings", href: "/jobs" },
      { key: "2", label: "Applications", href: "/applications" },
      { key: "3", label: "Personnel", href: "/personnel" },
    ],
  },
  {
    key: "4", label: "Scheduling", description: "Shifts, Templates, Time Clock, Overtime",
    children: [
      { key: "1", label: "Shift Planning", href: "/shifts" },
      { key: "2", label: "Schedule Templates", href: "/schedule-templates" },
      { key: "3", label: "Time Clock", href: "/time-clock" },
      { key: "4", label: "Saturday Overtime", href: "/overtime" },
    ],
  },
  {
    key: "5", label: "Employee Portal", description: "Department Portal, Time Off, Call-Offs, Announcements",
    children: [
      { key: "1", label: "Department Portal", href: "/department-portal" },
      { key: "2", label: "Time Off Requests", href: "/time-off" },
      { key: "3", label: "Call-Offs", href: "/call-offs" },
      { key: "4", label: "Announcements", href: "/announcements" },
    ],
  },
  {
    key: "6", label: "Finance", description: "Payroll, QuickBooks, Expense Reports, Mileage",
    children: [
      { key: "1", label: "Payroll Approval", href: "/payroll" },
      { key: "2", label: "QuickBooks Sync", href: "/settings/quickbooks" },
      { key: "3", label: "Expense Report", href: "/expense-report" },
      { key: "4", label: "Mileage", href: "/mileage" },
    ],
  },
  {
    key: "7", label: "Equipment", description: "Equipment, Locations, Safety Checks, Bin Labels",
    children: [
      { key: "1", label: "Equipment", href: "/equipment" },
      { key: "2", label: "Locations", href: "/locations" },
      { key: "3", label: "Safety Checks", href: "/safety-check/manager" },
      { key: "4", label: "Checklist Templates", href: "/settings/safety-checklists" },
      { key: "5", label: "Bin Labels", href: "/bin-labels" },
    ],
  },
  {
    key: "8", label: "People & Org", description: "Users, Org Chart, Onboarding, Engagement",
    children: [
      { key: "1", label: "Users", href: "/users" },
      { key: "2", label: "Org Chart", href: "/org-chart" },
      { key: "3", label: "Onboarding Docs", href: "/settings/onboarding" },
      { key: "4", label: "Engagement", href: "/engagement" },
    ],
  },
  {
    key: "9", label: "System", description: "Settings, Audit Log, Deleted Records, Tech Wizard",
    children: [
      { key: "1", label: "Settings", href: "/settings" },
      { key: "2", label: "Audit Log", href: "/audit-log" },
      { key: "3", label: "Deleted Records", href: "/deleted-records" },
      { key: "4", label: "Tech Wizard", href: "/tech-wizard" },
    ],
  },
];

// Flatten all items to find current page name
function findPageLabel(href: string): string {
  for (const group of MAIN_MENU) {
    if (group.children) {
      const item = group.children.find(c => c.href === href);
      if (item) return item.label;
    }
  }
  return href.replace("/", "") || "Dashboard";
}

const F_KEYS = [
  { key: "F1", label: "Help" },
  { key: "F3", label: "Menu" },
  { key: "F5", label: "Refresh" },
  { key: "F10", label: "Back" },
  { key: "F12", label: "Modern" },
];

export default function JMKShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { setAppearance } = useAppearance();

  // Menu state: null = showing page content, "main" = top menu, group key = submenu
  const [menuLevel, setMenuLevel] = useState<string | null>("main");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [clock, setClock] = useState("");
  const [inputBuffer, setInputBuffer] = useState("");

  const showingMenu = menuLevel !== null;
  const currentItems = menuLevel === "main"
    ? MAIN_MENU
    : MAIN_MENU.find(m => m.key === menuLevel)?.children || [];
  const currentGroupLabel = menuLevel !== "main" && menuLevel !== null
    ? MAIN_MENU.find(m => m.key === menuLevel)?.label || ""
    : "";

  const currentPage = findPageLabel(pathname);

  // Clock
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const navigateTo = useCallback((href: string) => {
    router.push(href);
    setMenuLevel(null);
    setInputBuffer("");
    setSelectedIndex(0);
  }, [router]);

  const openSubmenu = useCallback((groupKey: string) => {
    setMenuLevel(groupKey);
    setSelectedIndex(0);
    setInputBuffer("");
  }, []);

  const goBack = useCallback(() => {
    if (menuLevel === null) {
      // From page → main menu
      setMenuLevel("main");
    } else if (menuLevel !== "main") {
      // From submenu → main menu
      setMenuLevel("main");
    }
    setSelectedIndex(0);
    setInputBuffer("");
  }, [menuLevel]);

  // Keyboard — use capture phase to intercept F-keys before page content
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Intercept all F-keys to prevent browser defaults
    if (e.key.startsWith("F") && !isNaN(Number(e.key.slice(1)))) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (e.key === "F1") { return; } // TODO: could open help
    if (e.key === "F12") { setAppearance("modern"); return; }
    if (e.key === "F3") { setMenuLevel(prev => prev === null ? "main" : null); setInputBuffer(""); setSelectedIndex(0); return; }
    if (e.key === "F10") { goBack(); return; }
    if (e.key === "F5") { router.refresh(); return; }
    if (e.key === "Escape") { goBack(); return; }

    if (showingMenu) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(0, prev - 1));
        setInputBuffer("");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(currentItems.length - 1, prev + 1));
        setInputBuffer("");
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = inputBuffer
          ? currentItems.find(m => m.key === inputBuffer)
          : currentItems[selectedIndex];
        if (item) {
          if (item.children) {
            openSubmenu(item.key);
          } else if (item.href) {
            navigateTo(item.href);
          }
        }
        setInputBuffer("");
      } else if (e.key >= "0" && e.key <= "9") {
        const newBuf = inputBuffer + e.key;
        setInputBuffer(newBuf);
        // Auto-select if unambiguous
        const match = currentItems.find(m => m.key === newBuf);
        const couldMatch = currentItems.some(m => m.key.startsWith(newBuf) && m.key !== newBuf);
        if (match && !couldMatch) {
          setTimeout(() => {
            if (match.children) {
              openSubmenu(match.key);
            } else if (match.href) {
              navigateTo(match.href);
            }
          }, 200);
        }
      } else if (e.key === "Backspace") {
        setInputBuffer(prev => prev.slice(0, -1));
      }
    }
  }, [showingMenu, selectedIndex, inputBuffer, currentItems, router, setAppearance, navigateTo, openSubmenu, goBack]);

  useEffect(() => {
    // Capture phase ensures F-keys are intercepted before any page element
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden bg-black select-none"
      style={{ fontFamily: "'IBM Plex Mono', 'Courier New', Courier, monospace" }}
    >
      {/* ═══ Title bar ═══ */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 h-7 bg-black border-b border-green-900/40">
        <span className="text-green-500 text-xs tracking-widest">
          IE CENTRAL — A Tribute to JMK
        </span>
        <span className="text-green-600 text-xs">
          {clock} | F12=Modern
        </span>
      </div>

      {/* ═══ Main area ═══ */}
      <div className="flex-1 overflow-hidden">
        {showingMenu ? (
          <div className="h-full flex flex-col items-center overflow-y-auto bg-black py-6">
            {/* Logo */}
            <pre className="text-green-400 text-xl leading-none font-bold tracking-wider mb-1 text-center">
{`  ___  _____
 |_ _|| ____|
  | | |  _|
  | | | |___
 |___||_____|`}
            </pre>
            <p className="text-cyan-500 text-xs tracking-[0.35em] mb-0.5">IMPORT EXPORT TIRE CO.</p>
            <p className="text-green-600 text-[11px] mb-6">
              <span className="text-orange-500">————</span>{" "}
              <span className="text-cyan-600">CENTRAL SYSTEM</span>{" "}
              <span className="text-orange-500">————</span>
            </p>

            {/* Menu heading */}
            <div className="flex items-center gap-2 mb-2 w-full max-w-md px-4">
              <span className="text-green-600">█▀</span>
              <span className="text-green-400 text-xs font-bold tracking-wider">
                {menuLevel === "main" ? "MAIN MENU" : currentGroupLabel.toUpperCase()}
              </span>
              {menuLevel !== "main" && (
                <span className="text-green-700 text-xs ml-auto">(F10=Back)</span>
              )}
            </div>

            {/* Menu box */}
            <div className="w-full max-w-md px-4">
              <div className="border-t-2 border-green-500/50 border-l border-r border-green-700/40">
                <div className="border-b border-green-500/30" />
                {currentItems.map((item, i) => (
                  <button
                    key={item.key}
                    onClick={() => {
                      if (item.children) openSubmenu(item.key);
                      else if (item.href) navigateTo(item.href);
                    }}
                    onMouseEnter={() => { setSelectedIndex(i); setInputBuffer(""); }}
                    className={`w-full text-left px-4 py-1.5 flex items-center transition-colors ${
                      selectedIndex === i
                        ? "bg-green-500 text-black font-bold"
                        : "text-green-400 hover:bg-green-900/20"
                    }`}
                  >
                    <span className={`w-6 text-right mr-3 ${selectedIndex === i ? "text-black" : "text-green-600"}`}>
                      {item.key}.
                    </span>
                    <span className="flex-1">{item.label}</span>
                    {item.children && (
                      <span className={`text-xs ${selectedIndex === i ? "text-green-900" : "text-green-700"}`}>►</span>
                    )}
                  </button>
                ))}
                <div className="border-b-2 border-green-500/50" />
              </div>
            </div>

            {/* Description */}
            {menuLevel === "main" && currentItems[selectedIndex]?.description && (
              <p className="text-green-700 text-xs mt-4 text-center max-w-md">
                {currentItems[selectedIndex].description}
              </p>
            )}

            {/* Input prompt */}
            <p className="text-cyan-500 text-xs mt-4 text-center">
              Type a number (1-{currentItems.length}) or use ↑↓ and Enter to select
            </p>
            {inputBuffer && (
              <p className="text-green-400 text-sm mt-2 text-center font-bold">
                &gt; {inputBuffer}<span className="animate-pulse">_</span>
              </p>
            )}
          </div>
        ) : (
          /* ════════════════ PAGE CONTENT (DOS styled via CSS) ════════════════ */
          <div className="h-full overflow-auto jmk-mode">
            {children}
          </div>
        )}
      </div>

      {/* ═══ Status / F-key bar ═══ */}
      <div className="flex-shrink-0 flex items-center h-6 bg-black border-t border-green-900/40">
        <div className="px-3 text-green-600 text-[11px]">
          Screen: {showingMenu ? (menuLevel === "main" ? "Main Menu" : currentGroupLabel) : currentPage}
        </div>
        <div className="flex-1 flex items-center">
          {F_KEYS.map((fk) => (
            <button
              key={fk.key}
              onClick={() => {
                if (fk.key === "F3") setMenuLevel(prev => prev === null ? "main" : null);
                else if (fk.key === "F5") router.refresh();
                else if (fk.key === "F10") goBack();
                else if (fk.key === "F12") setAppearance("modern");
              }}
              className="flex items-center px-3 py-0.5 hover:bg-green-900/30 transition-colors"
            >
              <span className="text-white text-[11px] font-bold">{fk.key}</span>
              <span className="text-cyan-500 text-[11px] ml-0.5">{fk.label}</span>
            </button>
          ))}
        </div>
        <div className="px-3 text-green-500 text-[11px]">
          Ready
        </div>
      </div>
    </div>
  );
}
