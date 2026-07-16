import { HTMLAttributes } from "react";

export function Card({ children, style, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className="glass"
      style={{
        borderRadius: 24,
        padding: 18,
        ...style
      }}
      {...props}
    >
      {children}
    </div>
  );
}
