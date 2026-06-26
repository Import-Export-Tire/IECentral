import { ReactNode } from "react";

type Props = { title: string; label?: string; actions?: ReactNode; className?: string };

export default function SectionHeader({ title, label, actions, className = "" }: Props) {
  return (
    <div className={`flex items-start justify-between gap-3 mb-4 ${className}`}>
      <div className="min-w-0">
        {label && <div className="ui-section-label">{label}</div>}
        <h2 className="text-[17px] font-semibold theme-text-primary leading-tight truncate">{title}</h2>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">{actions}</div>}
    </div>
  );
}
