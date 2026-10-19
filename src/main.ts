import "./style.css";
import routesData from "./data/routes.json";
import type { Polygon } from "./geo";
import type { AreaPicker, MissedMap, ShapeMap } from "./map";
import {
  LEVELS,
  LEVEL_LABELS,
  countLevels,
  emptyProgress,
  fastMsFor,
  levelOf,
  loadProgress,
  recordAnswer,
  saveProgress,
  weightOf,
  type Level,
} from "./progress";
import { buildQuiz, lengthOptions, score } from "./quiz";
import { familyOf, type Answer, type Question, type QuizFamily, type QuizKind, type Route } from "./types";

const routes = routesData as Route[];
const routesByNumber = new Map(routes.map((r) => [r.number, r]));
const app = document.querySelector<HTMLElement>("#app")!;

// Where the questions come from. Kept outside `State` so it survives across rounds.
type Scope = "city" | "area";
const STORAGE_KEY = "ttc-quiz:area";
let scope: Scope = "city";
let area: Polygon | null = null;
let areaNumbers = new Set<string>();
let picker: AreaPicker | null = null;
let pickerLoading = false;
// The results map is rebuilt for each results screen.
let missedMap: MissedMap | null = null;
let focusedRoute: string | null = null;

// The map module (Leaflet and the route lines) loads on demand, and before a shape quiz starts.
type Maps = typeof import("./map");
let maps: Maps | null = null;
let mapsLoading: Promise<Maps> | null = null;
function loadMaps(): Promise<Maps> {
  mapsLoading ??= import("./map").then(
    (m) => (maps = m),
    (err) => {
      mapsLoading = null; // Let a later attempt retry.
      throw err;
    },
  );
  return mapsLoading;
}
// One shape quiz map, reused for every question.
let shapeMap: ShapeMap | null = null;

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  if (saved?.scope === "area" || saved?.scope === "city") scope = saved.scope;
  if (Array.isArray(saved?.area) && saved.area.length >= 3) area = saved.area;
} catch {
  // Storage unavailable or corrupt; start fresh.
}

function saveScope(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scope, area }));
  } catch {
    // Not critical.
  }
}

function activeRoutes(): Route[] {
  return scope === "city" ? routes : routes.filter((r) => areaNumbers.has(r.number));
}

const QUIZZES: Record<QuizKind, { title: string; lede: string; label: string; flip: QuizKind }> = {
  "number-to-name": {
    title: "Name that route",
    lede: "You'll see a TTC route number. Pick its name from four options.",
    label: "number → name",
    flip: "name-to-number",
  },
  "name-to-number": {
    title: "Number that route",
    lede: "You'll see a TTC route's name on its sign. Type its number.",
    label: "name → number",
    flip: "number-to-name",
  },
  "shape-to-name": {
    title: "Name that line",
    lede: "You'll see a TTC route's line on a map. Pick its name from four options.",
    label: "line → name",
    flip: "name-to-shape",
  },
  "name-to-shape": {
    title: "Draw that route",
    lede: "You'll see a TTC route's name. Draw where it runs on the map.",
    label: "name → line",
    flip: "shape-to-name",
  },
};
/** Quizzes that can be played so far. */
const AVAILABLE = new Set<QuizKind>(["number-to-name", "name-to-number", "shape-to-name"]);

