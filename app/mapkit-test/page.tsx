"use client"

import { MapPin, Search } from "lucide-react"
import {
  ChangeEvent,
  FormEvent,
  PointerEvent as ReactPointerEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  loadMapKit,
  lookupStreetAddressWithBias,
  searchAddressSuggestions,
  searchBestAddressMatch,
} from "@/lib/mapkit/client"
import {
  baseViewportPointToVisualViewportPoint,
  clampPrecisionZoomTransform,
  DEFAULT_PRECISION_ZOOM,
  mapPagePointToBaseViewportPoint,
  PRECISION_ZOOM_LEVELS,
  visualPagePointToMapPagePoint,
  zoomAroundViewportCenter,
} from "@/lib/mapkit/precision-zoom"
import {
  fromProjectMeasurementData,
  measurementGeometrySignature,
  measurementPointKey,
  toProjectMeasurementData,
} from "@/lib/measurement/project-geometry"
import {
  snapPointToMeasurementLine,
  splitMeasurementSegmentsAtKnownPoints,
} from "@/lib/measurement/snapping"
import { createTieInSegment } from "@/lib/measurement/tie-in"
import { appendPersistenceDebugNote } from "@/lib/debug/persistence-debug"
import { appendCalculationDebugNote } from "@/lib/debug/calculation-debug"
import { db } from "@/lib/persistence/db"
import { createEmptyProject } from "@/lib/projects/project-factory"
import { FirstRunOnboarding } from "@/components/app/FirstRunOnboarding"
import { haversineDistanceFeet } from "@/lib/measurement/geometry"
import { roundMeasurement } from "@/lib/measurement/rounding"
import {
  calculateProjectTotals,
  getProjectCalculationBreakdown,
} from "@/lib/measurement/calculations"
import { detectRoofPlanes } from "@/lib/measurement/plane-detection"
import { createImageProject, readImageDimensions } from "@/lib/image-projects/factory"
import { AddressSuggestion } from "@/types/mapkit"
import {
  EditableMeasurementPoint as MeasurementPoint,
  EditableMeasurementSegment as MeasurementSegment,
  MapCameraState,
  MeasurementType,
  PropertyLocation,
  Project,
  RoofPlane,
} from "@/types/models"

type LocationPermission = PermissionState | "unsupported"
const LOCATION_ALERT_DISMISSED_KEY =
  "roofmeasure.mapkit-test.location-alert-dismissed"
const SEARCH_MAX_ZOOM_SPAN = 0.00005
const MAP_CAMERA_SAVE_DELAY_MS = 350
const INITIAL_MAP_CENTER = { lat: 39.5501, lng: -105.7821 }
const INITIAL_MAP_CENTER_TOLERANCE = 0.000001
const INITIAL_CAMERA_MISMATCH_FEET = 2_640

function formatCalculationDebugNumber(value: number) {
  return Number.isFinite(value) ? value.toFixed(9) : String(value)
}

function createLiveCalculationProject(
  measurementSegments: MeasurementSegment[],
  pendingLineStart: MeasurementPoint | null,
  roofPlanes: RoofPlane[],
  singlePitch: string,
) {
  const project = createEmptyProject("Live calculation")
  const geometry = toProjectMeasurementData(
    measurementSegments,
    pendingLineStart,
  )
  project.measurementGeometry = geometry.measurementGeometry
  project.points = geometry.points
  project.segments = geometry.segments
  project.planes = roofPlanes
  project.singlePitch = singlePitch
  return project
}

type DecisionAnchor = { x: number; y: number }
type PointActionMenuState = {
  point: MeasurementPoint
  anchor: DecisionAnchor
}
type PlanePitchMenuState = {
  planeId: string
  anchor: DecisionAnchor
  draft: string
}
type SegmentTypeMenuState = {
  segmentId: string
  anchor: DecisionAnchor
}
type ProjectedMeasurementPoint = MeasurementPoint & {
  key: string
  x: number
  y: number
  tone: "solid" | "pending"
}
type ProjectedMeasurementOverlay = {
  segments: Array<{
    id: string
    startX: number
    startY: number
    endX: number
    endY: number
    lengthFeet: number
    type?: MeasurementType
    label: string
  }>
  points: ProjectedMeasurementPoint[]
}

const SEGMENT_TYPE_OPTIONS: Array<{
  type: MeasurementType
  label: string
}> = [
  { type: "ridge", label: "Ridge" },
  { type: "hip", label: "Hip" },
  { type: "valley", label: "Valley" },
  { type: "rake", label: "Rake" },
  { type: "eave", label: "Eave" },
  { type: "wall", label: "Wall" },
]

function formatMeasurementLabel(lengthFeet: number, type?: MeasurementType) {
  const typeLetter =
    type === "ridge" ? "R" : type ? type.charAt(0) : ""
  return `${roundMeasurement(lengthFeet)}'${typeLetter}`
}

function polygonLabelCenter(points: Array<{ x: number; y: number }>) {
  let twiceArea = 0
  let x = 0
  let y = 0

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    const cross = current.x * next.y - next.x * current.y
    twiceArea += cross
    x += (current.x + next.x) * cross
    y += (current.y + next.y) * cross
  }

  if (Math.abs(twiceArea) < 0.001) {
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    }
  }

  return { x: x / (3 * twiceArea), y: y / (3 * twiceArea) }
}

type MeasurementGeometryState = {
  segments: MeasurementSegment[]
  pendingLineStart: MeasurementPoint | null
}

function normalizeMeasurementGeometry(next: MeasurementGeometryState) {
  return {
    segments: splitMeasurementSegmentsAtKnownPoints(next.segments, [
      ...next.segments.flatMap((segment) => [segment.start, segment.end]),
      ...(next.pendingLineStart ? [next.pendingLineStart] : []),
    ]),
    pendingLineStart: next.pendingLineStart,
  }
}

type SavedProjectMapRouteDebug = {
  projectId: string
  projectName: string
  propertyLocation: PropertyLocation | null
  savedCamera: MapCameraState | null
  expectedCamera: MapCameraState | null
  expectedRoute: "saved camera" | "property location fallback" | "unavailable"
}

const EMPTY_PROJECTED_MEASUREMENT_OVERLAY: ProjectedMeasurementOverlay = {
  segments: [],
  points: [],
}

function isUsableMapCamera(
  camera: MapCameraState | undefined,
): camera is MapCameraState {
  return Boolean(
    camera &&
    Number.isFinite(camera.centerLat) &&
    Number.isFinite(camera.centerLng) &&
    Number.isFinite(camera.latSpan) &&
    Number.isFinite(camera.lngSpan) &&
    camera.latSpan > 0 &&
    camera.lngSpan > 0,
  )
}

function mapCameraSignature(camera: MapCameraState | null) {
  if (!camera || !isUsableMapCamera(camera)) return ""
  return [camera.centerLat, camera.centerLng, camera.latSpan, camera.lngSpan]
    .map((value) => value.toPrecision(14))
    .join(":")
}

function isUsablePropertyLocation(
  location: PropertyLocation | undefined,
): location is PropertyLocation {
  return Boolean(
    location &&
      Number.isFinite(location.latitude) &&
      Number.isFinite(location.longitude) &&
      location.latitude >= -90 &&
      location.latitude <= 90 &&
      location.longitude >= -180 &&
      location.longitude <= 180,
  )
}

function isInitialMapCamera(camera: MapCameraState) {
  return (
    Math.abs(camera.centerLat - INITIAL_MAP_CENTER.lat) <=
      INITIAL_MAP_CENTER_TOLERANCE &&
    Math.abs(camera.centerLng - INITIAL_MAP_CENTER.lng) <=
      INITIAL_MAP_CENTER_TOLERANCE
  )
}

function formatCoordinate(latitude: number, longitude: number) {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
}

function formatMapCamera(camera: MapCameraState | null) {
  if (!camera || !isUsableMapCamera(camera)) return "none"
  return `center ${formatCoordinate(camera.centerLat, camera.centerLng)} • span ${camera.latSpan.toPrecision(6)} × ${camera.lngSpan.toPrecision(6)}`
}

function toProjectLocation(
  address: Pick<
    AddressSuggestion,
    "title" | "subtitle" | "formattedAddress" | "latitude" | "longitude"
  >,
): PropertyLocation {
  return {
    formattedAddress:
      address.formattedAddress ||
      [address.title, address.subtitle].filter(Boolean).join(", "),
    latitude: address.latitude ?? 0,
    longitude: address.longitude ?? 0,
  }
}

async function getLocationPermission(): Promise<LocationPermission> {
  if (
    typeof navigator === "undefined" ||
    !navigator.permissions ||
    typeof navigator.permissions.query !== "function"
  ) {
    return "unsupported"
  }

  try {
    const status = await navigator.permissions.query({
      name: "geolocation" as PermissionName,
    })
    return status.state
  } catch {
    return "unsupported"
  }
}

async function requestCurrentLocation() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 30_000,
    })
  })
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MapKitTestPage />
    </Suspense>
  )
}

function MapKitTestPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const projectId = searchParams.get("projectId")
  const newProjectRequested = searchParams.get("new") === "1"
  const mapViewportRef = useRef<HTMLDivElement | null>(null)
  const imageUploadInputRef = useRef<HTMLInputElement | null>(null)
  const mapRef = useRef<HTMLDivElement | null>(null)
  const mapInstanceRef = useRef<InstanceType<
    NonNullable<NonNullable<Window["mapkit"]>["Map"]>
  > | null>(null)
  const currentProjectIdRef = useRef<string | null>(null)
  const projectEpochRef = useRef(0)
  const isProjectHydratingRef = useRef(false)
  const isProjectMapRouteSettlingRef = useRef(false)
  const saveQueueRef = useRef(Promise.resolve<void>(undefined))
  const pendingProjectRef = useRef<Project | null>(null)
  const measurementGeometryRef = useRef<MeasurementGeometryState>({
    segments: [],
    pendingLineStart: null,
  })
  const roofPlanesRef = useRef<RoofPlane[]>([])
  const cameraSaveTimerRef = useRef<number | null>(null)
  const mapCameraRef = useRef<MapCameraState | null>(null)
  const pendingMapCameraRestoreRef = useRef<MapCameraState | null>(null)
  const pendingSavedProjectMapRouteDebugRef =
    useRef<SavedProjectMapRouteDebug | null>(null)
  const lastPersistedGeometryRef = useRef<{
    projectId: string
    signature: string
  } | null>(null)
  const lastPersistedMapCameraRef = useRef<{
    projectId: string
    signature: string
  } | null>(null)
  const lastGeometryPreservationNoticeRef = useRef<{
    projectId: string
    signature: string
  } | null>(null)
  const projectionRefreshFrameRef = useRef<number | null>(null)
  const superZoomDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    dragging: boolean
  } | null>(null)
  const measurementPointDragRef = useRef<{
    pointerId: number
    sourcePoint: MeasurementPoint
  } | null>(null)
  const hasCenteredOnUserLocationRef = useRef(false)
  const selectedPlaceAnnotationRef = useRef<unknown>(null)
  const currentLocationAnnotationRef = useRef<unknown>(null)
  const measurementPointAnnotationRefs = useRef<unknown[]>([])
  const measurementLineOverlayRefs = useRef<unknown[]>([])
  const measurementLabelAnnotationRefs = useRef<unknown[]>([])
  const locationBiasRef = useRef<{
    centerLat: number
    centerLng: number
    latSpan: number
    lngSpan: number
    countryCode?: string
  } | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [query, setQuery] = useState("")
  const [suppressSuggestionsUntilTyping, setSuppressSuggestionsUntilTyping] =
    useState(false)
  const [searchState, setSearchState] = useState<"idle" | "loading" | "error">(
    "idle",
  )
  const [searchMessage, setSearchMessage] = useState("")
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [autocompleteState, setAutocompleteState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle")
  const [autocompleteMessage, setAutocompleteMessage] = useState("")
  const [locationBias, setLocationBias] = useState<{
    centerLat: number
    centerLng: number
    latSpan: number
    lngSpan: number
    countryCode?: string
  } | null>(null)
  const [currentLocation, setCurrentLocation] = useState<{
    latitude: number
    longitude: number
  } | null>(null)
  const [selectedPlace, setSelectedPlace] = useState<{
    latitude: number
    longitude: number
  } | null>(null)
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const [projectHydrated, setProjectHydrated] = useState(false)
  const [hasPersistedMapCamera, setHasPersistedMapCamera] = useState(false)
  const [isSatelliteMapActive, setIsSatelliteMapActive] = useState(false)
  const [measurementSegments, setMeasurementSegments] = useState<
    MeasurementSegment[]
  >([])
  const [pendingLineStart, setPendingLineStart] =
    useState<MeasurementPoint | null>(null)
  const [isComeFromArmed, setIsComeFromArmed] = useState(false)
  const [pendingModeDecisionPoint, setPendingModeDecisionPoint] =
    useState<MeasurementPoint | null>(null)
  const [pendingModeDecisionAnchor, setPendingModeDecisionAnchor] =
    useState<DecisionAnchor | null>(null)
  const [pointActionMenu, setPointActionMenu] =
    useState<PointActionMenuState | null>(null)
  const [planePitchMenu, setPlanePitchMenu] =
    useState<PlanePitchMenuState | null>(null)
  const [segmentTypeMenu, setSegmentTypeMenu] =
    useState<SegmentTypeMenuState | null>(null)
  const [reportTypeAlert, setReportTypeAlert] = useState<
    "assign-types" | "type-confirmed" | null
  >(null)
  const [showNilTypeHighlights, setShowNilTypeHighlights] = useState(false)
  const [roofPlanes, setRoofPlanes] = useState<RoofPlane[]>([])
  const [activeSinglePitch, setActiveSinglePitch] = useState("6/12")
  const [isMeasurementSettingsOpen, setIsMeasurementSettingsOpen] =
    useState(false)
  const [tutorialReplayVersion, setTutorialReplayVersion] = useState(0)
  const [precisionZoom, setPrecisionZoom] = useState(DEFAULT_PRECISION_ZOOM)
  const [projectionRevision, setProjectionRevision] = useState(0)
  const [projectedMeasurementOverlay, setProjectedMeasurementOverlay] =
    useState<ProjectedMeasurementOverlay>(EMPTY_PROJECTED_MEASUREMENT_OVERLAY)
  const [locationState, setLocationState] = useState<
    | "idle"
    | "requesting"
    | "granted"
    | "denied"
    | "unsupported"
    | "error"
    | "prompt"
  >("idle")
  const [locationAlert, setLocationAlert] = useState("")
  const [isLocationAlertDismissed, setIsLocationAlertDismissed] =
    useState(false)
  const superZoomScale = precisionZoom.scale
  const superZoomOffsetX = precisionZoom.offsetX
  const superZoomOffsetY = precisionZoom.offsetY
  const superZoomActive = precisionZoom.scale > 1
  const projectedRoofPlanes = useMemo(() => {
    const pointsByKey = new Map(
      projectedMeasurementOverlay.points.map((point) => [point.key, point]),
    )

    return roofPlanes
      .map((plane) => ({
        ...plane,
        points: plane.pointIds
          .map((pointId) => pointsByKey.get(pointId))
          .filter((point): point is ProjectedMeasurementPoint => Boolean(point)),
      }))
      .filter((plane) => plane.points.length >= 3)
  }, [projectedMeasurementOverlay.points, roofPlanes])
  const liveCalculations = useMemo(() => {
    const project = createLiveCalculationProject(
      measurementSegments,
      pendingLineStart,
      roofPlanes,
      activeSinglePitch,
    )
    return calculateProjectTotals(project)
  }, [activeSinglePitch, measurementSegments, pendingLineStart, roofPlanes])
  const untypedSegmentCount = useMemo(
    () => measurementSegments.filter((segment) => !segment.type).length,
    [measurementSegments],
  )

  const safariLocationHelp =
    'In Safari, open Website Settings for this page and change Location to "Allow", then reload this page.'

  useEffect(() => {
    locationBiasRef.current = locationBias
  }, [locationBias])

  useEffect(() => {
    currentProjectIdRef.current = currentProjectId
  }, [currentProjectId])

  useEffect(() => {
    if (typeof window === "undefined") return
    setIsLocationAlertDismissed(
      window.localStorage.getItem(LOCATION_ALERT_DISMISSED_KEY) === "1",
    )
  }, [])

  useEffect(() => {
    let cancelled = false
    const hydrationEpoch = projectEpochRef.current + 1
    projectEpochRef.current = hydrationEpoch
    isProjectHydratingRef.current = true
    if (cameraSaveTimerRef.current !== null) {
      window.clearTimeout(cameraSaveTimerRef.current)
      cameraSaveTimerRef.current = null
    }

    async function hydrateProject() {
      if (newProjectRequested || !projectId) {
        appendPersistenceDebugNote(
          newProjectRequested
            ? "IndexedDB HYDRATION SKIPPED • New-project session requested"
            : "IndexedDB HYDRATION SKIPPED • Home page requested without a project",
        )
        currentProjectIdRef.current = null
        pendingProjectRef.current = null
        mapCameraRef.current = null
        pendingMapCameraRestoreRef.current = null
        pendingSavedProjectMapRouteDebugRef.current = null
        isProjectMapRouteSettlingRef.current = false
        lastPersistedGeometryRef.current = null
        lastPersistedMapCameraRef.current = null
        setCurrentProjectId(null)
        setActiveSinglePitch("6/12")
        setQuery("")
        setSelectedPlace(null)
        setIsSatelliteMapActive(false)
        setHasPersistedMapCamera(false)
        replaceMeasurementGeometry({ segments: [], pendingLineStart: null })
        setIsComeFromArmed(false)
        setPendingModeDecisionPoint(null)
        setPendingModeDecisionAnchor(null)
        setPointActionMenu(null)
        setPlanePitchMenu(null)
        setSuppressSuggestionsUntilTyping(false)
        resetSuperZoom()
        setProjectHydrated(true)
        isProjectHydratingRef.current = false
        return
      }

      setProjectHydrated(false)
      let project: Project | undefined
      let hydrationSource: "URL" | "recovery" = "URL"

      try {
        const loaded = await db.getProjectForHydration(projectId)
        project = loaded?.project
        if (loaded?.source === "recovery") hydrationSource = "recovery"
      } catch (error) {
        if (!cancelled && hydrationEpoch === projectEpochRef.current) {
          appendPersistenceDebugNote(
            `IndexedDB HYDRATION FAILED • ${error instanceof Error ? error.message : "Could not open the local project database"}`,
          )
          isProjectHydratingRef.current = false
          isProjectMapRouteSettlingRef.current = false
        }
        return
      }

      if (!project || cancelled || hydrationEpoch !== projectEpochRef.current) {
        if (
          !project &&
          !cancelled &&
          hydrationEpoch === projectEpochRef.current
        ) {
          appendPersistenceDebugNote(
            `IndexedDB HYDRATION FAILED • Project ${projectId.slice(-8)} was not found`,
          )
        }
        if (!cancelled && hydrationEpoch === projectEpochRef.current) {
          isProjectHydratingRef.current = false
          isProjectMapRouteSettlingRef.current = false
        }
        return
      }
      const measurementState = fromProjectMeasurementData(project)
      if (
        measurementState.segments.length > 0 ||
        measurementState.pendingLineStart
      ) {
        appendPersistenceDebugNote(
          `IndexedDB HYDRATED • ${project.name} (${project.id.slice(-8)}) • ${measurementState.segments.length} segment(s), open endpoint ${measurementState.pendingLineStart ? "yes" : "no"}`,
        )
      }
      appendPersistenceDebugNote(
        `IndexedDB ACTIVE PROJECT OPENED • ${project.name} (${project.id.slice(-8)}) • ${hydrationSource}`,
      )
      const persistedMapCamera = isUsableMapCamera(project.mapCamera)
        ? project.mapCamera
        : null
      const savedPropertyLocation = isUsablePropertyLocation(project.location)
        ? project.location
        : null
      const initialCameraDistanceFeet =
        persistedMapCamera && savedPropertyLocation
          ? haversineDistanceFeet(
              {
                lat: persistedMapCamera.centerLat,
                lng: persistedMapCamera.centerLng,
              },
              {
                lat: savedPropertyLocation.latitude,
                lng: savedPropertyLocation.longitude,
              },
            )
          : null
      const ignoredInitialMapCamera = Boolean(
        persistedMapCamera &&
          savedPropertyLocation &&
          isInitialMapCamera(persistedMapCamera) &&
          initialCameraDistanceFeet !== null &&
          initialCameraDistanceFeet > INITIAL_CAMERA_MISMATCH_FEET,
      )
      const savedMapCamera = ignoredInitialMapCamera
        ? null
        : persistedMapCamera
      if (ignoredInitialMapCamera) {
        appendPersistenceDebugNote(
          `SAVED PROJECT MAP CAMERA IGNORED • ${project.name} (${project.id.slice(-8)}) • persisted camera matches the initial Colorado map center but is ${(initialCameraDistanceFeet! / 5280).toFixed(1)} mi from the saved property; routing to property coordinates instead`,
        )
      }
      const expectedMapRoute: SavedProjectMapRouteDebug = {
        projectId: project.id,
        projectName: project.name,
        propertyLocation: savedPropertyLocation,
        savedCamera: savedMapCamera,
        expectedCamera: savedMapCamera ??
          (savedPropertyLocation
            ? {
                centerLat: savedPropertyLocation.latitude,
                centerLng: savedPropertyLocation.longitude,
                latSpan: SEARCH_MAX_ZOOM_SPAN,
                lngSpan: SEARCH_MAX_ZOOM_SPAN,
              }
            : null),
        expectedRoute: savedMapCamera
          ? "saved camera"
          : savedPropertyLocation
            ? "property location fallback"
            : "unavailable",
      }
      pendingSavedProjectMapRouteDebugRef.current = expectedMapRoute
      isProjectMapRouteSettlingRef.current =
        expectedMapRoute.expectedRoute !== "unavailable"
      appendPersistenceDebugNote(
        `SAVED PROJECT MAP EXPECTED • ${project.name} (${project.id.slice(-8)}) • property ${savedPropertyLocation ? `${savedPropertyLocation.formattedAddress || "unnamed"} @ ${formatCoordinate(savedPropertyLocation.latitude, savedPropertyLocation.longitude)}` : "missing"} • persisted camera ${formatMapCamera(persistedMapCamera)} • opening route ${expectedMapRoute.expectedRoute}`,
      )
      if (expectedMapRoute.expectedRoute === "unavailable") {
        appendPersistenceDebugNote(
          `SAVED PROJECT MAP ACTUAL • ${project.name} (${project.id.slice(-8)}) • no saved camera or valid property coordinates, so no saved-project map route was applied`,
        )
        pendingSavedProjectMapRouteDebugRef.current = null
      }

      currentProjectIdRef.current = project.id
      pendingProjectRef.current = null
      mapCameraRef.current = savedMapCamera
      pendingMapCameraRestoreRef.current = savedMapCamera
      lastPersistedGeometryRef.current = {
        projectId: project.id,
        signature: measurementGeometrySignature(
          measurementState.segments,
          measurementState.pendingLineStart,
        ),
      }
      lastPersistedMapCameraRef.current = {
        projectId: project.id,
        signature: mapCameraSignature(savedMapCamera),
      }
      setCurrentProjectId(project.id)
      setActiveSinglePitch(project.singlePitch ?? "0/12")
      setQuery(project.location?.formattedAddress ?? project.name)
      setSuppressSuggestionsUntilTyping(Boolean(project.location))
      setHasPersistedMapCamera(Boolean(savedMapCamera))
      roofPlanesRef.current = project.planes
      setRoofPlanes(project.planes)
      replaceMeasurementGeometry({
        segments: measurementState.segments,
        pendingLineStart: measurementState.pendingLineStart,
      })
      setIsComeFromArmed(false)
      setPendingModeDecisionPoint(null)
      setPendingModeDecisionAnchor(null)
      setPointActionMenu(null)
      setPlanePitchMenu(null)
      resetSuperZoom()
      setIsSatelliteMapActive(false)
      setSelectedPlace(
        project.location
          ? {
              latitude: project.location.latitude,
              longitude: project.location.longitude,
            }
          : null,
      )
      setProjectHydrated(true)
      isProjectHydratingRef.current = false
    }

    void hydrateProject()

    return () => {
      cancelled = true
    }
  }, [newProjectRequested, projectId])

  function dismissLocationAlert() {
    setIsLocationAlertDismissed(true)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCATION_ALERT_DISMISSED_KEY, "1")
    }
  }

  function restoreLocationAlert() {
    setIsLocationAlertDismissed(false)
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(LOCATION_ALERT_DISMISSED_KEY)
    }
  }

  function replaceMeasurementGeometry(next: MeasurementGeometryState) {
    const normalized = normalizeMeasurementGeometry(next)
    measurementGeometryRef.current = normalized
    setMeasurementSegments(normalized.segments)
    setPendingLineStart(normalized.pendingLineStart)

    const geometry = toProjectMeasurementData(
      normalized.segments,
      normalized.pendingLineStart,
    )
    const nextPlanes = detectRoofPlanes(
      geometry.points,
      geometry.segments,
      roofPlanesRef.current,
    )
    roofPlanesRef.current = nextPlanes
    setRoofPlanes(nextPlanes)
  }

  function persistMeasurementGeometry(next: MeasurementGeometryState) {
    const normalized = normalizeMeasurementGeometry(next)
    const targetProjectId =
      currentProjectIdRef.current ?? pendingProjectRef.current?.id ?? null
    const hasMeasurementGeometry =
      normalized.segments.length > 0 || normalized.pendingLineStart !== null
    if (!targetProjectId && !hasMeasurementGeometry) return

    const signature = measurementGeometrySignature(
      normalized.segments,
      normalized.pendingLineStart,
    )
    if (
      lastPersistedGeometryRef.current?.projectId === targetProjectId &&
      lastPersistedGeometryRef.current.signature === signature
    ) {
      return
    }

    const projectEpoch = projectEpochRef.current
    void saveProjectSnapshot({
      measurementSegments: normalized.segments,
      pendingLineStart: normalized.pendingLineStart,
      targetProjectId,
      projectEpoch,
      debugReason: "measurement",
    }).catch((error) => {
      console.error("Measurement project save failed.", error)
    })
  }

  function resetMeasurementSession() {
    replaceMeasurementGeometry({ segments: [], pendingLineStart: null })
    setIsComeFromArmed(false)
    setPendingModeDecisionPoint(null)
    setPendingModeDecisionAnchor(null)
    setPointActionMenu(null)
    setPlanePitchMenu(null)
    setSegmentTypeMenu(null)
    setIsMeasurementSettingsOpen(false)
  }

  function scheduleProjectionRefresh() {
    if (typeof window === "undefined") return
    if (projectionRefreshFrameRef.current !== null) {
      window.cancelAnimationFrame(projectionRefreshFrameRef.current)
    }

    projectionRefreshFrameRef.current = window.requestAnimationFrame(() => {
      projectionRefreshFrameRef.current = window.requestAnimationFrame(() => {
        projectionRefreshFrameRef.current = null
        setProjectionRevision((current) => current + 1)
      })
    })
  }

  function getMapViewport() {
    const bounds = mapViewportRef.current?.getBoundingClientRect()
    if (!bounds) return null
    return {
      x: bounds.left,
      y: bounds.top,
      width: bounds.width,
      height: bounds.height,
    }
  }

  function getPageOffset() {
    return {
      x: window.scrollX,
      y: window.scrollY,
    }
  }

  function getMapPageOrigin() {
    const bounds = mapRef.current?.getBoundingClientRect()
    if (!bounds) return null
    const pageOffset = getPageOffset()
    return {
      x: bounds.left + pageOffset.x,
      y: bounds.top + pageOffset.y,
    }
  }

  function getMapPagePointFromVisualPagePoint(pagePoint: {
    x: number
    y: number
  }) {
    const viewport = getMapViewport()
    const mapPageOrigin = getMapPageOrigin()
    if (!viewport || !mapPageOrigin) return null

    const mapPagePoint = visualPagePointToMapPagePoint(
      pagePoint,
      viewport,
      getPageOffset(),
      mapPageOrigin,
      precisionZoom,
    )
    return new DOMPoint(mapPagePoint.x, mapPagePoint.y)
  }

  function resetSuperZoom() {
    setPrecisionZoom(DEFAULT_PRECISION_ZOOM)
    superZoomDragRef.current = null
  }

  function setSuperZoomLevel(nextScale: number) {
    const viewport = getMapViewport()
    if (!viewport) return
    setPrecisionZoom((current) =>
      zoomAroundViewportCenter(current, nextScale, viewport),
    )
  }

  const readMapCamera = useCallback((): MapCameraState | null => {
    const region = mapInstanceRef.current?.region
    const centerLat = region?.center.latitude
    const centerLng = region?.center.longitude
    const latSpan = region?.span.latitudeDelta
    const lngSpan = region?.span.longitudeDelta
    if (
      typeof centerLat !== "number" ||
      typeof centerLng !== "number" ||
      typeof latSpan !== "number" ||
      typeof lngSpan !== "number"
    ) {
      return null
    }

    const camera = { centerLat, centerLng, latSpan, lngSpan }
    return isUsableMapCamera(camera) ? camera : null
  }, [])

  const recordSavedProjectMapRoute = useCallback((
    route: SavedProjectMapRouteDebug["expectedRoute"],
  ) => {
    const expected = pendingSavedProjectMapRouteDebugRef.current
    if (!expected || expected.expectedRoute !== route) return

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (pendingSavedProjectMapRouteDebugRef.current !== expected) return

        const actualCamera = readMapCamera()
        const centerDeltaFeet =
          expected.expectedCamera && actualCamera
            ? haversineDistanceFeet(
                {
                  lat: expected.expectedCamera.centerLat,
                  lng: expected.expectedCamera.centerLng,
                },
                {
                  lat: actualCamera.centerLat,
                  lng: actualCamera.centerLng,
                },
              )
            : null
        appendPersistenceDebugNote(
          `SAVED PROJECT MAP ACTUAL • ${expected.projectName} (${expected.projectId.slice(-8)}) • routed via ${route} • expected ${formatMapCamera(expected.expectedCamera)} • actual ${formatMapCamera(actualCamera)}${centerDeltaFeet === null ? "" : ` • center delta ${centerDeltaFeet.toFixed(1)} ft`}`,
        )
        pendingSavedProjectMapRouteDebugRef.current = null
      })
    })
  }, [readMapCamera])

  function restoreMapCamera(camera: MapCameraState) {
    const mapkit = window.mapkit
    const map = mapInstanceRef.current
    if (!mapkit || !map) return

    map.region = new mapkit.CoordinateRegion(
      new mapkit.Coordinate(camera.centerLat, camera.centerLng),
      new mapkit.CoordinateSpan(camera.latSpan, camera.lngSpan),
    )
    recordSavedProjectMapRoute("saved camera")
  }

  function scheduleMapCameraSave() {
    const camera = readMapCamera()
    const targetProjectId = currentProjectIdRef.current
    // MapKit emits region events for its initial Colorado viewport. Do not let
    // that transient region become this project's saved camera before the
    // persisted camera or property-coordinate fallback has been applied.
    if (
      !camera ||
      !targetProjectId ||
      isProjectHydratingRef.current ||
      isProjectMapRouteSettlingRef.current
    )
      return

    mapCameraRef.current = camera
    setHasPersistedMapCamera(true)
    const signature = mapCameraSignature(camera)
    if (
      lastPersistedMapCameraRef.current?.projectId === targetProjectId &&
      lastPersistedMapCameraRef.current.signature === signature
    ) {
      return
    }

    if (cameraSaveTimerRef.current !== null) {
      window.clearTimeout(cameraSaveTimerRef.current)
    }

    const projectEpoch = projectEpochRef.current
    cameraSaveTimerRef.current = window.setTimeout(() => {
      cameraSaveTimerRef.current = null
      if (
        projectEpoch !== projectEpochRef.current ||
        currentProjectIdRef.current !== targetProjectId
      )
        return
      void saveProjectSnapshot({
        mapCamera: camera,
        targetProjectId,
        projectEpoch,
        debugReason: "camera",
      }).catch(() => undefined)
    }, MAP_CAMERA_SAVE_DELAY_MS)
  }

  function prepareForAddressSelection() {
    resetSuperZoom()
    setIsSatelliteMapActive(false)
    mapCameraRef.current = null
    pendingMapCameraRestoreRef.current = null
    setHasPersistedMapCamera(false)
  }

  async function saveProjectSnapshot(options?: {
    projectName?: string
    location?: PropertyLocation | null
    measurementSegments?: MeasurementSegment[]
    pendingLineStart?: MeasurementPoint | null
    roofPlanes?: RoofPlane[]
    mapCamera?: MapCameraState | null
    targetProjectId?: string | null
    startNewProject?: boolean
    projectEpoch?: number
    debugReason?: "measurement" | "camera" | "address" | "plane"
  }) {
    // Only a measurement action is allowed to replace project geometry. Map
    // callbacks and other metadata writes can run with old React closures.
    const hasExplicitMeasurementGeometry = Boolean(
      options &&
      ("measurementSegments" in options || "pendingLineStart" in options),
    )
    const snapshotSegments = hasExplicitMeasurementGeometry
      ? (options?.measurementSegments ?? [])
      : null
    const snapshotPendingLineStart =
      hasExplicitMeasurementGeometry && options && "pendingLineStart" in options
        ? (options.pendingLineStart ?? null)
        : null
    const snapshotQuery = query.trim()
    const snapshotLocation = options?.location
    const snapshotProjectName = options?.projectName
    const requestedProjectId = options?.startNewProject
      ? null
      : options && "targetProjectId" in options
        ? (options.targetProjectId ?? null)
        : currentProjectIdRef.current
    const fallbackProjectName =
      (snapshotProjectName ?? snapshotQuery) ||
      snapshotLocation?.formattedAddress ||
      "Untitled Project"
    const pendingProject = options?.startNewProject
      ? (pendingProjectRef.current = createEmptyProject(fallbackProjectName))
      : requestedProjectId
        ? pendingProjectRef.current?.id === requestedProjectId
          ? pendingProjectRef.current
          : null
        : (pendingProjectRef.current ??
          (pendingProjectRef.current = createEmptyProject(fallbackProjectName)))
    const targetProjectId = requestedProjectId ?? pendingProject?.id ?? null
    const projectEpoch = options?.projectEpoch ?? projectEpochRef.current
    const hasExplicitMapCamera = Boolean(options && "mapCamera" in options)
    const snapshotMapCamera = hasExplicitMapCamera
      ? (options?.mapCamera ?? null)
      : mapCameraRef.current
    const hasExplicitRoofPlanes = Boolean(options && "roofPlanes" in options)
    const snapshotRoofPlanes = options?.roofPlanes
    const persistSnapshot = async () => {
      if (projectEpoch !== projectEpochRef.current) return null
      const existingProject = targetProjectId
        ? await db.getProject(targetProjectId)
        : undefined
      if (
        projectEpoch !== projectEpochRef.current ||
        (targetProjectId && !existingProject && !pendingProject)
      )
        return null
      const projectName =
        snapshotProjectName ??
        existingProject?.name ??
        pendingProject?.name ??
        fallbackProjectName
      const baseProject =
        existingProject ?? pendingProject ?? createEmptyProject(projectName)
      const existingMeasurement = fromProjectMeasurementData(baseProject)
      const geometry = hasExplicitMeasurementGeometry
        ? toProjectMeasurementData(
            snapshotSegments ?? [],
            snapshotPendingLineStart,
          )
        : toProjectMeasurementData(
            existingMeasurement.segments,
            existingMeasurement.pendingLineStart,
          )
      const geometrySignature = measurementGeometrySignature(
        hasExplicitMeasurementGeometry
          ? (snapshotSegments ?? [])
          : existingMeasurement.segments,
        hasExplicitMeasurementGeometry
          ? snapshotPendingLineStart
          : existingMeasurement.pendingLineStart,
      )
      const planes = hasExplicitRoofPlanes
        ? (snapshotRoofPlanes ?? [])
        : detectRoofPlanes(geometry.points, geometry.segments, baseProject.planes)
      if (
        options?.debugReason === "camera" &&
        (existingMeasurement.segments.length > 0 ||
          existingMeasurement.pendingLineStart) &&
        (lastGeometryPreservationNoticeRef.current?.projectId !==
          baseProject.id ||
          lastGeometryPreservationNoticeRef.current.signature !==
            geometrySignature)
      ) {
        lastGeometryPreservationNoticeRef.current = {
          projectId: baseProject.id,
          signature: geometrySignature,
        }
        appendPersistenceDebugNote(
          `IndexedDB CAMERA SAVE PRESERVED • ${baseProject.name} (${baseProject.id.slice(-8)}) • ${existingMeasurement.segments.length} segment(s) left unchanged`,
        )
      }
      let savedProject: Project
      try {
        savedProject = await db.saveProject({
          ...baseProject,
          name: projectName,
          location:
            snapshotLocation === undefined
              ? baseProject.location
              : (snapshotLocation ?? undefined),
          measurementGeometry: geometry.measurementGeometry,
          points: geometry.points,
          segments: geometry.segments,
          planes,
          mapCamera: hasExplicitMapCamera
            ? (snapshotMapCamera ?? undefined)
            : (snapshotMapCamera ?? baseProject.mapCamera),
          lastOpenedAt: new Date().toISOString(),
        })
      } catch (error) {
        if (options?.debugReason === "measurement") {
          appendPersistenceDebugNote(
            `IndexedDB SAVE FAILED • ${geometry.points.length} point(s), ${geometry.segments.length} segment(s) • ${error instanceof Error ? error.message : "unknown error"}`,
          )
        }
        throw error
      }

      const verifiedProject = await db.getProject(savedProject.id)
      const verifiedMeasurement = verifiedProject
        ? fromProjectMeasurementData(verifiedProject)
        : null
      const isVerified = Boolean(
        verifiedProject &&
        verifiedMeasurement &&
        measurementGeometrySignature(
          verifiedMeasurement.segments,
          verifiedMeasurement.pendingLineStart,
        ) === geometrySignature,
      )

      if (options?.debugReason === "measurement") {
        appendPersistenceDebugNote(
          isVerified
            ? `IndexedDB VERIFIED • ${savedProject.name} (${savedProject.id.slice(-8)}) • ${geometry.points.length} point(s), ${geometry.segments.length} segment(s), open endpoint ${snapshotPendingLineStart ? "yes" : "no"}`
            : `IndexedDB VERIFY FAILED • ${savedProject.name} (${savedProject.id.slice(-8)}) • wrote ${geometry.points.length} point(s), reread did not match`,
        )
      }

      if (!isVerified) {
        throw new Error(
          "IndexedDB reread did not match the measurement geometry that was saved.",
        )
      }

      if (projectEpoch !== projectEpochRef.current) return savedProject

      lastPersistedGeometryRef.current = {
        projectId: savedProject.id,
        signature: geometrySignature,
      }
      lastPersistedMapCameraRef.current = {
        projectId: savedProject.id,
        signature: mapCameraSignature(savedProject.mapCamera ?? null),
      }
      if (pendingProjectRef.current?.id === savedProject.id) {
        pendingProjectRef.current = null
      }

      if (currentProjectIdRef.current !== savedProject.id) {
        currentProjectIdRef.current = savedProject.id
        setCurrentProjectId(savedProject.id)
        router.replace(`/?projectId=${savedProject.id}`)
      }

      return savedProject
    }

    const queuedSave = saveQueueRef.current.then(
      persistSnapshot,
      persistSnapshot,
    )
    saveQueueRef.current = queuedSave.then(
      () => undefined,
      () => undefined,
    )
    return queuedSave
  }

  function updateMeasurementPointsMatching(
    sourcePoint: MeasurementPoint,
    nextPoint: MeasurementPoint,
  ) {
    const sourceKey = measurementPointKey(sourcePoint)
    const current = measurementGeometryRef.current
    const next: MeasurementGeometryState = {
      segments: current.segments.map((segment) => ({
        ...segment,
        start:
          measurementPointKey(segment.start) === sourceKey
            ? nextPoint
            : segment.start,
        end:
          measurementPointKey(segment.end) === sourceKey
            ? nextPoint
            : segment.end,
      })),
      pendingLineStart:
        current.pendingLineStart &&
        measurementPointKey(current.pendingLineStart) === sourceKey
          ? nextPoint
          : current.pendingLineStart,
    }
    replaceMeasurementGeometry(next)
    setPendingModeDecisionPoint((currentPoint) =>
      currentPoint && measurementPointKey(currentPoint) === sourceKey
        ? nextPoint
        : currentPoint,
    )
  }

  function getViewportAnchorFromPagePoint(
    pointOnPage: DOMPoint,
  ): DecisionAnchor | null {
    const mapPageOrigin = getMapPageOrigin()
    if (!mapPageOrigin) return null
    const basePoint = mapPagePointToBaseViewportPoint(
      pointOnPage,
      mapPageOrigin,
    )
    return baseViewportPointToVisualViewportPoint(basePoint, precisionZoom)
  }

  function handleTappedCoordinate(
    tappedCoordinate: MeasurementPoint,
    anchor: DecisionAnchor | null,
  ) {
    setPointActionMenu(null)
    setPlanePitchMenu(null)
    setSegmentTypeMenu(null)
    const current = measurementGeometryRef.current
    const tappedPoint = snapPointToMeasurementLine(
      tappedCoordinate,
      current.segments,
    )

    if (!current.pendingLineStart) {
      const next = { ...current, pendingLineStart: tappedPoint }
      replaceMeasurementGeometry(next)
      persistMeasurementGeometry(next)
      setIsComeFromArmed(false)
      setPendingModeDecisionPoint(null)
      setPendingModeDecisionAnchor(null)
      return
    }

    if (isComeFromArmed) {
      const segment = createTieInSegment(
        current.pendingLineStart,
        tappedPoint,
        `${Date.now()}-${current.segments.length}`,
      )
      setIsComeFromArmed(false)

      const next: MeasurementGeometryState = {
        segments: [...current.segments, segment],
        pendingLineStart: tappedPoint,
      }
      replaceMeasurementGeometry(next)
      persistMeasurementGeometry(next)
      setPendingModeDecisionPoint(null)
      setPendingModeDecisionAnchor(null)
      return
    }

    setPendingModeDecisionPoint(tappedPoint)
    setPendingModeDecisionAnchor(anchor)
  }

  function handlePointOnPage(
    pointOnPage: DOMPoint,
    anchor?: DecisionAnchor | null,
  ) {
    const map = mapInstanceRef.current
    if (!map || pendingModeDecisionPoint) return

    const coordinate = map.convertPointOnPageToCoordinate(pointOnPage)
    const latitude = coordinate.latitude
    const longitude = coordinate.longitude
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return
    }
    handleTappedCoordinate(
      {
        latitude,
        longitude,
      },
      anchor ?? getViewportAnchorFromPagePoint(pointOnPage),
    )
  }

  function applyMeasurementModeChoice(mode: "continue" | "start-new") {
    const decisionPoint = pendingModeDecisionPoint
    setIsComeFromArmed(false)
    setPendingModeDecisionPoint(null)
    setPendingModeDecisionAnchor(null)
    setPointActionMenu(null)
    setPlanePitchMenu(null)
    setSegmentTypeMenu(null)
    setIsMeasurementSettingsOpen(false)

    if (!decisionPoint) return

    const current = measurementGeometryRef.current
    if (mode === "continue" && current.pendingLineStart) {
      const next: MeasurementGeometryState = {
        segments: [
          ...current.segments,
          {
            id: `${Date.now()}-${current.segments.length}`,
            start: current.pendingLineStart,
            end: decisionPoint,
          },
        ],
        pendingLineStart: decisionPoint,
      }
      replaceMeasurementGeometry(next)
      persistMeasurementGeometry(next)
      return
    }

    const next = { ...current, pendingLineStart: decisionPoint }
    replaceMeasurementGeometry(next)
    persistMeasurementGeometry(next)
  }

  function removeAnnotation(annotationRef: React.MutableRefObject<unknown>) {
    const map = mapInstanceRef.current
    if (!map || !annotationRef.current) return
    map.removeAnnotation(annotationRef.current)
    annotationRef.current = null
  }

  function clearMeasurementVisuals() {
    const map = mapInstanceRef.current
    if (!map) {
      measurementPointAnnotationRefs.current = []
      measurementLineOverlayRefs.current = []
      measurementLabelAnnotationRefs.current = []
      return
    }

    measurementPointAnnotationRefs.current.forEach((annotation) =>
      map.removeAnnotation(annotation),
    )
    measurementLabelAnnotationRefs.current.forEach((annotation) =>
      map.removeAnnotation(annotation),
    )
    measurementLineOverlayRefs.current.forEach((overlay) =>
      map.removeOverlay(overlay),
    )
    measurementPointAnnotationRefs.current = []
    measurementLineOverlayRefs.current = []
    measurementLabelAnnotationRefs.current = []
  }

  function syncMeasurementVisuals() {
    const mapkit = window.mapkit
    const map = mapInstanceRef.current
    if (!mapkit || !map) return

    clearMeasurementVisuals()
  }

  function openPointActionMenu(point: ProjectedMeasurementPoint) {
    setIsComeFromArmed(false)
    setPendingModeDecisionPoint(null)
    setPendingModeDecisionAnchor(null)
    setPlanePitchMenu(null)
    setSegmentTypeMenu(null)
    const visualPoint = baseViewportPointToVisualViewportPoint(
      { x: point.x, y: point.y },
      precisionZoom,
    )
    setPointActionMenu({
      point: {
        latitude: point.latitude,
        longitude: point.longitude,
      },
      anchor: visualPoint,
    })
  }

  function openPlanePitchMenu(
    event: React.MouseEvent<SVGTextElement>,
    plane: RoofPlane,
  ) {
    event.preventDefault()
    event.stopPropagation()
    setPointActionMenu(null)
    setSegmentTypeMenu(null)
    setPendingModeDecisionPoint(null)
    setPendingModeDecisionAnchor(null)
    setPlanePitchMenu({
      planeId: plane.id,
      anchor: { x: event.clientX, y: event.clientY },
      draft: plane.pitch?.replace(/\/12$/, "") ?? "",
    })
  }

  function openSegmentTypeMenu(
    event: React.MouseEvent<SVGElement>,
    segment: ProjectedMeasurementOverlay["segments"][number],
  ) {
    event.preventDefault()
    event.stopPropagation()
    setPointActionMenu(null)
    setPlanePitchMenu(null)
    setPendingModeDecisionPoint(null)
    setPendingModeDecisionAnchor(null)
    setSegmentTypeMenu({
      segmentId: segment.id,
      anchor: { x: event.clientX, y: event.clientY },
    })
  }

  function setSegmentType(
    segmentId: string,
    type: MeasurementType | undefined,
  ) {
    const current = measurementGeometryRef.current
    const next: MeasurementGeometryState = {
      ...current,
      segments: current.segments.map((segment) =>
        segment.id === segmentId ? { ...segment, type } : segment,
      ),
    }
    replaceMeasurementGeometry(next)
    persistMeasurementGeometry(next)
    setSegmentTypeMenu(null)
  }

  function closeReportTypeAlert() {
    setReportTypeAlert(null)
    setShowNilTypeHighlights(true)
  }

  function requestReport() {
    if (untypedSegmentCount > 0) {
      setShowNilTypeHighlights(false)
      setReportTypeAlert("assign-types")
      return
    }
    setShowNilTypeHighlights(false)
    const currentId = currentProjectIdRef.current
    if (currentId) {
      router.push(`/report?projectId=${encodeURIComponent(currentId)}`)
      return
    }

    void saveProjectSnapshot({
      measurementSegments,
      pendingLineStart,
      roofPlanes,
      debugReason: "measurement",
    }).then((savedProject) => {
      if (savedProject) {
        router.push(`/report?projectId=${encodeURIComponent(savedProject.id)}`)
      }
    })
  }

  function appendPitchCalculationDebug(
    nextPlanes: RoofPlane[],
    change: { planeId: string; previousPitch: string; nextPitch: string },
  ) {
    const project = createLiveCalculationProject(
      measurementSegments,
      pendingLineStart,
      nextPlanes,
      activeSinglePitch,
    )
    const breakdown = getProjectCalculationBreakdown(project)
    const totals = calculateProjectTotals(project)
    const planesById = new Map(nextPlanes.map((plane) => [plane.id, plane]))
    const planeInputs = breakdown.planes
      .map((plane) => {
        const sourcePlane = planesById.get(plane.id)
        const pitchSource = sourcePlane?.pitch
          ? "plane override"
          : `project default ${activeSinglePitch}`
        const individualSides = plane.boundarySegments
          .map(
            (segment, index) =>
              `${index + 1}. ${segment.type ?? "nil"} ${formatCalculationDebugNumber(segment.measuredLengthFeet)} ft`,
          )
          .join(" • ") || "none"
        const lengthsByType = ["ridge", "eave", "rake", "valley", "hip", "wall", "nil"]
          .map((type) => {
            const lengths = plane.boundarySegments
              .filter((segment) => (segment.type ?? "nil") === type)
              .map((segment) => `${formatCalculationDebugNumber(segment.measuredLengthFeet)} ft`)
              .join(", ") || "none"
            return `  ${type} lengths: ${lengths}`
          })
          .join("\n")
        return [
          `Plane ${sourcePlane?.name ?? plane.id.slice(-8)} (${plane.id.slice(-8)})`,
          `  vertices: ${sourcePlane?.pointIds.length ?? 0}`,
          `  pitch used: ${plane.pitch} (${pitchSource})`,
          `  pitch adjustment: ${plane.pitchApplied ? "applied" : "not applied — all boundary sides must be typed and at least two must be rake, hip, valley, or wall"}`,
          `  individual side lengths: ${individualSides}`,
          lengthsByType,
          `  plan area used: ${formatCalculationDebugNumber(plane.planAreaSqFt)} sq ft`,
          `  slope factor used: ${formatCalculationDebugNumber(plane.slopeFactor)}`,
          `  slope area result: ${formatCalculationDebugNumber(plane.slopeAreaSqFt)} sq ft`,
        ].join("\n")
      })
      .join("\n\n") || "No roof planes are currently included in the calculation."

    appendCalculationDebugNote(
      [
        `PITCH CHANGE • project ${query || "Untitled"} (${currentProjectId?.slice(-8) ?? "unsaved"})`,
        `changed plane ${change.planeId.slice(-8)}: ${change.previousPitch} → ${change.nextPitch}`,
        `project default pitch: ${activeSinglePitch}`,
        `planes used by calculator (${breakdown.planes.length}):`,
        planeInputs,
        `totals: plan ${formatCalculationDebugNumber(totals.totalPlanAreaSqFt)} sq ft • slope ${formatCalculationDebugNumber(totals.totalSlopeAreaSqFt)} sq ft • ${formatCalculationDebugNumber(totals.totalSquares)} squares`,
      ].join("\n"),
    )
  }

  function persistRoofPlanes(
    nextPlanes: RoofPlane[],
    pitchChange?: { planeId: string; previousPitch: string; nextPitch: string },
  ) {
    roofPlanesRef.current = nextPlanes
    setRoofPlanes(nextPlanes)
    if (pitchChange) appendPitchCalculationDebug(nextPlanes, pitchChange)
    void saveProjectSnapshot({
      roofPlanes: nextPlanes,
      targetProjectId: currentProjectIdRef.current,
      debugReason: "plane",
    }).catch((error) => {
      console.error("Roof plane save failed.", error)
    })
  }

  function savePlanePitch() {
    const menu = planePitchMenu
    if (!menu) return
    const rise = Number(menu.draft)
    if (!Number.isFinite(rise) || rise < 0) return

    const previousPlane = roofPlanesRef.current.find(
      (plane) => plane.id === menu.planeId,
    )
    const nextPitch = `${rise}/12`
    persistRoofPlanes(
      roofPlanesRef.current.map((plane) =>
        plane.id === menu.planeId
          ? { ...plane, pitch: nextPitch }
          : plane,
      ),
      {
        planeId: menu.planeId,
        previousPitch: previousPlane?.pitch ?? `fallback ${activeSinglePitch}`,
        nextPitch,
      },
    )
    setPlanePitchMenu(null)
  }

  function saveAllPlanePitches() {
    const menu = planePitchMenu
    if (!menu) return
    const rise = Number(menu.draft)
    if (!Number.isFinite(rise) || rise < 0) return

    const nextPitch = `${rise}/12`
    persistRoofPlanes(
      roofPlanesRef.current.map((plane) => ({ ...plane, pitch: nextPitch })),
      {
        planeId: menu.planeId,
        previousPitch: "all planes",
        nextPitch,
      },
    )
    setPlanePitchMenu(null)
  }

  function handleComeToPoint(point: MeasurementPoint) {
    setPendingModeDecisionPoint(null)
    setPendingModeDecisionAnchor(null)
    const current = measurementGeometryRef.current
    const latestPoint =
      current.pendingLineStart ??
      current.segments[current.segments.length - 1]?.end ??
      null
    const next: MeasurementGeometryState = latestPoint
      ? {
          segments: [
            ...current.segments,
            createTieInSegment(
              latestPoint,
              point,
              `${Date.now()}-${current.segments.length}`,
            ),
          ],
          pendingLineStart: point,
        }
      : { ...current, pendingLineStart: point }
    replaceMeasurementGeometry(next)
    persistMeasurementGeometry(next)
    setIsComeFromArmed(false)
    setPointActionMenu(null)
  }

  function handleComeFromPoint(point: MeasurementPoint) {
    setPendingModeDecisionPoint(null)
    setPendingModeDecisionAnchor(null)
    const next = { ...measurementGeometryRef.current, pendingLineStart: point }
    replaceMeasurementGeometry(next)
    persistMeasurementGeometry(next)
    setIsComeFromArmed(true)
    setPointActionMenu(null)
  }

  function handleDeletePoint(point: MeasurementPoint) {
    const targetKey = measurementPointKey(point)
    const current = measurementGeometryRef.current
    const next: MeasurementGeometryState = {
      segments: current.segments.filter(
        (segment) =>
          measurementPointKey(segment.start) !== targetKey &&
          measurementPointKey(segment.end) !== targetKey,
      ),
      pendingLineStart:
        current.pendingLineStart &&
        measurementPointKey(current.pendingLineStart) === targetKey
          ? null
          : current.pendingLineStart,
    }
    replaceMeasurementGeometry(next)
    persistMeasurementGeometry(next)
    if (
      current.pendingLineStart &&
      measurementPointKey(current.pendingLineStart) === targetKey
    ) {
      setIsComeFromArmed(false)
    }
    setPendingModeDecisionPoint((currentPoint) =>
      currentPoint && measurementPointKey(currentPoint) === targetKey
        ? null
        : currentPoint,
    )
    setPointActionMenu(null)
  }

  function buildProjectedMeasurementOverlay(): ProjectedMeasurementOverlay {
    if (typeof window === "undefined") {
      return EMPTY_PROJECTED_MEASUREMENT_OVERLAY
    }

    const mapkit = window.mapkit
    const map = mapInstanceRef.current
    const mapPageOrigin = getMapPageOrigin()
    if (!mapkit || !map || !mapPageOrigin) {
      return EMPTY_PROJECTED_MEASUREMENT_OVERLAY
    }

    const coordinateCtor = mapkit.Coordinate
    const points = new Map<string, ProjectedMeasurementPoint>()
    const segments = measurementSegments.map((segment) => {
      const startPagePoint = map.convertCoordinateToPointOnPage(
        new coordinateCtor(segment.start.latitude, segment.start.longitude),
      )
      const endPagePoint = map.convertCoordinateToPointOnPage(
        new coordinateCtor(segment.end.latitude, segment.end.longitude),
      )
      const start = mapPagePointToBaseViewportPoint(
        startPagePoint,
        mapPageOrigin,
      )
      const end = mapPagePointToBaseViewportPoint(endPagePoint, mapPageOrigin)
      const startX = start.x
      const startY = start.y
      const endX = end.x
      const endY = end.y
      const startKey = measurementPointKey(segment.start)
      const endKey = measurementPointKey(segment.end)

      if (!points.has(startKey)) {
        points.set(startKey, {
          ...segment.start,
          key: startKey,
          x: startX,
          y: startY,
          tone: "solid",
        })
      }

      if (!points.has(endKey)) {
        points.set(endKey, {
          ...segment.end,
          key: endKey,
          x: endX,
          y: endY,
          tone: "solid",
        })
      }

      const lengthFeet = haversineDistanceFeet(
        { lat: segment.start.latitude, lng: segment.start.longitude },
        { lat: segment.end.latitude, lng: segment.end.longitude },
      )

      return {
        id: segment.id,
        type: segment.type,
        startX,
        startY,
        endX,
        endY,
        lengthFeet,
        label: formatMeasurementLabel(lengthFeet, segment.type),
      }
    })

    if (pendingLineStart) {
      const pendingPagePoint = map.convertCoordinateToPointOnPage(
        new coordinateCtor(
          pendingLineStart.latitude,
          pendingLineStart.longitude,
        ),
      )
      points.set(measurementPointKey(pendingLineStart), {
        ...pendingLineStart,
        key: measurementPointKey(pendingLineStart),
        ...mapPagePointToBaseViewportPoint(pendingPagePoint, mapPageOrigin),
        tone: "pending",
      })
    }

    return {
      segments,
      points: Array.from(points.values()),
    }
  }

  useEffect(() => {
    if (!mapReady) {
      setProjectedMeasurementOverlay(EMPTY_PROJECTED_MEASUREMENT_OVERLAY)
      return
    }

    if (typeof window === "undefined") return

    let cancelled = false
    let frameA = 0
    let frameB = 0

    frameA = window.requestAnimationFrame(() => {
      frameB = window.requestAnimationFrame(() => {
        if (cancelled) return
        setProjectedMeasurementOverlay(buildProjectedMeasurementOverlay())
      })
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frameA)
      window.cancelAnimationFrame(frameB)
    }
  }, [
    mapReady,
    projectHydrated,
    measurementSegments,
    pendingLineStart,
    projectionRevision,
    selectedPlace,
    currentProjectId,
  ])

  function syncSelectedPlaceAnnotation(
    place: { latitude: number; longitude: number } | null,
  ) {
    const mapkit = window.mapkit
    const map = mapInstanceRef.current
    if (!mapkit?.MarkerAnnotation || !map) return

    removeAnnotation(selectedPlaceAnnotationRef)

    if (!place || superZoomActive) return

    const annotation = new mapkit.MarkerAnnotation(
      new mapkit.Coordinate(place.latitude, place.longitude),
      {
        color: "#d94b3d",
      },
    )
    selectedPlaceAnnotationRef.current = annotation
    map.addAnnotation(annotation)
  }

  function syncCurrentLocationAnnotation(
    location: { latitude: number; longitude: number } | null,
  ) {
    const mapkit = window.mapkit
    const map = mapInstanceRef.current
    if (!mapkit?.Annotation || !map) return

    removeAnnotation(currentLocationAnnotationRef)

    if (!location) return

    const annotation = new mapkit.Annotation(
      new mapkit.Coordinate(location.latitude, location.longitude),
      () => {
        const element = document.createElement("div")
        element.style.width = "14px"
        element.style.height = "14px"
        element.style.borderRadius = "999px"
        element.style.background = "#0a84ff"
        element.style.border = "3px solid rgba(255,255,255,0.95)"
        element.style.boxShadow =
          "0 0 0 6px rgba(10, 132, 255, 0.18), 0 6px 18px rgba(10, 132, 255, 0.28)"
        return element
      },
      {
        size: { width: 14, height: 14 },
      },
    )

    currentLocationAnnotationRef.current = annotation
    map.addAnnotation(annotation)
  }

  async function loadCurrentLocation() {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setLocationState("unsupported")
      setLocationAlert(
        "Location access is unavailable in this browser. Search will still work, but results may be less local.",
      )
      return
    }

    setLocationState("requesting")

    try {
      const position = await requestCurrentLocation()
      setLocationBias({
        centerLat: position.coords.latitude,
        centerLng: position.coords.longitude,
        latSpan: 0.2,
        lngSpan: 0.2,
        countryCode: "US",
      })
      setCurrentLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      })
      restoreLocationAlert()
      setLocationState("granted")
      setLocationAlert("")
    } catch (error) {
      const geolocationError =
        error && typeof error === "object" && "code" in error
          ? (error as GeolocationPositionError)
          : null

      if (geolocationError) {
        if (geolocationError.code === geolocationError.PERMISSION_DENIED) {
          setLocationState("denied")
          setLocationAlert(
            `Location access is denied for this site. ${safariLocationHelp}`,
          )
          return
        }

        if (geolocationError.code === geolocationError.POSITION_UNAVAILABLE) {
          setLocationState("error")
          setLocationAlert(
            "Your permission is granted, but your location is currently unavailable. Search will continue without local bias.",
          )
          return
        }

        if (geolocationError.code === geolocationError.TIMEOUT) {
          setLocationState("error")
          setLocationAlert(
            "Location lookup timed out. Try again to improve nearby address suggestions.",
          )
          return
        }
      }

      setLocationState("error")
      setLocationAlert(
        "We could not get your location right now. Search will continue without local bias.",
      )
    }
  }

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        await loadMapKit()
        const mapkit = window.mapkit

        if (cancelled || !mapRef.current) return
        if (!mapkit) {
          setSearchState("error")
          setSearchMessage("MapKit did not finish loading.")
          return
        }

        const center = new mapkit.Coordinate(
          INITIAL_MAP_CENTER.lat,
          INITIAL_MAP_CENTER.lng,
        )
        const span = new mapkit.CoordinateSpan(0.04, 0.04)
        const region = new mapkit.CoordinateRegion(center, span)

        mapInstanceRef.current = new mapkit.Map(mapRef.current, {
          region,
          showsCompass: "visible",
          showsMapTypeControl: true,
          mapType: mapkit.MapType?.Standard,
        })
        setMapReady(true)
      } catch (error) {
        console.error("MapKit test page failed to initialize.", error)
        setSearchState("error")
        setSearchMessage(
          error instanceof Error ? error.message : "Map initialization failed.",
        )
      }
    }

    void run()

    return () => {
      cancelled = true
      if (
        typeof window !== "undefined" &&
        projectionRefreshFrameRef.current !== null
      ) {
        window.cancelAnimationFrame(projectionRefreshFrameRef.current)
        projectionRefreshFrameRef.current = null
      }
      if (
        typeof window !== "undefined" &&
        cameraSaveTimerRef.current !== null
      ) {
        window.clearTimeout(cameraSaveTimerRef.current)
        cameraSaveTimerRef.current = null
      }
      setMapReady(false)
      clearMeasurementVisuals()
      selectedPlaceAnnotationRef.current = null
      currentLocationAnnotationRef.current = null
      mapInstanceRef.current?.destroy?.()
      mapInstanceRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!mapReady || !projectHydrated) return
    const camera = pendingMapCameraRestoreRef.current
    if (!camera) return

    restoreMapCamera(camera)
    pendingMapCameraRestoreRef.current = null
    isProjectMapRouteSettlingRef.current = false
    scheduleProjectionRefresh()
  }, [currentProjectId, mapReady, projectHydrated])

  useEffect(() => {
    if (!mapReady || !mapViewportRef.current || !mapInstanceRef.current) return

    function refreshProjectionMetrics() {
      setProjectionRevision((current) => current + 1)
      setPointActionMenu(null)
      scheduleMapCameraSave()
    }

    const map = mapInstanceRef.current
    map.addEventListener("region-change-end", refreshProjectionMetrics)
    map.addEventListener("scroll-end", refreshProjectionMetrics)
    map.addEventListener("zoom-end", refreshProjectionMetrics)

    const resizeObserver = new ResizeObserver(refreshProjectionMetrics)
    resizeObserver.observe(mapViewportRef.current)
    refreshProjectionMetrics()

    return () => {
      map.removeEventListener("region-change-end", refreshProjectionMetrics)
      map.removeEventListener("scroll-end", refreshProjectionMetrics)
      map.removeEventListener("zoom-end", refreshProjectionMetrics)
      resizeObserver.disconnect()
    }
  }, [mapReady])

  useEffect(() => {
    if (!mapReady || !projectHydrated) return
    if (measurementSegments.length === 0 && !pendingLineStart) return
    scheduleProjectionRefresh()
  }, [mapReady, projectHydrated, measurementSegments, pendingLineStart])

  useEffect(() => {
    let permissionStatus: PermissionStatus | null = null
    let cancelled = false

    async function refreshLocationPermission() {
      const permission = await getLocationPermission()
      if (cancelled) return

      if (permissionStatus) {
        permissionStatus.onchange = null
        permissionStatus = null
      }

      if (permission === "granted") {
        setLocationState("granted")
        restoreLocationAlert()
        if (!locationBiasRef.current) {
          setLocationAlert("")
          void loadCurrentLocation()
        } else {
          setLocationAlert("")
        }
        return
      }

      if (permission === "denied") {
        setLocationState("denied")
        setLocationAlert(
          `Location access is denied for this site. ${safariLocationHelp}`,
        )
        return
      }

      if (permission === "prompt") {
        setLocationState("prompt")
        setLocationAlert(
          "Allow location to improve nearby address suggestions.",
        )
      } else {
        setLocationState("unsupported")
        setLocationAlert(
          "Location permission status is unavailable here. Use my location to try the browser geolocation API directly.",
        )
      }

      if (
        !navigator.permissions ||
        typeof navigator.permissions.query !== "function"
      ) {
        return
      }

      try {
        permissionStatus = await navigator.permissions.query({
          name: "geolocation" as PermissionName,
        })
        if (cancelled) return
        permissionStatus.onchange = () => {
          setLocationState(permissionStatus!.state)
          if (permissionStatus!.state === "granted") {
            setLocationAlert("")
            void loadCurrentLocation()
            return
          }

          if (permissionStatus!.state === "denied") {
            setLocationAlert(
              `Location access is denied for this site. ${safariLocationHelp}`,
            )
            return
          }

          setLocationAlert(
            "Allow location to improve nearby address suggestions.",
          )
        }
      } catch {
        if (!cancelled) {
          setLocationState("unsupported")
          setLocationAlert(
            "Location permission status is unavailable here. Use my location to try the browser geolocation API directly.",
          )
        }
      }
    }

    function handleReturnToPage() {
      if (document.visibilityState === "visible") {
        void refreshLocationPermission()
      }
    }

    void refreshLocationPermission()
    window.addEventListener("focus", handleReturnToPage)
    document.addEventListener("visibilitychange", handleReturnToPage)

    return () => {
      cancelled = true
      if (permissionStatus) permissionStatus.onchange = null
      window.removeEventListener("focus", handleReturnToPage)
      document.removeEventListener("visibilitychange", handleReturnToPage)
    }
  }, [])

  useEffect(() => {
    const normalizedQuery = query.trim()

    if (suppressSuggestionsUntilTyping || normalizedQuery.length < 3) {
      setSuggestions([])
      setAutocompleteState("idle")
      setAutocompleteMessage("")
      return
    }

    const controller = new AbortController()
    setAutocompleteState("loading")
    setAutocompleteMessage("")

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const map = mapInstanceRef.current
          const activeBias =
            locationBias ??
            (map
              ? {
                  centerLat: map.region.center.latitude ?? 39.5501,
                  centerLng: map.region.center.longitude ?? -105.7821,
                  latSpan: map.region.span.latitudeDelta ?? 0.2,
                  lngSpan: map.region.span.longitudeDelta ?? 0.2,
                  countryCode: "US",
                }
              : undefined)
          const results = await searchAddressSuggestions(
            normalizedQuery,
            controller.signal,
            activeBias,
          )
          setSuggestions(results)
          setAutocompleteState("success")
          setAutocompleteMessage(
            results.length === 0 ? "No matching addresses found." : "",
          )
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError")
            return
          console.error("Autocomplete failed:", error)
          setSuggestions([])
          setAutocompleteState("error")
          setAutocompleteMessage(
            error instanceof Error ? error.message : "Autocomplete failed.",
          )
        }
      })()
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [locationBias, query])

  function recenterMap(
    latitude: number,
    longitude: number,
    latDelta?: number,
    lngDelta?: number,
  ) {
    const mapkitWindow = window as Window & {
      mapkit?: NonNullable<Window["mapkit"]>
    }
    const map = mapInstanceRef.current
    if (!mapkitWindow.mapkit || !map) {
      throw new Error("Map is not ready yet.")
    }

    const span = map.region?.span
    const region = new mapkitWindow.mapkit.CoordinateRegion(
      new mapkitWindow.mapkit.Coordinate(latitude, longitude),
      new mapkitWindow.mapkit.CoordinateSpan(
        latDelta ?? span?.latitudeDelta ?? 0.01,
        lngDelta ?? span?.longitudeDelta ?? 0.01,
      ),
    )

    map.region = region
  }

  function switchMapToSatelliteAfterSearch() {
    window.setTimeout(() => {
      const mapkit = window.mapkit
      const map = mapInstanceRef.current
      if (!mapkit || !map) return

      map.mapType =
        (
          mapkit.Map as
            { MapTypes?: { Satellite?: typeof map.mapType } } | undefined
        )?.MapTypes?.Satellite ??
        mapkit.MapType?.Satellite ??
        map.mapType
      setIsSatelliteMapActive(true)
    }, 250)
  }

  useEffect(() => {
    if (
      !mapReady ||
      !currentLocation ||
      selectedPlace ||
      hasCenteredOnUserLocationRef.current
    ) {
      return
    }

    recenterMap(currentLocation.latitude, currentLocation.longitude, 0.02, 0.02)
    hasCenteredOnUserLocationRef.current = true
  }, [currentLocation, mapReady, selectedPlace])

  useEffect(() => {
    if (!mapReady) return
    syncCurrentLocationAnnotation(currentLocation)
  }, [currentLocation, mapReady])

  useEffect(() => {
    if (!mapReady) return
    syncSelectedPlaceAnnotation(selectedPlace)
  }, [currentLocation, mapReady, selectedPlace, superZoomActive])

  useEffect(() => {
    if (!mapReady || !selectedPlace) return
    switchMapToSatelliteAfterSearch()

    if (hasPersistedMapCamera || pendingMapCameraRestoreRef.current) return
    recenterMap(
      selectedPlace.latitude,
      selectedPlace.longitude,
      SEARCH_MAX_ZOOM_SPAN,
      SEARCH_MAX_ZOOM_SPAN,
    )
    isProjectMapRouteSettlingRef.current = false
    recordSavedProjectMapRoute("property location fallback")
  }, [
    hasPersistedMapCamera,
    mapReady,
    recordSavedProjectMapRoute,
    selectedPlace,
  ])

  useEffect(() => {
    if (!mapReady || !mapRef.current || !mapInstanceRef.current) return

    function handleMapTap(event: Record<string, unknown>) {
      const pointOnPage = event.pointOnPage as DOMPoint | undefined
      if (!pointOnPage) return
      handlePointOnPage(pointOnPage)
    }

    const map = mapInstanceRef.current
    if (superZoomActive) {
      return
    }
    map.addEventListener("single-tap", handleMapTap)

    return () => {
      map.removeEventListener("single-tap", handleMapTap)
    }
  }, [
    mapReady,
    pendingModeDecisionPoint,
    pendingLineStart,
    isComeFromArmed,
    measurementSegments,
    superZoomActive,
  ])

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    map.isScrollEnabled = !superZoomActive
    map.isZoomEnabled = !superZoomActive
    map.isRotationEnabled = !superZoomActive
    map.isPitchEnabled = !superZoomActive
  }, [superZoomActive])

  useEffect(() => {
    if (!mapReady) return
    syncMeasurementVisuals()
  }, [mapReady, measurementSegments, pendingLineStart, superZoomActive])

  async function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedQuery = query.trim()
    if (!normalizedQuery) {
      setSearchState("error")
      setSearchMessage("Address is required.")
      return
    }

    setSearchState("loading")
    setSearchMessage("")

    try {
      const map = mapInstanceRef.current
      const activeBias =
        locationBias ??
        (map
          ? {
              centerLat: map.region.center.latitude ?? 39.5501,
              centerLng: map.region.center.longitude ?? -105.7821,
              latSpan: map.region.span.latitudeDelta ?? 0.2,
              lngSpan: map.region.span.longitudeDelta ?? 0.2,
              countryCode: "US",
            }
          : undefined)
      const [bestMatch] = await lookupStreetAddressWithBias(
        normalizedQuery,
        activeBias,
      )
      if (
        !bestMatch ||
        typeof bestMatch.latitude !== "number" ||
        typeof bestMatch.longitude !== "number"
      ) {
        setSearchState("error")
        setSearchMessage("No address found.")
        return
      }

      const location = toProjectLocation(bestMatch)
      prepareForAddressSelection()
      setSelectedPlace({
        latitude: bestMatch.latitude,
        longitude: bestMatch.longitude,
      })
      setQuery(location.formattedAddress)
      await saveProjectSnapshot({
        projectName: location.formattedAddress,
        location,
        measurementSegments: [],
        pendingLineStart: null,
        mapCamera: null,
        startNewProject: true,
      })
      setSuppressSuggestionsUntilTyping(true)
      resetMeasurementSession()
      setSuggestions([])
      setAutocompleteState("idle")
      setAutocompleteMessage("")
      setSearchState("idle")
      setSearchMessage("")
    } catch (error) {
      console.error("Address lookup failed:", error)
      setSearchState("error")
      setSearchMessage(
        error instanceof Error ? error.message : "Address lookup failed.",
      )
    }
  }

  async function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file || !file.type.startsWith("image/")) return

    try {
      const { width, height } = await readImageDimensions(file)
      const imageProject = await db.saveImageProject(
        createImageProject(file, width, height),
      )
      router.push(`/image?projectId=${encodeURIComponent(imageProject.id)}`)
    } catch (error) {
      setSearchState("error")
      setSearchMessage(
        error instanceof Error ? error.message : "Could not open this image.",
      )
    }
  }

  async function handleSuggestionSelect(suggestion: AddressSuggestion) {
    setQuery(
      suggestion.formattedAddress ||
        [suggestion.title, suggestion.subtitle].filter(Boolean).join(", "),
    )
    setSuppressSuggestionsUntilTyping(true)
    setSearchState("loading")
    setSearchMessage("")

    try {
      if (
        typeof suggestion.latitude === "number" &&
        typeof suggestion.longitude === "number" &&
        !suggestion.mapkitResult
      ) {
        const location = toProjectLocation(suggestion)
        prepareForAddressSelection()
        setSelectedPlace({
          latitude: suggestion.latitude,
          longitude: suggestion.longitude,
        })
        setQuery(location.formattedAddress)
        await saveProjectSnapshot({
          projectName: location.formattedAddress,
          location,
          measurementSegments: [],
          pendingLineStart: null,
          mapCamera: null,
          startNewProject: true,
        })
        setSuppressSuggestionsUntilTyping(true)
        resetMeasurementSession()
        setSuggestions([])
        setAutocompleteState("idle")
        setAutocompleteMessage("")
        setSearchState("idle")
        setSearchMessage("")
        return
      }

      const map = mapInstanceRef.current
      const activeBias =
        locationBias ??
        (map
          ? {
              centerLat: map.region.center.latitude ?? 39.5501,
              centerLng: map.region.center.longitude ?? -105.7821,
              latSpan: map.region.span.latitudeDelta ?? 0.2,
              lngSpan: map.region.span.longitudeDelta ?? 0.2,
              countryCode: "US",
            }
          : undefined)
      const bestMatch = await searchBestAddressMatch(
        suggestion,
        undefined,
        activeBias,
      )
      if (
        !bestMatch ||
        typeof bestMatch.latitude !== "number" ||
        typeof bestMatch.longitude !== "number"
      ) {
        setSearchState("error")
        setSearchMessage("No address found.")
        return
      }

      const location = toProjectLocation(bestMatch)
      prepareForAddressSelection()
      setSelectedPlace({
        latitude: bestMatch.latitude,
        longitude: bestMatch.longitude,
      })
      setQuery(location.formattedAddress)
      await saveProjectSnapshot({
        projectName: location.formattedAddress,
        location,
        measurementSegments: [],
        pendingLineStart: null,
        mapCamera: null,
        startNewProject: true,
      })
      setSuppressSuggestionsUntilTyping(true)
      resetMeasurementSession()
      setSuggestions([])
      setAutocompleteState("idle")
      setAutocompleteMessage("")
      setSearchState("idle")
      setSearchMessage("")
    } catch (error) {
      console.error("Suggestion lookup failed:", error)
      setSearchState("error")
      setSearchMessage(
        error instanceof Error ? error.message : "Address lookup failed.",
      )
    }
  }

  function handleSuperZoomPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (!superZoomActive) return

    event.currentTarget.setPointerCapture(event.pointerId)
    superZoomDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: superZoomOffsetX,
      originY: superZoomOffsetY,
      dragging: false,
    }
  }

  function handleSuperZoomPointerMove(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const drag = superZoomDragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !superZoomActive) return

    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (!drag.dragging && Math.hypot(deltaX, deltaY) > 4) {
      drag.dragging = true
    }

    if (!drag.dragging) return

    const viewport = getMapViewport()
    if (!viewport) return
    setPrecisionZoom((current) =>
      clampPrecisionZoomTransform(
        {
          ...current,
          offsetX: drag.originX + deltaX,
          offsetY: drag.originY + deltaY,
        },
        viewport,
      ),
    )
    setPointActionMenu(null)
  }

  function handleSuperZoomPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = superZoomDragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !superZoomActive) return

    event.currentTarget.releasePointerCapture(event.pointerId)
    superZoomDragRef.current = null

    if (drag.dragging) return

    const pointOnPage = getMapPagePointFromVisualPagePoint({
      x: event.pageX,
      y: event.pageY,
    })
    if (!pointOnPage) return
    const bounds = mapViewportRef.current?.getBoundingClientRect()
    handlePointOnPage(
      pointOnPage,
      bounds
        ? {
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
          }
        : null,
    )
  }

  function handleSuperZoomPointerCancel(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (superZoomDragRef.current?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId)
      superZoomDragRef.current = null
    }
  }

  function handleMeasurementPointPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    point: MeasurementPoint,
  ) {
    event.stopPropagation()
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    measurementPointDragRef.current = {
      pointerId: event.pointerId,
      sourcePoint: point,
    }
  }

  function handleMeasurementPointPointerMove(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    const drag = measurementPointDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    event.stopPropagation()
    event.preventDefault()

    const map = mapInstanceRef.current
    const pointOnPage = getMapPagePointFromVisualPagePoint({
      x: event.pageX,
      y: event.pageY,
    })
    if (!map || !pointOnPage) return

    const coordinate = map.convertPointOnPageToCoordinate(pointOnPage)
    const latitude = coordinate.latitude
    const longitude = coordinate.longitude
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return
    }
    const nextPoint = {
      latitude,
      longitude,
    }
    updateMeasurementPointsMatching(drag.sourcePoint, nextPoint)
    drag.sourcePoint = nextPoint
  }

  function handleMeasurementPointPointerUp(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    const drag = measurementPointDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    event.stopPropagation()
    event.preventDefault()
    event.currentTarget.releasePointerCapture(event.pointerId)
    measurementPointDragRef.current = null
    persistMeasurementGeometry(measurementGeometryRef.current)
  }

  function handleMeasurementPointPointerCancel(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (measurementPointDragRef.current?.pointerId === event.pointerId) {
      event.stopPropagation()
      event.preventDefault()
      event.currentTarget.releasePointerCapture(event.pointerId)
      measurementPointDragRef.current = null
      persistMeasurementGeometry(measurementGeometryRef.current)
    }
  }

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        background: "#d9ddd8",
      }}
    >
      <input
        ref={imageUploadInputRef}
        className="sr-only"
        type="file"
        accept="image/*"
        onChange={(event) => void handleImageUpload(event)}
      />
      <form
        onSubmit={handleSearchSubmit}
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 3,
          width: "min(420px, calc(100vw - 32px))",
          display: "grid",
          gap: 8,
        }}
      >
        {locationAlert && !isLocationAlertDismissed ? (
          <div
            role="alert"
            style={{
              display: "grid",
              gap: 8,
              padding: "12px 14px",
              borderRadius: 16,
              background: "rgba(255, 248, 235, 0.96)",
              border: "1px solid rgba(201, 111, 48, 0.25)",
              color: "#5f3b16",
              boxShadow: "0 10px 24px rgba(20, 24, 22, 0.12)",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  fontWeight: 600,
                }}
              >
                <MapPin size={16} />
                Location access
              </div>
              <button
                type="button"
                aria-label="Dismiss location access message"
                onClick={dismissLocationAlert}
                style={{
                  border: 0,
                  background: "transparent",
                  color: "#8a6030",
                  cursor: "pointer",
                  fontSize: 18,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>
            <div style={{ fontSize: 14 }}>{locationAlert}</div>
            {locationState === "prompt" ||
            locationState === "error" ||
            locationState === "idle" ? (
              <button
                type="button"
                onClick={() => void loadCurrentLocation()}
                style={{
                  justifySelf: "start",
                  borderRadius: 12,
                  border: "1px solid rgba(95, 59, 22, 0.18)",
                  background: "rgba(255,255,255,0.9)",
                  padding: "8px 10px",
                  color: "#5f3b16",
                  cursor: "pointer",
                }}
              >
                Use my location
              </button>
            ) : null}
            {locationState === "granted" && locationBias ? (
              <div style={{ fontSize: 13, color: "#6d4a22" }}>
                Using location near {locationBias.centerLat.toFixed(4)},{" "}
                {locationBias.centerLng.toFixed(4)}.
              </div>
            ) : null}
            {locationState === "denied" ? (
              <div style={{ fontSize: 13, color: "#6d4a22" }}>
                Open Safari page settings for `localhost`, allow Location, then
                reload.
              </div>
            ) : null}
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            borderRadius: 18,
            background: "rgba(255, 255, 255, 0.92)",
            border: "1px solid rgba(31, 37, 34, 0.12)",
            boxShadow: "0 14px 50px rgba(20, 24, 22, 0.16)",
          }}
        >
          <Search size={18} color="#5f685f" />
          <input
            aria-label="Search address"
            value={query}
            onChange={(event) => {
              setSuppressSuggestionsUntilTyping(false)
              setQuery(event.target.value)
            }}
            placeholder="Search street address"
            style={{
              flex: 1,
              border: 0,
              outline: "none",
              background: "transparent",
              color: "#1f2522",
              fontSize: 16,
            }}
          />
        </div>
        <div style={{ display: "grid", justifyItems: "start", gap: 4 }}>
          {isSatelliteMapActive ? <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "min(236px, 100%)",
              padding: "7px 10px",
              borderRadius: 14,
              background: "rgba(255, 255, 255, 0.94)",
              border: "1px solid rgba(31, 37, 34, 0.12)",
              boxShadow: "0 10px 24px rgba(20, 24, 22, 0.12)",
              color: "#1f2522",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <span>Zoom {superZoomScale}x</span>
            <input
              aria-label="Super Zoom level"
              type="range"
              min="0"
              max={PRECISION_ZOOM_LEVELS.length - 1}
              step="1"
              value={Math.max(
                0,
                PRECISION_ZOOM_LEVELS.findIndex(
                  (scale) => scale === superZoomScale,
                ),
              )}
              onChange={(event) => {
                const scale = PRECISION_ZOOM_LEVELS[Number(event.target.value)]
                if (scale !== undefined) setSuperZoomLevel(scale)
              }}
              style={{ flex: 1, minWidth: 0, accentColor: "#1f2522" }}
            />
          </label> : null}
          <button
            type="button"
            onClick={() => setIsMeasurementSettingsOpen((current) => !current)}
            style={{
              border: "1px solid rgba(31, 37, 34, 0.12)",
              background: "rgba(255, 255, 255, 0.94)",
              color: "#1f2522",
              borderRadius: 999,
              padding: "8px 12px",
              fontSize: 13,
              fontWeight: 600,
              boxShadow: "0 10px 24px rgba(20, 24, 22, 0.12)",
              cursor: "pointer",
            }}
          >
            Options
          </button>
          {isMeasurementSettingsOpen ? (
            <div
              style={{
                display: "grid",
                gap: 8,
                padding: 10,
                width: "min(236px, 100%)",
                borderRadius: 16,
                background: "rgba(255, 255, 255, 0.96)",
                border: "1px solid rgba(31, 37, 34, 0.12)",
                boxShadow: "0 14px 50px rgba(20, 24, 22, 0.16)",
              }}
            >
              <button
                type="button"
                onClick={() => imageUploadInputRef.current?.click()}
                style={{
                  border: 0,
                  borderRadius: 12,
                  padding: "10px 12px",
                  background: "rgba(31, 37, 34, 0.08)",
                  color: "#1f2522",
                  cursor: "pointer",
                }}
              >
                Upload Image
              </button>
              <button
                type="button"
                onClick={() => router.push("/projects")}
                style={{
                  border: 0,
                  borderRadius: 12,
                  padding: "10px 12px",
                  background: "rgba(31, 37, 34, 0.08)",
                  color: "#1f2522",
                  cursor: "pointer",
                }}
              >
                Projects
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsMeasurementSettingsOpen(false)
                  setTutorialReplayVersion((current) => current + 1)
                }}
                style={{
                  border: 0,
                  borderRadius: 12,
                  padding: "10px 12px",
                  background: "rgba(31, 37, 34, 0.08)",
                  color: "#1f2522",
                  cursor: "pointer",
                }}
              >
                Tutorial
              </button>
            </div>
          ) : null}
        </div>
        {suggestions.length > 0 ? (
          <div
            style={{
              display: "grid",
              gap: 6,
              padding: 8,
              borderRadius: 18,
              background: "rgba(255, 255, 255, 0.96)",
              border: "1px solid rgba(31, 37, 34, 0.12)",
              boxShadow: "0 14px 50px rgba(20, 24, 22, 0.16)",
            }}
          >
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                onClick={() => void handleSuggestionSelect(suggestion)}
                style={{
                  textAlign: "left",
                  border: 0,
                  background: "transparent",
                  borderRadius: 12,
                  padding: "10px 12px",
                  color: "#1f2522",
                  cursor: "pointer",
                }}
              >
                {(
                  suggestion.mapkitResult as
                    { displayLines?: string[] } | undefined
                )?.displayLines?.join(", ") ||
                  [suggestion.title, suggestion.subtitle]
                    .filter(Boolean)
                    .join(", ")}
              </button>
            ))}
          </div>
        ) : null}
        {autocompleteState !== "idle" && suggestions.length === 0 ? (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              background: "rgba(255, 255, 255, 0.92)",
              border: "1px solid rgba(31, 37, 34, 0.12)",
              color: autocompleteState === "error" ? "#b43f2d" : "#1f2522",
              fontSize: 14,
              boxShadow: "0 10px 24px rgba(20, 24, 22, 0.12)",
            }}
          >
            {autocompleteState === "loading"
              ? "Searching suggestions..."
              : autocompleteMessage}
          </div>
        ) : null}
        {searchMessage ? (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              background: "rgba(255, 255, 255, 0.92)",
              border: "1px solid rgba(31, 37, 34, 0.12)",
              color: searchState === "error" ? "#b43f2d" : "#1f2522",
              fontSize: 14,
              boxShadow: "0 10px 24px rgba(20, 24, 22, 0.12)",
            }}
          >
            {searchState === "loading" ? "Searching..." : searchMessage}
          </div>
        ) : searchState === "loading" ? (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              background: "rgba(255, 255, 255, 0.92)",
              border: "1px solid rgba(31, 37, 34, 0.12)",
              color: "#1f2522",
              fontSize: 14,
              boxShadow: "0 10px 24px rgba(20, 24, 22, 0.12)",
            }}
          >
            Searching...
          </div>
        ) : null}
      </form>
      {pendingModeDecisionPoint && pendingModeDecisionAnchor ? (
        <div
          style={{
            position: "absolute",
            left:
              pendingModeDecisionAnchor.x > window.innerWidth - 176
                ? pendingModeDecisionAnchor.x - 156
                : pendingModeDecisionAnchor.x + 20,
            top: Math.min(
              Math.max(pendingModeDecisionAnchor.y - 44, 12),
              window.innerHeight - 144,
            ),
            zIndex: 3,
            display: "grid",
            gap: 8,
            width: 136,
            padding: 12,
            borderRadius: 16,
            background: "rgba(255, 255, 255, 0.97)",
            border: "1px solid rgba(31, 37, 34, 0.12)",
            boxShadow: "0 14px 50px rgba(20, 24, 22, 0.16)",
          }}
        >
          <button
            type="button"
            onClick={() => applyMeasurementModeChoice("continue")}
            style={{
              border: 0,
              borderRadius: 12,
              padding: "10px 12px",
              background: "#1f2522",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Continue
          </button>
          <button
            type="button"
            onClick={() => applyMeasurementModeChoice("start-new")}
            style={{
              border: 0,
              borderRadius: 12,
              padding: "10px 12px",
              background: "rgba(31, 37, 34, 0.08)",
              color: "#1f2522",
              cursor: "pointer",
            }}
          >
            Start New
          </button>
          <button
            type="button"
            onClick={() => {
              setPendingModeDecisionPoint(null)
              setPendingModeDecisionAnchor(null)
            }}
            style={{
              border: 0,
              padding: "3px 4px 0",
              background: "transparent",
              color: "rgba(31, 37, 34, 0.62)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      ) : null}
      {pointActionMenu ? (
        <div
          style={{
            position: "absolute",
            left:
              pointActionMenu.anchor.x > window.innerWidth - 176
                ? pointActionMenu.anchor.x - 156
                : pointActionMenu.anchor.x + 20,
            top: Math.min(
              Math.max(pointActionMenu.anchor.y - 44, 12),
              window.innerHeight - 160,
            ),
            zIndex: 3,
            display: "grid",
            gap: 8,
            width: 136,
            padding: 12,
            borderRadius: 16,
            background: "rgba(255, 255, 255, 0.97)",
            border: "1px solid rgba(31, 37, 34, 0.12)",
            boxShadow: "0 14px 50px rgba(20, 24, 22, 0.16)",
          }}
        >
          <button
            type="button"
            onClick={() => handleComeToPoint(pointActionMenu.point)}
            style={{
              border: 0,
              borderRadius: 12,
              padding: "10px 12px",
              background: "#1f2522",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Come To
          </button>
          <button
            type="button"
            onClick={() => handleComeFromPoint(pointActionMenu.point)}
            style={{
              border: 0,
              borderRadius: 12,
              padding: "10px 12px",
              background: "rgba(31, 37, 34, 0.08)",
              color: "#1f2522",
              cursor: "pointer",
            }}
          >
            Come From
          </button>
          <button
            type="button"
            onClick={() => handleDeletePoint(pointActionMenu.point)}
            style={{
              border: 0,
              borderRadius: 12,
              padding: "10px 12px",
              background: "rgba(184, 53, 47, 0.1)",
              color: "#a62d27",
              cursor: "pointer",
            }}
          >
            Delete
          </button>
        </div>
      ) : null}
      {planePitchMenu ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            savePlanePitch()
          }}
          style={{
            position: "absolute",
            left: Math.min(
              Math.max(planePitchMenu.anchor.x - 82, 12),
              window.innerWidth - 176,
            ),
            top: Math.min(
              Math.max(planePitchMenu.anchor.y + 16, 12),
              window.innerHeight - 132,
            ),
            zIndex: 4,
            display: "grid",
            gap: 10,
            width: 164,
            padding: 12,
            borderRadius: 16,
            background: "rgba(255, 255, 255, 0.97)",
            border: "1px solid rgba(31, 37, 34, 0.12)",
            boxShadow: "0 14px 50px rgba(20, 24, 22, 0.16)",
          }}
        >
          <label
            style={{
              display: "grid",
              gap: 6,
              color: "#1f2522",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            Pitch
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                aria-label="Roof pitch rise"
                type="number"
                min="0"
                max="36"
                step="0.25"
                autoFocus
                value={planePitchMenu.draft}
                onChange={(event) =>
                  setPlanePitchMenu((current) =>
                    current ? { ...current, draft: event.target.value } : null,
                  )
                }
                style={{
                  width: 72,
                  border: "1px solid rgba(31, 37, 34, 0.18)",
                  borderRadius: 10,
                  padding: "8px 9px",
                  color: "#1f2522",
                  fontSize: 14,
                }}
              />
              <span style={{ color: "#5f685f", fontSize: 14 }}>/12</span>
            </span>
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              style={{
                flex: 1,
                border: 0,
                borderRadius: 10,
                padding: "8px 10px",
                background: "#1f2522",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={saveAllPlanePitches}
              style={{
                flex: 1,
                border: 0,
                borderRadius: 10,
                padding: "8px 10px",
                background: "rgba(31, 37, 34, 0.08)",
                color: "#1f2522",
                cursor: "pointer",
              }}
            >
              Save All
            </button>
          </div>
        </form>
      ) : null}
      {segmentTypeMenu ? (
        <div
          style={{
            position: "absolute",
            left: Math.min(
              Math.max(segmentTypeMenu.anchor.x - 68, 12),
              window.innerWidth - 148,
            ),
            top: Math.min(
              Math.max(segmentTypeMenu.anchor.y + 16, 12),
              window.innerHeight - 278,
            ),
            zIndex: 4,
            display: "grid",
            gap: 6,
            width: 136,
            padding: 10,
            borderRadius: 16,
            background: "rgba(255, 255, 255, 0.97)",
            border: "1px solid rgba(31, 37, 34, 0.12)",
            boxShadow: "0 14px 50px rgba(20, 24, 22, 0.16)",
          }}  
        >
          {SEGMENT_TYPE_OPTIONS.map((option) => (
            <button
              key={option.type}
              type="button"
              onClick={() => setSegmentType(segmentTypeMenu.segmentId, option.type)}
              style={{
                border: 0,
                borderRadius: 10,
                padding: "8px 10px",
                background: "rgba(31, 37, 34, 0.08)",
                color: "#1f2522",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {liveCalculations.segmentCount > 0 ? (
        <button
          type="button"
          onClick={requestReport}
          style={{
            position: "absolute",
            right: 14,
            bottom: 14,
            zIndex: 3,
            border: 0,
            borderRadius: 999,
            padding: "8px 12px",
            background: "rgba(31, 37, 34, 0.88)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          View Report
        </button>
      ) : null}
      <div
        ref={mapViewportRef}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            transform: `translate(${superZoomOffsetX}px, ${superZoomOffsetY}px) scale(${superZoomScale})`,
            transformOrigin: "top left",
            willChange: superZoomActive ? "transform" : undefined,
          }}
        >
          <div
            ref={mapRef}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 0,
            }}
          />
        </div>
        {measurementSegments.length > 0 || pendingLineStart ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 2,
              pointerEvents: "none",
            }}
          >
            <svg
              width="100%"
              height="100%"
              style={{ position: "absolute", inset: 0, overflow: "visible" }}
            >
              {projectedRoofPlanes.map((plane) => {
                const visualPoints = plane.points.map((point) =>
                  baseViewportPointToVisualViewportPoint(
                    { x: point.x, y: point.y },
                    precisionZoom,
                  ),
                )
                const labelCenter = polygonLabelCenter(visualPoints)

                return (
                  <g key={plane.id}>
                    <polygon
                      points={visualPoints
                        .map((point) => `${point.x},${point.y}`)
                        .join(" ")}
                      fill="rgba(40, 128, 255, 0.5)"
                      stroke="rgba(22, 91, 196, 0.9)"
                      strokeWidth={2}
                      strokeLinejoin="round"
                      style={{ pointerEvents: "none" }}
                    />
                    <text
                      x={labelCenter.x}
                      y={labelCenter.y}
                      fill="#fff"
                      stroke="#000"
                      strokeWidth={3}
                      paintOrder="stroke"
                      strokeLinejoin="round"
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={10}
                      fontWeight={800}
                      style={{ pointerEvents: "auto", cursor: "pointer" }}
                      onClick={(event) => openPlanePitchMenu(event, plane)}
                    >
                      {plane.pitch?.replace(/12$/, "") ?? "?/12"}
                    </text>
                  </g>
                )
              })}
              {projectedMeasurementOverlay.segments.map((segment) => {
                const start = baseViewportPointToVisualViewportPoint(
                  { x: segment.startX, y: segment.startY },
                  precisionZoom,
                )
                const end = baseViewportPointToVisualViewportPoint(
                  { x: segment.endX, y: segment.endY },
                  precisionZoom,
                )
                const dx = end.x - start.x
                const dy = end.y - start.y
                const length = Math.hypot(dx, dy) || 1
                const labelOffset = segment.lengthFeet > 6 ? 0 : 17
                const labelX =
                  (start.x + end.x) / 2 + (-dy / length) * labelOffset
                const labelY =
                  (start.y + end.y) / 2 + (dx / length) * labelOffset

                return (
                  <g key={segment.id}>
                    <line
                      x1={start.x}
                      y1={start.y}
                      x2={end.x}
                      y2={end.y}
                      stroke="#e0b93b"
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeDasharray="6 6"
                    />
                    <g transform={`translate(${labelX} ${labelY})`}>
                      {showNilTypeHighlights && !segment.type ? (
                        <circle
                          cx={0}
                          cy={0}
                          r={15}
                          fill="rgba(200, 54, 42, 0.9)"
                          stroke="rgba(255, 255, 255, 0.88)"
                          strokeWidth={1.5}
                          style={{ pointerEvents: "auto", cursor: "pointer" }}
                          onClick={(event) => openSegmentTypeMenu(event, segment)}
                        />
                      ) : null}
                      <text
                        x={0}
                        y={3.5}
                        fill="#ffff00"
                        stroke="#000"
                        strokeWidth={3}
                        paintOrder="stroke"
                        strokeLinejoin="round"
                        textAnchor="middle"
                        fontSize={10}
                        fontWeight={700}
                        style={{ pointerEvents: "auto", cursor: "pointer" }}
                        onClick={(event) => openSegmentTypeMenu(event, segment)}
                      >
                        {segment.label}
                      </text>
                    </g>
                  </g>
                )
              })}
            </svg>
            {projectedMeasurementOverlay.points.map((point) => {
              const visualPoint = baseViewportPointToVisualViewportPoint(
                { x: point.x, y: point.y },
                precisionZoom,
              )

              return (
                <button
                  key={`${point.key}:${point.tone}`}
                  type="button"
                  onPointerDown={(event) =>
                    handleMeasurementPointPointerDown(event, point)
                  }
                  onPointerMove={handleMeasurementPointPointerMove}
                  onPointerUp={handleMeasurementPointPointerUp}
                  onPointerCancel={handleMeasurementPointPointerCancel}
                  onClick={() => openPointActionMenu(point)}
                  style={{
                    position: "absolute",
                    left: visualPoint.x,
                    top: visualPoint.y,
                    width: 28,
                    height: 28,
                    transform: "translate(-50%, -50%)",
                    borderRadius: 999,
                    border: 0,
                    background: "transparent",
                    padding: 0,
                    cursor: "grab",
                    pointerEvents: "auto",
                    touchAction: "none",
                    display: "grid",
                    placeItems: "center",
                  }}
                  aria-label="Move measurement point"
                >
                  <span
                    style={{
                      display: "block",
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      border:
                        point.tone === "pending"
                          ? "2px solid #1f2522"
                          : "2px solid rgba(255,255,255,0.95)",
                      background:
                        point.tone === "pending" ? "#ffffff" : "#1f2522",
                      boxShadow: "0 6px 18px rgba(20, 24, 22, 0.22)",
                    }}
                  />
                </button>
              )
            })}
          </div>
        ) : null}
        {superZoomActive ? (
          <div
            onPointerDown={handleSuperZoomPointerDown}
            onPointerMove={handleSuperZoomPointerMove}
            onPointerUp={handleSuperZoomPointerUp}
            onPointerCancel={handleSuperZoomPointerCancel}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 1,
              touchAction: "none",
              cursor: superZoomDragRef.current?.dragging ? "grabbing" : "grab",
            }}
          />
        ) : null}
      </div>
      {reportTypeAlert ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-type-alert-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 20,
            display: "grid",
            placeItems: "center",
            padding: 20,
            background: "rgba(20, 24, 22, 0.42)",
          }}
        >
          {reportTypeAlert === "assign-types" ? (
            <section
              style={{
                width: "min(400px, 100%)",
                display: "grid",
                gap: 16,
                overflow: "hidden",
                borderRadius: 20,
                background: "#fff",
                boxShadow: "0 20px 50px rgba(20, 24, 22, 0.28)",
              }}
            >
              <div style={{ display: "grid", gap: 8, padding: "20px 20px 0" }}>
                <h2 id="report-type-alert-title" style={{ margin: 0, color: "#1f2522", fontSize: 19 }}>
                  Assign each line a type
                </h2>
                <p style={{ margin: 0, color: "#5f685f", fontSize: 14, lineHeight: 1.5 }}>
                  Before viewing the report, tap the foot count on every map line and choose its type: ridge, hip, valley, rake, eave, or wall.
                </p>
              </div>
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  padding: "14px 20px 20px",
                  borderTop: "1px solid rgba(31, 37, 34, 0.1)",
                  background: "#f7f6f1",
                }}
              >
                <span style={{ color: "#5f685f", fontSize: 12, fontWeight: 700 }}>
                  Tap a foot count like this:
                </span>
                <svg viewBox="0 0 260 52" width="100%" height="52" aria-label="Example measurement line">
                  <line x1="38" y1="26" x2="222" y2="26" stroke="#e0b93b" strokeWidth="3" strokeLinecap="round" strokeDasharray="6 6" />
                  <circle cx="38" cy="26" r="5" fill="#1f2522" stroke="rgba(255,255,255,0.95)" strokeWidth="2" />
                  <circle cx="222" cy="26" r="5" fill="#1f2522" stroke="rgba(255,255,255,0.95)" strokeWidth="2" />
                  <circle cx="130" cy="26" r="15" fill="rgba(200, 54, 42, 0.9)" stroke="rgba(255, 255, 255, 0.88)" strokeWidth="1.5" />
                  <line x1="116" y1="35" x2="144" y2="35" stroke="#4169e1" strokeWidth="1" />
                  <text
                    x="130"
                    y="31"
                    fill="#ffff00"
                    textAnchor="middle"
                    fontSize="15"
                    fontWeight="700"
                    style={{ cursor: "pointer", pointerEvents: "auto" }}
                    onClick={() => setReportTypeAlert("type-confirmed")}
                  >
                    15&apos;
                  </text>
                </svg>
                <button
                  type="button"
                  onClick={closeReportTypeAlert}
                  style={{
                    justifySelf: "end",
                    border: 0,
                    borderRadius: 10,
                    padding: "9px 14px",
                    background: "#1f2522",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Okay
                </button>
              </div>
            </section>
          ) : (
            <section
              style={{
                width: "min(360px, 100%)",
                display: "grid",
                gap: 16,
                padding: 20,
                borderRadius: 20,
                background: "#fff",
                boxShadow: "0 20px 50px rgba(20, 24, 22, 0.28)",
              }}
            >
              <h2 id="report-type-alert-title" style={{ margin: 0, color: "#1f2522", fontSize: 19 }}>
                That&apos;s right!
              </h2>
              <p style={{ margin: 0, color: "#5f685f", fontSize: 14, lineHeight: 1.5 }}>
                Now do that on the real map lines.
              </p>
              <button
                type="button"
                onClick={closeReportTypeAlert}
                style={{
                  justifySelf: "end",
                  border: 0,
                  borderRadius: 10,
                  padding: "9px 14px",
                  background: "#1f2522",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Okay
              </button>
            </section>
          )}
        </div>
      ) : null}
      <FirstRunOnboarding replayVersion={tutorialReplayVersion} />
    </main>
  )
}
