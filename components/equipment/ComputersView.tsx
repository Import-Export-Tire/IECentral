"use client";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeader from "@/components/ui/SectionHeader";
import { useEquipment } from "./EquipmentContext";

export default function ComputersView() {
  const {
    computers, handleEditComputer, isSuperuser, user, deleteComputerMutation,
  } = useEquipment();

  return (
    <div className="space-y-6">
      {/* Remote Access Computers */}
      <div>
        <SectionHeader title="Remote Access Computers" />
        {computers?.filter(c => c.remoteAccessEnabled).length === 0 ? (
          <Card><div className="text-center py-8 theme-text-tertiary">No computers with remote access enabled. Add a computer with Chrome Remote Desktop ID.</div></Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {computers?.filter(c => c.remoteAccessEnabled).map((comp) => (
              <div
                key={comp._id}
                className="theme-card p-5"
              >
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <h3 className="font-semibold theme-text-primary">
                      {comp.name}
                    </h3>
                    <p className="text-sm theme-text-secondary">
                      {comp.manufacturer} {comp.model}
                    </p>
                  </div>
                  <span className={`ui-badge ${comp.status === "active" ? "ui-badge-green" : "ui-badge-amber"}`}>
                    {comp.status}
                  </span>
                </div>

                <div className="space-y-2 text-sm theme-text-secondary">
                  {comp.operatingSystem && (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">OS:</span> {comp.operatingSystem}
                    </div>
                  )}
                  {comp.assignedToName && (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Assigned:</span> {comp.assignedToName}
                    </div>
                  )}
                  {comp.department && (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Dept:</span> {comp.department}
                    </div>
                  )}
                  {comp.ipAddress && (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">IP:</span> {comp.ipAddress}
                    </div>
                  )}
                </div>

                {/* Remote Access Button */}
                {comp.chromeRemoteUrl && (
                  <a
                    href={comp.chromeRemoteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors theme-btn-secondary"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    Connect via Chrome Remote
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* All Computers */}
      <div>
        <SectionHeader title={`All Computers (${computers?.length ?? 0})`} />
        {!computers || computers.length === 0 ? (
          <Card><div className="text-center py-8 theme-text-tertiary">No computers found. Add your first computer.</div></Card>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm theme-text-secondary">
              <thead>
                <tr className="border-b theme-border-secondary">
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                  <th className="px-4 py-3 text-left font-medium">Location</th>
                  <th className="px-4 py-3 text-left font-medium">IP Address</th>
                  <th className="px-4 py-3 text-left font-medium">Remote</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {computers.map((comp) => (
                  <tr key={comp._id} className="border-b theme-border-secondary">
                    <td className="px-4 py-3 font-medium theme-text-primary">
                      {comp.name}
                    </td>
                    <td className="px-4 py-3 capitalize">{comp.type}</td>
                    <td className="px-4 py-3">{comp.locationName || "-"}</td>
                    <td className="px-4 py-3">{comp.ipAddress || "-"}</td>
                    <td className="px-4 py-3">
                      {comp.remoteAccessEnabled ? (
                        <span className="ui-badge ui-badge-green">Enabled</span>
                      ) : (
                        <span className="ui-badge ui-badge-gray">Disabled</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`ui-badge ${comp.status === "active" ? "ui-badge-green" : comp.status === "in_repair" ? "ui-badge-amber" : "ui-badge-gray"}`}>
                        {comp.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={() => handleEditComputer(comp)}>
                          Edit
                        </Button>
                        {comp.chromeRemoteUrl && (
                          <a
                            href={comp.chromeRemoteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center px-2 py-1 text-xs rounded theme-btn-secondary"
                          >
                            Connect
                          </a>
                        )}
                        {isSuperuser && (
                          <button
                            onClick={async () => {
                              if (confirm(`Delete ${comp.name}?`)) {
                                if (!user) return;
                                await deleteComputerMutation({ computerId: comp._id, requestingUserId: user._id });
                              }
                            }}
                            className="text-red-400 hover:text-red-300 text-xs"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
