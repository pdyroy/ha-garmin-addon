import type { DailyMetricInput } from "../types";

/**
 * NIGHT SIGNAL — Resting Heart Rate State Machine for Early Illness Detection
 *
 * Implements the "NightSignal" method from:
 *
 * Ref: Alavi A, Bogu GK, Wang M, et al. Real-time alerting system for
 *      COVID-19 and other stress events using wearable data.
 *      Nat Med. 2022;28:175-184.
 *   → n=3,318; sensitivity 80%, specificity 87.7%, alerts a median of
 *     3 days before symptom onset. Outperformed a tuned CuSum change-point
 *     detector (62.5% sensitivity) — Mishra T, Wood M, Chiu C-J, et al.
 *     Pre-symptomatic detection of COVID-19 from smartwatch data.
 *     Nat Biomed Eng. 2020;4:1208-1220. — with a far simpler mechanism,
 *     which is why NightSignal (not CuSum) is the one implemented here.
 *
 * METHOD (as published):
 *   For each night i, the paper maintains M_i = the streaming median of
 *   overnight RHR across nights 1..i, INCLUDING night i's own value. We
 *   instead compute M_i from nights 1..i-1 only (strictly prior nights),
 *   so a night's own reading never contaminates the baseline it is judged
 *   against. Because the median is already robust to a single outlier this
 *   changes essentially no classifications once the baseline has enough
 *   history — but it is the cleaner definition, and it matches "a running
 *   median over all prior nights" literally rather than self-referentially.
 *
 * THRESHOLDS — derived from the athlete's own dispersion, not fixed bpm
 * (population thresholds are banned in this codebase):
 *   Alavi et al. found that across their cohort "the median of fluctuation
 *   of medians of average RHR overnight over three months was only three
 *   bpm" — i.e. 3 bpm is not an arbitrary constant, it is what a STABLE
 *   individual baseline itself typically drifts by, night to night. A
 *   single night ≥3 bpm above baseline is therefore already an atypical
 *   move for that number to make in one step, for THIS person. The paper's
 *   six-state finite state machine collapses, for our purposes, to two
 *   thresholds plus a persistence rule:
 *     yellow: one night with deviation ≥ 3 bpm above baseline.
 *     red:    two CONSECUTIVE nights with deviation ≥ 4 bpm above baseline.
 *   "Consecutive" is checked against calendar dates, not array position —
 *   a missing night (watch off, no sync, no data) breaks the streak rather
 *   than being bridged. This persistence requirement is not decorative:
 *   Quer et al. (DETECT, n>30,000; Nat Med. 2021;27:73-77) found resting
 *   heart rate ALONE gives AUC 0.52 — a coin flip. It is the two-night
 *   persistence, not any single deviation, that carries the signal. A lone
 *   yellow night must never read as an alarm.
 *
 * BASELINE WARM-UP:
 *   Alavi et al.: "for most subjects (over 80%), median of average RHR
 *   overnight is a stable and reliable baseline, since only after seven
 *   nights, it hits a baseline close to the baseline over three months."
 *   We require 7 confirmed prior nights before classifying a night at all —
 *   below that, state is null with a stated reason, never a guess.
 *
 * HONESTY CONSTRAINT — Mitratza M, Gomez-Herrero G, van Zaane B, et al.
 * The performance of wearable sensors in the detection of SARS-CoV-2
 * infection: a systematic review. Lancet Digit Health. 2022;4(5):e370-e379.
 *   → Across this literature, high sensitivity and high specificity were
 *     never achieved simultaneously, and several models flagged infection
 *     3-7 days AFTER symptom onset rather than before. The labels this
 *     module emits describe a deviation from the athlete's OWN baseline —
 *     never a diagnosis, and never "you are getting sick."
 *
 * CONFOUNDER: alcohol is the single largest driver of elevated resting
 * heart rate in a recreational population — it will trip yellow/red states
 * far more often than illness will. Any surface showing this signal should
 * say so rather than implying illness.
 *
 * DATA CONTRACT: a night only counts toward the baseline/state machine
 * when BOTH a resting HR value AND at least one sleep timestamp
 * (sleepStartTime or sleepEndTime) are present — the sleep fields are used
 * ONLY to confirm the watch was actually worn overnight, per the task's
 * data contract (restingHr is fully populated but does not by itself prove
 * the watch was on). Nights that fail this check are never interpolated or
 * silently dropped — they appear in the output with state: null and a
 * stated reason (a missing night is informative, not noise to smooth over).
 *
 * NOT sourced here: hrvOvernight (the schema column exists but the sync
 * never populates it — always null) and any lab/clinical marker. This is a
 * wearable overnight RHR signal only, exactly as published.
 */

export type NightSignalState = "green" | "yellow" | "red";

export interface NightSignalResult {
  date: string;
  /** null when the night is unconfirmed or the baseline hasn't warmed up yet. */
  state: NightSignalState | null;
  /** Tonight's RHR minus the baseline, in bpm. null when state is null. */
  deviationBpm: number | null;
  /** Running median RHR baseline (bpm), computed from strictly prior confirmed
   *  nights. null when state is null. Plot this as the slow trend line —
   *  it is the self-referential-baseline-drift check (rule 4). */
  baselineBpm: number | null;
  /** Count of confirmed prior nights the baseline rests on (0 before any). */
  nightsInBaseline: number;
  /** Human-readable explanation. Always populated when state is null, red,
   *  or yellow; null for an unremarkable green night. */
  reason: string | null;
}

