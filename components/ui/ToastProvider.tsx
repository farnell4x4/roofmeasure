"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type Toast = {
  id: string;
  title: string;
  tone?: "default" | "success" | "danger";
};

const ToastContext = createContext<{
  push: (toast: Omit<Toast, "id">) => void;
} | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 2800);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: "fixed",
          bottom: 18,
          left: 16,
          right: 16,
          display: "grid",
          gap: 8,
          zIndex: 60
        }}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn("glass")}
            style={{
              padding: "14px 16px",
              borderRadius: 16,
              borderColor:
                toast.tone === "success"
                  ? "rgba(46,125,91,0.3)"
                  : toast.tone === "danger"
                    ? "rgba(179,75,63,0.3)"
                    : undefined
            }}
          >
            {toast.title}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
