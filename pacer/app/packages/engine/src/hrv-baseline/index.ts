/**
 * HRV BASELINE — Log-Transformed Rolling Mean, SWC Band, HRV x RHR Quadrants
 *
 * DATA REALITY CHECK (read this before touching thresholds):
 * Pacer stores one daily HRV scalar per night (the `hrv` column — Garmin's
 * on-device summary, believed to be an rMSSD-family statistic). It does NOT
 * store raw RR intervals. That means frequency-domain indices (LF/HF),
 * DFA-alpha1, Poincare-plot metrics (SD1/SD2) and orthostatic HRV tests are
 * PERMANENTLY IMPOSSIBLE to compute from this data — there is nothing to
 * derive them from, no matter how the code here is extended. Don't try.
 * `hrvOvernight` exists as a schema column but the sync never populates it;
 * treat it as an optional future override only, never as a data source.
 *
 * A single night's HRV is noisy (autonomic tone swings with alcohol, heat,
 * illness, altitude, even the previous day's meal timing). The 7-day rolling
 * mean (M7 below) — not the raw daily value — is the unit of interpretation
 * throughout this module.
 *
 * EVIDENCE CAVEAT: two meta-analyses found the performance benefit of
 * HRV-guided training small and NOT statistically significant —
 * Duking P et al. Front Physiol. 2021;12:639876; Manresa-Rocamora A et al.
 * Res Q Exerc Sport. 2021. Nothing exported from this module should be
 * read, or worded, as a promise of faster running. It surfaces a
 * physiological signal; it does not validate a training method.
 *
 * METHOD (M7 / baseline / SWC band):
 * Ref: Plews DJ, Laursen PB, Kilding AE, Buchheit M. Evaluating training
 *      adaptation with heart-rate measures: a methodological comparison.
 *      Sports Med. 2013;43(9):773-781.
 *   - x = ln(HRV) — HRV (rMSSD-family) is log-normally distributed; the log
 *     transform makes day-to-day variation approximately normal so a
 *     mean/SD-based band is meaningful.
 *   - M7 = 7-day rolling mean of x. The responsive, daily-updating number.
 *   - B (baseline) = mean of x over a 60-day window; SWC (smallest
 *     worthwhile change) = 0.5 x SD(x) over the same window. B and SWC are
 *     recomputed WEEKLY, not daily — a baseline that updates every day
 *     chases the very signal it exists to measure, and a bad patch would
 *     drag its own reference band down with it until suppression looked
 *     normal (rule: self-referential baselines must move slowly).
 *   - M7 vs B +/- SWC tells you whether this week's HRV is a real,
 *     worthwhile deviation from the athlete's own recent normal, or noise.
 *
 * METHOD (HRV x RHR quadrants):
 * Ref: Buchheit M. Monitoring training status with HR measures: do not
 *      throw the baby out with the bathwater. Front Physiol. 2014;5:73.
 * Ref: Schmitt L, Regnard J, Desmarets M, et al. Fatigue shifts and
 *      scatters heart rate variability in elite endurance athletes.
 *      PLoS ONE. 2013;8(8):e71588. (n=57)
 *   HRV and resting HR are two largely independent windows onto autonomic
 *   state. When both move and AGREE — HRV down together with RHR up — that
 *   is the highest-confidence signal this module can produce for fatigue
 *   or incipient illness, precisely because two independently-measured
 *   markers point the same way. HRV up with RHR down is the mirror-image
 *   "recovered/adapting well" signal. When they disagree, or only one
 *   moves, the read is weaker and is reported as such via `confidence`.
 *
 * NON-NEGOTIABLES ENFORCED HERE:
 *   - No interpolation of missing days. A day absent from `history` (watch
 *     off, sync failure) is treated as missing, not zero and not filled.
 *   - Every exported function returns either a value or a
 *     `{ value: null, reason: "..." }` explaining the shortfall — never a
 *     number computed from too little data.
 *   - Quorums: >=5 of the last 7 calendar days for M7, >=15 valid days
 *     (default, overridable) before a 60-day baseline is emitted.
 *   - Population thresholds are banned — every comparison is against this
 *     athlete's own 60-day history, never a fixed population number.
 */

/** One day of the two daily scalars this module reads. Absent days should
 * simply be omitted from `history` — never pass a placeholder/zero row. */
export interface HrvRhrDailyPoint {
  /** ISO calendar date, "YYYY-MM-DD". */
  date: string;
  hrv: number | null;
  restingHr: number | null;
}

