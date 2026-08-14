import type { DailyMetricInput } from "../types";

/**
 * SLEEP REGULARITY & CHRONOTYPE
 *
 * The Sleep Regularity Index (SRI) and the mid-sleep-on-free-days chronotype
 * proxies (MSF/MSFsc/social jetlag).
 *
 * Ref: Phillips AJK, Clerx WM, O'Brien CS, et al. Irregular sleep/wake
 *      patterns are associated with poorer academic performance and delayed
 *      circadian and sleep/wake timing. Sci Rep. 2017;7:3216.
 *   → Defines the SRI: the probability of being in the same state
 *     (asleep/awake) at any two time points 24h apart, scaled to -100..100.
 *
 * Ref: Windred DP, Burns AC, Lane JM, et al. Sleep regularity is a stronger
 *      predictor of mortality risk than sleep duration: A prospective cohort
 *      study. Sleep. 2024;47(1):zsad253.
 *   → n=60,977 UK Biobank. Higher SRI quintiles associated with 20-48% lower
 *     all-cause mortality; SRI outpredicted sleep duration. The best-evidenced
 *     single measure in this engine.
 *
 * Ref: Wittmann M, Dinich J, Merrow M, Roenneberg T. Social jetlag:
 *      misalignment of biological and social time. Chronobiol Int.
 *      2006;23(1-2):497-509.
 *   → Defines social jetlag as |MSF - MSW|.
 *
 * Ref: Roenneberg T, Allebrandt KV, Merrow M, Vetter C. Social jetlag and
 *      obesity. Curr Biol. 2012;22(10):939-943.
 *   → MSFsc: sleep-debt-corrected chronotype proxy.
 *
 * DATA CONTRACT:
 * `sleepStartTime` / `sleepEndTime` are stored as local "HH:MM" clock-time
 * strings (see packages/db/src/schema.ts), NOT full timestamps — there is no
 * date or timezone attached to them individually. `date` is the wake date:
 * a bedtime of "23:15" on the record for 2026-08-13 means the evening of
 * 2026-08-12; a bedtime of "00:40" means after-midnight on 2026-08-13
 * itself. Each record is therefore a single self-contained night, rendered
 * onto its own 24h clock — this module never needs to reach into a
 * neighboring record to reconstruct a night.
 *
 * NULL-SAFETY: every exported "compute" function returns a `MetricResult`:
 * either `{ value, reason: undefined }` or `{ value: null, reason }`.
 * Rule: never interpolate a missing night, never emit a value under quorum.
 */

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export type MetricResult<T> =
  | { value: T; reason?: undefined }
  | { value: null; reason: string };

// ---------------------------------------------------------------------------
// Clock-time helpers (all internal; minutes are 0..1439 unless noted)
// ---------------------------------------------------------------------------

const MINUTES_PER_DAY = 1440;

/**
 * The circular-statistics cut point. Sleep midpoints and bedtimes cluster
 * around local midnight, so a naive mean/SD on raw "minutes since 00:00"
 * clock values averages e.g. 23:30 and 00:30 as ~12:00 instead of ~00:00 —
 * "the classic bug in this metric." Shifting the origin to 18:00 (a time
 * essentially nobody is asleep or going to bed) before averaging fixes this:
 * all real sleep-timing values land in one contiguous stretch away from the
 * 0/1440 seam, so ordinary linear mean/SD becomes correct. This is the
 * standard "cut-point" method used in the MCTQ/chronotype literature
 * (Roenneberg et al.), just anchored at 18:00 per spec instead of noon.
 * Breaks down only for schedules with a bedtime or midpoint near 18:00
 * itself (e.g. some shift workers) — out of scope for a recreational
 * athlete's data.
 */
const ANCHOR_MINUTES = 18 * 60;

