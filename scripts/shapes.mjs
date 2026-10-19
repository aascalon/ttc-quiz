// Turns GTFS shapes into compact, de-duplicated route lines for the map.

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = 111_320 * Math.cos((43.7 * Math.PI) / 180); // Toronto

/** [lat, lon] -> local metres. Planar is plenty accurate at city scale. */
const toXY = ([lat, lon]) => [lon * M_PER_DEG_LON, lat * M_PER_DEG_LAT];

function segDist(p, a, b) {
  const [px, py] = toXY(p);
  const [ax, ay] = toXY(a);
  const [bx, by] = toXY(b);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Douglas–Peucker simplification with a tolerance in metres. */
export function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(points[k], points[i], points[j]);
      if (d > maxD) [maxD, idx] = [d, k];
    }
    if (maxD > tolerance) {
      keep[idx] = 1;
      stack.push([i, idx], [idx, j]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

/** Points every `step` metres along a line (including its vertices). */
function densify(line, step) {
  const out = [line[0]];
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1];
    const b = line[k];
    const [ax, ay] = toXY(a);
    const [bx, by] = toXY(b);
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
    for (let s = 1; s <= n; s++) out.push([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n]);
  }
  return out;
}

/** A set of grid cells a line passes through; points count as on it within about one cell. */
function coverageGrid(cell) {
  const covered = new Set();
  const cellOf = (p) => {
    const [x, y] = toXY(p);
    return [Math.floor(x / cell), Math.floor(y / cell)];
  };
  return {
    cover(line) {
      for (const p of densify(line, cell / 2)) covered.add(cellOf(p).join(","));
    },
    has(p) {
      const [cx, cy] = cellOf(p);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (covered.has(`${cx + dx},${cy + dy}`)) return true;
      return false;
    },
  };
}

/**
 * Merge a route's shape variants into a few lines without overlap: longest shape first,
 * then only the parts of other shapes (branches, detours) not already drawn.
 */
export function mergeShapes(shapes, { tolerance = 15, cell = 30 } = {}) {
  const grid = coverageGrid(cell);
  const lines = [];
  const simplified = shapes.map((s) => simplify(s, tolerance)).sort((a, b) => length(b) - length(a));
  for (const line of simplified) {
    // A segment is new if any of its densified samples falls outside the covered area.
    const fresh = [];
    for (let k = 1; k < line.length; k++) {
      fresh.push(densify([line[k - 1], line[k]], cell / 2).some((p) => !grid.has(p)));
    }
    let run = null;
    for (let k = 1; k < line.length; k++) {
      if (fresh[k - 1]) {
        run ??= [line[k - 1]];
        run.push(line[k]);
      } else if (run) {
        lines.push(run);
        run = null;
      }
    }
    if (run) lines.push(run);
    grid.cover(line);
  }
  return lines;
}

/**
 * Pairs of differently named routes whose lines look the same on a map (mostly a route and
 * its Express): at least `most` of one runs along the other, and `much` the other way.
 * Returns { routeNumber: [lookalike numbers] }, listing each pair both ways.
 */
export function findLookalikes(linesByNumber, nameOf, { cell = 100, most = 0.8, much = 0.6 } = {}) {
  const numbers = Object.keys(linesByNumber);
  const grids = new Map();
  const samples = new Map();
  for (const n of numbers) {
    const grid = coverageGrid(cell);
    linesByNumber[n].forEach((line) => grid.cover(line));
    grids.set(n, grid);
    samples.set(n, linesByNumber[n].flatMap((line) => densify(line, cell / 2)));
  }
  const share = (a, b) => samples.get(a).filter((p) => grids.get(b).has(p)).length / samples.get(a).length;

  const out = {};
  const add = (a, b) => (out[a] ??= []).push(b);
  for (const a of numbers) {
    for (const b of numbers) {
      if (a >= b || nameOf(a) === nameOf(b)) continue;
      const [ab, ba] = [share(a, b), share(b, a)];
      if (Math.max(ab, ba) >= most && Math.min(ab, ba) >= much) {
        add(a, b);
        add(b, a);
      }
    }
  }
  return out;
}

function length(line) {
  let total = 0;
  for (let k = 1; k < line.length; k++) {
    const [ax, ay] = toXY(line[k - 1]);
    const [bx, by] = toXY(line[k]);
    total += Math.hypot(bx - ax, by - ay);
  }
  return total;
}

/** Google encoded-polyline format (precision 5) — a compact, well-known string encoding. */
export function encodePolyline(points) {
  let out = "";
  let prevLat = 0;
  let prevLon = 0;
  const enc = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return s + String.fromCharCode(v + 63);
  };
  for (const [lat, lon] of points) {
    const ilat = Math.round(lat * 1e5);
    const ilon = Math.round(lon * 1e5);
    out += enc(ilat - prevLat) + enc(ilon - prevLon);
    prevLat = ilat;
    prevLon = ilon;
  }
  return out;
}

/** Build { routeNumber: [[lat, lon], ...][] } (merged lines) from parsed trips/shapes rows. */
export function buildRouteShapes(trips, shapeRows, routeIdToNumber) {
  const shapeIdsByRoute = new Map();
  for (const t of trips) {
    const number = routeIdToNumber.get(t.route_id);
    if (!number || !t.shape_id) continue;
    if (!shapeIdsByRoute.has(number)) shapeIdsByRoute.set(number, new Set());
    shapeIdsByRoute.get(number).add(t.shape_id);
  }
  const points = new Map();
  for (const r of shapeRows) {
    if (!points.has(r.shape_id)) points.set(r.shape_id, []);
    points.get(r.shape_id).push([+r.shape_pt_sequence, +r.shape_pt_lat, +r.shape_pt_lon]);
  }
  const out = {};
  for (const [number, ids] of [...shapeIdsByRoute].sort()) {
    const shapes = [...ids]
      .map((id) => (points.get(id) ?? []).sort((a, b) => a[0] - b[0]).map(([, lat, lon]) => [lat, lon]))
      .filter((s) => s.length > 1);
    out[number] = mergeShapes(shapes);
  }
  return out;
}
