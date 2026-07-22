import { describe, expect, it } from "vitest"
import {
  imageSnapTolerance,
  snapImagePointToMeasurementLine,
  splitImageMeasurementSegmentsAtKnownPoints,
} from "@/lib/image-projects/snapping"

const baseLine = {
  id: "base",
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  lengthFeet: 40,
}

describe("image measurement snapping", () => {
  it("uses an image-relative tolerance with a touch-friendly minimum", () => {
    expect(imageSnapTolerance(800, 600)).toBe(6)
    expect(imageSnapTolerance(4000, 3000)).toBe(7.5)
  })

  it("snaps a point within tolerance to the nearest position on a line", () => {
    const snapped = snapImagePointToMeasurementLine(
      { x: 50, y: 5 },
      [baseLine],
      800,
      600,
    )

    expect(snapped).toEqual({ x: 50, y: 0 })
  })

  it("splits a snapped line so the shared point becomes a real plane vertex", () => {
    const split = splitImageMeasurementSegmentsAtKnownPoints(
      [baseLine],
      [baseLine.start, baseLine.end, { x: 25, y: 0 }],
    )

    expect(split).toEqual([
      expect.objectContaining({ id: "base:split:1", start: { x: 0, y: 0 }, end: { x: 25, y: 0 }, lengthFeet: 10 }),
      expect.objectContaining({ id: "base:split:2", start: { x: 25, y: 0 }, end: { x: 100, y: 0 }, lengthFeet: 30 }),
    ])
  })
})
