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

// Learning is weighted well above New so missed routes come back soon even when hundreds are unseen.
const LEVEL_WEIGHTS: Record<Level, number> = { learning: 20, new: 3, known: 1.5, instant: 0.4 };

/**
 * How strongly to favour a route when picking the next round (started as round
 * `progress.round + 1`): weakest first, and less of what you just saw last round.
 */
export function weightOf(progress: Progress, number: string): number {
  const stats = progress.routes[number];
  const base = LEVEL_WEIGHTS[levelOf(stats)];
  return stats && stats.lastRound === progress.round ? base * 0.2 : base;
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
