"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";
import Button from "@/components/ui/Button";

// Generate unique ID for tasks
function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

interface DepartmentShift {
  _id: Id<"shifts">;
  department: string;
  assignedPersonnel: Id<"personnel">[];
  assignedNames: string[];
  leadId?: Id<"personnel">;
  leadName?: string;
}

function ShiftsContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user, canViewShifts, canEditShifts, canViewAllShifts, getAccessibleLocationIds } = useAuth();

  const [selectedDate, setSelectedDate] = useState(() => formatDate(new Date()));
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState<DepartmentShift | null>(null);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [isPrintMode, setIsPrintMode] = useState(false);
  const [printDepartment, setPrintDepartment] = useState<string | null>(null); // null = all departments
  const [draggedPerson, setDraggedPerson] = useState<{ personnelId: Id<"personnel">; name: string; fromDepartment: string; isLead?: boolean } | null>(null);

  // Template states
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateDescription, setNewTemplateDescription] = useState("");
  const [showPrintDropdown, setShowPrintDropdown] = useState(false);

  // Daily task states
  const [newTaskTexts, setNewTaskTexts] = useState<Record<string, string>>({});

  // Location state
  const [selectedLocationId, setSelectedLocationId] = useState<Id<"locations"> | null>(null);

  // Refs for click outside
  const templateDropdownRef = useRef<HTMLDivElement>(null);
  const printDropdownRef = useRef<HTMLDivElement>(null);

  // Default departments
  const DEFAULT_DEPARTMENTS = [
    "Shipping",
    "Receiving",
    "Inventory",
    "Purchases",
    "Janitorial",
    "Ecommerce",
    "Retail",
  ];

  // Parse selected date
  const currentDate = useMemo(() => new Date(selectedDate + "T12:00:00"), [selectedDate]);
  const isToday = formatDate(new Date()) === selectedDate;

  // Queries - filter shifts by selected location
  const shifts = useQuery(
    api.shifts.listByDate,
    selectedLocationId
      ? { date: selectedDate, locationId: selectedLocationId }
      : { date: selectedDate }
  ) || [];
  // Get accessible location IDs for the query
  const accessibleLocationIds = getAccessibleLocationIds();

  // Query personnel filtered by location on the server
  const activePersonnel = useQuery(
    api.personnel.listAll,
    accessibleLocationIds === "all"
      ? { status: "active" }
      : { status: "active", locationIds: accessibleLocationIds }
  ) || [];
  const locations = useQuery(api.locations.list) || [];
  const templates = useQuery(api.shiftTemplates.list, selectedLocationId ? { locationId: selectedLocationId } : {}) || [];
  const dailyTasks = useQuery(api.shifts.getDailyTasksByDate, { date: selectedDate }) || {};

  // Get the selected location's warehouse manager info
  const selectedLocation = useMemo(() => {
    if (!selectedLocationId) return null;
    return locations.find(l => l._id === selectedLocationId) || null;
  }, [locations, selectedLocationId]);

  // Filter locations based on user role
  const accessibleLocations = useMemo(() => {
    const accessible = getAccessibleLocationIds();
    if (accessible === "all") return locations;
    return locations.filter(l => accessible.includes(l._id));
  }, [locations, getAccessibleLocationIds]);

  // Get all personnel not yet assigned to any shift today (includes leads)
  // Filter by selected location and sort by location
  const unassignedPersonnel = useMemo(() => {
    const assignedIds = new Set<string>();
    shifts.forEach(shift => {
      // Add all assigned personnel
      shift.assignedPersonnel.forEach(id => assignedIds.add(id));
      // Also add the lead if there is one
      if (shift.leadId) {
        assignedIds.add(shift.leadId);
      }
    });

    // Filter by assigned status
    let filtered = activePersonnel.filter(p => !assignedIds.has(p._id));

    // Filter by selected location if one is selected
    if (selectedLocationId) {
      filtered = filtered.filter(p => p.locationId === selectedLocationId);
    }

    // Sort by location name, then by last name
    return filtered.sort((a, b) => {
      // Get location names for sorting
      const aLocation = locations.find(l => l._id === a.locationId)?.name || "No Location";
      const bLocation = locations.find(l => l._id === b.locationId)?.name || "No Location";

      // First sort by location
      const locationCompare = aLocation.localeCompare(bLocation);
      if (locationCompare !== 0) return locationCompare;

      // Then sort by last name within same location
      return a.lastName.localeCompare(b.lastName);
    });
  }, [shifts, activePersonnel, selectedLocationId, locations]);

  // Mutations
  const createShift = useMutation(api.shifts.create);
  const removeShift = useMutation(api.shifts.remove);
  const assignPersonnel = useMutation(api.shifts.assignPersonnel);
  const unassignPersonnel = useMutation(api.shifts.unassignPersonnel);
  const copyFromDate = useMutation(api.shifts.copyFromDate);
  const setLead = useMutation(api.shifts.setLead);
  const removeLead = useMutation(api.shifts.removeLead);

  // Template mutations
  const saveTemplate = useMutation(api.shiftTemplates.saveFromDate);
  const applyTemplate = useMutation(api.shiftTemplates.applyToDate);
  const deleteTemplate = useMutation(api.shiftTemplates.remove);

  // Daily task mutations
  const addDailyTask = useMutation(api.shifts.addDailyTask);
  const removeDailyTask = useMutation(api.shifts.removeDailyTask);
  const toggleDailyTask = useMutation(api.shifts.toggleDailyTaskComplete);

  // Navigate dates
  const goToPreviousDay = () => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() - 1);
    setSelectedDate(formatDate(newDate));
  };

  const goToNextDay = () => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + 1);
    setSelectedDate(formatDate(newDate));
  };

  const goToToday = () => {
    setSelectedDate(formatDate(new Date()));
  };

  // Template handlers
  const handleSaveAsTemplate = async () => {
    if (!user || !newTemplateName.trim()) return;
    try {
      await saveTemplate({
        name: newTemplateName.trim(),
        description: newTemplateDescription.trim() || undefined,
        date: selectedDate,
        locationId: selectedLocationId || undefined,
        userId: user._id as Id<"users">,
      });
      setShowSaveTemplateModal(false);
      setNewTemplateName("");
      setNewTemplateDescription("");
    } catch (error) {
      console.error("Failed to save template:", error);
      alert("Failed to save template. Make sure there are shifts for today.");
    }
  };

  const handleApplyTemplate = async (templateId: Id<"shiftTemplates">) => {
    if (!user) return;
    const clearExisting = shifts.length > 0 ? confirm("Replace existing shifts for this day?") : true;
    if (!clearExisting && shifts.length > 0) return;

    try {
      await applyTemplate({
        templateId,
        targetDate: selectedDate,
        userId: user._id as Id<"users">,
        clearExisting: true,
      });
      setShowTemplateDropdown(false);
    } catch (error) {
      console.error("Failed to apply template:", error);
      alert("Failed to apply template");
    }
  };

  const handleDeleteTemplate = async (templateId: Id<"shiftTemplates">) => {
    if (!confirm("Delete this template?")) return;
    try {
      await deleteTemplate({ templateId });
    } catch (error) {
      console.error("Failed to delete template:", error);
    }
  };

  // Daily task handlers
  const handleAddTask = async (department: string) => {
    if (!user) return;
    const text = newTaskTexts[department]?.trim();
    if (!text) return;

    try {
      await addDailyTask({
        date: selectedDate,
        department,
        taskText: text,
        locationId: selectedLocationId || undefined,
        userId: user._id as Id<"users">,
      });
      setNewTaskTexts(prev => ({ ...prev, [department]: "" }));
    } catch (error) {
      console.error("Failed to add task:", error);
    }
  };

  const handleRemoveTask = async (department: string, taskId: string) => {
    try {
      if (!user) return;
      await removeDailyTask({
        date: selectedDate,
        department,
        taskId,
        requestingUserId: user._id,
      });
    } catch (error) {
      console.error("Failed to remove task:", error);
    }
  };

  const handleToggleTask = async (department: string, taskId: string) => {
    try {
      await toggleDailyTask({
        date: selectedDate,
        department,
        taskId,
      });
    } catch (error) {
      console.error("Failed to toggle task:", error);
    }
  };

  // Print handler for specific department
  const handlePrintDepartment = (department: string | null) => {
    setPrintDepartment(department);
    setIsPrintMode(true);
    setShowPrintDropdown(false);
    setTimeout(() => {
      window.print();
      setIsPrintMode(false);
      setPrintDepartment(null);
    }, 100);
  };

  // Handlers
  const handleCreateDepartment = async () => {
    if (!user || !newDepartmentName.trim()) return;
    await createShift({
      date: selectedDate,
      name: newDepartmentName.trim(),
      startTime: "00:00",
      endTime: "23:59",
      position: "Staff",
      department: newDepartmentName.trim(),
      locationId: selectedLocationId || undefined,
      requiredCount: 99,
      assignedPersonnel: [],
      createdBy: user._id as Id<"users">,
    });
    setShowCreateModal(false);
    setNewDepartmentName("");
  };

  const handleDeleteDepartment = async (shiftId: Id<"shifts">) => {
    if (confirm("Are you sure you want to delete this department for today?")) {
      if (!user) return;
      await removeShift({ shiftId, requestingUserId: user._id as Id<"users"> });
    }
  };

  const handleAssignPersonnel = async (personnelId: Id<"personnel">) => {
    if (!selectedDepartment) return;
    if (!user) return;
    await assignPersonnel({
      shiftId: selectedDepartment._id,
      personnelId,
      requestingUserId: user._id as Id<"users">,
    });
  };

  const handleUnassignPersonnel = async (shiftId: Id<"shifts">, personnelId: Id<"personnel">) => {
    if (!user) return;
    await unassignPersonnel({
      shiftId,
      personnelId,
      requestingUserId: user._id as Id<"users">,
    });
  };

  const handleCopyFromYesterday = async () => {
    if (!user) return;
    const yesterday = new Date(currentDate);
    yesterday.setDate(yesterday.getDate() - 1);

    await copyFromDate({
      sourceDate: formatDate(yesterday),
      targetDate: selectedDate,
      createdBy: user._id as Id<"users">,
    });
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, personnelId: Id<"personnel">, name: string, fromDepartment: string, isLead?: boolean) => {
    e.dataTransfer.setData("text/plain", personnelId);
    e.dataTransfer.effectAllowed = "move";
    setDraggedPerson({ personnelId, name, fromDepartment, isLead });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragEnd = () => {
    setDraggedPerson(null);
  };

  const handleDrop = async (targetShift: DepartmentShift) => {
    if (!draggedPerson) return;

    if (!user) return;
    // If coming from another department, unassign first
    if (draggedPerson.fromDepartment !== "unassigned") {
      const sourceShift = shifts.find(s => s.department === draggedPerson.fromDepartment);
      if (sourceShift) {
        await unassignPersonnel({
          shiftId: sourceShift._id,
          personnelId: draggedPerson.personnelId,
          requestingUserId: user._id as Id<"users">,
        });
      }
    }

    // Assign to target department
    await assignPersonnel({
      shiftId: targetShift._id,
      personnelId: draggedPerson.personnelId,
      requestingUserId: user._id as Id<"users">,
    });

    setDraggedPerson(null);
  };

  // Drop on lead zone
  const handleDropLead = async (e: React.DragEvent, targetShift: DepartmentShift) => {
    e.preventDefault();
    e.stopPropagation();

    // Get personnel ID from dataTransfer as fallback
    const personnelIdFromTransfer = e.dataTransfer.getData("text/plain");
    const person = draggedPerson || (personnelIdFromTransfer ? {
      personnelId: personnelIdFromTransfer as Id<"personnel">,
      name: "",
      fromDepartment: "unassigned",
      isLead: false
    } : null);

    if (!person) return;
    if (!user) return;
    const uid = user._id as Id<"users">;

    // If dragging from lead position to this lead position
    if (person.isLead && person.fromDepartment !== "unassigned") {
      const sourceShift = shifts.find(s => s.department === person.fromDepartment);
      if (sourceShift) {
        await removeLead({ shiftId: sourceShift._id, requestingUserId: uid });
      }
    }

    // If coming from unassigned, need to assign them first
    if (person.fromDepartment === "unassigned") {
      await assignPersonnel({
        shiftId: targetShift._id,
        personnelId: person.personnelId,
        requestingUserId: uid,
      });
    } else if (person.fromDepartment !== targetShift.department && !person.isLead) {
      // Moving from another department's staff to lead position
      const sourceShift = shifts.find(s => s.department === person.fromDepartment);
      if (sourceShift) {
        await unassignPersonnel({
          shiftId: sourceShift._id,
          personnelId: person.personnelId,
          requestingUserId: uid,
        });
      }
      await assignPersonnel({
        shiftId: targetShift._id,
        personnelId: person.personnelId,
        requestingUserId: uid,
      });
    }

    // Set as lead
    await setLead({
      shiftId: targetShift._id,
      personnelId: person.personnelId,
      requestingUserId: uid,
    });

    setDraggedPerson(null);
  };

  // Handle remove lead
  const handleRemoveLead = async (shiftId: Id<"shifts">) => {
    if (!user) return;
    await removeLead({ shiftId, requestingUserId: user._id as Id<"users"> });
  };

  // Handle create default departments
  const handleCreateDefaultDepartments = async () => {
    if (!user) return;
    // Get existing department names to avoid duplicates
    const existingDepartments = new Set(shifts.map(s => s.department));

    for (const dept of DEFAULT_DEPARTMENTS) {
      // Skip if department already exists
      if (existingDepartments.has(dept)) continue;

      await createShift({
        date: selectedDate,
        name: dept,
        startTime: "00:00",
        endTime: "23:59",
        position: "Staff",
        department: dept,
        locationId: selectedLocationId || undefined,
        requiredCount: 99,
        assignedPersonnel: [],
        createdBy: user._id as Id<"users">,
      });
    }
  };

  // Auto-select location for warehouse_manager with only one assigned location
  useEffect(() => {
    if (user?.role === "warehouse_manager" && accessibleLocations.length === 1 && !selectedLocationId) {
      setSelectedLocationId(accessibleLocations[0]._id);
    }
  }, [user?.role, accessibleLocations, selectedLocationId]);

  // Permission check
  if (!canViewShifts) {
    return (
      <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center px-4">
            <h1 className="text-2xl font-bold theme-text-primary">Access Denied</h1>
            <p className="mt-2 theme-text-secondary">
              You don&apos;t have permission to view shift planning.
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Get shifts to print (all or single department)
  const shiftsToPrint = printDepartment
    ? shifts.filter(s => s.department === printDepartment)
    : shifts;

  // Print mode layout — kept as-is (print CSS is functional, not cosmetic)
  if (isPrintMode) {
    return (
      <div className="p-3 bg-white min-h-screen print:p-2">
        <style jsx global>{`
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print { display: none !important; }
            @page { margin: 0.25in; size: landscape; }
          }
        `}</style>

        {/* Compact Header */}
        <div className="mb-3">
          <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white rounded-t-lg px-4 py-2">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-bold tracking-wide">
                {printDepartment ? `${printDepartment} Department` : "Daily Shift Schedule"}
              </h1>
              <p className="text-slate-300 text-sm">{formatDisplayDate(currentDate)}</p>
            </div>
          </div>
          {selectedLocation && (selectedLocation.warehouseManagerName || selectedLocation.name) && (
            <div className="bg-slate-100 border-x border-b border-slate-300 rounded-b-lg px-4 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div>
                {selectedLocation.name && (
                  <span className="font-medium text-slate-600">Location: {selectedLocation.name}</span>
                )}
              </div>
              {selectedLocation.warehouseManagerName && (
                <div className="text-slate-600">
                  <span className="font-semibold">Manager:</span> {selectedLocation.warehouseManagerName}
                  {selectedLocation.warehouseManagerPhone && (
                    <span className="ml-2">Tel: {selectedLocation.warehouseManagerPhone}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Single Department View - Full Page */}
        {printDepartment ? (
          <div className="max-w-2xl mx-auto">
            {shiftsToPrint.map((shift) => {
              const deptTasks = dailyTasks[shift.department] || [];
              return (
                <div key={shift._id} className="border-2 border-slate-300 rounded-xl overflow-hidden shadow-sm">
                  {/* Department Header */}
                  <div className="bg-slate-700 text-white px-6 py-4">
                    <h2 className="text-xl font-bold uppercase tracking-wider">
                      {shift.name || shift.department || "Department"}
                    </h2>
                    <p className="text-slate-300 text-sm mt-1">
                      {(shift.assignedNames.length + (shift.leadName ? 1 : 0))} team members
                    </p>
                  </div>

                  {/* Lead Section */}
                  {shift.leadName && (
                    <div className="bg-amber-50 border-b-2 border-amber-200 px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center text-white text-lg">
                          ★
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Department Lead</p>
                          <p className="text-lg font-bold text-slate-800">{shift.leadName}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Daily Goals Section */}
                  {deptTasks.length > 0 && (
                    <div className="bg-green-50 border-b-2 border-green-200 px-6 py-4">
                      <h3 className="text-xs font-bold text-green-800 uppercase tracking-wide mb-3 flex items-center gap-2">
                        <span className="w-5 h-5 bg-green-600 rounded text-white flex items-center justify-center text-xs">✓</span>
                        Today&apos;s Goals
                      </h3>
                      <ul className="space-y-2">
                        {deptTasks.map((task: { id: string; text: string; completed?: boolean }, idx: number) => (
                          <li key={task.id} className="flex items-start gap-3">
                            <span className="w-6 h-6 border-2 border-slate-400 rounded flex items-center justify-center text-xs font-bold text-slate-500 flex-shrink-0 mt-0.5">
                              {task.completed ? "✓" : idx + 1}
                            </span>
                            <span className={`text-slate-700 ${task.completed ? "line-through text-slate-400" : ""}`}>
                              {task.text}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Crew List */}
                  <div className="px-6 py-4">
                    <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                      <span className="w-5 h-5 bg-blue-600 rounded text-white flex items-center justify-center text-xs">👥</span>
                      Assigned Crew
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      {shift.assignedNames.map((name, idx) => (
                        <div key={idx} className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2">
                          <span className="text-slate-800 font-medium">{name}</span>
                        </div>
                      ))}
                    </div>
                    {shift.assignedNames.length === 0 && !shift.leadName && (
                      <p className="text-slate-400 italic text-center py-4">No crew assigned</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* All Departments Grid View - Compact for single page */
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {shiftsToPrint.map((shift) => {
              const deptTasks = dailyTasks[shift.department] || [];
              return (
                <div key={shift._id} className="border border-slate-300 rounded overflow-hidden bg-white text-[11px]">
                  {/* Compact Department Header */}
                  <div className="bg-slate-700 text-white px-2 py-1">
                    <h3 className="font-bold text-xs uppercase tracking-wide truncate">
                      {shift.name || shift.department || "Department"}
                    </h3>
                  </div>

                  <div className="p-1.5 space-y-1">
                    {/* Lead */}
                    {shift.leadName && (
                      <div className="bg-amber-50 rounded px-1.5 py-0.5 border border-amber-200">
                        <p className="font-semibold text-slate-800 text-[10px] flex items-center gap-1">
                          <span className="text-amber-500">★</span> {shift.leadName}
                        </p>
                      </div>
                    )}

                    {/* Tasks - Show ALL */}
                    {deptTasks.length > 0 && (
                      <div className="bg-green-50 rounded px-1.5 py-0.5 border border-green-200">
                        <p className="text-[9px] font-semibold text-green-700 uppercase">Tasks</p>
                        <ul className="space-y-0">
                          {deptTasks.map((task: { id: string; text: string; completed?: boolean }) => (
                            <li key={task.id} className="text-[10px] text-slate-600 flex items-start gap-0.5">
                              <span className="text-slate-400 flex-shrink-0">{task.completed ? "✓" : "○"}</span>
                              <span className={task.completed ? "line-through text-slate-400" : ""}>
                                {task.text}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Crew - Compact list */}
                    <div>
                      <p className="text-[9px] font-semibold text-slate-500 uppercase">Crew ({shift.assignedNames.length})</p>
                      <ul className="space-y-0">
                        {shift.assignedNames.map((name, idx) => (
                          <li key={idx} className="text-[10px] text-slate-700 leading-tight">• {name}</li>
                        ))}
                        {shift.assignedNames.length === 0 && !shift.leadName && (
                          <li className="text-[10px] text-slate-400 italic">No staff</li>
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="mt-3 pt-2 border-t border-slate-200 text-center text-[10px] text-slate-400 no-print">
          Printed on {new Date().toLocaleDateString()} at {new Date().toLocaleTimeString()}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
      <Sidebar />

      <main className="flex-1 overflow-hidden flex flex-col">
        <MobileHeader />

        {/* Sticky iOS-style page header */}
        <header className={`flex-shrink-0 sticky top-0 z-10 backdrop-blur-sm border-b px-4 sm:px-8 py-3 sm:py-4 ${isDark ? "bg-slate-900/80 border-slate-700" : "bg-white/80 border-gray-200"}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold theme-text-primary truncate">
                Shift Planning
              </h1>
              <p className="text-xs sm:text-sm mt-0.5 hidden sm:block theme-text-tertiary">
                Drag staff between departments
              </p>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Location Selector (header) */}
              {accessibleLocations.length > 0 && (
                <select
                  value={selectedLocationId || ""}
                  onChange={(e) => setSelectedLocationId(e.target.value ? e.target.value as Id<"locations"> : null)}
                  className="theme-input px-3 py-2 text-sm"
                >
                  <option value="">All Locations</option>
                  {accessibleLocations.map((loc) => (
                    <option key={loc._id} value={loc._id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              )}

              {/* Template Dropdown */}
              {canEditShifts && (
                <div className="relative" ref={templateDropdownRef}>
                  <Button
                    variant="ghost"
                    onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="hidden sm:inline">Templates</span>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </Button>
                  {showTemplateDropdown && (
                    <div className={`absolute right-0 mt-2 w-64 rounded-xl border shadow-lg z-50 ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
                      <div className={`px-3 py-2 border-b ${isDark ? "border-slate-700" : "border-gray-100"}`}>
                        <p className="ui-section-label">Load Template</p>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {templates.length === 0 ? (
                          <p className="p-3 text-sm theme-text-tertiary">No templates saved</p>
                        ) : (
                          templates.map((template) => (
                            <div
                              key={template._id}
                              className={`flex items-center justify-between px-2 py-1.5 ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-50"}`}
                            >
                              <button
                                onClick={() => handleApplyTemplate(template._id)}
                                className="flex-1 text-left text-sm theme-text-primary"
                              >
                                {template.name}
                                {template.description && (
                                  <span className="block text-xs theme-text-tertiary">
                                    {template.description}
                                  </span>
                                )}
                              </button>
                              <button
                                onClick={() => handleDeleteTemplate(template._id)}
                                className="p-1 rounded theme-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                      <div className={`px-2 py-2 border-t ${isDark ? "border-slate-700" : "border-gray-100"}`}>
                        <button
                          onClick={() => {
                            setShowTemplateDropdown(false);
                            setShowSaveTemplateModal(true);
                          }}
                          disabled={shifts.length === 0}
                          className="w-full text-left px-2 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 theme-accent-primary hover:bg-gray-50 dark:hover:bg-slate-700"
                        >
                          + Save Current as Template
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Print Dropdown */}
              <div className="relative" ref={printDropdownRef}>
                <Button
                  variant="ghost"
                  onClick={() => setShowPrintDropdown(!showPrintDropdown)}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  <span className="hidden sm:inline">Print</span>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </Button>
                {showPrintDropdown && (
                  <div className={`absolute right-0 mt-2 w-48 rounded-xl border shadow-lg z-50 ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
                    <button
                      onClick={() => handlePrintDepartment(null)}
                      className={`w-full text-left px-3 py-2.5 text-sm font-medium border-b theme-text-primary ${isDark ? "hover:bg-slate-700 border-slate-700" : "hover:bg-gray-50 border-gray-100"}`}
                    >
                      Print All Departments
                    </button>
                    {shifts.length > 0 && (
                      <div>
                        <p className="px-3 py-2 ui-section-label">Print Single Department</p>
                        {shifts.map((shift) => (
                          <button
                            key={shift._id}
                            onClick={() => handlePrintDepartment(shift.department)}
                            className={`w-full text-left px-3 py-2 text-sm theme-text-secondary ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-50"}`}
                          >
                            {shift.department}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {canEditShifts && (
                <>
                  <Button
                    variant="secondary"
                    className="hidden sm:inline-flex"
                    onClick={handleCopyFromYesterday}
                  >
                    Copy Yesterday
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => setShowCreateModal(true)}
                  >
                    <span className="hidden sm:inline">+ Add Department</span>
                    <span className="sm:hidden">+ Add</span>
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Date Navigation */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-3">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={goToPreviousDay}
                aria-label="Previous day"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Button>
              <Button
                variant={isToday ? "primary" : "secondary"}
                size="sm"
                onClick={goToToday}
              >
                Today
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={goToNextDay}
                aria-label="Next day"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Button>
            </div>

            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="theme-input px-3 py-1.5 text-sm"
            />

            <span className="text-sm sm:text-base font-semibold hidden sm:inline theme-text-primary">
              {formatDisplayDate(currentDate)}
            </span>

            {isToday && (
              <span className="hidden sm:inline ui-badge ui-badge-blue">Today</span>
            )}

            {/* Location Selector (date bar — mobile) */}
            {accessibleLocations.length > 0 && (
              <select
                value={selectedLocationId || ""}
                onChange={(e) => setSelectedLocationId(e.target.value ? e.target.value as Id<"locations"> : null)}
                className="theme-input px-3 py-1.5 text-sm sm:hidden"
              >
                <option value="">All Locations</option>
                {accessibleLocations.map((loc) => (
                  <option key={loc._id} value={loc._id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Mobile: Copy Yesterday button */}
          {canEditShifts && (
            <Button
              variant="secondary"
              className="sm:hidden mt-3 w-full"
              onClick={handleCopyFromYesterday}
            >
              Copy Yesterday
            </Button>
          )}
        </header>

        {/* Main Content */}
        <div className="flex-1 overflow-auto p-3 sm:p-6">
          <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 h-full">

            {/* Department Columns */}
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 sm:gap-4 auto-rows-min">
              {shifts.map((shift) => (
                <div
                  key={shift._id}
                  className={`theme-card min-h-[200px] ${draggedPerson ? "ring-2 ring-dashed ring-[#007AFF]/40" : ""}`}
                >
                  {/* Department Header */}
                  <div className={`flex items-center justify-between px-4 py-3 border-b theme-border-secondary`}>
                    <h3 className="font-semibold text-[15px] theme-text-primary">
                      {shift.department}
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="ui-badge ui-badge-gray">
                        {shift.assignedPersonnel.length}
                      </span>
                      {canEditShifts && (
                        <button
                          onClick={() => handleDeleteDepartment(shift._id)}
                          className="p-1 rounded-lg theme-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Department Lead Section */}
                  <div className={`px-3 py-3 border-b theme-border-secondary`}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <svg className="w-3.5 h-3.5 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                      <span className="ui-section-label">Department Lead</span>
                    </div>
                    {shift.leadId && shift.leadName ? (
                      <div
                        draggable={canEditShifts}
                        onDragStart={(e) => handleDragStart(e, shift.leadId!, shift.leadName!, shift.department, true)}
                        onDragEnd={handleDragEnd}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDropLead(e, shift)}
                        className="flex items-center justify-between px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25"
                      >
                        <span className="font-medium text-sm text-amber-600 dark:text-amber-400">
                          {shift.leadName}
                        </span>
                        {canEditShifts && (
                          <button
                            onClick={() => handleRemoveLead(shift._id)}
                            className="p-1 rounded-lg text-amber-500 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ) : (
                      <div
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDropLead(e, shift)}
                        className={`px-3 py-3 rounded-xl border-2 border-dashed text-center min-h-[48px] flex items-center justify-center transition-colors theme-border-secondary ${
                          draggedPerson ? "ring-2 ring-amber-400/40 bg-amber-500/5 border-amber-400/50" : ""
                        }`}
                      >
                        <span className="text-sm theme-text-tertiary">Drop to set as lead</span>
                      </div>
                    )}
                  </div>

                  {/* Daily Tasks Section */}
                  {(() => {
                    const deptTasks = dailyTasks[shift.department] || [];
                    return (
                      <div className={`px-3 py-3 border-b theme-border-secondary`}>
                        <div className="flex items-center gap-1.5 mb-2">
                          <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                          </svg>
                          <span className="ui-section-label">Daily Goals</span>
                        </div>

                        {/* Task list */}
                        <div className="space-y-1 mb-2">
                          {deptTasks.map((task: { id: string; text: string; completed?: boolean }) => (
                            <div
                              key={task.id}
                              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${isDark ? "bg-slate-700/30" : "bg-gray-50"}`}
                            >
                              <button
                                onClick={() => handleToggleTask(shift.department, task.id)}
                                className={`flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                                  task.completed
                                    ? "bg-green-500 border-green-500"
                                    : isDark ? "border-slate-500" : "border-gray-300"
                                }`}
                              >
                                {task.completed && (
                                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </button>
                              <span className={`flex-1 text-sm ${
                                task.completed ? "line-through theme-text-tertiary" : "theme-text-primary"
                              }`}>
                                {task.text}
                              </span>
                              {canEditShifts && (
                                <button
                                  onClick={() => handleRemoveTask(shift.department, task.id)}
                                  className="p-1 rounded-lg theme-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Add task input */}
                        {canEditShifts && (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={newTaskTexts[shift.department] || ""}
                              onChange={(e) => setNewTaskTexts(prev => ({ ...prev, [shift.department]: e.target.value }))}
                              onKeyDown={(e) => e.key === "Enter" && handleAddTask(shift.department)}
                              placeholder="Add a task..."
                              className="theme-input flex-1 px-3 py-1.5 text-sm"
                            />
                            <button
                              onClick={() => handleAddTask(shift.department)}
                              disabled={!newTaskTexts[shift.department]?.trim()}
                              className="px-3 py-1.5 rounded-[9px] text-sm font-semibold transition-colors disabled:opacity-50 bg-green-500/15 text-green-600 dark:text-green-400 hover:bg-green-500/25"
                            >
                              +
                            </button>
                          </div>
                        )}

                        {deptTasks.length === 0 && !canEditShifts && (
                          <p className="text-xs theme-text-tertiary">No tasks for today</p>
                        )}
                      </div>
                    );
                  })()}

                  {/* Personnel List */}
                  <div
                    onDragOver={handleDragOver}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDrop(shift);
                    }}
                    className="px-3 py-3 space-y-2 min-h-[60px]"
                  >
                    {shift.assignedNames.map((name, idx) => (
                      <div
                        key={shift.assignedPersonnel[idx]}
                        draggable={canEditShifts}
                        onDragStart={(e) => handleDragStart(e, shift.assignedPersonnel[idx], name, shift.department)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-move transition-colors ${
                          isDark ? "bg-slate-700/50 hover:bg-slate-700" : "bg-gray-50 hover:bg-gray-100"
                        }`}
                      >
                        <span className="text-sm theme-text-primary">{name}</span>
                        {canEditShifts && (
                          <button
                            onClick={() => handleUnassignPersonnel(shift._id, shift.assignedPersonnel[idx])}
                            className="p-1 rounded-lg theme-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ))}
                    {shift.assignedNames.length === 0 && (
                      <div className="text-center py-8 theme-text-tertiary">
                        <p className="text-sm">Drop staff here</p>
                      </div>
                    )}
                  </div>

                  {/* Add Personnel Button */}
                  {canEditShifts && (
                    <div className={`px-3 py-3 border-t theme-border-secondary`}>
                      <button
                        onClick={() => {
                          setSelectedDepartment(shift);
                          setShowAssignModal(true);
                        }}
                        className={`w-full py-2 rounded-xl text-sm font-medium transition-colors theme-text-tertiary hover:theme-text-primary ${
                          isDark ? "bg-slate-700/40 hover:bg-slate-700" : "bg-gray-100 hover:bg-gray-200"
                        }`}
                      >
                        + Add Staff
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {/* Empty State */}
              {shifts.length === 0 && (
                <div className="col-span-full text-center py-16 theme-text-tertiary">
                  <svg
                    className="w-16 h-16 mx-auto mb-4 opacity-40"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                    />
                  </svg>
                  <h3 className="text-[17px] font-semibold theme-text-secondary mb-1">
                    No departments for today
                  </h3>
                  <p className="text-sm theme-text-tertiary mb-5">Add a department to start assigning staff</p>
                  {canEditShifts && (
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                      <Button variant="primary" onClick={handleCreateDefaultDepartments}>
                        Create Default Departments
                      </Button>
                      <Button variant="secondary" onClick={() => setShowCreateModal(true)}>
                        + Add Custom Department
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Unassigned Personnel Panel */}
            <div className={`theme-card lg:w-64 flex-shrink-0 order-first lg:order-last`}>
              <div className={`px-4 py-3 border-b theme-border-secondary`}>
                <h3 className="font-semibold text-[15px] theme-text-primary">Unassigned Staff</h3>
                <p className="text-xs mt-0.5 theme-text-tertiary">
                  {unassignedPersonnel.length} available
                </p>
              </div>
              {/* Horizontal scroll on mobile, vertical on desktop */}
              <div className="p-2 sm:p-3 lg:space-y-2 lg:max-h-[calc(100vh-300px)] overflow-x-auto lg:overflow-x-visible lg:overflow-y-auto">
                <div className="flex lg:flex-col gap-2">
                  {unassignedPersonnel.map((person) => {
                    const personLocation = locations.find(l => l._id === person.locationId);
                    return (
                      <div
                        key={person._id}
                        draggable={canEditShifts}
                        onDragStart={(e) => handleDragStart(e, person._id, `${person.firstName} ${person.lastName}`, "unassigned")}
                        onDragEnd={handleDragEnd}
                        className={`px-3 py-2 rounded-xl cursor-move transition-colors flex-shrink-0 min-w-[120px] lg:min-w-0 ${
                          isDark ? "bg-slate-700/50 hover:bg-slate-700" : "bg-gray-50 hover:bg-gray-100"
                        }`}
                      >
                        <div className="font-medium text-sm whitespace-nowrap lg:whitespace-normal theme-text-primary">
                          {person.firstName} {person.lastName}
                        </div>
                        <div className="text-xs theme-text-tertiary">{person.department}</div>
                        {personLocation && !selectedLocationId && (
                          <div className="text-xs mt-0.5 theme-accent-primary opacity-70">
                            📍 {personLocation.name}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {unassignedPersonnel.length === 0 && (
                    <div className="text-center py-4 lg:py-8 w-full theme-text-tertiary">
                      <p className="text-sm">All staff assigned</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Create Department Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className={`w-full max-w-md rounded-2xl border ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className={`px-5 py-4 border-b theme-border-secondary`}>
                <h2 className="text-[17px] font-semibold theme-text-primary">Add Department</h2>
                <p className="text-sm theme-text-tertiary mt-0.5">For {formatDisplayDate(currentDate)}</p>
              </div>
              <div className="px-5 py-4">
                <label className="block text-xs font-medium mb-1.5 theme-text-tertiary">Department Name</label>
                <input
                  type="text"
                  value={newDepartmentName}
                  onChange={(e) => setNewDepartmentName(e.target.value)}
                  placeholder="e.g., Warehouse, Shipping, Office"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleCreateDepartment()}
                  className="theme-input w-full px-3 py-2.5 text-sm"
                />
              </div>
              <div className={`px-5 py-4 border-t theme-border-secondary flex gap-3`}>
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setShowCreateModal(false);
                    setNewDepartmentName("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleCreateDepartment}
                  disabled={!newDepartmentName.trim()}
                >
                  Add
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Assign Personnel Modal */}
        {showAssignModal && selectedDepartment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className={`w-full max-w-md rounded-2xl border ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className={`px-5 py-4 border-b theme-border-secondary`}>
                <h2 className="text-[17px] font-semibold theme-text-primary">
                  Add Staff to {selectedDepartment.department}
                </h2>
                <p className="text-sm theme-text-tertiary mt-0.5">Select staff members to assign</p>
              </div>

              <div className="px-5 py-3 space-y-1.5 max-h-80 overflow-y-auto">
                {unassignedPersonnel.length > 0 ? (
                  unassignedPersonnel.map((person) => {
                    const personLocation = locations.find(l => l._id === person.locationId);
                    return (
                      <button
                        key={person._id}
                        onClick={() => handleAssignPersonnel(person._id)}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-colors text-left ${
                          isDark ? "hover:bg-slate-700" : "hover:bg-gray-50"
                        }`}
                      >
                        <div>
                          <div className="font-medium text-sm theme-text-primary">
                            {person.firstName} {person.lastName}
                          </div>
                          <div className="text-xs theme-text-tertiary">
                            {person.department} - {person.position}
                          </div>
                          {personLocation && !selectedLocationId && (
                            <div className="text-xs theme-accent-primary opacity-70">
                              📍 {personLocation.name}
                            </div>
                          )}
                        </div>
                        <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                      </button>
                    );
                  })
                ) : (
                  <p className="text-sm text-center py-8 theme-text-tertiary">All staff have been assigned</p>
                )}
              </div>

              <div className={`px-5 py-4 border-t theme-border-secondary`}>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    setShowAssignModal(false);
                    setSelectedDepartment(null);
                  }}
                >
                  Done
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Save Template Modal */}
        {showSaveTemplateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className={`w-full max-w-md rounded-2xl border ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
              <div className={`px-5 py-4 border-b theme-border-secondary`}>
                <h2 className="text-[17px] font-semibold theme-text-primary">Save as Template</h2>
                <p className="text-sm theme-text-tertiary mt-0.5">
                  Save today&apos;s shift plan ({shifts.length} departments) as a reusable template
                </p>
              </div>
              <div className="px-5 py-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5 theme-text-tertiary">Template Name *</label>
                  <input
                    type="text"
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    placeholder="e.g., Monday Standard, Weekend Crew"
                    autoFocus
                    onKeyDown={(e) => e.key === "Enter" && handleSaveAsTemplate()}
                    className="theme-input w-full px-3 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5 theme-text-tertiary">Description (optional)</label>
                  <input
                    type="text"
                    value={newTemplateDescription}
                    onChange={(e) => setNewTemplateDescription(e.target.value)}
                    placeholder="e.g., Standard Monday schedule with full crew"
                    className="theme-input w-full px-3 py-2.5 text-sm"
                  />
                </div>
              </div>
              <div className={`px-5 py-4 border-t theme-border-secondary flex gap-3`}>
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setShowSaveTemplateModal(false);
                    setNewTemplateName("");
                    setNewTemplateDescription("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleSaveAsTemplate}
                  disabled={!newTemplateName.trim()}
                >
                  Save Template
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function ShiftsPage() {
  return (
    <Protected minTier={2}>
      <ShiftsContent />
    </Protected>
  );
}
