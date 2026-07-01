"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSetupSession } from "../useSetupSession";
import { Id } from "@/convex/_generated/dataModel";

type Session = ReturnType<typeof useSetupSession>;
const STATUSES = ["available", "maintenance", "lost", "retired"];

export function ManageStep({ session }: { session: Session }) {
  const personnel = useQuery(api.personnel.listAll, { status: "active" }) ?? [];
  const { existingScanner, manage } = session.state;

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">Update {existingScanner?.number}</h3>
      <p className="text-xs opacity-70">
        Software will be reinstalled/updated. Number, location and identity stay the same.
      </p>

      <label className="block text-sm">
        <span className="opacity-70">Status</span>
        <select
          value={manage.status}
          onChange={(e) => session.actions.setManage({ status: e.target.value })}
          className="mt-1 w-full rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="opacity-70">Assigned to</span>
        <select
          value={manage.assignedTo ?? ""}
          onChange={(e) =>
            session.actions.setManage({
              assignedTo: e.target.value ? (e.target.value as Id<"personnel">) : null,
            })
          }
          className="mt-1 w-full rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm"
        >
          <option value="">Unassigned</option>
          {personnel.map((p: { _id: Id<"personnel">; firstName: string; lastName: string }) => (
            <option key={p._id} value={p._id}>
              {p.firstName} {p.lastName}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="opacity-70">Condition notes</span>
        <textarea
          value={manage.conditionNotes}
          onChange={(e) => session.actions.setManage({ conditionNotes: e.target.value })}
          rows={3}
          className="mt-1 w-full rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm"
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          onClick={() => session.actions.goToStep("detect")}
          className="text-xs opacity-60 hover:opacity-100"
        >
          ← Back
        </button>
        <button
          onClick={() => session.actions.goToStep("install")}
          className="ml-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold"
        >
          Continue to install →
        </button>
      </div>
    </div>
  );
}