// The chosen quiz, and which way round each family was last played (so picking a row
// brings back the direction you left it in).
const QUIZ_KEY = "ttc-quiz:quiz";
const directions: Record<QuizFamily, QuizKind> = { number: "number-to-name", shape: "shape-to-name" };
let quiz: QuizKind = "number-to-name";
try {
  const saved = JSON.parse(localStorage.getItem(QUIZ_KEY) ?? "null");
  const usable = (kind: unknown, family: QuizFamily): kind is QuizKind =>
    AVAILABLE.has(kind as QuizKind) && familyOf(kind as QuizKind) === family;
  if (saved) {
    if (usable(saved.number, "number")) directions.number = saved.number;
    if (usable(saved.shape, "shape")) directions.shape = saved.shape;
    if (AVAILABLE.has(saved.quiz)) quiz = directions[familyOf(saved.quiz)];
  } else if (localStorage.getItem("ttc-quiz:direction") === "name-to-number") {
    // Saved before there were shape quizzes.
    quiz = directions.number = "name-to-number";
  }
} catch {
  // Storage unavailable or corrupt; use the defaults.
}
// Set when a row's direction was just swapped, so its swap button can animate once.
let justSwapped: QuizFamily | null = null;

function selectQuiz(kind: QuizKind): void {
  quiz = directions[familyOf(kind)] = kind;
  try {
    localStorage.setItem(QUIZ_KEY, JSON.stringify({ quiz, ...directions }));
  } catch {
    // Not critical.
  }
  progress = loadProgress(quiz);
  render();
}

function swapDirection(family: QuizFamily): void {
  const flipped = QUIZZES[directions[family]].flip;
  if (!AVAILABLE.has(flipped)) return;
  justSwapped = family;
  selectQuiz(flipped);
}

/** Multiple choice (four names), as opposed to typing or drawing the answer. */
function isMultipleChoice(): boolean {
  return quiz === "number-to-name" || quiz === "shape-to-name";
}

/** Progress for the current quiz; each quiz is tracked separately. */
let progress = loadProgress(quiz);

// Sign colours from the GTFS feed, as words for the name → number question.
const SERVICE_LABELS: Record<string, string> = {
  "#0054A6": "Blue Night",
  "#00A651": "Express",
  "#6D6E71": "community",
  "#E472AC": "seasonal",
};

/** E.g. "Blue Night streetcar" or just "bus". Every name is unique once this is added. */
function describeRoute(route: Route): string {
  const service = SERVICE_LABELS[route.color.toUpperCase()];
  // "Keele Express" doesn't need to be called an Express route as well.
  return service && !route.name.includes(service) ? `${service} ${route.mode}` : route.mode;
}

/** Each question's route level at the start of the round, to show what changed. */
type LevelsBefore = Record<string, Level>;

/** "learn" asks only about routes in the Learning stage. */
type Mode = "quiz" | "learn";
const LEARN_LENGTH = 15;

type State =
  | { screen: "start" }
  | { screen: "question"; mode: Mode; length: number; questions: Question[]; index: number; answers: Answer[]; before: LevelsBefore }
  | { screen: "results"; mode: Mode; length: number; answers: Answer[]; before: LevelsBefore };

let state: State = { screen: "start" };

// Answer timing. Time spent with the tab hidden doesn't count as a fast answer.
let shownAt = 0;
let hiddenDuringQuestion = false;
function startTimer(): void {
  shownAt = performance.now();
  hiddenDuringQuestion = false;
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenDuringQuestion = true;
});

const LEVEL_RANK: Record<Level, number> = { new: 0, learning: 1, known: 2, instant: 3 };

