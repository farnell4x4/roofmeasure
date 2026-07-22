import { calculateImageProjectTotals, type ImageProjectCalculations } from "@/lib/image-projects/calculations"
import { calculateProjectTotals } from "@/lib/measurement/calculations"
import type { ImageProject } from "@/types/image-projects"
import type { MeasurementType, Project, ProjectCalculations, UnitSystem } from "@/types/models"

export type ReportProject = Project | ImageProject
export type ReportCalculations = ProjectCalculations | ImageProjectCalculations
export type ReportLineType = MeasurementType | "unassigned"

export const REPORT_LINE_TYPES: Array<{ type: MeasurementType; label: string }> = [
  { type: "ridge", label: "Ridge" },
  { type: "hip", label: "Hip" },
  { type: "valley", label: "Valley" },
  { type: "rake", label: "Rake" },
  { type: "eave", label: "Eave" },
  { type: "wall", label: "Wall" },
]

export function isImageProject(project: ReportProject): project is ImageProject {
  return "kind" in project && project.kind === "image"
}

export function calculateReportTotals(project: ReportProject): ReportCalculations {
  return isImageProject(project) ? calculateImageProjectTotals(project) : calculateProjectTotals(project)
}

export function reportProjectLabel(project: ReportProject) {
  return isImageProject(project) ? project.name : project.location?.formattedAddress ?? project.name
}

export function reportUnitSystem(project: ReportProject): UnitSystem {
  return isImageProject(project) ? "imperial" : project.preferences.unitSystem
}

export function reportDisplayDecimalFeet(project: ReportProject) {
  return isImageProject(project) ? false : project.preferences.displayDecimalFeet
}

export function reportLineTypes(project: ReportProject, totals: ReportCalculations): Array<{ type: ReportLineType; label: string }> {
  if (isImageProject(project) && (totals as ImageProjectCalculations).unassignedLength > 0) {
    return [...REPORT_LINE_TYPES, { type: "unassigned", label: "Unassigned" }]
  }
  return REPORT_LINE_TYPES
}

export function reportLineLengths(totals: ReportCalculations, type: ReportLineType) {
  if (type === "unassigned") {
    const imageTotals = totals as ImageProjectCalculations
    return {
      measured: imageTotals.unassignedLength ?? 0,
      slopeAdjusted: imageTotals.unassignedSlopeAdjustedLength ?? 0,
    }
  }
  return { measured: totals.totals[type], slopeAdjusted: totals.slopeAdjustedTotals[type] }
}
