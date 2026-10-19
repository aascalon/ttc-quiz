import type { StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { streetMapLayers } from "./streetStyle";

// Layer ids and types as in OpenFreeMap's Positron style (a representative subset).
const style = {
  version: 8,
  sources: {},
  layers: [
    ["background", "background"],
    ["water", "fill"],
    ["highway_major_inner", "line"],
    ["railway_transit", "line"],
    ["railway_transit_dashline", "line"],
    ["railway", "line"],
    ["railway_dashline", "line"],
    ["highway_name_other", "symbol"],
    ["place_city", "symbol"],
  ].map(([id, type]) => ({ id, type })),
} as unknown as StyleSpecification;

const ids = (labels: boolean) => streetMapLayers(style, { labels }).map((l) => l.id);

describe("street map style", () => {
  it("drops streetcar/subway tracks but keeps mainline rail and labels", () => {
    expect(ids(true)).toEqual(["background", "water", "highway_major_inner", "railway", "railway_dashline", "highway_name_other", "place_city"]);
  });

  it("drops labels too when asked", () => {
    expect(ids(false)).toEqual(["background", "water", "highway_major_inner", "railway", "railway_dashline"]);
  });
});
