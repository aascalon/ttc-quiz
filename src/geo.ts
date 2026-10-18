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
