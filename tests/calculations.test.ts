import { describe, expect, it } from "vitest";
import { calculateProjectTotals } from "@/lib/measurement/calculations";
import { createEmptyProject } from "@/lib/projects/project-factory";

describe("project totals", () => {
  it("sums linear totals and plane totals", () => {
    const project = createEmptyProject("Demo");
    project.points = [
      { id: "a", lat: 39.7392, lng: -104.9903 },
      { id: "b", lat: 39.7392, lng: -104.9901 },
      { id: "c", lat: 39.73935, lng: -104.9901 },
      { id: "d", lat: 39.73935, lng: -104.9903 }
    ];
    project.segments = [
      {
        id: "s1",
        type: "eave",
        startPointId: "a",
        endPointId: "b",
        lengthFeet: 10,
        groupId: "g1",
        createdAt: "",
        updatedAt: ""
      }
    ];
    project.planes = [
      {
        id: "p1",
        name: "Roof Plane 1",
        pointIds: ["a", "b", "c", "d"],
        pitch: "6/12",
        planAreaSqFt: 0,
        source: "auto"
      }
    ];
    const totals = calculateProjectTotals(project);
    expect(totals.totals.eave).toBe(10);
    expect(totals.totalSlopeAreaSqFt).toBeGreaterThan(totals.totalPlanAreaSqFt);
  });

  it("derives rake, hip, and valley lengths from pitch without changing measurements", () => {
    const project = createEmptyProject("Slope adjustment");
    project.singlePitch = "4/12";
    project.segments = [
      {
        id: "rake",
        type: "rake",
        startPointId: "a",
        endPointId: "b",
        lengthFeet: 10,
        groupId: "g1",
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "ridge",
        type: "ridge",
        startPointId: "b",
        endPointId: "c",
        lengthFeet: 10,
        groupId: "g1",
        createdAt: "",
        updatedAt: "",
      },
    ];

    const totals = calculateProjectTotals(project);

    expect(totals.totals.rake).toBe(10);
    expect(totals.slopeAdjustedTotals.rake).toBeCloseTo(10.54, 2);
    expect(totals.slopeAdjustedTotals.ridge).toBe(10);
  });

  it("uses a connected roof plane pitch before the project fallback pitch", () => {
    const project = createEmptyProject("Plane pitch");
    project.singlePitch = "4/12";
    project.points = [
      { id: "a", lat: 39, lng: -105 },
      { id: "b", lat: 39, lng: -104.9998 },
      { id: "c", lat: 39.0002, lng: -105 },
    ];
    project.segments = [
      {
        id: "rake",
        type: "rake",
        startPointId: "a",
        endPointId: "b",
        lengthFeet: 10,
        groupId: "g1",
        createdAt: "",
        updatedAt: "",
      },
    ];
    project.planes = [
      {
        id: "p1",
        name: "Roof Plane 1",
        pointIds: ["a", "b", "c"],
        pitch: "8/12",
        planAreaSqFt: 0,
        source: "auto",
      },
    ];

    expect(calculateProjectTotals(project).slopeAdjustedTotals.rake).toBeCloseTo(
      12.02,
      2,
    );
  });
});
