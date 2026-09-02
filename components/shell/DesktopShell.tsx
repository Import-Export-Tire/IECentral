"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/app/auth-context";
import { useTheme } from "@/app/theme-context";
import { useAppearance } from "@/app/appearance-context";

interface DesktopIcon {
  id: string;
  label: string;
  href: string;
  icon: string;
  x: number;
  y: number;
}

interface OpenWindow {
  id: string;
  label: string;
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
  maximized: boolean;
  zIndex: number;
}

const DEFAULT_ICONS: Omit<DesktopIcon, "x" | "y">[] = [
  { id: "dashboard", label: "Dashboard", href: "/", icon: "🏠" },
  { id: "messages", label: "Messages", href: "/messages", icon: "💬" },
  // { id: "email", label: "Email", href: "/email", icon: "📧" },
  // { id: "calendar", label: "Calendar", href: "/calendar", icon: "📅" },
  // { id: "meetings", label: "Meetings", href: "/meetings", icon: "🎥" },
  { id: "dochub", label: "Doc Hub", href: "/documents", icon: "📁" },
  { id: "personnel", label: "Personnel", href: "/personnel", icon: "👥" },
  { id: "projects", label: "Projects", href: "/projects", icon: "📋" },
  { id: "shifts", label: "Shifts", href: "/shifts", icon: "⏰" },
  { id: "timeclock", label: "Time Clock", href: "/time-clock", icon: "🕐" },
  { id: "reports", label: "Reports", href: "/reports", icon: "📊" },
  { id: "payroll", label: "Payroll", href: "/payroll", icon: "💰" },
  { id: "equipment", label: "Equipment", href: "/equipment", icon: "🔧" },
  { id: "settings", label: "Settings", href: "/settings", icon: "⚙️" },
  { id: "notifications", label: "Alerts", href: "/notifications", icon: "🔔" },
  { id: "dailylog", label: "Daily Log", href: "/daily-log", icon: "📝" },
  { id: "users", label: "Users", href: "/users", icon: "👤" },
  { id: "jobs", label: "Jobs", href: "/jobs", icon: "💼" },
];

function layoutIcons(): DesktopIcon[] {
  const cols = 2;
  const spacingX = 110;
  const spacingY = 95;
  return DEFAULT_ICONS.map((icon, i) => ({
    ...icon,
    x: 15 + (i % cols) * spacingX,
    y: 15 + Math.floor(i / cols) * spacingY,
  }));
}

// Wallpapers
const WALLPAPERS = [
  { id: "default-dark", label: "Default Dark", value: "bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950" },
  { id: "default-light", label: "Default Light", value: "bg-gradient-to-br from-sky-200 via-blue-100 to-teal-100" },
  { id: "midnight", label: "Midnight", value: "bg-gradient-to-br from-gray-950 via-blue-950 to-violet-950" },
  { id: "ocean", label: "Ocean", value: "bg-gradient-to-br from-cyan-900 via-blue-900 to-slate-900" },
  { id: "sunset", label: "Sunset", value: "bg-gradient-to-br from-orange-900 via-rose-900 to-purple-950" },
  { id: "forest", label: "Forest", value: "bg-gradient-to-br from-emerald-950 via-green-900 to-teal-950" },
  { id: "aurora", label: "Aurora", value: "bg-gradient-to-br from-violet-950 via-fuchsia-900 to-cyan-900" },
  { id: "storm", label: "Storm", value: "bg-gradient-to-br from-slate-950 via-zinc-900 to-neutral-900" },
  { id: "dawn", label: "Dawn", value: "bg-gradient-to-br from-amber-100 via-rose-100 to-sky-200" },
  { id: "arctic", label: "Arctic", value: "bg-gradient-to-br from-sky-100 via-blue-50 to-indigo-100" },
  { id: "sand", label: "Sand", value: "bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-100" },
  { id: "custom", label: "Custom Image", value: "" },
];

