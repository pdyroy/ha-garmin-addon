import { describe, expect, it } from "vitest";

import type { DailyMetricInput } from "../../types";
import { computeNightSignalSeries, getLatestNightSignal } from "../index";

/** 2026-01-01 + offsetDays, as "YYYY-MM-DD". */
function dateAt(offsetDays: number): string {
  const t = Date.UTC(2026, 0, 1) + offsetDays * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function makeNight(overrides: Partial<DailyMetricInput> = {}): DailyMetricInput {
  return {
    date: "2026-01-01",
    sleepScore: null,
    totalSleepMinutes: 420,
    deepSleepMinutes: null,
    remSleepMinutes: null,
    lightSleepMinutes: null,
    awakeMinutes: null,
    hrv: null,
    restingHr: 60,
    maxHr: null,
    stressScore: null,
    bodyBatteryStart: null,
    bodyBatteryEnd: null,
    steps: null,
    calories: null,
    garminTrainingReadiness: null,
    garminTrainingLoad: null,
    respirationRate: null,
    spo2: null,
    skinTemp: null,
    intensityMinutes: null,
    floorsClimbed: null,
    bodyBatteryHigh: null,
    bodyBatteryLow: null,
    hrvOvernight: null,
    sleepStartTime: "23:00",
    sleepEndTime: "07:00",
    sleepNeedMinutes: null,
    sleepDebtMinutes: null,
    ...overrides,
  };
}

/** 7 confirmed nights at a flat 60 bpm — the minimum warmed-up baseline. */
function stableWarmup(rhr = 60): DailyMetricInput[] {
  return Array.from({ length: 7 }, (_, i) =>
    makeNight({ date: dateAt(i), restingHr: rhr }),
  );
}

describe("computeNightSignalSeries — quorum / baseline warm-up", () => {
  it("returns null state with a stated reason before 7 confirmed prior nights", () => {
    const nights = Array.from({ length: 6 }, (_, i) =>
      makeNight({ date: dateAt(i), restingHr: 60 }),
    );
    const series = computeNightSignalSeries(nights);

    expect(series).toHaveLength(6);
    for (const [i, r] of series.entries()) {
      expect(r.state).toBeNull();
      expect(r.deviationBpm).toBeNull();
      expect(r.baselineBpm).toBeNull();
      expect(r.nightsInBaseline).toBe(i);
      expect(r.reason).toContain("Baseline needs 7");
    }
  });

  it("classifies a night at the personal baseline as green once warmed up", () => {
    const nights = [...stableWarmup(), makeNight({ date: dateAt(7), restingHr: 60 })];
    const series = computeNightSignalSeries(nights);
    const last = series[7]!;

    expect(last.state).toBe("green");
    expect(last.deviationBpm).toBe(0);
    expect(last.baselineBpm).toBe(60);
    expect(last.nightsInBaseline).toBe(7);
    expect(last.reason).toBeNull();
  });
});

describe("computeNightSignalSeries — thresholds", () => {
  it("does not flag a night within normal fluctuation of the baseline", () => {
    const nights = [...stableWarmup(), makeNight({ date: dateAt(7), restingHr: 62 })]; // +2
    expect(computeNightSignalSeries(nights)[7]!.state).toBe("green");
  });

  it("flags yellow exactly at the 3 bpm threshold", () => {
    const nights = [...stableWarmup(), makeNight({ date: dateAt(7), restingHr: 63 })]; // +3
    expect(computeNightSignalSeries(nights)[7]!.state).toBe("yellow");
  });

  it("emits yellow, never red, for a single elevated night — a lone deviation is not an alarm", () => {
    const nights = [...stableWarmup(), makeNight({ date: dateAt(7), restingHr: 65 })]; // +5, over red threshold
    const last = computeNightSignalSeries(nights)[7]!;

    expect(last.state).toBe("yellow");
    expect(last.deviationBpm).toBe(5);
    expect(last.reason).toMatch(/single night/i);
  });
});

describe("computeNightSignalSeries — red requires two consecutive elevated nights", () => {
  it("escalates to red only on the second consecutive night above the red threshold", () => {
    const nights = [
      ...stableWarmup(),
      makeNight({ date: dateAt(7), restingHr: 65 }), // night 8: +5 -> yellow
      makeNight({ date: dateAt(8), restingHr: 65 }), // night 9: consecutive -> red
    ];
    const series = computeNightSignalSeries(nights);

    expect(series[7]!.state).toBe("yellow");
    expect(series[8]!.state).toBe("red");
    expect(series[8]!.reason).toContain("2 consecutive");
  });

  it("does not escalate to red when a missing night breaks the calendar streak", () => {
    const nights = [
      ...stableWarmup(),
      makeNight({ date: dateAt(7), restingHr: 65 }), // night 8: yellow
      // dateAt(8) is entirely absent from the input — a real gap, not a
      // padded/interpolated day.
      makeNight({ date: dateAt(9), restingHr: 65 }), // 2 calendar days later
    ];
    const series = computeNightSignalSeries(nights);

    expect(series[7]!.state).toBe("yellow");
    expect(series[8]!.state).toBe("yellow"); // reset, not red
  });

  it("treats a night with missing resting HR as unconfirmed and resets the streak", () => {
    const nights = [
      ...stableWarmup(),
      makeNight({ date: dateAt(7), restingHr: 65 }), // yellow
      makeNight({ date: dateAt(8), restingHr: null }), // watch off overnight
      makeNight({ date: dateAt(9), restingHr: 65 }), // elevated again, but streak reset
    ];
    const series = computeNightSignalSeries(nights);

    expect(series[8]!.state).toBeNull();
    expect(series[8]!.reason).toMatch(/not interpolated/i);
    expect(series[9]!.state).toBe("yellow");
  });

  it("treats a night with no sleep timestamps as unconfirmed even when resting HR is present", () => {
    const nights = [
      ...stableWarmup(),
      makeNight({
        date: dateAt(7),
        restingHr: 65,
        sleepStartTime: null,
        sleepEndTime: null,
      }),
    ];
    const last = computeNightSignalSeries(nights)[7]!;

    expect(last.state).toBeNull();
    expect(last.reason).toMatch(/not interpolated/i);
  });
});

describe("computeNightSignalSeries — baseline is a median, not a mean", () => {
  it("barely moves the baseline for a single outlier night among the prior 7", () => {
    const priorRhrs = [58, 59, 60, 61, 62, 63, 100]; // one big outlier
    const nights = [
      ...priorRhrs.map((v, i) => makeNight({ date: dateAt(i), restingHr: v })),
      makeNight({ date: dateAt(7), restingHr: 61 }),
    ];
    const last = computeNightSignalSeries(nights)[7]!;

    // Median of the 7 prior nights is 61 bpm; the mean (66.1) would have
    // been dragged up by the single 100 bpm outlier.
    expect(last.baselineBpm).toBe(61);
  });

  it("never lets tonight's own reading contaminate tonight's baseline", () => {
    const nights = [...stableWarmup(), makeNight({ date: dateAt(7), restingHr: 200 })];
    const last = computeNightSignalSeries(nights)[7]!;

    // Baseline must stay at the prior 7 nights' median (60), not shift
    // toward the extreme value being evaluated against it.
    expect(last.baselineBpm).toBe(60);
  });
});

describe("getLatestNightSignal", () => {
  it("returns null for an empty series", () => {
    expect(getLatestNightSignal([])).toBeNull();
  });

  it("returns the most recent night's result", () => {
    const nights = [...stableWarmup(), makeNight({ date: dateAt(7), restingHr: 60 })];
    const latest = getLatestNightSignal(nights);

    expect(latest?.date).toBe(dateAt(7));
    expect(latest?.state).toBe("green");
  });
});
