// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import routesData from "./data/routes.json";
import type { Route } from "./types";

const routes = routesData as Route[];

async function mount() {
  vi.resetModules();
  document.body.innerHTML = '<main id="app"></main>';
  await import("./main");
  return document.querySelector<HTMLElement>("#app")!;
}

const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const key = (k: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k }));

describe("quiz UI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it.each([5, 10, 15])("plays a full %i-question round by mouse", async (n) => {
    const app = await mount();
    $(`[data-length="${n}"]`)!.click();
    for (let i = 0; i < n; i++) {
      expect(app.textContent).toContain(`Question ${i + 1} / ${n}`);
      expect($$(".option")).toHaveLength(4);
      $$(".option")[0].click();
      expect($$(".option.correct")).toHaveLength(1);
      $('[data-action="next"]')!.click();
    }
    expect($("h1")!.textContent).toMatch(new RegExp(`^\\d+ / ${n}$`));
  });

  it("scores correct answers and lists misses in the review", async () => {
    const app = await mount();
    $('[data-length="5"]')!.click();
    for (let i = 0; i < 5; i++) {
      const answer = routes.find((r) => r.number === $(".badge")!.textContent)!.name;
      const options = $$(".option");
      // Answer the first two correctly, the rest wrong.
      const pick = options.find((o) => (o.querySelector("span")!.textContent === answer) === i < 2)!;
      pick.click();
      $('[data-action="next"]')!.click();
    }
    expect($("h1")!.textContent).toBe("2 / 5");
    expect($$(".review li")).toHaveLength(3);
    expect(app.textContent).toContain("Play again");
  });

  it("lists missed routes for the results map and focuses them on tap", async () => {
    await mount();
    $('[data-length="5"]')!.click();
    for (let i = 0; i < 5; i++) {
      const answer = routes.find((r) => r.number === $(".badge")!.textContent)!.name;
      $$(".option").find((o) => o.querySelector("span")!.textContent !== answer)!.click();
      $('[data-action="next"]')!.click();
    }
    expect($("#missed-map-slot")).not.toBeNull();
    const items = $$(".review-missed [data-route]");
    expect(items).toHaveLength(5);
    items[1].click();
    expect(items[1].classList.contains("is-focus")).toBe(true);
    items[1].click();
    expect(items[1].classList.contains("is-focus")).toBe(false);
  });

  it("supports keyboard: 1-4 to answer, Enter to advance", async () => {
    const app = await mount();
    $('[data-length="5"]')!.click();
    key("3");
    expect($$(".option:disabled")).toHaveLength(4);
    key("2"); // ignored once answered
    expect($$(".option.wrong").length).toBeLessThanOrEqual(1);
    key("Enter");
    expect(app.textContent).toContain("Question 2 / 5");
  });

  it("Change length returns to the start screen", async () => {
    await mount();
    $('[data-length="5"]')!.click();
    for (let i = 0; i < 5; i++) {
      key("1");
      key("Enter");
    }
    $('[data-action="home"]')!.click();
    expect($$('[data-action="start"]')).toHaveLength(3);
  });

  it("Learn mode drills only Learning routes", async () => {
    const app = await mount();
    expect(($('[data-action="learn"]') as HTMLButtonElement).disabled).toBe(true);

    // Miss every question in a 5-question round: those 5 routes are now Learning.
    $('[data-length="5"]')!.click();
    const missed: string[] = [];
    for (let i = 0; i < 5; i++) {
      const number = $(".badge")!.textContent!;
      const answer = routes.find((r) => r.number === number)!.name;
      missed.push(number);
      $$(".option").find((o) => o.querySelector("span")!.textContent !== answer)!.click();
      $('[data-action="next"]')!.click();
    }
    $('[data-action="home"]')!.click();
    const learn = $('[data-action="learn"]') as HTMLButtonElement;
    expect(learn.disabled).toBe(false);
    expect(learn.textContent).toContain("5 Learning routes");

    // A Learn round asks exactly those routes. Answer them all right once.
    learn.click();
    expect(app.textContent).toContain("Learn mode");
    expect(app.textContent).toContain("Question 1 / 5");
    const asked: string[] = [];
    for (let i = 0; i < 5; i++) {
      const number = $(".badge")!.textContent!;
      asked.push(number);
      const answer = routes.find((r) => r.number === number)!.name;
      $$(".option").find((o) => o.querySelector("span")!.textContent === answer)!.click();
      $('[data-action="next"]')!.click();
    }
    expect(asked.sort()).toEqual(missed.sort());
    // One right answer isn't enough to leave Learning, so there's more to practise.
    expect(app.textContent).toContain("5 routes still in Learning");

    // A second correct round moves them all up to Known.
    $('[data-action="learn"]')!.click();
    for (let i = 0; i < 5; i++) {
      const answer = routes.find((r) => r.number === $(".badge")!.textContent)!.name;
      $$(".option").find((o) => o.querySelector("span")!.textContent === answer)!.click();
      $('[data-action="next"]')!.click();
    }
    expect(app.textContent).toContain("cleared everything in Learning");
    expect($('[data-action="learn"]')).toBeNull();
  });

  describe("name → number", () => {
    const typeAnswer = (value: string) => {
      const input = $(".typed-input") as HTMLInputElement;
      input.value = value;
      $('[data-form="typed"]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    };
    const currentRoute = () => {
      const name = $(".badge-name")!.textContent!;
      const kind = $(".prompt p")!.textContent!;
      // The name plus its mode picks out exactly one route (e.g. 7 Bathurst bus, 511 Bathurst streetcar).
      return routes.find((r) => r.name === name && kind.includes(r.mode))!;
    };

    it("swaps direction from the start screen and remembers it", async () => {
      await mount();
      expect($("h1")!.textContent).toBe("Name that route");
      $('[data-action="swap"]')!.click();
      expect($("h1")!.textContent).toBe("Number that route");
      expect($(".direction")!.textContent).toContain("You type");
      expect(JSON.parse(localStorage.getItem("ttc-quiz:quiz")!).quiz).toBe("name-to-number");
      await mount();
      expect($("h1")!.textContent).toBe("Number that route");
    });

    it("keeps the direction saved before there were shape quizzes", async () => {
      localStorage.setItem("ttc-quiz:direction", "name-to-number");
      await mount();
      expect($("h1")!.textContent).toBe("Number that route");
      expect(($(".quiz-radio") as HTMLInputElement).checked).toBe(true);
    });

    it("plays a typed round, scoring exact numbers only", async () => {
      const app = await mount();
      $('[data-action="swap"]')!.click();
      $('[data-length="5"]')!.click();
      expect($$(".option")).toHaveLength(0);
      for (let i = 0; i < 5; i++) {
        const route = currentRoute();
        typeAnswer(i < 2 ? route.number : "999");
        expect($(".typed-input")!.classList.contains(i < 2 ? "correct" : "wrong")).toBe(true);
        if (i >= 2) expect($(".feedback")!.textContent).toContain(`It's ${route.number}`);
        key("Enter");
      }
      expect($("h1")!.textContent).toBe("2 / 5");
      expect(app.textContent).toContain("You typed 999 (no such route)");
    });

    it("ignores an empty answer", async () => {
      await mount();
      $('[data-action="swap"]')!.click();
      $('[data-length="5"]')!.click();
      typeAnswer("   ");
      expect($(".feedback")).toBeNull();
    });

    it("keeps progress separate for each direction", async () => {
      await mount();
      $('[data-action="swap"]')!.click();
      $('[data-length="5"]')!.click();
      for (let i = 0; i < 5; i++) {
        typeAnswer("999");
        key("Enter");
      }
      $('[data-action="home"]')!.click();
      expect($(".mastery-legend")!.textContent).toMatch(/Learning\s*5/);
      $('[data-action="swap"]')!.click();
      expect($(".mastery")).toBeNull(); // number → name untouched
      expect(localStorage.getItem("ttc-quiz:progress")).toBeNull();
      expect(JSON.parse(localStorage.getItem("ttc-quiz:progress:name-to-number")!).round).toBe(1);
    });
  });

  it("saves progress and shows it on the start screen", async () => {
    await mount();
    expect($(".mastery")).toBeNull();
    $('[data-length="5"]')!.click();
    for (let i = 0; i < 5; i++) {
      key("1");
      expect($(".feedback .level")).not.toBeNull();
      key("Enter");
    }
    const saved = JSON.parse(localStorage.getItem("ttc-quiz:progress")!);
    expect(saved.round).toBe(1);
    expect(Object.keys(saved.routes)).toHaveLength(5);

    $('[data-action="home"]')!.click();
    expect($(".mastery-legend")!.textContent).toMatch(/New\s*22[0-9]/);

    vi.spyOn(window, "confirm").mockReturnValue(true);
    $('[data-action="reset"]')!.click();
    expect($(".mastery")).toBeNull();
    expect(JSON.parse(localStorage.getItem("ttc-quiz:progress")!).round).toBe(0);
  });
});
