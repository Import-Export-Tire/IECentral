"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSetupSession } from "../useSetupSession";
import Button from "@/components/ui/Button";

type Session = ReturnType<typeof useSetupSession>;

export function LocationStep({ session }: { session: Session }) {
  const configs = useQuery(api.scannerMdm.listMdmConfigs);
  const retail = useQuery(api.locations.listByType, { type: "retail" }) ?? [];

  const handlePick = (code: string, name: string) => {
    session.actions.setLocation(code, name);
    session.actions.goToStep("identity");
  };

  if (!configs) {
    return (
      <div className="flex items-center gap-2 text-sm theme-text-tertiary py-4">
        <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
        Loading locations…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-[15px] font-semibold theme-text-primary">Where is this scanner going?</h3>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {configs.map((c) => (
          <button
            key={c._id}
            onClick={() => handlePick(c.locationCode, c.locationName ?? c.locationCode)}
            className="px-4 py-3 rounded-xl theme-card hover:ring-2 hover:ring-[var(--accent-primary)] transition-all text-left"
          >
            <div className="text-sm font-semibold theme-text-primary">{c.locationName ?? c.locationCode}</div>
            <div className="text-xs theme-text-tertiary mt-0.5">{c.locationCode}</div>
          </button>
        ))}
        {/* Retail locations — coming soon, not yet selectable */}
        {retail.map((l) => (
          <div
            key={l._id}
            className="relative px-4 py-3 rounded-xl theme-card opacity-50 cursor-not-allowed text-left"
            title="Retail scanning program coming soon"
          >
            <div className="text-sm font-semibold theme-text-primary">{l.name}</div>
            <div className="text-xs theme-text-tertiary mt-0.5">Retail</div>
            <span className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0.5 rounded ui-callout-amber">
              Coming soon
            </span>
          </div>
        ))}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => session.actions.goToStep("detect")}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </Button>
    </div>
  );
}
