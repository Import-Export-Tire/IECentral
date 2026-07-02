"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import Protected from "../../protected";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "../../auth-context";
import Card from "@/components/ui/Card";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function PaystubsContent() {
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
      <div className="min-h-screen flex items-center justify-center bg-[#f2f2f7] dark:bg-slate-900">
        <p className="theme-text-tertiary">Account not linked to personnel record.</p>
      </div>
    );
  }

  const handleViewPaystub = async (paystubId: string) => {
    await markViewed({ payStubId: paystubId as any });
    // In a full implementation, this would open a PDF or detailed view
  };

  return (
    <div className="min-h-screen bg-[#f2f2f7] dark:bg-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur-sm border-b px-4 py-4 bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
        <div className="max-w-lg mx-auto flex items-center gap-4">
          <Link
            href="/portal"
            className="p-2 -ml-2 rounded-lg theme-text-primary hover:bg-gray-100 dark:hover:bg-slate-700"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-bold theme-text-primary">Paystubs</h1>
            <p className="text-sm theme-text-tertiary">View your pay history</p>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {paystubs && paystubs.length > 0 ? (
          paystubs.map((stub) => (
            <Card
              key={stub._id}
              padding="sm"
              className="cursor-pointer hover:opacity-90 transition-opacity"
            >
              <div
                onClick={() => handleViewPaystub(stub._id)}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-medium theme-text-primary">
                      Pay Date: {new Date(stub.payDate + "T00:00:00").toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                    <p className="text-sm theme-text-tertiary">
                      Period: {new Date(stub.payPeriodStart + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} -{" "}
                      {new Date(stub.payPeriodEnd + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                  </div>
                  {!stub.employeeViewedAt && (
                    <span className="ui-badge ui-badge-blue text-xs">New</span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div>
                    <p className="text-xs theme-text-tertiary">Hours</p>
                    <p className="font-semibold theme-text-primary">{stub.totalHours}</p>
                  </div>
                  <div>
                    <p className="text-xs theme-text-tertiary">Gross</p>
                    <p className="font-semibold theme-text-primary">{formatCurrency(stub.grossPay)}</p>
                  </div>
                  <div>
                    <p className="text-xs theme-text-tertiary">Net</p>
                    <p className="font-semibold text-green-600 dark:text-green-400">{formatCurrency(stub.netPay)}</p>
                  </div>
                </div>

                <div className="flex items-center justify-end mt-3">
                  <svg className="w-5 h-5 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Card>
          ))
        ) : (
          <Card padding="md" className="text-center py-8">
            <svg className="w-16 h-16 mx-auto mb-4 theme-text-tertiary opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="font-medium theme-text-primary mb-1">No Paystubs Available</p>
            <p className="text-sm theme-text-tertiary">Your paystubs will appear here once available.</p>
          </Card>
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
