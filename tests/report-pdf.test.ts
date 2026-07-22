import { describe, expect, it } from "vitest"
import {
  buildReportPdfFingerprint,
  createCachedReportPdf,
} from "@/lib/report/pdf"
import { calculateProjectTotals } from "@/lib/measurement/calculations"
import { createEmptyProject } from "@/lib/projects/project-factory"

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
})
