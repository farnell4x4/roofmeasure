import { describe, expect, it } from "vitest"
import { calculateImageProjectTotals } from "@/lib/image-projects/calculations"
import type { ImageProject } from "@/types/image-projects"

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
  it("uses entered image-line lengths and applies a completed plane pitch", () => {
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
    expect(totals.slopeAdjustedTotals.rake).toBeCloseTo(36 * Math.sqrt(1.25), 10)
    expect(totals.totalMeasuredLength).toBe(166)
    expect(totals.totalPlanAreaSqFt).toBe(1170)
    expect(totals.totalSlopeAreaSqFt).toBeCloseTo(1170 * Math.sqrt(1.25), 10)
  })

  it("keeps untyped image lines visible in the report total", () => {
    const project = createImageProject()
    project.segments = [{ id: "untyped", start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, lengthFeet: 24 }]

    const totals = calculateImageProjectTotals(project)

    expect(totals.unassignedLength).toBe(24)
    expect(totals.totalMeasuredLength).toBe(24)
    expect(totals.totalSlopeAdjustedLength).toBe(24)
  })
})
