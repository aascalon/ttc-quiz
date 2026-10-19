// Scores a route drawn on the map against the real one. Each point along a line earns credit
// for being close to the other line: full credit within FULL_M, none beyond ZERO_M, linear
// in between. Coverage asks "did you draw all of the route?" and accuracy asks "is what
// you drew on the route?"; the score is their harmonic mean, so both have to be good.
import { densify, type LatLon } from "./geo";

/** Full credit within this distance of the other line, in metres. */
export const FULL_M = 50;
/** No credit beyond this distance. */
export const ZERO_M = 200;
/** Scores from here up count as correct. */
export const PASS = 70;
/** Scores from here up count towards Instant, as a fast answer does in the timed quizzes. */
export const EXCELLENT = 90;

const SAMPLE_M = 25;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = 111_320 * Math.cos((43.7 * Math.PI) / 180); // Toronto

type XY = [number, number];

/** [lat, lon] → local metres. Planar is plenty accurate at city scale (as in scripts/shapes.mjs). */
const toXY = ([lat, lon]: LatLon): XY => [lon * M_PER_DEG_LON, lat * M_PER_DEG_LAT];

function segmentDistance([px, py]: XY, [ax, ay]: XY, [bx, by]: XY): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distanceToLines(p: XY, lines: XY[][]): number {
  let min = Infinity;
  for (const line of lines) {
    if (line.length === 1) min = Math.min(min, segmentDistance(p, line[0], line[0]));
    for (let k = 1; k < line.length; k++) min = Math.min(min, segmentDistance(p, line[k - 1], line[k]));
  }
  return min;
}

function credit(distance: number): number {
  if (distance <= FULL_M) return 1;
  if (distance >= ZERO_M) return 0;
  return (ZERO_M - distance) / (ZERO_M - FULL_M);
}

/** Average credit of points every SAMPLE_M along `line` for being near `others`. */
function closeness(line: XY[], others: XY[][]): number {
  const samples = densify(line, SAMPLE_M);
  return samples.reduce((sum, p) => sum + credit(distanceToLines(p, others)), 0) / samples.length;
}

export interface DrawScore {
  /** 0–100. */
  score: number;
  /** Share of the route's main line near the drawing, 0–1. */
  coverage: number;
  /** Share of the drawing near any of the route's lines, 0–1. */
  accuracy: number;
}

/**
 * Score a drawing against a route's lines. The first line is the route's main (longest)
 * variant, which is what has to be covered; the others are branches and detours, which
 * aren't required but don't count against you if drawn.
 */
export function scoreDrawing(drawn: LatLon[], routeLines: LatLon[][]): DrawScore {
  if (drawn.length < 2 || routeLines.length === 0) return { score: 0, coverage: 0, accuracy: 0 };
  const mine = drawn.map(toXY);
  const route = routeLines.map((line) => line.map(toXY));
  const coverage = closeness(route[0], [mine]);
  const accuracy = closeness(mine, route);
  const f = coverage + accuracy ? (2 * coverage * accuracy) / (coverage + accuracy) : 0;
  return { score: Math.round(f * 100), coverage, accuracy };
}
