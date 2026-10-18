// OpenStreetMap maps of the route network, loaded on demand. Both maps are a RouteMap
// (every route drawn faintly, some highlighted and labelled, optionally an area outline):
// - the area picker adds drawing, highlighting the routes through the drawn area;
// - the results map highlights the routes the player missed.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { routeShapes, routesInArea } from "./areas";
import routesData from "./data/routes.json";
import { labelCandidates, type LatLon, type Polygon } from "./geo";
import type { Route } from "./types";

const routeColors = new Map((routesData as Route[]).map((r) => [r.number, r.color]));

const IDLE = { color: "#8a8a8a", weight: 1.5, opacity: 0.55 };
const ACTIVE = { color: "#da251d", weight: 3.5, opacity: 0.95 };
const AREA = { color: "#1f4fbf", weight: 2, fillOpacity: 0.08, interactive: false };
const CLOSE_PX = 18;

interface RouteMap {
  map: L.Map;
  networkBounds: L.LatLngBounds;
  /** Highlight and label these routes, outlining `area` if given (labels sit inside it). */
  show(numbers: Iterable<string>, area: Polygon | null): void;
  /** Emphasise one highlighted route and fade the others, or reset with null. */
  focus(number: string | null): void;
  /** Bounds of the highlighted routes, if any. */
  highlightBounds(): L.LatLngBounds | null;
}

interface RouteMapOptions {
  map?: L.MapOptions;
  /**
   * When a label has no clear spot: hide it (for many labels, where a crowd is unreadable)
   * or show it overlapping (for a few labels that all matter).
   */
  crowdedLabels: "hide" | "overlap";
}

function createRouteMap(container: HTMLElement, { map: mapOptions, crowdedLabels }: RouteMapOptions): RouteMap {
  const map = L.map(container, { preferCanvas: true, zoomSnap: 0.5, ...mapOptions }).setView([43.7, -79.4], 11);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const layers = new Map<string, L.Polyline>();
  for (const [number, lines] of Object.entries(routeShapes)) {
    layers.set(number, L.polyline(lines, { ...IDLE, interactive: false }).addTo(map));
  }
  const networkBounds = L.featureGroup([...layers.values()]).getBounds();
  const border = L.polygon([], AREA).addTo(map);
  const labels = new Map<string, { tooltip: L.Tooltip; candidates: LatLon[] }>();
  let shown: string[] = [];
  let focused: string | null = null;

  /**
   * Place each label at its first candidate spot that is on screen and clear of labels
   * already placed (the focused route goes first). With no clear spot, hide or overlap
   * as `crowdedLabels` says.
   */
  function layoutLabels(): void {
    const size = map.getSize();
    const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const order = focused ? [focused, ...shown.filter((n) => n !== focused)] : shown;
    for (const n of order) {
      const { tooltip, candidates } = labels.get(n)!;
      const el = tooltip.getElement();
      if (!el) continue;
      const [w, h] = [el.offsetWidth + 4, el.offsetHeight + 4];
      const spots = candidates.map((c) => {
        const p = map.latLngToContainerPoint(c);
        return { c, box: { x1: p.x - w / 2, y1: p.y - h / 2, x2: p.x + w / 2, y2: p.y + h / 2 } };
      });
      const onScreen = spots.filter(({ box }) => box.x1 >= 0 && box.y1 >= 0 && box.x2 <= size.x && box.y2 <= size.y);
      const clear = onScreen.find(({ box }) => !placed.some((b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1));
      const spot = clear ?? (crowdedLabels === "overlap" ? (onScreen[0] ?? spots[0]) : undefined);
      el.style.visibility = spot ? "" : "hidden";
      if (!spot) continue;
      tooltip.setLatLng(spot.c);
      placed.push(spot.box);
    }
  }
  map.on("zoomend moveend resize", layoutLabels);

  return {
    map,
    networkBounds,
    show(numbers, area) {
      for (const n of shown) layers.get(n)!.setStyle(IDLE);
      for (const { tooltip } of labels.values()) tooltip.remove();
      labels.clear();
      border.setLatLngs(area ?? []);
      focused = null;

      shown = [...numbers].filter((n) => layers.has(n));
      for (const n of shown) {
        layers.get(n)!.setStyle(ACTIVE).bringToFront();
        const candidates = labelCandidates(routeShapes[n], area);
        const tooltip = L.tooltip({ permanent: true, direction: "center", className: "route-label", interactive: false, opacity: 1 })
          .setLatLng(candidates[0])
          .setContent(n)
          .addTo(map);
        tooltip.getElement()?.style.setProperty("--route-color", routeColors.get(n) ?? ACTIVE.color);
        labels.set(n, { tooltip, candidates });
      }
      layoutLabels();
    },
    focus(number) {
      focused = number && shown.includes(number) ? number : null;
      for (const n of shown) {
        const on = number === null || n === number;
        layers.get(n)!.setStyle(n === number ? { ...ACTIVE, weight: 6 } : on ? ACTIVE : { ...ACTIVE, weight: 2, opacity: 0.2 });
        // Leaflet sets label opacity inline, so it has to go through setOpacity rather than CSS.
        const { tooltip } = labels.get(n)!;
        tooltip.setOpacity(on ? 1 : 0.3);
        tooltip.getElement()?.classList.toggle("is-focus", n === number);
      }
      if (focused) layers.get(focused)!.bringToFront();
      // The focused route's label gets first pick of spots, so it's never the hidden one.
      layoutLabels();
    },
    highlightBounds() {
      return shown.length ? L.featureGroup(shown.map((n) => layers.get(n)!)).getBounds() : null;
    },
  };
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

export interface AreaPicker {
  element: HTMLElement;
  /** Call after the element is (re)attached to the page so the map sizes itself. */
  refresh(): void;
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

  const routeMap = createRouteMap(element.querySelector<HTMLElement>(".map")!, {
    map: { doubleClickZoom: false },
    crowdedLabels: "hide",
  });
  const { map } = routeMap;

  let points: LatLon[] = initial ? [...initial] : [];
  let closed = Boolean(initial);
  const draft = L.polyline([], { color: AREA.color, weight: 2, dashArray: "6 6", interactive: false }).addTo(map);
  const vertices = L.layerGroup().addTo(map);

  function update(): void {
    vertices.clearLayers();
    if (!closed) {
      points.forEach((p, i) =>
        L.circleMarker(p, { radius: i === 0 ? 7 : 5, color: AREA.color, fillColor: "#fff", fillOpacity: 1, weight: 2, interactive: false }).addTo(vertices),
      );
    }
    draft.setLatLngs(closed ? [] : points);

    const numbers = closed ? routesInArea(points) : new Set<string>();
    routeMap.show(numbers, closed ? points : null);

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
      else map.fitBounds(routeMap.networkBounds, { padding: [8, 8], animate: false });
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

/** Results map: the routes the player missed, and their area if they played one. */
export function createMissedMap(numbers: string[], area: Polygon | null): MissedMap {
  const element = document.createElement("div");
  element.className = "map map-results";
  const routeMap = createRouteMap(element, { map: { scrollWheelZoom: false }, crowdedLabels: "overlap" });
  routeMap.show(numbers, area);

  return {
    element,
    refresh: fitOnFirstRefresh(element, routeMap.map, () => {
      const bounds = routeMap.highlightBounds() ?? routeMap.networkBounds;
      routeMap.map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15, animate: false });
    }),
    focus: routeMap.focus,
    destroy() {
      routeMap.map.remove();
    },
  };
}
