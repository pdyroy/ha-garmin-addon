import type { DailyMetricInput, SleepCoachResult } from "../types";

/**
 * SLEEP COACH — Evidence-Based Sleep Recommendations
 *
 * Ref: Hirshkowitz M et al. National Sleep Foundation's sleep time duration
 *      recommendations. Sleep Health. 2015;1(1):40-43.
 *   → Adults 18-64: 7-9 hours, 65+: 7-8 hours
 *
 * Ref: Bird SP. Sleep, recovery, and athletic performance.
 *      Strength Cond J. 2013;35(5):43-47.
 *   → Athletes should target 8-10 hours for optimal recovery
 *
 * Ref: Mah CD et al. The effects of sleep extension on the athletic
 *      performance of collegiate basketball players. Sleep. 2011;34(7):943-950.
 *   → Extending sleep to 10h improved sprint times, free throw %, reaction time
 *
 * Ref: Simpson NS et al. Repeating patterns of sleep restriction and recovery:
 *      do we bounce back? Sleep. 2016;39(3):693-700.
 *   → Sleep debt accumulates and requires extended recovery sleep to repay
 */

/**
 * Calculate sleep need based on training load and individual factors.
 *
 * Base need: 7.5h for adults, 8.5h for athletes (Bird 2013)
 * Adjustments:
 * - +30 min for high training load (strain > 14)
 * - +15 min for moderate training load (strain 8-14)
 * - +30 min if sleep debt > 120 min over last 3 days
 * - Age 18-25: +15 min (growth/recovery needs)
 * - Age 65+: -30 min (Hirshkowitz 2015)
 */
export function calculateSleepNeed(
  age: number | null,
  isAthlete: boolean,
  recentStrain: number, // today's strain or average recent strain
  sleepDebtMinutes: number,
): number {
  // Base need (minutes)
  let need = isAthlete ? 510 : 450; // 8.5h or 7.5h

  // Training load adjustment
  if (recentStrain > 14) need += 30;
  else if (recentStrain > 8) need += 15;

  // Sleep debt payback
  if (sleepDebtMinutes > 120) need += 30;
  else if (sleepDebtMinutes > 60) need += 15;

  // Age adjustments (Hirshkowitz et al. 2015)
  if (age !== null) {
    if (age <= 25) need += 15;
    else if (age >= 65) need -= 30;
  }

  return Math.round(need);
}

/**
 * Calculate sleep debt as an exponentially-weighted rolling deficit.
 *
 * Older nightly deficits decay so the number stays in a physiologically
 * believable range. A raw 7-day sum produced ~17h of "debt" for a user
 * consistently 2h short — far beyond what the literature supports
 * (Van Dongen et al. 2003: only ~4-6h of accumulated deficit is
 * measurable; further restriction degrades performance but the
 * recoverable "debt" plateaus). We weight day i (0 = most recent) by
 * 0.5^i so the effective window is ≈3 nights and the same chronic
 * 2h/night shortfall surfaces as ~240 min rather than ~840 min.
 *
 * Ref: Van Dongen HPA et al. (2003), Simpson NS et al. (2016).
 */
export function calculateSleepDebt(
  recentMetrics: DailyMetricInput[], // last 7 days, most recent first
  sleepNeedMinutes: number,
): number {
  let debt = 0;
  recentMetrics.slice(0, 7).forEach((m, i) => {
    if (
      m.totalSleepMinutes !== null &&
      m.totalSleepMinutes < sleepNeedMinutes
    ) {
      const dailyDeficit = sleepNeedMinutes - m.totalSleepMinutes;
      debt += dailyDeficit * Math.pow(0.5, i);
    }
  });
  return Math.round(debt);
}

/**
 * Generate sleep coach recommendation.
 *
 * Combines sleep need calculation with bedtime optimization.
 *
 * Bedtime recommendation based on:
 * - Desired wake time (from user profile or recent pattern)
 * - Calculated sleep need
 * - Sleep onset latency (typically 10-20 min for healthy adults)
 *   Ref: Ohayon MM et al. Meta-analysis of quantitative sleep parameters.
 *        Sleep. 2004;27(7):1255-1273.
 */
