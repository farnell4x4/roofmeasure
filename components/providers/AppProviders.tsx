"use client";

import { useEffect } from "react";
import { ToastProvider } from "@/components/ui/ToastProvider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  return <ToastProvider>{children}</ToastProvider>;
}
