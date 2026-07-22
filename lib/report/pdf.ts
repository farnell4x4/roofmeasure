import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib"
import { formatArea, formatLength } from "@/lib/measurement/units"
import {
  calculateReportTotals,
  isImageProject,
  reportDisplayDecimalFeet,
  reportLineLengths,
  reportLineTypes,
  reportProjectLabel,
  reportUnitSystem,
  type ReportCalculations,
  type ReportProject,
} from "@/lib/report/model"

export const REPORT_PDF_VERSION = 3

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const PAGE_MARGIN = 42
const WATERMARK_MARGIN = 72
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2
const DARK = rgb(0.122, 0.145, 0.133)
const WATERMARK_BLUE = rgb(0.286, 0.412, 0.898)
const MUTED = rgb(0.416, 0.447, 0.502)
const BORDER = rgb(0.847, 0.867, 0.898)
const OFF_WHITE = rgb(0.933, 0.945, 0.961)

export type CachedReportPdf = {
  filename: string
  generatedAt: string
  fingerprint: string
  pdf: ArrayBuffer
}

export function reportTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export function reportDownloadName(project: ReportProject) {
  const name = reportProjectLabel(project)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
  return `${name || "roof-report"}.pdf`
}

function reportFingerprintInput(project: ReportProject, totals: ReportCalculations) {
  const unitSystem = reportUnitSystem(project)
  const displayDecimalFeet = reportDisplayDecimalFeet(project)
  return {
    version: REPORT_PDF_VERSION,
    source: isImageProject(project) ? "image" : "map",
    label: reportProjectLabel(project),
    unitSystem,
    displayDecimalFeet,
    totals: {
      area: totals.totalSlopeAreaSqFt,
      squares: totals.totalSquares,
      measuredLength: totals.totalMeasuredLength,
      slopeAdjustedLength: totals.totalSlopeAdjustedLength,
      segmentCount: totals.segmentCount,
      byType: reportLineTypes(project, totals).map(({ type }) => ({
        type,
        ...reportLineLengths(totals, type),
      })),
    },
  }
}

export function buildReportPdfFingerprint(
  project: ReportProject,
  totals = calculateReportTotals(project),
) {
  return JSON.stringify(reportFingerprintInput(project, totals))
}

function pdfSafeText(value: string) {
  return value.replaceAll("²", "2").replaceAll("—", "-").replaceAll("–", "-")
}

function wrapText(value: string, font: PDFFont, size: number, maxWidth: number) {
  const words = pdfSafeText(value).split(/\s+/)
  const lines: string[] = []
  let line = ""

  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }

  if (line) lines.push(line)
  return lines.length ? lines : [""]
}

function drawWrappedText({
  page,
  text,
  x,
  y,
  maxWidth,
  font,
  size,
  lineHeight,
  color,
}: {
  page: PDFPage
  text: string
  x: number
  y: number
  maxWidth: number
  font: PDFFont
  size: number
  lineHeight: number
  color: ReturnType<typeof rgb>
}) {
  const lines = wrapText(text, font, size, maxWidth)
  lines.forEach((line, index) => {
    page.drawText(line, {
      x,
      y: y - index * lineHeight,
      size,
      font,
      color,
    })
  })
  return y - lines.length * lineHeight
}

