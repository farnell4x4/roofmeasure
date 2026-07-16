"use client";

import { ArrowRight, FolderOpen, House } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/ToastProvider";
import { db } from "@/lib/db";
import { createEmptyProject } from "@/lib/project-factory";
import { normalizeProjectName } from "@/lib/utils";

export function HomePage() {
  const router = useRouter();
  const { push } = useToast();
  const [projectName, setProjectName] = useState("");
  const [error, setError] = useState("");

  async function handleCreateProject() {
    const normalized = normalizeProjectName(projectName);
    if (!normalized) {
      setError("Enter a project name to begin.");
      return;
    }
    const project = await db.saveProject(createEmptyProject(normalized));
    push({ title: "Project created locally.", tone: "success" });
    router.push(`/projects/${project.id}?search=1`);
  }

  return (
    <main className="app-shell page-grid" style={{ gap: 24 }}>
      <section
        className="glass"
        style={{
          padding: 24,
          borderRadius: 32,
          display: "grid",
          gap: 20,
          overflow: "hidden"
        }}
      >
        <div className="chip" style={{ width: "fit-content" }}>
          <House size={16} />
          Roof measurement, stored locally
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: "clamp(2.5rem, 8vw, 4.5rem)", lineHeight: 0.95 }}>
            RoofMeasure
          </h1>
          <p style={{ margin: 0, maxWidth: 560, color: "var(--muted)", fontSize: 18 }}>
            Fast, touch-friendly roof measurement for field estimators. Create a project, find the
            property, trace the roof, and keep the report offline-ready on this device.
          </p>
        </div>
        <Card style={{ padding: 20, display: "grid", gap: 16 }}>
          <Input
            id="project-name"
            label="Project Name"
            placeholder="123 Main Street"
            value={projectName}
            onChange={(event) => {
              setProjectName(event.target.value);
              setError("");
            }}
            error={error}
            hint="Projects stay in IndexedDB on this device and continue working offline."
          />
          <div style={{ display: "grid", gap: 12 }}>
            <Button onClick={handleCreateProject}>
              Begin Measuring <ArrowRight size={18} />
            </Button>
            <Button variant="secondary" onClick={() => router.push("/projects")}>
              <FolderOpen size={18} /> Open Saved Projects
            </Button>
          </div>
        </Card>
      </section>
    </main>
  );
}
