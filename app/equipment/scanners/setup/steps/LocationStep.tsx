"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSetupSession } from "../useSetupSession";

type Session = ReturnType<typeof useSetupSession>;

export function LocationStep({ session }: { session: Session }) {
  const configs = useQuery(api.scannerMdm.listMdmConfigs);
  const retail = useQuery(api.locations.listByType, { type: "retail" }) ?? [];

  const handlePick = (code: string, name: string) => {
    session.actions.setLocation(code, name);
    session.actions.goToStep("identity");
  };

  if (!configs) return <p className="text-sm opacity-70">Loading locations…</p>;

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">Where is this scanner going?</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {configs.map((c) => (
          <button
            key={c._id}
            onClick={() => handlePick(c.locationCode, c.locationName ?? c.locationCode)}
            className="px-4 py-3 rounded-lg border border-current/20 hover:bg-blue-500/10 hover:border-blue-500 transition-colors text-left"
          >
            <div className="font-semibold">{c.locationName ?? c.locationCode}</div>
            <div className="text-xs opacity-70 mt-0.5">{c.locationCode}</div>
          </button>
        ))}
        {/* Retail locations — coming soon, not yet selectable */}
        {retail.map((l) => (
          <div
            key={l._id}
            className="relative px-4 py-3 rounded-lg border border-current/10 opacity-50 cursor-not-allowed text-left"
            title="Retail scanning program coming soon"
          >
            <div className="font-semibold">{l.name}</div>
            <div className="text-xs opacity-70 mt-0.5">Retail</div>
            <span className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600">
              Coming soon
            </span>
          </div>
        ))}
      </div>
      <button
        onClick={() => session.actions.goToStep("detect")}
        className="text-xs opacity-60 hover:opacity-100"
      >
        ← Back
      </button>
    </div>
  );
}
