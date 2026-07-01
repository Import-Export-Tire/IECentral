"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSetupSession } from "../useSetupSession";
import { Id } from "@/convex/_generated/dataModel";
import Button from "@/components/ui/Button";

type Session = ReturnType<typeof useSetupSession>;
const STATUSES = ["available", "maintenance", "lost", "retired"];

export function ManageStep({ session }: { session: Session }) {
  const personnel = useQuery(api.personnel.listAll, { status: "active" }) ?? [];
  const { existingScanner, manage } = session.state;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[15px] font-semibold theme-text-primary">Update {existingScanner?.number}</h3>
        <p className="text-xs theme-text-tertiary mt-0.5">
          Software will be reinstalled/updated. Number, location and identity stay the same.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium theme-text-tertiary mb-1">Status</label>
        <select
          value={manage.status}
          onChange={(e) => session.actions.setManage({ status: e.target.value })}
          className="theme-input w-full px-3 py-2 text-sm"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium theme-text-tertiary mb-1">Assigned to</label>
        <select
          value={manage.assignedTo ?? ""}
          onChange={(e) =>
            session.actions.setManage({
              assignedTo: e.target.value ? (e.target.value as Id<"personnel">) : null,
            })
          }
          className="theme-input w-full px-3 py-2 text-sm"
        >
          <option value="">Unassigned</option>
          {personnel.map((p: { _id: Id<"personnel">; firstName: string; lastName: string }) => (
            <option key={p._id} value={p._id}>
              {p.firstName} {p.lastName}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium theme-text-tertiary mb-1">Condition notes</label>
        <textarea
          value={manage.conditionNotes}
          onChange={(e) => session.actions.setManage({ conditionNotes: e.target.value })}
          rows={3}
          className="theme-input w-full px-3 py-2 text-sm"
          placeholder="Any notes about device condition…"
        />
      </div>

      <div className="flex items-center justify-between pt-1">
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
        <Button
          variant="primary"
          onClick={() => session.actions.goToStep("install")}
        >
          Continue to install
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Button>
      </div>
    </div>
  );
}
