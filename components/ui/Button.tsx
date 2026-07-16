import { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({ className, variant = "primary", style, ...props }: Props) {
  const palette =
    variant === "primary"
      ? { background: "var(--accent)", color: "#fff", border: "1px solid transparent" }
      : variant === "danger"
        ? { background: "rgba(179,75,63,0.12)", color: "var(--danger)", border: "1px solid rgba(179,75,63,0.22)" }
        : variant === "secondary"
          ? { background: "var(--surface-strong)", color: "var(--ink)", border: "1px solid var(--stroke)" }
          : { background: "transparent", color: "var(--ink)", border: "1px solid transparent" };

  return (
    <button
      className={cn(className)}
      style={{
        borderRadius: 14,
        padding: "12px 16px",
        fontWeight: 600,
        minHeight: 48,
        ...palette,
        ...style
      }}
      {...props}
    />
  );
}
