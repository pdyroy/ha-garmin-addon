import type { RacePredictionResult, VO2maxEstimateResult } from "../types";

/**
 * VO2MAX ESTIMATION & RACE PREDICTION
 *
 * Multiple estimation methods for cross-validation:
 * 1. Running pace + HR (ACSM equation) — most accurate for runners
 * 2. Uth ratio (HRmax / HRrest) — simple but rough estimate
 * 3. Cooper test — from 12-min distance test
 * 4. From race result — using Daniels' VDOT tables
 *
 * Race predictions use the Riegel formula (1981) — one of the most
 * validated prediction models for distances 1500m to marathon.
 */

/**
 * Estimate VO2max from running activity data.
 *
 * Uses the ACSM metabolic equation for running:
 * VO2 (ml/kg/min) = 3.5 + 0.2 × speed (m/min) + 0.9 × speed × grade
 * For flat running (grade=0): VO2 = 3.5 + 0.2 × speed
 *
 * Then: VO2max ≈ VO2_running / fraction_of_HRmax
 * where fraction_of_HRmax = (avgHR - restingHR) / (maxHR - restingHR)
 * adjusted using the Swain equation: %VO2R ≈ %HRR
 *
 * Ref: ACSM's Guidelines for Exercise Testing and Prescription, 11th ed. 2021.
 * Ref: Swain DP et al. Relationship between %heart rate reserve and %VO2reserve.
 *      Med Sci Sports Exerc. 1998;30(2):318-321.
 *
 * This is most accurate for steady-state runs of 12+ minutes at >60% HRR.
 * Returns null if insufficient data.
 */
export function estimateVO2maxFromRunning(
  distanceMeters: number,
  durationMinutes: number,
  avgHr: number,
  restingHr: number,
  maxHr: number,
): VO2maxEstimateResult | null {
  // Minimum quality thresholds
  if (durationMinutes < 12 || distanceMeters < 1500) return null;
  if (avgHr <= restingHr || maxHr <= restingHr) return null;

  const speedMPerMin = distanceMeters / durationMinutes;

  // ACSM running VO2 equation (flat terrain assumed)
  const vo2Running = 3.5 + 0.2 * speedMPerMin;

  // Heart rate reserve fraction (Swain 1998: %HRR ≈ %VO2R)
  const hrrFraction = (avgHr - restingHr) / (maxHr - restingHr);

  if (hrrFraction <= 0.4 || hrrFraction > 1.0) return null; // outside valid range

  const vo2max = vo2Running / hrrFraction;

  // Sanity check: VO2max should be 20-90 ml/kg/min for humans
  if (vo2max < 20 || vo2max > 90) return null;

  return {
    value: Math.round(vo2max * 10) / 10,
    source: "running_pace_hr",
    confidence: hrrFraction >= 0.6 && durationMinutes >= 20 ? "high" : "medium",
  };
}

/**
 * Estimate VO2max using the Uth method (simple ratio).
 *
 * VO2max = 15.3 × (HRmax / HRrest)
 *
 * Ref: Uth N et al. Estimation of VO2max from the ratio between HRmax
 *      and HRrest — the Heart Rate Ratio Method. Eur J Appl Physiol.
 *      2004;91:111-115.
 *
 * Accuracy: ±5 ml/kg/min (rough estimate, good for initial baseline).
 * Most accurate for untrained to moderately trained individuals.
 */
export function estimateVO2maxUth(
  maxHr: number,
  restingHr: number,
): VO2maxEstimateResult | null {
  if (maxHr <= restingHr || restingHr <= 0) return null;

  const vo2max = 15.3 * (maxHr / restingHr);

  if (vo2max < 20 || vo2max > 90) return null;

  return {
    value: Math.round(vo2max * 10) / 10,
    source: "uth_ratio",
    confidence: "low", // rough estimate
  };
}

/**
 * Estimate VO2max from Cooper 12-minute run test.
 *
 * VO2max = (distance_meters - 504.9) / 44.73
 *
 * Ref: Cooper KH. A means of assessing maximal oxygen intake: correlation
 *      between field and treadmill testing. JAMA. 1968;203(3):201-204.
 *
 * Accuracy: r=0.897 with treadmill VO2max testing.
 * Requires a maximal 12-minute effort to be valid.
 */
