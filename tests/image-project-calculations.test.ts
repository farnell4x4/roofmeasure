import { describe, expect, it } from "vitest"
import { calculateImageProjectTotals } from "@/lib/image-projects/calculations"
import { imagePointKey, type ImageProject } from "@/types/image-projects"

function createImageProject(): ImageProject {
  return {
    id: "image-project",
    schemaVersion: 1,
    kind: "image",
    name: "Roof photo",
    image: new Blob(),
    imageName: "roof.jpg",
    imageWidth: 1000,
    imageHeight: 800,
    segments: [],
    pendingLineStart: null,
    planes: [],
    singlePitch: "6/12",
    createdAt: "",
    updatedAt: "",
    lastOpenedAt: "",
  }
}

describe("image project totals", () => {
  it("uses entered image-line lengths without applying the optional plane pitch", () => {
    const project = createImageProject()
    project.segments = [
      { id: "rake-a", type: "rake", start: { x: 0, y: 0 }, end: { x: 18, y: 0 }, lengthFeet: 18 },
      { id: "eave", type: "eave", start: { x: 18, y: 0 }, end: { x: 18, y: 65 }, lengthFeet: 65 },
      { id: "rake-b", type: "rake", start: { x: 18, y: 65 }, end: { x: 0, y: 65 }, lengthFeet: 18 },
      { id: "ridge", type: "ridge", start: { x: 0, y: 65 }, end: { x: 0, y: 0 }, lengthFeet: 65 },
    ]
    project.planes = [{ id: "plane", pointKeys: ["0:0", "18:0", "18:65", "0:65"], pitch: "6/12" }]

    const totals = calculateImageProjectTotals(project)

    expect(totals.totals.rake).toBe(36)
    expect(totals.slopeAdjustedTotals.rake).toBe(36)
    expect(totals.totalMeasuredLength).toBe(166)
    expect(totals.totalPlanAreaSqFt).toBe(1170)
    expect(totals.totalSlopeAreaSqFt).toBe(1170)
    expect(totals.planeSquaresById.plane).toBeCloseTo(
      11.7,
      10,
    )
  })

  it("keeps untyped image lines visible in the report total", () => {
    const project = createImageProject()
    project.segments = [{ id: "untyped", start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, lengthFeet: 24 }]

    const totals = calculateImageProjectTotals(project)

    expect(totals.unassignedLength).toBe(24)
    expect(totals.totalMeasuredLength).toBe(24)
    expect(totals.totalSlopeAdjustedLength).toBe(24)
  })

  it("counts nested image planes once", () => {
    const project = createImageProject()
    const square = (id: string, left: number, top: number, size: number) => {
      const a = { x: left, y: top }
      const b = { x: left + size, y: top }
      const c = { x: left + size, y: top + size }
      const d = { x: left, y: top + size }
      project.segments.push(
        { id: `${id}-ab`, type: "eave", start: a, end: b, lengthFeet: size },
        { id: `${id}-bc`, type: "rake", start: b, end: c, lengthFeet: size },
        { id: `${id}-cd`, type: "ridge", start: c, end: d, lengthFeet: size },
        { id: `${id}-da`, type: "rake", start: d, end: a, lengthFeet: size },
      )
      project.planes.push({
        id,
        pointKeys: [imagePointKey(a), imagePointKey(b), imagePointKey(c), imagePointKey(d)],
      })
    }
    square("outer", 0, 0, 100)
    square("middle", 20, 20, 60)
    square("inner", 40, 40, 20)

    const totals = calculateImageProjectTotals(project)

    expect(totals.totalPlanAreaSqFt).toBe(10_000)
    expect(totals.totalSlopeAreaSqFt).toBe(10_000)
    expect(totals.planeSquaresById).toMatchObject({
      outer: 64,
      middle: 32,
      inner: 4,
    })
  })
})