function levelPill(level: Level): string {
  return `<span class="level level-${level}">${LEVEL_LABELS[level]}</span>`;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function badge(route: Route, size: "lg" | "sm" = "lg"): string {
  return `<span class="badge badge-${size}" style="--route-color:${route.color}">${escapeHtml(route.number)}</span>`;
}

function setState(next: State): void {
  state = next;
  render();
}

/** Routes in the current scope that are in the Learning stage. */
function learningRoutes(): Route[] {
  return activeRoutes().filter((r) => levelOf(progress.routes[r.number]) === "learning");
}

function start(mode: Mode, requested: number): void {
  const m = maps;
  if (familyOf(quiz) === "shape" && !m) {
    // Rare: the map module is normally loaded while on the start screen.
    const actions = document.querySelector<HTMLElement>("#start-actions");
    if (actions) actions.innerHTML = `<p class="hint">Loading map…</p>`;
    loadMaps().then(
      () => start(mode, requested),
      () => {
        if (actions) actions.innerHTML = `<p class="hint">Couldn't load the map. Check your connection and try again.</p>`;
      },
    );
    return;
  }
  // Learn mode drills Learning routes, ignoring rest times; weights still put misses first.
  const ask = mode === "learn" ? learningRoutes() : activeRoutes();
  const length = Math.min(requested, ask.length);
  if (length === 0) return setState({ screen: "start" });
  const questions = buildQuiz(routes, length, {
    local: activeRoutes(),
    ask,
    weight: (r) => weightOf(progress, r.number),
    choices: isMultipleChoice(),
    // From a line, the hard wrong answers are routes running nearby, and a lookalike
    // (e.g. 29 Dufferin vs. 929 Dufferin Express) can't be told apart at all.
    distractors:
      quiz === "shape-to-name" && m
        ? (r) => ({
            prefer: m.nearbyRoutes(r.number).map((n) => routesByNumber.get(n)!),
            exclude: new Set(m.lookalikes[r.number] ?? []),
          })
        : undefined,
  });
  const before = Object.fromEntries(questions.map((q) => [q.route.number, levelOf(progress.routes[q.route.number])]));
  progress.round++;
  saveProgress(progress, quiz);
  startTimer();
  setState({ screen: "question", mode, length: requested, questions, index: 0, answers: [], before });
}

function isAnswered(): boolean {
  return state.screen === "question" && state.answers.length > state.index;
}

function submitAnswer(chosen: string, correct: boolean): void {
  if (state.screen !== "question" || isAnswered()) return;
  const question = state.questions[state.index];
  const fastMs = fastMsFor(quiz);
  const elapsed = performance.now() - shownAt;
  const ms = hiddenDuringQuestion ? Math.max(elapsed, fastMs) : elapsed;
  state.answers.push({ question, chosen, correct, ms });
  recordAnswer(progress, question.route.number, correct, ms, ms < fastMs);
  saveProgress(progress, quiz);
  render();
}

/** Multiple choice: pick one of the four names. */
function choose(optionIndex: number): void {
  if (state.screen !== "question") return;
  const question = state.questions[state.index];
  const chosen = question.options[optionIndex];
  if (chosen !== undefined) submitAnswer(chosen, chosen === question.route.name);
}

/** Name → number: check the typed number. */
function submitTyped(value: string): void {
  if (state.screen !== "question") return;
  const typed = value.trim();
  if (typed) submitAnswer(typed, typed === state.questions[state.index].route.number);
}

function next(): void {
  if (state.screen !== "question" || !isAnswered()) return;
  if (state.index + 1 < state.questions.length) {
    startTimer();
    setState({ ...state, index: state.index + 1 });
  } else {
    setState({ screen: "results", mode: state.mode, length: state.length, answers: state.answers, before: state.before });
  }
}

const SWAP_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 8h15m0 0-4-4m4 4-4 4M20 16H5m0 0 4-4m-4 4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const SAMPLE_NUMBER = `<span class="badge badge-sm" style="--route-color:#ED1C24">501</span>`;
const SAMPLE_NAME = `<span class="name-chip">Queen</span>`;
const SAMPLE_LINE = `<span class="line-chip" role="img" aria-label="a route's line on a map"><svg viewBox="0 0 48 20" width="48" height="20" aria-hidden="true"><path d="M3 16h12l6-10h14l10-3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;

/** What each quiz shows, how you answer, and what with. */
const SIDES: Record<QuizKind, [shown: string, verb: string, answer: string]> = {
  "number-to-name": [SAMPLE_NUMBER, "You pick", SAMPLE_NAME],
  "name-to-number": [SAMPLE_NAME, "You type", SAMPLE_NUMBER],
  "shape-to-name": [SAMPLE_LINE, "You pick", SAMPLE_NAME],
  "name-to-shape": [SAMPLE_NAME, "You draw", SAMPLE_LINE],
};

/**
 * One row per quiz family, e.g. "You see [501] ⇄ [Queen] You pick". Picking a row selects
 * that quiz; ⇄ flips its direction.
 */
function renderQuizPicker(): string {
  const row = (family: QuizFamily): string => {
    const kind = directions[family];
    const [shown, verb, answer] = SIDES[kind];
    const selected = familyOf(quiz) === family;
    const available = AVAILABLE.has(kind);
    const flip = QUIZZES[kind].flip;
    const swapLabel = AVAILABLE.has(flip) ? `Switch to ${QUIZZES[flip].label}` : `${QUIZZES[flip].label}: coming soon`;
    return `
      <label class="direction${selected ? " is-selected" : ""}${available ? "" : " is-disabled"}">
        <input class="quiz-radio" type="radio" name="quiz" data-action="pick" data-family="${family}"
          aria-label="${QUIZZES[kind].label}" ${selected ? "checked" : ""} ${available ? "" : "disabled"} />
        <div class="direction-side"><span class="direction-caption">You see</span>${shown}</div>
        <button type="button" class="swap${justSwapped === family ? " is-swapping" : ""}" data-action="swap" data-family="${family}"
          aria-label="${swapLabel}" title="${swapLabel}" ${AVAILABLE.has(flip) ? "" : "disabled"}>${SWAP_ICON}</button>
        <div class="direction-side"><span class="direction-caption">${verb}</span>${answer}</div>
        ${available ? "" : `<span class="soon">Coming soon</span>`}
      </label>`;
  };
  return `<div class="quiz-picker" role="radiogroup" aria-label="Which quiz">${row("number")}${row("shape")}</div>`;
}

function renderStart(): string {
  const { title, lede } = QUIZZES[quiz];
  return `
    <section class="card">
      <h1>${title}</h1>
      <p class="lede">${lede}</p>
      ${renderQuizPicker()}
      <div class="scope" role="group" aria-label="Which routes">
        <button class="scope-btn" data-action="scope" data-scope="city" aria-pressed="${scope === "city"}">Whole city</button>
        <button class="scope-btn" data-action="scope" data-scope="area" aria-pressed="${scope === "area"}">Pick an area</button>
      </div>
      ${scope === "area" ? `<div id="map-slot" class="map-slot"><p class="hint">Loading map…</p></div>` : ""}
      <div id="start-actions">${renderStartActions()}</div>
    </section>`;
}

function renderStartActions(): string {
  if (scope === "area" && !picker) return "";
  if (scope === "area" && !area) return `<p class="hint">Draw an area to quiz yourself on the routes that pass through it.</p>`;
  const pool = activeRoutes();
  if (pool.length === 0) return `<p class="hint">No routes pass through this area. Try drawing a bigger one.</p>`;
  // The map toolbar already shows the area's route count.
  const summary =
    scope === "city" ? `<p class="hint">All ${pool.length} bus and streetcar routes, including Blue Night and Express.</p>` : "";
  return `
    ${summary}
    ${renderProgressPanel(pool)}
    <div class="lengths">
      ${lengthOptions(pool.length)
        .map((n) => `<button class="btn btn-primary" data-action="start" data-length="${n}">${n} question${n === 1 ? "" : "s"}</button>`)
        .join("")}
    </div>
    ${renderLearnButton()}`;
}

function renderLearnButton(): string {
  const count = learningRoutes().length;
  const where = scope === "area" ? " in this area" : "";
  return `
    <div class="learn">
      <button class="btn btn-learn" data-action="learn" ${count ? "" : "disabled"}>
        Learn mode
        <span>${count ? `Practise your ${count} Learning route${count === 1 ? "" : "s"}${where}` : `No routes in Learning${where} yet`}</span>
      </button>
    </div>`;
}

function renderProgressPanel(pool: Route[]): string {
  const counts = countLevels(progress, pool.map((r) => r.number));
  if (counts.new === pool.length) {
    return `<p class="hint">Your progress is saved in this browser. Routes you miss come up more often until you know them.</p>`;
  }
  const segments = LEVELS.filter((l) => counts[l] > 0)
    .map((l) => `<div class="seg level-${l}" style="flex:${counts[l]}" title="${LEVEL_LABELS[l]}: ${counts[l]}"></div>`)
    .join("");
  const legend = LEVELS.map(
    (l) => `<li><span class="dot level-${l}"></span>${LEVEL_LABELS[l]} <strong>${counts[l]}</strong></li>`,
  ).join("");
  return `
    <div class="mastery">
      <div class="mastery-head">
        <h2>Your progress${scope === "area" ? " in this area" : ""}</h2>
        <button class="link-btn" data-action="reset">Reset</button>
      </div>
      <div class="mastery-bar" role="img" aria-label="${LEVELS.map((l) => `${counts[l]} ${LEVEL_LABELS[l]}`).join(", ")}">${segments}</div>
      <ul class="mastery-legend">${legend}</ul>
      <p class="hint">Instant means right 3 times in a row, each in under ${fastMsFor(quiz) / 1000} seconds. Missed routes come back soon; ones you know rest for a while.</p>
    </div>`;
}

function updateStartActions(): void {
  const el = document.querySelector<HTMLElement>("#start-actions");
  if (el) el.innerHTML = renderStartActions();
}

/** Put the (persistent) map into the start screen, loading the map module the first time. */
function mountPicker(): void {
  const slot = document.querySelector<HTMLElement>("#map-slot");
  if (!slot) return;
  if (picker) {
    slot.replaceChildren(picker.element);
    picker.refresh();
    updateStartActions();
    return;
  }
  if (pickerLoading) return;
  pickerLoading = true;
  import("./map")
    .then(({ createAreaPicker }) => {
      picker = createAreaPicker(area, (polygon, numbers) => {
        area = polygon;
        areaNumbers = numbers;
        saveScope();
        updateStartActions();
      });
      mountPicker();
    })
    .catch(() => {
      slot.innerHTML = `<p class="hint">Couldn't load the map. Check your connection and try again.</p>`;
    })
    .finally(() => {
      pickerLoading = false;
    });
}

