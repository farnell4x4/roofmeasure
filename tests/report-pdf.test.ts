import { describe, expect, it } from "vitest"
import {
  buildReportPdfFingerprint,
  createCachedReportPdf,
} from "@/lib/report/pdf"
import { calculateProjectTotals } from "@/lib/measurement/calculations"
import { createEmptyProject } from "@/lib/projects/project-factory"
import { createImageProject } from "@/lib/image-projects/factory"
import { calculateImageProjectTotals } from "@/lib/image-projects/calculations"

describe("report PDF", () => {
  it("creates a valid PDF with a stable cache fingerprint", async () => {
    const project = createEmptyProject("123 Main Street")
    const totals = calculateProjectTotals(project)
    const report = await createCachedReportPdf(project, totals)

    expect(report.filename).toBe("123-main-street.pdf")
    expect(new TextDecoder().decode(new Uint8Array(report.pdf).slice(0, 5))).toBe("%PDF-")
    expect(report.fingerprint).toBe(buildReportPdfFingerprint(project, totals))
  })

  it("changes the cache fingerprint when reported measurements change", () => {
    const project = createEmptyProject("Roof")
    const before = buildReportPdfFingerprint(project)
    project.segments = [{
      id: "eave",
      type: "eave",
      startPointId: "a",
      endPointId: "b",
      lengthFeet: 24,
      groupId: "group",
      createdAt: "",
      updatedAt: "",
    }]

    expect(buildReportPdfFingerprint(project)).not.toBe(before)
  })

  it("creates a PDF for an image project without inventing roof area", async () => {
    const project = createImageProject(new File(["image"], "123 Main Roof.jpg", { type: "image/jpeg" }), 1200, 800)
    project.segments = [{ id: "eave", type: "eave", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, lengthFeet: 24 }]
    const totals = calculateImageProjectTotals(project)
    const report = await createCachedReportPdf(project, totals)

    expect(report.filename).toBe("123-main-roof.pdf")
    expect(new TextDecoder().decode(new Uint8Array(report.pdf).slice(0, 5))).toBe("%PDF-")
    expect(report.fingerprint).toBe(buildReportPdfFingerprint(project, totals))
  })
})
