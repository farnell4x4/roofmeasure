"use client";

import { useCallback, useEffect, useState } from "react";
import { db } from "@/lib/db";
import { Project, SaveState } from "@/types/models";

export function useProject(projectId: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    const [stored, recovery] = await Promise.all([db.getProject(projectId), db.getRecovery(projectId)]);
    setProject(stored ?? null);
    setRecoveryAvailable(Boolean(recovery));
    setIsLoading(false);
  }, [projectId]);

  useEffect(() => {
    load().catch(() => setIsLoading(false));
  }, [load]);

  const save = useCallback(
    async (nextProject: Project) => {
      setProject(nextProject);
      setSaveState(navigator.onLine ? "saving" : "offline");
      const saved = await db.saveProject(nextProject);
      setProject(saved);
      setSaveState(navigator.onLine ? "saved" : "offline");
      return saved;
    },
    []
  );

  return {
    project,
    setProject,
    isLoading,
    saveState,
    recoveryAvailable,
    load,
    save
  };
}
