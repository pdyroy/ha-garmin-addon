import type { ActivityInput } from "../types";

/**
 * TRAINING LOAD CALCULATIONS
 *
 * TRIMP (Training Impulse) — The foundational training load metric.
 *
 * Ref: Banister EW. Modeling elite athletic performance. In: Green HJ,
 *      McDougal JD, Wenger HA, eds. Physiological Testing of Elite Athletes.
 *      Champaign, IL: Human Kinetics; 1991:403-424.
 *
 * The sex-specific constants (k=1.92 male, k=1.67 female) account for
 * different lactate-HR relationships between sexes. These are the original
 * Banister constants, validated across 1000+ published studies.
 */

/**
 * Compute TRIMP (Training Impulse) from activity data.
 *
 * TRIMP = duration_minutes × ΔHR_ratio × e^(k × ΔHR_ratio)
 * where ΔHR_ratio = (avgHr - restingHr) / (maxHr - restingHr)
 * k = 1.92 (male) or 1.67 (female)
 *
 * Ref: Banister EW. (1991) — original TRIMP formula
 */
export function computeTRIMP(
  activity: {
    durationMinutes: number;
    avgHr: number | null;
    maxHr: number | null;
  },
  restingHr: number,
  userMaxHr: number,
  sex: string | null,
): number {
  if (activity.avgHr === null || userMaxHr <= restingHr) return 0;

  const hrReserve = userMaxHr - restingHr;
  if (hrReserve <= 0) return 0;

  const deltaHrRatio = Math.max(
    0,
    Math.min(1, (activity.avgHr - restingHr) / hrReserve),
  );
  const k = sex === "female" ? 1.67 : 1.92; // Banister (1991)

  return activity.durationMinutes * deltaHrRatio * Math.exp(k * deltaHrRatio);
}

/**
 * Convert TRIMP to a 0-21 strain score.
 *
 * Uses asymptotic exponential curve: strain = 21 × (1 - e^(-trimp / max))
 *
 * The 21-point scale follows WHOOP's published range. The personalTrimpMax
 * represents the TRIMP of the athlete's hardest conceivable session.
 *
 * Default 250 is calibrated for: 60 min at 85% HRR for a male athlete
 * (yields TRIMP ≈ 200). The exponential ensures diminishing returns
 * for extreme sessions, which matches physiological stress response.
 *
 * NOTE: personalTrimpMax should be calibrated per-athlete after 30+ sessions.
 * Formula: personalTrimpMax = max(historical TRIMP values) × 1.2
 */
export function computeStrainScore(
  trimp: number,
  personalTrimpMax = 250,
): number {
  if (trimp <= 0) return 0;
  const raw = 21 * (1 - Math.exp(-trimp / personalTrimpMax));
  return Math.round(raw * 100) / 100; // 2 decimal places
}

/**
 * Result shape for both ACWR functions below.
 *
 * `ratio` and `chronicLoad` are null together whenever the quorum isn't
 * met — never a number computed from too little data (project rule: prefer
 * a stated reason over a guess). `chronicLoad` is the ABSOLUTE average daily
 * load of the chronic window, not just the ratio: a ratio of 1.4 on a base
 * of 20 TRIMP/day is a different athlete state than 1.4 on a base of 90, and
 * the ratio alone can't tell them apart.
 */
export interface ACWRResult {
  ratio: number | null;
  chronicLoad: number | null;
  reason?: string;
}