export async function createReportPdf(
  project: ReportProject,
  totals = calculateReportTotals(project),
  generatedAt = new Date().toISOString(),
) {
  const document = await PDFDocument.create()
  document.setTitle(`Roof Tape Measure Report - ${reportProjectLabel(project)}`)
  document.setAuthor("RoofTapeMeasure.com")
  document.setSubject("Roof measurement report")
  document.setCreationDate(new Date(generatedAt))

  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  const label = pdfSafeText(reportProjectLabel(project))
  const unitSystem = reportUnitSystem(project)
  const displayDecimalFeet = reportDisplayDecimalFeet(project)

  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 164, width: PAGE_WIDTH, height: 164, color: DARK })
  page.drawText("ROOFTAPEMEASURE.COM", {
    x: PAGE_MARGIN,
    y: PAGE_HEIGHT - 70,
    size: 9,
    font: bold,
    color: rgb(0.725, 0.788, 1),
  })
  page.drawText("Roof Tape Measure Report", {
    x: PAGE_MARGIN,
    y: PAGE_HEIGHT - 98,
    size: 23,
    font: bold,
    color: rgb(1, 1, 1),
  })
  drawWrappedText({
    page,
    text: label,
    x: PAGE_MARGIN,
    y: PAGE_HEIGHT - 120,
    maxWidth: 335,
    font: regular,
    size: 10,
    lineHeight: 13,
    color: rgb(0.82, 0.84, 0.86),
  })
  page.drawText("GENERATED", {
    x: PAGE_WIDTH - PAGE_MARGIN - 86,
    y: PAGE_HEIGHT - 69,
    size: 8,
    font: bold,
    color: rgb(0.72, 0.75, 0.79),
  })
  page.drawText(pdfSafeText(reportTimestamp(generatedAt)), {
    x: PAGE_WIDTH - PAGE_MARGIN - 126,
    y: PAGE_HEIGHT - 86,
    size: 9,
    font: bold,
    color: rgb(1, 1, 1),
  })

  const summaryY = PAGE_HEIGHT - 198
  const summaryHeight = 64
  const summaryColumnWidth = CONTENT_WIDTH / 3
  const summaries = [
    ["TOTAL ROOFING AREA", formatArea(totals.totalSlopeAreaSqFt, unitSystem)],
    ["ROOFING SQUARES", totals.totalSquares.toFixed(2)],
    ["TOTAL LINEAR FOOTAGE", formatLength(totals.totalMeasuredLength, unitSystem, displayDecimalFeet)],
  ]
  page.drawRectangle({
    x: PAGE_MARGIN,
    y: summaryY - summaryHeight,
    width: CONTENT_WIDTH,
    height: summaryHeight,
    color: rgb(1, 1, 1),
    borderColor: BORDER,
    borderWidth: 1,
  })
  summaries.forEach(([heading, value], index) => {
    const x = PAGE_MARGIN + index * summaryColumnWidth
    if (index) {
      page.drawLine({
        start: { x, y: summaryY },
        end: { x, y: summaryY - summaryHeight },
        thickness: 1,
        color: BORDER,
      })
    }
    page.drawText(heading, { x: x + 13, y: summaryY - 21, size: 7, font: bold, color: MUTED })
    page.drawText(pdfSafeText(value), { x: x + 13, y: summaryY - 45, size: 15, font: bold, color: DARK })
  })

  const cardTop = summaryY - summaryHeight - 22
  const cardBottom = 142
  page.drawRectangle({
    x: PAGE_MARGIN,
    y: cardBottom,
    width: CONTENT_WIDTH,
    height: cardTop - cardBottom,
    color: rgb(1, 1, 1),
    borderColor: BORDER,
    borderWidth: 1,
  })
  page.drawText("Linear footage by type", { x: PAGE_MARGIN + 18, y: cardTop - 27, size: 14, font: bold, color: DARK })
  const measuredLineText = `${totals.segmentCount} measured ${totals.segmentCount === 1 ? "line" : "lines"}`
  page.drawText(measuredLineText, {
    x: PAGE_WIDTH - PAGE_MARGIN - 18 - regular.widthOfTextAtSize(measuredLineText, 8),
    y: cardTop - 25,
    size: 8,
    font: regular,
    color: MUTED,
  })

  const tableLeft = PAGE_MARGIN + 18
  const tableRight = PAGE_WIDTH - PAGE_MARGIN - 18
  const measuredX = PAGE_MARGIN + 326
  const adjustedX = tableRight
  const headerY = cardTop - 54
  page.drawRectangle({ x: tableLeft, y: headerY - 18, width: tableRight - tableLeft, height: 23, color: OFF_WHITE })
  page.drawText("LINE TYPE", { x: tableLeft + 8, y: headerY - 10, size: 7, font: bold, color: MUTED })
  const measuredTitle = "MEASURED"
  const slopeTitle = "SLOPE-ADJUSTED"
  page.drawText(measuredTitle, { x: measuredX - bold.widthOfTextAtSize(measuredTitle, 7), y: headerY - 10, size: 7, font: bold, color: MUTED })
  page.drawText(slopeTitle, { x: adjustedX - bold.widthOfTextAtSize(slopeTitle, 7), y: headerY - 10, size: 7, font: bold, color: MUTED })

  let rowY = headerY - 37
  const drawRow = (name: string, measured: string, adjusted: string, isTotal = false) => {
    page.drawText(name, { x: tableLeft + 8, y: rowY, size: 9, font: isTotal ? bold : regular, color: DARK })
    page.drawText(pdfSafeText(measured), {
      x: measuredX - (isTotal ? bold : regular).widthOfTextAtSize(pdfSafeText(measured), 9),
      y: rowY,
      size: 9,
      font: isTotal ? bold : regular,
      color: DARK,
    })
    page.drawText(pdfSafeText(adjusted), {
      x: adjustedX - (isTotal ? bold : regular).widthOfTextAtSize(pdfSafeText(adjusted), 9),
      y: rowY,
      size: 9,
      font: isTotal ? bold : regular,
      color: DARK,
    })
    page.drawLine({ start: { x: tableLeft, y: rowY - 9 }, end: { x: tableRight, y: rowY - 9 }, thickness: 0.5, color: BORDER })
    rowY -= 24
  }

  reportLineTypes(project, totals).forEach(({ type, label: rowLabel }) => {
    const lengths = reportLineLengths(totals, type)
    drawRow(
      rowLabel,
      formatLength(lengths.measured, unitSystem, displayDecimalFeet),
      formatLength(lengths.slopeAdjusted, unitSystem, displayDecimalFeet),
    )
  })
  drawRow(
    "Total",
    formatLength(totals.totalMeasuredLength, unitSystem, displayDecimalFeet),
    formatLength(totals.totalSlopeAdjustedLength, unitSystem, displayDecimalFeet),
    true,
  )

  page.drawLine({ start: { x: PAGE_MARGIN, y: 112 }, end: { x: PAGE_WIDTH - PAGE_MARGIN, y: 112 }, thickness: 0.75, color: BORDER })
  page.drawText("Report generously provided by RoofTapeMeasure.com - Double check for accuracy.", {
    x: PAGE_MARGIN,
    y: 91,
    size: 8,
    font: regular,
    color: MUTED,
  })
  page.drawText(label, {
    x: PAGE_WIDTH - PAGE_MARGIN - regular.widthOfTextAtSize(label, 8),
    y: 76,
    size: 8,
    font: regular,
    color: MUTED,
  })

  // Draw this last so the disclosure remains visible over every report section.
  const watermarkText = "Report generously provided by RoofTapeMeasure.com - Double check for accuracy"
  const watermarkStart = { x: WATERMARK_MARGIN, y: WATERMARK_MARGIN }
  const watermarkEnd = {
    x: PAGE_WIDTH - WATERMARK_MARGIN,
    y: PAGE_HEIGHT - WATERMARK_MARGIN,
  }
  const watermarkLength = Math.hypot(
    watermarkEnd.x - watermarkStart.x,
    watermarkEnd.y - watermarkStart.y,
  )
  const watermarkAngle = Math.atan2(
    watermarkEnd.y - watermarkStart.y,
    watermarkEnd.x - watermarkStart.x,
  ) * 180 / Math.PI
  const watermarkSize = watermarkLength / bold.widthOfTextAtSize(watermarkText, 1)
  page.drawText(watermarkText, {
    x: watermarkStart.x,
    y: watermarkStart.y,
    size: watermarkSize,
    font: bold,
    color: WATERMARK_BLUE,
    opacity: 0.13,
    rotate: degrees(watermarkAngle),
  })

  return document.save()
}

export async function createCachedReportPdf(project: ReportProject, totals = calculateReportTotals(project)) {
  const generatedAt = new Date().toISOString()
  const bytes = await createReportPdf(project, totals, generatedAt)
  return {
    filename: reportDownloadName(project),
    generatedAt,
    fingerprint: buildReportPdfFingerprint(project, totals),
    pdf: new Uint8Array(bytes).buffer,
  } satisfies CachedReportPdf
}
