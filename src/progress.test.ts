import { describe, expect, it } from "vitest";
import routesData from "./data/routes.json";
import { FAST_MS, TYPED_FAST_MS, WEIGHTS, countLevels, emptyProgress, levelOf, recordAnswer, restRounds, weightOf } from "./progress";
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

  it("uses the given fast threshold, e.g. the longer one for typed answers", () => {
    const p = emptyProgress();
    const between = (FAST_MS + TYPED_FAST_MS) / 2;
    recordAnswer(p, "tap", true, between);
    recordAnswer(p, "type", true, between, TYPED_FAST_MS);
    expect(p.routes["tap"].fastStreak).toBe(0);
    expect(p.routes["type"].fastStreak).toBe(1);
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
    // Uniform would give 10/230 ≈ 4%; weighting should give ≈ 250/910 ≈ 27%.
    expect(weakPicks / 1000).toBeGreaterThan(0.15);
  });
});

describe("spaced repetition", () => {
  it("rests correct answers longer the more convincing they were", () => {
    const p = emptyProgress();
    recordAnswer(p, "1", true, FAST_MS + 1);
    recordAnswer(p, "2", true, 1000);
    expect(restRounds(p.routes["1"])).toBe(2);
    expect(restRounds(p.routes["2"])).toBe(8);
    for (let i = 0; i < 2; i++) recordAnswer(p, "2", true, 1000);
    expect(restRounds(p.routes["2"])).toBe(32); // Instant: capped
  });

  it("does not re-ask a route answered fast until its rest is over", () => {
    const p = emptyProgress();
    p.round = 1;
    recordAnswer(p, "29", true, 1000);
    p.round = 8;
    expect(weightOf(p, "29")).toBe(WEIGHTS.resting);
    p.round = 9;
    expect(weightOf(p, "29")).toBe(WEIGHTS.dueFast);
  });

  it("brings a slow (possibly guessed) correct answer back sooner, and a miss soonest", () => {
    const p = emptyProgress();
    p.round = 1;
    recordAnswer(p, "slow", true, FAST_MS + 1);
    recordAnswer(p, "miss", false, 1000);
    p.round = 3;
    expect(weightOf(p, "slow")).toBe(WEIGHTS.dueSlow);
    expect(weightOf(p, "miss")).toBeGreaterThan(weightOf(p, "slow"));
  });
});

/** Seeded PRNG so simulated runs are repeatable. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("simulated player", () => {
  // A player who knows 60% of routes instantly, 15% slowly and 25% not at all (guessing,
  // and sometimes learning a route after seeing its answer), playing 40 rounds of 10.
  function simulate(seed: number) {
    const rand = mulberry32(seed);
    const skill = new Map(routes.map((r) => [r.number, rand()]));
    const kind = (n: string) => (skill.get(n)! < 0.6 ? "instant" : skill.get(n)! < 0.75 ? "slow" : "unknown");
    const progress = emptyProgress();
    const shownKnown = new Set<string>();
    let asked = 0;
    let repeatsOfKnown = 0;
    let unknownAsked = 0;
    for (let round = 0; round < 40; round++) {
      const quiz = buildQuiz(routes, 10, { random: rand, weight: (r) => weightOf(progress, r.number) });
      progress.round++;
      for (const { route } of quiz) {
        const n = route.number;
        const k = kind(n);
        asked++;
        if (k === "instant" && shownKnown.has(n)) repeatsOfKnown++;
        if (k === "unknown") unknownAsked++;
        const correct = k !== "unknown" || rand() < 0.25;
        const ms = k === "instant" ? 1000 : k === "slow" ? 3000 : 5000;
        recordAnswer(progress, n, correct, ms);
        if (correct && ms < FAST_MS) shownKnown.add(n);
        if (k === "unknown" && !correct && rand() < 0.35) skill.set(n, 0.7); // now known slowly
      }
    }
    return { repeatsOfKnown: repeatsOfKnown / asked, unknown: unknownAsked / asked };
  }

  it("rarely re-asks routes the player has shown they know, and favours unknown ones", () => {
    const runs = [1, 2, 3, 4, 5].map(simulate);
    const avg = (f: (r: (typeof runs)[0]) => number) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
    // Uniform picking would give ~25% unknown; before spaced repetition, ~28% of questions were repeats.
    expect(avg((r) => r.repeatsOfKnown)).toBeLessThan(0.12);
    expect(avg((r) => r.unknown)).toBeGreaterThan(0.28);
  });
});
