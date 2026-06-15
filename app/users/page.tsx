"use client";

import { useState, useMemo } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "../auth-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  ALL_PERMISSIONS,
  PERMISSION_CATEGORIES,
  getRoleDefaults,
  type PermissionUser,
  type PermissionOverrides,
} from "@/lib/permissions";

interface User {
  _id: Id<"users">;
  email: string;
  name: string;
  title?: string;
  role: string;
  isActive: boolean;
  forcePasswordChange: boolean;
  requiresDailyLog?: boolean;
  reportsTo?: Id<"users">; // Who this user reports to (their manager)
  createdAt: number;
  lastLoginAt?: number;
  managedLocationIds?: Id<"locations">[];
  managedDepartments?: string[];
  // RBAC floating permissions
  isFinalTimeApprover?: boolean;
  isPayrollProcessor?: boolean;
  permissionOverrides?: Record<string, boolean>;
}

function UsersContent() {
  const { user: currentUser, startImpersonation } = useAuth();
  const canActAs = (target: { _id: Id<"users">; role: string }) =>
    currentUser?.role === "super_admin" &&
    target.role !== "super_admin" &&
    target._id !== currentUser?._id;
  const users = useQuery(api.auth.getAllUsers);
  const locations = useQuery(api.locations.list);
  const createUser = useMutation(api.auth.createUser);
  const updateUser = useMutation(api.auth.updateUser);
  const resetPassword = useMutation(api.auth.resetUserPassword);
  const deleteUserMutation = useMutation(api.auth.deleteUser);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showContactAndyModal, setShowContactAndyModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Check if current user is Terry Myers (restricted from adding users initially)
  const isTerryMyers = currentUser?.email?.toLowerCase() === "terry@ietires.com";

  // Form state for new user
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    password: "IETires2026!",
    role: "member",
    sendWelcomeEmail: true,
  });

  // Form state for edit
  const [editForm, setEditForm] = useState({
    name: "",
    title: "",
    email: "",
    role: "",
    isActive: true,
    requiresDailyLog: false,
    reportsTo: null as Id<"users"> | null,
    managedLocationIds: [] as Id<"locations">[],
    managedDepartments: [] as string[],
    // RBAC floating permissions
    isFinalTimeApprover: false,
    isPayrollProcessor: false,
    permissionOverrides: {} as PermissionOverrides,
  });

  // Track which permission categories are expanded
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  // Permission search filter
  const [permissionSearch, setPermissionSearch] = useState("");
  // User list filters
  const [userSearch, setUserSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  // Copy-from-user picker (for the Edit modal)
  const [copyFromUserId, setCopyFromUserId] = useState<Id<"users"> | "">("");

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // Compute role defaults for the currently selected role in the edit form
  const editRoleDefaults = useMemo(() => {
    if (!selectedUser || !editForm.role) return {};
    const tempUser: PermissionUser = {
      _id: selectedUser._id,
      role: editForm.role,
      managedLocationIds: editForm.managedLocationIds,
      managedDepartments: editForm.managedDepartments,
      requiresDailyLog: editForm.requiresDailyLog,
      isFinalTimeApprover: editForm.isFinalTimeApprover,
      isPayrollProcessor: editForm.isPayrollProcessor,
    };
    return getRoleDefaults(tempUser);
  }, [selectedUser, editForm.role, editForm.managedLocationIds, editForm.managedDepartments, editForm.requiresDailyLog, editForm.isFinalTimeApprover, editForm.isPayrollProcessor]);

  // Toggle a permission override: cycles through default → granted → denied → default
  const togglePermissionOverride = (permKey: string) => {
    setEditForm(prev => {
      const overrides = { ...prev.permissionOverrides };
      const roleDefault = editRoleDefaults[permKey] ?? false;

      if (permKey in overrides) {
        if (overrides[permKey] === true && roleDefault) {
          // Was overridden to true (same as default=true) → deny
          overrides[permKey] = false;
        } else if (overrides[permKey] === true && !roleDefault) {
          // Was overridden to true (different from default=false) → remove override (back to default)
          delete overrides[permKey];
        } else if (overrides[permKey] === false && !roleDefault) {
          // Was overridden to false (same as default=false) → remove override
          delete overrides[permKey];
        } else {
          // Was overridden to false (different from default=true) → remove override (back to default)
          delete overrides[permKey];
        }
      } else {
        // No override currently → toggle opposite of default
        overrides[permKey] = !roleDefault;
      }

      return { ...prev, permissionOverrides: overrides };
    });
  };

  // Get the effective value for a permission (override or role default)
  const getEffectivePermission = (permKey: string): { value: boolean; isOverridden: boolean } => {
    if (permKey in editForm.permissionOverrides) {
      return { value: editForm.permissionOverrides[permKey], isOverridden: true };
    }
    return { value: editRoleDefaults[permKey] ?? false, isOverridden: false };
  };

  // Count overrides for a category
  const getCategoryOverrideCount = (categoryKey: string): number => {
    return ALL_PERMISSIONS
      .filter(p => p.category === categoryKey)
      .filter(p => p.key in editForm.permissionOverrides)
      .length;
  };

  // Apply role template (clear all overrides)
  const clearAllOverrides = () => {
    setEditForm(prev => ({ ...prev, permissionOverrides: {} }));
  };

  // Bulk category actions — grant all / deny all / clear category overrides
  const bulkSetCategory = (categoryKey: string, action: "grantAll" | "denyAll" | "clearOverrides") => {
    setEditForm(prev => {
      const overrides = { ...prev.permissionOverrides };
      const catPerms = ALL_PERMISSIONS.filter(p => p.category === categoryKey);
      for (const p of catPerms) {
        if (action === "clearOverrides") {
          delete overrides[p.key];
        } else {
          const target = action === "grantAll";
          const roleDefault = editRoleDefaults[p.key] ?? false;
          if (target === roleDefault) delete overrides[p.key];
          else overrides[p.key] = target;
        }
      }
      return { ...prev, permissionOverrides: overrides };
    });
  };

  // Copy permission overrides from another user
  const copyOverridesFromUser = (sourceUserId: Id<"users">) => {
    const source = users?.find(u => u._id === sourceUserId);
    if (!source) return;
    setEditForm(prev => ({
      ...prev,
      permissionOverrides: source.permissionOverrides ? { ...source.permissionOverrides } : {},
    }));
  };

  // Filter users for the listing
  const filteredUsers = useMemo(() => {
    if (!users) return [] as User[];
    const q = userSearch.trim().toLowerCase();
    return (users as User[]).filter(u => {
      if (statusFilter === "active" && !u.isActive) return false;
      if (statusFilter === "inactive" && u.isActive) return false;
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.title?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [users, userSearch, statusFilter, roleFilter]);

  // Get departments from shift planning module for department_manager assignment
  const departments = useQuery(api.shifts.getDepartments) || [];

  // Form state for password reset
  const [newPassword, setNewPassword] = useState("");

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!currentUser) { setError("Not signed in"); return; }
    const result = await createUser({
      name: newUser.name,
      email: newUser.email,
      password: newUser.password,
      role: newUser.role,
      sendWelcomeEmail: newUser.sendWelcomeEmail,
      requestingUserId: currentUser._id as Id<"users">,
    });

    if (result.success) {
      setSuccess(newUser.sendWelcomeEmail ? "User created and welcome email sent!" : "User created successfully");
      setShowAddModal(false);
      setNewUser({ name: "", email: "", password: "IETires2026!", role: "member", sendWelcomeEmail: true });
    } else {
      setError(result.error || "Failed to create user");
    }
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    if (!currentUser) { setError("Not signed in"); return; }
    setError("");
    setSuccess("");

    const result = await updateUser({
      userId: selectedUser._id,
      name: editForm.name,
      title: editForm.title || undefined,
      email: editForm.email,
      role: editForm.role,
      isActive: editForm.isActive,
      requiresDailyLog: editForm.requiresDailyLog,
      reportsTo: editForm.reportsTo,
      managedLocationIds: (editForm.role === "warehouse_manager" || editForm.role === "retail_store_manager") ? editForm.managedLocationIds : undefined,
      managedDepartments: editForm.role === "department_manager" ? editForm.managedDepartments : undefined,
      isFinalTimeApprover: editForm.isFinalTimeApprover,
      isPayrollProcessor: editForm.isPayrollProcessor,
      permissionOverrides: Object.keys(editForm.permissionOverrides).length > 0 ? editForm.permissionOverrides : {},
      requestingUserId: currentUser._id as Id<"users">,
    });

    if (result.success) {
      setSuccess("User updated successfully");
      setShowEditModal(false);
      setSelectedUser(null);
    } else {
      setError(result.error || "Failed to update user");
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setError("");
    setSuccess("");

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (!currentUser) { setError("Not signed in"); return; }
    const result = await resetPassword({
      userId: selectedUser._id,
      newPassword,
      requestingUserId: currentUser._id as Id<"users">,
    });

    if (result.success) {
      setSuccess("Password reset successfully. User will be required to change password on next login.");
      setShowResetModal(false);
      setNewPassword("");
      setSelectedUser(null);
    } else {
      setError("Failed to reset password");
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    setError("");
    setSuccess("");

    if (!currentUser) { setError("Not signed in"); return; }
    const result = await deleteUserMutation({
      userId: selectedUser._id,
      requestingUserId: currentUser._id as Id<"users">,
    });

    if (result.success) {
      setSuccess("User deleted successfully");
      setShowDeleteModal(false);
      setSelectedUser(null);
    } else {
      setError("Failed to delete user");
    }
  };

  const openEditModal = (user: User) => {
    setSelectedUser(user);
    setEditForm({
      name: user.name,
      title: user.title || "",
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      requiresDailyLog: user.requiresDailyLog || false,
      reportsTo: user.reportsTo || null,
      managedLocationIds: user.managedLocationIds || [],
      managedDepartments: user.managedDepartments || [],
      isFinalTimeApprover: user.isFinalTimeApprover || false,
      isPayrollProcessor: user.isPayrollProcessor || false,
      permissionOverrides: user.permissionOverrides ? { ...user.permissionOverrides } : {},
    });
    setExpandedCategories(new Set());
    setPermissionSearch("");
    setCopyFromUserId("");
    setShowEditModal(true);
  };

  const toggleLocationAssignment = (locationId: Id<"locations">) => {
    setEditForm(prev => ({
      ...prev,
      managedLocationIds: prev.managedLocationIds.includes(locationId)
        ? prev.managedLocationIds.filter(id => id !== locationId)
        : [...prev.managedLocationIds, locationId],
    }));
  };

  const toggleDepartmentAssignment = (department: string) => {
    setEditForm(prev => ({
      ...prev,
      managedDepartments: prev.managedDepartments.includes(department)
        ? prev.managedDepartments.filter(d => d !== department)
        : [...prev.managedDepartments, department],
    }));
  };

  const openResetModal = (user: User) => {
    setSelectedUser(user);
    setNewPassword("");
    setShowResetModal(true);
  };

  const openDeleteModal = (user: User) => {
    setSelectedUser(user);
    setShowDeleteModal(true);
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "super_admin":
        return "bg-red-500/20 text-red-400";
      case "admin":
        return "bg-purple-500/20 text-purple-400";
      case "warehouse_director":
        return "bg-emerald-500/20 text-emerald-400";
      case "department_manager":
        return "bg-blue-500/20 text-blue-400";
      case "warehouse_manager":
        return "bg-orange-500/20 text-orange-400";
      case "office_manager":
        return "bg-pink-500/20 text-pink-400";
      case "retail_store_manager":
        return "bg-amber-500/20 text-amber-400";
      case "retail_associate":
        return "bg-teal-500/20 text-teal-400";
      case "member":
        return "bg-cyan-500/20 text-cyan-400";
      default:
        return "bg-slate-500/20 text-slate-400";
    }
  };

  const getRoleDisplayName = (role: string) => {
    switch (role) {
      case "super_admin":
        return "Super Admin";
      case "admin":
        return "Admin";
      case "department_manager":
        return "Department Manager";
      case "warehouse_manager":
        return "Warehouse Manager";
      case "warehouse_director":
        return "Warehouse Director";
      case "office_manager":
        return "Office Manager";
      case "retail_store_manager":
        return "Retail Store Manager";
      case "retail_associate":
        return "Retail Associate";
      case "member":
        return "Member";
      default:
        return role;
    }
  };

  const getLocationNames = (locationIds?: Id<"locations">[]) => {
    if (!locationIds || locationIds.length === 0 || !locations) return null;
    return locationIds
      .map(id => locations.find(l => l._id === id)?.name)
      .filter(Boolean)
      .join(", ");
  };

  const getDepartmentNames = (depts?: string[]) => {
    if (!depts || depts.length === 0) return null;
    return depts.join(", ");
  };

  const getManagerName = (reportsTo?: Id<"users">) => {
    if (!reportsTo || !users) return null;
    const manager = users.find(u => u._id === reportsTo);
    return manager?.name || null;
  };

  const getReportees = (userId: Id<"users">) => {
    if (!users) return [];
    return users.filter(u => u.reportsTo === userId && u.isActive);
  };

  // Unique role list for the filter dropdown
  const roleOptions = useMemo(() => {
    if (!users) return [] as string[];
    return Array.from(new Set(users.map(u => u.role)));
  }, [users]);

  return (
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        {/* Header */}
        <header className="sticky top-0 z-10 theme-bg-card/90 backdrop-blur-md border-b theme-border-primary px-4 sm:px-8 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-semibold theme-text-primary tracking-tight">User Management</h1>
              <p className="theme-text-tertiary text-xs sm:text-sm mt-0.5 truncate">
                Manage accounts, roles, and per-feature permissions
              </p>
            </div>
            <button
              onClick={() => {
                if (isTerryMyers) {
                  setShowContactAndyModal(true);
                } else {
                  setShowAddModal(true);
                }
              }}
              className="px-4 py-2 bg-[#007AFF] hover:bg-[#0063CC] text-white rounded-full font-medium text-sm transition-colors flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">Add User</span>
              <span className="sm:hidden">Add</span>
            </button>
          </div>
        </header>

        <div className="p-4 sm:p-8 max-w-7xl mx-auto">
          {/* Success/Error Messages */}
          {success && (
            <div className="mb-4 p-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm">
              {success}
            </div>
          )}
          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Filter bar */}
          <div className="mb-4 flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative flex-1">
              <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 theme-text-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 110-16 8 8 0 010 16z" />
              </svg>
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search name, email, or title…"
                className="w-full pl-9 pr-3 py-2 rounded-full theme-bg-card border theme-border-primary theme-text-primary placeholder:theme-text-muted text-sm focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:border-[#007AFF]"
              />
            </div>
            <div className="flex items-center gap-1 theme-bg-card rounded-full p-1 border theme-border-primary">
              {(["active", "inactive", "all"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    statusFilter === s ? "bg-[#007AFF] text-white" : "theme-text-secondary hover:theme-text-primary"
                  }`}
                >
                  {s === "all" ? "All" : s === "active" ? "Active" : "Inactive"}
                </button>
              ))}
            </div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-3 py-2 rounded-full theme-bg-card border theme-border-primary theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
            >
              <option value="all">All roles</option>
              {roleOptions.map(r => (
                <option key={r} value={r}>{getRoleDisplayName(r)}</option>
              ))}
            </select>
            <div className="theme-text-muted text-xs whitespace-nowrap sm:ml-2">
              {filteredUsers.length} of {users?.length || 0}
            </div>
          </div>

          {/* Users Table - Desktop */}
          <div className="hidden md:block theme-bg-card border theme-border-primary rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full">
              <thead className="theme-bg-secondary">
                <tr>
                  <th className="px-6 py-3 text-left text-[11px] font-semibold theme-text-tertiary uppercase tracking-wider">User</th>
                  <th className="px-6 py-3 text-left text-[11px] font-semibold theme-text-tertiary uppercase tracking-wider">Role</th>
                  <th className="px-6 py-3 text-left text-[11px] font-semibold theme-text-tertiary uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-[11px] font-semibold theme-text-tertiary uppercase tracking-wider">Last Login</th>
                  <th className="px-6 py-3 text-right text-[11px] font-semibold theme-text-tertiary uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y theme-border-secondary">
                {filteredUsers.map((user) => {
                  const overrideCount = Object.keys(user.permissionOverrides || {}).length;
                  return (
                    <tr key={user._id} className="theme-bg-hover transition-colors">
                      <td className="px-6 py-3">
                        <div>
                          <div className="theme-text-primary font-medium">{user.name}</div>
                          {user.title && <div className="theme-text-muted text-xs">{user.title}</div>}
                          <div className="theme-text-tertiary text-sm">{user.email}</div>
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        <div>
                          <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${getRoleBadgeColor(user.role)}`}>
                            {getRoleDisplayName(user.role)}
                          </span>
                          {overrideCount > 0 && (
                            <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-[#007AFF]/15 text-[#007AFF]">
                              {overrideCount} override{overrideCount !== 1 ? "s" : ""}
                            </span>
                          )}
                          {(user.role === "warehouse_manager" || user.role === "retail_store_manager") && (
                            <div className="text-xs theme-text-muted mt-1">
                              {getLocationNames(user.managedLocationIds as Id<"locations">[] | undefined) || "No locations assigned"}
                            </div>
                          )}
                          {user.role === "department_manager" && (
                            <div className="text-xs theme-text-muted mt-1">
                              {getDepartmentNames(user.managedDepartments as string[] | undefined) || "No departments assigned"}
                            </div>
                          )}
                          {getManagerName(user.reportsTo as Id<"users"> | undefined) && (
                            <div className="text-xs theme-text-muted mt-1">
                              Reports to: {getManagerName(user.reportsTo as Id<"users"> | undefined)}
                            </div>
                          )}
                          {getReportees(user._id).length > 0 && (
                            <div className="text-xs text-[#007AFF] mt-1">
                              {getReportees(user._id).length} reportee{getReportees(user._id).length > 1 ? "s" : ""}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${
                          user.isActive
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}>
                          {user.isActive ? "Active" : "Inactive"}
                        </span>
                        {user.forcePasswordChange && (
                          <span className="ml-1.5 px-2 py-0.5 text-[11px] font-medium rounded-full bg-amber-100 text-amber-700">
                            Pwd change
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 theme-text-tertiary text-sm">
                        {user.lastLoginAt
                          ? new Date(user.lastLoginAt).toLocaleDateString("en-US", {
                              month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
                            })
                          : "Never"
                        }
                      </td>
                      <td className="px-6 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canActAs(user as { _id: Id<"users">; role: string }) && (
                            <button
                              onClick={() =>
                                startImpersonation({ _id: user._id, name: user.name, role: user.role })
                              }
                              className="px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 rounded-full transition-colors"
                              title={`Act as ${user.name}`}
                            >
                              Act as
                            </button>
                          )}
                          <button
                            onClick={() => openEditModal(user as User)}
                            className="px-3 py-1.5 text-xs font-medium text-[#007AFF] hover:bg-[#007AFF]/10 rounded-full transition-colors"
                            title="Edit user"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => openResetModal(user as User)}
                            className="px-3 py-1.5 text-xs font-medium theme-text-secondary hover:theme-text-primary theme-bg-hover rounded-full transition-colors"
                            title="Reset password"
                          >
                            Reset
                          </button>
                          {user._id !== currentUser?._id && (
                            <button
                              onClick={() => openDeleteModal(user as User)}
                              className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-full transition-colors"
                              title="Delete user"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredUsers.length === 0 && (
              <div className="text-center py-12 theme-text-muted text-sm">
                {users && users.length > 0 ? "No users match your filters" : "No users found"}
              </div>
            )}
          </div>

          {/* Users Cards - Mobile */}
          <div className="md:hidden space-y-3">
            {filteredUsers.map((user) => {
              const overrideCount = Object.keys(user.permissionOverrides || {}).length;
              return (
                <div
                  key={user._id}
                  className="theme-bg-card border theme-border-primary rounded-2xl p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="theme-text-primary font-medium truncate">{user.name}</h3>
                      {user.title && <p className="theme-text-muted text-xs truncate">{user.title}</p>}
                      <p className="theme-text-tertiary text-sm truncate">{user.email}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${getRoleBadgeColor(user.role)}`}>
                      {getRoleDisplayName(user.role)}
                    </span>
                    <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${
                      user.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                    }`}>
                      {user.isActive ? "Active" : "Inactive"}
                    </span>
                    {overrideCount > 0 && (
                      <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-[#007AFF]/15 text-[#007AFF]">
                        {overrideCount} override{overrideCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    {user.forcePasswordChange && (
                      <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-amber-100 text-amber-700">
                        Pwd change
                      </span>
                    )}
                  </div>
                  {(user.role === "warehouse_manager" || user.role === "retail_store_manager") && (
                    <div className="text-xs theme-text-muted mb-1">
                      Locations: {getLocationNames(user.managedLocationIds as Id<"locations">[] | undefined) || "None"}
                    </div>
                  )}
                  {user.role === "department_manager" && (
                    <div className="text-xs theme-text-muted mb-1">
                      Departments: {getDepartmentNames(user.managedDepartments as string[] | undefined) || "None"}
                    </div>
                  )}
                  {getManagerName(user.reportsTo as Id<"users"> | undefined) && (
                    <div className="text-xs theme-text-muted mb-1">
                      Reports to: {getManagerName(user.reportsTo as Id<"users"> | undefined)}
                    </div>
                  )}
                  <div className="theme-text-muted text-xs mt-2">
                    Last login: {user.lastLoginAt
                      ? new Date(user.lastLoginAt).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                        })
                      : "Never"}
                  </div>
                  <div className="mt-3 pt-3 border-t theme-border-secondary flex gap-2">
                    {canActAs(user as { _id: Id<"users">; role: string }) && (
                      <button
                        onClick={() =>
                          startImpersonation({ _id: user._id, name: user.name, role: user.role })
                        }
                        className="flex-1 px-3 py-2 text-xs font-medium text-amber-700 bg-amber-50 rounded-full transition-colors"
                      >
                        Act as
                      </button>
                    )}
                    <button
                      onClick={() => openEditModal(user as User)}
                      className="flex-1 px-3 py-2 text-xs font-medium text-[#007AFF] bg-[#007AFF]/10 rounded-full transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => openResetModal(user as User)}
                      className="flex-1 px-3 py-2 text-xs font-medium theme-text-secondary theme-bg-hover rounded-full transition-colors"
                    >
                      Reset PW
                    </button>
                    {user._id !== currentUser?._id && (
                      <button
                        onClick={() => openDeleteModal(user as User)}
                        className="flex-1 px-3 py-2 text-xs font-medium text-red-600 bg-red-50 rounded-full transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {filteredUsers.length === 0 && (
              <div className="text-center py-12 theme-text-muted text-sm theme-bg-card border theme-border-primary rounded-2xl">
                {users && users.length > 0 ? "No users match your filters" : "No users found"}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="theme-bg-card rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b theme-border-primary">
              <h2 className="text-lg font-semibold theme-text-primary tracking-tight">Add New User</h2>
            </div>
            <form onSubmit={handleAddUser} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium theme-text-secondary mb-1">Name</label>
                <input
                  type="text"
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  className="w-full px-3 py-2 theme-bg-secondary border theme-border-primary rounded-lg theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:border-[#007AFF]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium theme-text-secondary mb-1">Email</label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="w-full px-3 py-2 theme-bg-secondary border theme-border-primary rounded-lg theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:border-[#007AFF]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium theme-text-secondary mb-1">Role / Tier</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  className="w-full px-3 py-2 theme-bg-secondary border theme-border-primary rounded-lg theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:border-[#007AFF]"
                >
                  <optgroup label="T5 - Super Admin"><option value="super_admin">Super Admin</option></optgroup>
                  <optgroup label="T4 - Admin"><option value="admin">Admin</option></optgroup>
                  <optgroup label="T3 - Director"><option value="warehouse_director">Warehouse Director</option></optgroup>
                  <optgroup label="T2 - Manager">
                    <option value="warehouse_manager">Warehouse Manager</option>
                    <option value="office_manager">Office Manager</option>
                    <option value="retail_store_manager">Retail Store Manager</option>
                  </optgroup>
                  <optgroup label="T1 - Shift Lead">
                    <option value="department_manager">Department Manager</option>
                    <option value="shift_lead">Shift Lead</option>
                    <option value="retail_associate">Retail Associate</option>
                  </optgroup>
                  <optgroup label="T0 - Employee">
                    <option value="member">Member</option>
                    <option value="employee">Employee</option>
                  </optgroup>
                </select>
              </div>
              <label className="flex items-center gap-2.5 p-3 theme-bg-secondary rounded-lg border theme-border-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={newUser.sendWelcomeEmail}
                  onChange={(e) => setNewUser({ ...newUser, sendWelcomeEmail: e.target.checked })}
                  className="w-4 h-4 rounded text-[#007AFF] focus:ring-[#007AFF]/40"
                />
                <span className="text-sm theme-text-primary">Send welcome email with login credentials</span>
              </label>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 theme-bg-secondary theme-text-primary theme-bg-hover rounded-full font-medium text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-[#007AFF] hover:bg-[#0063CC] text-white rounded-full font-medium text-sm transition-colors shadow-sm"
                >
                  Add User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="theme-bg-card rounded-2xl shadow-2xl w-full max-w-5xl max-h-[95vh] flex flex-col overflow-hidden">
            {/* Modal header */}
            <div className="px-6 py-4 border-b theme-border-primary flex items-center justify-between">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold theme-text-primary tracking-tight">Edit User</h2>
                <p className="theme-text-tertiary text-xs mt-0.5 truncate">{selectedUser.name} · {selectedUser.email}</p>
              </div>
              <button
                type="button"
                onClick={() => { setShowEditModal(false); setSelectedUser(null); }}
                className="p-1.5 theme-text-tertiary hover:theme-text-primary rounded-full theme-bg-hover transition-colors"
                aria-label="Close"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form id="editUserForm" onSubmit={handleEditUser} className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {/* Identity + Scope: two-column on desktop */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* IDENTITY card */}
                <section className="theme-bg-secondary rounded-2xl border theme-border-primary p-4">
                  <h3 className="text-xs font-semibold theme-text-tertiary uppercase tracking-wider mb-3">Identity</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium theme-text-secondary mb-1">Name</label>
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className="w-full px-3 py-2 theme-bg-card border theme-border-primary rounded-lg theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:border-[#007AFF]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium theme-text-secondary mb-1">Job Title</label>
                      <input
                        type="text"
                        value={editForm.title}
                        onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                        placeholder="e.g. Warehouse Supervisor"
                        className="w-full px-3 py-2 theme-bg-card border theme-border-primary rounded-lg theme-text-primary placeholder:theme-text-muted text-sm focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:border-[#007AFF]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium theme-text-secondary mb-1">Email</label>
                      <input
                        type="email"
                        value={editForm.email}
                        onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                        className="w-full px-3 py-2 theme-bg-card border theme-border-primary rounded-lg theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:border-[#007AFF]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium theme-text-secondary mb-1">Role / Tier</label>
                      <select
                        value={editForm.role}
                        onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                        className="w-full px-3 py-2 theme-bg-card border theme-border-primary rounded-lg theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:border-[#007AFF]"
                      >
                        <optgroup label="T5 - Super Admin"><option value="super_admin">Super Admin</option></optgroup>
                        <optgroup label="T4 - Admin"><option value="admin">Admin</option></optgroup>
                        <optgroup label="T3 - Director"><option value="warehouse_director">Warehouse Director</option></optgroup>
                        <optgroup label="T2 - Manager">
                          <option value="warehouse_manager">Warehouse Manager</option>
                          <option value="office_manager">Office Manager</option>
                          <option value="retail_store_manager">Retail Store Manager</option>
                        </optgroup>
                        <optgroup label="T1 - Shift Lead">
                          <option value="department_manager">Department Manager</option>
                          <option value="shift_lead">Shift Lead</option>
                          <option value="retail_associate">Retail Associate</option>
                        </optgroup>
                        <optgroup label="T0 - Employee">
                          <option value="member">Member</option>
                          <option value="employee">Employee</option>
                        </optgroup>
                      </select>
                      <p className="text-[11px] theme-text-muted mt-1">Tier sets baseline permissions; per-feature overrides apply on top.</p>
                    </div>
                    <div className="flex flex-col gap-2 pt-1">
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editForm.isActive}
                          onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                          className="w-4 h-4 rounded text-[#007AFF] focus:ring-[#007AFF]/40"
                        />
                        <span className="text-sm theme-text-primary">Active account</span>
                      </label>
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editForm.requiresDailyLog}
                          onChange={(e) => setEditForm({ ...editForm, requiresDailyLog: e.target.checked })}
                          className="w-4 h-4 rounded text-[#007AFF] focus:ring-[#007AFF]/40"
                        />
                        <span className="text-sm theme-text-primary">Requires daily log</span>
                      </label>
                    </div>
                  </div>
                </section>

                {/* SCOPE card */}
                <section className="theme-bg-secondary rounded-2xl border theme-border-primary p-4">
                  <h3 className="text-xs font-semibold theme-text-tertiary uppercase tracking-wider mb-3">Scope &amp; Reporting</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium theme-text-secondary mb-1">Reports to</label>
                      <select
                        value={editForm.reportsTo || ""}
                        onChange={(e) => setEditForm({ ...editForm, reportsTo: e.target.value ? e.target.value as Id<"users"> : null })}
                        className="w-full px-3 py-2 theme-bg-card border theme-border-primary rounded-lg theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:border-[#007AFF]"
                      >
                        <option value="">No manager</option>
                        {users?.filter(u => u._id !== selectedUser?._id && u.isActive).map((user) => (
                          <option key={user._id} value={user._id}>
                            {user.name} ({getRoleDisplayName(user.role)})
                          </option>
                        ))}
                      </select>
                    </div>

                    {(editForm.role === "warehouse_manager" || editForm.role === "retail_store_manager") && (
                      <div>
                        <label className="block text-xs font-medium theme-text-secondary mb-1">Assigned locations</label>
                        <div className="max-h-32 overflow-y-auto theme-bg-card rounded-lg p-2 border theme-border-primary space-y-1">
                          {locations?.filter(loc => loc.isActive).map((location) => (
                            <label key={location._id} className="flex items-center gap-2 p-1.5 rounded theme-bg-hover cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editForm.managedLocationIds.includes(location._id)}
                                onChange={() => toggleLocationAssignment(location._id)}
                                className="w-4 h-4 rounded text-[#007AFF] focus:ring-[#007AFF]/40"
                              />
                              <span className="text-sm theme-text-primary">{location.name}</span>
                            </label>
                          ))}
                        </div>
                        {editForm.managedLocationIds.length === 0 && (
                          <p className="text-amber-600 text-[11px] mt-1">No locations selected — shift planning will be empty.</p>
                        )}
                      </div>
                    )}

                    {editForm.role === "department_manager" && (
                      <div>
                        <label className="block text-xs font-medium theme-text-secondary mb-1">Assigned departments</label>
                        <div className="max-h-32 overflow-y-auto theme-bg-card rounded-lg p-2 border theme-border-primary space-y-1">
                          {departments.length > 0 ? departments.map((department) => (
                            <label key={department} className="flex items-center gap-2 p-1.5 rounded theme-bg-hover cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editForm.managedDepartments.includes(department)}
                                onChange={() => toggleDepartmentAssignment(department)}
                                className="w-4 h-4 rounded text-[#007AFF] focus:ring-[#007AFF]/40"
                              />
                              <span className="text-sm theme-text-primary">{department}</span>
                            </label>
                          )) : (
                            <p className="theme-text-muted text-xs text-center py-2">No departments available</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Special floating permissions */}
                    <div className="pt-2 border-t theme-border-secondary">
                      <p className="text-[11px] font-semibold theme-text-tertiary uppercase tracking-wider mb-2">Special</p>
                      <label className="flex items-start gap-2.5 cursor-pointer mb-2">
                        <input
                          type="checkbox"
                          checked={editForm.isFinalTimeApprover}
                          onChange={(e) => setEditForm({ ...editForm, isFinalTimeApprover: e.target.checked })}
                          className="mt-0.5 w-4 h-4 rounded text-[#007AFF] focus:ring-[#007AFF]/40"
                        />
                        <span className="flex-1">
                          <span className="block text-sm theme-text-primary">Final Time Approver</span>
                          <span className="block text-[11px] theme-text-muted">Final pass on timesheets after location manager</span>
                        </span>
                      </label>
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editForm.isPayrollProcessor}
                          onChange={(e) => setEditForm({ ...editForm, isPayrollProcessor: e.target.checked })}
                          className="mt-0.5 w-4 h-4 rounded text-[#007AFF] focus:ring-[#007AFF]/40"
                        />
                        <span className="flex-1">
                          <span className="block text-sm theme-text-primary">Payroll Processor</span>
                          <span className="block text-[11px] theme-text-muted">Can export payroll data and access payroll reports</span>
                        </span>
                      </label>
                    </div>
                  </div>
                </section>
              </div>

              {/* PERMISSIONS card */}
              <section className="theme-bg-secondary rounded-2xl border theme-border-primary p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <h3 className="text-xs font-semibold theme-text-tertiary uppercase tracking-wider">Feature Permissions</h3>
                    <p className="text-[11px] theme-text-muted mt-0.5">
                      Role defaults shown by default. Click a row to override (grant/deny on top of the role).
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <select
                      value={copyFromUserId}
                      onChange={(e) => {
                        const id = e.target.value as Id<"users"> | "";
                        setCopyFromUserId(id);
                        if (id) copyOverridesFromUser(id);
                      }}
                      className="px-2.5 py-1.5 theme-bg-card border theme-border-primary rounded-full text-xs theme-text-primary focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                    >
                      <option value="">Copy overrides from…</option>
                      {users?.filter(u => u._id !== selectedUser._id).map(u => {
                        const oc = Object.keys(u.permissionOverrides || {}).length;
                        return (
                          <option key={u._id} value={u._id}>
                            {u.name} ({getRoleDisplayName(u.role)}){oc ? ` · ${oc} ovr` : ""}
                          </option>
                        );
                      })}
                    </select>
                    {Object.keys(editForm.permissionOverrides).length > 0 && (
                      <button
                        type="button"
                        onClick={clearAllOverrides}
                        className="px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-full transition-colors"
                      >
                        Clear all overrides ({Object.keys(editForm.permissionOverrides).length})
                      </button>
                    )}
                  </div>
                </div>

                {/* Search */}
                <div className="relative mb-3">
                  <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 theme-text-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 110-16 8 8 0 010 16z" />
                  </svg>
                  <input
                    type="text"
                    value={permissionSearch}
                    onChange={(e) => setPermissionSearch(e.target.value)}
                    placeholder="Search permissions… (auto-expands matches)"
                    className="w-full pl-9 pr-3 py-2 text-sm theme-bg-card border theme-border-primary rounded-full theme-text-primary placeholder:theme-text-muted focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:border-[#007AFF]"
                  />
                </div>

                {/* Legend */}
                <div className="flex items-center gap-3 text-[11px] theme-text-tertiary mb-2">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> granted</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300" /> role default</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> denied</span>
                </div>

                <div className="space-y-2">
                  {PERMISSION_CATEGORIES.map((cat) => {
                    const searchLower = permissionSearch.toLowerCase();
                    const allCatPerms = ALL_PERMISSIONS.filter(p => p.category === cat.key);
                    const catPerms = allCatPerms.filter(p => (
                      !permissionSearch || p.label.toLowerCase().includes(searchLower) || p.description.toLowerCase().includes(searchLower)
                    ));
                    if (catPerms.length === 0) return null;
                    const isExpanded = expandedCategories.has(cat.key) || !!permissionSearch;
                    const overrideCount = getCategoryOverrideCount(cat.key);
                    const grantedCount = allCatPerms.filter(p => getEffectivePermission(p.key).value).length;

                    return (
                      <div key={cat.key} className="theme-bg-card rounded-xl border theme-border-secondary overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 theme-bg-hover">
                          <button
                            type="button"
                            onClick={() => toggleCategory(cat.key)}
                            className="flex items-center gap-2 flex-1 text-left"
                          >
                            <svg
                              className={`w-3 h-3 theme-text-muted transition-transform ${isExpanded ? "rotate-90" : ""}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                            </svg>
                            <span className="text-sm theme-text-primary font-medium">{cat.label}</span>
                            <span className="text-[11px] theme-text-muted">{grantedCount}/{allCatPerms.length}</span>
                            {overrideCount > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#007AFF]/15 text-[#007AFF] font-medium">
                                {overrideCount} ovr
                              </span>
                            )}
                          </button>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => bulkSetCategory(cat.key, "grantAll")}
                              className="px-2 py-0.5 text-[11px] font-medium text-green-700 hover:bg-green-100 rounded-full transition-colors"
                              title="Grant all in this category"
                            >
                              Grant
                            </button>
                            <button
                              type="button"
                              onClick={() => bulkSetCategory(cat.key, "denyAll")}
                              className="px-2 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-100 rounded-full transition-colors"
                              title="Deny all in this category"
                            >
                              Deny
                            </button>
                            {overrideCount > 0 && (
                              <button
                                type="button"
                                onClick={() => bulkSetCategory(cat.key, "clearOverrides")}
                                className="px-2 py-0.5 text-[11px] font-medium theme-text-secondary theme-bg-hover rounded-full transition-colors"
                                title="Clear overrides in this category"
                              >
                                Reset
                              </button>
                            )}
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="py-1">
                            {catPerms.map((perm) => {
                              const { value, isOverridden } = getEffectivePermission(perm.key);
                              const roleDefault = editRoleDefaults[perm.key] ?? false;
                              const dotClass = isOverridden
                                ? (value ? "bg-green-500" : "bg-red-500")
                                : (value ? "bg-green-300" : "bg-gray-300");
                              const stateLabel = isOverridden
                                ? (value ? "granted" : "denied")
                                : (value ? "default: granted" : "default: denied");

                              return (
                                <button
                                  type="button"
                                  key={perm.key}
                                  onClick={() => togglePermissionOverride(perm.key)}
                                  className="w-full flex items-start gap-3 px-3 py-2 text-left theme-bg-hover transition-colors border-t theme-border-secondary first:border-t-0"
                                >
                                  <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`} />
                                  <span className="flex-1 min-w-0">
                                    <span className="flex items-center gap-2 flex-wrap">
                                      <span className={`text-sm ${isOverridden ? "theme-text-primary font-medium" : "theme-text-secondary"}`}>
                                        {perm.label}
                                      </span>
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                        isOverridden
                                          ? value !== roleDefault
                                            ? value ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                                            : "bg-gray-100 text-gray-600"
                                          : "theme-bg-secondary theme-text-muted"
                                      }`}>
                                        {stateLabel}
                                      </span>
                                    </span>
                                    <span className="block text-[11px] theme-text-muted mt-0.5">{perm.description}</span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            </form>

            {/* Sticky footer */}
            <div className="px-6 py-3 border-t theme-border-primary theme-bg-card flex items-center justify-between gap-3">
              <div className="text-xs theme-text-tertiary">
                {Object.keys(editForm.permissionOverrides).length > 0
                  ? `${Object.keys(editForm.permissionOverrides).length} override${Object.keys(editForm.permissionOverrides).length !== 1 ? "s" : ""} on top of ${getRoleDisplayName(editForm.role)} defaults`
                  : `Using ${getRoleDisplayName(editForm.role)} defaults`}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setShowEditModal(false); setSelectedUser(null); }}
                  className="px-4 py-2 theme-bg-secondary theme-text-primary theme-bg-hover rounded-full font-medium text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="editUserForm"
                  className="px-5 py-2 bg-[#007AFF] hover:bg-[#0063CC] text-white rounded-full font-medium text-sm transition-colors shadow-sm"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showResetModal && selectedUser && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="theme-bg-card rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b theme-border-primary">
              <h2 className="text-lg font-semibold theme-text-primary tracking-tight">Reset Password</h2>
              <p className="theme-text-tertiary text-xs mt-0.5">For {selectedUser.name}</p>
            </div>
            <form onSubmit={handleResetPassword} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium theme-text-secondary mb-1">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 theme-bg-secondary border theme-border-primary rounded-lg theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:border-[#007AFF]"
                  required
                  minLength={8}
                />
                <p className="text-[11px] theme-text-muted mt-1">Minimum 8 characters. User will be required to change on next login.</p>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowResetModal(false); setSelectedUser(null); setNewPassword(""); }}
                  className="flex-1 px-4 py-2 theme-bg-secondary theme-text-primary theme-bg-hover rounded-full font-medium text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-full font-medium text-sm transition-colors shadow-sm"
                >
                  Reset Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete User Modal */}
      {showDeleteModal && selectedUser && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="theme-bg-card rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b theme-border-primary">
              <h2 className="text-lg font-semibold theme-text-primary tracking-tight">Delete User</h2>
            </div>
            <div className="px-6 py-5">
              <p className="theme-text-secondary text-sm">
                Are you sure you want to delete <span className="theme-text-primary font-medium">{selectedUser.name}</span>? This action cannot be undone.
              </p>
              <div className="flex gap-2 pt-5">
                <button
                  type="button"
                  onClick={() => { setShowDeleteModal(false); setSelectedUser(null); }}
                  className="flex-1 px-4 py-2 theme-bg-secondary theme-text-primary theme-bg-hover rounded-full font-medium text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteUser}
                  className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-full font-medium text-sm transition-colors shadow-sm"
                >
                  Delete User
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contact Andy Modal (for Terry Myers) */}
      {showContactAndyModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="theme-bg-card rounded-2xl shadow-2xl w-full max-w-md p-6 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-[#007AFF]/15 flex items-center justify-center">
              <svg className="w-7 h-7 text-[#007AFF]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold theme-text-primary mb-2 tracking-tight">Need Help Adding Users?</h2>
            <p className="theme-text-secondary text-sm mb-5">
              Please see Andy for help with adding new users for the first time. He&apos;ll walk you through the process.
            </p>
            <button
              onClick={() => setShowContactAndyModal(false)}
              className="px-6 py-2 bg-[#007AFF] hover:bg-[#0063CC] text-white rounded-full font-medium text-sm transition-colors shadow-sm"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function UsersPage() {
  return (
    <Protected minTier={4}>
      <UsersContent />
    </Protected>
  );
}
