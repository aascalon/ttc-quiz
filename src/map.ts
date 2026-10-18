// OpenStreetMap maps of the route network, loaded on demand:
// - the area picker, where the player taps out a polygon and the routes through it light up;
// - the results map, highlighting the routes the player missed.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { routeShapes, routesInArea } from "./areas";
import type { LatLon, Polygon } from "./geo";

export interface AreaPicker {
  element: HTMLElement;
  /** Call after the element is (re)attached to the page so the map sizes itself. */
  refresh(): void;
}

const IDLE = { color: "#8a8a8a", weight: 1.5, opacity: 0.55 };
const ACTIVE = { color: "#da251d", weight: 3.5, opacity: 0.95 };
const AREA = { color: "#1f4fbf", weight: 2, fillOpacity: 0.08, interactive: false };
const CLOSE_PX = 18;

/** A map with OSM tiles and every route drawn faintly. */
function createNetworkMap(container: HTMLElement, options: L.MapOptions = {}) {
  const map = L.map(container, { preferCanvas: true, zoomSnap: 0.5, ...options }).setView([43.7, -79.4], 11);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const routeLayers = new Map<string, L.Polyline>();
  for (const [number, lines] of Object.entries(routeShapes)) {
    routeLayers.set(number, L.polyline(lines, { ...IDLE, interactive: false }).addTo(map));
  }
  const networkBounds = L.featureGroup([...routeLayers.values()]).getBounds();
  return { map, routeLayers, networkBounds };
}

/** Fits the view the first time the map is on the page (it has no size before that). */
function fitOnFirstRefresh(element: HTMLElement, map: L.Map, fit: () => void): () => void {
  let fitted = false;
  return () => {
    map.invalidateSize({ pan: false });
    if (fitted || !element.isConnected) return;
    fitted = true;
    fit();
  };
}

export function createAreaPicker(
  initial: Polygon | null,
  onChange: (polygon: Polygon | null, numbers: Set<string>) => void,
): AreaPicker {
  const element = document.createElement("div");
  element.className = "area-picker";
  element.innerHTML = `
    <div class="map"></div>
    <div class="map-toolbar">
      <p class="map-hint"></p>
      <div class="map-buttons">
        <button type="button" class="btn" data-map="done">Done</button>
        <button type="button" class="btn" data-map="clear">Clear</button>
      </div>
    </div>`;
  const hint = element.querySelector<HTMLElement>(".map-hint")!;
  const doneBtn = element.querySelector<HTMLButtonElement>('[data-map="done"]')!;
  const clearBtn = element.querySelector<HTMLButtonElement>('[data-map="clear"]')!;

  const { map, routeLayers, networkBounds } = createNetworkMap(element.querySelector<HTMLElement>(".map")!, {
    doubleClickZoom: false,
  });

  let points: LatLon[] = initial ? [...initial] : [];
  let closed = Boolean(initial);
  const draft = L.polyline([], { color: "#1f4fbf", weight: 2, dashArray: "6 6", interactive: false }).addTo(map);
  const shape = L.polygon([], AREA).addTo(map);
  const vertices = L.layerGroup().addTo(map);

  function update(): void {
    vertices.clearLayers();
    if (!closed) {
      points.forEach((p, i) =>
        L.circleMarker(p, { radius: i === 0 ? 7 : 5, color: "#1f4fbf", fillColor: "#fff", fillOpacity: 1, weight: 2, interactive: false }).addTo(vertices),
      );
    }
    draft.setLatLngs(closed ? [] : points);
    shape.setLatLngs(closed ? points : []);

    const numbers = closed ? routesInArea(points) : new Set<string>();
    for (const [number, layer] of routeLayers) {
      layer.setStyle(numbers.has(number) ? ACTIVE : IDLE);
      if (numbers.has(number)) layer.bringToFront();
    }

    doneBtn.disabled = closed || points.length < 3;
    clearBtn.disabled = points.length === 0;
    hint.textContent = closed
      ? `${numbers.size} route${numbers.size === 1 ? "" : "s"} pass through this area.`
      : points.length === 0
        ? "Tap the map to drop the corners of your area."
        : points.length < 3
          ? "Keep tapping to add corners."
          : "Tap the first corner or Done to finish.";
    onChange(closed ? [...points] : null, numbers);
  }

  map.on("click", (e: L.LeafletMouseEvent) => {
    if (closed) return;
    if (points.length >= 3) {
      const first = map.latLngToContainerPoint(points[0]);
      if (first.distanceTo(e.containerPoint) < CLOSE_PX) {
        closed = true;
        return update();
      }
    }
    points.push([e.latlng.lat, e.latlng.lng]);
    update();
  });
  doneBtn.addEventListener("click", () => {
    closed = true;
    update();
  });
  clearBtn.addEventListener("click", () => {
    points = [];
    closed = false;
    update();
  });

  update();

  return {
    element,
    refresh: fitOnFirstRefresh(element, map, () => {
      if (initial) map.fitBounds(L.latLngBounds(initial), { padding: [24, 24], maxZoom: 15, animate: false });
      else map.fitBounds(networkBounds, { padding: [8, 8], animate: false });
    }),
  };
}

