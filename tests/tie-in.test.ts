import { describe, expect, it } from "vitest"
import { createTieInSegment } from "@/lib/measurement/tie-in"

describe("tie-in measurements", () => {
  const anchor = { latitude: 41.8254, longitude: -84.5264 }
  const nextPoint = { latitude: 41.8255, longitude: -84.5265 }

  it("connects the latest point to the selected Come To point", () => {
    expect(createTieInSegment(anchor, nextPoint, "to-1")).toEqual({
      id: "to-1",
      start: anchor,
      end: nextPoint,
    })
  })

  it("starts a Come From line at the selected point", () => {
    expect(createTieInSegment(anchor, nextPoint, "from-1")).toEqual({
      id: "from-1",
      start: anchor,
      end: nextPoint,
    })
  })

  it("allows repeated connections at the exact same coordinate", () => {
    expect(createTieInSegment(anchor, anchor, "same")).toEqual({
      id: "same",
      start: anchor,
      end: anchor,
    })
  })
})