/** Uniform "value or explained absence" result shape used throughout. */
export type QuorumResult<T> =
  | { value: T; reason?: undefined }
  | { value: null; reason: string };

export interface HrvBaselineBand {
  /** The Monday on/before the query date that this 60-day window ends on —
   * B and SWC only change when this date changes (weekly cadence). */
  anchorDate: string;
  /** B: mean of ln(HRV) over the 60-day window ending at anchorDate. */
  baseline: number;
  /** SWC: 0.5 x SD(ln(HRV)) over the same window (Plews et al. 2013). */
  swc: number;
  /** SD(ln(HRV)) over the window, exposed so callers can derive z-scores. */
  sd: number;
  lowerBound: number;
  upperBound: number;
  /** Count of valid (non-null, non-interpolated) days backing this band. */
  daysUsed: number;
}

export type HrvBandPosition = "above" | "within" | "below";

export interface HrvBaselineStatus {
  asOfDate: string;
  /** M7 in ln-space — the value the band comparison is made in. */
  m7: number;
  /** exp(M7): the 7-day geometric-mean HRV in the original units, for display. */
  m7Hrv: number;
  band: HrvBaselineBand;
  /** Where M7 sits relative to this week's B +/- SWC band. */
  position: HrvBandPosition;
}

export type HrvRhrQuadrant =
  | "fatigued"
  | "recovered"
  | "suppressedBoth"
  | "elevatedBoth"
  | "stable";

export interface HrvRhrQuadrantResult {
  asOfDate: string;
  /** Monday the shared 60-day baseline window for this classification ends on. */
  anchorDate: string;
  quadrant: HrvRhrQuadrant;
  /** (M7 - B) / SD for ln(HRV). Positive = HRV above its own baseline. */
  hrvZ: number;
  /** (M7 - B) / SD for resting HR, NOT log-transformed (Buchheit 2014 uses
   * RHR untransformed — unlike rMSSD it isn't materially log-skewed).
   * Positive = RHR above its own baseline (i.e. worse). */
  rhrZ: number;
  /** "high" only when HRV and RHR both cross their own SWC-equivalent
   * threshold (|z| >= 0.5) AND agree on direction — two independent
   * markers concurring. "moderate" when only one marker moved, or both
   * moved in the same (ambiguous) direction. "low" when neither moved. */
  confidence: "high" | "moderate" | "low";
}

const DEFAULT_MIN_M7_DAYS = 5;
const DEFAULT_MIN_BASELINE_DAYS = 15;
const M7_WINDOW_DAYS = 7;
const BASELINE_WINDOW_DAYS = 60;
/** |z| threshold for "moved" — chosen to equal SWC/SD (0.5), so a z past
 * this line is exactly a value outside the Plews et al. (2013) SWC band. */
const Z_DEADBAND = 0.5;

function isoToUTCDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Most recent Monday on or before `dateStr` (ISO week start). Pure function
 * of the given date — never reads the wall clock. This is what makes the
 * baseline "recompute weekly, not daily": callers pass today's date every
 * time, but the 60-day window's end only changes once every 7 days. */
function mostRecentMonday(dateStr: string): string {
  const d = isoToUTCDate(dateStr);
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return toISODate(d);
}

/** Inclusive list of `lengthDays` calendar dates ending at `endDateStr`. */
function buildDateWindow(endDateStr: string, lengthDays: number): string[] {
  const end = isoToUTCDate(endDateStr);
  const dates: string[] = [];
  for (let i = lengthDays - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(toISODate(d));
  }
  return dates;
}

/** Collect valid, optionally ln-transformed values for `field` over the
 * `lengthDays` window ending at `endDateStr`. Missing days (absent from
 * history, null, or non-positive) are skipped — never interpolated. */
