import { GeographicPoint, MapCameraState } from "@/types/models";
import { roundMeasurement } from "@/lib/measurement/rounding";

const EARTH_RADIUS_METERS = 6371008.8;

export function haversineDistanceFeet(start: Pick<GeographicPoint, "lat" | "lng">, end: Pick<GeographicPoint, "lat" | "lng">) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(end.lat - start.lat);
  const dLng = toRadians(end.lng - start.lng);
  const startLat = toRadians(start.lat);
  const endLat = toRadians(end.lat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const meters = EARTH_RADIUS_METERS * c;
  return meters * 3.28084;
}

export function polygonAreaSqFt(points: Array<Pick<GeographicPoint, "lat" | "lng">>) {
  if (points.length < 3) return 0;
  const avgLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const metersPerDegLat = 111132.92;
  const metersPerDegLng = 111412.84 * Math.cos((avgLat * Math.PI) / 180);
  const xy = points.map((point) => ({
    x: point.lng * metersPerDegLng,
    y: point.lat * metersPerDegLat
  }));

  let area = 0;
  for (let index = 0; index < xy.length; index += 1) {
    const current = xy[index];
    const next = xy[(index + 1) % xy.length];
    area += current.x * next.y - next.x * current.y;
  }

  return Math.abs(area / 2) * 10.7639;
}

/**
 * Uses the rounded side labels for rectangular roof planes. Other polygons
 * retain their coordinate-based area because their side lengths alone do not
 * uniquely determine an area.
 */
export function roundedPolygonAreaSqFt(
  points: Array<Pick<GeographicPoint, "lat" | "lng">>,
) {
  const coordinateAreaSqFt = polygonAreaSqFt(points);
  if (points.length !== 4) return roundMeasurement(coordinateAreaSqFt);

  const averageLatitude =
    points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const metersPerDegLat = 111132.92;
  const metersPerDegLng =
    111412.84 * Math.cos((averageLatitude * Math.PI) / 180);
  const vertices = points.map((point) => ({
    x: point.lng * metersPerDegLng,
    y: point.lat * metersPerDegLat,
  }));
  const edges = vertices.map((point, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return { x: next.x - point.x, y: next.y - point.y };
  });
  const edgeLengths = edges.map((edge) => Math.hypot(edge.x, edge.y));
  const isRectangle = edges.every((edge, index) => {
    const next = edges[(index + 1) % edges.length];
    const denominator = edgeLengths[index] * edgeLengths[(index + 1) % edgeLengths.length];
    return denominator > 0 && Math.abs(edge.x * next.x + edge.y * next.y) / denominator <= 0.05;
  });
  if (!isRectangle) return roundMeasurement(coordinateAreaSqFt);

  const roundedEdges = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return roundMeasurement(haversineDistanceFeet(point, next));
  });
  if (
    roundedEdges[0] !== roundedEdges[2] ||
    roundedEdges[1] !== roundedEdges[3]
  ) {
    return roundMeasurement(coordinateAreaSqFt);
  }

  return roundedEdges[0] * roundedEdges[1];
}

export function pitchFactor(pitch: string) {
  const match = pitch.match(/^(\d+(?:\.\d+)?)\/12$/);
  if (!match) return 1;
  const rise = Number(match[1]);
  return Math.sqrt(12 ** 2 + rise ** 2) / 12;
}

export function slopeAdjustedAreaSqFt(planAreaSqFt: number, pitch: string) {
  return planAreaSqFt * pitchFactor(pitch);
}

export function cameraToBounds(camera: MapCameraState) {
  return {
    north: camera.centerLat + camera.latSpan / 2,
    south: camera.centerLat - camera.latSpan / 2,
    east: camera.centerLng + camera.lngSpan / 2,
    west: camera.centerLng - camera.lngSpan / 2
  };
}

export function pointFromClientOffset(
  clientX: number,
  clientY: number,
  width: number,
  height: number,
  camera: MapCameraState
) {
  const bounds = cameraToBounds(camera);
  return {
    lat: bounds.north - (clientY / height) * (bounds.north - bounds.south),
    lng: bounds.west + (clientX / width) * (bounds.east - bounds.west)
  };
}

export function projectToViewport(
  point: Pick<GeographicPoint, "lat" | "lng">,
  width: number,
  height: number,
  camera: MapCameraState
) {
  const bounds = cameraToBounds(camera);
  return {
    x: ((point.lng - bounds.west) / (bounds.east - bounds.west)) * width,
    y: ((bounds.north - point.lat) / (bounds.north - bounds.south)) * height
  };
}