/** The four name options. */
function renderOptions(question: Question, answer: Answer | undefined): string {
  const options = question.options
    .map((name, i) => {
      let cls = "option";
      if (answer) {
        if (name === question.route.name) cls += " correct";
        else if (name === answer.chosen) cls += " wrong";
      }
      return `<button class="${cls}" data-action="choose" data-index="${i}" ${answer ? "disabled" : ""}>
          <kbd>${i + 1}</kbd><span>${escapeHtml(name)}</span>
        </button>`;
    })
    .join("");
  return `<div class="options">${options}</div>`;
}

/** Number → name: the number sign and four name options. */
function renderChoices(question: Question, answer: Answer | undefined): { prompt: string; body: string } {
  return {
    prompt: `${badge(question.route)}<p>What is the name of this ${question.route.mode} route?</p>`,
    body: renderOptions(question, answer),
  };
}

/** Shape → name: the route's line on a map (mounted after render) and four name options. */
function renderShape(question: Question, answer: Answer | undefined): { prompt: string; body: string } {
  return {
    prompt: `<div id="shape-map-slot" class="map-slot shape-slot"><p class="hint">Loading map…</p></div>
      <p>Which ${describeRoute(question.route)} route runs here?</p>`,
    body: renderOptions(question, answer),
  };
}