export function estimateVO2maxCooper(
  distanceMeters12min: number,
): VO2maxEstimateResult | null {
  if (distanceMeters12min < 800 || distanceMeters12min > 5000) return null;

  const vo2max = (distanceMeters12min - 504.9) / 44.73;

  if (vo2max < 15 || vo2max > 90) return null;

  return {
    value: Math.round(vo2max * 10) / 10,
    source: "cooper",
    confidence: "medium",
  };
}

/**
 * Predict race times using the Riegel formula.
 *
 * T2 = T1 × (D2 / D1) ^ 1.06
 *
 * Ref: Riegel PS. Athletic Records and Human Endurance.
 *      American Scientist. 1981;69(3):285-290.
 *
 * The exponent 1.06 is empirically derived from world records and has
 * been validated across distances from 1500m to marathon. It accounts
 * for the non-linear relationship between distance and pace (fatigue
 * factor increases with distance).
 *
 * Accuracy: ±2-3% for well-trained runners, ±5% for recreational runners.
 * Less accurate beyond marathon distance (ultramarathon exponent is higher).
 */
export function predictRaceTimes(
  knownDistanceMeters: number,
  knownTimeSeconds: number,
  vo2max: number,
): RacePredictionResult[] {
  const RACE_DISTANCES: Array<{
    name: RacePredictionResult["distance"];
    meters: number;
  }> = [
    { name: "5K", meters: 5000 },
    { name: "10K", meters: 10000 },
    { name: "half_marathon", meters: 21097.5 },
    { name: "marathon", meters: 42195 },
  ];

  const RIEGEL_EXPONENT = 1.06; // Riegel (1981)

  return RACE_DISTANCES.map(({ name, meters }) => {
    const predictedSeconds = Math.round(
      knownTimeSeconds *
        Math.pow(meters / knownDistanceMeters, RIEGEL_EXPONENT),
    );

    return {
      distance: name,
      distanceMeters: meters,
      predictedSeconds,
      predictedFormatted: formatTime(predictedSeconds),
      method: "riegel" as const,
      vo2maxUsed: vo2max,
    };
  });
}

// ---------------------------------------------------------------------------
// Individually-fitted power-law race prediction
//
// Ref: Vickers AJ, Vertosick EA. An empirical study of race times in
//      recreational endurance runners. BMC Sports Sci Med Rehabil. 2016;8:26.
//      n=2303 recreational runners — Riegel's fixed 1.06 exponent (fitted to
//      world records) predicts marathon time at least 10 minutes too fast
//      for over half of recreational runners. A corrected exponent for this
//      population sits closer to 1.07-1.09.
// Ref: Blythe DAJ, Kiraly FJ. Prediction and quantification of individual
//      athletic performance of runners. PLoS ONE. 2016;11(6):e0157256.
//      n=164,746 — establishes fitting an individual power law
//      (log velocity = a - b × log distance, OLS) per athlete rather than
//      assuming a population exponent.
// ---------------------------------------------------------------------------

/** Minimal activity shape the fit needs — deliberately narrower than
 * ActivityInput so callers don't have to assemble the full activity record. */
export interface RaceEffortInput {
  sportType: string;
  distanceMeters: number | null;
  durationMinutes: number;
  startedAt: Date;
}

export interface PowerLawFitResult {
  /** k in T_minutes = C × D_meters^k — the individually fitted duration-vs-
   * distance exponent. Riegel's population value is 1.06; Vickers & Vertosick's
   * recreational-runner correction is ~1.07-1.09. Values are athlete-specific
   * and can legitimately fall outside that band. */
  exponent: number;
  /** C in T_minutes = C × D_meters^k — the athlete's fitted pace constant. */
  coefficient: number;
  /** Weighted R² (0-1) of the log(v) = a - b·log(d) OLS fit. Low values mean
   * the exponent is not well supported by the athlete's own data even though
   * a fit was possible — surfaced so a caller can discount it. */
  rSquared: number;
  /** Number of distinct-distance band-bests that went into the fit. */
  effortsUsed: number;
  /** Representative distance (m) of each band used, ascending. */
  distanceBandsMeters: number[];
}

