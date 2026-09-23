import { describe, expect, it } from "vitest";

import { detectAggregateIntent, selectMostRecentRun } from "./data-context";

/**
 * The athlete reads and writes German (agent-prompts.ts pins the answer
 * language), so a German aggregate question has to widen the activity window
 * exactly like its English equivalent. It did not before: the matcher was
 * English-only, and every German "wie viele Läufe dieses Jahr" was answered
 * from 14 days of history.
 */
describe("detectAggregateIntent", () => {
  const aggregate = [
    // English
    "show me all my runs",
    "how far have I run this year",
    "give me a summary",
    "year to date breakdown please",
    // German
    "zeig mir alle meine Läufe",
    "wie viele Kilometer bin ich dieses Jahr gelaufen",
    "gib mir eine Zusammenfassung",
    "wie sieht meine Entwicklung aus",
    "Bericht über letztes Jahr",
    "seit Januar",
    "meine Jahresbilanz",
    "wie viele Einheiten insgesamt",
    "in den letzten sechs Monaten",
  ];

  const narrow = [
    "",
    "wie ist meine Readiness heute",
    "soll ich heute laufen",
    "analysiere meinen letzten Lauf",
    "how did I sleep last night",
  ];

  it.each(aggregate)("widens the window for %j", (message: string) => {
    const intent = detectAggregateIntent(message);
    expect(intent.isAggregate).toBe(true);
    expect(intent.windowDays).toBe(365);
    expect(intent.activityLimit).toBe(500);
  });

  it.each(narrow)("keeps the narrow window for %j", (message: string) => {
    const intent = detectAggregateIntent(message);
    expect(intent.isAggregate).toBe(false);
    expect(intent.windowDays).toBe(14);
    expect(intent.activityLimit).toBe(10);
  });
});

/**
 * The run-detail selector must hand the coach the MOST RECENT run. It used to
 * reverse the newest-first input and select the OLDEST 30-day session, so a
 * "letzter Lauf" question was answered from the wrong run.
 */
const run = (id: string, sportType: string | null) => ({ id, sportType });

describe("selectMostRecentRun", () => {
  it("prefers the newest run (first match in a newest-first list)", () => {
    // index 0 is the most recent activity
    const candidates = [
      run("most-recent-run", "running"),
      run("between-ride", "cycling"),
      run("older-window-run", "running"),
    ];
    expect(selectMostRecentRun(candidates, candidates)).toEqual(
      run("most-recent-run", "running"),
    );
  });

  it("falls back to the newest activity of any kind when no run is present", () => {
    const candidates = [run("swim", "swimming"), run("ride", "cycling")];
    expect(selectMostRecentRun(candidates, candidates)).toEqual(
      run("swim", "swimming"),
    );
  });

  it("falls back to the newest run in the window when the named day has no activity", () => {
    const all = [
      run("most-recent-run", "running"),
      run("ride", "cycling"),
      run("older-window-run", "running"),
    ];
    expect(selectMostRecentRun([], all)).toEqual(
      run("most-recent-run", "running"),
    );
  });

  it("stays on the named day before widening to the window", () => {
    const day = [run("stretch", "strength_training")];
    const all = [run("most-recent-run", "running")];
    expect(selectMostRecentRun(day, all)).toEqual(
      run("stretch", "strength_training"),
    );
  });
});
