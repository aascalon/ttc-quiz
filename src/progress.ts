// Per-route learning progress, kept in the browser. Each answer updates a route's
// streaks; levels and question weights are derived from those.

export type Level = "new" | "learning" | "known" | "instant";

export const LEVELS: readonly Level[] = ["instant", "known", "learning", "new"];
export const LEVEL_LABELS: Record<Level, string> = {
  new: "New",
  learning: "Learning",
  known: "Known",
  instant: "Instant",
};

/** An answer this fast (and correct) counts towards "instant" recognition. */
export const FAST_MS = 2000;
const KNOWN_STREAK = 2;
const INSTANT_STREAK = 3;

export interface RouteStats {
  seen: number;
  correct: number;
  /** Consecutive correct answers. */
  streak: number;
  /** Consecutive correct answers under FAST_MS. */
  fastStreak: number;
  /** Round number of the most recent answer. */
  lastRound: number;
  lastMs: number;
}

export interface Progress {
  v: 1;
  /** Number of rounds started. */
  round: number;
  routes: Record<string, RouteStats>;
}

export function emptyProgress(): Progress {
  return { v: 1, round: 0, routes: {} };
}

export function levelOf(stats: RouteStats | undefined): Level {
  if (!stats || stats.seen === 0) return "new";
  if (stats.fastStreak >= INSTANT_STREAK) return "instant";
  if (stats.streak >= KNOWN_STREAK) return "known";
  return "learning";
}

/** Record an answer, returning the updated stats. */
export function recordAnswer(progress: Progress, number: string, correct: boolean, ms: number): RouteStats {
  const prev = progress.routes[number] ?? { seen: 0, correct: 0, streak: 0, fastStreak: 0, lastRound: 0, lastMs: 0 };
  const fast = correct && ms < FAST_MS;
  const next: RouteStats = {
    seen: prev.seen + 1,
    correct: prev.correct + (correct ? 1 : 0),
    streak: correct ? prev.streak + 1 : 0,
    fastStreak: fast ? prev.fastStreak + 1 : 0,
    lastRound: progress.round,
    lastMs: ms,
  };
  progress.routes[number] = next;
  return next;
}

// Tuned by simulating players (see the progress tests): these keep re-asks of routes the
// player has already shown they know low without slowing down finding the ones they don't.
export const WEIGHTS = {
  /** Last answer wrong: bring it back soon. */
  missed: 25,
  /** Never asked: some exploring is needed to find what you don't know. */
  new: 3,
  /** Right last time, and its wait is over. A slow answer may have been a guess. */
  dueSlow: 6,
  dueFast: 1,
  /** Right last time and still within its wait. */
  resting: 0.05,
};

const MAX_REST_ROUNDS = 32;

/**
 * Rounds to wait before re-asking a route answered correctly, doubling with each correct
 * answer in a row. Fast answers are strong evidence (a guess is rarely also quick), so they
 * count triple. E.g. one slow answer: 2 rounds, one fast answer: 8, Instant: the cap of 32.
 */
export function restRounds(stats: RouteStats): number {
  return Math.min(2 ** (stats.streak + 2 * stats.fastStreak), MAX_REST_ROUNDS);
}

/**
 * How strongly to favour a route when picking the next round (started as round
 * `progress.round + 1`). A simple spaced-repetition scheme: misses come back soon,
 * correct answers rest for longer the more convincing they were.
 */
export function weightOf(progress: Progress, number: string): number {
  const stats = progress.routes[number];
  if (!stats || stats.seen === 0) return WEIGHTS.new;
  // 0 means it was answered in the round that just finished.
  const roundsSince = progress.round - stats.lastRound;
  if (stats.streak === 0) return roundsSince === 0 ? WEIGHTS.missed * 0.3 : WEIGHTS.missed;
  if (roundsSince < restRounds(stats)) return WEIGHTS.resting;
  return stats.fastStreak > 0 ? WEIGHTS.dueFast : WEIGHTS.dueSlow;
}

export function countLevels(progress: Progress, numbers: Iterable<string>): Record<Level, number> {
  const counts: Record<Level, number> = { new: 0, learning: 0, known: 0, instant: 0 };
  for (const n of numbers) counts[levelOf(progress.routes[n])]++;
  return counts;
}

const STORAGE_KEY = "ttc-quiz:progress";

export function loadProgress(): Progress {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved?.v === 1 && typeof saved.round === "number" && saved.routes) return saved;
  } catch {
    // Storage unavailable or corrupt; start fresh.
  }
  return emptyProgress();
}

export function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Progress just won't persist this session.
  }
}
