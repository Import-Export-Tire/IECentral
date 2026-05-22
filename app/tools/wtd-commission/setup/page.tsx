"use client";

import { useState, useCallback } from "react";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import { useAuth } from "@/app/auth-context";
import { usePermissions } from "@/lib/usePermissions";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";

// ─── TYPES ──────────────────────────────────────────────────────────────────

interface CustomerConfig {
  _id: Id<"wtdCommissionCustomers">;
  customerName: string;
  customerNumber: string;
  qualifyingDclasses: string[];
  qualifyingBrands: string[];
  commissionType: string;
  commissionValue: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

interface AccessUser {
  _id: Id<"users">;
  name: string;
  email?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ConvexUser = any;

interface FormState {
  customerName: string;
  customerNumber: string;
  dclassInput: string;
  dclasses: string[];
  brandInput: string;
  brands: string[];
  allBrands: boolean;
  commissionType: "percentage" | "flat";
  commissionValue: string;
}

// Brand code → full name mapping (from OEA07V MFG Id values)
const BRAND_MAP: Record<string, string> = {
  ACHIL: "Achilles", ADV: "Advance", AGS: "AGS", AM: "Americus", APL: "Aplus",
  ARC: "Arcomet", ARI: "Arize", AROY: "Arroyo", ARS: "American Roadstar",
  ATL: "Atlas", ATT: "Atturo", BFG: "BF Goodrich", BLK: "Blacklion",
  BRIDG: "Bridgestone", CARL: "Carlisle", CEL: "Celsius", CNV: "Conversol",
  CON: "Continental", COO: "Cooper", COS: "Cosmo", CRM: "Crossmax",
  CWN: "Crown", DCE: "DC", DEE: "Deestone", DEL: "Deli", DELIN: "Delinte",
  DOR: "Doral", DUN: "Dunlop", FAL: "Falken", FED: "Federal",
  FIN: "Finalist", FIR: "Firestone", FLW: "Fullway", FORC: "Forceum",
  FORT: "Fortress", FUZ: "Fuzion", GAL: "Galaxy", GDY: "Goodyear",
  GEN: "General", GREEN: "Greenmax", GTRAD: "GT Radial", HAN: "Hankook",
  HRC: "Hercules", IRN: "Ironman", KLY: "Kelly", KN: "Kenda",
  KUMHO: "Kumho", LAN: "Landsail", LEAO: "Leao", LFN: "Lexani",
  LION: "Lionhart", LNS: "Landsail", LVR: "Landvigator", LXN: "Lexani",
  MAX: "Maxxis", MICK: "Mickey Thompson", MIL: "Milestar", MOHWK: "Mohawk",
  MONT: "Montego", NEX: "Nexen", NOK: "Nokian", OX: "Ohtsu",
  OTAN: "Otani", PET: "Petlas", PIR: "Pirelli", RADAR: "Radar",
  RBP: "RBP", SCP: "Scorpion", SIG: "Sigma", SOL: "Solidtyre",
  STF: "Starfire", SUM: "Sumitomo", TBB: "TBB", TKN: "Tokunbo",
  TND: "Thunderer", TOY: "Toyo", TRD: "TRD", TRI: "Triangle",
  TRX: "Trazano", TVS: "Traverse", UNI: "Uniroyal", VAL: "Valiante",
  VN: "Venom", VRC: "Vercelli", VT: "Vitour", VTG: "Vintage",
  WES: "Westlake", WF: "Windforce", YOK: "Yokohama", ZET: "Zeta",
};

const EMPTY_FORM: FormState = {
  customerName: "",
  customerNumber: "",
  dclassInput: "",
  dclasses: [],
  brandInput: "",
  brands: [],
  allBrands: false,
  commissionType: "percentage",
  commissionValue: "",
};

// ─── MAIN PAGE ──────────────────────────────────────────────────────────────

export default function WTDCommissionSetupPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();
  const permissions = usePermissions();

  const customers = useQuery(api.wtdCommission.listCustomers);
  const accessData = useQuery(api.wtdCommission.getAccessOverridesWithNames);
  const allUsers = useQuery(api.auth.getAllUsers);
  const hasOverrideAccess = useQuery(
    api.wtdCommission.checkAccess,
    user?._id ? { userId: user._id } : "skip"
  );

