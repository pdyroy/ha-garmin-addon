import { describe, expect, it } from "vitest";

import { computeEnergyBank } from "../index";

/** 2026-01-07 at the given UTC hour:minute, epoch millis. */
function at(hour: number, minute = 0): number {
  return Date.UTC(2026, 0, 7, hour, minute);
}

/** A day: charges overnight to 90, drains 25 across a midday run, ends at 40. */
function syntheticDay(): [number, number][] {
  return [
    [at(0), 30],
    [at(3), 60],
    [at(6), 90], // +60 overnight
    [at(9), 80], // -10 morning
    [at(12), 75], // -5 midday, before the run
    [at(13), 50], // -25 across the run
    [at(18), 45], // -5 afternoon
    [at(22), 40], // -5 evening
  ];
}

const RUN = {
  id: "run-1",
  label: "Lauf",
  startTs: at(12, 5),
  endTs: at(13),
};

describe("computeEnergyBank", () => {
  it("attributes every step, so the segments sum to the net change", () => {
    const result = computeEnergyBank({
      bodyBattery: syntheticDay(),
      activities: [RUN],
      sleepStartTime: "23:00",
      sleepEndTime: "06:30",
    });
    const out = result.value!;
    const sum = [...out.charges, ...out.drains].reduce(
      (acc, s) => acc + s.delta,
      0,
    );
    expect(sum).toBeCloseTo(out.net, 5);
    expect(out.net).toBe(10); // 40 - 30
  });

  it("credits the run's drain to the run, not to the midday block", () => {
    const out = computeEnergyBank({
      bodyBattery: syntheticDay(),
      activities: [RUN],
      sleepStartTime: "23:00",
      sleepEndTime: "06:30",
    }).value!;
    const run = out.drains.find((s) => s.key === "activity:run-1");
    expect(run?.delta).toBe(-25);
    expect(run?.source).toBe("activity");
    // Biggest drain of the day ranks first.
    expect(out.drains[0]?.key).toBe("activity:run-1");
  });

  it("labels the overnight recharge as sleep when a sleep window is given", () => {
    const out = computeEnergyBank({
      bodyBattery: syntheticDay(),
      activities: [RUN],
      sleepStartTime: "23:00",
      sleepEndTime: "06:30",
    }).value!;
    const sleep = out.charges.find((s) => s.key === "sleep");
    expect(sleep?.delta).toBe(60);
    expect(out.charges[0]?.source).toBe("sleep");
  });

  it("falls back to day blocks without a sleep window", () => {
    const out = computeEnergyBank({
      bodyBattery: syntheticDay(),
      activities: [RUN],
    }).value!;
    expect(out.charges.some((s) => s.source === "sleep")).toBe(false);
    expect(out.charges.map((s) => s.key)).toContain("day:night");
  });

  it("reads clock time in the requested timezone", () => {
    // 06:00 UTC is 07:00 in Berlin — morning there, still night in UTC+0
    // only if the window says so. Use a window that only matches in Berlin.
    const series: [number, number][] = [
      [at(5), 50],
      [at(6), 70],
    ];
    const utc = computeEnergyBank({
      bodyBattery: series,
      sleepStartTime: "06:30",
      sleepEndTime: "08:00",
    }).value!;
    const berlin = computeEnergyBank({
      bodyBattery: series,
      timezone: "Europe/Berlin",
      sleepStartTime: "06:30",
      sleepEndTime: "08:00",
    }).value!;
    expect(utc.charges[0]?.source).toBe("day");
    expect(berlin.charges[0]?.source).toBe("sleep");
  });

  it("reports peak, trough and mean stress per segment", () => {
    const out = computeEnergyBank({
      bodyBattery: syntheticDay(),
      stress: [
        [at(12, 30), 60],
        [at(13), 80],
        [at(18), 20],
      ],
      activities: [RUN],
    }).value!;
    expect(out.peak.value).toBe(90);
    expect(out.trough.value).toBe(30);
    expect(out.drains.find((s) => s.key === "activity:run-1")?.meanStress).toBe(
      70,
    );
  });

  it("drops sub-point wiggles instead of naming them", () => {
    const out = computeEnergyBank({
      bodyBattery: [
        [at(9), 50],
        [at(10), 49.5],
        [at(14), 30],
      ],
    }).value!;
    expect(out.drains.map((s) => s.key)).toEqual(["day:afternoon"]);
  });

  it("refuses a series it cannot difference", () => {
    expect(computeEnergyBank({ bodyBattery: [] }).value).toBeNull();
    expect(computeEnergyBank({ bodyBattery: [[at(9), 50]] }).value).toBeNull();
    expect(computeEnergyBank({ bodyBattery: [] }).reason).toContain(
      "at least 2",
    );
  });
});