export interface MissedMap {
  element: HTMLElement;
  refresh(): void;
  /** Emphasise one missed route (or none). */
  focus(number: string | null): void;
  destroy(): void;
}

/** The point halfway along a line, for placing its label. */
function midpoint(line: LatLon[]): LatLon {
  const seg = (k: number) => Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]);
  let total = 0;
  for (let k = 1; k < line.length; k++) total += seg(k);
  let remaining = total / 2;
  for (let k = 1; k < line.length; k++) {
    const d = seg(k);
    if (remaining <= d && d > 0) {
      const t = remaining / d;
      return [line[k - 1][0] + (line[k][0] - line[k - 1][0]) * t, line[k - 1][1] + (line[k][1] - line[k - 1][1]) * t];
    }
    remaining -= d;
  }
  return line[0];
}

/**
 * Results map: the routes the player missed, labelled with their numbers in sign colours
 * (matching the review list), over the faint network and their area, if any.
 */
export function createMissedMap(routes: { number: string; color: string }[], area: Polygon | null): MissedMap {
  const element = document.createElement("div");
  element.className = "map map-results";
  const { map, routeLayers, networkBounds } = createNetworkMap(element, { scrollWheelZoom: false });
  if (area) L.polygon(area, AREA).addTo(map);

  const missed = routes.filter((r) => routeLayers.has(r.number)).map((r) => r.number);
  const labels = new Map<string, L.Tooltip>();
  for (const { number: n, color } of routes) {
    const layer = routeLayers.get(n);
    if (!layer) continue;
    layer.setStyle(ACTIVE).bringToFront();
    const longest = routeShapes[n].reduce((a, b) => (b.length > a.length ? b : a));
    const label = L.tooltip({ permanent: true, direction: "center", className: "route-label", interactive: false, opacity: 1 })
      .setLatLng(midpoint(longest))
      .setContent(n)
      .addTo(map);
    label.getElement()?.style.setProperty("--route-color", color);
    labels.set(n, label);
  }

  return {
    element,
    refresh: fitOnFirstRefresh(element, map, () => {
      const bounds = missed.length ? L.featureGroup(missed.map((n) => routeLayers.get(n)!)).getBounds() : networkBounds;
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15, animate: false });
    }),
    focus(number) {
      for (const n of missed) {
        const on = number === null || n === number;
        routeLayers.get(n)!.setStyle(n === number ? { ...ACTIVE, weight: 6 } : on ? ACTIVE : { ...ACTIVE, weight: 2, opacity: 0.2 });
        // Leaflet sets label opacity inline, so it has to go through setOpacity rather than CSS.
        labels.get(n)!.setOpacity(on ? 1 : 0.3);
        labels.get(n)!.getElement()?.classList.toggle("is-focus", n === number);
      }
      if (number && routeLayers.has(number)) routeLayers.get(number)!.bringToFront();
    },
    destroy() {
      map.remove();
    },
  };
}
