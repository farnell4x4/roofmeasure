"use client";

import { useCallback, useEffect, useState } from "react";
import { db } from "@/lib/persistence/db";
import { Project, SaveState } from "@/types/models";

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const data = await db.listProjects();
    setProjects(data);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch(() => setIsLoading(false));
  }, [refresh]);

  const saveProject = useCallback(async (project: Project) => {
    setSaveState(navigator.onLine ? "saving" : "offline");
    const saved = await db.saveProject(project);
    setSaveState(navigator.onLine ? "saved" : "offline");
    await refresh();
    return saved;
  }, [refresh]);

  return {
    projects,
    isLoading,
    saveState,
    refresh,
    saveProject
  };
}