function parseHHMM(time: string | null): number | null {
  if (time === null) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

/** Forward wraparound duration from start to end, both in 0..1439. */
function wrapDurationMinutes(startClock: number, endClock: number): number {
  return ((endClock - startClock) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** Shift a clock-minute value to the anchored frame, canonical 0..1439. */
function toAnchored(clockMinutes: number): number {
  return ((clockMinutes - ANCHOR_MINUTES) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** Shift an anchored-frame value back to a normal 0..1439 clock minute. */
function fromAnchored(anchoredMinutes: number): number {
  return (Math.round(anchoredMinutes) + ANCHOR_MINUTES) % MINUTES_PER_DAY;
}

/**
 * Midpoint of one night's sleep interval, in the anchored frame (canonical
 * 0..1439). Uses the true wraparound duration so it is correct even if the
 * bedtime itself happens to fall close to the anchor.
 */
function nightMidpointAnchored(startClock: number, endClock: number): number {
  const duration = wrapDurationMinutes(startClock, endClock);
  return (toAnchored(startClock) + duration / 2) % MINUTES_PER_DAY;
}

/** Sample mean and SD (n-1) of a set of anchored-frame values. */
function meanAndSD(anchoredValues: number[]): { mean: number; sd: number } {
  const n = anchoredValues.length;
  const mean = anchoredValues.reduce((s, v) => s + v, 0) / n;
  if (n < 2) return { mean, sd: 0 };
  const variance =
    anchoredValues.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return { mean, sd: Math.sqrt(variance) };
}

/** Whole-day index (days since epoch) for a "YYYY-MM-DD" date string. */
function dayIndex(date: string): number | null {
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t) ? Math.round(t / 86_400_000) : null;
}

/** 1440-length asleep/awake mask for one night, wrapping start→end forward. */
function buildAsleepMask(startClock: number, endClock: number): boolean[] {
  const mask = new Array<boolean>(MINUTES_PER_DAY).fill(false);
  const duration = wrapDurationMinutes(startClock, endClock);
  for (let i = 0; i < duration; i++) {
    mask[(startClock + i) % MINUTES_PER_DAY] = true;
  }
  return mask;
}

// ---------------------------------------------------------------------------
// Sleep Regularity Index
// ---------------------------------------------------------------------------

export interface SleepRegularityIndexOutput {
  /** -100 (perfectly irregular) .. 100 (perfectly regular). */
  sri: number;
  /** Number of consecutive-calendar-day night pairs actually used. */
  validPairs: number;
  /** Number of distinct nights that contributed to at least one pair. */
  nightsUsed: number;
}
export type SleepRegularityIndexResult = MetricResult<SleepRegularityIndexOutput>;

/**
 * Compute the Sleep Regularity Index (Phillips et al. 2017).
 *
 * SRI = -100 + (200 / (M × validPairs)) × Σ delta(state[day][t], state[day+1][t])
 * where M = 1440 minutes and delta = 1 when the two days share the same
 * asleep/awake state at minute t, 0 otherwise.
 *
 * A missing night (absent record, or unparsable/absent start or end time)
 * breaks every pair it would otherwise be part of — it is never treated as
 * wakefulness, which would fabricate irregularity that isn't in the data.
 * `validPairs` only counts pairs between two calendar-adjacent nights that
 * both have usable data, so gaps simply shrink the denominator rather than
 * being filled in.
 *
 * `records` may be given in any order and may contain gaps; only `date`,
 * `sleepStartTime`, `sleepEndTime` are read.
 *
 * @param minValidPairs Quorum. Default 14 (~2 weeks) — the SRI is a period
 *   average and is noisy over a handful of nights; there is no published
 *   minimum, so this mirrors the ~15-sample baseline quorum used elsewhere
 *   in this engine.
 */
export function computeSleepRegularityIndex(
  records: DailyMetricInput[],
  options: { minValidPairs?: number } = {},
): SleepRegularityIndexResult {
  const minValidPairs = options.minValidPairs ?? 14;

  const nightsByDay = new Map<number, boolean[]>();
  for (const r of records) {
    const start = parseHHMM(r.sleepStartTime);
    const end = parseHHMM(r.sleepEndTime);
    const idx = dayIndex(r.date);
    if (start === null || end === null || idx === null || start === end) {
      continue; // missing/unparsable/degenerate night — skip, don't fabricate
    }
    nightsByDay.set(idx, buildAsleepMask(start, end));
  }

  const sortedDays = [...nightsByDay.keys()].sort((a, b) => a - b);

  let matchSum = 0;
  let validPairs = 0;
  const nightsUsed = new Set<number>();

  for (const day of sortedDays) {
    const nextDay = day + 1;
    if (!nightsByDay.has(nextDay)) continue; // gap — breaks the pair
    const today = nightsByDay.get(day)!;
    const tomorrow = nightsByDay.get(nextDay)!;
    for (let m = 0; m < MINUTES_PER_DAY; m++) {
      if (today[m] === tomorrow[m]) matchSum++;
    }
    validPairs++;
    nightsUsed.add(day);
    nightsUsed.add(nextDay);
  }

  if (validPairs < minValidPairs) {
    return {
      value: null,
      reason: `Only ${validPairs} valid consecutive-night pair(s) of usable sleep data (need >= ${minValidPairs}).`,
    };
  }

  const sri =
    -100 + (200 / (MINUTES_PER_DAY * validPairs)) * matchSum;

  return {
    value: {
      sri: Math.round(sri * 100) / 100,
      validPairs,
      nightsUsed: nightsUsed.size,
    },
  };
}

// ---------------------------------------------------------------------------
// Robust dispersion measures (survive gaps that wreck the SRI)
// ---------------------------------------------------------------------------

export interface SleepTimingVariabilityOutput {
  /** Standard deviation, in minutes. */
  sdMinutes: number;
  /** Mean clock time, minutes since local midnight (0..1439). */
  meanClockMinutes: number;
  nightsUsed: number;
}
export type SleepTimingVariabilityResult =
  MetricResult<SleepTimingVariabilityOutput>;

/**
 * Rolling standard deviation of bedtime.
 *
 * `records` should be the caller's chosen trailing window (e.g. the last 7
 * or 14 days) — this function has no notion of "today" or of a rolling
 * cadence itself (the engine takes only the data it's given); call it once
 * per day-of-interest with that day's trailing slice to build a series for
 * a trend chart.
 *
 * Computed in the 18:00-anchored frame (see `ANCHOR_MINUTES`) so bedtimes
 * either side of midnight average correctly.
 *
 * @param minNights Quorum. Default 5 (matches the "5 of 7 days" example
 *   quorum used elsewhere in this engine).
 */
export function computeBedtimeVariability(
  records: DailyMetricInput[],
  options: { minNights?: number } = {},
): SleepTimingVariabilityResult {
  const minNights = options.minNights ?? 5;

  const anchored: number[] = [];
  for (const r of records) {
    const start = parseHHMM(r.sleepStartTime);
    if (start === null) continue;
    anchored.push(toAnchored(start));
  }

  if (anchored.length < minNights) {
    return {
      value: null,
      reason: `Only ${anchored.length} night(s) with a usable bedtime (need >= ${minNights}).`,
    };
  }

  const { mean, sd } = meanAndSD(anchored);
  return {
    value: {
      sdMinutes: Math.round(sd * 100) / 100,
      meanClockMinutes: fromAnchored(mean),
      nightsUsed: anchored.length,
    },
  };
}

/**
 * Rolling standard deviation of the sleep midpoint (bed time + wake time,
 * halved), computed circularly with the 18:00 anchor.
 *
 * Same windowing contract as {@link computeBedtimeVariability}: pass a
 * trailing window, call once per day for a series.
 *
 * @param minNights Quorum. Default 5.
 */
export function computeSleepMidpointVariability(
  records: DailyMetricInput[],
  options: { minNights?: number } = {},
): SleepTimingVariabilityResult {
  const minNights = options.minNights ?? 5;

  const anchored: number[] = [];
  for (const r of records) {
    const start = parseHHMM(r.sleepStartTime);
    const end = parseHHMM(r.sleepEndTime);
    if (start === null || end === null || start === end) continue;
    anchored.push(nightMidpointAnchored(start, end));
  }

  if (anchored.length < minNights) {
    return {
      value: null,
      reason: `Only ${anchored.length} night(s) with a usable bedtime and wake time (need >= ${minNights}).`,
    };
  }

  const { mean, sd } = meanAndSD(anchored);
  return {
    value: {
      sdMinutes: Math.round(sd * 100) / 100,
      meanClockMinutes: fromAnchored(mean),
      nightsUsed: anchored.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Chronotype: MSF, MSFsc, social jetlag
// ---------------------------------------------------------------------------

/**
 * Weak default free-day predicate: Saturday and Sunday.
 *
 * This is a population assumption, exactly the kind of thing rule 5 (own
 * history over population norms) warns against — it is only a fallback for
 * when the caller has no actual work-schedule data. A Saturday race, a
 * shift-worker's rest day on a Tuesday, etc. all invert or shift which days
 * are "free" and this default gets them wrong. Always pass a real predicate
 * when the caller knows the athlete's schedule.
 */
export function defaultIsFreeDay(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return day === 0 || day === 6;
}

export interface ChronotypeOutput {
  /** Mid-sleep on free days, minutes since local midnight. */
  msfMinutes: number;
  /** Sleep-debt-corrected MSF, minutes since local midnight. */
  msfScMinutes: number;
  /** |MSF - MSW| as true circular distance, in minutes. */
  socialJetlagMinutes: number;
  freeDaysUsed: number;
  workDaysUsed: number;
}
export type ChronotypeResult = MetricResult<ChronotypeOutput>;

/**
 * Chronotype from free-day / workday sleep midpoints (Wittmann et al. 2006;
 * Roenneberg et al. 2012).
 *
 * - MSF: mean sleep midpoint on free days (circular, 18:00-anchored).
 * - MSFsc: MSF corrected for sleep debt accumulated on workdays —
 *   `MSFsc = MSF - 0.5 × (SDfree - SDweek)` when SDfree > SDweek (free-day
 *   sleep is running longer than the week average, i.e. "catching up"),
 *   else `MSFsc = MSF`. SDweek is the workday/free-day-count-weighted mean
 *   sleep duration across the week.
 * - Social jetlag: circular distance between MSF and MSW (mean workday
 *   midpoint) — the misalignment between biological and social time.
 *
 * @param isFreeDay Caller-supplied predicate over `date`. Defaults to
 *   {@link defaultIsFreeDay} (Saturday/Sunday) — a weak assumption, see its
 *   doc comment. Pass the athlete's real schedule when it's known.
 * @param minFreeDays / minWorkDays Quorum, default 3 each — MSF/MSW are
 *   means, but a mean of 1-2 nights is exactly the kind of too-little-data
 *   number rule 2 bans.
 */
export function computeChronotype(
  records: DailyMetricInput[],
  isFreeDay: (date: string) => boolean = defaultIsFreeDay,
  options: { minFreeDays?: number; minWorkDays?: number } = {},
): ChronotypeResult {
  const minFreeDays = options.minFreeDays ?? 3;
  const minWorkDays = options.minWorkDays ?? 3;

  const freeMidpoints: number[] = [];
  const workMidpoints: number[] = [];
  let freeDurationSum = 0;
  let workDurationSum = 0;

  for (const r of records) {
    const start = parseHHMM(r.sleepStartTime);
    const end = parseHHMM(r.sleepEndTime);
    if (start === null || end === null || start === end) continue;

    const midpoint = nightMidpointAnchored(start, end);
    const duration = wrapDurationMinutes(start, end);

    if (isFreeDay(r.date)) {
      freeMidpoints.push(midpoint);
      freeDurationSum += duration;
    } else {
      workMidpoints.push(midpoint);
      workDurationSum += duration;
    }
  }

  if (freeMidpoints.length < minFreeDays || workMidpoints.length < minWorkDays) {
    return {
      value: null,
      reason: `Only ${freeMidpoints.length} free-day night(s) and ${workMidpoints.length} workday night(s) with usable sleep data (need >= ${minFreeDays} free and >= ${minWorkDays} work).`,
    };
  }

  const msfAnchored = meanAndSD(freeMidpoints).mean;
  const mswAnchored = meanAndSD(workMidpoints).mean;

  const nFree = freeMidpoints.length;
  const nWork = workMidpoints.length;
  const sdFree = freeDurationSum / nFree;
  const sdWork = workDurationSum / nWork;
  const sdWeek = (nFree * sdFree + nWork * sdWork) / (nFree + nWork);

  // Roenneberg et al. 2004/2012: only correct when free-day sleep is
  // running longer than the week average (catching up on debt); otherwise
  // MSF already reflects the true chronotype.
  const msfScAnchored =
    sdFree > sdWeek ? msfAnchored - 0.5 * (sdFree - sdWeek) : msfAnchored;

  const rawDiff = Math.abs(msfAnchored - mswAnchored);
  const socialJetlagMinutes = Math.min(rawDiff, MINUTES_PER_DAY - rawDiff);

  return {
    value: {
      msfMinutes: fromAnchored(msfAnchored),
      msfScMinutes: fromAnchored(msfScAnchored),
      socialJetlagMinutes: Math.round(socialJetlagMinutes * 100) / 100,
      freeDaysUsed: nFree,
      workDaysUsed: nWork,
    },
  };
}
