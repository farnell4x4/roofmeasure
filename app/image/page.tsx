"use client"

import { FileImage, FileText, Minus, Plus, RotateCcw, Settings } from "lucide-react"
import { ChangeEvent, PointerEvent as ReactPointerEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState, WheelEvent as ReactWheelEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { db } from "@/lib/persistence/db"
import { detectImageRoofPlanes } from "@/lib/image-projects/plane-detection"
import { createImageProject, readImageDimensions } from "@/lib/image-projects/factory"
import { snapImagePointToMeasurementLine, splitImageMeasurementSegmentsAtKnownPoints } from "@/lib/image-projects/snapping"
import { MEASUREMENT_TYPES } from "@/lib/measurement/constants"
import { roundMeasurement } from "@/lib/measurement/rounding"
import type { MeasurementType } from "@/types/models"
import { imagePointKey, type ImageMeasurementSegment, type ImagePoint, type ImageProject } from "@/types/image-projects"

type Anchor = { x: number; y: number }
type PointMenu = { point: ImagePoint; anchor: Anchor }
type LineMenu = { segmentId: string; anchor: Anchor }
type PitchMenu = { planeId: string; anchor: Anchor; draft: string }
type ImageBounds = { left: number; top: number; width: number; height: number }
type ImageZoom = { scale: number; offsetX: number; offsetY: number }

const buttonStyle = { border: 0, borderRadius: 12, padding: "10px 12px", cursor: "pointer" } as const
const popupStyle = { zIndex: 5, display: "grid", gap: 8, width: 160, padding: 12, borderRadius: 16, background: "rgba(255,255,255,.97)", border: "1px solid rgba(31,37,34,.12)", boxShadow: "0 14px 50px rgba(20,24,22,.16)" } as const
const MAX_IMAGE_ZOOM = 5

function labelForLength(length: number, type?: MeasurementType) {
  if (!Number.isFinite(length) || length <= 0) return "Set ft"
  const typeLetter = type === "ridge" ? "R" : type ? type.charAt(0) : ""
  return `${roundMeasurement(length)}'${typeLetter}`
}

export default function ImageProjectRoute() {
  return <Suspense fallback={null}><ImageProjectScreen /></Suspense>
}

function ImageProjectScreen() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const projectId = searchParams.get("projectId")
  const requestedNew = searchParams.get("new") === "1"
  const stageRef = useRef<HTMLDivElement | null>(null)
  const imageProjectRef = useRef<ImageProject | null>(null)
  const saveChain = useRef(Promise.resolve())
  const pointDrag = useRef<{ pointerId: number; key: string } | null>(null)
  const imageZoomRef = useRef<ImageZoom>({ scale: 1, offsetX: 0, offsetY: 0 })
  const canvasPointers = useRef(new Map<number, { x: number; y: number }>())
  const canvasGesture = useRef<{ distance: number; startScale: number; baseMidpoint: { x: number; y: number } } | null>(null)
  const canvasPan = useRef<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number; moved: boolean } | null>(null)
  const ignoreNextStageClick = useRef(false)
  const [project, setProject] = useState<ImageProject | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [isLoading, setIsLoading] = useState(Boolean(projectId) && !requestedNew)
  const [message, setMessage] = useState("")
  const [decision, setDecision] = useState<{ point: ImagePoint; anchor: Anchor } | null>(null)
  const [pointMenu, setPointMenu] = useState<PointMenu | null>(null)
  const [lineMenu, setLineMenu] = useState<LineMenu | null>(null)
  const [pitchMenu, setPitchMenu] = useState<PitchMenu | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [comeFromArmed, setComeFromArmed] = useState(false)
  const [imageZoom, setImageZoom] = useState<ImageZoom>({ scale: 1, offsetX: 0, offsetY: 0 })

  const setStage = useCallback((node: HTMLDivElement | null) => {
    stageRef.current = node
    if (node) setStageSize({ width: node.clientWidth, height: node.clientHeight })
  }, [])

  useEffect(() => {
    if (!projectId || requestedNew) { setProject(null); setIsLoading(false); return }
    let cancelled = false
    db.getImageProject(projectId).then((saved) => {
      if (cancelled) return
      if (!saved) { setMessage("This photo project was not found."); setIsLoading(false); return }
      imageProjectRef.current = saved
      setProject(saved)
      setIsLoading(false)
    }).catch(() => { if (!cancelled) { setMessage("Could not load this photo project."); setIsLoading(false) } })
    return () => { cancelled = true }
  }, [projectId, requestedNew])

  useEffect(() => {
    if (!project) { setImageUrl(null); return }
    const nextUrl = URL.createObjectURL(project.image)
    setImageUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [project])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(stage)
    return () => observer.disconnect()
  }, [project])

  const imageBounds = useMemo<ImageBounds | null>(() => {
    if (!project || !stageSize.width || !stageSize.height) return null
    const scale = Math.min(stageSize.width / project.imageWidth, stageSize.height / project.imageHeight)
    const width = project.imageWidth * scale
    const height = project.imageHeight * scale
    return { left: (stageSize.width - width) / 2, top: (stageSize.height - height) / 2, width, height }
  }, [project, stageSize])

  const pointMap = useMemo(() => {
    const points = new Map<string, ImagePoint>()
    for (const segment of project?.segments ?? []) { points.set(imagePointKey(segment.start), segment.start); points.set(imagePointKey(segment.end), segment.end) }
    if (project?.pendingLineStart) points.set(imagePointKey(project.pendingLineStart), project.pendingLineStart)
    return points
  }, [project])

  function closeMenus() { setDecision(null); setPointMenu(null); setLineMenu(null); setPitchMenu(null) }
  function save(next: ImageProject) {
    imageProjectRef.current = next
    setProject(next)
    saveChain.current = saveChain.current.then(() => db.saveImageProject(next).then((saved) => { imageProjectRef.current = saved; setProject(saved) })).catch(() => setMessage("Saving this photo project failed."))
  }
  function update(mutator: (current: ImageProject) => ImageProject) {
    const current = imageProjectRef.current
    if (!current) return
    save(mutator(current))
  }
  function updateSegments(segments: ImageMeasurementSegment[], pendingLineStart?: ImagePoint | null) {
    update((current) => {
      const nextPendingLineStart = pendingLineStart === undefined ? current.pendingLineStart : pendingLineStart
      const normalizedSegments = splitImageMeasurementSegmentsAtKnownPoints(segments, [
        ...segments.flatMap((segment) => [segment.start, segment.end]),
        ...(nextPendingLineStart ? [nextPendingLineStart] : []),
      ])
      return {
        ...current,
        segments: normalizedSegments,
        pendingLineStart: nextPendingLineStart,
        planes: detectImageRoofPlanes(normalizedSegments, current.planes),
      }
    })
  }
  function setZoom(next: ImageZoom) {
    const clampedScale = Math.min(MAX_IMAGE_ZOOM, Math.max(1, next.scale))
    const stage = stageRef.current
    const maxOffsetX = stage ? (stage.clientWidth * (clampedScale - 1)) / 2 : 0
    const maxOffsetY = stage ? (stage.clientHeight * (clampedScale - 1)) / 2 : 0
    const normalized = {
      scale: clampedScale,
      offsetX: Math.max(-maxOffsetX, Math.min(maxOffsetX, next.offsetX)),
      offsetY: Math.max(-maxOffsetY, Math.min(maxOffsetY, next.offsetY)),
    }
    imageZoomRef.current = normalized
    setImageZoom(normalized)
  }
  function zoomAround(point: { x: number; y: number }, multiplier: number) {
    const stage = stageRef.current
    if (!stage) return
    const zoom = imageZoomRef.current
    const scale = Math.min(MAX_IMAGE_ZOOM, Math.max(1, zoom.scale * multiplier))
    if (scale === zoom.scale) return
    const centerX = stage.clientWidth / 2
    const centerY = stage.clientHeight / 2
    const sourceX = centerX + (point.x - zoom.offsetX - centerX) / zoom.scale
    const sourceY = centerY + (point.y - zoom.offsetY - centerY) / zoom.scale
    setZoom({
      scale,
      offsetX: point.x - centerX - (sourceX - centerX) * scale,
      offsetY: point.y - centerY - (sourceY - centerY) * scale,
    })
  }
  function zoomFromCenter(multiplier: number) {
    const stage = stageRef.current
    if (!stage) return
    zoomAround({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 }, multiplier)
  }
  function stageRelativePoint(event: { clientX: number; clientY: number }) {
    const rect = stageRef.current?.getBoundingClientRect()
    return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : null
  }
  function stagePoint(event: { clientX: number; clientY: number }) {
    const stage = stageRef.current
    if (!project || !stage) return null
    const rect = stage.getBoundingClientRect()
    const scale = Math.min(rect.width / project.imageWidth, rect.height / project.imageHeight)
    const bounds = {
      left: (rect.width - project.imageWidth * scale) / 2,
      top: (rect.height - project.imageHeight * scale) / 2,
      width: project.imageWidth * scale,
      height: project.imageHeight * scale,
    }
    const visualX = event.clientX - rect.left
    const visualY = event.clientY - rect.top
    const zoom = imageZoomRef.current
    const x = rect.width / 2 + (visualX - zoom.offsetX - rect.width / 2) / zoom.scale
    const y = rect.height / 2 + (visualY - zoom.offsetY - rect.height / 2) / zoom.scale
    if (x < bounds.left || x > bounds.left + bounds.width || y < bounds.top || y > bounds.top + bounds.height) return null
    return { x: ((x - bounds.left) / bounds.width) * project.imageWidth, y: ((y - bounds.top) / bounds.height) * project.imageHeight }
  }
  function snapImagePoint(point: ImagePoint, current: ImageProject, segments = current.segments) {
    const stage = stageRef.current
    const baseScale = stage
      ? Math.min(stage.clientWidth / current.imageWidth, stage.clientHeight / current.imageHeight)
      : 1
    const sourcePixelsPerScreenPixel = baseScale > 0
      ? 1 / (baseScale * imageZoomRef.current.scale)
      : 1
    return snapImagePointToMeasurementLine(
      point,
      segments,
      current.imageWidth,
      current.imageHeight,
      sourcePixelsPerScreenPixel,
    )
  }
  function visualPoint(point: ImagePoint) {
    if (!project || !imageBounds) return null
    return { x: imageBounds.left + (point.x / project.imageWidth) * imageBounds.width, y: imageBounds.top + (point.y / project.imageHeight) * imageBounds.height }
  }
  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    if (!file.type.startsWith("image/")) { setMessage("Choose an image file."); return }
    readImageDimensions(file).then(({ width, height }) => db.saveImageProject(createImageProject(file, width, height))).then((saved) => router.replace(`/image?projectId=${saved.id}`)).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not create photo project."))
  }
  function handleStageClick(event: React.MouseEvent<HTMLDivElement>) {
    if (ignoreNextStageClick.current) { ignoreNextStageClick.current = false; return }
    const current = imageProjectRef.current
    if (!current || decision) return
    const rawPoint = stagePoint(event)
    if (!rawPoint) return
    const point = snapImagePoint(rawPoint, current)
    closeMenus()
    if (!current.pendingLineStart) { updateSegments(current.segments, point); setComeFromArmed(false); return }
    if (comeFromArmed) {
      updateSegments([...current.segments, { id: crypto.randomUUID(), start: current.pendingLineStart, end: point, lengthFeet: 0 }], point)
      setComeFromArmed(false)
      return
    }
    setDecision({ point, anchor: { x: event.clientX, y: event.clientY } })
  }
  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const point = stageRelativePoint(event)
    if (!point || event.target !== event.currentTarget) return
    event.currentTarget.setPointerCapture(event.pointerId)
    canvasPointers.current.set(event.pointerId, point)
    if (canvasPointers.current.size === 2) {
      const [first, second] = [...canvasPointers.current.values()]
      const distance = Math.hypot(second.x - first.x, second.y - first.y)
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
      const zoom = imageZoomRef.current
      const stage = stageRef.current
      if (!stage || distance === 0) return
      canvasGesture.current = {
        distance,
        startScale: zoom.scale,
        baseMidpoint: {
          x: stage.clientWidth / 2 + (midpoint.x - zoom.offsetX - stage.clientWidth / 2) / zoom.scale,
          y: stage.clientHeight / 2 + (midpoint.y - zoom.offsetY - stage.clientHeight / 2) / zoom.scale,
        },
      }
      canvasPan.current = null
      ignoreNextStageClick.current = true
      return
    }
    if (imageZoomRef.current.scale > 1) {
      const zoom = imageZoomRef.current
      canvasPan.current = { pointerId: event.pointerId, x: point.x, y: point.y, offsetX: zoom.offsetX, offsetY: zoom.offsetY, moved: false }
    }
  }
  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const point = stageRelativePoint(event)
    if (!point || !canvasPointers.current.has(event.pointerId)) return
    canvasPointers.current.set(event.pointerId, point)
    const stage = stageRef.current
    const gesture = canvasGesture.current
    if (stage && gesture && canvasPointers.current.size >= 2) {
      const [first, second] = [...canvasPointers.current.values()]
      const distance = Math.hypot(second.x - first.x, second.y - first.y)
      if (distance === 0) return
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
      const scale = Math.min(MAX_IMAGE_ZOOM, Math.max(1, (distance / gesture.distance) * gesture.startScale))
      setZoom({
        scale,
        offsetX: midpoint.x - stage.clientWidth / 2 - (gesture.baseMidpoint.x - stage.clientWidth / 2) * scale,
        offsetY: midpoint.y - stage.clientHeight / 2 - (gesture.baseMidpoint.y - stage.clientHeight / 2) * scale,
      })
      return
    }
    const pan = canvasPan.current
    if (!pan || pan.pointerId !== event.pointerId) return
    const deltaX = point.x - pan.x
    const deltaY = point.y - pan.y
    if (Math.hypot(deltaX, deltaY) > 3) { pan.moved = true; ignoreNextStageClick.current = true }
    setZoom({ ...imageZoomRef.current, offsetX: pan.offsetX + deltaX, offsetY: pan.offsetY + deltaY })
  }
  function handleCanvasPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    canvasPointers.current.delete(event.pointerId)
    if (canvasPointers.current.size < 2) canvasGesture.current = null
    if (canvasPan.current?.pointerId === event.pointerId) canvasPan.current = null
  }
  function handleCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const point = stageRelativePoint(event)
    if (!point) return
    event.preventDefault()
    zoomAround(point, event.deltaY < 0 ? 1.2 : 1 / 1.2)
  }
  function applyDecision(mode: "continue" | "new") {
    const current = imageProjectRef.current
    if (!current || !decision) return
    const point = decision.point
    closeMenus(); setComeFromArmed(false)
    if (mode === "continue" && current.pendingLineStart) updateSegments([...current.segments, { id: crypto.randomUUID(), start: current.pendingLineStart, end: point, lengthFeet: 0 }], point)
    else updateSegments(current.segments, point)
  }
  function openPointMenu(event: React.MouseEvent, point: ImagePoint) { event.stopPropagation(); setDecision(null); setLineMenu(null); setPitchMenu(null); setPointMenu({ point, anchor: { x: event.clientX, y: event.clientY } }) }
  function movePoint(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = pointDrag.current
    const rawPoint = stagePoint(event)
    const current = imageProjectRef.current
    if (!current || !drag || drag.pointerId !== event.pointerId || !rawPoint) return
    const next = snapImagePoint(
      rawPoint,
      current,
      current.segments.filter((segment) => imagePointKey(segment.start) !== drag.key && imagePointKey(segment.end) !== drag.key),
    )
    event.preventDefault(); event.stopPropagation()
    updateSegments(current.segments.map((segment) => ({ ...segment, start: imagePointKey(segment.start) === drag.key ? next : segment.start, end: imagePointKey(segment.end) === drag.key ? next : segment.end })), current.pendingLineStart && imagePointKey(current.pendingLineStart) === drag.key ? next : current.pendingLineStart)
    drag.key = imagePointKey(next)
  }
  function deletePoint(point: ImagePoint) { const current = imageProjectRef.current; if (!current) return; const key = imagePointKey(point); closeMenus(); updateSegments(current.segments.filter((segment) => imagePointKey(segment.start) !== key && imagePointKey(segment.end) !== key), current.pendingLineStart && imagePointKey(current.pendingLineStart) === key ? null : current.pendingLineStart) }
  function comeTo(point: ImagePoint) { const current = imageProjectRef.current; if (!current) return; const start = current.pendingLineStart ?? current.segments.at(-1)?.end; closeMenus(); if (start) updateSegments([...current.segments, { id: crypto.randomUUID(), start, end: point, lengthFeet: 0 }], point); else updateSegments(current.segments, point) }
  function comeFrom(point: ImagePoint) { const current = imageProjectRef.current; if (!current) return; closeMenus(); updateSegments(current.segments, point); setComeFromArmed(true) }
  function editLine(segmentId: string, patch: Partial<Pick<ImageMeasurementSegment, "lengthFeet" | "type">>) { const current = imageProjectRef.current; if (!current) return; updateSegments(current.segments.map((segment) => segment.id === segmentId ? { ...segment, ...patch } : segment), current.pendingLineStart); }
  function setPitch(planeId: string, draft: string, all = false) { const rise = Number(draft); if (!project || !Number.isFinite(rise) || rise < 0) return; update((current) => ({ ...current, planes: current.planes.map((plane) => all || plane.id === planeId ? { ...plane, pitch: `${rise}/12` } : plane) })); setPitchMenu(null) }

  if (!project && !isLoading) return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, background: "#d9ddd8" }}><section style={{ width: "min(440px,100%)", display: "grid", gap: 14, padding: 24, borderRadius: 22, background: "#fff", boxShadow: "0 20px 50px rgba(20,24,22,.2)" }}><FileImage size={32}/><h1 style={{ margin: 0 }}>Measure a roof image</h1><p style={{ margin: 0, color: "#5f685f", lineHeight: 1.5 }}>Upload a roof photo or plan. Every line length is entered manually, so perspective does not affect the measurement.</p><label style={{ ...buttonStyle, background: "#1f2522", color: "#fff", textAlign: "center" }}><input className="sr-only" type="file" accept="image/*" onChange={choosePhoto}/>{requestedNew ? "Choose roof image" : "Choose another roof image"}</label><button type="button" onClick={() => router.push("/projects")} style={{ ...buttonStyle, background: "rgba(31,37,34,.08)" }}>Projects</button>{message ? <p style={{ margin: 0, color: "#a62d27" }}>{message}</p> : null}</section></main>
  if (isLoading || !project || !imageUrl) return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}>Loading photo project…</main>

  const renderedPlanes = project.planes.map((plane) => ({ ...plane, points: plane.pointKeys.map((key) => pointMap.get(key)).filter((point): point is ImagePoint => Boolean(point)).map((point) => visualPoint(point)).filter((point): point is { x: number; y: number } => Boolean(point)) })).filter((plane) => plane.points.length >= 3)
  return <main style={{ position: "fixed", inset: 0, background: "#d9ddd8" }}>
    <div style={{ position: "absolute", top: 14, left: 14, zIndex: 3, display: "grid", gap: 8 }}>
      <div style={{ padding: "10px 12px", borderRadius: 16, background: "rgba(255,255,255,.94)", boxShadow: "0 10px 24px rgba(20,24,22,.12)", fontSize: 14, fontWeight: 700 }}>{project.name}</div>
      <div aria-label="Image zoom" style={{ display: "flex", alignItems: "center", gap: 4, width: "max-content", padding: 4, borderRadius: 14, background: "rgba(255,255,255,.94)", boxShadow: "0 10px 24px rgba(20,24,22,.12)" }}>
        <button type="button" aria-label="Zoom out" title="Zoom out" disabled={imageZoom.scale <= 1} onClick={() => zoomFromCenter(1 / 1.2)} style={{ ...buttonStyle, display: "grid", placeItems: "center", padding: 8, background: "transparent", opacity: imageZoom.scale <= 1 ? .4 : 1 }}><Minus size={16}/></button>
        <span aria-live="polite" style={{ minWidth: 42, textAlign: "center", fontSize: 13, fontWeight: 700 }}>{imageZoom.scale.toFixed(1)}×</span>
        <button type="button" aria-label="Zoom in" title="Zoom in" disabled={imageZoom.scale >= MAX_IMAGE_ZOOM} onClick={() => zoomFromCenter(1.2)} style={{ ...buttonStyle, display: "grid", placeItems: "center", padding: 8, background: "transparent", opacity: imageZoom.scale >= MAX_IMAGE_ZOOM ? .4 : 1 }}><Plus size={16}/></button>
        <button type="button" aria-label="Reset image zoom" title="Reset image zoom" disabled={imageZoom.scale === 1 && imageZoom.offsetX === 0 && imageZoom.offsetY === 0} onClick={() => setZoom({ scale: 1, offsetX: 0, offsetY: 0 })} style={{ ...buttonStyle, display: "grid", placeItems: "center", padding: 8, background: "transparent", opacity: imageZoom.scale === 1 && imageZoom.offsetX === 0 && imageZoom.offsetY === 0 ? .4 : 1 }}><RotateCcw size={15}/></button>
      </div>
      <button type="button" onClick={() => setSettingsOpen((open) => !open)} style={{ ...buttonStyle, justifySelf: "start", display: "flex", alignItems: "center", gap: 7, background: "rgba(255,255,255,.94)" }}><Settings size={16}/> Settings</button>
      {settingsOpen ? <div style={{ ...popupStyle, width: 190 }}><button type="button" onClick={() => router.push("/projects")} style={{ ...buttonStyle, background: "rgba(31,37,34,.08)" }}>Projects</button><label style={{ ...buttonStyle, background: "rgba(31,37,34,.08)", textAlign: "center" }}><input className="sr-only" type="file" accept="image/*" onChange={choosePhoto}/>Replace image</label></div> : null}
    </div>
    <div ref={setStage} data-image-zoom-canvas onClick={handleStageClick} onPointerDown={handleCanvasPointerDown} onPointerMove={handleCanvasPointerMove} onPointerUp={handleCanvasPointerEnd} onPointerCancel={handleCanvasPointerEnd} onWheel={handleCanvasWheel} style={{ position: "absolute", inset: 0, overflow: "hidden", touchAction: "none", cursor: imageZoom.scale > 1 ? "grab" : "crosshair" }}>
      <div style={{ position: "absolute", inset: 0, transform: `translate(${imageZoom.offsetX}px, ${imageZoom.offsetY}px) scale(${imageZoom.scale})`, transformOrigin: "center", pointerEvents: "none" }}>
      <img src={imageUrl} alt="Roof to measure" draggable={false} style={{ position: "absolute", inset: 0, zIndex: 0, width: "100%", height: "100%", objectFit: "contain", userSelect: "none", pointerEvents: "none" }}/>
      {imageBounds ? <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", overflow: "visible" }}>{renderedPlanes.map((plane) => { const center = plane.points.reduce((sum, point) => ({ x: sum.x + point.x / plane.points.length, y: sum.y + point.y / plane.points.length }), { x: 0, y: 0 }); return <g key={plane.id}><polygon points={plane.points.map((point) => `${point.x},${point.y}`).join(" ")} fill="rgba(40,128,255,.5)" stroke="rgba(22,91,196,.9)" strokeWidth="2"/><text x={center.x} y={center.y} fill="#fff" stroke="#000" strokeWidth="3" paintOrder="stroke" textAnchor="middle" dominantBaseline="central" fontSize="10" fontWeight="800" style={{ pointerEvents: "auto", cursor: "pointer" }} onClick={(event) => { event.stopPropagation(); setPitchMenu({ planeId: plane.id, anchor: { x: event.clientX, y: event.clientY }, draft: plane.pitch?.replace(/\/12$/, "") ?? "" }) }}>{plane.pitch?.replace(/12$/, "") ?? "?/12"}</text></g> })}{project.segments.map((segment) => { const start = visualPoint(segment.start); const end = visualPoint(segment.end); if (!start || !end) return null; const dx = end.x-start.x, dy=end.y-start.y, length=Math.hypot(dx,dy)||1; return <g key={segment.id}><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#e0b93b" strokeWidth="3" strokeLinecap="round" strokeDasharray="6 6"/><text x={(start.x+end.x)/2+(-dy/length)*17} y={(start.y+end.y)/2+(dx/length)*17} fill="#ffff00" stroke="#000" strokeWidth="3" paintOrder="stroke" textAnchor="middle" fontSize="10" fontWeight="700" style={{ pointerEvents: "auto", cursor: "pointer" }} onClick={(event) => { event.stopPropagation(); setLineMenu({ segmentId: segment.id, anchor: { x: event.clientX, y: event.clientY } }) }}>{labelForLength(segment.lengthFeet, segment.type)}</text></g> })}</svg> : null}
      {[...pointMap.entries()].map(([key, point]) => { const visual = visualPoint(point); if (!visual) return null; const pending = project.pendingLineStart && imagePointKey(project.pendingLineStart) === key; return <button key={key} type="button" aria-label="Move measurement point" onClick={(event) => openPointMenu(event, point)} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); pointDrag.current = { pointerId: event.pointerId, key } }} onPointerMove={movePoint} onPointerUp={(event) => { if (pointDrag.current?.pointerId === event.pointerId) { event.currentTarget.releasePointerCapture(event.pointerId); pointDrag.current = null } }} onPointerCancel={() => { pointDrag.current = null }} style={{ position: "absolute", zIndex: 2, pointerEvents: "auto", left: visual.x, top: visual.y, width: 28, height: 28, transform: "translate(-50%,-50%)", border: 0, borderRadius: 999, background: "transparent", cursor: "grab", touchAction: "none", display: "grid", placeItems: "center" }}><span style={{ width: 10, height: 10, borderRadius: 999, border: pending ? "2px solid #1f2522" : "2px solid rgba(255,255,255,.95)", background: pending ? "#fff" : "#1f2522", boxShadow: "0 6px 18px rgba(20,24,22,.22)" }}/></button> })}
      </div>
    </div>
    {project.segments.length > 0 ? <button type="button" onClick={() => router.push(`/report?projectId=${encodeURIComponent(project.id)}&projectType=image`)} style={{ position: "absolute", right: 14, bottom: 14, zIndex: 3, display: "flex", alignItems: "center", gap: 7, border: 0, borderRadius: 999, padding: "8px 12px", background: "rgba(31, 37, 34, 0.88)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}><FileText size={16}/> View Report</button> : null}
    {decision ? <div style={{ ...popupStyle, position: "fixed", left: Math.min(decision.anchor.x + 16, window.innerWidth - 176), top: Math.min(decision.anchor.y + 16, window.innerHeight - 150) }}><button type="button" onClick={() => applyDecision("continue")} style={{ ...buttonStyle, background: "#1f2522", color: "#fff" }}>Continue</button><button type="button" onClick={() => applyDecision("new")} style={{ ...buttonStyle, background: "rgba(31,37,34,.08)" }}>Start New</button><button type="button" onClick={closeMenus} style={{ ...buttonStyle, padding: 4, background: "transparent", color: "#5f685f" }}>Close</button></div> : null}
    {pointMenu ? <div style={{ ...popupStyle, position: "fixed", left: Math.min(pointMenu.anchor.x + 16, window.innerWidth - 176), top: Math.min(pointMenu.anchor.y + 16, window.innerHeight - 176) }}><button type="button" onClick={() => comeTo(pointMenu.point)} style={{ ...buttonStyle, background: "#1f2522", color: "#fff" }}>Come To</button><button type="button" onClick={() => comeFrom(pointMenu.point)} style={{ ...buttonStyle, background: "rgba(31,37,34,.08)" }}>Come From</button><button type="button" onClick={() => deletePoint(pointMenu.point)} style={{ ...buttonStyle, background: "rgba(184,53,47,.1)", color: "#a62d27" }}>Delete</button></div> : null}
    {lineMenu && project.segments.find((segment) => segment.id === lineMenu.segmentId) ? <LineEditor segment={project.segments.find((segment) => segment.id === lineMenu.segmentId)!} anchor={lineMenu.anchor} onClose={() => setLineMenu(null)} onChange={(patch) => editLine(lineMenu.segmentId, patch)}/> : null}
    {pitchMenu ? <div style={{ ...popupStyle, position: "fixed", left: Math.min(pitchMenu.anchor.x - 80, window.innerWidth - 176), top: Math.min(pitchMenu.anchor.y + 16, window.innerHeight - 140) }}><label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>Pitch <span><input aria-label="Roof pitch rise" type="number" min="0" max="36" step=".25" autoFocus value={pitchMenu.draft} onChange={(event) => setPitchMenu({ ...pitchMenu, draft: event.target.value })} style={{ width: 72, border: "1px solid rgba(31,37,34,.18)", borderRadius: 10, padding: 8 }}/> /12</span></label><div style={{ display: "flex", gap: 8 }}><button type="button" onClick={() => setPitch(pitchMenu.planeId, pitchMenu.draft)} style={{ ...buttonStyle, flex: 1, background: "#1f2522", color: "#fff" }}>Save</button><button type="button" onClick={() => setPitch(pitchMenu.planeId, pitchMenu.draft, true)} style={{ ...buttonStyle, flex: 1, background: "rgba(31,37,34,.08)" }}>All</button></div></div> : null}
    {message ? <p style={{ position: "fixed", bottom: 14, left: 14, margin: 0, padding: "10px 12px", borderRadius: 12, background: "#fff", color: "#a62d27", zIndex: 8 }}>{message}</p> : null}
  </main>
}

function LineEditor({ segment, anchor, onClose, onChange }: { segment: ImageMeasurementSegment; anchor: Anchor; onClose: () => void; onChange: (patch: Partial<Pick<ImageMeasurementSegment, "lengthFeet" | "type">>) => void }) {
  const left = Math.max(12, Math.min(anchor.x - 140, window.innerWidth - 292))
  const top = Math.max(12, Math.min(anchor.y + 16, window.innerHeight - 318))

  return <div role="dialog" aria-label="Edit measurement line" style={{ ...popupStyle, position: "fixed", left, top, width: "min(280px, calc(100vw - 24px))", gap: 12 }}>
    <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
      <span>Length</span>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input aria-label="Line length in feet" type="number" min="0" step=".01" autoFocus value={segment.lengthFeet || ""} onChange={(event) => onChange({ lengthFeet: Number(event.target.value) || 0 })} style={{ width: "100%", minWidth: 0, border: "1px solid rgba(31,37,34,.18)", borderRadius: 10, padding: 10, background: "#fff" }}/>
        <span style={{ color: "#5f685f" }}>ft</span>
      </span>
    </label>
    <div style={{ display: "grid", gap: 7 }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>Line type</span>
      <div role="group" aria-label="Line type" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 7 }}>
        {MEASUREMENT_TYPES.map((option) => {
          const selected = segment.type === option.type
          return <button key={option.type} type="button" aria-pressed={selected} onClick={() => onChange({ type: option.type as MeasurementType })} style={{ ...buttonStyle, minWidth: 0, padding: "9px 10px", background: selected ? option.color : "rgba(31,37,34,.08)", color: selected ? "#fff" : "#1f2522", fontWeight: selected ? 700 : 600 }}>{option.label}</button>
        })}
      </div>
    </div>
    <button type="button" onClick={onClose} style={{ ...buttonStyle, padding: "10px 12px", background: "#1f2522", color: "#fff", fontWeight: 700 }}>Done</button>
  </div>
}
