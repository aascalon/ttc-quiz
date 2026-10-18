import type { Answer, Question, Route } from "./types";

export const OPTION_COUNT = 4;
export const QUIZ_LENGTHS = [5, 10, 15] as const;

export type Random = () => number;

/** Fisher–Yates shuffle; returns a new array. */
export function shuffle<T>(items: readonly T[], random: Random = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pick wrong-answer names for a route. Prefers `local` routes (the player's chosen area),
 * and within each pool routes in the same sign colour (regular, Blue Night, Express,
 * community) and mode, so options can't be ruled out at a glance — e.g. a red bus never
 * gets "... Express" options. Falls back to the whole city if the area is too small.
 */
export function pickDistractors(
  answer: Route,
  routes: readonly Route[],
  count = OPTION_COUNT - 1,
  random: Random = Math.random,
  local: readonly Route[] = routes,
): string[] {
  const sameColor = (pool: readonly Route[]) => pool.filter((r) => r.color === answer.color && r.mode === answer.mode);
  const sameMode = (pool: readonly Route[]) => pool.filter((r) => r.mode === answer.mode);
  const pools = [sameColor(local), sameMode(local), sameColor(routes), sameMode(routes), routes];

  const picked = new Set<string>();
  for (const pool of pools) {
    for (const r of shuffle(pool, random)) {
      if (picked.size === count) return [...picked];
      if (r.name !== answer.name) picked.add(r.name);
    }
  }
  if (picked.size < count) throw new Error(`Not enough distinct route names for ${answer.number}`);
  return [...picked];
}

/** Weighted sample without replacement (Efraimidis–Spirakis): higher weight, more likely picked. */
export function weightedSample<T>(items: readonly T[], count: number, weight: (item: T) => number, random: Random = Math.random): T[] {
  return items
    .map((item) => ({ item, key: random() ** (1 / Math.max(weight(item), 1e-6)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, count)
    .map((x) => x.item);
}

export interface QuizOptions {
  random?: Random;
  /** The player's area: questions and, preferably, distractors come from here. Defaults to the whole city. */
  local?: readonly Route[];
  /** Ask only about these routes (e.g. Learn mode); defaults to `local`. Distractors still come from `local`. */
  ask?: readonly Route[];
  /** Relative chance of each route being picked; defaults to uniform. */
  weight?: (route: Route) => number;
}

/**
 * Build a round of `length` questions, each on a different route from `ask` (default `local`).
 * Distractors come from `local` first, then the city.
 */
export function buildQuiz(routes: readonly Route[], length: number, options: QuizOptions = {}): Question[] {
  const { random = Math.random, local = routes, ask = local, weight = () => 1 } = options;
  if (length > ask.length) throw new Error(`Only ${ask.length} routes available`);
  // Sampling decides which routes; shuffle so the weakest ones aren't always first.
  return shuffle(weightedSample(ask, length, weight, random), random).map((route) => ({
    route,
    options: shuffle([route.name, ...pickDistractors(route, routes, OPTION_COUNT - 1, random, local)], random),
  }));
}

/** Round lengths to offer for a pool of `available` routes: the standard ones that fit, plus "all" if smaller. */
export function lengthOptions(available: number): number[] {
  const lengths: readonly number[] = QUIZ_LENGTHS;
  const fits = lengths.filter((n) => n <= available);
  return available > 0 && available < lengths[lengths.length - 1] && !fits.includes(available)
    ? [...fits, available]
    : fits;
}

export function score(answers: readonly Answer[]): number {
  return answers.filter((a) => a.correct).length;
}
