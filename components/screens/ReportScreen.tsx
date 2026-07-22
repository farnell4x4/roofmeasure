"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { db } from "@/lib/persistence/db"
import { calculateProjectTotals } from "@/lib/measurement/calculations"
import { formatArea, formatLength } from "@/lib/measurement/units"
import { MeasurementType, Project } from "@/types/models"

const REPORT_LINE_TYPES: Array<{ type: MeasurementType; label: string }> = [
  { type: "ridge", label: "Ridge" },
  { type: "hip", label: "Hip" },
  { type: "valley", label: "Valley" },
  { type: "rake", label: "Rake" },
  { type: "eave", label: "Eave" },
  { type: "wall", label: "Wall" },
]

function reportTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function downloadName(project: Project) {
  const name = (project.location?.formattedAddress ?? project.name)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
  return `${name || "roof-report"}.pdf`
}

export function ReportScreen() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [project, setProject] = useState<Project | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [generatedAt] = useState(() => new Date().toISOString())

  useEffect(() => {
    document.documentElement.classList.add("report-page-active")
    document.body.classList.add("report-page-active")
    return () => {
      document.documentElement.classList.remove("report-page-active")
      document.body.classList.remove("report-page-active")
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const projectId = searchParams.get("projectId")

    void (async () => {
      const nextProject = projectId
        ? await db.getProject(projectId)
        : await db.getMostRecentProject()
      if (cancelled) return
      setProject(nextProject ?? null)
      setIsLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [searchParams])

  const totals = useMemo(
    () => (project ? calculateProjectTotals(project) : null),
    [project],
  )

  function printReport() {
    window.print()
  }

  function emailReport() {
    if (!project || !totals) return
    const subject = `Roof report — ${project.location?.formattedAddress ?? project.name}`
    const body = [
      `Roof report for ${project.location?.formattedAddress ?? project.name}`,
      `Roofing area: ${formatArea(totals.totalSlopeAreaSqFt, project.preferences.unitSystem)}`,
      `Roofing squares: ${totals.totalSquares.toFixed(2)}`,
      "",
      "Double check all measurements for accuracy.",
    ].join("\n")
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  if (isLoading) {
    return <main className="report-page"><p>Loading report…</p></main>
  }

  if (!project || !totals) {
    return (
      <main className="report-page">
        <section className="report-card report-section">
          <h1>Report unavailable</h1>
          <p>That saved project could not be found on this device.</p>
          <button className="no-print report-button report-button--dark" type="button" onClick={() => router.push("/")}>Back to map</button>
        </section>
      </main>
    )
  }

  const projectLabel = project.location?.formattedAddress ?? project.name

  return (
    <main className="report-page">
      <div className="report-watermark" aria-hidden="true">
        Report generously provided by RoofTapeMeasure.com — Double check for accuracy
      </div>
      <div className="report-content">
        <header className="report-header report-section">
          <div>
            <p className="report-eyebrow">RoofTapeMeasure.com</p>
            <h1>Roof Tape Measure Report</h1>
            <p>{projectLabel}</p>
          </div>
          <div className="report-timestamp">
            <span>Generated</span>
            <strong>{reportTimestamp(generatedAt)}</strong>
          </div>
        </header>

        <section className="report-summary report-section">
          <div>
            <span>Total roofing area</span>
            <strong>{formatArea(totals.totalSlopeAreaSqFt, project.preferences.unitSystem)}</strong>
          </div>
          <div>
            <span>Roofing squares</span>
            <strong>{totals.totalSquares.toFixed(2)}</strong>
          </div>
          <div>
            <span>Total linear footage</span>
            <strong>{formatLength(totals.totalMeasuredLength, project.preferences.unitSystem, project.preferences.displayDecimalFeet)}</strong>
          </div>
        </section>

        <section className="report-card report-section">
          <div className="report-section-heading">
            <h2>Linear footage by type</h2>
            <span>{totals.segmentCount} measured lines</span>
          </div>
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Line type</th>
                  <th>Measured</th>
                  <th>Slope-adjusted</th>
                </tr>
              </thead>
              <tbody>
                {REPORT_LINE_TYPES.map(({ type, label }) => (
                  <tr key={type}>
                    <td>{label}</td>
                    <td>{formatLength(totals.totals[type], project.preferences.unitSystem, project.preferences.displayDecimalFeet)}</td>
                    <td>{formatLength(totals.slopeAdjustedTotals[type], project.preferences.unitSystem, project.preferences.displayDecimalFeet)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th>{formatLength(totals.totalMeasuredLength, project.preferences.unitSystem, project.preferences.displayDecimalFeet)}</th>
                  <th>{formatLength(totals.totalSlopeAdjustedLength, project.preferences.unitSystem, project.preferences.displayDecimalFeet)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <footer className="report-footer report-section">
          <p>Report generously provided by RoofTapeMeasure.com — Double check for accuracy.</p>
          <p>{project.location?.formattedAddress ?? project.name}</p>
        </footer>

        <div className="report-actions no-print">
          <button className="report-button report-button--quiet" type="button" onClick={() => router.push(`/?projectId=${project.id}`)}>Back to map</button>
          <button className="report-button report-button--quiet" type="button" onClick={emailReport}>Email</button>
          <button className="report-button report-button--quiet" type="button" onClick={printReport}>Download PDF</button>
          <button className="report-button report-button--dark" type="button" onClick={printReport}>Print</button>
        </div>
        <span className="no-print report-download-note">Choose “Save as PDF” in the browser print dialog to download {downloadName(project)}.</span>
      </div>
    </main>
  )
}
