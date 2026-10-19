// @vitest-environment happy-dom
// The shape quiz, with the Leaflet map stubbed out (the route data helpers are real).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookalikes } from "./areas";
import routesData from "./data/routes.json";
import type { Route } from "./types";

const routes = routesData as Route[];
const shown: { number: string; reveal: boolean }[] = [];
const draw = { onDone: (_: [number, number][]) => {}, starts: [] as string[], revealed: [] as string[], made: 0 };

vi.mock("./map", async () => ({
  ...(await import("./areas")),
  createShapeMap: () => ({
    element: Object.assign(document.createElement("div"), { className: "stub-shape-map" }),
    show: (number: string, reveal: boolean) => shown.push({ number, reveal }),
  }),
  createDrawMap: (_area: unknown, onDone: (points: [number, number][]) => void) => {
    draw.onDone = onDone;
    draw.made++;
    return {
      element: Object.assign(document.createElement("div"), { className: "stub-draw-map" }),
      start: (key: string) => draw.starts.push(key),
      reveal: (number: string) => draw.revealed.push(number),
      destroy() {},
    };
  },
  createMissedMap: () => ({ element: document.createElement("div"), refresh() {}, focus() {}, destroy() {} }),
}));

async function mount() {
  vi.resetModules();
  document.body.innerHTML = '<main id="app"></main>';
  await import("./main");
  await vi.dynamicImportSettled();
  return document.querySelector<HTMLElement>("#app")!;
}

const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const key = (k: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k }));

async function pickShapeQuiz() {
  $('.quiz-radio[data-family="shape"]')!.click();
  await vi.dynamicImportSettled();
}

describe("name → line quiz", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(draw, { starts: [], revealed: [], made: 0 });
  });

  const currentRoute = () => {
    const name = $(".badge-name")!.textContent!;
    const kind = $(".prompt p")!.textContent!;
    return routes.find((r) => r.name === name && kind.includes(r.mode))!;
  };

  it("scores drawings: tracing the route passes, a line elsewhere doesn't", async () => {
    const { routeShapes } = await import("./areas");
    await mount();
    await pickShapeQuiz();
    $('.swap[data-family="shape"]')!.click();
    expect($("h1")!.textContent).toBe("Draw that route");
    $('[data-length="5"]')!.click();
    for (let i = 0; i < 5; i++) {
      const route = currentRoute();
      expect($(".stub-draw-map")).not.toBeNull();
      expect(draw.starts.at(-1)).toMatch(new RegExp(`:${i}$`));
      // Trace the first two exactly; draw the rest out in Lake Ontario.
      draw.onDone(i < 2 ? routeShapes[route.number][0] : [[43.5, -79.5], [43.5, -79.3]]);
      expect(draw.revealed.at(-1)).toBe(route.number);
      expect($(".feedback")!.classList.contains(i < 2 ? "is-correct" : "is-wrong")).toBe(true);
      expect($(".draw-score")!.textContent).toBe(i < 2 ? "100" : "0");
      expect($(".feedback .badge")!.textContent).toBe(route.number);
      key("Enter");
    }
    expect($("h1")!.textContent).toBe("2 / 5");
    expect($$(".review-missed li").map((li) => li.textContent)).toEqual(Array(3).fill(expect.stringContaining("Scored 0")));
    expect(document.body.textContent).toContain("Average drawing score: 40");
    // Two perfect drawings count towards Instant, like fast answers.
    const saved = JSON.parse(localStorage.getItem("ttc-quiz:progress:name-to-shape")!);
    expect(Object.values(saved.routes).filter((r: any) => r.fastStreak === 1)).toHaveLength(2);
    // One map per round.
    expect(draw.made).toBe(1);
  });
});

describe("shape → name quiz", () => {
  beforeEach(() => {
    localStorage.clear();
    shown.length = 0;
  });

  it("is picked from the second row and remembered", async () => {
    await mount();
    await pickShapeQuiz();
    expect($("h1")!.textContent).toBe("Name that line");
    expect($(".direction.is-selected .line-chip")).not.toBeNull();
    await mount();
    expect($("h1")!.textContent).toBe("Name that line");
  });

  it("plays a round: shows each route's line, then reveals its number once answered", async () => {
    const app = await mount();
    await pickShapeQuiz();
    $('[data-length="5"]')!.click();
    for (let i = 0; i < 5; i++) {
      expect($(".stub-shape-map")).not.toBeNull();
      const { number, reveal } = shown.at(-1)!;
      expect(reveal).toBe(false);
      const route = routes.find((r) => r.number === number)!;
      const options = $$(".option").map((o) => o.querySelector("span")!.textContent!);
      expect(options).toContain(route.name);
      // A route and its lookalike are never both options.
      const lookalikeNames = (lookalikes[number] ?? []).map((n) => routes.find((r) => r.number === n)!.name);
      for (const name of lookalikeNames) expect(options).not.toContain(name);

      key(String(options.indexOf(route.name) + 1));
      expect(shown.at(-1)).toEqual({ number, reveal: true });
      expect($(".feedback .badge")!.textContent).toBe(number);
      key("Enter");
    }
    expect($("h1")!.textContent).toBe("5 / 5");
    expect(JSON.parse(localStorage.getItem("ttc-quiz:progress:shape-to-name")!).round).toBe(1);
    expect(localStorage.getItem("ttc-quiz:progress")).toBeNull();
    expect(app.textContent).toContain("Play again");
  });

  it("never offers the name of a route whose line looks the same", async () => {
    // 929 Dufferin Express runs along 29 Dufferin, even among the routes nearby.
    const { buildQuiz } = await import("./quiz");
    const { nearbyRoutes } = await import("./areas");
    const express = routes.find((r) => r.number === "929")!;
    for (let run = 0; run < 30; run++) {
      const [q] = buildQuiz(routes, 1, {
        ask: [express],
        distractors: (r) => ({
          prefer: nearbyRoutes(r.number).map((n) => routes.find((x) => x.number === n)!),
          exclude: new Set(lookalikes[r.number]),
        }),
      });
      expect(q.options).not.toContain("Dufferin");
    }
  });
});
