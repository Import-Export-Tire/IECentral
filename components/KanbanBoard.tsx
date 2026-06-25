"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import KanbanColumn from "./KanbanColumn";
import ProjectCard from "./ProjectCard";
import { Doc } from "@/convex/_generated/dataModel";

type Project = Doc<"projects">;
type User = Doc<"users">;

interface KanbanBoardProps {
  projects: Project[];
  users?: User[];
  onStatusChange: (projectId: string, newStatus: string) => void;
  onProjectClick: (project: Project) => void;
}

const COLUMNS = [
  { id: "backlog", title: "Backlog", color: "slate" },
  { id: "in_progress", title: "In Progress", color: "cyan" },
  { id: "review", title: "Review", color: "amber" },
  { id: "done", title: "Done", color: "green" },
];

export default function KanbanBoard({
  projects,
  users,
  onStatusChange,
  onProjectClick,
}: KanbanBoardProps) {
  const [activeProject, setActiveProject] = useState<Project | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const project = projects.find((p) => p._id === active.id);
    if (project) {
      setActiveProject(project);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveProject(null);

    if (!over) return;

    const projectId = active.id as string;
    const overId = over.id as string;

    // Check if dropped on a column
    const column = COLUMNS.find((c) => c.id === overId);
    if (column) {
      const project = projects.find((p) => p._id === projectId);
      if (project && project.status !== column.id) {
        onStatusChange(projectId, column.id);
      }
    }
  };

  const getProjectsByStatus = (status: string) => {
    return projects.filter((p) => p.status === status);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 h-full pb-4">
        {COLUMNS.map((column) => (
          <KanbanColumn
            key={column.id}
            id={column.id}
            title={column.title}
            color={column.color}
            projects={getProjectsByStatus(column.id)}
            users={users}
            onProjectClick={onProjectClick}
          />
        ))}
      </div>

      <DragOverlay>
        {activeProject ? (
          <ProjectCard project={activeProject} users={users} isDragging />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