/** Name → number: the name on a sign in the route's colour, and a box to type the number. */
function renderTyped(question: Question, answer: Answer | undefined): { prompt: string; body: string } {
  const { route } = question;
  const mark = answer ? (answer.correct ? " correct" : " wrong") : "";
  return {
    prompt: `<span class="badge badge-name" style="--route-color:${route.color}">${escapeHtml(route.name)}</span>
      <p>What's the number of this ${describeRoute(route)} route?</p>`,
    body: `
      <form class="typed" data-form="typed">
        <input class="typed-input${mark}" name="answer" inputmode="numeric" pattern="[0-9]*" maxlength="3"
          autocomplete="off" aria-label="Route number" ${answer ? `value="${escapeHtml(answer.chosen)}" disabled` : "autofocus"} />
        ${answer ? "" : `<button class="btn btn-primary" type="submit">Check</button>`}
      </form>`,
  };
}

function renderQuestion(s: Extract<State, { screen: "question" }>): string {
  const question = s.questions[s.index];
  const answer = s.answers[s.index];
  const total = s.questions.length;
  const typed = quiz === "name-to-number";
  const { prompt, body } = typed
    ? renderTyped(question, answer)
    : quiz === "shape-to-name"
      ? renderShape(question, answer)
      : renderChoices(question, answer);

  const level = levelOf(progress.routes[question.route.number]);
  // In the shape quiz the number is news too, so it's shown alongside the name.
  const rightAnswer = typed
    ? escapeHtml(question.route.number)
    : quiz === "shape-to-name"
      ? `${badge(question.route, "sm")} ${escapeHtml(question.route.name)}`
      : escapeHtml(question.route.name);
  const feedback = answer
    ? `<div class="feedback ${answer.correct ? "is-correct" : "is-wrong"}">
         <div>
           <p>${
             answer.correct
               ? `Correct!${quiz === "shape-to-name" ? ` It's ${rightAnswer}.` : ""}`
               : `Not quite. It's <strong>${rightAnswer}</strong>.`
           }</p>
           <p class="feedback-meta">${answer.correct ? `<span class="time${answer.ms < fastMsFor(quiz) ? " fast" : ""}">${formatSeconds(answer.ms)}</span>` : ""}${levelPill(level)}</p>
         </div>
         <button class="btn btn-primary" data-action="next" autofocus>
           ${s.index + 1 < total ? "Next" : "See results"}
         </button>
       </div>`
    : "";

  return `
    <section class="card">
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${s.index + 1}">
        <span>${s.mode === "learn" ? `<span class="mode-tag">Learn mode</span> ` : ""}Question ${s.index + 1} / ${total}</span>
        <span>Score ${score(s.answers)}</span>
        <div class="bar"><div style="width:${((s.index + (answer ? 1 : 0)) / total) * 100}%"></div></div>
      </div>
      <div class="prompt">${prompt}</div>
      ${body}
      ${feedback}
    </section>`;
}

function renderResults(s: Extract<State, { screen: "results" }>): string {
  const correct = score(s.answers);
  const missed = s.answers.filter((a) => !a.correct);
  const pct = correct / s.answers.length;
  const verdict =
    pct === 1 ? "Perfect run. You know your routes!" : pct >= 0.7 ? "Nice work." : pct >= 0.4 ? "Not bad. Keep riding." : "Time for a few more trips.";
  const correctTimes = s.answers.filter((a) => a.correct).map((a) => a.ms);
  const avg = correctTimes.length ? correctTimes.reduce((a, b) => a + b, 0) / correctTimes.length : 0;
  // Reaching Known or Instant is worth celebrating; New → Learning is just "seen it".
  const movedUp = s.answers.filter((a) => {
    const after = levelOf(progress.routes[a.question.route.number]);
    return LEVEL_RANK[after] > LEVEL_RANK[s.before[a.question.route.number]] && LEVEL_RANK[after] >= LEVEL_RANK.known;
  });

  return `
    <section class="card">
      <h1>${correct} / ${s.answers.length}</h1>
      <p class="lede">${verdict}</p>
      ${avg ? `<p class="hint">Average time on correct answers: ${formatSeconds(avg)}</p>` : ""}
      ${
        movedUp.length
          ? `<h2>Levelled up</h2>
             <ul class="review">
               ${movedUp
                 .map(
                   (a) => `<li>${badge(a.question.route, "sm")}
                     <div><strong>${escapeHtml(a.question.route.name)}</strong></div>
                     ${levelPill(levelOf(progress.routes[a.question.route.number]))}</li>`,
                 )
                 .join("")}
             </ul>`
          : ""
      }
      ${
        missed.length
          ? `<h2>Review</h2>
             <div id="missed-map-slot" class="map-slot"><p class="hint">Loading map…</p></div>
             <ul class="review review-missed">
               ${missed
                 .map(
                   (a) => `<li data-route="${escapeHtml(a.question.route.number)}" tabindex="0">${badge(a.question.route, "sm")}
                     <div><strong>${escapeHtml(a.question.route.name)}</strong>
                     <span class="muted">${describeMistake(a)}</span></div></li>`,
                 )
                 .join("")}
             </ul>`
          : ""
      }
      ${renderResultsActions(s)}
    </section>`;
}

/** "You picked Queen", or for typed answers "You typed 501 (Queen)". */
function describeMistake(a: Answer): string {
  if (isMultipleChoice()) return `You picked ${escapeHtml(a.chosen)}`;
  const typedRoute = routesByNumber.get(a.chosen);
  const which = typedRoute ? `${escapeHtml(typedRoute.name)}${typedRoute.name === a.question.route.name ? `, the ${describeRoute(typedRoute)}` : ""}` : "no such route";
  return `You typed ${escapeHtml(a.chosen)} (${which})`;
}

function renderResultsActions(s: Extract<State, { screen: "results" }>): string {
  if (s.mode === "quiz") {
    return `
      <div class="lengths">
        <button class="btn btn-primary" data-action="start" data-length="${s.length}">Play again</button>
        <button class="btn" data-action="home">Change quiz</button>
      </div>`;
  }
  const left = learningRoutes().length;
  return `
    ${left ? `<p class="hint">${left} route${left === 1 ? "" : "s"} still in Learning. Each needs 2 right in a row to move up to Known.</p>` : `<p class="lede">You've cleared everything in Learning!</p>`}
    <div class="lengths">
      ${left ? `<button class="btn btn-primary" data-action="learn">Keep practising</button>` : ""}
      <button class="btn${left ? "" : " btn-primary"}" data-action="home">Back to start</button>
    </div>`;
}

/** Show the missed routes on a map, loading the map module if needed. */
function mountMissedMap(numbers: string[]): void {
  import("./map")
    .then(({ createMissedMap }) => {
      const slot = document.querySelector<HTMLElement>("#missed-map-slot");
      if (!slot || missedMap) return; // Left the results screen while loading.
      missedMap = createMissedMap(numbers, scope === "area" ? area : null);
      slot.replaceChildren(missedMap.element);
      missedMap.refresh();
      // A route may have been picked from the list while the map was loading.
      if (focusedRoute) missedMap.focus(focusedRoute);
    })
    .catch(() => {
      document.querySelector("#missed-map-slot")?.remove();
    });
}

/** Put the shape quiz map into the question, showing this question's route. */
function mountShapeMap(s: Extract<State, { screen: "question" }>): void {
  const slot = document.querySelector<HTMLElement>("#shape-map-slot");
  if (!slot || !maps) return;
  shapeMap ??= maps.createShapeMap();
  slot.replaceChildren(shapeMap.element);
  shapeMap.show(s.questions[s.index].route.number, isAnswered());
}

function focusRoute(number: string | null): void {
  focusedRoute = number;
  missedMap?.focus(number);
  for (const li of document.querySelectorAll<HTMLElement>(".review-missed [data-route]")) {
    li.classList.toggle("is-focus", li.dataset.route === number);
  }
}

const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

/** Focus an element, scrolling it into view smoothly (and only as far as needed) rather than jumping. */
function focusGently(el: HTMLElement | null): void {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView?.({ block: "nearest", behavior: reducedMotion?.matches ? "auto" : "smooth" });
}

function render(): void {
  missedMap?.destroy();
  missedMap = null;
  focusedRoute = null;
  app.innerHTML =
    state.screen === "start" ? renderStart() : state.screen === "question" ? renderQuestion(state) : renderResults(state);
  // Put the map back before focusing: focusing scrolls to the element, so the page has to
  // be its final height by then or the scroll position ends up off.
  if (state.screen === "question" && quiz === "shape-to-name") mountShapeMap(state);
  focusGently(app.querySelector<HTMLElement>("[autofocus]"));
  // Re-rendering after a swap would otherwise drop keyboard focus from the swap button.
  if (justSwapped) app.querySelector<HTMLElement>(`.swap[data-family="${justSwapped}"]`)?.focus();
  justSwapped = null;
  if (state.screen === "start" && scope === "area") mountPicker();
  if (state.screen === "start" && familyOf(quiz) === "shape") loadMaps().catch(() => {});
  if (state.screen === "results") {
    const missed = state.answers.filter((a) => !a.correct).map((a) => a.question.route.number);
    if (missed.length) mountMissedMap(missed);
  }
}

// Hovering (or tapping) a missed route in the review list picks it out on the map.
const reviewItem = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>(".review-missed [data-route]");
app.addEventListener("mouseover", (e) => {
  const li = reviewItem(e);
  if (li) focusRoute(li.dataset.route!);
});
app.addEventListener("mouseout", (e) => {
  const li = reviewItem(e);
  if (li && !li.contains(e.relatedTarget as Node)) focusRoute(null);
});
app.addEventListener("focusin", (e) => {
  const li = reviewItem(e);
  if (li) focusRoute(li.dataset.route!);
});

app.addEventListener("click", (e) => {
  const li = reviewItem(e);
  if (li) return focusRoute(focusedRoute === li.dataset.route ? null : li.dataset.route!);
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!el) return;
  switch (el.dataset.action) {
    case "start":
      return start("quiz", Number(el.dataset.length));
    case "learn":
      return start("learn", LEARN_LENGTH);
    case "choose":
      return choose(Number(el.dataset.index));
    case "next":
      return next();
    case "home":
      return setState({ screen: "start" });
    case "reset": {
      if (!confirm(`Reset your ${QUIZZES[quiz].label} progress for every route? This can't be undone.`)) return;
      progress = emptyProgress();
      saveProgress(progress, quiz);
      return updateStartActions();
    }
    case "pick": {
      const family = el.dataset.family as QuizFamily;
      if (familyOf(quiz) !== family) selectQuiz(directions[family]);
      return;
    }
    case "swap":
      return swapDirection(el.dataset.family as QuizFamily);
    case "scope":
      scope = el.dataset.scope === "area" ? "area" : "city";
      saveScope();
      return render();
  }
});

app.addEventListener("submit", (e) => {
  const form = (e.target as HTMLElement).closest<HTMLFormElement>('[data-form="typed"]');
  if (!form) return;
  e.preventDefault();
  submitTyped(form.querySelector("input")!.value);
});
// Keep the number box to digits only.
app.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.classList.contains("typed-input")) input.value = input.value.replace(/\D/g, "");
});

document.addEventListener("keydown", (e) => {
  if (state.screen !== "question" || e.metaKey || e.ctrlKey || e.altKey) return;
  // 1–4 pick an option, but in name → number they're typed into the box instead.
  if (isMultipleChoice() && /^[1-4]$/.test(e.key)) {
    choose(Number(e.key) - 1);
  } else if (e.key === "Enter" && isAnswered()) {
    e.preventDefault();
    next();
  }
});

render();
