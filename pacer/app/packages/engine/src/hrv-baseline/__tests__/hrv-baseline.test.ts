import { describe, expect, it } from "vitest";

import {
  classifyHrvRhrQuadrant,
  computeHrvBaselineBand,
  computeHrvBaselineStatus,
  computeHrvM7,
  type HrvRhrDailyPoint,
} from "..";

function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// 2026-02-02 is a Monday (verified via Date.getUTCDay()).
const MONDAY = "2026-02-02";

/**
 * Builds a 66-day fixture spanning [MONDAY-59 .. MONDAY+6]:
 *   - 59 days of "baseline" oscillation ending the day before MONDAY
 *   - 7 days of "recent" values from MONDAY..MONDAY+6 (the M7 window),
 *     which also supplies the single MONDAY day inside the 60-day
 *     baseline window (a 1/60 dilution, intentionally negligible).
 * asOfDate defaults to MONDAY+6 (the Sunday closing that ISO week), so
 * computeHrvM7's 7-day window is exactly the "recent" days and
 * mostRecentMonday(asOfDate) resolves back to MONDAY.
 */
function buildFixture(opts: {
  baselineHrv: [number, number]; // alternating pair
  baselineRhr: [number, number];
  recentHrv: number[]; // 7 values, MONDAY..MONDAY+6
  recentRhr: number[]; // 7 values
}): HrvRhrDailyPoint[] {
  const points: HrvRhrDailyPoint[] = [];
  for (let i = 59; i >= 1; i--) {
    const date = addDays(MONDAY, -i);
    const hrv = i % 2 === 0 ? opts.baselineHrv[0] : opts.baselineHrv[1];
    const restingHr = i % 2 === 0 ? opts.baselineRhr[0] : opts.baselineRhr[1];
    points.push({ date, hrv, restingHr });
  }
  for (let i = 0; i < 7; i++) {
    points.push({
      date: addDays(MONDAY, i),
      hrv: opts.recentHrv[i]!,
      restingHr: opts.recentRhr[i]!,
    });
  }
  return points;
}

const ASOF = addDays(MONDAY, 6); // Sunday closing the fixture's current week

describe("computeHrvM7", () => {
  it("computes the 7-day ln-mean when all 7 days are present", () => {
    const history: HrvRhrDailyPoint[] = [];
    for (let i = 0; i < 7; i++) {
      history.push({ date: addDays(ASOF, -6 + i), hrv: 50, restingHr: 60 });
    }
    const result = computeHrvM7(history, ASOF);
    expect(result.value).not.toBeNull();
    expect(result.value).toBeCloseTo(Math.log(50), 10);
  });

  it("returns null with a reason when fewer than 5 of 7 days are present", () => {
    const history: HrvRhrDailyPoint[] = [
      { date: addDays(ASOF, -6), hrv: 50, restingHr: 60 },
      { date: addDays(ASOF, -5), hrv: 50, restingHr: 60 },
      { date: addDays(ASOF, -4), hrv: null, restingHr: 60 }, // null, not missing
      { date: addDays(ASOF, -3), hrv: 50, restingHr: 60 },
      // -2, -1, 0 (ASOF) entirely absent from history — gap days
    ];
    const result = computeHrvM7(history, ASOF);
    expect(result.value).toBeNull();
    expect(result.reason).toContain("3/7");
  });

  it("passes at exactly the 5/7 quorum boundary", () => {
    const history: HrvRhrDailyPoint[] = [];
    for (let i = 0; i < 5; i++) {
      history.push({ date: addDays(ASOF, -6 + i), hrv: 50, restingHr: 60 });
    }
    // -1 and 0 (ASOF) missing entirely -> 5/7 present, quorum is >=5
    const result = computeHrvM7(history, ASOF);
    expect(result.value).not.toBeNull();
  });

  it("respects a caller-supplied minDays override", () => {
    const history: HrvRhrDailyPoint[] = [
      { date: ASOF, hrv: 50, restingHr: 60 },
    ];
    expect(computeHrvM7(history, ASOF, 1).value).not.toBeNull();
    expect(computeHrvM7(history, ASOF, 2).value).toBeNull();
  });
});