export interface RaceModelInfo {
  method: "power_law_fit" | "riegel_fallback";
  exponent: number;
  rSquared: number | null;
  effortsUsed: number;
  distanceBandsMeters: number[];
  /** Present only for riegel_fallback — why the individual fit wasn't used. */
  reason?: string;
}

export interface FittedRacePrediction {
  distance: "5K" | "10K" | "half_marathon" | "marathon";
  distanceMeters: number;
  predictedSeconds: number;
  predictedFormatted: string;
}

export interface RacePredictionFitResult {
  predictions: FittedRacePrediction[];
  model: RaceModelInfo;
  /** Always present: Pacer has no race flag, so every input effort is a
   * training-run PB, not a confirmed maximal/race effort. */
  limitation: string;
}

const MIN_DISTANCE_METERS = 800; // shorter and GPS/watch-start noise dominates pace
// A second effort must be >20% further than the last band's anchor to count
// as a "meaningfully different" distance — otherwise it's the same effort
// repeated (e.g. three different 5Ks) and collapses into one band-best.
const BAND_RATIO = 1.2;
const RECENCY_HALF_LIFE_DAYS = 365; // a PB one year old carries half the fit weight of a fresh one
const ANCHOR_RECENCY_WINDOW_DAYS = 730; // Riegel fallback prefers a PB from the last ~2 seasons
const RIEGEL_CORRECTED_EXPONENT = 1.08; // Vickers & Vertosick (2016) recreational correction, mid-band

const MAXIMAL_EFFORT_LIMITATION =
  "Pacer has no race flag: each input is the fastest recorded pace at that " +
  "distance, not a confirmed maximal/race effort. Training runs at race " +
  "distances can pull the prediction toward training pace rather than " +
  "true race performance.";

interface EligibleEffort {
  distanceMeters: number;
  durationMinutes: number;
  startedAt: Date;
  speedMPerMin: number;
}

function isEligibleRunningEffort(sportType: string): boolean {
  const s = sportType.trim().toLowerCase();
  // Walking, hiking and treadmill are different efforts; cycling is a
  // different sport. Excluded before the "running" substring check below.
  if (
    s.includes("treadmill") ||
    s.includes("walk") ||
    s.includes("hik") ||
    s.includes("cycl") ||
    s.includes("bik")
  ) {
    return false;
  }
  return s.includes("run");
}

function extractEligibleEfforts(efforts: RaceEffortInput[]): EligibleEffort[] {
  const out: EligibleEffort[] = [];
  for (const e of efforts) {
    if (!isEligibleRunningEffort(e.sportType)) continue;
    if (e.distanceMeters === null || e.distanceMeters < MIN_DISTANCE_METERS)
      continue;
    if (e.durationMinutes <= 0) continue;
    out.push({
      distanceMeters: e.distanceMeters,
      durationMinutes: e.durationMinutes,
      startedAt: e.startedAt,
      speedMPerMin: e.distanceMeters / e.durationMinutes,
    });
  }
  return out;
}

/** Groups efforts sorted ascending by distance into bands where each new
 * band starts more than BAND_RATIO beyond the previous band's anchor. */
function bandByDistance(sorted: EligibleEffort[]): EligibleEffort[][] {
  const bands: EligibleEffort[][] = [];
  for (const e of sorted) {
    const current = bands[bands.length - 1];
    if (current && e.distanceMeters <= current[0]!.distanceMeters * BAND_RATIO) {
      current.push(e);
    } else {
      bands.push([e]);
    }
  }
  return bands;
}

/** Fastest effort in the band; ties broken by recency. */
function bandBest(band: EligibleEffort[]): EligibleEffort {
  return band.reduce((best, e) => {
    if (e.speedMPerMin > best.speedMPerMin) return e;
    if (e.speedMPerMin === best.speedMPerMin && e.startedAt > best.startedAt)
      return e;
    return best;
  });
}

