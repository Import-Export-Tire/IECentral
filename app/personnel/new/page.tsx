"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Protected from "../../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "../../auth-context";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";

const EMPLOYEE_TYPES = [
  { value: "full_time", label: "Full Time" },
  { value: "part_time", label: "Part Time" },
  { value: "seasonal", label: "Seasonal" },
  { value: "contractor", label: "Contractor" },
  { value: "temp", label: "Temp (staffing agency)" },
];

const DEPARTMENTS = [
  "Executive",
  "IT",
  "Warehouse",
  "Office",
  "Sales",
  "Ecommerce",
  "Retail",
  "Management",
  "Delivery",
  "Other",
];

function NewEmployeeContent() {
  const router = useRouter();
  const { user, canManagePersonnel } = useAuth();
  const createPersonnel = useMutation(api.personnel.create);
  const locations = useQuery(api.locations.listActive);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    position: "",
    department: "",
    employeeType: "full_time",
    hireDate: new Date().toISOString().split("T")[0],
    hourlyRate: "",
    locationId: "",
    notes: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelationship: "",
    staffingAgency: "",
    tempEligibilityMode: "days",
    tempEligibilityValue: "",
    tempEligibleDateOverride: "",
  });

  // Redirect if user doesn't have permission
  if (!canManagePersonnel) {
    return (
      <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold theme-text-primary">
              Access Denied
            </h1>
            <p className="mt-2 theme-text-tertiary">
              You don&apos;t have permission to add employees.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      // Validate required fields
      if (!formData.firstName.trim()) {
        throw new Error("First name is required");
      }
      if (!formData.lastName.trim()) {
        throw new Error("Last name is required");
      }
      if (!formData.email.trim()) {
        throw new Error("Email is required");
      }
      if (!formData.phone.trim()) {
        throw new Error("Phone is required");
      }
      if (!formData.position.trim()) {
        throw new Error("Position is required");
      }
      if (!formData.department) {
        throw new Error("Department is required");
      }

      // Prepare emergency contact if provided
      const emergencyContact =
        formData.emergencyContactName && formData.emergencyContactPhone
          ? {
              name: formData.emergencyContactName,
              phone: formData.emergencyContactPhone,
              relationship: formData.emergencyContactRelationship || "Not specified",
            }
          : undefined;

      if (!user) { setError("Not signed in"); return; }
      await createPersonnel({
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        position: formData.position.trim(),
        department: formData.department,
        employeeType: formData.employeeType,
        hireDate: formData.hireDate,
        hourlyRate: formData.hourlyRate ? parseFloat(formData.hourlyRate) : undefined,
        locationId: formData.locationId ? formData.locationId as Id<"locations"> : undefined,
        emergencyContact,
        notes: formData.notes.trim() || undefined,
        userId: user._id,
        requestingUserId: user._id,
        ...(formData.employeeType === "temp"
          ? {
              staffingAgency: formData.staffingAgency || undefined,
              tempEligibilityMode: formData.tempEligibilityMode,
              tempEligibilityValue: formData.tempEligibilityValue ? Number(formData.tempEligibilityValue) : undefined,
              tempEligibleDateOverride: formData.tempEligibleDateOverride || undefined,
            }
          : {}),
      });

      router.push("/personnel");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create employee");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        {/* Mobile Header */}
        <MobileHeader />

        {/* Header */}
        <header className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-[var(--theme-border-secondary)] px-4 sm:px-8 py-3 sm:py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="p-2 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-slate-800 theme-text-tertiary"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">
                Add Employee
              </h1>
              <p className="text-xs sm:text-sm mt-1 theme-text-tertiary">
                Create a new personnel record
              </p>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-8 max-w-3xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <Card tone="red" padding="sm">
                <span className="text-sm">{error}</span>
              </Card>
            )}

            {/* Basic Information */}
            <Card padding="md">
              <SectionHeader label="PERSONAL" title="Basic Information" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block ui-section-label mb-1">First Name *</label>
                  <input
                    type="text"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleChange}
                    required
                    className="theme-input w-full px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block ui-section-label mb-1">Last Name *</label>
                  <input
                    type="text"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    required
                    className="theme-input w-full px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block ui-section-label mb-1">Email *</label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    className="theme-input w-full px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block ui-section-label mb-1">Phone *</label>
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    required
                    className="theme-input w-full px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </Card>

            {/* Employment Details */}
            <Card padding="md">
              <SectionHeader label="EMPLOYMENT" title="Employment Details" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block ui-section-label mb-1">Position *</label>
                  <input
                    type="text"
                    name="position"
                    value={formData.position}
                    onChange={handleChange}
                    required
                    placeholder="e.g., Warehouse Associate"
                    className="theme-input w-full px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block ui-section-label mb-1">Department *</label>
                  <select
                    name="department"
                    value={formData.department}
                    onChange={handleChange}
                    required
                    className="theme-input w-full px-3 py-2 text-sm"
                  >
                    <option value="">Select Department</option>
                    {DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block ui-section-label mb-1">Employee Type *</label>
                  <select
                    name="employeeType"
                    value={formData.employeeType}
                    onChange={handleChange}
                    required
                    className="theme-input w-full px-3 py-2 text-sm"
                  >
                    {EMPLOYEE_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block ui-section-label mb-1">
                    {formData.employeeType === "temp" ? "Temp start date *" : "Hire Date *"}
                  </label>
                  <input
                    type="date"
                    name="hireDate"
                    value={formData.hireDate}
                    onChange={handleChange}
                    required
                    className="theme-input w-full px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block ui-section-label mb-1">Hourly Rate</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 theme-text-tertiary text-sm">$</span>
                    <input
                      type="number"
                      name="hourlyRate"
                      value={formData.hourlyRate}
                      onChange={handleChange}
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      className="theme-input w-full pl-7 pr-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block ui-section-label mb-1">Location</label>
                  <select
                    name="locationId"
                    value={formData.locationId}
                    onChange={handleChange}
                    className="theme-input w-full px-3 py-2 text-sm"
                  >
                    <option value="">Select Location</option>
                    {locations?.map((location) => (
                      <option key={location._id} value={location._id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {formData.employeeType === "temp" && (
                <Card tone="amber" padding="sm" className="mt-4">
                  <div className="space-y-4">
                    <div>
                      <label className="block ui-section-label mb-1">Staffing Agency</label>
                      <input
                        type="text"
                        name="staffingAgency"
                        value={formData.staffingAgency}
                        onChange={handleChange}
                        placeholder="e.g. Express Employment"
                        className="theme-input w-full px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block ui-section-label mb-1">Eligible after</label>
                        <input
                          type="number"
                          name="tempEligibilityValue"
                          min={1}
                          value={formData.tempEligibilityValue}
                          onChange={handleChange}
                          placeholder="e.g. 90"
                          className="theme-input w-full px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block ui-section-label mb-1">Basis</label>
                        <select
                          name="tempEligibilityMode"
                          value={formData.tempEligibilityMode}
                          onChange={handleChange}
                          className="theme-input w-full px-3 py-2 text-sm"
                        >
                          <option value="days">Days</option>
                          <option value="hours">Hours (at 40/wk)</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block ui-section-label mb-1">Override eligible date (optional)</label>
                      <input
                        type="date"
                        name="tempEligibleDateOverride"
                        value={formData.tempEligibleDateOverride}
                        onChange={handleChange}
                        className="theme-input w-full px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                </Card>
              )}
            </Card>

            {/* Emergency Contact */}
            <Card padding="md">
              <SectionHeader label="EMERGENCY" title="Emergency Contact (Optional)" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block ui-section-label mb-1">Name</label>
                  <input
                    type="text"
                    name="emergencyContactName"
                    value={formData.emergencyContactName}
                    onChange={handleChange}
                    className="theme-input w-full px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block ui-section-label mb-1">Phone</label>
                  <input
                    type="tel"
                    name="emergencyContactPhone"
                    value={formData.emergencyContactPhone}
                    onChange={handleChange}
                    className="theme-input w-full px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block ui-section-label mb-1">Relationship</label>
                  <input
                    type="text"
                    name="emergencyContactRelationship"
                    value={formData.emergencyContactRelationship}
                    onChange={handleChange}
                    placeholder="e.g., Spouse, Parent"
                    className="theme-input w-full px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </Card>

            {/* Notes */}
            <Card padding="md">
              <SectionHeader label="NOTES" title="Notes (Optional)" />
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                rows={4}
                placeholder="Any additional notes about this employee..."
                className="theme-input w-full px-3 py-2 text-sm"
              />
            </Card>

            {/* Submit Button */}
            <div className="flex justify-end gap-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Creating..." : "Create Employee"}
              </Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

export default function NewEmployeePage() {
  return (
    <Protected>
      <NewEmployeeContent />
    </Protected>
  );
}
