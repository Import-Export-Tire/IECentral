"use client";

import { useState, useCallback } from "react";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "@/app/auth-context";
import { usePermissions } from "@/lib/usePermissions";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";

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
  ARC: "Arcomet", ARI: "ARS", AROY: "Arroyo", ARS: "American Roadstar",
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
        <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
          <Sidebar />
          <main className="flex-1 flex items-center justify-center">
            <MobileHeader />
            <Card padding="md" className="max-w-sm mx-auto text-center">
              <p className="text-lg font-medium theme-text-primary">Access Denied</p>
              <p className="text-sm mt-1 theme-text-secondary">You do not have permission to access WTD Commission Setup.</p>
            </Card>
          </main>
        </div>
      </Protected>
    );
  }

  return (
    <Protected>
      <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <MobileHeader />

          {/* Header */}
          <header className="sticky top-0 z-10 border-b px-6 py-4 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-500/20 dark:to-teal-600/20">
                  <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-xl font-bold theme-text-primary">WTD Commission Setup</h1>
                  <p className="text-xs theme-text-tertiary">Configure customer commission rules</p>
                </div>
              </div>
              <Link
                href="/tools/wtd-commission"
                className="inline-flex items-center justify-center gap-1.5 rounded-[9px] font-semibold transition-colors px-3.5 py-2 text-[13.5px] theme-btn-secondary"
              >
                Run Report
              </Link>
            </div>
          </header>

          <div className="max-w-4xl mx-auto px-6 py-6 space-y-8">
            {/* Customer Configurations */}
            <section>
              <SectionHeader
                title="Customer Configurations"
                actions={canEdit && !showForm ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); }}
                  >
                    + Add Customer
                  </Button>
                ) : undefined}
              />

              {/* Form */}
              {showForm && canEdit && (
                <Card padding="md" className="mb-6">
                  <h3 className="text-sm font-semibold mb-4 theme-text-primary">
                    {editingId ? "Edit Customer" : "New Customer"}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Customer Name */}
                    <div>
                      <label className="block text-xs font-medium mb-1 ui-section-label">Customer Name</label>
                      <input
                        type="text"
                        value={form.customerName}
                        onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
                        className="theme-input w-full px-3 py-2 text-sm"
                        placeholder="e.g. Van's Auto"
                      />
                    </div>

                    {/* Customer Number */}
                    <div>
                      <label className="block text-xs font-medium mb-1 ui-section-label">Customer Number</label>
                      <input
                        type="text"
                        value={form.customerNumber}
                        onChange={(e) => setForm((f) => ({ ...f, customerNumber: e.target.value }))}
                        className="theme-input w-full px-3 py-2 text-sm"
                        placeholder="e.g. W08R20"
                      />
                    </div>

                    {/* Qualifying Item Suffixes */}
                    <div>
                      <label className="block text-xs font-medium mb-1 ui-section-label">Qualifying Item Suffixes</label>
                      <p className="text-[11px] mb-2 theme-text-tertiary">Item ID ending character determines product ownership</p>
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
                              ? "bg-[#007AFF]/10 border-[#007AFF]/20 text-[#007AFF]"
                              : "bg-white dark:bg-slate-900 border-gray-300 dark:border-slate-600 theme-text-secondary"
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
                      <label className="block text-xs font-medium mb-1 ui-section-label">Qualifying Brands</label>
                      <label className="flex items-center gap-2 mb-2 text-sm theme-text-secondary">
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
                              className="theme-input w-full px-3 py-2 text-sm"
                              placeholder="e.g. FAL, AROY, DUN — search by code or name"
                            />
                            {form.brandInput.length >= 1 && (
                              <div className="absolute z-20 w-full mt-1 rounded-lg border shadow-xl max-h-40 overflow-y-auto bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-600">
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
                                      className="w-full text-left px-3 py-2 text-sm transition-colors theme-text-secondary hover:bg-black/5 dark:hover:bg-white/5"
                                    >
                                      <span className="font-mono font-bold">{code}</span>
                                      <span className="ml-2 theme-text-tertiary">{name}</span>
                                    </button>
                                  ))}
                              </div>
                            )}
                          </div>
                          {form.brands.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {form.brands.map((b) => (
                                <span key={b} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-slate-700 theme-text-secondary">
                                  {b}{BRAND_MAP[b] ? ` (${BRAND_MAP[b]})` : ""}
                                  <button onClick={() => handleRemoveBrand(b)} className="hover:text-red-500">&times;</button>
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Commission Type */}
                    <div>
                      <label className="block text-xs font-medium mb-1 ui-section-label">Commission Type</label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, commissionType: "percentage" }))}
                          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                            form.commissionType === "percentage"
                              ? "bg-[#007AFF]/10 text-[#007AFF] border-[#007AFF]/20"
                              : "bg-white dark:bg-slate-900 theme-text-tertiary border-gray-300 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500"
                          }`}
                        >
                          % of Product Cost
                        </button>
                        <button
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, commissionType: "flat" }))}
                          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                            form.commissionType === "flat"
                              ? "bg-[#007AFF]/10 text-[#007AFF] border-[#007AFF]/20"
                              : "bg-white dark:bg-slate-900 theme-text-tertiary border-gray-300 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500"
                          }`}
                        >
                          Flat per Unit
                        </button>
                      </div>
                    </div>

                    {/* Commission Value */}
                    <div>
                      <label className="block text-xs font-medium mb-1 ui-section-label">
                        {form.commissionType === "percentage" ? "Commission % (e.g. 5 for 5%)" : "Amount per Unit ($)"}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.commissionValue}
                        onChange={(e) => setForm((f) => ({ ...f, commissionValue: e.target.value }))}
                        className="theme-input w-full px-3 py-2 text-sm"
                        placeholder={form.commissionType === "percentage" ? "5" : "2.50"}
                      />
                    </div>
                  </div>

                  {/* Form Actions */}
                  <div className="flex gap-3 mt-6">
                    <Button
                      variant="primary"
                      size="md"
                      onClick={handleSave}
                      disabled={saving || !form.customerName || !form.customerNumber || !form.commissionValue}
                    >
                      {saving ? "Saving..." : editingId ? "Update" : "Save"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); }}
                    >
                      Cancel
                    </Button>
                  </div>
                </Card>
              )}

              {/* Customer List */}
              {customers === undefined ? (
                <div className="text-sm theme-text-secondary">Loading...</div>
              ) : customers.length === 0 ? (
                <Card padding="md" className="text-center">
                  <p className="theme-text-secondary">No customer configurations yet. Click &quot;Add Customer&quot; to get started.</p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {customers.map((c: CustomerConfig) => (
                    <div
                      key={c._id}
                      className={`theme-card p-4 ${!c.isActive ? "opacity-60" : ""}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold theme-text-primary">{c.customerName}</h3>
                            <span className="px-2 py-0.5 rounded text-xs font-mono bg-gray-100 dark:bg-slate-700 theme-text-secondary">
                              {c.customerNumber}
                            </span>
                            {!c.isActive && (
                              <span className="ui-badge ui-badge-red">Inactive</span>
                            )}
                          </div>
                          <div className="text-xs space-y-0.5 theme-text-tertiary">
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
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleToggleActive(c as CustomerConfig)}
                              className={c.isActive
                                ? "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 border-0"
                                : "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-500/10 hover:bg-green-100 dark:hover:bg-green-500/20 border-0"
                              }
                            >
                              {c.isActive ? "Deactivate" : "Activate"}
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleEdit(c as CustomerConfig)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => handleDelete(c._id)}
                            >
                              Delete
                            </Button>
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
                <SectionHeader title="Access Overrides" />
                <p className="text-xs mb-4 theme-text-tertiary">
                  Grant access to specific users regardless of their RBAC tier. Users with T4+ access always have access.
                </p>

                <Card padding="md">
                  {/* Search to add user */}
                  <div className="relative mb-4">
                    <input
                      type="text"
                      value={accessSearch}
                      onChange={(e) => { setAccessSearch(e.target.value); setShowAccessDropdown(true); }}
                      onFocus={() => setShowAccessDropdown(true)}
                      className="theme-input w-full px-3 py-2 text-sm"
                      placeholder="Search users to grant access..."
                    />
                    {showAccessDropdown && filteredAccessUsers.length > 0 && (
                      <div className="absolute z-20 w-full mt-1 rounded-lg border shadow-xl max-h-48 overflow-y-auto bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-600">
                        {filteredAccessUsers.slice(0, 10).map((u: ConvexUser) => (
                          <button
                            key={u._id}
                            onClick={() => handleAddAccessUser(u._id)}
                            className="w-full text-left px-3 py-2 text-sm transition-colors theme-text-secondary hover:bg-black/5 dark:hover:bg-white/5"
                          >
                            <span className="font-medium">{u.name}</span>
                            <span className="ml-2 theme-text-tertiary">{u.email}</span>
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
                          className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-slate-900/50"
                        >
                          <div>
                            <span className="text-sm font-medium theme-text-primary">{u.name}</span>
                            <span className="text-xs ml-2 theme-text-tertiary">{u.email}</span>
                          </div>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleRemoveAccessUser(u._id)}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm theme-text-tertiary">No access overrides configured.</p>
                  )}
                </Card>
              </section>
            )}
          </div>
        </main>
      </div>
    </Protected>
  );
}
