"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import Protected from "../../protected";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useTheme } from "../../theme-context";
import { useAuth } from "../../auth-context";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function PaystubsContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const router = useRouter();
  const { user, canAccessEmployeePortal } = useAuth();
  const personnelId = user?.personnelId;

  const paystubs = useQuery(
    api.employeePortal.getMyPayStubs,
    personnelId ? { personnelId } : "skip"
  );

  const markViewed = useMutation(api.employeePortal.markPayStubViewed);

  if (!canAccessEmployeePortal) {
    router.push("/");
    return null;
  }

  if (!personnelId) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? "bg-slate-900" : "bg-gray-50"}`}>
        <p className={isDark ? "text-slate-400" : "text-gray-500"}>Account not linked to personnel record.</p>
      </div>
    );
  }

  const handleViewPaystub = async (paystubId: string) => {
    await markViewed({ payStubId: paystubId as any });
    // In a full implementation, this would open a PDF or detailed view
  };

  return (
    <div className={`min-h-screen ${isDark ? "bg-slate-900" : "bg-gray-50"}`}>
      {/* Header */}
      <header className={`sticky top-0 z-10 border-b px-4 py-4 ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
        <div className="max-w-lg mx-auto flex items-center gap-4">
          <Link
            href="/portal"
            className={`p-2 -ml-2 rounded-lg ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"}`}
          >
            <svg className={`w-6 h-6 ${isDark ? "text-white" : "text-gray-900"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
              Paystubs
            </h1>
            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              View your pay history
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {paystubs && paystubs.length > 0 ? (
          paystubs.map((stub) => (
            <div
              key={stub._id}
              onClick={() => handleViewPaystub(stub._id)}
              className={`rounded-xl p-4 cursor-pointer transition-colors ${isDark ? "bg-slate-800 border border-slate-700 hover:bg-slate-700" : "bg-white border border-gray-200 hover:bg-gray-50"}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                    Pay Date: {new Date(stub.payDate + "T00:00:00").toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                  <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    Period: {new Date(stub.payPeriodStart + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} -{" "}
                    {new Date(stub.payPeriodEnd + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </p>
                </div>
                {!stub.employeeViewedAt && (
                  <span className={`text-xs px-2 py-1 rounded-full ${isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-blue-100 text-blue-600"}`}>
                    New
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div>
                  <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Hours</p>
                  <p className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                    {stub.totalHours}
                  </p>
                </div>
                <div>
                  <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Gross</p>
                  <p className={`font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                    {formatCurrency(stub.grossPay)}
                  </p>
                </div>
                <div>
                  <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Net</p>
                  <p className={`font-semibold ${isDark ? "text-green-400" : "text-green-600"}`}>
                    {formatCurrency(stub.netPay)}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end mt-3">
                <svg className={`w-5 h-5 ${isDark ? "text-slate-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          ))
        ) : (
          <div className={`rounded-xl p-8 text-center ${isDark ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200"}`}>
            <svg className={`w-16 h-16 mx-auto mb-4 ${isDark ? "text-slate-600" : "text-gray-300"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className={`font-medium mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>
              No Paystubs Available
            </p>
            <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              Your paystubs will appear here once available.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default function PaystubsPage() {
  return (
    <Protected>
      <PaystubsContent />
    </Protected>
  );
}
