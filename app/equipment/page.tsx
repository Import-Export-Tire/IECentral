"use client";

import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { EquipmentProvider, EquipmentContent } from "@/components/equipment";

export default function EquipmentPage() {
  return (
    <Protected minTier={2}>
      <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <MobileHeader />
          <EquipmentProvider>
            <EquipmentContent />
          </EquipmentProvider>
        </main>
      </div>
    </Protected>
  );
}
