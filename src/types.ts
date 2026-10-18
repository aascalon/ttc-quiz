export type Mode = "bus" | "streetcar";

/** Which way round the quiz goes: see a number and pick its name, or see a name and type its number. */
export type Direction = "number-to-name" | "name-to-number";

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
  question: Question;
  /** The option picked, or the number typed. */
  chosen: string;
  correct: boolean;
  /** Time from the question appearing to the answer, in milliseconds. */
  ms: number;
}
