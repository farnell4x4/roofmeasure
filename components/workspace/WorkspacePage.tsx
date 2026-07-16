"use client";

import { ArrowLeft, FileText, MapPinned, Redo2, Save, Settings, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AddressSearch } from "@/components/workspace/AddressSearch";
import { MapViewport } from "@/components/workspace/MapViewport";
import { MeasurementToolbar } from "@/components/workspace/MeasurementToolbar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { useProject } from "@/hooks/useProject";
import { useToast } from "@/components/ui/ToastProvider";
import { calculateProjectTotals } from "@/lib/calculations";
import { DEFAULT_CAMERA } from "@/lib/constants";
import { haversineDistanceFeet, pointFromClientOffset } from "@/lib/geometry";
import { detectRoofPlanes } from "@/lib/plane-detection";
import { generateId, nowIso } from "@/lib/utils";
import { AddressSuggestion } from "@/types/mapkit";
import {
  GeographicPoint,
  MeasurementSegment,
  MeasurementType,
  Project
} from "@/types/models";

type Snapshot = Project;

export function WorkspacePage({ projectId }: { projectId: string }) {
  const params = useSearchParams();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const { push } = useToast();
  const { project, setProject, isLoading, save, saveState } = useProject(projectId);
  const [selectedType, setSelectedType] = useState<MeasurementType | null>("eave");
  const [activeStartPointId, setActiveStartPointId] = useState<string | null>(null);
  const [addressSearchOpen, setAddressSearchOpen] = useState(params.get("search") === "1");
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);

  useEffect(() => {
    if (params.get("search") === "1") {
      setAddressSearchOpen(true);
    }
  }, [params]);

  const totals = useMemo(() => (project ? calculateProjectTotals(project) : null), [project]);

  if (isLoading) {
    return <main className="app-shell"><Card>Loading workspace…</Card></main>;
  }

  if (!project) {
    return (
      <main className="app-shell">
        <EmptyState title="Project not found" description="This local project could not be loaded." />
      </main>
    );
  }

  const currentProject = project;

  function snapshot(nextProject: Project) {
    setHistory((current) => [...current.slice(-29), structuredClone(currentProject)]);
    setFuture([]);
    setProject(nextProject);
    void save(nextProject);
  }

  function handleUndo() {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((current) => current.slice(0, -1));
    setFuture((current) => [structuredClone(currentProject), ...current]);
    setProject(previous);
    void save(previous);
  }

  function handleRedo() {
    const next = future[0];
    if (!next) return;
    setFuture((current) => current.slice(1));
    setHistory((current) => [...current, structuredClone(currentProject)]);
    setProject(next);
    void save(next);
  }

  function buildPoint(lat: number, lng: number): GeographicPoint {
    return {
      id: generateId("point"),
      lat,
      lng
    };
  }

  function upsertRoofPlanes(nextProject: Project) {
    const pointIds = nextProject.points.map((point) => point.id);
    const planes = detectRoofPlanes(pointIds, nextProject.segments).map((plane, index) => ({
      ...plane,
      name: `Roof Plane ${index + 1}`,
      planAreaSqFt: 0
    }));
    return {
      ...nextProject,
      planes
    };
  }

  function handleCanvasTap(event: React.PointerEvent<HTMLDivElement>) {
    if (!selectedType) {
      push({ title: "Choose a measurement type first.", tone: "danger" });
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const camera = currentProject.mapCamera ?? DEFAULT_CAMERA;
    const coordinate = pointFromClientOffset(x, y, bounds.width, bounds.height, camera);
    const nextPoint = buildPoint(coordinate.lat, coordinate.lng);

    if (!activeStartPointId) {
      const nextProject = {
        ...currentProject,
        points: [...currentProject.points, nextPoint],
        updatedAt: nowIso(),
        lastOpenedAt: nowIso()
      };
      snapshot(nextProject);
      setActiveStartPointId(nextPoint.id);
      return;
    }

    const previousPoint = currentProject.points.find((point) => point.id === activeStartPointId);
    if (!previousPoint) {
      setActiveStartPointId(null);
      return;
    }

    const segment: MeasurementSegment = {
      id: generateId("segment"),
      type: selectedType,
      startPointId: previousPoint.id,
      endPointId: nextPoint.id,
      lengthFeet: haversineDistanceFeet(previousPoint, nextPoint),
      groupId: generateId("group"),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    const nextProject = upsertRoofPlanes({
      ...currentProject,
      points: [...currentProject.points, nextPoint],
      segments: [...currentProject.segments, segment],
      updatedAt: nowIso(),
      lastOpenedAt: nowIso()
    });
    snapshot(nextProject);
    setActiveStartPointId(currentProject.preferences.continuationMode === "continuous" ? nextPoint.id : null);
  }

  function handleAddressSelect(suggestion: AddressSuggestion) {
    const nextProject = {
      ...currentProject,
      location: {
        formattedAddress: [suggestion.title, suggestion.subtitle].filter(Boolean).join(", "),
        latitude: suggestion.latitude ?? DEFAULT_CAMERA.centerLat,
        longitude: suggestion.longitude ?? DEFAULT_CAMERA.centerLng
      },
      mapCamera: {
        centerLat: suggestion.latitude ?? DEFAULT_CAMERA.centerLat,
        centerLng: suggestion.longitude ?? DEFAULT_CAMERA.centerLng,
        latSpan: 0.0014,
        lngSpan: 0.0014
      },
      updatedAt: nowIso()
    };
    snapshot(nextProject);
    setAddressSearchOpen(false);
    push({ title: "Address stored. Continue tracing the roof.", tone: "success" });
  }

  function handleDeleteLastSegment() {
    const nextSegments = currentProject.segments.slice(0, -1);
    const nextProject = upsertRoofPlanes({
      ...currentProject,
      segments: nextSegments,
      updatedAt: nowIso()
    });
    snapshot(nextProject);
  }

  return (
    <main className="app-shell page-grid">
      <section style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 6 }}>
          <Link href="/projects" style={{ color: "var(--muted)" }}><ArrowLeft size={16} /> Projects</Link>
          <h1 style={{ margin: 0 }}>{currentProject.name}</h1>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", color: "var(--muted)", fontSize: 14 }}>
            <span>{currentProject.location?.formattedAddress ?? "Address not set yet"}</span>
            <span>{saveState === "saved" ? "Saved locally" : saveState === "saving" ? "Saving…" : saveState}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={handleUndo} disabled={history.length === 0}>
            <Undo2 size={18} />
          </Button>
          <Button variant="ghost" onClick={handleRedo} disabled={future.length === 0}>
            <Redo2 size={18} />
          </Button>
          <Button variant="secondary" onClick={() => setAddressSearchOpen(true)}>
            <MapPinned size={18} /> Address
          </Button>
          <Link href={`/projects/${currentProject.id}/report`}>
            <Button>
              <FileText size={18} /> Report
            </Button>
          </Link>
          <Link href="/settings">
            <Button variant="secondary">
              <Settings size={18} />
            </Button>
          </Link>
        </div>
      </section>

      <MeasurementToolbar selectedType={selectedType} onSelect={setSelectedType} />

      <section style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0, 1fr)", alignItems: "start" }}>
        <AddressSearch
          open={addressSearchOpen}
          onSelect={handleAddressSelect}
          onClose={() => setAddressSearchOpen(false)}
        />

        <MapViewport
          mapRef={mapRef}
          project={currentProject}
          camera={currentProject.mapCamera ?? DEFAULT_CAMERA}
          selectedType={selectedType}
          activeStartPointId={activeStartPointId}
          onCanvasTap={handleCanvasTap}
          unitSystem={currentProject.preferences.unitSystem}
          decimalFeet={currentProject.preferences.displayDecimalFeet}
          promptVisible={!currentProject.preferences.measurementPromptDismissed}
        />
      </section>

      <section
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))"
        }}
      >
        <Card style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Mode</strong>
            <button
              type="button"
              className="chip"
              onClick={() =>
                snapshot({
                  ...project,
                  preferences: {
                    ...currentProject.preferences,
                    continuationMode:
                      currentProject.preferences.continuationMode === "continuous" ? "new-line" : "continuous"
                  }
                })
              }
            >
              {currentProject.preferences.continuationMode === "continuous" ? "Continuous" : "New Line"}
            </button>
          </div>
          <p style={{ color: "var(--muted)", margin: 0 }}>
            Tap and hold is reserved for future contextual editing. The current mode controls whether the next segment starts from the last endpoint.
          </p>
          <Button variant="secondary" onClick={handleDeleteLastSegment} disabled={currentProject.segments.length === 0}>
            <Trash2 size={18} /> Delete Last Segment
          </Button>
        </Card>

        <Card style={{ display: "grid", gap: 12 }}>
          <strong>Pitch workflow</strong>
          <label style={{ display: "grid", gap: 8 }}>
            <span>Pitch Mode</span>
            <select
              value={currentProject.pitchMode}
              onChange={(event) =>
                snapshot({
                  ...currentProject,
                  pitchMode: event.target.value as Project["pitchMode"]
                })
              }
              style={{ borderRadius: 16, minHeight: 48, padding: "0 14px", border: "1px solid var(--stroke)", background: "var(--surface-strong)" }}
            >
              <option value="single">One Pitch</option>
              <option value="multiple">Multiple Pitches</option>
            </select>
          </label>
          {currentProject.pitchMode === "single" ? (
            <Input
              id="single-pitch"
              label="Roof Pitch"
              value={currentProject.singlePitch ?? ""}
              onChange={(event) =>
                snapshot({
                  ...currentProject,
                  singlePitch: event.target.value
                })
              }
              hint="Use roofing pitch format such as 6/12 or 8/12."
            />
          ) : (
            <p style={{ color: "var(--muted)", margin: 0 }}>
              Multiple-pitch mode keeps pitch per plane. Assign pitches in the report-ready plane list as planes are detected.
            </p>
          )}
        </Card>

        <Card style={{ display: "grid", gap: 10 }}>
          <strong>Live totals</strong>
          <span>{totals?.segmentCount ?? 0} measurement segments</span>
          <span>{totals?.planeCount ?? 0} roof planes</span>
          <span>{totals?.totalSquares.toFixed(2) ?? "0.00"} roofing squares</span>
          <Button variant="secondary" onClick={() => void save(currentProject)}>
            <Save size={18} /> Save Now
          </Button>
        </Card>
      </section>

      <Card style={{ display: "grid", gap: 12 }}>
        <strong>Project notes</strong>
        <textarea
          value={currentProject.reportSettings.notes}
          onChange={(event) =>
            setProject({
              ...currentProject,
              reportSettings: {
                ...currentProject.reportSettings,
                notes: event.target.value
              }
            })
          }
          onBlur={() => void save(currentProject)}
          placeholder="Add assumptions, access notes, waste details, or site observations."
          style={{
            minHeight: 120,
            borderRadius: 16,
            border: "1px solid var(--stroke)",
            background: "var(--surface-strong)",
            padding: 14,
            color: "var(--ink)"
          }}
        />
      </Card>
    </main>
  );
}
