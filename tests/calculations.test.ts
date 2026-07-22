import { describe, expect, it } from "vitest";
import {
  calculateProjectTotals,
  getProjectCalculationBreakdown,
} from "@/lib/measurement/calculations";
import {
  haversineDistanceFeet,
  polygonAreaSqFt,
  roundedPolygonAreaSqFt,
} from "@/lib/measurement/geometry";
import { roundMeasurement } from "@/lib/measurement/rounding";
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

  it("uses the whole-foot overlay measurement as the calculation input", () => {
    const project = createEmptyProject("Rounded measurement");
    project.singlePitch = "6/12";
    project.segments = [
      {
        id: "rake",
        type: "rake",
        startPointId: "a",
        endPointId: "b",
        lengthFeet: 10.6,
        groupId: "g1",
        createdAt: "",
        updatedAt: "",
      },
    ];

    const totals = calculateProjectTotals(project);

    expect(totals.totals.rake).toBe(11);
    expect(totals.slopeAdjustedTotals.rake).toBeCloseTo(
      11 * Math.sqrt(1.25),
      10,
    );
  });

  it("uses rounded rectangle side labels before applying its pitch factor", () => {
    const project = createEmptyProject("Rounded plane area");
    project.singlePitch = "6/12";
    project.points = [
      { id: "a", lat: 39.7392, lng: -104.9903 },
      { id: "b", lat: 39.7392, lng: -104.9901 },
      { id: "c", lat: 39.73935, lng: -104.9901 },
      { id: "d", lat: 39.73935, lng: -104.9903 },
    ];
    project.planes = [
      {
        id: "p1",
        name: "Roof Plane 1",
        pointIds: ["a", "b", "c", "d"],
        pitch: "6/12",
        planAreaSqFt: 0,
        source: "auto",
      },
    ];

    const roundedEdgeLengths = project.points.map((point, index) =>
      roundMeasurement(
        haversineDistanceFeet(
          point,
          project.points[(index + 1) % project.points.length],
        ),
      ),
    );
    const breakdown = getProjectCalculationBreakdown(project);

    expect(breakdown.planes[0].planAreaSqFt).toBe(
      roundedEdgeLengths[0] * roundedEdgeLengths[1],
    );
    expect(breakdown.planes[0].slopeAreaSqFt).toBeCloseTo(
      roundedEdgeLengths[0] * roundedEdgeLengths[1] * Math.sqrt(1.25),
      10,
    );
    expect(roundedPolygonAreaSqFt(project.points)).not.toBe(
      roundMeasurement(polygonAreaSqFt(project.points)),
    );
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

  it("exposes the exact operands used for pitch-adjusted totals", () => {
    const project = createEmptyProject("Calculation breakdown");
    project.singlePitch = "6/12";
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
        pointIds: [],
        pitch: "6/12",
        planAreaSqFt: 100,
        source: "manual",
      },
    ];

    const breakdown = getProjectCalculationBreakdown(project);

    expect(breakdown.planes[0]).toMatchObject({
      pitch: "6/12",
      planAreaSqFt: 100,
      slopeFactor: Math.sqrt(1.25),
      slopeAreaSqFt: 100 * Math.sqrt(1.25),
    });
    expect(breakdown.segments[0]).toMatchObject({
      pitch: "6/12",
      measuredLengthFeet: 10,
      slopeFactor: Math.sqrt(1.25),
      slopeAdjustedLengthFeet: 10 * Math.sqrt(1.25),
    });
  });
});