/** Minimum days of daily-aggregated history before any ACWR ratio is emitted. */
const ACWR_MIN_DAYS = 14;
const ACWR_ACUTE_DAYS = 7;
const ACWR_CHRONIC_DAYS = 21; // days 8-28, decoupled from the acute week

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Compute Acute:Chronic Workload Ratio (ACWR) from a per-CALENDAR-DAY,
 * zero-padded, most-recent-first series.
 *
 * ACWR = acute load / chronic load, where acute = days 1-7 and chronic =
 * days 8-28. The chronic window deliberately EXCLUDES the acute week so the
 * two halves of the ratio are not built from overlapping data.
 *
 * WHY DECOUPLED (this used to be a rolling 7-day-in-a-28-day ratio, i.e. the
 * acute week sat inside its own denominator):
 * Ref: Impellizzeri FM et al. Acute:chronic workload ratio: conceptual
 *      issues and fundamental pitfalls. Sports Med. 2021;51:581-592.
 *      ("Time to dismiss ACWR and its underlying theory") — reproduced the
 *      published injury association after replacing the real chronic load
 *      with RANDOM numbers (OR 2.45 real vs 1.16-2.07 random), showing the
 *      coupled ratio's predictive signal is largely a mathematical artefact
 *      of numerator/denominator correlation, not a physiological one.
 * Ref: Lolli L et al. Mathematical coupling causes spurious correlation
 *      within the conventional acute-to-chronic workload ratio calculations.
 *      Br J Sports Med. 2019;53:921-922.
 *
 * There is no injury-risk banding here on purpose — see readiness/index.ts
 * for why the 0.8-1.3 "sweet spot" / >1.5 "danger" thresholds were removed.
 *
 * Quorum: returns `{ ratio: null, chronicLoad: null, reason }` with fewer
 * than 14 days of history (rule: no ratio at all below quorum).
 */
export function computeACWR(
  dailyLoadsRecent: number[], // per calendar day, zero-padded, index 0 = today
): ACWRResult {
  if (dailyLoadsRecent.length < ACWR_MIN_DAYS) {
    return {
      ratio: null,
      chronicLoad: null,
      reason: `need ${ACWR_MIN_DAYS}+ days of daily history, have ${dailyLoadsRecent.length}`,
    };
  }

  const acute = mean(dailyLoadsRecent.slice(0, ACWR_ACUTE_DAYS));
  const chronicWindow = dailyLoadsRecent.slice(
    ACWR_ACUTE_DAYS,
    ACWR_ACUTE_DAYS + ACWR_CHRONIC_DAYS,
  );
  const chronic = mean(chronicWindow);

  if (chronic === 0) {
    return {
      ratio: null,
      chronicLoad: 0,
      reason: "chronic load is zero — ratio undefined",
    };
  }

  return {
    ratio: Math.round((acute / chronic) * 100) / 100,
    chronicLoad: Math.round(chronic * 100) / 100,
  };
}

/**
 * Compute EWMA-based ACWR from a per-CALENDAR-DAY, zero-padded,
 * chronological (oldest-first) series.
 *
 * Uses exponentially weighted moving averages instead of rolling averages
 * — this fixes the WEIGHTING (recent days count more than distant ones)
 * but NOT the causal logic: EWMA-ACWR is still an acute:chronic ratio and
 * inherits the same numerator/denominator-coupling critique from
 * Impellizzeri (2021) and Lolli (2019) above unless the two averages are
 * fit on non-overlapping data. We therefore apply the same decoupling here:
 * the chronic EWMA is seeded and updated ONLY on the days strictly before
 * the acute week (days 8-28), never on the acute week itself.
 *
 * Ref: Williams S et al. Better way to determine the acute:chronic workload
 *      ratio? Br J Sports Med. 2017;51:209-210.
 *
 * α_acute = 2 / (7 + 1) = 0.25
 * α_chronic = 2 / (28 + 1) ≈ 0.069
 *
 * Quorum: returns `{ ratio: null, chronicLoad: null, reason }` with fewer
 * than 14 days of history.
 */
