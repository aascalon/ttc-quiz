import { describe, expect, it } from "vitest";
import { routeShapes } from "./areas";
import { EXCELLENT, PASS, scoreDrawing } from "./drawScore";
import { densify, type LatLon } from "./geo";

// Simulated drawings of real routes, matching the table the scoring was approved with.
// Lines are worked on in metres, then turned back into lat/lon for scoring.
const M_LAT = 111_320;
const M_LON = 111_320 * Math.cos((43.7 * Math.PI) / 180);
const toXY = ([lat, lon]: LatLon): LatLon => [lon * M_LON, lat * M_LAT];
const toLatLon = ([x, y]: LatLon): LatLon => [y / M_LAT, x / M_LON];

function seeded(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

/** Taps every `every` metres along the line, each off by up to `wobble` metres. */
function taps(line: LatLon[], every: number, wobble: number, seed: number): LatLon[] {
  const random = seeded(seed);
  const dense = densify(line.map(toXY), 25);
  const picked = dense.filter((_, i) => i % Math.round(every / 25) === 0).concat([dense[dense.length - 1]]);
  return picked.map(([x, y]) => [x + (random() - 0.5) * 2 * wobble, y + (random() - 0.5) * 2 * wobble]);
}

const shift = (line: LatLon[], [dx, dy]: LatLon): LatLon[] => line.map(([x, y]) => [x + dx, y + dy]);
const score = (xy: LatLon[], number: string) => scoreDrawing(xy.map(toLatLon), routeShapes[number]).score;

// Which way is "across" each route (to a parallel street): 29 Dufferin runs north–south,
// 501 Queen and 52 Lawrence West east–west.
const ACROSS: Record<string, LatLon> = { "29": [1, 0], "501": [0, 1], "52": [0, 1] };

describe.each(Object.keys(ACROSS))("drawing route %s", (number) => {
  const main = routeShapes[number][0];
  const good = taps(main, 400, 25, 7);
  const [ax, ay] = ACROSS[number];

  it("scores a careful tracing as excellent", () => {
    expect(score(good, number)).toBeGreaterThanOrEqual(95);
  });

  it("still scores a rough tracing (taps 1 km apart, 80 m off) as excellent", () => {
    expect(score(taps(main, 1000, 80, 11), number)).toBeGreaterThanOrEqual(EXCELLENT);
  });

  it("fails half a route", () => {
    expect(score(good.slice(0, Math.ceil(good.length / 2)), number)).toBeLessThan(PASS);
  });

  it("fails the parallel street 150 m away, and scores next to nothing 400 m away", () => {
    expect(score(shift(good, [150 * ax, 150 * ay]), number)).toBeLessThan(PASS);
    expect(score(shift(good, [400 * ax, 400 * ay]), number)).toBeLessThan(10);
  });

  it("only docks a little for a wrong 3 km extension", () => {
    const [x, y] = good[good.length - 1];
    const extended = [...good, [x + 3000 * ay, y + 3000 * ax] as LatLon];
    expect(score(extended, number)).toBeGreaterThanOrEqual(85);
  });
});

describe("scoreDrawing", () => {
  it("requires the main line but not branches, and counts a drawn branch as on the route", () => {
    // 80 Queensway: a 15 km main line with a 10 km branch.
    const [main, branch] = routeShapes["80"];
    expect(score(taps(main, 400, 25, 3), "80")).toBeGreaterThanOrEqual(95);
    const branchOnly = scoreDrawing(taps(branch, 400, 25, 5).map(toLatLon), routeShapes["80"]);
    expect(branchOnly.accuracy).toBeGreaterThan(0.95);
    expect(branchOnly.coverage).toBeLessThan(0.8);
  });

  it("scores nothing for fewer than two points", () => {
    expect(scoreDrawing([[43.65, -79.4]], routeShapes["501"]).score).toBe(0);
  });
});
