import { describe, expect, it } from "vitest";

import { detectAggregateIntent } from "./data-context";

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