export function computeACWR_EWMA(
  dailyLoadsChrono: number[], // per calendar day, zero-padded, oldest first
): ACWRResult {
  if (dailyLoadsChrono.length < ACWR_MIN_DAYS) {
    return {
      ratio: null,
      chronicLoad: null,
      reason: `need ${ACWR_MIN_DAYS}+ days of daily history, have ${dailyLoadsChrono.length}`,
    };
  }

  const acuteWindow = dailyLoadsChrono.slice(-ACWR_ACUTE_DAYS);
  const chronicSource = dailyLoadsChrono
    .slice(0, -ACWR_ACUTE_DAYS)
    .slice(-ACWR_CHRONIC_DAYS);

  const alphaAcute = 2 / (ACWR_ACUTE_DAYS + 1);
  const alphaChronic = 2 / (ACWR_ACUTE_DAYS + ACWR_CHRONIC_DAYS + 1);

  let ewmaAcute = acuteWindow[0]!;
  for (let i = 1; i < acuteWindow.length; i++) {
    ewmaAcute = alphaAcute * acuteWindow[i]! + (1 - alphaAcute) * ewmaAcute;
  }

  let ewmaChronic = chronicSource[0]!;
  for (let i = 1; i < chronicSource.length; i++) {
    ewmaChronic =
      alphaChronic * chronicSource[i]! + (1 - alphaChronic) * ewmaChronic;
  }

  if (ewmaChronic === 0) {
    return {
      ratio: null,
      chronicLoad: 0,
      reason: "chronic load is zero — ratio undefined",
    };
  }

  return {
    ratio: Math.round((ewmaAcute / ewmaChronic) * 100) / 100,
    chronicLoad: Math.round(ewmaChronic * 100) / 100,
  };
}

/**
 * Compute Chronic Training Load (CTL) and Acute Training Load (ATL).
 *
 * Banister's Fitness-Fatigue Model:
 * - CTL = 42-day EMA of daily training stress ("fitness")
 * - ATL = 7-day EMA of daily training stress ("fatigue")
 * - TSB = CTL - ATL ("form" / "freshness")
 *
 * Ref: Banister EW et al. A systems model of training for athletic
 *      performance. Aust J Sci Med Sport. 1975;7:57-61.
 * Ref: Busso T. Variable dose-response relationship between exercise
 *      training and performance. Med Sci Sports Exerc. 2003;35(7):1188-1195.
 *
 * Ramp rate: CTL change per week. Safe: <5-8 pts/week (Coggan guidelines).
 * Exceeding this increases injury/illness risk.
 */
export function computeTrainingLoads(
  dailyStressScores: number[], // oldest first (chronological order)
): { ctl: number; atl: number; tsb: number; rampRate: number } {
  if (dailyStressScores.length === 0)
    return { ctl: 0, atl: 0, tsb: 0, rampRate: 0 };

  const alphaCTL = 2 / (42 + 1); // ~0.0465
  const alphaATL = 2 / (7 + 1); // 0.25

  let ctl = dailyStressScores[0]!;
  let atl = dailyStressScores[0]!;
  let ctlOneWeekAgo = ctl;

  for (let i = 1; i < dailyStressScores.length; i++) {
    ctl = alphaCTL * dailyStressScores[i]! + (1 - alphaCTL) * ctl;
    atl = alphaATL * dailyStressScores[i]! + (1 - alphaATL) * atl;

    // Track CTL from 7 days ago for ramp rate
    if (i === dailyStressScores.length - 8) {
      ctlOneWeekAgo = ctl;
    }
  }

  const tsb = ctl - atl;
  const rampRate = ctl - ctlOneWeekAgo;

  return {
    ctl: Math.round(ctl * 100) / 100,
    atl: Math.round(atl * 100) / 100,
    tsb: Math.round(tsb * 100) / 100,
    rampRate: Math.round(rampRate * 100) / 100,
  };
}

/**
 * Compute a daily Performance Management Chart (PMC) series.
 *
 * Returns one row per day with the rolling Banister CTL/ATL/TSB plus the
 * decoupled acute:chronic ratio (see `computeACWR`). This is the canonical
 * source for both the gauge (latest row) and the chart (the whole series),
 * eliminating the "gauge vs chart drift" class of bugs — which is why this
 * reuses `computeACWR` per row instead of a second, separately-maintained
 * copy of the acute/chronic window math.
 *
 * Input:
 *   - `dailyStressScores` — oldest first, zero-padded for rest days.
 *
 * Output:
 *   - Array of `{ ctl, atl, tsb, acwr, chronicLoad }` aligned 1:1 with the
 *     input. `acwr`/`chronicLoad` are null for the first ~14 rows of a
 *     series, same quorum as `computeACWR`.
 */
