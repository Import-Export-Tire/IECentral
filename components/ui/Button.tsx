import { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: "sm" | "md"; children: ReactNode;
};

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-[9px] font-semibold transition-colors " +
  "disabled:opacity-50 disabled:cursor-not-allowed";
const SIZE = { sm: "px-3 py-1.5 text-[13px]", md: "px-3.5 py-2 text-[13.5px]" };
const VARIANT: Record<Variant, string> = {
  primary: "theme-btn-primary",
  secondary: "theme-btn-secondary",
  ghost: "ui-btn-ghost",
  danger: "ui-btn-danger",
};

export default function Button({ variant = "secondary", size = "md", className = "", children, ...rest }: Props) {
  return (
    <button className={`${BASE} ${SIZE[size]} ${VARIANT[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
