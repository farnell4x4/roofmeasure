import { describe, expect, it } from "vitest"
import { detectRoofPlanes } from "@/lib/measurement/plane-detection"
import { GeographicPoint, MeasurementSegment } from "@/types/models"

const points: GeographicPoint[] = [
  { id: "a", lat: 39, lng: -105 },
  { id: "b", lat: 39, lng: -104.9998 },
  { id: "c", lat: 39.0002, lng: -104.9998 },
  { id: "d", lat: 39.0002, lng: -105 },
]

function segment(id: string, startPointId: string, endPointId: string): MeasurementSegment {
  return {
    id,
    startPointId,
    endPointId,
    type: "eave",
    lengthFeet: 0,
    groupId: "test",
    createdAt: "",
    updatedAt: "",
  }
}

describe("roof plane detection", () => {
  it("detects a plane only after its boundary is closed", () => {
    expect(
      detectRoofPlanes(points, [
        segment("ab", "a", "b"),
        segment("bc", "b", "c"),
        segment("cd", "c", "d"),
      ]),
    ).toEqual([])

    const planes = detectRoofPlanes(points, [
      segment("ab", "a", "b"),
      segment("bc", "b", "c"),
      segment("cd", "c", "d"),
      segment("da", "d", "a"),
    ])
    expect(planes).toHaveLength(1)
    expect(planes[0].planAreaSqFt).toBeGreaterThan(100)
  })

  it("keeps a plane pitch when the same boundary is re-detected", () => {
    const boundary = [
      segment("ab", "a", "b"),
      segment("bc", "b", "c"),
      segment("cd", "c", "d"),
      segment("da", "d", "a"),
    ]
    const first = detectRoofPlanes(points, boundary)
    const redetected = detectRoofPlanes(points, boundary, [
      { ...first[0], pitch: "6/12" },
    ])

    expect(redetected[0].pitch).toBe("6/12")
  })

  it("splits a closed roof into separate planes when an interior line is added", () => {
    const planes = detectRoofPlanes(points, [
      segment("ab", "a", "b"),
      segment("bc", "b", "c"),
      segment("cd", "c", "d"),
      segment("da", "d", "a"),
      segment("ac", "a", "c"),
    ])

    expect(planes).toHaveLength(2)
  })
})
