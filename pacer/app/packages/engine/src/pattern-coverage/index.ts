/**
 * MOVEMENT PATTERN COVERAGE
 *
 * Answers one question over a rolling window: which of the nine movement
 * patterns has this person actually loaded, and which have quietly dropped
 * out of the week. "Trained four times" says nothing about that — four
 * sessions can miss the horizontal pull and the loaded carry entirely.
 *
 * Two horizons, deliberately separate:
 *
 *   `covered`  — was the pattern trained inside the window (default 7 days,
 *                14 for someone lifting twice a week). This drives the nine
 *                tiles: green or grey.
 *   `stale`    — has it been longer than `staleAfterDays` (default 10) since
 *                the pattern was last trained *at all*. This drives the
 *                warning badge, and it has to look past the window: with a
 *                7-day window a pattern last trained 9 days ago is neither
 *                covered nor yet a warning, and collapsing the two would
 *                either hide that or raise an alarm the moment the window
 *                rolls over.
 *
 * So callers pass at least `max(windowDays, staleAfterDays)` days of history.
 * Anything older only sharpens `daysSince` and costs a scan.
 *
 * A pattern never trained in the supplied history is reported as missing,
 * not as stale — on the first week of logging every pattern would otherwise
 * fire a warning, which trains people to ignore the badge.
 *
 * Ref: Cook G. Movement: Functional Movement Systems. On Target, 2010.
 */

import type { MovementPattern } from "./exercises";
import { findExercise, MOVEMENT_PATTERNS, PATTERN_LABELS } from "./exercises";

export * from "./exercises";

/**
 * Set slots offered per exercise per day. The router bounds its input with
 * this and the log form draws this many rows, so it lives in one place.
 */
export const MAX_SETS_PER_EXERCISE = 7;

/**
 * One logged set. Structural, so a database row with weight, reps and RPE on
 * it can be handed over as-is — coverage only reads the two fields it needs.
 */
export interface LoggedSetInput {
  /** When the set was performed. ISO string or Date. */
  performedAt: Date | string;
  /** Slug from EXERCISES. An unknown id is counted as unclassified. */
  exerciseId: string;
}

export interface PatternCoverage {
  pattern: MovementPattern;
  label: string;
  /** Trained at least once inside the window. */
  covered: boolean;
  /** Sets inside the window. */
  sets: number;
  /** Distinct days inside the window this pattern was trained on. */
  days: number;
  /** Last day trained across the whole supplied history, YYYY-MM-DD. */
  lastPerformed: string | null;
  /** Whole days between `lastPerformed` and the reference day. */
  daysSince: number | null;
  /** Trained before, but longer than `staleAfterDays` ago. */
  stale: boolean;
}

export interface CoverageResult {
  /** Reference day the window ends on, YYYY-MM-DD. */
  asOf: string;
  /** First day inside the window, YYYY-MM-DD, inclusive. */
  windowStart: string;
  windowDays: number;
  staleAfterDays: number;
  /** All nine patterns, always, in MOVEMENT_PATTERNS order. */
  patterns: PatternCoverage[];
  /** How many of the nine are covered. */
  coveredCount: number;
  /** Not trained inside the window. */
  missing: MovementPattern[];
  /** Trained before, but longer than `staleAfterDays` ago. */
  stalePatterns: MovementPattern[];
  /** Distinct days with at least one logged set inside the window. */
  trainingDays: number;
  /** Sets inside the window whose exercise id is not in EXERCISES. */
  unclassifiedSets: number;
}

export interface CoverageOptions {
  /** Rolling window length in days, inclusive of the reference day. */
  windowDays?: number;
  /** Days without a pattern before it counts as stale. */
  staleAfterDays?: number;
  /** Reference day. Defaults to now. */
  now?: Date | string;
}

/** YYYY-MM-DD of an instant, in UTC. */
function isoDay(value: Date | string): string | null {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * Which of the nine patterns were trained over the window, and which have
 * gone stale. Pure: pass `now` to pin the reference day.
 *
 * ponytail: days are bucketed in UTC, so a 22:00 local set in a UTC+3 zone
 * lands on the next day. Harmless against 7- and 14-day windows; pass the
 * user's zone offset through if per-day boundaries ever matter.
 */
export function computeCoverage(
  sets: LoggedSetInput[],
  options: CoverageOptions = {},
): CoverageResult {
  const windowDays = Math.max(1, Math.trunc(options.windowDays ?? 7));
  const staleAfterDays = Math.max(1, Math.trunc(options.staleAfterDays ?? 10));
  const asOf = isoDay(options.now ?? new Date()) ?? isoDay(new Date())!;
  const windowStart = addDays(asOf, -(windowDays - 1));

  const inWindowSets = new Map<MovementPattern, number>();
  const inWindowDays = new Map<MovementPattern, Set<string>>();
  const lastDay = new Map<MovementPattern, string>();
  const trainingDays = new Set<string>();
  let unclassifiedSets = 0;

  for (const set of sets) {
    const day = isoDay(set.performedAt);
    // Undated or future-dated rows say nothing about the window that ends
    // today, and a future date would read as a negative daysSince.
    if (!day || day > asOf) continue;

    const inWindow = day >= windowStart;
    if (inWindow) trainingDays.add(day);

    const pattern = findExercise(set.exerciseId)?.pattern;
    if (!pattern) {
      if (inWindow) unclassifiedSets += 1;
      continue;
    }

    const previous = lastDay.get(pattern);
    if (!previous || day > previous) lastDay.set(pattern, day);

    if (inWindow) {
      inWindowSets.set(pattern, (inWindowSets.get(pattern) ?? 0) + 1);
      let days = inWindowDays.get(pattern);
      if (!days) {
        days = new Set();
        inWindowDays.set(pattern, days);
      }
      days.add(day);
    }
  }

  const patterns = MOVEMENT_PATTERNS.map((pattern): PatternCoverage => {
    const setCount = inWindowSets.get(pattern) ?? 0;
    const last = lastDay.get(pattern) ?? null;
    const daysSince = last ? daysBetween(last, asOf) : null;
    return {
      pattern,
      label: PATTERN_LABELS[pattern],
      covered: setCount > 0,
      sets: setCount,
      days: inWindowDays.get(pattern)?.size ?? 0,
      lastPerformed: last,
      daysSince,
      stale: daysSince !== null && daysSince > staleAfterDays,
    };
  });

  return {
    asOf,
    windowStart,
    windowDays,
    staleAfterDays,
    patterns,
    coveredCount: patterns.filter((p) => p.covered).length,
    missing: patterns.filter((p) => !p.covered).map((p) => p.pattern),
    stalePatterns: patterns.filter((p) => p.stale).map((p) => p.pattern),
    trainingDays: trainingDays.size,
    unclassifiedSets,
  };
}
