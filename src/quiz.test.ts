import { describe, expect, it } from "vitest";
import routesData from "./data/routes.json";
import { OPTION_COUNT, buildQuiz, lengthOptions, pickDistractors } from "./quiz";
import type { Route } from "./types";
// @ts-expect-error -- plain JS build script
import { normalizeName, parseCsv, toQuizRoutes } from "../scripts/normalize.mjs";

const routes = routesData as Route[];

describe("buildQuiz", () => {
  it.each([5, 10, 15])("builds %i questions with no repeated routes", (n) => {
    const quiz = buildQuiz(routes, n);
    expect(quiz).toHaveLength(n);
    expect(new Set(quiz.map((q) => q.route.number)).size).toBe(n);
  });

  it("gives every question four unique options with exactly one correct", () => {
    for (let run = 0; run < 50; run++) {
      for (const q of buildQuiz(routes, 15)) {
        expect(q.options).toHaveLength(OPTION_COUNT);
        expect(new Set(q.options).size).toBe(OPTION_COUNT);
        expect(q.options.filter((o) => o === q.route.name)).toHaveLength(1);
      }
    }
  });
});

describe("pickDistractors", () => {
  it("never repeats the answer's name, even across same-named routes (301/501 Queen)", () => {
    const queen = routes.find((r) => r.number === "501")!;
    for (let run = 0; run < 200; run++) {
      const d = pickDistractors(queen, routes);
      expect(d).toHaveLength(3);
      expect(d).not.toContain("Queen");
    }
  });

  it("prefers routes of the same mode", () => {
    const streetcarNames = new Set(routes.filter((r) => r.mode === "streetcar").map((r) => r.name));
    const king = routes.find((r) => r.number === "504")!;
    for (const name of pickDistractors(king, routes)) expect(streetcarNames.has(name)).toBe(true);
  });

  it("keeps Express names out of regular-route questions", () => {
    const dufferin = routes.find((r) => r.number === "29")!;
    for (let run = 0; run < 100; run++) {
      for (const name of pickDistractors(dufferin, routes)) expect(name).not.toMatch(/Express/);
    }
  });

  it("falls back to other modes when the same mode runs out", () => {
    const pool: Route[] = [
      { number: "1", name: "A", mode: "streetcar", color: "#000" },
      { number: "2", name: "B", mode: "streetcar", color: "#000" },
      { number: "3", name: "C", mode: "bus", color: "#000" },
      { number: "4", name: "D", mode: "bus", color: "#000" },
    ];
    expect(pickDistractors(pool[0], pool).sort()).toEqual(["B", "C", "D"]);
  });
});

describe("data normalization", () => {
  it("parses quoted CSV fields", () => {
    const rows = parseCsv('a,b\n"x, y","say ""hi"""\n');
    expect(rows).toEqual([{ a: "x, y", b: 'say "hi"' }]);
  });

  it("cleans route names", () => {
    expect(normalizeName("  Queen  ", "501")).toBe("Queen");
    expect(normalizeName("501 Queen", "501")).toBe("Queen");
    expect(normalizeName("Kingston  Rd", "12")).toBe("Kingston Rd");
  });

  it("keeps bus and streetcar routes but drops subway and LRT lines", () => {
    const rows = [
      { route_short_name: "1", route_long_name: "Line 1 (Yonge-University)", route_type: "1", route_color: "D5C82B" },
      { route_short_name: "5", route_long_name: "Line 5 Eglinton", route_type: "0", route_color: "FF8000" },
      { route_short_name: "501", route_long_name: "Queen", route_type: "0", route_color: "ED1C24" },
      { route_short_name: "29", route_long_name: "Dufferin", route_type: "3", route_color: "ED1C24" },
    ];
    expect(toQuizRoutes(rows).map((r: Route) => r.number)).toEqual(["29", "501"]);
  });

  it("generated data has no lines and includes Blue Night routes", () => {
    expect(routes.some((r) => /^Line \d/.test(r.name))).toBe(false);
    expect(routes.some((r) => r.number.startsWith("3") && r.number.length === 3)).toBe(true);
    expect(routes.find((r) => r.number === "504")?.mode).toBe("streetcar");
  });
});

describe("area quizzes", () => {
  const local = routes.filter((r) => ["501", "504", "505", "506", "510", "511", "6", "94"].includes(r.number));

  it("only asks about routes in the area", () => {
    for (let run = 0; run < 20; run++) {
      for (const q of buildQuiz(routes, 5, { local })) expect(local).toContain(q.route);
    }
  });

  it("prefers local distractors when the area has enough", () => {
    const localNames = new Set(local.map((r) => r.name));
    const queen = local.find((r) => r.number === "501")!;
    for (let run = 0; run < 50; run++) {
      for (const name of pickDistractors(queen, routes, 3, Math.random, local)) expect(localNames.has(name)).toBe(true);
    }
  });

  it("asks only about `ask` routes but still draws distractors from the area", () => {
    const ask = local.filter((r) => ["501", "504"].includes(r.number));
    const askNames = new Set(ask.map((r) => r.name));
    const localNames = new Set(local.map((r) => r.name));
    let otherNames = 0;
    for (let run = 0; run < 20; run++) {
      for (const q of buildQuiz(routes, 2, { local, ask })) {
        expect(ask).toContain(q.route);
        for (const o of q.options) {
          expect(localNames.has(o)).toBe(true);
          if (!askNames.has(o)) otherNames++;
        }
      }
    }
    expect(otherNames).toBeGreaterThan(0);
  });

  it("offers round lengths that fit the area", () => {
    expect(lengthOptions(230)).toEqual([5, 10, 15]);
    expect(lengthOptions(15)).toEqual([5, 10, 15]);
    expect(lengthOptions(12)).toEqual([5, 10, 12]);
    expect(lengthOptions(3)).toEqual([3]);
    expect(lengthOptions(0)).toEqual([]);
  });
});
