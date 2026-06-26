"use client";
import { KeyboardEvent } from "react";

type Props = {
  value: number | null;
  onChange?: (v: number) => void;
  readOnly?: boolean;
  name: string;
};

const OPTS = [1, 2, 3, 4];

export default function RatingScale({ value, onChange, readOnly = false, name }: Props) {
  function handleKey(e: KeyboardEvent<HTMLDivElement>) {
    if (readOnly || !onChange) return;
    const cur = value ?? 0;
    if (e.key >= "1" && e.key <= "4") { onChange(Number(e.key)); e.preventDefault(); }
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") { onChange(Math.min(4, cur + 1) || 1); e.preventDefault(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { onChange(Math.max(1, cur - 1) || 1); e.preventDefault(); }
  }
  return (
    <div role="radiogroup" aria-label={name} onKeyDown={handleKey} className="flex gap-1.5">
      {OPTS.map((n) => {
        const selected = value === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${name}: ${n} of 4`}
            tabIndex={selected || (!value && n === 1) ? 0 : -1}
            disabled={readOnly}
            onClick={() => !readOnly && onChange?.(n)}
            className={`ui-segment ${selected ? "ui-segment-on" : ""} ${readOnly ? "cursor-default" : "cursor-pointer"}`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}
