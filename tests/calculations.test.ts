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
  it("keeps a plane flat until its boundary types establish slope direction", () => {
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
    expect(totals.totalSlopeAreaSqFt).toBe(totals.totalPlanAreaSqFt);
  });

  it("applies pitch only after every boundary side is typed", () => {
    const project = createEmptyProject("Slope adjustment");
    project.singlePitch = "6/12";
    project.segments = [
      {
        id: "rake",
        type: "rake",
        startPointId: "a",
        endPointId: "b",
        lengthFeet: 18,
        groupId: "g1",
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "eave",
        type: "eave",
        startPointId: "b",
        endPointId: "c",
        lengthFeet: 65,
        groupId: "g1",
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "second-rake",
        type: "rake",
        startPointId: "c",
        endPointId: "d",
        lengthFeet: 18,
        groupId: "g1",
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "ridge",
        type: "ridge",
        startPointId: "d",
        endPointId: "a",
        lengthFeet: 65,
        groupId: "g1",
        createdAt: "",
        updatedAt: "",
      },
    ];
    project.planes = [
      {
        id: "p1",
        name: "Roof Plane 1",
        pointIds: ["a", "b", "c", "d"],
        planAreaSqFt: 1170,
        source: "manual",
      },
    ];

    const totals = calculateProjectTotals(project);

    expect(totals.totals.rake).toBe(36);
    expect(totals.slopeAdjustedTotals.rake).toBeCloseTo(36 * Math.sqrt(1.25), 10);
    expect(totals.slopeAdjustedTotals.eave).toBe(65);
    expect(totals.slopeAdjustedTotals.ridge).toBe(65);
    expect(totals.totalSlopeAreaSqFt).toBeCloseTo(1170 * Math.sqrt(1.25), 10);
  });

  it("uses the whole-foot overlay measurement without guessing a slope from an incomplete boundary", () => {
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
    expect(totals.slopeAdjustedTotals.rake).toBe(11);
  });

  it("treats typed walls as pitch-adjusted slope sides", () => {
    const project = createEmptyProject("Wall slope adjustment");
    project.singlePitch = "6/12";
    project.segments = [
      { id: "wall-1", type: "wall", startPointId: "a", endPointId: "b", lengthFeet: 18, groupId: "g1", createdAt: "", updatedAt: "" },
      { id: "eave", type: "eave", startPointId: "b", endPointId: "c", lengthFeet: 65, groupId: "g1", createdAt: "", updatedAt: "" },
      { id: "wall-2", type: "wall", startPointId: "c", endPointId: "d", lengthFeet: 18, groupId: "g1", createdAt: "", updatedAt: "" },
      { id: "ridge", type: "ridge", startPointId: "d", endPointId: "a", lengthFeet: 65, groupId: "g1", createdAt: "", updatedAt: "" },
    ];
    project.planes = [
      {
        id: "p1",
        name: "Roof Plane 1",
        pointIds: ["a", "b", "c", "d"],
        planAreaSqFt: 1170,
        source: "manual",
      },
    ];

    const totals = calculateProjectTotals(project);

    expect(totals.totals.wall).toBe(36);
    expect(totals.slopeAdjustedTotals.wall).toBeCloseTo(36 * Math.sqrt(1.25), 10);
    expect(totals.totalSlopeAreaSqFt).toBeCloseTo(1170 * Math.sqrt(1.25), 10);
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
    project.segments = [
      { id: "s1", type: "rake", startPointId: "a", endPointId: "b", lengthFeet: 1, groupId: "g1", createdAt: "", updatedAt: "" },
      { id: "s2", type: "eave", startPointId: "b", endPointId: "c", lengthFeet: 1, groupId: "g1", createdAt: "", updatedAt: "" },
      { id: "s3", type: "rake", startPointId: "c", endPointId: "d", lengthFeet: 1, groupId: "g1", createdAt: "", updatedAt: "" },
      { id: "s4", type: "ridge", startPointId: "d", endPointId: "a", lengthFeet: 1, groupId: "g1", createdAt: "", updatedAt: "" },
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

  it("uses a connected plane pitch after the boundary has enough type information", () => {
    const project = createEmptyProject("Plane pitch");
    project.singlePitch = "4/12";
    project.points = [
      { id: "a", lat: 39, lng: -105 },
      { id: "b", lat: 39, lng: -104.9998 },
      { id: "c", lat: 39.0002, lng: -105 },
      { id: "d", lat: 39.0002, lng: -104.9998 },
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
      { id: "eave", type: "eave", startPointId: "b", endPointId: "d", lengthFeet: 10, groupId: "g1", createdAt: "", updatedAt: "" },
      { id: "second-rake", type: "rake", startPointId: "d", endPointId: "c", lengthFeet: 10, groupId: "g1", createdAt: "", updatedAt: "" },
      { id: "ridge", type: "ridge", startPointId: "c", endPointId: "a", lengthFeet: 10, groupId: "g1", createdAt: "", updatedAt: "" },
    ];
    project.planes = [
      {
        id: "p1",
        name: "Roof Plane 1",
        pointIds: ["a", "b", "d", "c"],
        pitch: "8/12",
        planAreaSqFt: 0,
        source: "auto",
      },
    ];

    expect(
      getProjectCalculationBreakdown(project).segments.find((segment) => segment.id === "rake")?.slopeAdjustedLengthFeet,
    ).toBeCloseTo(12.02, 2);
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
        pointIds: ["a", "b", "c", "d"],
        pitch: "6/12",
        planAreaSqFt: 100,
        source: "manual",
      },
    ];
    project.segments = [
      { id: "s1", type: "rake", startPointId: "a", endPointId: "b", lengthFeet: 10, groupId: "g1", createdAt: "", updatedAt: "" },
      { id: "s2", type: "eave", startPointId: "b", endPointId: "c", lengthFeet: 10, groupId: "g1", createdAt: "", updatedAt: "" },
      { id: "s3", type: "rake", startPointId: "c", endPointId: "d", lengthFeet: 10, groupId: "g1", createdAt: "", updatedAt: "" },
      { id: "s4", type: "ridge", startPointId: "d", endPointId: "a", lengthFeet: 10, groupId: "g1", createdAt: "", updatedAt: "" },
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
