import { describe, expect, it } from "vitest";

import type { DailyMetricInput } from "../types";
import { computeSleepWindow } from "../sleep-coach";

function night(date: string, sleepEndTime: string | null): DailyMetricInput {
  return {
    date,
    sleepScore: null,
    totalSleepMinutes: 450,
    deepSleepMinutes: null,
    remSleepMinutes: null,
    lightSleepMinutes: null,
    awakeMinutes: null,
    hrv: null,
    restingHr: null,
    stressScore: null,
    bodyBatteryStart: null,
    bodyBatteryEnd: null,
    steps: null,
    sleepStartTime: null,
    sleepEndTime,
  } as unknown as DailyMetricInput;
}

const WEEK = [
  night("2026-01-07", "06:30"),
  night("2026-01-06", "06:20"),
  night("2026-01-05", "06:40"),
  night("2026-01-04", "06:30"),
  night("2026-01-03", "06:35"),
];

describe("computeSleepWindow", () => {
  it("puts bedtime a sleep need plus onset latency before the habitual wake", () => {
    const result = computeSleepWindow({
      recentMetrics: WEEK,
      sleepNeedMinutes: 480,
      sleepDebtMinutes: 0,
    });
    // Median wake 06:30, minus 8h, minus 15 min onset latency.
    expect(result.value?.targetWakeTime).toBe("06:30");
    expect(result.value?.targetBedtime).toBe("22:15");
    expect(result.value?.anchor).toBe("habit");
    expect(result.value?.debtPaybackMinutes).toBe(0);
  });

  it("caps debt payback at 30 minutes", () => {
    const result = computeSleepWindow({
      recentMetrics: WEEK,
      sleepNeedMinutes: 480,
      sleepDebtMinutes: 90,
    });
    expect(result.value?.debtPaybackMinutes).toBe(30);
    expect(result.value?.targetBedtime).toBe("21:45"); // 30 earlier, not 90
  });

  it("centres the night on MSFsc when a chronotype is known", () => {
    const result = computeSleepWindow({
      recentMetrics: WEEK,
      sleepNeedMinutes: 480,
      sleepDebtMinutes: 0,
      msfScMinutes: 4 * 60, // mid-sleep 04:00
    });
    expect(result.value?.anchor).toBe("chronotype");
    expect(result.value?.targetWakeTime).toBe("08:00");
    expect(result.value?.targetBedtime).toBe("23:45");
  });

  it("wraps a bedtime that falls after midnight", () => {
    const result = computeSleepWindow({
      recentMetrics: WEEK,
      sleepNeedMinutes: 300,
      sleepDebtMinutes: 0,
    });
    expect(result.value?.targetBedtime).toBe("01:15");
  });

  it("returns a ±20 min wake window", () => {
    const result = computeSleepWindow({
      recentMetrics: WEEK,
      sleepNeedMinutes: 480,
      sleepDebtMinutes: 0,
    });
    expect(result.value?.wakeWindowStart).toBe("06:10");
    expect(result.value?.wakeWindowEnd).toBe("06:50");
  });

  it("takes the circular median across midnight, not the arithmetic one", () => {
    const nightShift = [
      night("2026-01-07", "23:50"),
      night("2026-01-06", "00:10"),
      night("2026-01-05", "00:00"),
      night("2026-01-04", "23:55"),
    ];
    const result = computeSleepWindow({
      recentMetrics: nightShift,
      sleepNeedMinutes: 480,
      sleepDebtMinutes: 0,
    });
    expect(result.value?.targetWakeTime).toBe("23:58"); // not ~12:00
  });

  it("refuses to guess below quorum", () => {
    const result = computeSleepWindow({
      recentMetrics: [night("2026-01-07", "06:30")],
      sleepNeedMinutes: 480,
      sleepDebtMinutes: 0,
    });
    expect(result.value).toBeNull();
    expect(result.reason).toContain("1 night");
  });

  it("refuses without a sleep need", () => {
    expect(
      computeSleepWindow({
        recentMetrics: WEEK,
        sleepNeedMinutes: 0,
        sleepDebtMinutes: 0,
      }).value,
    ).toBeNull();
  });
});