describe("computeHrvBaselineBand", () => {
  it("computes B/SWC over 60 days and anchors to the most recent Monday", () => {
    const fixture = buildFixture({
      baselineHrv: [44, 56],
      baselineRhr: [58, 62],
      recentHrv: [50, 50, 50, 50, 50, 50, 50],
      recentRhr: [60, 60, 60, 60, 60, 60, 60],
    });
    const result = computeHrvBaselineBand(fixture, ASOF);
    expect(result.value).not.toBeNull();
    const band = result.value!;
    expect(band.anchorDate).toBe(MONDAY);
    expect(band.daysUsed).toBe(60);
    expect(band.swc).toBeCloseTo(0.5 * band.sd, 10);
    expect(band.lowerBound).toBeCloseTo(band.baseline - band.swc, 10);
    expect(band.upperBound).toBeCloseTo(band.baseline + band.swc, 10);
    expect(band.sd).toBeGreaterThan(0); // oscillating baseline has nonzero SD
  });

  it("returns null with a reason when fewer than 15 valid days exist", () => {
    const history: HrvRhrDailyPoint[] = [];
    for (let i = 0; i < 10; i++) {
      history.push({ date: addDays(MONDAY, -i), hrv: 50, restingHr: 60 });
    }
    const result = computeHrvBaselineBand(history, MONDAY);
    expect(result.value).toBeNull();
    expect(result.reason).toContain("10 valid HRV days");
  });

  it("does not recompute within the same ISO week (weekly, not daily, cadence)", () => {
    const fixture = buildFixture({
      baselineHrv: [44, 56],
      baselineRhr: [58, 62],
      recentHrv: [50, 50, 50, 50, 50, 50, 50],
      recentRhr: [60, 60, 60, 60, 60, 60, 60],
    });
    const onMonday = computeHrvBaselineBand(fixture, MONDAY);
    const onSunday = computeHrvBaselineBand(fixture, addDays(MONDAY, 6));
    expect(onMonday.value).not.toBeNull();
    expect(onSunday.value).not.toBeNull();
    // Same anchor, same B/SWC/day count even though "today" moved 6 days —
    // the 60-day window only ends at MONDAY in both cases.
    expect(onSunday.value).toEqual(onMonday.value);
  });
});

describe("computeHrvBaselineStatus", () => {
  it("computes a ~zero-width band (SWC≈0) when the 60-day baseline has no variance", () => {
    const fixture = buildFixture({
      baselineHrv: [50, 50],
      baselineRhr: [60, 60],
      recentHrv: [50, 50, 50, 50, 50, 50, 50],
      recentRhr: [60, 60, 60, 60, 60, 60, 60],
    });
    const result = computeHrvBaselineStatus(fixture, ASOF);
    expect(result.value).not.toBeNull();
    // Floating-point mean-of-identical-values can leave a ~1e-15 residual;
    // that's arithmetic noise, not a real SD, hence toBeCloseTo not toBe.
    expect(result.value!.band.sd).toBeCloseTo(0, 9);
    expect(result.value!.band.swc).toBeCloseTo(0, 9);
    expect(result.value!.m7Hrv).toBeCloseTo(50, 6);
  });

  it("classifies M7 as within the band when recent HRV matches the baseline pattern", () => {
    const fixture = buildFixture({
      baselineHrv: [44, 56],
      baselineRhr: [58, 62],
      recentHrv: [44, 56, 44, 56, 44, 56, 44],
      recentRhr: [58, 62, 58, 62, 58, 62, 58],
    });
    const result = computeHrvBaselineStatus(fixture, ASOF);
    expect(result.value!.position).toBe("within");
  });

  it("classifies M7 as above the band on a real HRV rise", () => {
    const fixture = buildFixture({
      baselineHrv: [50, 50],
      baselineRhr: [60, 60],
      recentHrv: [70, 70, 70, 70, 70, 70, 70],
      recentRhr: [60, 60, 60, 60, 60, 60, 60],
    });
    const result = computeHrvBaselineStatus(fixture, ASOF);
    expect(result.value!.position).toBe("above");
  });

  it("propagates the M7 quorum failure reason", () => {
    const history: HrvRhrDailyPoint[] = [
      { date: ASOF, hrv: 50, restingHr: 60 },
    ];
    const result = computeHrvBaselineStatus(history, ASOF);
    expect(result.value).toBeNull();
    expect(result.reason).toContain("/7");
  });

  it("propagates the baseline quorum failure reason once M7 passes", () => {
    const history: HrvRhrDailyPoint[] = [];
    for (let i = 0; i < 7; i++) {
      history.push({ date: addDays(ASOF, -6 + i), hrv: 50, restingHr: 60 });
    }
    const result = computeHrvBaselineStatus(history, ASOF);
    expect(result.value).toBeNull();
    expect(result.reason).toContain("valid HRV days in the 60-day window");
  });
});

