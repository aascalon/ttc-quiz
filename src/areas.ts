import shapesData from "./data/shapes.json";
import { decodePolyline, linesTouchPolygon, type LatLon, type Polygon } from "./geo";

/** Each route's map lines, decoded once. */
export const routeShapes: Record<string, LatLon[][]> = Object.fromEntries(
  Object.entries(shapesData as Record<string, string[]>).map(([number, lines]) => [number, lines.map(decodePolyline)]),
);

/** Route numbers whose lines enter the polygon. */
export function routesInArea(polygon: Polygon): Set<string> {
  return new Set(Object.keys(routeShapes).filter((n) => linesTouchPolygon(routeShapes[n], polygon)));
}