function ageDays(startedAt: Date, now: Date): number {
  return (now.getTime() - startedAt.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Fit an individual power law log(v) = a - b·log(d) by weighted ordinary
 * least squares over the athlete's own best running efforts, one point per
 * distance band (the band's fastest pace — see bandByDistance/bandBest).
 *
 * Ref: Blythe & Kiraly (2016), PLoS ONE 11:e0157256 — individual power-law
 *      fit per athlete instead of a population exponent.
 * Ref: Vickers & Vertosick (2016), BMC Sports Sci Med Rehabil 8:26 —
 *      motivates why the fixed Riegel exponent is wrong for recreational
 *      runners in the first place.
 *
 * Recency weighting: each band-best is weighted by 0.5^(ageDays/365), so a
 * PB from this season counts full and a multi-year-old PB decays toward
 * negligible influence rather than being hard-cut at a window boundary.
 *
 * LIMITATION: inputs are the fastest *recorded* pace per distance band, not
 * confirmed maximal/race efforts — Pacer has no race flag. See
 * MAXIMAL_EFFORT_LIMITATION / RacePredictionFitResult.limitation.
 *
 * Requires at least 3 distinct distance bands (>20% apart, see BAND_RATIO).
 * Returns `{ value: null, reason }` when the athlete's data can't support a
 * fit rather than emitting an exponent from too little/degenerate data
 * (rule: never compute a number from too little data).
 */
export function fitIndividualPowerLaw(
  efforts: RaceEffortInput[],
  now: Date,
): PowerLawFitResult | { value: null; reason: string } {
  const eligible = extractEligibleEfforts(efforts);
  if (eligible.length === 0) {
    return {
      value: null,
      reason:
        "No eligible running efforts (running sportType, excluding walking/hiking/treadmill/cycling, with a valid distance and duration).",
    };
  }

  const sorted = [...eligible].sort(
    (a, b) => a.distanceMeters - b.distanceMeters,
  );
  const bands = bandByDistance(sorted);
  if (bands.length < 3) {
    return {
      value: null,
      reason: `Only ${bands.length} distinct running distance(s) found (need ≥3, each >20% apart) — cannot fit an individual power law.`,
    };
  }

  const points = bands.map(bandBest);
  const weighted = points.map((p) => ({
    x: Math.log(p.distanceMeters),
    y: Math.log(p.speedMPerMin),
    w: Math.pow(0.5, ageDays(p.startedAt, now) / RECENCY_HALF_LIFE_DAYS),
  }));

  const sw = weighted.reduce((s, p) => s + p.w, 0);
  const swx = weighted.reduce((s, p) => s + p.w * p.x, 0);
  const swy = weighted.reduce((s, p) => s + p.w * p.y, 0);
  const swxx = weighted.reduce((s, p) => s + p.w * p.x * p.x, 0);
  const swxy = weighted.reduce((s, p) => s + p.w * p.x * p.y, 0);

  const denom = sw * swxx - swx * swx;
  if (denom === 0) {
    return {
      value: null,
      reason: "Distance bands are not spread out enough for a stable fit.",
    };
  }

  const slope = (sw * swxy - swx * swy) / denom; // d(log v)/d(log d) = -b
  const intercept = (swy - slope * swx) / sw; // a

  const exponent = 1 - slope; // k = 1 + b, the duration-vs-distance exponent

  // ponytail: reject fits outside the physiologically plausible range for a
  // duration exponent (k<=1 means no fatigue effect at all; k>1.3 is an
  // extreme, almost certainly sparse-data artefact) rather than trusting an
  // OLS output blindly. Upgrade path: replace the fixed band with a proper
  // confidence interval on the slope if this proves too coarse.
  if (!Number.isFinite(exponent) || exponent <= 1.0 || exponent > 1.3) {
    return {
      value: null,
      reason: `Fitted exponent ${exponent.toFixed(3)} is outside the physiologically plausible range (1.00-1.30) — likely too little or too noisy data.`,
    };
  }

  const ybar = swy / sw;
  const ssTot = weighted.reduce((s, p) => s + p.w * (p.y - ybar) ** 2, 0);
  const ssRes = weighted.reduce(
    (s, p) => s + p.w * (p.y - (intercept + slope * p.x)) ** 2,
    0,
  );
  const rSquared = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);

  return {
    exponent: Math.round(exponent * 1000) / 1000,
    coefficient: Math.exp(-intercept),
    rSquared: Math.round(rSquared * 1000) / 1000,
    effortsUsed: points.length,
    distanceBandsMeters: points.map((p) => p.distanceMeters),
  };
}

function pickAnchorEffort(eligible: EligibleEffort[], now: Date): EligibleEffort {
  const recent = eligible.filter(
    (e) => ageDays(e.startedAt, now) <= ANCHOR_RECENCY_WINDOW_DAYS,
  );
  const pool = recent.length > 0 ? recent : eligible;
  return pool.reduce((best, e) => (e.speedMPerMin > best.speedMPerMin ? e : best));
}

const FIT_RACE_DISTANCES: Array<{
  name: FittedRacePrediction["distance"];
  meters: number;
}> = [
  { name: "5K", meters: 5000 },
  { name: "10K", meters: 10000 },
  { name: "half_marathon", meters: 21097.5 },
  { name: "marathon", meters: 42195 },
];

/**
 * Predict 5K/10K/half/marathon times using an individually fitted power law
 * (fitIndividualPowerLaw) in place of Riegel's fixed 1.06 exponent, falling
 * back to Riegel with a corrected recreational-runner exponent (1.08, see
 * RIEGEL_CORRECTED_EXPONENT) when the athlete's data can't support a fit.
 *
 * Ref: Vickers & Vertosick (2016), BMC Sports Sci Med Rehabil 8:26.
 * Ref: Blythe & Kiraly (2016), PLoS ONE 11:e0157256.
 *
 * The Riegel fallback anchors on the single fastest running effort within
 * the last 2 seasons (ANCHOR_RECENCY_WINDOW_DAYS), or the fastest ever
 * recorded if nothing is that recent.
 *
 * Returns `{ value: null, reason }` only when there is no eligible running
 * effort at all to anchor even a Riegel prediction. `model.method` always
 * says which path was taken; `model.reason` is set when the fallback path
 * was taken and explains why the fit was rejected.
 */
export function predictRaceTimesAdaptive(
  efforts: RaceEffortInput[],
  now: Date,
): RacePredictionFitResult | { value: null; reason: string } {
  const eligible = extractEligibleEfforts(efforts);
  if (eligible.length === 0) {
    return {
      value: null,
      reason:
        "No eligible running efforts (running sportType, excluding walking/hiking/treadmill/cycling, with a valid distance and duration).",
    };
  }

  const fit = fitIndividualPowerLaw(efforts, now);

  let exponent: number;
  let coefficient: number;
  let model: RaceModelInfo;

  if ("value" in fit) {
    const anchor = pickAnchorEffort(eligible, now);
    exponent = RIEGEL_CORRECTED_EXPONENT;
    coefficient = anchor.durationMinutes / Math.pow(anchor.distanceMeters, exponent);
    model = {
      method: "riegel_fallback",
      exponent,
      rSquared: null,
      effortsUsed: 1,
      distanceBandsMeters: [anchor.distanceMeters],
      reason: fit.reason,
    };
  } else {
    exponent = fit.exponent;
    coefficient = fit.coefficient;
    model = {
      method: "power_law_fit",
      exponent: fit.exponent,
      rSquared: fit.rSquared,
      effortsUsed: fit.effortsUsed,
      distanceBandsMeters: fit.distanceBandsMeters,
    };
  }

  const predictions: FittedRacePrediction[] = FIT_RACE_DISTANCES.map(
    ({ name, meters }) => {
      const predictedSeconds = Math.round(
        coefficient * Math.pow(meters, exponent) * 60,
      );
      return {
        distance: name,
        distanceMeters: meters,
        predictedSeconds,
        predictedFormatted: formatTime(predictedSeconds),
      };
    },
  );

  return { predictions, model, limitation: MAXIMAL_EFFORT_LIMITATION };
}

/**
 * Predict race times from VO2max using a simplified VDOT approach.
 *
 * Uses the relationship between VO2max and running velocity:
 * velocity (m/min) = (VO2max - 3.5) / 0.2 (from ACSM equation, inverted)
 * Then applies a distance-specific efficiency factor.
 *
 * Ref: Daniels J. Daniels' Running Formula, 3rd ed. Human Kinetics, 2013.
 *
 * Note: This is a simplified approximation. Full VDOT tables would provide
 * more accurate predictions, especially for non-elite runners.
 */
export function predictRaceTimesFromVO2max(
  vo2max: number,
): RacePredictionResult[] {
  // Simplified: race VO2 as fraction of VO2max depends on duration
  // Shorter races use higher fraction (98-100%), marathon uses ~75-85%
  const RACE_PARAMS: Array<{
    name: RacePredictionResult["distance"];
    meters: number;
    fractionVO2max: number;
  }> = [
    { name: "5K", meters: 5000, fractionVO2max: 0.95 },
    { name: "10K", meters: 10000, fractionVO2max: 0.9 },
    { name: "half_marathon", meters: 21097.5, fractionVO2max: 0.83 },
    { name: "marathon", meters: 42195, fractionVO2max: 0.78 },
  ];

  return RACE_PARAMS.map(({ name, meters, fractionVO2max }) => {
    // VO2 at race effort
    const raceVO2 = vo2max * fractionVO2max;

    // Running velocity from ACSM equation (inverted)
    const speedMPerMin = (raceVO2 - 3.5) / 0.2;

    if (speedMPerMin <= 0) {
      return {
        distance: name,
        distanceMeters: meters,
        predictedSeconds: 0,
        predictedFormatted: "N/A",
        method: "vdot" as const,
        vo2maxUsed: vo2max,
      };
    }

    const predictedSeconds = Math.round((meters / speedMPerMin) * 60);

    return {
      distance: name,
      distanceMeters: meters,
      predictedSeconds,
      predictedFormatted: formatTime(predictedSeconds),
      method: "vdot" as const,
      vo2maxUsed: vo2max,
    };
  });
}

/**
 * Known low-confidence VO2max estimation sources excluded from trend analysis.
 * The Uth method (15.3 × HRmax/HRrest) has ±5 ml/kg/min accuracy
 * (Uth et al. 2004), which is too noisy for trend detection.
 */
const LOW_CONFIDENCE_SOURCES = new Set(["uth_method", "uth_ratio"]);

/**
 * Detect VO2max trend over a period.
 *
 * Uses simple linear regression on recent VO2max estimates.
 * A positive slope indicates improving aerobic capacity.
 *
 * Thresholds (informed by Firstbeat/Garmin documentation):
 * - Improving: slope > 0.5 ml/kg/min per 4 weeks
 * - Stable: slope within ±0.5
 * - Declining: slope < -0.5
 *
 * Note: At least 4 data points over 14+ days needed for meaningful trend.
 *
 * When source metadata is available, known low-confidence estimates
 * ("uth_method"/"uth_ratio") are excluded to prevent ambient daily
 * recalculations from skewing the trend. Other sources (including
 * "garmin_official", "running_pace_hr", "cooper", and any future/unknown
 * values) are retained.
 *
 * Ref: Uth N et al. (2004) — accuracy ±5 ml/kg/min (too noisy for trends).
 */
export function computeVO2maxTrend(
  estimates: Array<{ date: string; value: number; source?: string }>,
): {
  trend: "improving" | "stable" | "declining";
  slopePerWeek: number;
} | null {
  const hasSourceData = estimates.some((e) => e.source != null);
  const filtered = hasSourceData
    ? estimates.filter((e) => !LOW_CONFIDENCE_SOURCES.has(e.source ?? ""))
    : estimates;

  if (filtered.length < 4) return null;

  // Simple linear regression (days as x, VO2max as y)
  const startDate = new Date(filtered[0]!.date).getTime();
  const points = filtered.map((e) => ({
    x: (new Date(e.date).getTime() - startDate) / (1000 * 60 * 60 * 24), // days
    y: e.value,
  }));

  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { trend: "stable", slopePerWeek: 0 };

  const slopePerDay = (n * sumXY - sumX * sumY) / denom;
  const slopePerWeek = Math.round(slopePerDay * 7 * 100) / 100;

  // 0.5 ml/kg/min per 4 weeks = 0.125 per week
  const trend =
    slopePerWeek > 0.125
      ? "improving"
      : slopePerWeek < -0.125
        ? "declining"
        : "stable";

  return { trend, slopePerWeek };
}

function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