export function generateSleepCoachResult(
  age: number | null,
  isAthlete: boolean,
  recentStrain: number,
  recentMetrics: DailyMetricInput[],
  wakeTimeHHMM: string | null, // "06:30" format
): SleepCoachResult {
  const sleepNeedMinutes = calculateSleepNeed(age, isAthlete, recentStrain, 0);
  const sleepDebt = calculateSleepDebt(recentMetrics, sleepNeedMinutes);

  // Recalculate with debt factored in
  const adjustedNeed = calculateSleepNeed(
    age,
    isAthlete,
    recentStrain,
    sleepDebt,
  );

  // Calculate bedtime from wake time
  let recommendedBedtime: string | null = null;
  const recommendedWakeTime: string | null = wakeTimeHHMM;

  if (wakeTimeHHMM) {
    const [wakeH, wakeM] = wakeTimeHHMM.split(":").map(Number);
    if (wakeH !== undefined && wakeM !== undefined) {
      const wakeMinutes = wakeH * 60 + wakeM;
      const sleepOnsetLatency = 15; // minutes (Ohayon et al. 2004)
      const bedtimeMinutes = wakeMinutes - adjustedNeed - sleepOnsetLatency;

      const normalizedBedtime = ((bedtimeMinutes % 1440) + 1440) % 1440;
      const bedH = Math.floor(normalizedBedtime / 60);
      const bedM = normalizedBedtime % 60;
      recommendedBedtime = `${String(bedH).padStart(2, "0")}:${String(bedM).padStart(2, "0")}`;
    }
  }

  // Generate insight
  const hoursNeed = (adjustedNeed / 60).toFixed(1);
  let insight: string;

  if (sleepDebt > 120) {
    insight = `You have ${Math.round(sleepDebt / 60)}h of sleep debt. Target ${hoursNeed}h tonight to recover. Sleep debt impairs reaction time, mood, and recovery (Simpson et al. 2016).`;
  } else if (sleepDebt > 60) {
    insight = `Minor sleep debt of ${Math.round(sleepDebt / 60)}h. Aim for ${hoursNeed}h tonight. Getting to bed 30 min earlier can make a significant difference.`;
  } else if (recentStrain > 14) {
    insight = `High training load today — aim for ${hoursNeed}h sleep for optimal recovery. Athletes benefit from 8-10h after hard training (Bird 2013).`;
  } else {
    insight = `Sleep is on track. Target ${hoursNeed}h for optimal recovery and performance.`;
  }

  return {
    recommendedMinutes: adjustedNeed,
    recommendedBedtime,
    recommendedWakeTime,
    sleepDebtMinutes: sleepDebt,
    insight,
  };
}

// ---------------------------------------------------------------------------
// Sleep window — target bedtime and wake window
// ---------------------------------------------------------------------------

