"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import ProjectCard from "./ProjectCard";
import { Doc } from "@/convex/_generated/dataModel";

type Project = Doc<"projects">;
type User = Doc<"users">;

interface KanbanColumnProps {
  id: string;
  title: string;
  color: string;
  projects: Project[];
  users?: User[];
  onProjectClick: (project: Project) => void;
}

const colorStyles: Record<string, { bg: string; text: string; border: string }> = {
  slate: {
    bg: "bg-slate-500/10",
    text: "text-slate-400",
    border: "border-slate-500/30",
  },
  cyan: {
    bg: "bg-cyan-500/10",
    text: "text-cyan-400",
    border: "border-cyan-500/30",
  },
  amber: {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/30",
  },
  green: {
    bg: "bg-green-500/10",
    text: "text-green-400",
    border: "border-green-500/30",
  },
};

export default function KanbanColumn({
  id,
  title,
  color,
  projects,
  users,
  onProjectClick,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const styles = colorStyles[color] || colorStyles.slate;

  return (
    <div
      ref={setNodeRef}
      className={`w-full sm:flex-1 sm:min-w-0 flex flex-col bg-slate-800/30 rounded-xl border ${
        isOver ? "border-cyan-500" : "border-slate-700"
      } transition-colors`}
    >
      {/* Column Header */}
      <div className="p-4 border-b border-slate-700/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-1 text-xs font-medium rounded ${styles.bg} ${styles.text} ${styles.border} border`}
            >
              {title}
            </span>
            <span className="text-sm text-slate-500">{projects.length}</span>
          </div>
        </div>
      </div>

      {/* Cards Container */}
      <div className="flex-1 p-3 space-y-3 overflow-y-auto min-h-[200px]">
        <SortableContext
          items={projects.map((p) => p._id)}
          strategy={verticalListSortingStrategy}
        >
          {projects.map((project) => (
            <ProjectCard
              key={project._id}
              project={project}
              users={users}
              onClick={() => onProjectClick(project)}
            />
          ))}
        </SortableContext>

        {projects.length === 0 && (
          <div className="flex items-center justify-center h-24 text-sm text-slate-500 border-2 border-dashed border-slate-700 rounded-lg">
            Drop projects here
          </div>
        )}
      </div>
    </div>
  );
}
