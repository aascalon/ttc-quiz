import type { DrawScore } from "./drawScore";

export type Mode = "bus" | "streetcar";

/**
 * Which quiz: what you're shown → what you answer. Number and shape quizzes each come in two
 * directions, swapped with ⇄ on the start screen.
 */
export type QuizKind = "number-to-name" | "name-to-number" | "shape-to-name" | "name-to-shape";
export type QuizFamily = "number" | "shape";

export function familyOf(kind: QuizKind): QuizFamily {
  return kind === "number-to-name" || kind === "name-to-number" ? "number" : "shape";
}

export interface Route {
  number: string;
  name: string;
  mode: Mode;
  /** Sign colour from GTFS, e.g. red for regular, blue for Blue Night, green for Express. */
  color: string;
}

export interface Question {
  route: Route;
  /** Four route names in display order, exactly one equal to route.name; empty when the answer is typed. */
  options: string[];
}

export interface Answer {
  /** For drawn answers, how close the drawing was. */
  drawing?: DrawScore;
  question: Question;
  /** The option picked, the number typed, or the drawing's score. */
  chosen: string;
  correct: boolean;
  /** Time from the question appearing to the answer, in milliseconds. */
  ms: number;
}
