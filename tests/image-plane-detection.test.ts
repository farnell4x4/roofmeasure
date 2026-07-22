import { describe, expect, it } from "vitest"
import { detectImageRoofPlanes } from "@/lib/image-projects/plane-detection"
import type { ImageMeasurementSegment, ImagePoint } from "@/types/image-projects"

const points: ImagePoint[] = [
  { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
]

function segment(id: string, start: ImagePoint, end: ImagePoint): ImageMeasurementSegment {
  return { id, start, end, lengthFeet: 0 }
}

describe("image roof plane detection", () => {
  it("creates one blue-plane boundary only after the image lines close", () => {
    expect(detectImageRoofPlanes([segment("ab", points[0], points[1]), segment("bc", points[1], points[2])])).toEqual([])
    const planes = detectImageRoofPlanes([
      segment("ab", points[0], points[1]), segment("bc", points[1], points[2]),
      segment("cd", points[2], points[3]), segment("da", points[3], points[0]),
    ])
    expect(planes).toHaveLength(1)
  })
})
