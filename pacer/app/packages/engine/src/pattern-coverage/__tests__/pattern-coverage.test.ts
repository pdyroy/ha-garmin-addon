import { describe, expect, it } from "vitest";

import {
  computeCoverage,
  EXERCISES,
  exercisesForPattern,
  MOVEMENT_PATTERNS,
  patternForExercise,
  suggestWindowDays,
} from "../index";

const TODAY = "2026-09-21";

/** A set performed `daysAgo` before TODAY. */
function set(exerciseId: string, daysAgo: number) {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return { performedAt: d.toISOString(), exerciseId };
}

function coverage(sets: ReturnType<typeof set>[], windowDays = 7) {
  return computeCoverage(sets, { now: TODAY, windowDays });
}

function byPattern(result: ReturnType<typeof coverage>, pattern: string) {
  const found = result.patterns.find((p) => p.pattern === pattern);
  if (!found) throw new Error(`pattern ${pattern} missing from result`);
  return found;
}

describe("exercise reference data", () => {
  it("offers at least three variants for every pattern", () => {
    for (const pattern of MOVEMENT_PATTERNS) {
      expect(
        exercisesForPattern(pattern).length,
        `pattern ${pattern}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("has unique ids", () => {
    const ids = EXERCISES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("filters a pattern's exercises by available equipment", () => {
    const bodyweight = exercisesForPattern("squat", ["bodyweight"]);
    expect(bodyweight.map((e) => e.id)).toContain("air-squat");
    expect(bodyweight.map((e) => e.id)).not.toContain("back-squat");

    // An empty filter means "no constraint", not "nothing available".
    expect(exercisesForPattern("squat", [])).toEqual(
      exercisesForPattern("squat"),
    );
  });

  it("resolves a known id and reports an unknown one as null", () => {
    expect(patternForExercise("pull-up")).toBe("pull_vertical");
    expect(patternForExercise("nordic-hamstring-curl")).toBeNull();
  });
});

describe("computeCoverage", () => {
  it("always reports all nine patterns in a stable order", () => {
    const result = coverage([]);
    expect(result.patterns.map((p) => p.pattern)).toEqual([
      ...MOVEMENT_PATTERNS,
    ]);
    expect(result.coveredCount).toBe(0);
    expect(result.missing).toEqual([...MOVEMENT_PATTERNS]);
  });

  it("does not flag a never-trained pattern as stale", () => {
    // First week of logging: everything is missing, nothing is a warning.
    const result = coverage([set("back-squat", 1)]);
    expect(result.stalePatterns).toEqual([]);
    expect(byPattern(result, "carry").lastPerformed).toBeNull();
    expect(byPattern(result, "carry").daysSince).toBeNull();
  });

  it("covers a pattern trained inside the window", () => {
    const result = coverage([
      set("back-squat", 0),
      set("bench-press", 2),
      set("barbell-row", 2),
      set("farmers-carry", 6),
    ]);
    expect(result.coveredCount).toBe(4);
    expect(result.missing).toEqual([
      "hinge",
      "lunge",
      "push_vertical",
      "pull_vertical",
      "rotation",
    ]);
    expect(byPattern(result, "carry").covered).toBe(true);
    expect(result.trainingDays).toBe(3);
  });

  it("treats the window as inclusive of the reference day", () => {
    // windowDays = 7 spans today and the six days before it.
    expect(byPattern(coverage([set("back-squat", 6)]), "squat").covered).toBe(
      true,
    );
    expect(byPattern(coverage([set("back-squat", 7)]), "squat").covered).toBe(
      false,
    );
  });

  it("separates the coverage window from the staleness horizon", () => {
    // Nine days ago: outside a 7-day window, inside the 10-day warning.
    const gap = coverage([set("barbell-row", 9)]);
    expect(byPattern(gap, "pull_horizontal").covered).toBe(false);
    expect(byPattern(gap, "pull_horizontal").daysSince).toBe(9);
    expect(byPattern(gap, "pull_horizontal").stale).toBe(false);
    expect(gap.stalePatterns).toEqual([]);

    // Eleven days ago: past the horizon, so the badge fires.
    const stale = coverage([set("barbell-row", 11)]);
    expect(byPattern(stale, "pull_horizontal").stale).toBe(true);
    expect(stale.stalePatterns).toEqual(["pull_horizontal"]);
  });

  it("clears staleness from history older than the window", () => {
    // Covered last week, and the older set must not resurrect the warning.
    const result = coverage([
      set("farmers-carry", 30),
      set("farmers-carry", 3),
    ]);
    const carry = byPattern(result, "carry");
    expect(carry.covered).toBe(true);
    expect(carry.daysSince).toBe(3);
    expect(carry.stale).toBe(false);
  });

  it("counts sets and distinct days separately", () => {
    const result = coverage([
      set("back-squat", 1),
      set("back-squat", 1),
      set("goblet-squat", 1),
      set("leg-press", 4),
    ]);
    const squat = byPattern(result, "squat");
    expect(squat.sets).toBe(4);
    expect(squat.days).toBe(2);
  });

  it("counts an unknown exercise as unclassified without losing the day", () => {
    const result = coverage([set("nordic-hamstring-curl", 1)]);
    expect(result.unclassifiedSets).toBe(1);
    expect(result.coveredCount).toBe(0);
    expect(result.trainingDays).toBe(1);
  });

  it("ignores undated and future-dated sets", () => {
    const result = computeCoverage(
      [
        { performedAt: "not-a-date", exerciseId: "back-squat" },
        set("bench-press", -3),
        set("pull-up", 1),
      ],
      { now: TODAY },
    );
    expect(result.coveredCount).toBe(1);
    expect(byPattern(result, "pull_vertical").covered).toBe(true);
    expect(byPattern(result, "push_horizontal").covered).toBe(false);
  });

  it("covers a fortnight of work for someone lifting twice a week", () => {
    // Six of the nine patterns fall outside a 7-day window at this cadence;
    // all nine fit the fortnight.
    const fortnight = [
      set("back-squat", 12),
      set("bench-press", 12),
      set("barbell-row", 12),
      set("farmers-carry", 11),
      set("deadlift", 8),
      set("overhead-press", 8),
      set("pull-up", 5),
      set("walking-lunge", 5),
      set("pallof-press", 2),
    ];
    // Only the three most recent days fall inside a 7-day window.
    expect(coverage(fortnight, 7).coveredCount).toBe(3);
    expect(coverage(fortnight, 14).coveredCount).toBe(9);
    expect(coverage(fortnight, 14).missing).toEqual([]);
  });

  it("picks the window length from the session cadence", () => {
    expect(suggestWindowDays(2)).toBe(14);
    expect(suggestWindowDays(3)).toBe(7);
    expect(suggestWindowDays(4)).toBe(7);
  });
});