  const createCustomer = useMutation(api.wtdCommission.createCustomer);
  const updateCustomer = useMutation(api.wtdCommission.updateCustomer);
  const deleteCustomer = useMutation(api.wtdCommission.deleteCustomer);
  const setAccessOverrides = useMutation(api.wtdCommission.setAccessOverrides);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<Id<"wtdCommissionCustomers"> | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accessSearch, setAccessSearch] = useState("");
  const [showAccessDropdown, setShowAccessDropdown] = useState(false);

  // Access: T5 or on override list
  const canAccess = permissions.tier >= 5 || hasOverrideAccess === true;
  // Only T5 can edit setup and see access overrides
  const canEdit = permissions.tier >= 5;

  const handleAddDclass = useCallback(() => {
    const val = form.dclassInput.trim().toUpperCase();
    if (val && !form.dclasses.includes(val)) {
      setForm((f) => ({ ...f, dclasses: [...f.dclasses, val], dclassInput: "" }));
    }
  }, [form.dclassInput, form.dclasses]);

  const handleRemoveDclass = useCallback((d: string) => {
    setForm((f) => ({ ...f, dclasses: f.dclasses.filter((x) => x !== d) }));
  }, []);

  const handleAddBrand = useCallback(() => {
    const val = form.brandInput.trim().toUpperCase();
    if (val && !form.brands.includes(val)) {
      setForm((f) => ({ ...f, brands: [...f.brands, val], brandInput: "" }));
    }
  }, [form.brandInput, form.brands]);

  const handleRemoveBrand = useCallback((b: string) => {
    setForm((f) => ({ ...f, brands: f.brands.filter((x) => x !== b) }));
  }, []);

