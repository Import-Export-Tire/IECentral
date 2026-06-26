import { ReactNode } from "react";

type Props = {
  children: ReactNode;
  padding?: "sm" | "md";
  tone?: "default" | "amber" | "accent";
  className?: string;
};

const PAD = { sm: "p-4", md: "p-5" };

/** Standard iOS section card. `theme-card` provides bg/border/radius/shadow. */
export default function Card({ children, padding = "md", tone = "default", className = "" }: Props) {
  const toneClass =
    tone === "amber" ? "ui-callout-amber rounded-2xl"
    : tone === "accent" ? "theme-card" // accent reserved; falls back to default chrome
    : "theme-card";
  return <div className={`${toneClass} ${PAD[padding]} ${className}`}>{children}</div>;
}
