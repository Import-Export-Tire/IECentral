"use client";

import { useState } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "../auth-context";
import { useTheme } from "../theme-context";
import { useAppearance, type Appearance } from "../appearance-context";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

function SettingsContent() {
  const { user, canManageUsers } = useAuth();
  const { theme, setTheme } = useTheme();
  const { appearance, setAppearance } = useAppearance();
  const users = useQuery(api.auth.getAllUsers);
  const locations = useQuery(api.locations.list);
  const changePassword = useMutation(api.auth.changePassword);
  const createUser = useMutation(api.auth.createUser);
  const updateLocation = useMutation(api.locations.update);

  const isDark = theme === "dark";

  const [activeTab, setActiveTab] = useState<"profile" | "users" | "security" | "locations">(
    "profile"
  );

  // Password change state
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // New user state
  const [showNewUser, setShowNewUser] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "member",
  });
  const [newUserError, setNewUserError] = useState("");

  // Location editing state
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [locationForm, setLocationForm] = useState({
    warehouseManagerName: "",
    warehouseManagerPhone: "",
    warehouseManagerEmail: "",
  });
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationSuccess, setLocationSuccess] = useState<string | null>(null);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess(false);

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }

    if (!user) return;

    try {
      const result = await changePassword({
        userId: user._id,
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });

      if (result.success) {
        setPasswordSuccess(true);
        setPasswordForm({
          currentPassword: "",
          newPassword: "",
          confirmPassword: "",
        });
      } else {
        setPasswordError(result.error || "Failed to change password");
      }
    } catch {
      setPasswordError("An error occurred");
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewUserError("");

    if (newUserForm.password.length < 8) {
      setNewUserError("Password must be at least 8 characters");
      return;
    }

    if (!user) { setNewUserError("Not signed in"); return; }
    try {
      const result = await createUser({
        name: newUserForm.name,
        email: newUserForm.email,
        password: newUserForm.password,
        role: newUserForm.role,
        requestingUserId: user._id,
      });

      if (result.success) {
        setShowNewUser(false);
        setNewUserForm({ name: "", email: "", password: "", role: "member" });
      } else {
        setNewUserError(result.error || "Failed to create user");
      }
    } catch {
      setNewUserError("An error occurred");
    }
  };

  const handleEditLocation = (location: { _id: string; warehouseManagerName?: string; warehouseManagerPhone?: string; warehouseManagerEmail?: string }) => {
    setEditingLocationId(location._id);
    setLocationForm({
      warehouseManagerName: location.warehouseManagerName || "",
      warehouseManagerPhone: location.warehouseManagerPhone || "",
      warehouseManagerEmail: location.warehouseManagerEmail || "",
    });
    setLocationSuccess(null);
  };

  const handleSaveLocation = async () => {
    if (!editingLocationId) return;
    setLocationSaving(true);
    setLocationSuccess(null);

    try {
      await updateLocation({
        id: editingLocationId as Parameters<typeof updateLocation>[0]["id"],
        warehouseManagerName: locationForm.warehouseManagerName || undefined,
        warehouseManagerPhone: locationForm.warehouseManagerPhone || undefined,
        warehouseManagerEmail: locationForm.warehouseManagerEmail || undefined,
      });
      setLocationSuccess(editingLocationId);
      setEditingLocationId(null);
    } catch (error) {
      console.error("Failed to update location:", error);
    } finally {
      setLocationSaving(false);
    }
  };

  const handleCancelEditLocation = () => {
    setEditingLocationId(null);
    setLocationForm({
      warehouseManagerName: "",
      warehouseManagerPhone: "",
      warehouseManagerEmail: "",
    });
  };

  return (
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        {/* Header */}
        <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <h1 className={`text-xl sm:text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Settings</h1>
          <p className={`text-xs sm:text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            Manage your account and team settings
          </p>
        </header>

        <div className="p-4 sm:p-8">
          {/* Tabs */}
          <div className={`flex flex-wrap gap-2 sm:gap-4 mb-6 sm:mb-8 border-b pb-4 ${isDark ? "border-slate-700" : "border-gray-200"}`}>
            <button
              onClick={() => setActiveTab("profile")}
              className={`px-4 py-2 font-medium rounded-lg transition-colors ${
                activeTab === "profile"
                  ? isDark
                    ? "bg-cyan-500/20 text-cyan-400"
                    : "bg-blue-50 text-blue-600"
                  : isDark
                    ? "text-slate-400 hover:text-white"
                    : "text-gray-500 hover:text-gray-900"
              }`}
            >
              Profile
            </button>
            <button
              onClick={() => setActiveTab("security")}
              className={`px-4 py-2 font-medium rounded-lg transition-colors ${
                activeTab === "security"
                  ? isDark
                    ? "bg-cyan-500/20 text-cyan-400"
                    : "bg-blue-50 text-blue-600"
                  : isDark
                    ? "text-slate-400 hover:text-white"
                    : "text-gray-500 hover:text-gray-900"
              }`}
            >
              Security
            </button>
            {canManageUsers && (
              <>
                <button
                  onClick={() => setActiveTab("users")}
                  className={`px-4 py-2 font-medium rounded-lg transition-colors ${
                    activeTab === "users"
                      ? isDark
                        ? "bg-cyan-500/20 text-cyan-400"
                        : "bg-blue-50 text-blue-600"
                      : isDark
                        ? "text-slate-400 hover:text-white"
                        : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  Users
                </button>
                <button
                  onClick={() => setActiveTab("locations")}
                  className={`px-4 py-2 font-medium rounded-lg transition-colors ${
                    activeTab === "locations"
                      ? isDark
                        ? "bg-cyan-500/20 text-cyan-400"
                        : "bg-blue-50 text-blue-600"
                      : isDark
                        ? "text-slate-400 hover:text-white"
                        : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  Locations
                </button>
              </>
            )}
          </div>

          {/* Profile Tab */}
          {activeTab === "profile" && (
            <div className="max-w-2xl space-y-6">
              {/* Profile Information Card */}
              <div className={`border rounded-xl p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
                <h2 className={`text-lg font-semibold mb-6 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Profile Information
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Name
                    </label>
                    <input
                      type="text"
                      value={user?.name || ""}
                      disabled
                      className={`w-full px-4 py-3 border rounded-lg disabled:opacity-50 ${isDark ? "bg-slate-900/50 border-slate-600 text-white" : "bg-gray-50 border-gray-300 text-gray-900"}`}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Email
                    </label>
                    <input
                      type="email"
                      value={user?.email || ""}
                      disabled
                      className={`w-full px-4 py-3 border rounded-lg disabled:opacity-50 ${isDark ? "bg-slate-900/50 border-slate-600 text-white" : "bg-gray-50 border-gray-300 text-gray-900"}`}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Role
                    </label>
                    <input
                      type="text"
                      value={user?.role || ""}
                      disabled
                      className={`w-full px-4 py-3 border rounded-lg disabled:opacity-50 capitalize ${isDark ? "bg-slate-900/50 border-slate-600 text-white" : "bg-gray-50 border-gray-300 text-gray-900"}`}
                    />
                  </div>
                </div>
              </div>

              {/* Theme Preference Card */}
              <div className={`border rounded-xl p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
                <h2 className={`text-lg font-semibold mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Appearance
                </h2>
                <p className={`text-sm mb-6 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Choose your preferred theme
                </p>

                <div className="grid grid-cols-2 gap-4">
                  {/* Light Theme Option */}
                  <button
                    onClick={() => setTheme("light")}
                    className={`relative p-4 rounded-xl border-2 transition-all ${
                      theme === "light"
                        ? "border-blue-500 ring-2 ring-blue-500/20"
                        : isDark
                          ? "border-slate-600 hover:border-slate-500"
                          : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    {/* Light Theme Preview */}
                    <div className="aspect-[4/3] rounded-lg overflow-hidden bg-gray-100 mb-3">
                      <div className="h-full flex">
                        {/* Sidebar preview */}
                        <div className="w-1/4 bg-white border-r border-gray-200 p-2">
                          <div className="w-full h-2 bg-blue-500 rounded mb-2"></div>
                          <div className="w-3/4 h-1.5 bg-gray-300 rounded mb-1"></div>
                          <div className="w-2/3 h-1.5 bg-gray-300 rounded mb-1"></div>
                          <div className="w-3/4 h-1.5 bg-gray-300 rounded"></div>
                        </div>
                        {/* Content preview */}
                        <div className="flex-1 p-2">
                          <div className="w-1/2 h-2 bg-gray-400 rounded mb-2"></div>
                          <div className="w-full h-8 bg-white rounded border border-gray-200 mb-2"></div>
                          <div className="w-full h-8 bg-white rounded border border-gray-200"></div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>Light</p>
                        <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Clean iOS-style theme</p>
                      </div>
                      {theme === "light" && (
                        <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </button>

                  {/* Dark Theme Option */}
                  <button
                    onClick={() => setTheme("dark")}
                    className={`relative p-4 rounded-xl border-2 transition-all ${
                      theme === "dark"
                        ? "border-cyan-500 ring-2 ring-cyan-500/20"
                        : isDark
                          ? "border-slate-600 hover:border-slate-500"
                          : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    {/* Dark Theme Preview */}
                    <div className="aspect-[4/3] rounded-lg overflow-hidden bg-slate-800 mb-3">
                      <div className="h-full flex">
                        {/* Sidebar preview */}
                        <div className="w-1/4 bg-slate-900 border-r border-slate-700 p-2">
                          <div className="w-full h-2 bg-gradient-to-r from-cyan-400 to-blue-500 rounded mb-2"></div>
                          <div className="w-3/4 h-1.5 bg-slate-600 rounded mb-1"></div>
                          <div className="w-2/3 h-1.5 bg-slate-600 rounded mb-1"></div>
                          <div className="w-3/4 h-1.5 bg-slate-600 rounded"></div>
                        </div>
                        {/* Content preview */}
                        <div className="flex-1 p-2">
                          <div className="w-1/2 h-2 bg-slate-400 rounded mb-2"></div>
                          <div className="w-full h-8 bg-slate-700/50 rounded border border-slate-600 mb-2"></div>
                          <div className="w-full h-8 bg-slate-700/50 rounded border border-slate-600"></div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>Dark</p>
                        <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Blue & cyan accents</p>
                      </div>
                      {theme === "dark" && (
                        <div className="w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center">
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </button>
                </div>
              </div>

              {/* Layout / Shell Mode */}
              <div className={`border rounded-xl p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
                <h2 className={`text-lg font-semibold mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Layout Mode
                </h2>
                <p className={`text-sm mb-6 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Choose how IE Central looks and feels
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {/* Modern */}
                  <button
                    onClick={() => setAppearance("modern")}
                    className={`relative p-4 rounded-xl border-2 transition-all ${
                      appearance === "modern"
                        ? isDark ? "border-cyan-500 ring-2 ring-cyan-500/20" : "border-blue-500 ring-2 ring-blue-500/20"
                        : isDark ? "border-slate-600 hover:border-slate-500" : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className={`aspect-[4/3] rounded-lg overflow-hidden mb-3 ${isDark ? "bg-slate-800" : "bg-gray-100"}`}>
                      <div className="h-full flex">
                        <div className={`w-1/4 p-1.5 ${isDark ? "bg-slate-900 border-r border-slate-700" : "bg-white border-r border-gray-200"}`}>
                          <div className={`w-full h-1.5 rounded mb-1 ${isDark ? "bg-cyan-500" : "bg-blue-500"}`}></div>
                          <div className={`w-3/4 h-1 rounded mb-0.5 ${isDark ? "bg-slate-600" : "bg-gray-300"}`}></div>
                          <div className={`w-2/3 h-1 rounded ${isDark ? "bg-slate-600" : "bg-gray-300"}`}></div>
                        </div>
                        <div className="flex-1 p-1.5">
                          <div className={`w-1/2 h-1.5 rounded mb-1.5 ${isDark ? "bg-slate-500" : "bg-gray-400"}`}></div>
                          <div className={`w-full h-6 rounded ${isDark ? "bg-slate-700" : "bg-white border border-gray-200"}`}></div>
                        </div>
                      </div>
                    </div>
                    <p className={`font-medium text-sm ${isDark ? "text-white" : "text-gray-900"}`}>Modern</p>
                    <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Sidebar navigation</p>
                    {appearance === "modern" && (
                      <div className={`absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center ${isDark ? "bg-cyan-500" : "bg-blue-500"}`}>
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </button>

                  {/* Desktop */}
                  <button
                    onClick={() => setAppearance("desktop")}
                    className={`relative p-4 rounded-xl border-2 transition-all ${
                      appearance === "desktop"
                        ? isDark ? "border-cyan-500 ring-2 ring-cyan-500/20" : "border-blue-500 ring-2 ring-blue-500/20"
                        : isDark ? "border-slate-600 hover:border-slate-500" : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className={`aspect-[4/3] rounded-lg overflow-hidden mb-3 relative ${isDark ? "bg-gradient-to-br from-slate-900 to-indigo-950" : "bg-gradient-to-br from-sky-200 to-teal-100"}`}>
                      {/* Mini desktop icons */}
                      <div className="absolute top-1.5 left-1.5 flex flex-col gap-1.5">
                        {["📁", "📧", "📅"].map((e, i) => (
                          <div key={i} className="text-[8px] text-center">
                            <div>{e}</div>
                          </div>
                        ))}
                      </div>
                      {/* Mini window */}
                      <div className={`absolute top-3 left-6 right-2 bottom-3 rounded-sm overflow-hidden ${isDark ? "bg-slate-800 border border-slate-600" : "bg-white border border-gray-300"}`}>
                        <div className={`h-2 flex items-center gap-0.5 px-1 ${isDark ? "bg-slate-700" : "bg-gray-200"}`}>
                          <div className="w-1 h-1 rounded-full bg-red-500"></div>
                          <div className="w-1 h-1 rounded-full bg-yellow-500"></div>
                          <div className="w-1 h-1 rounded-full bg-green-500"></div>
                        </div>
                      </div>
                      {/* Mini taskbar */}
                      <div className={`absolute bottom-0 left-0 right-0 h-2 ${isDark ? "bg-slate-800/80" : "bg-white/80"}`}></div>
                    </div>
                    <p className={`font-medium text-sm ${isDark ? "text-white" : "text-gray-900"}`}>Desktop</p>
                    <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Windows & icons</p>
                    {appearance === "desktop" && (
                      <div className={`absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center ${isDark ? "bg-cyan-500" : "bg-blue-500"}`}>
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </button>

                  {/* JMK Terminal */}
                  <button
                    onClick={() => setAppearance("jmk")}
                    className={`relative p-4 rounded-xl border-2 transition-all ${
                      appearance === "jmk"
                        ? "border-green-500 ring-2 ring-green-500/20"
                        : isDark ? "border-slate-600 hover:border-slate-500" : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="aspect-[4/3] rounded-lg overflow-hidden mb-3 bg-black p-1.5 font-mono">
                      <p className="text-green-500 text-[7px] leading-tight">IE CENTRAL — JMK</p>
                      <p className="text-cyan-500 text-[6px] leading-tight mt-1">IMPORT EXPORT TIRE</p>
                      <div className="mt-1 border border-green-700/40 p-0.5">
                        <p className="text-green-400 text-[6px] bg-green-500/20">1. Dashboard</p>
                        <p className="text-green-400 text-[6px]">2. Messages</p>
                        <p className="text-green-400 text-[6px]">3. Email</p>
                      </div>
                      <div className="absolute bottom-1.5 left-1.5 right-1.5">
                        <p className="text-green-700 text-[5px]">F1Help  F3Menu  F12Modern</p>
                      </div>
                    </div>
                    <p className={`font-medium text-sm ${isDark ? "text-white" : "text-gray-900"}`}>JMK Terminal</p>
                    <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Retro tribute</p>
                    {appearance === "jmk" && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </button>

                  {/* Pip-Boy */}
                  <button
                    onClick={() => setAppearance("pipboy")}
                    className={`relative p-4 rounded-xl border-2 transition-all ${
                      appearance === "pipboy"
                        ? "border-green-400 ring-2 ring-green-400/20"
                        : isDark ? "border-slate-600 hover:border-slate-500" : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="aspect-[4/3] rounded-lg overflow-hidden mb-3 bg-[#0a1a0a] p-1.5 font-mono relative" style={{ boxShadow: "inset 0 0 20px rgba(0,255,65,0.1)" }}>
                      <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,65,0.1) 2px, rgba(0,255,65,0.1) 4px)" }} />
                      <p className="text-[#00ff41] text-[7px] leading-tight font-bold">VAULT-TEC INDUSTRIES</p>
                      <p className="text-[#00ff41] text-[6px] leading-tight mt-0.5 opacity-70">IE CENTRAL v4.2.6</p>
                      <div className="mt-1.5 space-y-0.5">
                        <div className="flex items-center gap-1">
                          <div className="w-1 h-1 rounded-full bg-[#00ff41]" />
                          <p className="text-[#00ff41] text-[5px]">STAT</p>
                          <div className="flex-1 h-[2px] bg-[#00ff41]/30 rounded">
                            <div className="w-3/4 h-full bg-[#00ff41] rounded" />
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-1 h-1 rounded-full bg-[#00ff41]" />
                          <p className="text-[#00ff41] text-[5px]">DATA</p>
                          <div className="flex-1 h-[2px] bg-[#00ff41]/30 rounded">
                            <div className="w-1/2 h-full bg-[#00ff41] rounded" />
                          </div>
                        </div>
                      </div>
                      <div className="absolute bottom-1 left-1.5 right-1.5 flex justify-between">
                        <p className="text-[#00ff41]/50 text-[4px]">HP 100/100</p>
                        <p className="text-[#00ff41]/50 text-[4px]">RADS 0</p>
                      </div>
                    </div>
                    <p className={`font-medium text-sm ${isDark ? "text-white" : "text-gray-900"}`}>Pip-Boy</p>
                    <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Vault-Tec terminal</p>
                    {appearance === "pipboy" && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#00ff41] flex items-center justify-center">
                        <svg className="w-3 h-3 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </button>

                  {/* Amber CRT */}
                  <button
                    onClick={() => setAppearance("amber")}
                    className={`relative p-4 rounded-xl border-2 transition-all ${
                      appearance === "amber"
                        ? "border-amber-400 ring-2 ring-amber-400/20"
                        : isDark ? "border-slate-600 hover:border-slate-500" : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="aspect-[4/3] rounded-lg overflow-hidden mb-3 bg-[#1a1000] p-1.5 font-mono relative">
                      <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,176,0,0.08) 2px, rgba(255,176,0,0.08) 4px)" }} />
                      <p className="text-amber-400 text-[7px] leading-tight font-bold">IBM 3270 TERMINAL</p>
                      <p className="text-amber-500/70 text-[6px] leading-tight mt-0.5">IMPORT EXPORT TIRE CO</p>
                      <div className="mt-1.5 space-y-0.5">
                        <p className="text-amber-400 text-[5px]">&gt; CONNECTED TO MAINFRAME</p>
                        <p className="text-amber-400/50 text-[5px]">&gt; LOADING INVENTORY...</p>
                        <div className="flex gap-0.5 mt-1">
                          {[1,2,3,4,5].map(i => <div key={i} className="h-1 flex-1 rounded-sm bg-amber-500/30"><div className="h-full rounded-sm bg-amber-400" style={{width:`${i*20}%`}} /></div>)}
                        </div>
                      </div>
                    </div>
                    <p className={`font-medium text-sm ${isDark ? "text-white" : "text-gray-900"}`}>Amber CRT</p>
                    <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>IBM mainframe</p>
                    {appearance === "amber" && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center">
                        <svg className="w-3 h-3 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </button>

                  {/* Dracula */}
                  <button
                    onClick={() => setAppearance("dracula")}
                    className={`relative p-4 rounded-xl border-2 transition-all ${
                      appearance === "dracula"
                        ? "border-purple-400 ring-2 ring-purple-400/20"
                        : isDark ? "border-slate-600 hover:border-slate-500" : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="aspect-[4/3] rounded-lg overflow-hidden mb-3 bg-[#282a36] p-1.5 font-mono relative">
                      <div className="flex h-full">
                        <div className="w-1/4 pr-1 border-r border-[#44475a]">
                          <div className="w-full h-1.5 rounded mb-1 bg-[#bd93f9]" />
                          <div className="w-3/4 h-1 rounded mb-0.5 bg-[#6272a4]" />
                          <div className="w-2/3 h-1 rounded bg-[#6272a4]" />
                        </div>
                        <div className="flex-1 pl-1">
                          <p className="text-[#ff79c6] text-[6px]">Dashboard</p>
                          <div className="flex gap-0.5 mt-1">
                            <div className="flex-1 h-4 rounded-sm bg-[#44475a]" />
                            <div className="flex-1 h-4 rounded-sm bg-[#44475a]" />
                          </div>
                          <div className="mt-1 h-3 rounded-sm bg-[#44475a]" />
                        </div>
                      </div>
                    </div>
                    <p className={`font-medium text-sm ${isDark ? "text-white" : "text-gray-900"}`}>Dracula</p>
                    <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Purple dark</p>
                    {appearance === "dracula" && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#bd93f9] flex items-center justify-center">
                        <svg className="w-3 h-3 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Security Tab */}
          {activeTab === "security" && (
            <div className="max-w-2xl">
              <div className={`border rounded-xl p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
                <h2 className={`text-lg font-semibold mb-6 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Change Password
                </h2>
                <form onSubmit={handlePasswordChange} className="space-y-4">
                  {passwordError && (
                    <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm">
                      {passwordError}
                    </div>
                  )}
                  {passwordSuccess && (
                    <div className="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded-lg text-sm">
                      Password changed successfully
                    </div>
                  )}
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Current Password
                    </label>
                    <input
                      type="password"
                      value={passwordForm.currentPassword}
                      onChange={(e) =>
                        setPasswordForm({
                          ...passwordForm,
                          currentPassword: e.target.value,
                        })
                      }
                      className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                      required
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      New Password
                    </label>
                    <input
                      type="password"
                      value={passwordForm.newPassword}
                      onChange={(e) =>
                        setPasswordForm({
                          ...passwordForm,
                          newPassword: e.target.value,
                        })
                      }
                      className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                      required
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                      Confirm New Password
                    </label>
                    <input
                      type="password"
                      value={passwordForm.confirmPassword}
                      onChange={(e) =>
                        setPasswordForm({
                          ...passwordForm,
                          confirmPassword: e.target.value,
                        })
                      }
                      className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className={`px-6 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                  >
                    Update Password
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Users Tab */}
          {activeTab === "users" && canManageUsers && (
            <div>
              <div className="flex items-center justify-between gap-4 mb-6">
                <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Team Users</h2>
                <button
                  onClick={() => setShowNewUser(true)}
                  className={`px-3 sm:px-4 py-2 text-sm sm:text-base font-medium rounded-lg transition-colors flex items-center gap-2 ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                >
                  <svg
                    className="w-4 h-4 sm:w-5 sm:h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  <span className="hidden sm:inline">Add User</span>
                  <span className="sm:hidden">Add</span>
                </button>
              </div>

              {/* Desktop Table */}
              <div className={`hidden md:block border rounded-xl overflow-hidden ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
                <table className="w-full">
                  <thead>
                    <tr className={`border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                      <th className={`text-left px-6 py-4 text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        User
                      </th>
                      <th className={`text-left px-6 py-4 text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        Role
                      </th>
                      <th className={`text-left px-6 py-4 text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        Status
                      </th>
                      <th className={`text-left px-6 py-4 text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        Last Login
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {users?.map((u) => (
                      <tr
                        key={u._id}
                        className={`border-b ${isDark ? "border-slate-700/50" : "border-gray-100"}`}
                      >
                        <td className="px-6 py-4">
                          <div>
                            <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{u.name}</p>
                            <p className={`text-sm ${isDark ? "text-slate-500" : "text-gray-500"}`}>{u.email}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 text-xs font-medium rounded capitalize ${isDark ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-700"}`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded ${
                              u.isActive
                                ? "bg-green-500/20 text-green-400"
                                : "bg-red-500/20 text-red-400"
                            }`}
                          >
                            {u.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className={`px-6 py-4 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          {u.lastLoginAt
                            ? new Date(u.lastLoginAt).toLocaleDateString()
                            : "Never"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3">
                {users?.map((u) => (
                  <div
                    key={u._id}
                    className={`border rounded-xl p-4 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0 flex-1">
                        <p className={`font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>{u.name}</p>
                        <p className={`text-sm truncate ${isDark ? "text-slate-400" : "text-gray-500"}`}>{u.email}</p>
                      </div>
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded flex-shrink-0 ${
                          u.isActive
                            ? "bg-green-500/20 text-green-400"
                            : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {u.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className={`px-2 py-1 text-xs font-medium rounded capitalize ${isDark ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-700"}`}>
                        {u.role}
                      </span>
                      <span className={isDark ? "text-slate-500" : "text-gray-500"}>
                        {u.lastLoginAt
                          ? `Last login: ${new Date(u.lastLoginAt).toLocaleDateString()}`
                          : "Never logged in"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* New User Modal */}
              {showNewUser && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                  <div className={`border rounded-xl p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
                    <h2 className={`text-xl font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                      Add New User
                    </h2>
                    <form onSubmit={handleCreateUser} className="space-y-4">
                      {newUserError && (
                        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm">
                          {newUserError}
                        </div>
                      )}
                      <div>
                        <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                          Name
                        </label>
                        <input
                          type="text"
                          value={newUserForm.name}
                          onChange={(e) =>
                            setNewUserForm({
                              ...newUserForm,
                              name: e.target.value,
                            })
                          }
                          className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                          required
                        />
                      </div>
                      <div>
                        <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                          Email
                        </label>
                        <input
                          type="email"
                          value={newUserForm.email}
                          onChange={(e) =>
                            setNewUserForm({
                              ...newUserForm,
                              email: e.target.value,
                            })
                          }
                          className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                          required
                        />
                      </div>
                      <div>
                        <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                          Password
                        </label>
                        <input
                          type="password"
                          value={newUserForm.password}
                          onChange={(e) =>
                            setNewUserForm({
                              ...newUserForm,
                              password: e.target.value,
                            })
                          }
                          className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                          required
                        />
                      </div>
                      <div>
                        <label className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                          Role
                        </label>
                        <select
                          value={newUserForm.role}
                          onChange={(e) =>
                            setNewUserForm({
                              ...newUserForm,
                              role: e.target.value,
                            })
                          }
                          className={`w-full px-4 py-3 border rounded-lg focus:outline-none ${isDark ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border-gray-300 text-gray-900 focus:border-blue-500"}`}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <div className="flex gap-3 pt-4">
                        <button
                          type="button"
                          onClick={() => setShowNewUser(false)}
                          className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                        >
                          Create User
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Locations Tab */}
          {activeTab === "locations" && canManageUsers && (
            <div className="max-w-4xl">
              <div className="flex items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                    Location Settings
                  </h2>
                  <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Configure warehouse manager contact info for each location
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {locations?.map((location) => (
                  <div
                    key={location._id}
                    className={`border rounded-xl p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}
                  >
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <h3 className={`font-semibold text-lg ${isDark ? "text-white" : "text-gray-900"}`}>
                          {location.name}
                        </h3>
                        {location.address && (
                          <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                            {location.address}
                            {location.city && `, ${location.city}`}
                            {location.state && `, ${location.state}`}
                            {location.zipCode && ` ${location.zipCode}`}
                          </p>
                        )}
                      </div>
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded ${
                          location.isActive
                            ? "bg-green-500/20 text-green-400"
                            : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {location.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>

                    {/* Success message */}
                    {locationSuccess === location._id && (
                      <div className="mb-4 bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded-lg text-sm">
                        Warehouse manager info saved successfully
                      </div>
                    )}

                    {editingLocationId === location._id ? (
                      /* Edit Mode */
                      <div className="space-y-4">
                        <div className={`p-4 rounded-lg ${isDark ? "bg-slate-700/50" : "bg-gray-50"}`}>
                          <h4 className={`text-sm font-medium mb-4 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                            Warehouse Manager
                          </h4>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <label className={`block text-xs font-medium mb-1.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                Name
                              </label>
                              <input
                                type="text"
                                value={locationForm.warehouseManagerName}
                                onChange={(e) =>
                                  setLocationForm({ ...locationForm, warehouseManagerName: e.target.value })
                                }
                                placeholder="John Smith"
                                className={`w-full px-3 py-2 border rounded-lg focus:outline-none text-sm ${
                                  isDark
                                    ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500 placeholder-slate-500"
                                    : "bg-white border-gray-300 text-gray-900 focus:border-blue-500 placeholder-gray-400"
                                }`}
                              />
                            </div>
                            <div>
                              <label className={`block text-xs font-medium mb-1.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                Phone
                              </label>
                              <input
                                type="tel"
                                value={locationForm.warehouseManagerPhone}
                                onChange={(e) =>
                                  setLocationForm({ ...locationForm, warehouseManagerPhone: e.target.value })
                                }
                                placeholder="(555) 123-4567"
                                className={`w-full px-3 py-2 border rounded-lg focus:outline-none text-sm ${
                                  isDark
                                    ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500 placeholder-slate-500"
                                    : "bg-white border-gray-300 text-gray-900 focus:border-blue-500 placeholder-gray-400"
                                }`}
                              />
                            </div>
                            <div>
                              <label className={`block text-xs font-medium mb-1.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                Email
                              </label>
                              <input
                                type="email"
                                value={locationForm.warehouseManagerEmail}
                                onChange={(e) =>
                                  setLocationForm({ ...locationForm, warehouseManagerEmail: e.target.value })
                                }
                                placeholder="jsmith@company.com"
                                className={`w-full px-3 py-2 border rounded-lg focus:outline-none text-sm ${
                                  isDark
                                    ? "bg-slate-900/50 border-slate-600 text-white focus:border-cyan-500 placeholder-slate-500"
                                    : "bg-white border-gray-300 text-gray-900 focus:border-blue-500 placeholder-gray-400"
                                }`}
                              />
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <button
                            onClick={handleCancelEditLocation}
                            className={`px-4 py-2 font-medium rounded-lg transition-colors text-sm ${
                              isDark
                                ? "bg-slate-700 text-white hover:bg-slate-600"
                                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                            }`}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSaveLocation}
                            disabled={locationSaving}
                            className={`px-4 py-2 font-medium rounded-lg transition-colors text-sm disabled:opacity-50 ${
                              isDark
                                ? "bg-cyan-500 text-white hover:bg-cyan-600"
                                : "bg-blue-600 text-white hover:bg-blue-700"
                            }`}
                          >
                            {locationSaving ? "Saving..." : "Save Changes"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* View Mode */
                      <div>
                        <div className={`p-4 rounded-lg ${isDark ? "bg-slate-700/50" : "bg-gray-50"}`}>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className={`text-sm font-medium ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                              Warehouse Manager
                            </h4>
                            <button
                              onClick={() => handleEditLocation(location)}
                              className={`text-sm font-medium transition-colors ${
                                isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"
                              }`}
                            >
                              Edit
                            </button>
                          </div>
                          {location.warehouseManagerName ? (
                            <div className="space-y-1">
                              <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                                {location.warehouseManagerName}
                              </p>
                              <div className="flex flex-wrap gap-4 text-sm">
                                {location.warehouseManagerPhone && (
                                  <span className={isDark ? "text-slate-400" : "text-gray-500"}>
                                    Phone: {location.warehouseManagerPhone}
                                  </span>
                                )}
                                {location.warehouseManagerEmail && (
                                  <span className={isDark ? "text-slate-400" : "text-gray-500"}>
                                    Email: {location.warehouseManagerEmail}
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <p className={`text-sm italic ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                              No warehouse manager assigned
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {(!locations || locations.length === 0) && (
                  <div className={`text-center py-12 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    <p>No locations found</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Protected minTier={4}>
      <SettingsContent />
    </Protected>
  );
}
