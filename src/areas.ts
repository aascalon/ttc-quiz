import shapesData from "./data/shapes.json";
import lookalikesData from "./data/lookalikes.json";
import { decodePolyline, linesTouchPolygon, type LatLon, type Polygon } from "./geo";

/** Each route's map lines, decoded once. */
export const routeShapes: Record<string, LatLon[][]> = Object.fromEntries(
  Object.entries(shapesData as Record<string, string[]>).map(([number, lines]) => [number, lines.map(decodePolyline)]),
);

/** Route numbers whose lines enter the polygon. */
export function routesInArea(polygon: Polygon): Set<string> {
  return new Set(Object.keys(routeShapes).filter((n) => linesTouchPolygon(routeShapes[n], polygon)));
}

/** Routes whose lines look the same as each route's on a map (mostly a route and its Express). */
export const lookalikes = lookalikesData as Record<string, string[]>;

type Box = { south: number; west: number; north: number; east: number };
const boxes: Record<string, Box> = Object.fromEntries(
  Object.entries(routeShapes).map(([number, lines]) => {
    const points = lines.flat();
    const lats = points.map(([lat]) => lat);
    const lons = points.map(([, lon]) => lon);
    return [number, { south: Math.min(...lats), west: Math.min(...lons), north: Math.max(...lats), east: Math.max(...lons) }];
  }),
);

/** Route numbers whose bounding boxes overlap this route's, grown by about `marginM` metres. */
export function nearbyRoutes(number: string, marginM = 1000): string[] {
  const box = boxes[number];
  if (!box) return [];
  const dLat = marginM / 111_320;
  const dLon = marginM / (111_320 * Math.cos((43.7 * Math.PI) / 180));
  return Object.keys(boxes).filter((n) => {
    const b = boxes[n];
    return n !== number && b.south <= box.north + dLat && b.north >= box.south - dLat && b.west <= box.east + dLon && b.east >= box.west - dLon;
  });
}
