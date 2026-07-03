"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeader from "@/components/ui/SectionHeader";

function PersonnelRosterContent() {
  const { theme } = useTheme();
  void theme;

  const locations = useQuery(api.locations.list) || [];
  const [locationId, setLocationId] = useState<Id<"locations"> | "">("");
  const [includeTerminated, setIncludeTerminated] = useState(false);
  const [generating, setGenerating] = useState(false);

  const personnel = useQuery(
    api.personnel.listAll,
    locationId ? { locationId: locationId as Id<"locations"> } : "skip"
  );

  const filteredPersonnel = useMemo(() => {
    if (!personnel) return [];
    return personnel.filter((p) => includeTerminated ? true : p.status !== "terminated");
  }, [personnel, includeTerminated]);

  const selectedLocation = useMemo(
    () => locations.find((l) => l._id === locationId),
    [locations, locationId]
  );

  const handleGeneratePDF = async () => {
    if (!selectedLocation || filteredPersonnel.length === 0) return;
    setGenerating(true);
    try {
      const { jsPDF } = await import("jspdf");
      const autoTableModule = await import("jspdf-autotable");
      const autoTable = (autoTableModule.default || autoTableModule) as typeof import("jspdf-autotable").default;

      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      const now = new Date();
      const ranDate = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${String(now.getFullYear()).slice(2)}`;
      const ranTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const title = `${selectedLocation.name} — Personnel Roster`;
      const subtitle = `${filteredPersonnel.length} ${includeTerminated ? "total" : "active"} personnel  ·  Ran: ${ranDate} ${ranTime}`;

      const drawHeaderFooter = () => {
        doc.setFontSize(13); doc.setFont("helvetica", "bold");
        doc.text(title, pageWidth / 2, 40, { align: "center" });
        doc.setFontSize(9); doc.setFont("helvetica", "normal");
        doc.text(subtitle, pageWidth / 2, 56, { align: "center" });
        doc.text(
          "Check each name. Cross out anyone no longer here. Write in anyone who's working but missing.",
          pageWidth / 2,
          70,
          { align: "center" }
        );
        doc.setFontSize(8);
        doc.text(`${selectedLocation.name} — ${ranDate}`, 36, pageHeight - 24);
      };

      const body = filteredPersonnel.map((p) => [
        "",  // ✓ checkbox column — left blank for the printer to tick by hand
        `${p.lastName}, ${p.firstName}`,
        p.position || "",
        p.department || "",
        p.hireDate || "",
        p.phone || "",
        "",  // Notes/Status column — left blank for handwriting
      ]);

      // Append blank rows so HR can write in people who aren't listed
      const blankRows = 8;
      for (let i = 0; i < blankRows; i++) {
        body.push(["", "", "", "", "", "", ""]);
      }

      autoTable(doc, {
        head: [["✓", "Name", "Position", "Department", "Hire Date", "Phone", "Notes"]],
        body,
        startY: 90,
        margin: { top: 90, bottom: 50, left: 36, right: 36 },
        styles: { fontSize: 9, cellPadding: 5, overflow: "linebreak", minCellHeight: 22 },
        headStyles: { fillColor: [37, 99, 154], textColor: 255, fontStyle: "bold", halign: "left" },
        columnStyles: {
          0: { cellWidth: 22, halign: "center" },
          1: { cellWidth: 120, fontStyle: "bold" },
          2: { cellWidth: 110 },
          3: { cellWidth: 75 },
          4: { cellWidth: 60 },
          5: { cellWidth: 80 },
          6: { cellWidth: "auto" },
        },
        didDrawPage: drawHeaderFooter,
      });

      // Add a page footer with the total pages on each page
      const totalPages = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - 36, pageHeight - 24, { align: "right" });
      }

      const fileSlug = selectedLocation.name.replace(/[^A-Za-z0-9]+/g, "_");
      doc.save(`${fileSlug}_personnel_roster_${ranDate.replace(/\//g, "")}.pdf`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        <header className="sticky top-0 z-10 border-b px-4 sm:px-6 py-3 sm:py-4 backdrop-blur-sm bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <Link
              href="/reports"
              className="p-2 rounded-lg transition-colors theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5 flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold theme-text-primary">Personnel Roster</h1>
              <p className="text-xs mt-0.5 theme-text-tertiary">
                Print a checklist of who works at a location — verify and add missing people
              </p>
            </div>
          </div>
        </header>

        <div className="px-4 sm:px-6 py-5 max-w-3xl space-y-4">
          <Card>
            <SectionHeader title="Generate Roster" />
            <div className="space-y-4">
              <div>
                <label className="block ui-section-label mb-1.5">Location</label>
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value as Id<"locations"> | "")}
                  className="theme-input w-full px-3 py-2.5"
                >
                  <option value="">— Pick a location —</option>
                  {locations.map((loc) => (
                    <option key={loc._id} value={loc._id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-2 text-sm theme-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeTerminated}
                  onChange={(e) => setIncludeTerminated(e.target.checked)}
                  className="rounded"
                />
                Include terminated personnel
              </label>

              {locationId && (
                <div className="rounded-lg p-3 text-sm bg-black/5 dark:bg-white/5 theme-text-secondary">
                  {personnel === undefined ? (
                    <span className="theme-text-tertiary">Loading…</span>
                  ) : filteredPersonnel.length === 0 ? (
                    <span>No {includeTerminated ? "" : "active "}personnel at this location.</span>
                  ) : (
                    <span>
                      <strong>{filteredPersonnel.length}</strong> {includeTerminated ? "total" : "active"} personnel will be printed.
                    </span>
                  )}
                </div>
              )}

              <Button
                variant="primary"
                onClick={handleGeneratePDF}
                disabled={!locationId || filteredPersonnel.length === 0 || generating}
                className="w-full py-3"
              >
                {generating ? "Generating PDF…" : "Generate Roster PDF"}
              </Button>

              <p className="text-xs theme-text-tertiary">
                The PDF includes a checkbox column, name, position, department, hire date, phone, and a notes column. Blank rows are added at the bottom so HR can write in anyone who's working but isn't listed yet.
              </p>
            </div>
          </Card>

          {filteredPersonnel.length > 0 && (
            <Card padding="sm">
              <SectionHeader
                label="Preview"
                title={`${filteredPersonnel.length} ${includeTerminated ? "total" : "active"} at ${selectedLocation?.name}`}
              />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b theme-border-secondary">
                      <th className="text-left px-3 py-2 font-semibold theme-text-tertiary">Name</th>
                      <th className="text-left px-3 py-2 font-semibold theme-text-tertiary">Position</th>
                      <th className="text-left px-3 py-2 font-semibold theme-text-tertiary">Department</th>
                      <th className="text-left px-3 py-2 font-semibold theme-text-tertiary">Hire Date</th>
                      <th className="text-left px-3 py-2 font-semibold theme-text-tertiary">Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPersonnel.map((p) => (
                      <tr
                        key={p._id}
                        className="border-t theme-border-secondary"
                      >
                        <td className="px-3 py-2 font-medium theme-text-primary">{p.lastName}, {p.firstName}</td>
                        <td className="px-3 py-2 theme-text-secondary">{p.position}</td>
                        <td className="px-3 py-2 theme-text-secondary">{p.department}</td>
                        <td className="px-3 py-2 theme-text-secondary">{p.hireDate}</td>
                        <td className="px-3 py-2 theme-text-secondary">{p.phone}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

export default function PersonnelRosterPage() {
  return (
    <Protected minTier={5}>
      <PersonnelRosterContent />
    </Protected>
  );
}
