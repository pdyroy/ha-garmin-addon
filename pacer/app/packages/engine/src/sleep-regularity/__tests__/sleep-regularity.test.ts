import { describe, expect, it } from "vitest";

import type { DailyMetricInput } from "../../types";
import {
  computeBedtimeVariability,
  computeChronotype,
  computeSleepMidpointVariability,
  computeSleepRegularityIndex,
  defaultIsFreeDay,
} from "..";

// Helper to create a metric with defaults, mirroring readiness.test.ts's makeMetric.
function makeMetric(overrides: Partial<DailyMetricInput> = {}): DailyMetricInput {
  return {
    date: "2026-03-15",
    sleepScore: null,
    totalSleepMinutes: null,
    deepSleepMinutes: null,
    remSleepMinutes: null,
    lightSleepMinutes: null,
    awakeMinutes: null,
    hrv: null,
    restingHr: null,
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
    sleepStartTime: null,
    sleepEndTime: null,
    sleepNeedMinutes: null,
    sleepDebtMinutes: null,
    ...overrides,
  };
}

/** 2024-01-01 is a Monday (UTC), so offsets give known weekdays. */
function dateAt(offsetDays: number): string {
  const d = new Date(Date.UTC(2024, 0, 1) + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function nightsFrom(
  count: number,
  bedtime: string,
  waketime: string,
): DailyMetricInput[] {
  return Array.from({ length: count }, (_, i) =>
    makeMetric({
      date: dateAt(i),
      sleepStartTime: bedtime,
      sleepEndTime: waketime,
    }),
  );
}

// ---------------------------------------------------------------------------
// computeSleepRegularityIndex
// ---------------------------------------------------------------------------

describe("computeSleepRegularityIndex", () => {
  it("scores a perfectly regular 15-night pattern at +100", () => {
    const records = nightsFrom(15, "23:00", "07:00");
    const result = computeSleepRegularityIndex(records);
    expect(result.value).not.toBeNull();
    expect(result.value!.sri).toBe(100);
    expect(result.value!.validPairs).toBe(14);
    expect(result.value!.nightsUsed).toBe(15);
  });

  it("scores a strictly alternating bedtime pattern well below 100", () => {
    const records = Array.from({ length: 15 }, (_, i) =>
      makeMetric({
        date: dateAt(i),
        sleepStartTime: i % 2 === 0 ? "23:00" : "01:00",
        sleepEndTime: i % 2 === 0 ? "07:00" : "09:00",
      }),
    );
    const result = computeSleepRegularityIndex(records);
    expect(result.value).not.toBeNull();
    expect(result.value!.sri).toBeCloseTo(66.67, 1);
  });

  it("a missing night breaks BOTH pairs it would touch, not just one", () => {
    // 15 regular nights, but Jan 8 (day index 7) is dropped entirely.
    const records = nightsFrom(15, "23:00", "07:00").filter(
      (r) => r.date !== dateAt(7),
    );
    // 14 nights remain; without the gap that would be 13 pairs, but the
    // missing night breaks both its neighboring links, leaving 12.
    const result = computeSleepRegularityIndex(records, { minValidPairs: 1 });
    expect(result.value).not.toBeNull();
    expect(result.value!.validPairs).toBe(12);
    // The remaining pairs are still perfectly regular.
    expect(result.value!.sri).toBe(100);
  });

  it("returns null with a reason when fewer than the default 14 valid pairs exist", () => {
    const records = nightsFrom(5, "23:00", "07:00"); // only 4 pairs
    const result = computeSleepRegularityIndex(records);
    expect(result.value).toBeNull();
    if (result.value === null) {
      expect(result.reason).toContain("4");
      expect(result.reason).toContain("14");
    }
  });

  it("treats a night with an unparsable time string as missing, not as data", () => {
    const records = nightsFrom(15, "23:00", "07:00");
    records[7] = { ...records[7]!, sleepStartTime: "not-a-time" };
    const result = computeSleepRegularityIndex(records, { minValidPairs: 1 });
    expect(result.value).not.toBeNull();
    expect(result.value!.validPairs).toBe(12); // same effect as a missing night
  });

  it("ignores an unrelated night more than a day away (no false pairing)", () => {
    const records = [
      makeMetric({ date: "2024-01-01", sleepStartTime: "23:00", sleepEndTime: "07:00" }),
      makeMetric({ date: "2024-02-15", sleepStartTime: "23:00", sleepEndTime: "07:00" }),
    ];
    const result = computeSleepRegularityIndex(records, { minValidPairs: 0 });
    expect(result.value).not.toBeNull();
    expect(result.value!.validPairs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeBedtimeVariability
// ---------------------------------------------------------------------------

describe("computeBedtimeVariability", () => {
  it("returns SD 0 for identical bedtimes", () => {
    const records = nightsFrom(5, "23:00", "07:00");
    const result = computeBedtimeVariability(records);
    expect(result.value).not.toBeNull();
    expect(result.value!.sdMinutes).toBe(0);
    expect(result.value!.meanClockMinutes).toBe(23 * 60);
    expect(result.value!.nightsUsed).toBe(5);
  });

  it("averages bedtimes either side of midnight correctly (the classic bug)", () => {
    // 23:45, 00:15, 23:45, 00:15, 23:45 — a naive mean of raw clock minutes
    // (1425, 15, 1425, 15, 1425) would give ~12:00. The true circular
    // average is ~23:57, close to both inputs, with a small SD.
    const records = ["23:45", "00:15", "23:45", "00:15", "23:45"].map(
      (t, i) => makeMetric({ date: dateAt(i), sleepStartTime: t }),
    );
    const result = computeBedtimeVariability(records);
    expect(result.value).not.toBeNull();
    expect(result.value!.meanClockMinutes).toBe(23 * 60 + 57); // 23:57
    expect(result.value!.sdMinutes).toBeCloseTo(16.43, 2);
  });

  it("ignores nights with no bedtime and counts only the usable ones", () => {
    const records = [
      ...nightsFrom(5, "23:00", "07:00"),
      makeMetric({ date: dateAt(5), sleepStartTime: null }),
      makeMetric({ date: dateAt(6), sleepStartTime: null }),
    ];
    const result = computeBedtimeVariability(records);
    expect(result.value).not.toBeNull();
    expect(result.value!.nightsUsed).toBe(5);
  });

  it("returns null with a reason under the default quorum of 5", () => {
    const records = nightsFrom(3, "23:00", "07:00");
    const result = computeBedtimeVariability(records);
    expect(result.value).toBeNull();
    if (result.value === null) expect(result.reason).toContain("3");
  });
});

// ---------------------------------------------------------------------------
// computeSleepMidpointVariability
// ---------------------------------------------------------------------------

describe("computeSleepMidpointVariability", () => {
  it("returns SD 0 and the correct midpoint for a consistent 8h schedule", () => {
    const records = nightsFrom(5, "23:00", "07:00");
    const result = computeSleepMidpointVariability(records);
    expect(result.value).not.toBeNull();
    expect(result.value!.sdMinutes).toBe(0);
    expect(result.value!.meanClockMinutes).toBe(3 * 60); // midpoint 03:00
  });

  it("correctly averages a cluster of midpoints that straddle midnight", () => {
    // Midpoints (23:00, 22:00-00:00, 00:00-02:00) are 00:00, 23:00, 01:00 —
    // tightly clustered around midnight. A naive mean of raw clock minutes
    // (0, 1380, 60) would give ~08:00; the true circular center is ~00:00.
    const records = [
      makeMetric({ date: dateAt(0), sleepStartTime: "23:00", sleepEndTime: "01:00" }),
      makeMetric({ date: dateAt(1), sleepStartTime: "22:00", sleepEndTime: "00:00" }),
      makeMetric({ date: dateAt(2), sleepStartTime: "00:00", sleepEndTime: "02:00" }),
    ];
    const result = computeSleepMidpointVariability(records, { minNights: 3 });
    expect(result.value).not.toBeNull();
    expect(result.value!.meanClockMinutes).toBe(0);
    expect(result.value!.sdMinutes).toBe(60);
  });

  it("returns null with a reason under quorum", () => {
    const records = nightsFrom(2, "23:00", "07:00");
    const result = computeSleepMidpointVariability(records);
    expect(result.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeChronotype
// ---------------------------------------------------------------------------

describe("computeChronotype", () => {
  it("computes MSF, sleep-debt-corrected MSFsc, and social jetlag with the default weekend split", () => {
    // 3 weeks: workdays 23:00-06:00 (7h), weekends 00:00-09:00 (9h) —
    // free-day sleep runs longer than the week average, so MSFsc corrects
    // earlier than raw MSF.
    const records = Array.from({ length: 21 }, (_, i) => {
      const date = dateAt(i);
      const isFree = defaultIsFreeDay(date);
      return makeMetric({
        date,
        sleepStartTime: isFree ? "00:00" : "23:00",
        sleepEndTime: isFree ? "09:00" : "06:00",
      });
    });

    const result = computeChronotype(records);
    expect(result.value).not.toBeNull();
    const v = result.value!;
    expect(v.freeDaysUsed).toBe(6);
    expect(v.workDaysUsed).toBe(15);
    expect(v.msfMinutes).toBe(4 * 60 + 30); // 04:30
    expect(v.msfScMinutes).toBe(3 * 60 + 47); // 03:47, pulled earlier than MSF
    expect(v.msfScMinutes).toBeLessThan(v.msfMinutes);
    expect(v.socialJetlagMinutes).toBe(120); // 2h
  });

  it("does not correct MSFsc when free-day sleep duration doesn't exceed the week average", () => {
    const records = Array.from({ length: 21 }, (_, i) =>
      makeMetric({
        date: dateAt(i),
        sleepStartTime: "23:00",
        sleepEndTime: "07:00",
      }),
    );
    const result = computeChronotype(records);
    expect(result.value).not.toBeNull();
    expect(result.value!.msfScMinutes).toBe(result.value!.msfMinutes);
    expect(result.value!.socialJetlagMinutes).toBe(0);
  });

  it("honors a caller-supplied predicate instead of hardcoding weekends (Saturday race)", () => {
    // Treat Monday as the only "free" day — proves the split isn't baked in.
    const isMondayFree = (date: string) =>
      new Date(`${date}T00:00:00Z`).getUTCDay() === 1;

    const records = Array.from({ length: 21 }, (_, i) =>
      makeMetric({
        date: dateAt(i),
        sleepStartTime: "23:00",
        sleepEndTime: "07:00",
      }),
    );

    const result = computeChronotype(records, isMondayFree);
    expect(result.value).not.toBeNull();
    expect(result.value!.freeDaysUsed).toBe(3); // 3 Mondays in 21 days
    expect(result.value!.workDaysUsed).toBe(18);
  });

  it("returns null with a reason when free or work days are under quorum", () => {
    const records = [
      makeMetric({ date: "2024-01-06", sleepStartTime: "00:00", sleepEndTime: "08:00" }), // Sat
      makeMetric({ date: "2024-01-01", sleepStartTime: "23:00", sleepEndTime: "07:00" }), // Mon
      makeMetric({ date: "2024-01-02", sleepStartTime: "23:00", sleepEndTime: "07:00" }), // Tue
    ];
    const result = computeChronotype(records);
    expect(result.value).toBeNull();
    if (result.value === null) {
      expect(result.reason).toContain("1 free-day night");
      expect(result.reason).toContain("2 workday night");
    }
  });
});

// ---------------------------------------------------------------------------
// defaultIsFreeDay
// ---------------------------------------------------------------------------

describe("defaultIsFreeDay", () => {
  it("treats Saturday and Sunday as free, weekdays as not", () => {
    expect(defaultIsFreeDay("2024-01-06")).toBe(true); // Sat
    expect(defaultIsFreeDay("2024-01-07")).toBe(true); // Sun
    expect(defaultIsFreeDay("2024-01-01")).toBe(false); // Mon
    expect(defaultIsFreeDay("2024-01-05")).toBe(false); // Fri
  });
});
