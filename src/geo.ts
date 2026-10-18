/** [lat, lon]. Toronto is small enough to treat lat/lon as planar for hit-testing. */
export type LatLon = [number, number];
export type Polygon = LatLon[];

/** Decode a Google encoded polyline (precision 5). */
export function decodePolyline(encoded: string): LatLon[] {
  const points: LatLon[] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    lat += next();
    lon += next();
    points.push([lat / 1e5, lon / 1e5]);
  }
  return points;
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon([y, x]: LatLon, polygon: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function cross(o: LatLon, a: LatLon, b: LatLon): number {
  return (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
}

/** True if segments ab and cd properly cross. */
export function segmentsIntersect(a: LatLon, b: LatLon, c: LatLon, d: LatLon): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True if any part of any line enters the polygon (a vertex inside, or a segment crossing an edge). */
export function linesTouchPolygon(lines: LatLon[][], polygon: Polygon): boolean {
  if (polygon.length < 3) return false;
  for (const line of lines) {
    for (let k = 0; k < line.length; k++) {
      if (pointInPolygon(line[k], polygon)) return true;
      if (k === 0) continue;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        if (segmentsIntersect(line[k - 1], line[k], polygon[j], polygon[i])) return true;
      }
    }
  }
  return false;
}

/** Points along a line no more than `step` degrees apart (including its vertices). */
export function densify(line: LatLon[], step: number): LatLon[] {
  const out: LatLon[] = [line[0]];
  for (let k = 1; k < line.length; k++) {
    const [a, b] = [line[k - 1], line[k]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let s = 1; s <= n; s++) out.push([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n]);
  }
  return out;
}

/** Preferred label spots, as fractions along a route's stretch: the middle first, then outwards. */
const LABEL_FRACTIONS = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9];

/**
 * Candidate label positions for a route, best first: along its longest stretch inside
 * `area` (routes often run far beyond it), or else along its longest line. Several
 * candidates let labels dodge each other, e.g. day and Blue Night routes on the same street.
 */
export function labelCandidates(lines: LatLon[][], area: Polygon | null): LatLon[] {
  let path: LatLon[] = [];
  if (area) {
    for (const line of lines) {
      let run: LatLon[] = [];
      for (const p of densify(line, 0.0005)) {
        if (!pointInPolygon(p, area)) {
          run = [];
          continue;
        }
        run.push(p);
        if (run.length > path.length) path = run;
      }
    }
  }
  if (!path.length) path = densify(lines.reduce((a, b) => (b.length > a.length ? b : a)), 0.0005);
  return LABEL_FRACTIONS.map((f) => path[Math.round(f * (path.length - 1))]);
}
