import "./style.css";
import routesData from "./data/routes.json";
import type { Polygon } from "./geo";
import type { AreaPicker, MissedMap } from "./map";
import {
  FAST_MS,
  LEVELS,
  LEVEL_LABELS,
  countLevels,
  emptyProgress,
  levelOf,
  loadProgress,
  recordAnswer,
  saveProgress,
  weightOf,
  type Level,
} from "./progress";
import { buildQuiz, lengthOptions, score } from "./quiz";
import type { Answer, Question, Route } from "./types";

const routes = routesData as Route[];
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

let progress = loadProgress();

/** Each question's route level at the start of the round, to show what changed. */
type LevelsBefore = Record<string, Level>;

type State =
  | { screen: "start" }
  | { screen: "question"; length: number; questions: Question[]; index: number; answers: Answer[]; before: LevelsBefore }
  | { screen: "results"; length: number; answers: Answer[]; before: LevelsBefore };

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

function start(length: number): void {
  const questions = buildQuiz(routes, length, { local: activeRoutes(), weight: (r) => weightOf(progress, r.number) });
  const before = Object.fromEntries(questions.map((q) => [q.route.number, levelOf(progress.routes[q.route.number])]));
  progress.round++;
  saveProgress(progress);
  startTimer();
  setState({ screen: "question", length, questions, index: 0, answers: [], before });
}

function choose(optionIndex: number): void {
  if (state.screen !== "question" || state.answers.length > state.index) return;
  const question = state.questions[state.index];
  const chosen = question.options[optionIndex];
  if (chosen === undefined) return;
  const elapsed = performance.now() - shownAt;
  const ms = hiddenDuringQuestion ? Math.max(elapsed, FAST_MS) : elapsed;
  const correct = chosen === question.route.name;
  state.answers.push({ question, chosen, correct, ms });
  recordAnswer(progress, question.route.number, correct, ms);
  saveProgress(progress);
  render();
}

function next(): void {
  if (state.screen !== "question" || state.answers.length <= state.index) return;
  if (state.index + 1 < state.questions.length) {
    startTimer();
    setState({ ...state, index: state.index + 1 });
  } else {
    setState({ screen: "results", length: state.length, answers: state.answers, before: state.before });
  }
}

function renderStart(): string {
  return `
    <section class="card">
      <h1>Name that route</h1>
      <p class="lede">You'll see a TTC route number. Pick its name from four options.</p>
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
      <p class="hint">Instant means right 3 times in a row, each in under ${FAST_MS / 1000} seconds. Weaker routes come up more often.</p>
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

function renderQuestion(s: Extract<State, { screen: "question" }>): string {
  const question = s.questions[s.index];
  const answer = s.answers[s.index];
  const total = s.questions.length;
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

  const level = levelOf(progress.routes[question.route.number]);
  const feedback = answer
    ? `<div class="feedback ${answer.correct ? "is-correct" : "is-wrong"}">
         <div>
           <p>${answer.correct ? "Correct!" : `Not quite. It's <strong>${escapeHtml(question.route.name)}</strong>.`}</p>
           <p class="feedback-meta">${answer.correct ? `<span class="time${answer.ms < FAST_MS ? " fast" : ""}">${formatSeconds(answer.ms)}</span>` : ""}${levelPill(level)}</p>
         </div>
         <button class="btn btn-primary" data-action="next" autofocus>
           ${s.index + 1 < total ? "Next" : "See results"}
         </button>
       </div>`
    : "";

  return `
    <section class="card">
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${s.index + 1}">
        <span>Question ${s.index + 1} / ${total}</span>
        <span>Score ${score(s.answers)}</span>
        <div class="bar"><div style="width:${((s.index + (answer ? 1 : 0)) / total) * 100}%"></div></div>
      </div>
      <div class="prompt">
        ${badge(question.route)}
        <p>What is the name of this ${question.route.mode} route?</p>
      </div>
      <div class="options">${options}</div>
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
                     <span class="muted">You picked ${escapeHtml(a.chosen)}</span></div></li>`,
                 )
                 .join("")}
             </ul>`
          : ""
      }
      <div class="lengths">
        <button class="btn btn-primary" data-action="start" data-length="${s.length}">Play again</button>
        <button class="btn" data-action="home">Change quiz</button>
      </div>
    </section>`;
}

/** Show the missed routes on a map, loading the map module if needed. */
function mountMissedMap(missed: Route[]): void {
  import("./map")
    .then(({ createMissedMap }) => {
      const slot = document.querySelector<HTMLElement>("#missed-map-slot");
      if (!slot || missedMap) return; // Left the results screen while loading.
      missedMap = createMissedMap(missed, scope === "area" ? area : null);
      slot.replaceChildren(missedMap.element);
      missedMap.refresh();
      // A route may have been picked from the list while the map was loading.
      if (focusedRoute) missedMap.focus(focusedRoute);
    })
    .catch(() => {
      document.querySelector("#missed-map-slot")?.remove();
    });
}

function focusRoute(number: string | null): void {
  focusedRoute = number;
  missedMap?.focus(number);
  for (const li of document.querySelectorAll<HTMLElement>(".review-missed [data-route]")) {
    li.classList.toggle("is-focus", li.dataset.route === number);
  }
}

function render(): void {
  missedMap?.destroy();
  missedMap = null;
  focusedRoute = null;
  app.innerHTML =
    state.screen === "start" ? renderStart() : state.screen === "question" ? renderQuestion(state) : renderResults(state);
  app.querySelector<HTMLElement>("[autofocus]")?.focus();
  if (state.screen === "start" && scope === "area") mountPicker();
  if (state.screen === "results") {
    const missed = state.answers.filter((a) => !a.correct).map((a) => a.question.route);
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
      return start(Number(el.dataset.length));
    case "choose":
      return choose(Number(el.dataset.index));
    case "next":
      return next();
    case "home":
      return setState({ screen: "start" });
    case "reset":
      if (!confirm("Reset your progress for every route? This can't be undone.")) return;
      progress = emptyProgress();
      saveProgress(progress);
      return updateStartActions();
    case "scope":
      scope = el.dataset.scope === "area" ? "area" : "city";
      saveScope();
      return render();
  }
});

document.addEventListener("keydown", (e) => {
  if (state.screen !== "question" || e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^[1-4]$/.test(e.key)) {
    choose(Number(e.key) - 1);
  } else if (e.key === "Enter" && state.answers.length > state.index) {
    e.preventDefault();
    next();
  }
});

render();
