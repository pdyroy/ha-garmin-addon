/**
 * FITNESS AGE — VO2max expressed as an age
 *
 * The age at which the reference population's mean VO2max equals this
 * athlete's VO2max. A 45-year-old with a VO2max of 53 has the aerobic
 * capacity of an average 27-year-old, so his fitness age is 27.
 *
 * Ref: Loe H, Rognmo Ø, Saltin B, Wisløff U. Aerobic capacity reference data
 *      in 3816 healthy men and women 20-90 years. PLoS One. 2013;8(5):e64319.
 *   → Directly measured VO2max (treadmill, n=1929 men / 1881 women, HUNT3
 *     Fitness Study). Mean VO2max per decade, mL·kg⁻¹·min⁻¹:
 *
 *       age    20-29   30-39   40-49   50-59   60-69   70+
 *       men     54.4    49.1    47.2    42.6    39.2   35.3
 *       women   43.0    40.0    38.4    34.4    31.1   28.3
 *
 *     The constants below are an ordinary least-squares fit through those
 *     six means, placed at their decade midpoints (25, 35, ... 75). Its slope
 *     matches the paper's own summary of "approximately 3.5 mL·kg⁻¹·min⁻¹
 *     lower per increased decade". Residuals stay under 1.2 mL·kg⁻¹·min⁻¹;
 *     the largest sits at the men's 30-39 decade, whose published mean is
 *     itself off the trend of the other five.
 *
 * HONESTY NOTE: this is a re-expression of a VO2max percentile, not a
 * biomarker of biological age. It says nothing about anything VO2max does
 * not already say. Commercial "biological age" scores fold in sleep,
 * lifestyle and bloodwork; this one deliberately does not, because those
 * weightings are unpublished and cannot be checked. The reference cohort is
 * Norwegian and healthy, so a fitness age is only comparable to itself over
 * time — treat the trend as the signal, not the absolute number.
 */

/** OLS fit of the Loe 2013 decade means: vo2max = intercept - slope * age. */
const REFERENCE = {
  male: { intercept: 63.18, slope: 0.3709 },
  female: { intercept: 50.75, slope: 0.2977 },
  /** Unspecified sex: the mean of both lines. Flagged as "pooled". */
  pooled: { intercept: 56.96, slope: 0.3343 },
} as const;

/** The reference cohort spans 20-90; extrapolating past it is meaningless. */
const MIN_FITNESS_AGE = 20;
const MAX_FITNESS_AGE = 90;

export interface FitnessAgeInput {
  /** Measured or estimated VO2max in mL·kg⁻¹·min⁻¹. */
  vo2max: number | null | undefined;
  age: number | null | undefined;
  sex: string | null | undefined;
}

export interface FitnessAgeResult {
  /** Age at which the reference mean VO2max equals this athlete's. */
  fitnessAge: number;
  /** fitnessAge - age. Negative is better: fitter than same-age peers. */
  deltaYears: number;
  /** Reference-population mean VO2max at the athlete's actual age. */
  populationMean: number;
  /** Which reference line was used. */
  method: "male" | "female" | "pooled";
  /** True when the fitness age hit a clamp and the real value is beyond it. */
  clamped: boolean;
}

/**
 * Compute fitness age from VO2max. Returns null when VO2max or age is
 * missing — there is no defensible way to guess either one.
 */
export function computeFitnessAge({
  vo2max,
  age,
  sex,
}: FitnessAgeInput): FitnessAgeResult | null {
  if (
    vo2max == null ||
    !Number.isFinite(vo2max) ||
    vo2max <= 0 ||
    age == null ||
    !Number.isFinite(age) ||
    age <= 0
  ) {
    return null;
  }

  const method =
    sex === "male" ? "male" : sex === "female" ? "female" : "pooled";
  const { intercept, slope } = REFERENCE[method];

  const raw = (intercept - vo2max) / slope;
  const fitnessAge = Math.min(
    MAX_FITNESS_AGE,
    Math.max(MIN_FITNESS_AGE, Math.round(raw)),
  );

  return {
    fitnessAge,
    deltaYears: Math.round(fitnessAge - age),
    populationMean: Math.round((intercept - slope * age) * 10) / 10,
    method,
    clamped: Math.round(raw) !== fitnessAge,
  };
}
