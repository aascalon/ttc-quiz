// @vitest-environment happy-dom
// The shape quiz, with the Leaflet map stubbed out (the route data helpers are real).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookalikes } from "./areas";
import routesData from "./data/routes.json";
import type { Route } from "./types";

const routes = routesData as Route[];
const shown: { number: string; reveal: boolean }[] = [];

vi.mock("./map", async () => ({
  ...(await import("./areas")),
  createShapeMap: () => ({
    element: Object.assign(document.createElement("div"), { className: "stub-shape-map" }),
    show: (number: string, reveal: boolean) => shown.push({ number, reveal }),
  }),
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
