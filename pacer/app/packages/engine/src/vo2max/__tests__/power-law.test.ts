import { describe, expect, it } from "vitest";

import {
  fitIndividualPowerLaw,
  predictRaceTimesAdaptive,
  type RaceEffortInput,
} from "../index";

const NOW = new Date("2026-08-14T00:00:00Z");

function effort(
  sportType: string,
  distanceMeters: number | null,
  durationMinutes: number,
  startedAt: string,
): RaceEffortInput {
  return { sportType, distanceMeters, durationMinutes, startedAt: new Date(startedAt) };
}

/** A synthetic athlete that exactly obeys T = C × D^k, anchored on a real
 * pace (default: 25:00 5K), so the OLS should recover k to within rounding
 * and the resulting times stay in a plausible range for assertions. */
function syntheticEfforts(
  k: number,
  distancesMeters: number[],
  anchor: { distanceMeters: number; durationMinutes: number } = {
    distanceMeters: 5000,
    durationMinutes: 25,
  },
  startedAtDates?: string[],
): RaceEffortInput[] {
  const c = anchor.durationMinutes / Math.pow(anchor.distanceMeters, k);
  return distancesMeters.map((d, i) =>
    effort(
      "running",
      d,
      c * Math.pow(d, k),
      startedAtDates?.[i] ?? "2026-06-01T00:00:00Z",
    ),
  );
}

describe("fitIndividualPowerLaw", () => {
  it("returns null with a reason when there are no eligible efforts", () => {
    const result = fitIndividualPowerLaw([], NOW);
    expect(result).toEqual({ value: null, reason: expect.any(String) });
  });

  it("returns null with a reason when fewer than 3 distinct distance bands exist", () => {
    const efforts = [
      effort("running", 5000, 25, "2026-07-01T00:00:00Z"),
      effort("running", 5100, 24.8, "2026-07-15T00:00:00Z"), // same band as above (<20% apart)
    ];
    const result = fitIndividualPowerLaw(efforts, NOW);
    expect(result).toEqual({ value: null, reason: expect.any(String) });
    if ("reason" in result) {
      expect(result.reason).toMatch(/distinct running distance/i);
    }
  });

  it("excludes walking, hiking, treadmill and cycling from the running fit", () => {
    const efforts = [
      effort("running", 5000, 25, "2026-06-01T00:00:00Z"),
      effort("running", 10000, 52, "2026-06-02T00:00:00Z"),
      effort("walking", 15000, 150, "2026-06-03T00:00:00Z"),
      effort("treadmill_running", 21097.5, 115, "2026-06-04T00:00:00Z"),
      effort("cycling", 30000, 60, "2026-06-05T00:00:00Z"),
      effort("hiking", 12000, 200, "2026-06-06T00:00:00Z"),
    ];
    // Only 2 real running distances (5K, 10K) survive the sportType filter,
    // one short of the 3 needed to fit.
    const result = fitIndividualPowerLaw(efforts, NOW);
    expect(result).toEqual({ value: null, reason: expect.any(String) });
  });

  it("ignores efforts with a null or too-short distance", () => {
    const efforts = [
      effort("running", 5000, 25, "2026-06-01T00:00:00Z"),
      effort("running", 10000, 52, "2026-06-02T00:00:00Z"),
      effort("running", null, 30, "2026-06-03T00:00:00Z"),
      effort("running", 400, 2, "2026-06-04T00:00:00Z"), // below MIN_DISTANCE_METERS
    ];
    const result = fitIndividualPowerLaw(efforts, NOW);
    expect(result).toEqual({ value: null, reason: expect.any(String) });
  });

  it("fits an exponent close to the synthetic athlete's true k", () => {
    const trueK = 1.1;
    const efforts = syntheticEfforts(trueK, [3000, 5000, 10000, 21097.5, 42195]);
    const result = fitIndividualPowerLaw(efforts, NOW);
    if ("value" in result) throw new Error(`expected a fit, got: ${result.reason}`);
    expect(result.exponent).toBeCloseTo(trueK, 2);
    expect(result.rSquared).toBeGreaterThan(0.99);
    expect(result.effortsUsed).toBe(5);
    expect(result.distanceBandsMeters).toEqual([3000, 5000, 10000, 21097.5, 42195]);
  });

  it("keeps the fastest effort when the same distance is run more than once", () => {
    const slowFive = effort("running", 5000, 26, "2026-05-01T00:00:00Z");
    const fastFive = effort("running", 5000, 24, "2026-05-15T00:00:00Z");
    const rest = [
      effort("running", 10000, 50, "2026-06-01T00:00:00Z"),
      effort("running", 21097.5, 110, "2026-06-15T00:00:00Z"),
    ];

    const fastOnly = fitIndividualPowerLaw([fastFive, ...rest], NOW);
    const combined = fitIndividualPowerLaw([slowFive, fastFive, ...rest], NOW);
    if ("value" in fastOnly || "value" in combined) {
      throw new Error("expected both fits to succeed");
    }
    // The two 5Ks collapse into a single band-best (the faster one), so
    // adding the slower duplicate should not move the fit at all.
    expect(combined.effortsUsed).toBe(3);
    expect(combined.exponent).toBeCloseTo(fastOnly.exponent, 3);
    expect(combined.coefficient).toBeCloseTo(fastOnly.coefficient, 6);
  });

  it("down-weights a stale outlier enough to let the fit succeed where a fresh one would not", () => {
    const base = [
      effort("running", 5000, 25, "2026-06-01T00:00:00Z"),
      effort("running", 10000, 53, "2026-06-15T00:00:00Z"),
    ];
    // Same off-trend half-marathon time in both cases — only its age differs.
    const outlierFresh = effort("running", 21097.5, 100, "2026-07-01T00:00:00Z");
    const outlierStale = effort("running", 21097.5, 100, "2018-07-01T00:00:00Z");

    const withFreshOutlier = fitIndividualPowerLaw([...base, outlierFresh], NOW);
    const withStaleOutlier = fitIndividualPowerLaw([...base, outlierStale], NOW);

    // Fully weighted, the off-trend half-marathon drags the fitted exponent
    // outside the physiologically plausible range, so the fit is rejected.
    expect(withFreshOutlier).toEqual({ value: null, reason: expect.any(String) });

    // Decayed to near-zero weight by its 8-year age, the same value no
    // longer stops a well-supported fit from being found.
    if ("value" in withStaleOutlier) {
      throw new Error(`expected a fit to succeed: ${withStaleOutlier.reason}`);
    }
    expect(withStaleOutlier.rSquared).toBeGreaterThan(0.9);
  });
});

