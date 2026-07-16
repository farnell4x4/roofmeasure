import { InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export function Input({ label, hint, error, id, style, ...props }: Props) {
  return (
    <label htmlFor={id} style={{ display: "grid", gap: 8 }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <input
        id={id}
        style={{
          borderRadius: 16,
          border: "1px solid var(--stroke)",
          background: "var(--surface-strong)",
          padding: "14px 16px",
          minHeight: 52,
          color: "var(--ink)",
          ...style
        }}
        {...props}
      />
      {error ? <span style={{ color: "var(--danger)", fontSize: 14 }}>{error}</span> : null}
      {!error && hint ? <span style={{ color: "var(--muted)", fontSize: 14 }}>{hint}</span> : null}
    </label>
  );
}
