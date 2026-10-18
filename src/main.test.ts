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
