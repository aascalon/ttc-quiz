// OpenFreeMap's Positron street map, drawn in the browser by MapLibre so layers can be
// left out: always the streetcar/subway tracks (you could trace a streetcar route from
// them), and the labels where street names would give the answer away. Loaded on demand.
import "@maplibre/maplibre-gl-leaflet";
import L from "leaflet";
import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre decodes tiles in a web worker it finds next to its own file, which isn't where
// it ends up once bundled; have Vite build the worker and point MapLibre at it.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { streetMapLayers } from "./streetStyle";

setWorkerUrl(workerUrl);

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const ATTRIBUTION =
  '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

let style: Promise<StyleSpecification> | null = null;
function loadStyle(): Promise<StyleSpecification> {
  style ??= fetch(STYLE_URL).then((res) => {
    if (!res.ok) throw new Error(`Map style: ${res.status}`);
    return res.json();
  });
  style.catch(() => (style = null)); // Let a later map retry.
  return style;
}

/** Add the street map underneath, with or without labels. */
export async function addStreetMap(map: L.Map, { labels }: { labels: boolean }): Promise<void> {
  let removed = false;
  map.once("unload", () => (removed = true));
  const full = await loadStyle();
  if (removed) return; // The map was closed while the style loaded.
  L.maplibreGL({ style: { ...full, layers: streetMapLayers(full, { labels }) }, attributionControl: false }).addTo(map);
  map.attributionControl?.addAttribution(ATTRIBUTION);
}