describe("predictRaceTimesAdaptive", () => {
  it("returns null with a reason when there is nothing to anchor a prediction on", () => {
    const result = predictRaceTimesAdaptive([], NOW);
    expect(result).toEqual({ value: null, reason: expect.any(String) });
  });

  it("falls back to Riegel with the corrected exponent when the fit is unsupported", () => {
    const efforts = [effort("running", 10000, 50, "2026-07-01T00:00:00Z")];
    const result = predictRaceTimesAdaptive(efforts, NOW);
    if ("value" in result) throw new Error("expected a prediction result");
    expect(result.model.method).toBe("riegel_fallback");
    expect(result.model.exponent).toBeCloseTo(1.08, 5);
    expect(result.model.rSquared).toBeNull();
    expect(result.model.reason).toEqual(expect.any(String));
    expect(result.predictions).toHaveLength(4);
    expect(result.limitation).toMatch(/no race flag/i);

    // 10K in 50:00 -> marathon pace per meter should be slower than 10K pace (k>1).
    const tenK = result.predictions.find((p) => p.distance === "10K")!;
    const marathon = result.predictions.find((p) => p.distance === "marathon")!;
    const tenKPaceSecPerM = tenK.predictedSeconds / 10000;
    const marathonPaceSecPerM = marathon.predictedSeconds / 42195;
    expect(marathonPaceSecPerM).toBeGreaterThan(tenKPaceSecPerM);
  });

  it("uses the individual fit when three or more distinct distances are available", () => {
    const trueK = 1.1;
    const efforts = syntheticEfforts(trueK, [3000, 5000, 10000, 21097.5]);
    const result = predictRaceTimesAdaptive(efforts, NOW);
    if ("value" in result) throw new Error("expected a prediction result");
    expect(result.model.method).toBe("power_law_fit");
    expect(result.model.rSquared).toBeGreaterThan(0.99);
    expect(result.model.reason).toBeUndefined();

    // Predicted marathon time should be close (few %) to the synthetic
    // athlete's own T = C × D^k formula, evaluated at the true (unrounded) k.
    const anchorC = 25 / Math.pow(5000, trueK);
    const expectedSeconds = anchorC * Math.pow(42195, trueK) * 60;
    const marathon = result.predictions.find((p) => p.distance === "marathon")!;
    const relativeError =
      Math.abs(marathon.predictedSeconds - expectedSeconds) / expectedSeconds;
    expect(relativeError).toBeLessThan(0.02);
  });

  it("excludes non-running sports from the anchor pool", () => {
    const efforts = [
      effort("strength_training", 0, 60, "2026-08-01T00:00:00Z"),
      effort("running", 5000, 25, "2026-06-01T00:00:00Z"),
    ];
    const result = predictRaceTimesAdaptive(efforts, NOW);
    if ("value" in result) throw new Error("expected a prediction result");
    expect(result.model.method).toBe("riegel_fallback");
    expect(result.model.distanceBandsMeters).toEqual([5000]);
  });

  it("prefers a recent anchor over a faster but stale one for the Riegel fallback", () => {
    const efforts = [
      effort("running", 5000, 20, "2019-01-01T00:00:00Z"), // faster but 7 years stale
      effort("running", 5000, 25, "2026-07-01T00:00:00Z"), // slower but recent
    ];
    const result = predictRaceTimesAdaptive(efforts, NOW);
    if ("value" in result) throw new Error("expected a prediction result");
    // The anchor pace should come from the recent 25-min effort, not the
    // stale 20-min one: predicted 5K should equal 25:00, not 20:00.
    const fiveK = result.predictions.find((p) => p.distance === "5K")!;
    expect(fiveK.predictedSeconds).toBe(25 * 60);
  });

  it("falls back to the fastest-ever effort when nothing is within the recency window", () => {
    const efforts = [effort("running", 5000, 22, "2015-01-01T00:00:00Z")];
    const result = predictRaceTimesAdaptive(efforts, NOW);
    if ("value" in result) throw new Error("expected a prediction result");
    expect(result.model.method).toBe("riegel_fallback");
    const fiveK = result.predictions.find((p) => p.distance === "5K")!;
    expect(fiveK.predictedSeconds).toBe(22 * 60);
  });
});
