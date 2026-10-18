import { describe, expect, it } from "vitest";
import { routesInArea } from "./areas";
import { decodePolyline, linesTouchPolygon, pointInPolygon, type Polygon } from "./geo";
// @ts-expect-error -- plain JS build script
import { encodePolyline, mergeShapes, simplify } from "../scripts/shapes.mjs";

const square: Polygon = [
  [0, 0],
  [0, 1],
  [1, 1],
  [1, 0],
];

describe("geometry", () => {
  it("round-trips encoded polylines", () => {
    const pts = [
      [43.64523, -79.38071],
      [43.65001, -79.39999],
      [43.7, -79.4],
    ];
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts);
  });

  it("tests points against a polygon", () => {
    expect(pointInPolygon([0.5, 0.5], square)).toBe(true);
    expect(pointInPolygon([1.5, 0.5], square)).toBe(false);
  });

  it("counts a line that crosses the area with no vertex inside", () => {
    expect(linesTouchPolygon([[[0.5, -1], [0.5, 2]]], square)).toBe(true);
    expect(linesTouchPolygon([[[2, -1], [2, 2]]], square)).toBe(false);
  });

  it("simplifies straight runs and merges duplicate variants", () => {
    const straight = Array.from({ length: 50 }, (_, i) => [43.7, -79.4 + i * 0.001]);
    expect(simplify(straight, 15)).toHaveLength(2);
    // Same street twice, plus a branch: only the branch should be added after the first.
    const branch = [
      [43.7, -79.4],
      [43.71, -79.4],
    ];
    const lines = mergeShapes([straight, straight, branch]);
    expect(lines).toHaveLength(2);
  });
});

describe("routesInArea (real data)", () => {
  // Rough box around downtown: Bathurst to Jarvis, Front to Bloor.
  const downtown: Polygon = [
    [43.668, -79.411],
    [43.668, -79.372],
    [43.643, -79.372],
    [43.643, -79.411],
  ];

  it("finds downtown streetcars and excludes far-off routes", () => {
    const found = routesInArea(downtown);
    for (const n of ["501", "504", "505", "506", "510", "511"]) expect(found.has(n)).toBe(true);
    for (const n of ["939", "53", "116"]) expect(found.has(n)).toBe(false);
  });
});