export function computeDailyPMCSeries(
  dailyStressScores: number[], // oldest first (chronological)
): {
  ctl: number;
  atl: number;
  tsb: number;
  acwr: number | null;
  chronicLoad: number | null;
}[] {
  if (dailyStressScores.length === 0) return [];

  const alphaCTL = 2 / (42 + 1);
  const alphaATL = 2 / (7 + 1);

  let ctl = dailyStressScores[0]!;
  let atl = dailyStressScores[0]!;
  const out: {
    ctl: number;
    atl: number;
    tsb: number;
    acwr: number | null;
    chronicLoad: number | null;
  }[] = [];

  for (let i = 0; i < dailyStressScores.length; i++) {
    if (i > 0) {
      ctl = alphaCTL * dailyStressScores[i]! + (1 - alphaCTL) * ctl;
      atl = alphaATL * dailyStressScores[i]! + (1 - alphaATL) * atl;
    }
    const tsb = ctl - atl;

    // Most-recent-first window ending at day i, capped to what computeACWR
    // needs (7 acute + 21 chronic = 28 days).
    const windowLen = Math.min(i + 1, ACWR_ACUTE_DAYS + ACWR_CHRONIC_DAYS);
    const recentWindow: number[] = [];
    for (let k = 0; k < windowLen; k++) {
      recentWindow.push(dailyStressScores[i - k]!);
    }
    const { ratio, chronicLoad } = computeACWR(recentWindow);

    out.push({
      ctl: Math.round(ctl * 100) / 100,
      atl: Math.round(atl * 100) / 100,
      tsb: Math.round(tsb * 100) / 100,
      acwr: ratio,
      chronicLoad,
    });
  }

  return out;
}

/**
 * Determine training load focus from activity training effects.
 *
 * Uses Garmin's aerobic/anaerobic Training Effect (0-5 scale, Firstbeat).
 * - Predominantly aerobic: aerobicTE > anaerobicTE × 1.5
 * - Predominantly anaerobic: anaerobicTE > aerobicTE × 1.5
 * - Mixed: roughly equal
 *
 * Ref: Firstbeat Technologies. Automated fitness level (VO2max) estimation
 *      with heart rate and speed data. Firstbeat white paper. 2014.
 */
export function classifyLoadFocus(
  recentActivities: Array<{
    aerobicTE: number | null;
    anaerobicTE: number | null;
  }>,
): "aerobic" | "anaerobic" | "mixed" {
  let totalAerobic = 0;
  let totalAnaerobic = 0;
  let count = 0;

  for (const a of recentActivities) {
    if (a.aerobicTE !== null && a.anaerobicTE !== null) {
      totalAerobic += a.aerobicTE;
      totalAnaerobic += a.anaerobicTE;
      count++;
    }
  }

  if (count === 0) return "mixed";

  const avgAerobic = totalAerobic / count;
  const avgAnaerobic = totalAnaerobic / count;

  if (avgAerobic > avgAnaerobic * 1.5) return "aerobic";
  if (avgAnaerobic > avgAerobic * 1.5) return "anaerobic";
  return "mixed";
}

/**
 * Count consecutive hard days (strain > threshold).
 *
 * Threshold calibrated from WHOOP strain data:
 * - Strain 0-7: low (recovery/easy)
 * - Strain 8-13: moderate
 * - Strain 14+: high (hard session)
 *
 * The 14 threshold corresponds roughly to a tempo or interval session
 * lasting 40+ minutes at >75% HRR.
 */
export function countConsecutiveHardDays(
  strainScores: number[], // most recent first
  threshold = 14,
): number {
  let count = 0;
  for (const score of strainScores) {
    if (score > threshold) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

export { computeTRIMP as trimp, computeStrainScore as strain };