  const handleEdit = useCallback((c: CustomerConfig) => {
    const hasAll = c.qualifyingBrands.includes("ALL");
    setForm({
      customerName: c.customerName,
      customerNumber: c.customerNumber,
      dclassInput: "",
      dclasses: c.qualifyingDclasses.filter((d: string) => [".", "^", "[", "]", ":", "~", "-", "<"].includes(d)),
      brandInput: "",
      brands: hasAll ? [] : [...c.qualifyingBrands],
      allBrands: hasAll,
      commissionType: c.commissionType as "percentage" | "flat",
      commissionValue: String(c.commissionValue),
    });
    setEditingId(c._id);
    setShowForm(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!user?._id || !form.customerName || !form.customerNumber || !form.commissionValue) return;

    const value = parseFloat(form.commissionValue);
    if (isNaN(value) || value <= 0) return;

    setSaving(true);
    try {
      const brands = form.allBrands ? ["ALL"] : form.brands;

      if (editingId) {
        await updateCustomer({
          id: editingId,
          customerName: form.customerName,
          customerNumber: form.customerNumber,
          qualifyingDclasses: form.dclasses,
          qualifyingBrands: brands,
          commissionType: form.commissionType,
          commissionValue: value,
          requestingUserId: user._id,
        });
      } else {
        await createCustomer({
          customerName: form.customerName,
          customerNumber: form.customerNumber,
          qualifyingDclasses: form.dclasses,
          qualifyingBrands: brands,
          commissionType: form.commissionType,
          commissionValue: value,
          createdBy: user._id,
        });
      }

      setForm(EMPTY_FORM);
      setEditingId(null);
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }, [form, editingId, user, createCustomer, updateCustomer]);

  const handleToggleActive = useCallback(
    async (c: CustomerConfig) => {
      if (!user) return;
      await updateCustomer({ id: c._id, isActive: !c.isActive, requestingUserId: user._id });
    },
    [updateCustomer, user]
  );

  const handleDelete = useCallback(
    async (id: Id<"wtdCommissionCustomers">) => {
      if (confirm("Delete this customer configuration?")) {
        if (!user) return;
        await deleteCustomer({ id, requestingUserId: user._id });
      }
    },
    [deleteCustomer, user]
  );

  const handleAddAccessUser = useCallback(
    async (userId: Id<"users">) => {
      if (!user?._id || !accessData) return;
      const currentIds = accessData.userIds || [];
      if (currentIds.includes(userId)) return;
      await setAccessOverrides({
        userIds: [...currentIds, userId],
        updatedBy: user._id,
      });
      setAccessSearch("");
      setShowAccessDropdown(false);
    },
    [user, accessData, setAccessOverrides]
  );

  const handleRemoveAccessUser = useCallback(
    async (userId: Id<"users">) => {
      if (!user?._id || !accessData) return;
      await setAccessOverrides({
        userIds: accessData.userIds.filter((id: Id<"users">) => id !== userId),
        updatedBy: user._id,
      });
    },
    [user, accessData, setAccessOverrides]
  );

  // Filtered users for access override dropdown
  const filteredAccessUsers = (allUsers ?? []).filter((u: ConvexUser) => {
    if (!u.isActive) return false;
    if (accessData?.userIds.includes(u._id)) return false;
    if (!accessSearch) return false;
    const search = accessSearch.toLowerCase();
    return u.name.toLowerCase().includes(search) || u.email?.toLowerCase().includes(search);
  });

  if (!canAccess) {
    return (
      <Protected>
        <div className="flex h-screen theme-bg-primary">
          <Sidebar />
          <main className="flex-1 flex items-center justify-center">
            <MobileHeader />
            <div className={`text-center p-8 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              <p className="text-lg font-medium">Access Denied</p>
              <p className="text-sm mt-1">You do not have permission to access WTD Commission Setup.</p>
            </div>
          </main>
        </div>
      </Protected>
    );
  }

  return (
    <Protected>
      <div className="flex h-screen theme-bg-primary">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <MobileHeader />

          {/* Header */}
          <header className={`sticky top-0 z-10 border-b px-6 py-4 ${isDark ? "bg-slate-900/95 backdrop-blur border-slate-700" : "bg-white/95 backdrop-blur border-gray-200"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? "bg-gradient-to-br from-emerald-500/20 to-teal-600/20" : "bg-gradient-to-br from-emerald-100 to-teal-100"}`}>
                  <svg className={`w-5 h-5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <div>
                  <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>WTD Commission Setup</h1>
                  <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>Configure customer commission rules</p>
                </div>
              </div>
              <Link
                href="/tools/wtd-commission"
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isDark ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"}`}
              >
                Run Report
              </Link>
            </div>
          </header>

          <div className="max-w-4xl mx-auto px-6 py-6 space-y-8">
            {/* Customer Configurations */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Customer Configurations</h2>
                {canEdit && !showForm && (
                  <button
                    onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); }}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isDark ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/40" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border border-emerald-300"}`}
                  >
                    + Add Customer
                  </button>
                )}
              </div>

              {/* Form */}
              {showForm && canEdit && (
                <div className={`rounded-xl border p-6 mb-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
                  <h3 className={`text-sm font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                    {editingId ? "Edit Customer" : "New Customer"}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Customer Name */}
                    <div>
                      <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-600"}`}>Customer Name</label>
                      <input
                        type="text"
                        value={form.customerName}
                        onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
                        className={`w-full px-3 py-2 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                        placeholder="e.g. Van's Auto"
                      />
                    </div>

                    {/* Customer Number */}
                    <div>
                      <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-600"}`}>Customer Number</label>
                      <input
                        type="text"
                        value={form.customerNumber}
                        onChange={(e) => setForm((f) => ({ ...f, customerNumber: e.target.value }))}
                        className={`w-full px-3 py-2 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                        placeholder="e.g. W08R20"
                      />
                    </div>

                    {/* Qualifying Item Suffixes */}
                    <div>
                      <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-600"}`}>Qualifying Item Suffixes</label>
                      <p className={`text-[11px] mb-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Item ID ending character determines product ownership</p>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { value: ".", label: '. (dot)' },
                          { value: "^", label: '^ (caret)' },
                          { value: "[", label: '[ (bracket)' },
                          { value: "]", label: '] (bracket)' },
                          { value: ":", label: ': (colon)' },
                          { value: "~", label: '~ (tilde)' },
                          { value: "-", label: '- (dash)' },
                          { value: "<", label: '< (angle)' },
                        ].map((suffix) => (
                          <label key={suffix.value} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                            form.dclasses.includes(suffix.value)
                              ? isDark ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400" : "bg-emerald-100 border-emerald-300 text-emerald-700"
                              : isDark ? "bg-slate-900 border-slate-600 text-slate-400" : "bg-white border-gray-300 text-gray-500"
                          }`}>
                            <input
                              type="checkbox"
                              checked={form.dclasses.includes(suffix.value)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setForm((f) => ({ ...f, dclasses: [...f.dclasses, suffix.value] }));
                                } else {
                                  setForm((f) => ({ ...f, dclasses: f.dclasses.filter((d) => d !== suffix.value) }));
                                }
                              }}
                              className="rounded"
                            />
                            <span className="text-sm font-mono font-bold">{suffix.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Qualifying Brands */}
                    <div>
                      <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-600"}`}>Qualifying Brands</label>
                      <label className={`flex items-center gap-2 mb-2 text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                        <input
                          type="checkbox"
                          checked={form.allBrands}
                          onChange={(e) => setForm((f) => ({ ...f, allBrands: e.target.checked, brands: [] }))}
                          className="rounded"
                        />
                        All Brands
                      </label>
                      {!form.allBrands && (
                        <>
                          <div className="relative">
                            <input
                              type="text"
                              value={form.brandInput}
                              onChange={(e) => setForm((f) => ({ ...f, brandInput: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddBrand(); } }}
                              className={`w-full px-3 py-2 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                              placeholder="e.g. FAL, AROY, DUN — search by code or name"
                            />
                            {form.brandInput.length >= 1 && (
                              <div className={`absolute z-20 w-full mt-1 rounded-lg border shadow-xl max-h-40 overflow-y-auto ${isDark ? "bg-slate-800 border-slate-600" : "bg-white border-gray-200"}`}>
                                {Object.entries(BRAND_MAP)
                                  .filter(([code, name]) => {
                                    const q = form.brandInput.toLowerCase();
                                    return (code.toLowerCase().includes(q) || name.toLowerCase().includes(q)) && !form.brands.includes(code);
                                  })
                                  .slice(0, 10)
                                  .map(([code, name]) => (
                                    <button
                                      key={code}
                                      type="button"
                                      onClick={() => {
                                        setForm((f) => ({ ...f, brands: [...f.brands, code], brandInput: "" }));
                                      }}
                                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${isDark ? "text-slate-300 hover:bg-slate-700" : "text-gray-700 hover:bg-gray-100"}`}
                                    >
                                      <span className="font-mono font-bold">{code}</span>
                                      <span className={`ml-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>{name}</span>
                                    </button>
                                  ))}
                              </div>
                            )}
                          </div>
                          {form.brands.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {form.brands.map((b) => (
                                <span key={b} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${isDark ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-700"}`}>
                                  {b}{BRAND_MAP[b] ? ` (${BRAND_MAP[b]})` : ""}
                                  <button onClick={() => handleRemoveBrand(b)} className="hover:text-red-400">&times;</button>
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Commission Type */}
                    <div>
                      <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-600"}`}>Commission Type</label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, commissionType: "percentage" }))}
                          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                            form.commissionType === "percentage"
                              ? isDark ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" : "bg-emerald-100 text-emerald-700 border-emerald-300"
                              : isDark ? "bg-slate-900 text-slate-400 border-slate-600 hover:border-slate-500" : "bg-white text-gray-500 border-gray-300 hover:border-gray-400"
                          }`}
                        >
                          % of Product Cost
                        </button>
                        <button
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, commissionType: "flat" }))}
                          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                            form.commissionType === "flat"
                              ? isDark ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" : "bg-emerald-100 text-emerald-700 border-emerald-300"
                              : isDark ? "bg-slate-900 text-slate-400 border-slate-600 hover:border-slate-500" : "bg-white text-gray-500 border-gray-300 hover:border-gray-400"
                          }`}
                        >
                          Flat per Unit
                        </button>
                      </div>
                    </div>

                    {/* Commission Value */}
                    <div>
                      <label className={`block text-xs font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                        {form.commissionType === "percentage" ? "Commission % (e.g. 5 for 5%)" : "Amount per Unit ($)"}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.commissionValue}
                        onChange={(e) => setForm((f) => ({ ...f, commissionValue: e.target.value }))}
                        className={`w-full px-3 py-2 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                        placeholder={form.commissionType === "percentage" ? "5" : "2.50"}
                      />
                    </div>
                  </div>

                  {/* Form Actions */}
                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={handleSave}
                      disabled={saving || !form.customerName || !form.customerNumber || !form.commissionValue}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${isDark ? "bg-emerald-600 text-white hover:bg-emerald-500" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
                    >
                      {saving ? "Saving..." : editingId ? "Update" : "Save"}
                    </button>
                    <button
                      onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); }}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isDark ? "bg-slate-700 text-slate-300 hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Customer List */}
              {customers === undefined ? (
                <div className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>Loading...</div>
              ) : customers.length === 0 ? (
                <div className={`rounded-xl border p-8 text-center ${isDark ? "bg-slate-800/30 border-slate-700 text-slate-400" : "bg-gray-50 border-gray-200 text-gray-500"}`}>
                  No customer configurations yet. Click &quot;Add Customer&quot; to get started.
                </div>
              ) : (
                <div className="space-y-3">
                  {customers.map((c: CustomerConfig) => (
                    <div
                      key={c._id}
                      className={`rounded-xl border p-4 ${
                        c.isActive
                          ? isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"
                          : isDark ? "bg-slate-800/20 border-slate-700/50 opacity-60" : "bg-gray-50 border-gray-200 opacity-60"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h3 className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>{c.customerName}</h3>
                            <span className={`px-2 py-0.5 rounded text-xs font-mono ${isDark ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-600"}`}>
                              {c.customerNumber}
                            </span>
                            {!c.isActive && (
                              <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400">Inactive</span>
                            )}
                          </div>
                          <div className={`text-xs space-y-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                            <p>
                              <span className="font-medium">Item Suffixes:</span>{" "}
                              {c.qualifyingDclasses.length > 0 ? c.qualifyingDclasses.map((d: string) => d === "." ? ". (dot)" : d === "^" ? "^ (caret)" : d).join(", ") : "None"}
                            </p>
                            <p>
                              <span className="font-medium">Brands:</span>{" "}
                              {c.qualifyingBrands.includes("ALL") ? "All Brands" : c.qualifyingBrands.map((b: string) => BRAND_MAP[b] ? `${b} (${BRAND_MAP[b]})` : b).join(", ")}
                            </p>
                            <p>
                              <span className="font-medium">Commission:</span>{" "}
                              {c.commissionType === "percentage"
                                ? `${c.commissionValue}% of product cost`
                                : `$${c.commissionValue.toFixed(2)} per unit`}
                            </p>
                          </div>
                        </div>
                        {canEdit && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleToggleActive(c as CustomerConfig)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                c.isActive
                                  ? isDark ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30" : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                                  : isDark ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                              }`}
                            >
                              {c.isActive ? "Deactivate" : "Activate"}
                            </button>
                            <button
                              onClick={() => handleEdit(c as CustomerConfig)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDark ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30" : "bg-blue-100 text-blue-700 hover:bg-blue-200"}`}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(c._id)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDark ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-red-100 text-red-700 hover:bg-red-200"}`}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Access Overrides — T4+ only */}
            {canEdit && (
              <section>
                <h2 className={`text-lg font-semibold mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>Access Overrides</h2>
                <p className={`text-xs mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Grant access to specific users regardless of their RBAC tier. Users with T4+ access always have access.
                </p>

                <div className={`rounded-xl border p-4 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
                  {/* Search to add user */}
                  <div className="relative mb-4">
                    <input
                      type="text"
                      value={accessSearch}
                      onChange={(e) => { setAccessSearch(e.target.value); setShowAccessDropdown(true); }}
                      onFocus={() => setShowAccessDropdown(true)}
                      className={`w-full px-3 py-2 rounded-lg border text-sm ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                      placeholder="Search users to grant access..."
                    />
                    {showAccessDropdown && filteredAccessUsers.length > 0 && (
                      <div className={`absolute z-20 w-full mt-1 rounded-lg border shadow-xl max-h-48 overflow-y-auto ${isDark ? "bg-slate-800 border-slate-600" : "bg-white border-gray-200"}`}>
                        {filteredAccessUsers.slice(0, 10).map((u: ConvexUser) => (
                          <button
                            key={u._id}
                            onClick={() => handleAddAccessUser(u._id)}
                            className={`w-full text-left px-3 py-2 text-sm transition-colors ${isDark ? "text-slate-300 hover:bg-slate-700" : "text-gray-700 hover:bg-gray-100"}`}
                          >
                            <span className="font-medium">{u.name}</span>
                            <span className={`ml-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>{u.email}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Current overrides */}
                  {accessData?.users && accessData.users.length > 0 ? (
                    <div className="space-y-2">
                      {accessData.users.map((u: AccessUser | null) => u && (
                        <div
                          key={u._id}
                          className={`flex items-center justify-between px-3 py-2 rounded-lg ${isDark ? "bg-slate-900/50" : "bg-gray-50"}`}
                        >
                          <div>
                            <span className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{u.name}</span>
                            <span className={`text-xs ml-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>{u.email}</span>
                          </div>
                          <button
                            onClick={() => handleRemoveAccessUser(u._id)}
                            className={`text-xs px-2 py-1 rounded transition-colors ${isDark ? "text-red-400 hover:bg-red-500/20" : "text-red-600 hover:bg-red-100"}`}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className={`text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}>No access overrides configured.</p>
                  )}
                </div>
              </section>
            )}
          </div>
        </main>
      </div>
    </Protected>
  );
}