function collectWindow(
  history: HrvRhrDailyPoint[],
  field: "hrv" | "restingHr",
  endDateStr: string,
  lengthDays: number,
  log: boolean,
): number[] {
  const byDate = new Map(history.map((p) => [p.date, p[field]]));
  const values: number[] = [];
  for (const date of buildDateWindow(endDateStr, lengthDays)) {
    const raw = byDate.get(date);
    if (raw === undefined || raw === null || raw <= 0) continue;
    values.push(log ? Math.log(raw) : raw);
  }
  return values;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample SD (n-1 denominator), matching computeSD in ../baselines. */
function sd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * M7: 7-day rolling mean of ln(HRV), ending at `asOfDate` inclusive.
 *
 * Ref: Plews et al. Sports Med. 2013;43(9):773-781.
 *
 * Requires at least `minDays` (default 5) of the 7 calendar days to have a
 * valid HRV reading. A day the watch wasn't worn is missing, not zero —
 * it is simply excluded from both the count and the mean, never imputed.
 */
export function computeHrvM7(
  history: HrvRhrDailyPoint[],
  asOfDate: string,
  minDays: number = DEFAULT_MIN_M7_DAYS,
): QuorumResult<number> {
  const values = collectWindow(history, "hrv", asOfDate, M7_WINDOW_DAYS, true);
  if (values.length < minDays) {
    return {
      value: null,
      reason: `only ${values.length}/${M7_WINDOW_DAYS} days of HRV in the 7 days ending ${asOfDate} (need >= ${minDays})`,
    };
  }
  return { value: mean(values) };
}

/**
 * B (baseline) and SWC (smallest worthwhile change) for ln(HRV), computed
 * over a 60-day window that is only re-anchored weekly (the window always
 * ends on the most recent Monday on/before `asOfDate`) — see module doc
 * for why this must not update daily.
 *
 * Ref: Plews DJ, Laursen PB, Kilding AE, Buchheit M. Sports Med.
 *      2013;43(9):773-781. SWC = 0.5 x between-day SD (Buchheit 2014).
 *
 * Requires at least `minDays` (default 15) valid HRV days in the 60-day
 * window before emitting a baseline — a band built from a handful of days
 * is not a baseline, it's noise dressed up as one.
 */
export function computeHrvBaselineBand(
  history: HrvRhrDailyPoint[],
  asOfDate: string,
  minDays: number = DEFAULT_MIN_BASELINE_DAYS,
): QuorumResult<HrvBaselineBand> {
  const anchorDate = mostRecentMonday(asOfDate);
  const values = collectWindow(
    history,
    "hrv",
    anchorDate,
    BASELINE_WINDOW_DAYS,
    true,
  );
  if (values.length < minDays) {
    return {
      value: null,
      reason: `only ${values.length} valid HRV days in the 60-day window ending ${anchorDate} (need >= ${minDays})`,
    };
  }
  const baseline = mean(values);
  const sdVal = sd(values);
  const swc = 0.5 * sdVal;
  return {
    value: {
      anchorDate,
      baseline,
      swc,
      sd: sdVal,
      lowerBound: baseline - swc,
      upperBound: baseline + swc,
      daysUsed: values.length,
    },
  };
}

/**
 * Combined status: M7 plus this week's B +/- SWC band, and M7's position
 * relative to it. This is the single call a dashboard needs for "is this
 * week's HRV meaningfully different from this athlete's own recent normal".
 *
 * Ref: Plews et al. Sports Med. 2013;43(9):773-781.
 */
export function computeHrvBaselineStatus(
  history: HrvRhrDailyPoint[],
  asOfDate: string,
  options?: { minM7Days?: number; minBaselineDays?: number },
): QuorumResult<HrvBaselineStatus> {
  const m7Result = computeHrvM7(
    history,
    asOfDate,
    options?.minM7Days ?? DEFAULT_MIN_M7_DAYS,
  );
  if (m7Result.value === null) return m7Result;

  const bandResult = computeHrvBaselineBand(
    history,
    asOfDate,
    options?.minBaselineDays ?? DEFAULT_MIN_BASELINE_DAYS,
  );
  if (bandResult.value === null) return bandResult;

  const m7 = m7Result.value;
  const band = bandResult.value;
  const position: HrvBandPosition =
    m7 > band.upperBound ? "above" : m7 < band.lowerBound ? "below" : "within";

  return {
    value: { asOfDate, m7, m7Hrv: Math.exp(m7), band, position },
  };
}

/**
 * HRV x RHR quadrant classification.
 *
 * Ref: Buchheit M. Front Physiol. 2014;5:73.
 * Ref: Schmitt L et al. PLoS ONE. 2013;8(8):e71588 (n=57).
 *
 * Runs the same M7 (7-day mean, >=5/7 quorum) / 60-day-baseline-with-SD
 * (weekly-anchored, >=15-day quorum) machinery independently for HRV
 * (ln-transformed, per Plews et al. 2013) and resting HR (untransformed —
 * RHR is not materially log-skewed the way rMSSD is), then classifies on
 * the sign pair of the two resulting z-scores. HRV down + RHR up — two
 * independent markers agreeing — is the highest-confidence fatigue/illness
 * read this module can produce; HRV up + RHR down is its favorable mirror.
 * Both raw z-scores are returned so a caller can show the evidence rather
 * than take the label on faith.
 *
 * Never claims a performance benefit — see the Duking/Manresa-Rocamora
 * caveat in the module doc. This only reports a physiological state.
 */
export function classifyHrvRhrQuadrant(
  history: HrvRhrDailyPoint[],
  asOfDate: string,
  options?: { minM7Days?: number; minBaselineDays?: number },
): QuorumResult<HrvRhrQuadrantResult> {
  const minM7Days = options?.minM7Days ?? DEFAULT_MIN_M7_DAYS;
  const minBaselineDays = options?.minBaselineDays ?? DEFAULT_MIN_BASELINE_DAYS;
  const anchorDate = mostRecentMonday(asOfDate);

  const hrvM7Values = collectWindow(history, "hrv", asOfDate, M7_WINDOW_DAYS, true);
  if (hrvM7Values.length < minM7Days) {
    return {
      value: null,
      reason: `only ${hrvM7Values.length}/${M7_WINDOW_DAYS} days of HRV in the 7 days ending ${asOfDate} (need >= ${minM7Days})`,
    };
  }
  const rhrM7Values = collectWindow(
    history,
    "restingHr",
    asOfDate,
    M7_WINDOW_DAYS,
    false,
  );
  if (rhrM7Values.length < minM7Days) {
    return {
      value: null,
      reason: `only ${rhrM7Values.length}/${M7_WINDOW_DAYS} days of resting HR in the 7 days ending ${asOfDate} (need >= ${minM7Days})`,
    };
  }

  const hrvBaselineValues = collectWindow(
    history,
    "hrv",
    anchorDate,
    BASELINE_WINDOW_DAYS,
    true,
  );
  if (hrvBaselineValues.length < minBaselineDays) {
    return {
      value: null,
      reason: `only ${hrvBaselineValues.length} valid HRV days in the 60-day window ending ${anchorDate} (need >= ${minBaselineDays})`,
    };
  }
  const rhrBaselineValues = collectWindow(
    history,
    "restingHr",
    anchorDate,
    BASELINE_WINDOW_DAYS,
    false,
  );
  if (rhrBaselineValues.length < minBaselineDays) {
    return {
      value: null,
      reason: `only ${rhrBaselineValues.length} valid resting-HR days in the 60-day window ending ${anchorDate} (need >= ${minBaselineDays})`,
    };
  }

  const hrvM7 = mean(hrvM7Values);
  const rhrM7 = mean(rhrM7Values);
  const hrvBaseline = mean(hrvBaselineValues);
  const hrvSd = sd(hrvBaselineValues);
  const rhrBaseline = mean(rhrBaselineValues);
  const rhrSd = sd(rhrBaselineValues);

  const hrvZ = hrvSd > 0 ? (hrvM7 - hrvBaseline) / hrvSd : 0;
  const rhrZ = rhrSd > 0 ? (rhrM7 - rhrBaseline) / rhrSd : 0;

  const hrvDir: "up" | "down" | "stable" =
    hrvZ > Z_DEADBAND ? "up" : hrvZ < -Z_DEADBAND ? "down" : "stable";
  const rhrDir: "up" | "down" | "stable" =
    rhrZ > Z_DEADBAND ? "up" : rhrZ < -Z_DEADBAND ? "down" : "stable";

  const fatigueVotes = (hrvDir === "down" ? 1 : 0) + (rhrDir === "up" ? 1 : 0);
  const recoveryVotes = (hrvDir === "up" ? 1 : 0) + (rhrDir === "down" ? 1 : 0);

  let quadrant: HrvRhrQuadrant;
  let confidence: "high" | "moderate" | "low";

  if (fatigueVotes === 2) {
    quadrant = "fatigued";
    confidence = "high";
  } else if (recoveryVotes === 2) {
    quadrant = "recovered";
    confidence = "high";
  } else if (fatigueVotes === 1 && recoveryVotes === 0) {
    quadrant = "fatigued";
    confidence = "moderate";
  } else if (recoveryVotes === 1 && fatigueVotes === 0) {
    quadrant = "recovered";
    confidence = "moderate";
  } else if (hrvDir === "down" && rhrDir === "down") {
    quadrant = "suppressedBoth";
    confidence = "moderate";
  } else if (hrvDir === "up" && rhrDir === "up") {
    quadrant = "elevatedBoth";
    confidence = "moderate";
  } else {
    quadrant = "stable";
    confidence = "low";
  }

  return {
    value: { asOfDate, anchorDate, quadrant, hrvZ, rhrZ, confidence },
  };
}
