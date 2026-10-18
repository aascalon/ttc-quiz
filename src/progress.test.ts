import { describe, expect, it } from "vitest";
import routesData from "./data/routes.json";
import { FAST_MS, countLevels, emptyProgress, levelOf, recordAnswer, weightOf } from "./progress";
import { buildQuiz, weightedSample } from "./quiz";
import type { Route } from "./types";

const routes = routesData as Route[];

describe("levels", () => {
  it("moves New → Learning → Known → Instant, and drops back on a miss", () => {
    const p = emptyProgress();
    expect(levelOf(p.routes["501"])).toBe("new");
    recordAnswer(p, "501", true, FAST_MS + 1000);
    expect(levelOf(p.routes["501"])).toBe("learning");
    recordAnswer(p, "501", true, FAST_MS + 1000);
    expect(levelOf(p.routes["501"])).toBe("known");
    for (let i = 0; i < 2; i++) recordAnswer(p, "501", true, 1000);
    expect(levelOf(p.routes["501"])).toBe("known"); // only 2 fast so far
    recordAnswer(p, "501", true, 1000);
    expect(levelOf(p.routes["501"])).toBe("instant");
    recordAnswer(p, "501", false, 1000);
    expect(levelOf(p.routes["501"])).toBe("learning");
  });

  it("a slow correct answer keeps Known but resets the Instant streak", () => {
    const p = emptyProgress();
    for (let i = 0; i < 3; i++) recordAnswer(p, "29", true, 1000);
    recordAnswer(p, "29", true, FAST_MS + 1);
    expect(levelOf(p.routes["29"])).toBe("known");
  });

  it("counts levels across a pool", () => {
    const p = emptyProgress();
    recordAnswer(p, "501", false, 1000);
    expect(countLevels(p, ["501", "504", "505"])).toEqual({ new: 2, learning: 1, known: 0, instant: 0 });
  });
});

describe("weighting", () => {
  it("favours weak routes and plays down last round's", () => {
    const p = emptyProgress();
    p.round = 1;
    recordAnswer(p, "501", false, 1000); // learning, seen last round
    p.round = 2;
    recordAnswer(p, "504", false, 1000); // learning, seen in the round just finished
    for (let i = 0; i < 3; i++) recordAnswer(p, "505", true, 1000); // instant
    expect(weightOf(p, "501")).toBeGreaterThan(weightOf(p, "510")); // learning > new
    expect(weightOf(p, "510")).toBeGreaterThan(weightOf(p, "505")); // new > instant
    expect(weightOf(p, "504")).toBeLessThan(weightOf(p, "501")); // just seen
  });

  it("weighted sampling picks heavy items far more often", () => {
    const items = ["heavy", ...Array.from({ length: 9 }, (_, i) => `light${i}`)];
    let hits = 0;
    for (let i = 0; i < 1000; i++) if (weightedSample(items, 1, (x) => (x === "heavy" ? 20 : 1)).includes("heavy")) hits++;
    expect(hits).toBeGreaterThan(600); // expected ≈ 20/29 ≈ 69%
  });

  it("rounds lean towards routes you're still learning", () => {
    const p = emptyProgress();
    const weak = routes.slice(0, 10).map((r) => r.number);
    for (const n of weak) recordAnswer(p, n, false, 1000);
    p.round = 5; // so last-round damping doesn't apply
    let weakPicks = 0;
    for (let i = 0; i < 200; i++) {
      weakPicks += buildQuiz(routes, 5, { weight: (r) => weightOf(p, r.number) }).filter((q) =>
        weak.includes(q.route.number),
      ).length;
    }
    // Uniform would give 10/230 ≈ 4%; weighting should give ≈ 200/860 ≈ 23%.
    expect(weakPicks / 1000).toBeGreaterThan(0.15);
  });
});