export default function DesktopShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { theme } = useTheme();
  const { setAppearance } = useAppearance();
  const isDark = theme === "dark";

  // Icons with persisted positions
  const [icons, setIcons] = useState<DesktopIcon[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("desktop-icon-positions");
      if (saved) {
        try {
          const positions = JSON.parse(saved) as Record<string, { x: number; y: number }>;
          return layoutIcons().map(icon => {
            const pos = positions[icon.id];
            return pos ? { ...icon, x: pos.x, y: pos.y } : icon;
          });
        } catch { }
      }
    }
    return layoutIcons();
  });

  // Multi-window state
  const [windows, setWindows] = useState<OpenWindow[]>([]);
  const [nextZ, setNextZ] = useState(10);
  const [focusedWindowId, setFocusedWindowId] = useState<string | null>(null);

  // UI state
  const [clock, setClock] = useState("");
  const [showStartMenu, setShowStartMenu] = useState(false);
  const [showWallpaperPicker, setShowWallpaperPicker] = useState(false);

  // Drag state
  const [draggingIcon, setDraggingIcon] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [draggingWindow, setDraggingWindow] = useState<string | null>(null);
  const [windowDragOffset, setWindowDragOffset] = useState({ x: 0, y: 0 });
  const [resizing, setResizing] = useState<{ id: string; edge: string } | null>(null);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, w: 0, h: 0, px: 0, py: 0 });

  // Wallpaper
  const [wallpaperId, setWallpaperIdState] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("desktop-wallpaper") || (isDark ? "default-dark" : "default-light");
    return isDark ? "default-dark" : "default-light";
  });
  const [customWallpaperUrl, setCustomWallpaperUrl] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("desktop-wallpaper-custom") || "";
    return "";
  });

  const setWallpaper = (id: string, customUrl?: string) => {
    setWallpaperIdState(id);
    localStorage.setItem("desktop-wallpaper", id);
    if (customUrl !== undefined) {
      setCustomWallpaperUrl(customUrl);
      localStorage.setItem("desktop-wallpaper-custom", customUrl);
    }
  };

  const currentWallpaper = WALLPAPERS.find(w => w.id === wallpaperId) || WALLPAPERS[0];
  const wallpaperStyle: React.CSSProperties = wallpaperId === "custom" && customWallpaperUrl
    ? { backgroundImage: `url(${customWallpaperUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
    : {};

  // Clock
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // Open or focus a window
  const openApp = useCallback((icon: Omit<DesktopIcon, "x" | "y">) => {
    setShowStartMenu(false);

    // If window already open, focus it
    const existing = windows.find(w => w.id === icon.id);
    if (existing) {
      const z = nextZ;
      setWindows(prev => prev.map(w => w.id === icon.id ? { ...w, minimized: false, zIndex: z } : w));
      setNextZ(prev => prev + 1);
      setFocusedWindowId(icon.id);
      router.push(icon.href);
      return;
    }

    // Open new window with staggered position
    const offset = (windows.length % 8) * 25;
    const z = nextZ;
    const iconAreaWidth = 240; // Space reserved for desktop icons
    const taskbarHeight = 48;
    const newWin: OpenWindow = {
      id: icon.id,
      label: icon.label,
      href: icon.href,
      x: iconAreaWidth + 20 + offset,
      y: 20 + offset,
      w: Math.min(1100, window.innerWidth - iconAreaWidth - 60),
      h: Math.min(700, window.innerHeight - taskbarHeight - 40),
      minimized: false,
      maximized: false,
      zIndex: z,
    };
    setWindows(prev => [...prev, newWin]);
    setNextZ(prev => prev + 1);
    setFocusedWindowId(icon.id);
    router.push(icon.href);
  }, [windows, nextZ, router]);

  // Focus a window (bring to front)
  const focusWindow = useCallback((id: string) => {
    const z = nextZ;
    setWindows(prev => prev.map(w => w.id === id ? { ...w, minimized: false, zIndex: z } : w));
    setNextZ(prev => prev + 1);
    setFocusedWindowId(id);
    const win = windows.find(w => w.id === id);
    if (win) router.push(win.href);
  }, [nextZ, windows, router]);

  const closeWindow = useCallback((id: string) => {
    setWindows(prev => prev.filter(w => w.id !== id));
    // If closing the focused window, focus the topmost remaining
    if (focusedWindowId === id) {
      setWindows(prev => {
        const visible = prev.filter(w => !w.minimized && w.id !== id);
        if (visible.length > 0) {
          const top = visible.reduce((a, b) => a.zIndex > b.zIndex ? a : b);
          setFocusedWindowId(top.id);
          router.push(top.href);
        } else {
          setFocusedWindowId(null);
          router.push("/");
        }
        return prev;
      });
    }
  }, [focusedWindowId, router]);

  const minimizeWindow = useCallback((id: string) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, minimized: true } : w));
    // Focus next topmost visible window
    const visible = windows.filter(w => !w.minimized && w.id !== id);
    if (visible.length > 0) {
      const top = visible.reduce((a, b) => a.zIndex > b.zIndex ? a : b);
      setFocusedWindowId(top.id);
      router.push(top.href);
    } else {
      setFocusedWindowId(null);
    }
  }, [windows, router]);

  const toggleMaximize = useCallback((id: string) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, maximized: !w.maximized } : w));
  }, []);

  // Icon drag
  const handleIconMouseDown = (e: React.MouseEvent, iconId: string) => {
    const icon = icons.find(i => i.id === iconId);
    if (!icon) return;
    setDraggingIcon(iconId);
    setDragOffset({ x: e.clientX - icon.x, y: e.clientY - icon.y });
  };

  // Window title bar drag
  const handleWindowMouseDown = (e: React.MouseEvent, windowId: string) => {
    const win = windows.find(w => w.id === windowId);
    if (!win || win.maximized) return;
    setDraggingWindow(windowId);
    setWindowDragOffset({ x: e.clientX - win.x, y: e.clientY - win.y });
    focusWindow(windowId);
  };

  // Resize
  const handleResizeStart = (e: React.MouseEvent, windowId: string, edge: string) => {
    e.preventDefault();
    e.stopPropagation();
    const win = windows.find(w => w.id === windowId);
    if (!win) return;
    setResizing({ id: windowId, edge });
    setResizeStart({ x: e.clientX, y: e.clientY, w: win.w, h: win.h, px: win.x, py: win.y });
  };

  // Mouse move/up for all drag operations
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingIcon) {
        setIcons(prev => prev.map(i =>
          i.id === draggingIcon ? { ...i, x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y } : i
        ));
      }
      if (draggingWindow) {
        setWindows(prev => prev.map(w =>
          w.id === draggingWindow ? { ...w, x: e.clientX - windowDragOffset.x, y: e.clientY - windowDragOffset.y } : w
        ));
      }
      if (resizing) {
        const dx = e.clientX - resizeStart.x;
        const dy = e.clientY - resizeStart.y;
        const minW = 400, minH = 300;
        setWindows(prev => prev.map(w => {
          if (w.id !== resizing.id) return w;
          const updates: Partial<OpenWindow> = {};
          if (resizing.edge.includes("e")) updates.w = Math.max(minW, resizeStart.w + dx);
          if (resizing.edge.includes("w")) { updates.w = Math.max(minW, resizeStart.w - dx); updates.x = resizeStart.px + (resizeStart.w - updates.w!); }
          if (resizing.edge.includes("s")) updates.h = Math.max(minH, resizeStart.h + dy);
          if (resizing.edge.includes("n")) { updates.h = Math.max(minH, resizeStart.h - dy); updates.y = resizeStart.py + (resizeStart.h - updates.h!); }
          return { ...w, ...updates };
        }));
      }
    };
    const handleMouseUp = () => {
      if (draggingIcon) {
        // Save icon positions
        setIcons(prev => {
          const positions: Record<string, { x: number; y: number }> = {};
          prev.forEach(i => { positions[i.id] = { x: i.x, y: i.y }; });
          localStorage.setItem("desktop-icon-positions", JSON.stringify(positions));
          return prev;
        });
      }
      setDraggingIcon(null);
      setDraggingWindow(null);
      setResizing(null);
    };
    if (draggingIcon || draggingWindow || resizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [draggingIcon, draggingWindow, resizing, dragOffset, windowDragOffset, resizeStart]);

  // The focused window gets `children` (real React content). All others get iframes.
  const visibleWindows = windows.filter(w => !w.minimized);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden select-none">
      {/* Desktop area */}
      <div
        className={`flex-1 relative overflow-hidden ${wallpaperId !== "custom" ? currentWallpaper.value : ""}`}
        style={wallpaperStyle}
        onClick={() => { setShowStartMenu(false); setShowWallpaperPicker(false); }}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            setShowWallpaperPicker(true);
            setShowStartMenu(false);
          }
        }}
      >
        {/* Desktop Icons */}
        {icons.map((icon) => (
          <div
            key={icon.id}
            onMouseDown={(e) => handleIconMouseDown(e, icon.id)}
            onDoubleClick={() => openApp(icon)}
            className="absolute flex flex-col items-center gap-1 cursor-pointer group select-none"
            style={{ left: icon.x, top: icon.y, width: 90 }}
          >
            <div className={`text-4xl p-2 rounded-xl transition-all group-hover:scale-110 ${
              isDark ? "group-hover:bg-white/10" : "group-hover:bg-black/10"
            }`}>
              {icon.icon}
            </div>
            <span className={`text-[11px] text-center font-medium leading-tight px-1.5 py-0.5 rounded ${
              isDark
                ? "text-white bg-black/50 backdrop-blur-sm"
                : "text-white bg-black/50 backdrop-blur-sm"
            }`}>
              {icon.label}
            </span>
          </div>
        ))}

        {/* Windows */}
        {visibleWindows.map((win) => {
          const isFocused = win.id === focusedWindowId;
          return (
            <div
              key={win.id}
              onMouseDown={() => { if (!isFocused) focusWindow(win.id); }}
              className={`absolute flex flex-col overflow-hidden shadow-2xl border ${
                isFocused
                  ? isDark ? "border-slate-500 shadow-black/60" : "border-gray-300 shadow-gray-400/40"
                  : isDark ? "border-slate-700 shadow-black/30 opacity-95" : "border-gray-300 shadow-gray-300/20 opacity-95"
              }`}
              style={win.maximized ? {
                left: 0, top: 0, width: "100%", height: "100%", zIndex: win.zIndex, borderRadius: 0,
              } : {
                left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.zIndex, borderRadius: 12,
              }}
            >
              {/* Title bar */}
              <div
                onMouseDown={(e) => { e.stopPropagation(); handleWindowMouseDown(e, win.id); }}
                onDoubleClick={() => toggleMaximize(win.id)}
                className={`flex-shrink-0 flex items-center h-9 px-3 gap-2 ${
                  draggingWindow === win.id ? "cursor-grabbing" : "cursor-grab"
                } ${isFocused
                  ? isDark ? "bg-slate-700" : "bg-gray-200"
                  : isDark ? "bg-slate-800" : "bg-gray-100"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <button onClick={(e) => { e.stopPropagation(); closeWindow(win.id); }}
                    className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-600 transition-colors" />
                  <button onClick={(e) => { e.stopPropagation(); minimizeWindow(win.id); }}
                    className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-600 transition-colors" />
                  <button onClick={(e) => { e.stopPropagation(); toggleMaximize(win.id); }}
                    className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-600 transition-colors" />
                </div>
                <span className={`flex-1 text-center text-xs font-medium truncate ${
                  isFocused ? (isDark ? "text-slate-300" : "text-gray-700") : (isDark ? "text-slate-500" : "text-gray-400")
                }`}>
                  {win.label}
                </span>
                <div className="w-12" />
              </div>

              {/* Content: focused window gets children, others get iframes */}
              <div className={`flex-1 overflow-auto ${isDark ? "bg-slate-900" : "bg-white"}`}>
                {isFocused ? (
                  children
                ) : (
                  <iframe
                    src={`${win.href}?shell=none`}
                    className="w-full h-full border-0"
                    title={win.label}
                  />
                )}
              </div>

              {/* Resize handles */}
              {!win.maximized && (
                <>
                  <div onMouseDown={(e) => handleResizeStart(e, win.id, "n")} className="absolute top-0 left-3 right-3 h-2 cursor-n-resize" />
                  <div onMouseDown={(e) => handleResizeStart(e, win.id, "s")} className="absolute bottom-0 left-3 right-3 h-2 cursor-s-resize" />
                  <div onMouseDown={(e) => handleResizeStart(e, win.id, "w")} className="absolute top-3 bottom-3 left-0 w-2 cursor-w-resize" />
                  <div onMouseDown={(e) => handleResizeStart(e, win.id, "e")} className="absolute top-3 bottom-3 right-0 w-2 cursor-e-resize" />
                  <div onMouseDown={(e) => handleResizeStart(e, win.id, "nw")} className="absolute top-0 left-0 w-4 h-4 cursor-nw-resize" />
                  <div onMouseDown={(e) => handleResizeStart(e, win.id, "ne")} className="absolute top-0 right-0 w-4 h-4 cursor-ne-resize" />
                  <div onMouseDown={(e) => handleResizeStart(e, win.id, "sw")} className="absolute bottom-0 left-0 w-4 h-4 cursor-sw-resize" />
                  <div onMouseDown={(e) => handleResizeStart(e, win.id, "se")} className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize" />
                </>
              )}
            </div>
          );
        })}

        {/* Wallpaper Picker */}
        {showWallpaperPicker && (
          <div
            className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 rounded-xl border shadow-2xl overflow-hidden z-[9999] ${
              isDark ? "bg-slate-800/95 border-slate-600 backdrop-blur-xl" : "bg-white/95 border-gray-200 backdrop-blur-xl"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? "border-slate-700" : "border-gray-100"}`}>
              <p className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Desktop Wallpaper</p>
              <button onClick={() => setShowWallpaperPicker(false)}
                className={`p-1 rounded-lg ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-4 gap-2 mb-3">
                {WALLPAPERS.filter(w => w.id !== "custom").map((wp) => (
                  <button key={wp.id} onClick={() => { setWallpaper(wp.id); setShowWallpaperPicker(false); }}
                    className={`aspect-video rounded-lg border-2 transition-all overflow-hidden ${
                      wallpaperId === wp.id ? "border-cyan-500 ring-2 ring-cyan-500/30 scale-105" : isDark ? "border-slate-600 hover:border-slate-500" : "border-gray-200 hover:border-gray-300"
                    }`}>
                    <div className={`w-full h-full ${wp.value}`} />
                  </button>
                ))}
              </div>
              <p className={`text-[10px] text-center mb-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                {WALLPAPERS.find(w => w.id === wallpaperId)?.label || ""}
              </p>
              <div className={`border-t pt-3 ${isDark ? "border-slate-700" : "border-gray-100"}`}>
                <label className={`text-xs font-medium mb-1.5 block ${isDark ? "text-slate-400" : "text-gray-600"}`}>Custom Image URL</label>
                <div className="flex gap-2">
                  <input type="text" value={customWallpaperUrl} onChange={(e) => setCustomWallpaperUrl(e.target.value)}
                    placeholder="https://example.com/wallpaper.jpg"
                    className={`flex-1 px-3 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-1 ${
                      isDark ? "bg-slate-900/50 border-slate-600 text-white placeholder-slate-500 focus:ring-cyan-500/50" : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-blue-500/50"
                    }`} />
                  <button onClick={() => { if (customWallpaperUrl.trim()) { setWallpaper("custom", customWallpaperUrl.trim()); setShowWallpaperPicker(false); } }}
                    disabled={!customWallpaperUrl.trim()}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-40 ${
                      isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}>
                    Apply
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Start Menu */}
        {showStartMenu && (
          <div className={`absolute bottom-12 left-2 w-72 rounded-xl border shadow-2xl overflow-hidden z-[9999] ${
            isDark ? "bg-slate-800/95 border-slate-600 backdrop-blur-xl" : "bg-white/95 border-gray-200 backdrop-blur-xl"
          }`} onClick={(e) => e.stopPropagation()}>
            <div className={`px-4 py-3 border-b ${isDark ? "border-slate-700" : "border-gray-100"}`}>
              <p className={`text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>{user?.name || "IE Central"}</p>
              <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{user?.email}</p>
            </div>
            <div className="max-h-80 overflow-y-auto py-1">
              {DEFAULT_ICONS.map((item) => (
                <button key={item.id} onClick={() => openApp(item)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                    isDark ? "text-slate-300 hover:bg-slate-700" : "text-gray-700 hover:bg-gray-100"
                  }`}>
                  <span className="text-lg">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
            <div className={`px-3 py-2 border-t flex gap-1 ${isDark ? "border-slate-700" : "border-gray-100"}`}>
              <button onClick={() => { setAppearance("modern"); setShowStartMenu(false); }}
                className={`flex-1 text-center px-2 py-1.5 text-xs rounded-lg ${isDark ? "text-slate-400 hover:bg-slate-700" : "text-gray-500 hover:bg-gray-100"}`}>
                Modern
              </button>
              <button onClick={() => { setAppearance("jmk"); setShowStartMenu(false); }}
                className={`flex-1 text-center px-2 py-1.5 text-xs rounded-lg ${isDark ? "text-green-500 hover:bg-green-900/20" : "text-green-700 hover:bg-green-50"}`}>
                JMK Terminal
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Taskbar — Windows-style */}
      <div className={`flex-shrink-0 h-12 flex items-center px-1 gap-0.5 border-t ${
        isDark ? "bg-slate-900/95 border-slate-700 backdrop-blur-xl" : "bg-white/95 border-gray-200 backdrop-blur-xl"
      }`}>
        {/* Start button */}
        <button onClick={(e) => { e.stopPropagation(); setShowStartMenu(prev => !prev); }}
          className={`h-10 px-3 rounded-md text-sm font-bold transition-colors flex items-center gap-1.5 ${
            showStartMenu
              ? isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-blue-100 text-blue-700"
              : isDark ? "text-white hover:bg-slate-700" : "text-gray-800 hover:bg-gray-100"
          }`}>
          <span className="text-lg">⊞</span>
        </button>

        <div className={`w-px h-8 mx-0.5 ${isDark ? "bg-slate-700/50" : "bg-gray-200"}`} />

        {/* Pinned quick-launch icons */}
        <div className="flex items-center gap-0.5 px-1">
          {[
            DEFAULT_ICONS.find(i => i.id === "dashboard"),
            DEFAULT_ICONS.find(i => i.id === "messages"),
            DEFAULT_ICONS.find(i => i.id === "dochub"),
          ].filter((i): i is Omit<DesktopIcon, "x" | "y"> => Boolean(i)).map((icon) => {
            const isOpen = windows.some(w => w.id === icon.id);
            return (
              <button
                key={icon.id}
                onClick={() => openApp(icon)}
                className={`h-10 w-10 flex items-center justify-center rounded-md text-lg transition-all relative ${
                  isOpen
                    ? isDark ? "bg-slate-700/80 hover:bg-slate-600" : "bg-blue-50 hover:bg-blue-100"
                    : isDark ? "hover:bg-slate-700/50" : "hover:bg-gray-100"
                }`}
                title={icon.label}
              >
                {icon.icon}
                {/* Active indicator bar */}
                {isOpen && (
                  <div className={`absolute bottom-0.5 left-2.5 right-2.5 h-0.5 rounded-full ${
                    focusedWindowId === icon.id
                      ? isDark ? "bg-cyan-400" : "bg-blue-500"
                      : isDark ? "bg-slate-500" : "bg-gray-400"
                  }`} />
                )}
              </button>
            );
          })}
        </div>

        <div className={`w-px h-8 mx-0.5 ${isDark ? "bg-slate-700/50" : "bg-gray-200"}`} />

        {/* Open window buttons */}
        <div className="flex-1 flex items-center gap-0.5 overflow-x-auto px-1">
          {windows.filter(w => !DEFAULT_ICONS.slice(0, 5).some(pi => pi.id === w.id) || true).map((win) => {
            const pinned = ["dashboard", "messages", "email", "calendar", "dochub"].includes(win.id);
            if (pinned) return null; // Already shown in pinned section
            const isFocused = focusedWindowId === win.id && !win.minimized;
            return (
              <button key={win.id}
                onClick={() => win.minimized ? focusWindow(win.id) : (focusedWindowId === win.id ? minimizeWindow(win.id) : focusWindow(win.id))}
                className={`h-9 px-3 rounded-md text-xs font-medium truncate max-w-[160px] transition-colors flex items-center gap-1.5 ${
                  isFocused
                    ? isDark ? "bg-slate-600/80 text-white" : "bg-blue-100 text-blue-800"
                    : win.minimized
                      ? isDark ? "text-slate-500 hover:bg-slate-700/50" : "text-gray-400 hover:bg-gray-100"
                      : isDark ? "text-slate-300 hover:bg-slate-700/50" : "text-gray-600 hover:bg-gray-100"
                }`}>
                <span className="text-sm">{DEFAULT_ICONS.find(i => i.id === win.id)?.icon || "📄"}</span>
                {win.label}
              </button>
            );
          })}
        </div>

        {/* System tray */}
        <div className={`flex items-center gap-3 px-3 h-10 rounded-md ${isDark ? "hover:bg-slate-800" : "hover:bg-gray-50"}`}>
          <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
          <span className={`text-xs font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}>
            {clock}
          </span>
        </div>
      </div>
    </div>
  );
}