describe("classifyHrvRhrQuadrant", () => {
  it("flags 'fatigued' with high confidence when HRV drops and RHR rises together", () => {
    const fixture = buildFixture({
      baselineHrv: [44, 56], // geometric-mean baseline ~50
      baselineRhr: [58, 62], // baseline ~60
      recentHrv: [30, 30, 30, 30, 30, 30, 30], // clearly suppressed
      recentRhr: [72, 72, 72, 72, 72, 72, 72], // clearly elevated
    });
    const result = classifyHrvRhrQuadrant(fixture, ASOF);
    expect(result.value).not.toBeNull();
    expect(result.value!.quadrant).toBe("fatigued");
    expect(result.value!.confidence).toBe("high");
    expect(result.value!.hrvZ).toBeLessThan(-0.5);
    expect(result.value!.rhrZ).toBeGreaterThan(0.5);
    expect(result.value!.anchorDate).toBe(MONDAY);
  });

  it("flags 'recovered' with high confidence when HRV rises and RHR drops together", () => {
    const fixture = buildFixture({
      baselineHrv: [44, 56],
      baselineRhr: [58, 62],
      recentHrv: [70, 70, 70, 70, 70, 70, 70],
      recentRhr: [48, 48, 48, 48, 48, 48, 48],
    });
    const result = classifyHrvRhrQuadrant(fixture, ASOF);
    expect(result.value!.quadrant).toBe("recovered");
    expect(result.value!.confidence).toBe("high");
    expect(result.value!.hrvZ).toBeGreaterThan(0.5);
    expect(result.value!.rhrZ).toBeLessThan(-0.5);
  });

  it("flags 'suppressedBoth' with moderate confidence when both markers fall (ambiguous)", () => {
    const fixture = buildFixture({
      baselineHrv: [44, 56],
      baselineRhr: [58, 62],
      recentHrv: [30, 30, 30, 30, 30, 30, 30], // down (bad)
      recentRhr: [48, 48, 48, 48, 48, 48, 48], // down (good) — contradicts hrv
    });
    const result = classifyHrvRhrQuadrant(fixture, ASOF);
    expect(result.value!.quadrant).toBe("suppressedBoth");
    expect(result.value!.confidence).toBe("moderate");
  });

  it("flags 'elevatedBoth' with moderate confidence when both markers rise (ambiguous)", () => {
    const fixture = buildFixture({
      baselineHrv: [44, 56],
      baselineRhr: [58, 62],
      recentHrv: [70, 70, 70, 70, 70, 70, 70],
      recentRhr: [72, 72, 72, 72, 72, 72, 72],
    });
    const result = classifyHrvRhrQuadrant(fixture, ASOF);
    expect(result.value!.quadrant).toBe("elevatedBoth");
    expect(result.value!.confidence).toBe("moderate");
  });

  it("flags 'fatigued' with only moderate confidence when a single marker moves", () => {
    const fixture = buildFixture({
      baselineHrv: [44, 56],
      baselineRhr: [58, 62],
      recentHrv: [30, 30, 30, 30, 30, 30, 30], // suppressed
      recentRhr: [58, 62, 58, 62, 58, 62, 58], // continues baseline oscillation
    });
    const result = classifyHrvRhrQuadrant(fixture, ASOF);
    expect(result.value!.quadrant).toBe("fatigued");
    expect(result.value!.confidence).toBe("moderate");
  });

  it("reports 'stable' with low confidence when neither marker moves", () => {
    const fixture = buildFixture({
      baselineHrv: [44, 56],
      baselineRhr: [58, 62],
      recentHrv: [44, 56, 44, 56, 44, 56, 44],
      recentRhr: [58, 62, 58, 62, 58, 62, 58],
    });
    const result = classifyHrvRhrQuadrant(fixture, ASOF);
    expect(result.value!.quadrant).toBe("stable");
    expect(result.value!.confidence).toBe("low");
  });

  it("returns null with a reason when the HRV M7 quorum is not met", () => {
    const history: HrvRhrDailyPoint[] = [
      { date: ASOF, hrv: 50, restingHr: 60 },
    ];
    const result = classifyHrvRhrQuadrant(history, ASOF);
    expect(result.value).toBeNull();
    expect(result.reason).toContain("HRV in the 7 days");
  });

  it("returns null with a reason when the resting-HR M7 quorum is not met", () => {
    const history: HrvRhrDailyPoint[] = [];
    for (let i = 0; i < 7; i++) {
      history.push({
        date: addDays(ASOF, -6 + i),
        hrv: 50, // HRV stays 7/7 (passes)
        restingHr: i < 4 ? 60 : null, // only 4/7 (fails the >=5 quorum)
      });
    }
    const result = classifyHrvRhrQuadrant(history, ASOF);
    expect(result.value).toBeNull();
    expect(result.reason).toContain("resting HR in the 7 days");
  });

  it("returns null with a reason when the 60-day baseline quorum is not met", () => {
    const history: HrvRhrDailyPoint[] = [];
    for (let i = 0; i < 7; i++) {
      history.push({ date: addDays(ASOF, -6 + i), hrv: 50, restingHr: 60 });
    }
    const result = classifyHrvRhrQuadrant(history, ASOF);
    expect(result.value).toBeNull();
    expect(result.reason).toContain("60-day window");
  });
});
