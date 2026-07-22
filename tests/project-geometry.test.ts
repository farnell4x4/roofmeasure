import { describe, expect, it } from "vitest";
import { fromProjectMeasurementData, measurementPointKey, toProjectMeasurementData } from "@/lib/measurement/project-geometry";
import { createEmptyProject } from "@/lib/projects/project-factory";

describe("project measurement geometry", () => {
  it("round-trips saved segments and a pending point", () => {
    const segmentAStart = { latitude: 39.1000001, longitude: -105.2000001 };
    const segmentAEnd = { latitude: 39.1005, longitude: -105.2005 };
    const segmentBEnd = { latitude: 39.101, longitude: -105.201 };
    const pendingPoint = { latitude: 39.1015, longitude: -105.2015 };

    const geometry = toProjectMeasurementData(
      [
        { id: "segment-a", start: segmentAStart, end: segmentAEnd },
        { id: "segment-b", start: segmentAEnd, end: segmentBEnd }
      ],
      pendingPoint
    );

    const project = createEmptyProject("Roof 1");
    project.points = geometry.points;
    project.segments = geometry.segments;

    const hydrated = fromProjectMeasurementData(project);

    expect(hydrated.segments).toHaveLength(2);
    expect(hydrated.segments[0]).toEqual({
      id: "segment-a",
      start: segmentAStart,
      end: segmentAEnd
    });
    expect(hydrated.segments[1]).toEqual({
      id: "segment-b",
      start: segmentAEnd,
      end: segmentBEnd
    });
    expect(hydrated.pendingLineStart).toEqual(pendingPoint);
  });

  it("uses the latest orphan point when older stray points exist", () => {
    const segmentStart = { latitude: 39.2, longitude: -105.3 };
    const segmentEnd = { latitude: 39.21, longitude: -105.31 };
    const oldOrphan = { latitude: 39.19, longitude: -105.29 };
    const latestOrphan = { latitude: 39.22, longitude: -105.32 };
    const geometry = toProjectMeasurementData([{ id: "segment-a", start: segmentStart, end: segmentEnd }], latestOrphan);

    const project = createEmptyProject("Roof 2");
    project.points = [
      {
        id: measurementPointKey(oldOrphan),
        lat: oldOrphan.latitude,
        lng: oldOrphan.longitude
      },
      ...geometry.points
    ];
    project.segments = geometry.segments;

    const hydrated = fromProjectMeasurementData(project);

    expect(hydrated.pendingLineStart).toEqual(latestOrphan);
  });

  it("prefers canonical saved measurement geometry when present", () => {
    const canonicalStart = { latitude: 40.1, longitude: -104.1 };
    const canonicalEnd = { latitude: 40.2, longitude: -104.2 };
    const project = createEmptyProject("Roof 3");
    project.points = [];
    project.segments = [];
    project.measurementGeometry = {
      segments: [{ id: "segment-canonical", start: canonicalStart, end: canonicalEnd }],
      pendingLineStart: canonicalEnd
    };

    const hydrated = fromProjectMeasurementData(project);

    expect(hydrated.segments).toEqual([
      {
        id: "segment-canonical",
        start: canonicalStart,
        end: canonicalEnd
      }
    ]);
    expect(hydrated.pendingLineStart).toEqual(canonicalEnd);
  });
});