const YELLOW_THRESHOLD_BPM = 3;
const RED_THRESHOLD_BPM = 4;
const RED_CONSECUTIVE_NIGHTS = 2;
const MIN_PRIOR_NIGHTS_FOR_BASELINE = 7;

function isNightConfirmed(night: DailyMetricInput): boolean {
  return (
    night.restingHr !== null &&
    (night.sleepStartTime !== null || night.sleepEndTime !== null)
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/** Whole calendar days between two "YYYY-MM-DD" dates (later - earlier). */
function daysBetween(laterDate: string, earlierDate: string): number | null {
  const laterTime = Date.parse(`${laterDate}T00:00:00Z`);
  const earlierTime = Date.parse(`${earlierDate}T00:00:00Z`);
  if (!Number.isFinite(laterTime) || !Number.isFinite(earlierTime)) return null;
  return Math.round((laterTime - earlierTime) / 86_400_000);
}

/**
 * Compute the NightSignal state for every night in a chronological series.
 *
 * Ref: Alavi et al. Nat Med. 2022;28:175-184. See module JSDoc for the full
 * method, threshold derivation, and the deliberate deviations from the
 * paper's exact formula.
 *
 * @param nights Daily metrics, OLDEST FIRST (chronological). Strength/yoga
 *   days are fine to include — RHR is a whole-body autonomic marker, not a
 *   per-sport one, so unlike endurance-load metrics NightSignal does not
 *   need sport-pooling exclusion (rule 3 governs load/HRV response to
 *   training, not resting physiology).
 * @returns One result per input night, in the same order. A missing or
 *   unconfirmed night never breaks the array — it appears with state: null.
 */
export function computeNightSignalSeries(
  nights: DailyMetricInput[],
): NightSignalResult[] {
  const results: NightSignalResult[] = [];
  const priorRhr: number[] = []; // confirmed nights strictly before the current one
  let consecutiveElevated = 0;
  let previousConfirmedDate: string | null = null;

  for (const night of nights) {
    if (!isNightConfirmed(night)) {
      results.push({
        date: night.date,
        state: null,
        deviationBpm: null,
        baselineBpm: null,
        nightsInBaseline: priorRhr.length,
        reason:
          "No confirmed overnight recording (missing resting HR or sleep timestamps) — not interpolated.",
      });
      consecutiveElevated = 0;
      continue;
    }

    const rhr = night.restingHr!;

    if (priorRhr.length < MIN_PRIOR_NIGHTS_FOR_BASELINE) {
      results.push({
        date: night.date,
        state: null,
        deviationBpm: null,
        baselineBpm: null,
        nightsInBaseline: priorRhr.length,
        reason: `Baseline needs ${MIN_PRIOR_NIGHTS_FOR_BASELINE} confirmed prior nights, has ${priorRhr.length}.`,
      });
      consecutiveElevated = 0;
      priorRhr.push(rhr);
      previousConfirmedDate = night.date;
      continue;
    }

    const baseline = median(priorRhr);
    const deviation = rhr - baseline;
    const isConsecutiveCalendarNight =
      previousConfirmedDate !== null &&
      daysBetween(night.date, previousConfirmedDate) === 1;

    if (deviation >= RED_THRESHOLD_BPM) {
      consecutiveElevated = isConsecutiveCalendarNight
        ? consecutiveElevated + 1
        : 1;
    } else {
      consecutiveElevated = 0;
    }

    let state: NightSignalState;
    let reason: string | null;

    if (consecutiveElevated >= RED_CONSECUTIVE_NIGHTS) {
      state = "red";
      reason = `Resting HR has been ≥${RED_THRESHOLD_BPM} bpm above your personal baseline for ${consecutiveElevated} consecutive nights — elevated versus your own baseline, not a diagnosis. Alcohol is the most common cause in recreational athletes; illness, heat, poor sleep, and travel are others.`;
    } else if (deviation >= YELLOW_THRESHOLD_BPM) {
      state = "yellow";
      reason = `Resting HR is ${deviation.toFixed(1)} bpm above your personal baseline tonight. A single night carries little signal on its own (resting HR alone is close to a coin flip, Quer et al. 2021) — this is a watch-for-tomorrow flag, not an alert.`;
    } else {
      state = "green";
      reason = null;
    }

    results.push({
      date: night.date,
      state,
      deviationBpm: Math.round(deviation * 10) / 10,
      baselineBpm: Math.round(baseline * 10) / 10,
      nightsInBaseline: priorRhr.length,
      reason,
    });

    priorRhr.push(rhr);
    previousConfirmedDate = night.date;
  }

  return results;
}

/**
 * Convenience wrapper returning only the most recent night's NightSignal
 * state — what a "today" dashboard tile wants. See
 * {@link computeNightSignalSeries} for the full method and citations.
 *
 * @param nights Daily metrics, OLDEST FIRST (chronological).
 * @returns The last night's result, or null if `nights` is empty.
 */
export function getLatestNightSignal(
  nights: DailyMetricInput[],
): NightSignalResult | null {
  const series = computeNightSignalSeries(nights);
  return series.length > 0 ? series[series.length - 1]! : null;
}