/** "HH:MM" → minutes since local midnight, or null when unparseable. */
function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  if (h === undefined || m === undefined) return null;
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** Minutes since local midnight → "HH:MM", wrapping across midnight. */
function formatHHMM(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Circular median of clock times, anchored at 18:00 so a cluster spanning
 * midnight (23:50, 00:10) averages to midnight instead of noon. Same anchor
 * the sleep-regularity module uses for sleep midpoints.
 */
function circularMedian(minutes: number[]): number {
  const ANCHOR = 18 * 60;
  const shifted = minutes
    .map((m) => (((m - ANCHOR) % 1440) + 1440) % 1440)
    .sort((a, b) => a - b);
  const mid = Math.floor(shifted.length / 2);
  const median =
    shifted.length % 2 === 1
      ? shifted[mid]!
      : (shifted[mid - 1]! + shifted[mid]!) / 2;
  return (median + ANCHOR) % 1440;
}

/** Sleep onset latency for healthy adults (Ohayon et al. 2004). */
const SLEEP_ONSET_LATENCY_MINUTES = 15;
/** Most sleep debt is repaid over several nights, not in one. */
const MAX_NIGHTLY_DEBT_PAYBACK_MINUTES = 30;
/** Half-width of the wake window. */
const WAKE_WINDOW_HALF_MINUTES = 20;
/** Minimum nights with a usable wake time before a habit median is trusted. */
const MIN_NIGHTS_FOR_HABIT = 4;

export interface SleepWindowInput {
  /** Recent nights, most recent first. Only `sleepEndTime` is read. */
  recentMetrics: DailyMetricInput[];
  /** Tonight's sleep need in minutes — Garmin's, or `calculateSleepNeed`. */
  sleepNeedMinutes: number;
  /** Accumulated debt from `calculateSleepDebt`. */
  sleepDebtMinutes: number;
  /**
   * Sleep-debt-corrected mid-sleep on free days, minutes since local
   * midnight, from `computeChronotype`. When present it anchors the target
   * wake time to the body clock rather than to the alarm clock.
   */
  msfScMinutes?: number | null;
}

export interface SleepWindowOutput {
  /** "HH:MM" — lights out, already including sleep onset latency. */
  targetBedtime: string;
  /** "HH:MM" — the middle of the wake window. */
  targetWakeTime: string;
  wakeWindowStart: string;
  wakeWindowEnd: string;
  /** What the wake time was derived from. */
  anchor: "chronotype" | "habit";
  /** Minutes of debt repaid tonight, capped. */
  debtPaybackMinutes: number;
  /** Nights that contributed to the habitual wake time. */
  nightsUsed: number;
}

export type SleepWindowResult =
  | { value: SleepWindowOutput; reason?: undefined }
  | { value: null; reason: string };

/**
 * Target bedtime and wake window.
 *
 * bedtime = wake − sleep need − capped debt payback − onset latency
 *
 * The wake time is the athlete's own MSFsc (mid-sleep on free days, corrected
 * for workday sleep debt) plus half the sleep need, which puts the night
 * symmetrically around the body clock — or, without a chronotype, the
 * circular median of recent actual wake times. Both are descriptive: this
 * recommends when to *start* the night, it does not move the alarm.
 *
 * The window is a flat ±20 min around the target. It is NOT sleep-cycle
 * timing: Garmin exposes no live staging, so nothing here can claim to wake
 * the athlete out of light sleep, and no wearable-alarm study supports doing
 * so on retrospective data.
 *
 * Refs: Ohayon MM et al. Sleep. 2004;27(7):1255-1273 (onset latency);
 *       Roenneberg T et al. Curr Biol. 2012;22(10):939-943 (MSFsc);
 *       Van Dongen HPA et al. Sleep. 2003;26(2):117-126 (debt repayment).
 */
export function computeSleepWindow({
  recentMetrics,
  sleepNeedMinutes,
  sleepDebtMinutes,
  msfScMinutes,
}: SleepWindowInput): SleepWindowResult {
  if (!Number.isFinite(sleepNeedMinutes) || sleepNeedMinutes <= 0) {
    return { value: null, reason: "No sleep need available." };
  }

  const wakeTimes = recentMetrics
    .slice(0, 14)
    .map((m) => parseHHMM(m.sleepEndTime))
    .filter((m): m is number => m !== null);

  let targetWake: number;
  let anchor: "chronotype" | "habit";

  if (msfScMinutes != null && Number.isFinite(msfScMinutes)) {
    targetWake = (msfScMinutes + sleepNeedMinutes / 2) % 1440;
    anchor = "chronotype";
  } else if (wakeTimes.length >= MIN_NIGHTS_FOR_HABIT) {
    targetWake = circularMedian(wakeTimes);
    anchor = "habit";
  } else {
    return {
      value: null,
      reason: `Only ${wakeTimes.length} night(s) with a wake time and no chronotype (need >= ${MIN_NIGHTS_FOR_HABIT} nights).`,
    };
  }

  const debtPayback = Math.min(
    Math.max(sleepDebtMinutes, 0),
    MAX_NIGHTLY_DEBT_PAYBACK_MINUTES,
  );
  const bedtime =
    targetWake - sleepNeedMinutes - debtPayback - SLEEP_ONSET_LATENCY_MINUTES;

  return {
    value: {
      targetBedtime: formatHHMM(bedtime),
      targetWakeTime: formatHHMM(targetWake),
      wakeWindowStart: formatHHMM(targetWake - WAKE_WINDOW_HALF_MINUTES),
      wakeWindowEnd: formatHHMM(targetWake + WAKE_WINDOW_HALF_MINUTES),
      anchor,
      debtPaybackMinutes: Math.round(debtPayback),
      nightsUsed: wakeTimes.length,
    },
  };
}
