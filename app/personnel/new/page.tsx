"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Protected from "../../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useTheme } from "../../theme-context";
import { useAuth } from "../../auth-context";

const EMPLOYEE_TYPES = [
  { value: "full_time", label: "Full Time" },
  { value: "part_time", label: "Part Time" },
  { value: "seasonal", label: "Seasonal" },
  { value: "contractor", label: "Contractor" },
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
  const { theme } = useTheme();
  const isDark = theme === "dark";
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
  });

  // Redirect if user doesn't have permission
  if (!canManagePersonnel) {
    return (
      <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h1 className={`text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
              Access Denied
            </h1>
            <p className={`mt-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
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
      });

      router.push("/personnel");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create employee");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        {/* Mobile Header */}
        <MobileHeader />

        {/* Header */}
        <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className={`text-xl sm:text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                Add Employee
              </h1>
              <p className={`text-xs sm:text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Create a new personnel record
              </p>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-8 max-w-3xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="p-4 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400">
                {error}
              </div>
            )}

            {/* Basic Information */}
            <div className={`rounded-xl p-6 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
              <h2 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                Basic Information
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    First Name *
                  </label>
                  <input
                    type="text"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleChange}
                    required
                    className={`w-full px-3 py-2 rounded-lg focus:outline-none ${isDark ? "bg-slate-700/50 border border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border border-gray-200 text-gray-900 focus:border-blue-600"}`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Last Name *
                  </label>
                  <input
                    type="text"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    required
                    className={`w-full px-3 py-2 rounded-lg focus:outline-none ${isDark ? "bg-slate-700/50 border border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border border-gray-200 text-gray-900 focus:border-blue-600"}`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Email *
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    className={`w-full px-3 py-2 rounded-lg focus:outline-none ${isDark ? "bg-slate-700/50 border border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border border-gray-200 text-gray-900 focus:border-blue-600"}`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Phone *
                  </label>
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    required
                    className={`w-full px-3 py-2 rounded-lg focus:outline-none ${isDark ? "bg-slate-700/50 border border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border border-gray-200 text-gray-900 focus:border-blue-600"}`}
                  />
                </div>
              </div>
            </div>

            {/* Employment Details */}
            <div className={`rounded-xl p-6 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
              <h2 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                Employment Details
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Position *
                  </label>
                  <input
                    type="text"
                    name="position"
                    value={formData.position}
                    onChange={handleChange}
                    required
                    placeholder="e.g., Warehouse Associate"
                    className={`w-full px-3 py-2 rounded-lg focus:outline-none ${isDark ? "bg-slate-700/50 border border-slate-600 text-white placeholder-slate-500 focus:border-cyan-500" : "bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:border-blue-600"}`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Department *
                  </label>
                  <select
                    name="department"
                    value={formData.department}
                    onChange={handleChange}
                    required
                    className={`w-full px-3 py-2 rounded-lg focus:outline-none ${isDark ? "bg-slate-700/50 border border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border border-gray-200 text-gray-900 focus:border-blue-600"}`}
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
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Employee Type *
                  </label>
                  <select
                    name="employeeType"
                    value={formData.employeeType}
                    onChange={handleChange}
                    required
                    className={`w-full px-3 py-2 rounded-lg focus:outline-none ${isDark ? "bg-slate-700/50 border border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border border-gray-200 text-gray-900 focus:border-blue-600"}`}
                  >
                    {EMPLOYEE_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Hire Date *
                  </label>
                  <input
                    type="date"
                    name="hireDate"
                    value={formData.hireDate}
                    onChange={handleChange}
                    required
                    className={`w-full px-3 py-2 rounded-lg focus:outline-none ${isDark ? "bg-slate-700/50 border border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border border-gray-200 text-gray-900 focus:border-blue-600"}`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Hourly Rate
                  </label>
                  <div className="relative">
                    <span className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>$</span>
                    <input
                      type="number"
                      name="hourlyRate"
                      value={formData.hourlyRate}
                      onChange={handleChange}
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      className={`w-full pl-7 pr-3 py-2 rounded-lg focus:outline-none ${isDark ? "bg-slate-700/50 border border-slate-600 text-white placeholder-slate-500 focus:border-cyan-500" : "bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:border-blue-600"}`}
                    />
                  </div>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Location
                  </label>
                  <select
                    name="locationId"
                    value={formData.locationId}
                    onChange={handleChange}
                    className={`w-full px-3 py-2 rounded-lg focus:outline-none ${isDark ? "bg-slate-700/50 border border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border border-gray-200 text-gray-900 focus:border-blue-600"}`}
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
            </div>

            {/* Emergency Contact */}
            <div className={`rounded-xl p-6 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
              <h2 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                Emergency Contact (Optional)
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Name
                  </label>
                  <input
                    type="text"
                    name="emergencyContactName"
                    value={formData.emergencyContactName}
                    onChange={handleChange}
                    className={`w-full px-3 py-2 rounded-lg focus:outline-none ${isDark ? "bg-slate-700/50 border border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border border-gray-200 text-gray-900 focus:border-blue-600"}`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Phone
                  </label>
                  <input
                    type="tel"
                    name="emergencyContactPhone"
                    value={formData.emergencyContactPhone}
                    onChange={handleChange}
                    className={`w-full px-3 py-2 rounded-lg focus:outline-none ${isDark ? "bg-slate-700/50 border border-slate-600 text-white focus:border-cyan-500" : "bg-gray-50 border border-gray-200 text-gray-900 focus:border-blue-600"}`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    Relationship
                  </label>
                  <input
                    type="text"
                    name="emergencyContactRelationship"
                    value={formData.emergencyContactRelationship}
                    onChange={handleChange}
                    placeholder="e.g., Spouse, Parent"
                    className={`w-full px-3 py-2 rounded-lg focus:outline-none ${isDark ? "bg-slate-700/50 border border-slate-600 text-white placeholder-slate-500 focus:border-cyan-500" : "bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:border-blue-600"}`}
                  />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className={`rounded-xl p-6 ${isDark ? "bg-slate-800/50 border border-slate-700" : "bg-white border border-gray-200 shadow-sm"}`}>
              <h2 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                Notes (Optional)
              </h2>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                rows={4}
                placeholder="Any additional notes about this employee..."
                className={`w-full px-3 py-2 rounded-lg focus:outline-none ${isDark ? "bg-slate-700/50 border border-slate-600 text-white placeholder-slate-500 focus:border-cyan-500" : "bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:border-blue-600"}`}
              />
            </div>

            {/* Submit Button */}
            <div className="flex justify-end gap-4">
              <button
                type="button"
                onClick={() => router.back()}
                className={`px-6 py-2 rounded-lg font-medium transition-colors ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-200 hover:bg-gray-300 text-gray-700"}`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                  isDark
                    ? "bg-cyan-500 hover:bg-cyan-400 text-white disabled:bg-cyan-500/50"
                    : "bg-blue-600 hover:bg-blue-700 text-white disabled:bg-blue-600/50"
                }`}
              >
                {isSubmitting ? "Creating..." : "Create Employee"}
              </button>
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
