"use client";

import { Download, Printer } from "lucide-react";
import { useMemo } from "react";
import Link from "next/link";
import { useProject } from "@/hooks/useProject";
import { calculateProjectTotals } from "@/lib/calculations";
import { formatArea, formatLength } from "@/lib/units";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export function ProjectReportPage({ projectId }: { projectId: string }) {
  const { project, isLoading } = useProject(projectId);
  const totals = useMemo(() => (project ? calculateProjectTotals(project) : null), [project]);

  if (isLoading) {
    return <main className="app-shell"><Card>Loading report…</Card></main>;
  }

  if (!project || !totals) {
    return (
      <main className="app-shell">
        <EmptyState title="Project not found" description="This local project could not be loaded." />
      </main>
    );
  }

  const currentProject = project;

  const wasteMultiplier = 1 + currentProject.preferences.wastePercentage / 100;

  async function handleExport() {
    const html = document.documentElement.outerHTML;
    const blob = new Blob([html], { type: "text/html" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${currentProject.name.replace(/\s+/g, "-").toLowerCase()}-report.html`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <main className="app-shell page-grid">
      <section style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <p className="chip">Persistent Report</p>
          <h1>{currentProject.name}</h1>
          <p style={{ color: "var(--muted)" }}>{currentProject.location?.formattedAddress ?? "Property address pending"}</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={18} /> Print
          </Button>
          <Button onClick={handleExport}>
            <Download size={18} /> Save / Share
          </Button>
        </div>
      </section>

      <Card style={{ display: "grid", gap: 16 }}>
        <h2 style={{ margin: 0 }}>Summary</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Metric title="Plan Area" value={formatArea(totals.totalPlanAreaSqFt, currentProject.preferences.unitSystem)} />
          <Metric title="Slope Area" value={formatArea(totals.totalSlopeAreaSqFt, currentProject.preferences.unitSystem)} />
          <Metric title="Roofing Squares" value={totals.totalSquares.toFixed(2)} />
          <Metric title="With Waste" value={formatArea(totals.totalSlopeAreaSqFt * wasteMultiplier, currentProject.preferences.unitSystem)} />
        </div>
      </Card>

      <Card style={{ display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Measurement Totals</h2>
        {Object.entries(totals.totals).map(([type, value]) => (
          <div key={type} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ textTransform: "capitalize" }}>{type}</span>
            <strong>{formatLength(value, currentProject.preferences.unitSystem, currentProject.preferences.displayDecimalFeet)}</strong>
          </div>
        ))}
      </Card>

      <Card style={{ display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Roof Planes</h2>
        {currentProject.planes.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>No roof planes detected yet. Continue tracing boundaries in the workspace.</p>
        ) : (
          currentProject.planes.map((plane) => (
            <div key={plane.id} style={{ display: "grid", gap: 4, padding: "12px 0", borderTop: "1px solid var(--stroke)" }}>
              <strong>{plane.name}</strong>
              <span style={{ color: "var(--muted)" }}>
                Pitch {plane.pitch ?? currentProject.singlePitch ?? "Unset"} • {formatArea(plane.planAreaSqFt, currentProject.preferences.unitSystem)}
              </span>
            </div>
          ))
        )}
      </Card>

      <Card style={{ display: "grid", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Notes and assumptions</h2>
        <p style={{ margin: 0, color: "var(--muted)" }}>{currentProject.reportSettings.notes || "No notes added yet."}</p>
        <p style={{ margin: 0, color: "var(--muted)" }}>
          Measurements are based on plan-view satellite tracing. Slope-adjusted area uses the selected roof pitch for each plane.
        </p>
      </Card>

      <Link href={`/projects/${currentProject.id}`}>Back to measurement workspace</Link>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--stroke)", borderRadius: 16, padding: 16 }}>
      <div style={{ color: "var(--muted)", marginBottom: 8 }}>{title}</div>
      <strong style={{ fontSize: 20 }}>{value}</strong>
    </div>
  );
}
