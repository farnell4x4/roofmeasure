import { describe, expect, it } from "vitest"
import { detectRoofPlanes } from "@/lib/measurement/plane-detection"
import { toProjectMeasurementData } from "@/lib/measurement/project-geometry"
import {
  snapPointToMeasurementLine,
  splitMeasurementSegmentsAtKnownPoints,
} from "@/lib/measurement/snapping"

describe("measurement snapping", () => {
  const baseLine = {
    id: "base",
    start: { latitude: 39, longitude: -105 },
    end: { latitude: 39, longitude: -104.9998 },
  }

  it("snaps a point within one foot to a line", () => {
    const snapped = snapPointToMeasurementLine(
      { latitude: 39.000001, longitude: -104.9999 },
      [baseLine],
    )

    expect(snapped.latitude).toBeCloseTo(39, 7)
    expect(snapped.longitude).toBeCloseTo(-104.9999, 7)
  })

  it("splits a touched boundary so the enclosed face can be detected", () => {
    const topMidpoint = { latitude: 39.0002, longitude: -104.9999 }
    const segments = splitMeasurementSegmentsAtKnownPoints(
      [
        { id: "ab", start: { latitude: 39, longitude: -105 }, end: { latitude: 39, longitude: -104.9998 } },
        { id: "bc", start: { latitude: 39, longitude: -104.9998 }, end: { latitude: 39.0002, longitude: -104.9998 } },
        { id: "cd", start: { latitude: 39.0002, longitude: -104.9998 }, end: { latitude: 39.0002, longitude: -105 } },
        { id: "da", start: { latitude: 39.0002, longitude: -105 }, end: { latitude: 39, longitude: -105 } },
        { id: "ma", start: topMidpoint, end: { latitude: 39, longitude: -105 } },
      ],
      [topMidpoint],
    )
    const projectData = toProjectMeasurementData(segments)

    expect(segments).toHaveLength(6)
    expect(detectRoofPlanes(projectData.points, projectData.segments)).toHaveLength(2)
  })
})
