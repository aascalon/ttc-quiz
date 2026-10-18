export type Mode = "bus" | "streetcar";

export interface Route {
  number: string;
  name: string;
  mode: Mode;
  /** Sign colour from GTFS, e.g. red for regular, blue for Blue Night, green for Express. */
  color: string;
}

export interface Question {
  route: Route;
  /** Four route names in display order; exactly one equals route.name. */
  options: string[];
}

export interface Answer {
  question: Question;
  chosen: string;
  correct: boolean;
  /** Time from the question appearing to the answer, in milliseconds. */
  ms: number;
}
