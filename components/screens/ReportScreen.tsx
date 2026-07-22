"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { db } from "@/lib/persistence/db"
import { formatArea, formatLength } from "@/lib/measurement/units"
import {
  buildReportPdfFingerprint,
  createCachedReportPdf,
  reportTimestamp,
} from "@/lib/report/pdf"
import {
  calculateReportTotals,
  isImageProject,
  reportDisplayDecimalFeet,
  reportLineLengths,
  reportLineTypes,
  reportProjectLabel,
  reportUnitSystem,
  type ReportProject,
} from "@/lib/report/model"

type ReportPdfState =
  | { status: "preparing" }
  | { status: "ready"; file: File; generatedAt: string }
  | { status: "error"; message: string }

function isShareSupported(file: File) {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return false
  }
  try {
    return typeof navigator.canShare !== "function" || navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = file.name
  anchor.style.display = "none"
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export function ReportScreen() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [project, setProject] = useState<ReportProject | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [generatedAt] = useState(() => new Date().toISOString())
  const [pdfState, setPdfState] = useState<ReportPdfState>({ status: "preparing" })
  const [canShareReport, setCanShareReport] = useState(false)
  const [shareMessage, setShareMessage] = useState<string | null>(null)

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
    const isImageReport = searchParams.get("projectType") === "image"

    void (async () => {
      const nextProject = projectId && isImageReport
        ? await db.getImageProject(projectId)
        : projectId
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
    () => (project ? calculateReportTotals(project) : null),
    [project],
  )

  useEffect(() => {
    let cancelled = false

    if (!project || !totals) {
      setPdfState({ status: "preparing" })
      setCanShareReport(false)
      return () => {
        cancelled = true
      }
    }

    const fingerprint = buildReportPdfFingerprint(project, totals)
    setPdfState({ status: "preparing" })
    setCanShareReport(false)
    setShareMessage(null)

    void (async () => {
      try {
        const cached = await db.getReportPdf(project.id, fingerprint)
        const report = cached ?? await createCachedReportPdf(project, totals)
        if (!cached) await db.saveReportPdf(project.id, report)
        if (cancelled) return

        const file = new File([report.pdf], report.filename, {
          type: "application/pdf",
          lastModified: new Date(report.generatedAt).getTime(),
        })
        setPdfState({ status: "ready", file, generatedAt: report.generatedAt })
        setCanShareReport(isShareSupported(file))
      } catch {
        if (!cancelled) {
          setPdfState({
            status: "error",
            message: "Could not prepare the PDF. You can still print this report.",
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [project, totals])

  function printReport() {
    window.print()
  }

  async function shareReport() {
    if (pdfState.status !== "ready" || !project) return
    setShareMessage(null)

    try {
      await navigator.share({
        title: `Roof report - ${reportProjectLabel(project)}`,
        files: [pdfState.file],
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      setShareMessage("Could not open sharing. Download the PDF instead.")
    }
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
          <button className="no-print report-button report-button--dark" type="button" onClick={() => router.push("/projects")}>Back to projects</button>
        </section>
      </main>
    )
  }

  const imageProject = isImageProject(project)
  const projectLabel = reportProjectLabel(project)
  const unitSystem = reportUnitSystem(project)
  const displayDecimalFeet = reportDisplayDecimalFeet(project)
  const lineTypes = reportLineTypes(project, totals)

  return (
    <main className="report-page">
      <div className="report-watermark" aria-hidden="true">
        Report generously provided by RoofTapeMeasure.com — Double check for accuracy
      </div>
      <div className="report-content">
        <header className="report-header report-section">
          <div>
            <p className="report-eyebrow">RoofTapeMeasure.com{imageProject ? " · Image project" : ""}</p>
            <h1>Roof Tape Measure Report</h1>
            <p>{projectLabel}</p>
          </div>
          <div className="report-timestamp">
            <span>Generated</span>
            <strong>{reportTimestamp(pdfState.status === "ready" ? pdfState.generatedAt : generatedAt)}</strong>
          </div>
        </header>

        <section className="report-summary report-section">
          <div>
            <span>Total roofing area</span>
            <strong>{formatArea(totals.totalSlopeAreaSqFt, unitSystem)}</strong>
          </div>
          <div>
            <span>Roofing squares</span>
            <strong>{totals.totalSquares.toFixed(2)}</strong>
          </div>
          <div>
            <span>Total linear footage</span>
            <strong>{formatLength(totals.totalMeasuredLength, unitSystem, displayDecimalFeet)}</strong>
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
                {lineTypes.map(({ type, label }) => {
                  const lengths = reportLineLengths(totals, type)
                  return <tr key={type}>
                    <td>{label}</td>
                    <td>{formatLength(lengths.measured, unitSystem, displayDecimalFeet)}</td>
                    <td>{formatLength(lengths.slopeAdjusted, unitSystem, displayDecimalFeet)}</td>
                  </tr>
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th>{formatLength(totals.totalMeasuredLength, unitSystem, displayDecimalFeet)}</th>
                  <th>{formatLength(totals.totalSlopeAdjustedLength, unitSystem, displayDecimalFeet)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <footer className="report-footer report-section">
          <p>Report generously provided by RoofTapeMeasure.com — Double check for accuracy.</p>
          <p>{projectLabel}</p>
        </footer>

        <div className="report-actions no-print">
          <button className="report-button report-button--quiet" type="button" onClick={() => router.push(imageProject ? `/image?projectId=${project.id}` : `/?projectId=${project.id}`)}>{imageProject ? "Back to image" : "Back to map"}</button>
          {canShareReport ? <button className="report-button report-button--quiet" type="button" onClick={() => void shareReport()}>Share report</button> : null}
          <button className="report-button report-button--quiet" type="button" disabled={pdfState.status !== "ready"} onClick={() => pdfState.status === "ready" && downloadFile(pdfState.file)}>{pdfState.status === "preparing" ? "Preparing PDF..." : "Download PDF"}</button>
          <button className="report-button report-button--dark" type="button" onClick={printReport}>Print</button>
        </div>
        <span className="no-print report-download-note">
          {pdfState.status === "ready" && canShareReport
            ? "Share opens your device share sheet with the PDF attached."
            : "Download saves a PDF on this device; Print opens the browser print dialog."}
        </span>
        {pdfState.status === "error" ? <p className="no-print report-action-message" role="status">{pdfState.message}</p> : null}
        {shareMessage ? <p className="no-print report-action-message" role="status">{shareMessage}</p> : null}
      </div>
    </main>
  )
}
