import { describe, expect, it } from "vitest";
import { calculateProjectTotals } from "@/lib/calculations";
import { createEmptyProject } from "@/lib/project-factory";

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
});
