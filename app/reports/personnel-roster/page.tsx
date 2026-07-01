"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "@/app/theme-context";
import Link from "next/link";

function PersonnelRosterContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

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
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <div className="flex items-center gap-3">
            <Link
              href="/reports"
              className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className={`text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                Personnel Roster
              </h1>
              <p className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Print a checklist of who works at a location — verify and add missing people
              </p>
            </div>
          </div>
        </header>

        <div className="p-4 sm:p-8 max-w-3xl">
          <div className={`rounded-2xl border p-6 ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
            <div className="space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-1.5 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                  Location
                </label>
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value as Id<"locations"> | "")}
                  className={`w-full px-3 py-2.5 rounded-lg border ${isDark ? "bg-slate-900 border-slate-600 text-white" : "bg-white border-gray-300 text-gray-900"}`}
                >
                  <option value="">— Pick a location —</option>
                  {locations.map((loc) => (
                    <option key={loc._id} value={loc._id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              <label className={`flex items-center gap-2 text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                <input
                  type="checkbox"
                  checked={includeTerminated}
                  onChange={(e) => setIncludeTerminated(e.target.checked)}
                  className="rounded"
                />
                Include terminated personnel
              </label>

              {locationId && (
                <div className={`rounded-lg p-3 text-sm ${isDark ? "bg-slate-900/60 text-slate-300" : "bg-gray-50 text-gray-700"}`}>
                  {personnel === undefined ? (
                    <span className={isDark ? "text-slate-500" : "text-gray-500"}>Loading…</span>
                  ) : filteredPersonnel.length === 0 ? (
                    <span>No {includeTerminated ? "" : "active "}personnel at this location.</span>
                  ) : (
                    <span>
                      <strong>{filteredPersonnel.length}</strong> {includeTerminated ? "total" : "active"} personnel will be printed.
                    </span>
                  )}
                </div>
              )}

              <button
                onClick={handleGeneratePDF}
                disabled={!locationId || filteredPersonnel.length === 0 || generating}
                className="w-full px-4 py-3 rounded-xl font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: "#007AFF" }}
              >
                {generating ? "Generating PDF…" : "Generate Roster PDF"}
              </button>

              <p className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                The PDF includes a checkbox column, name, position, department, hire date, phone, and a notes column. Blank rows are added at the bottom so HR can write in anyone who's working but isn't listed yet.
              </p>
            </div>
          </div>

          {filteredPersonnel.length > 0 && (
            <div className={`mt-6 rounded-2xl border overflow-hidden ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className={`px-4 py-3 border-b text-sm font-semibold ${isDark ? "border-slate-700 text-white" : "border-gray-200 text-gray-900"}`}>
                Preview — {filteredPersonnel.length} {includeTerminated ? "total" : "active"} at {selectedLocation?.name}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={isDark ? "bg-slate-900/60" : "bg-gray-50"}>
                    <tr className={isDark ? "text-slate-400" : "text-gray-600"}>
                      <th className="text-left px-4 py-2 font-medium">Name</th>
                      <th className="text-left px-4 py-2 font-medium">Position</th>
                      <th className="text-left px-4 py-2 font-medium">Department</th>
                      <th className="text-left px-4 py-2 font-medium">Hire Date</th>
                      <th className="text-left px-4 py-2 font-medium">Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPersonnel.map((p) => (
                      <tr
                        key={p._id}
                        className={`border-t ${isDark ? "border-slate-700/40 text-white" : "border-gray-100 text-gray-900"}`}
                      >
                        <td className="px-4 py-2 font-medium">{p.lastName}, {p.firstName}</td>
                        <td className="px-4 py-2">{p.position}</td>
                        <td className="px-4 py-2">{p.department}</td>
                        <td className="px-4 py-2">{p.hireDate}</td>
                        <td className="px-4 py-2">{p.phone}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
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
