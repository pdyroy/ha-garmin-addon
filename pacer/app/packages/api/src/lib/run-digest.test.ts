// SPDX-FileCopyrightText: 2026 Pacer
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import type { RunDigestSource } from "./run-digest";
import {
  buildRunDigest,
  detectPerMinuteWanted,
  detectRunDetailIntent,
  parsePerMinuteSeries,
  parseRunTarget,
} from "./run-digest";

describe("detectRunDetailIntent", () => {
  it("detects cadence/SPM questions", () => {
    expect(
      detectRunDetailIntent("Wie war meine SPM im letzten Lauf?")
        .wantsRunDetail,
    ).toBe(true);
    expect(
      detectRunDetailIntent("Analysiere meine Trittfrequenz").wantsRunDetail,
    ).toBe(true);
  });

  it("detects splits / interval questions", () => {
    expect(
      detectRunDetailIntent("Zeig mir die Splits vom gestrigen Run")
        .wantsRunDetail,
    ).toBe(true);
    expect(
      detectRunDetailIntent("Wie waren meine Intervalle?").wantsRunDetail,
    ).toBe(true);
  });

  it("detects running-form / efficiency questions", () => {
    expect(
      detectRunDetailIntent("Wie sieht meine Laufeffizienz aus?")
        .wantsRunDetail,
    ).toBe(true);
    expect(
      detectRunDetailIntent("Was war meine Ground Contact Time?")
        .wantsRunDetail,
    ).toBe(true);
  });

  it("detects a run named by weekday", () => {
    expect(
      detectRunDetailIntent("Wie war mein Lauf am Sonntag?").wantsRunDetail,
    ).toBe(true);
    expect(
      detectRunDetailIntent("Besprich den Sonntagslauf").wantsRunDetail,
    ).toBe(true);
  });

  it("detects a run named by date", () => {
    expect(
      detectRunDetailIntent("Wie war mein Lauf vom 06.09.?").wantsRunDetail,
    ).toBe(true);
    expect(
      detectRunDetailIntent("Lauf am 06.09.2026 analisieren").wantsRunDetail,
    ).toBe(true);
  });

  it("does not fire on generic questions", () => {
    expect(
      detectRunDetailIntent("Guten Morgen, wie geht's?").wantsRunDetail,
    ).toBe(false);
    expect(detectRunDetailIntent("Was ist meine VO2max?").wantsRunDetail).toBe(
      false,
    );
  });

  it("empty message is safe", () => {
    expect(detectRunDetailIntent("")).toEqual({
      wantsRunDetail: false,
      wantsPerMinute: false,
    });
    expect(detectRunDetailIntent(undefined as unknown as string)).toEqual({
      wantsRunDetail: false,
      wantsPerMinute: false,
    });
  });
});

describe("detectPerMinuteWanted", () => {
  it("detects minute-level requests", () => {
    expect(detectPerMinuteWanted("Zeig mir minutenweise meine HR")).toBe(true);
    expect(detectPerMinuteWanted("Ab der 5. Minute?")).toBe(true);
    expect(detectPerMinuteWanted("Minütlichen HR werten")).toBe(true);
    expect(detectPerMinuteWanted("minütliche Herzfrequenz")).toBe(true);
  });

  it("does not fire unless run-detail intent also active", () => {
    const r = detectRunDetailIntent("Minutenweise bitte");
    expect(r.wantsPerMinute).toBe(false);
  });
});

describe("parseRunTarget", () => {
  it("resolves a weekday to the most recent occurrence", () => {
    // 2026-09-06 is a Sunday. "am sonntag" should point to the last Sunday.
    const t = parseRunTarget("Wie war mein Lauf am Sonntag?", "Europe/Berlin");
    expect(t.type).toBe("weekday");
    if (t.type === "weekday") {
      expect(t.weekday.toLowerCase()).toBe("sonntag");
      expect(t.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("resolves a D.MM.YYYY date to ISO", () => {
    const t = parseRunTarget("Lauf vom 06.09.2026", "Europe/Berlin");
    expect(t).toEqual({ type: "date", day: "2026-09-06" });
  });

  it("resolves a short D.MM. date to the current year", () => {
    const t = parseRunTarget("Lauf am 6.9.", "Europe/Berlin");
    expect(t.type).toBe("date");
    if (t.type === "date") {
      expect(t.day).toMatch(/^\d{4}-09-06$/);
    }
  });

  it("resolves a compound weekday run noun", () => {
    const t = parseRunTarget("Besprich den Sonntagslauf", "Europe/Berlin");
    expect(t.type).toBe("weekday");
    if (t.type === "weekday") expect(t.weekday.toLowerCase()).toBe("sonntag");
  });

  it("falls back to latest when no day is named", () => {
    expect(
      parseRunTarget("Wie ist mein Training heute?", "Europe/Berlin"),
    ).toEqual({
      type: "latest",
    });
  });

  it("handles empty message", () => {
    expect(parseRunTarget("", "Europe/Berlin")).toEqual({ type: "latest" });
  });
});

describe("parsePerMinuteSeries", () => {
  const payload = {
    metricDescriptors: [
      { key: "directTimestamp", metricsIndex: 0 },
      { key: "directHeartRate", metricsIndex: 1 },
      { key: "directSpeed", metricsIndex: 2 },
    ],
    activityDetailMetrics: [
      { metrics: [0, 120, 3.0] },
      { metrics: [60_000, 125, 3.1] },
      { metrics: [120_000, 130, 3.2] },
      { metrics: [179_000, 131, 3.0] },
    ],
  };

  it("returns one row per minute with HR and pace", () => {
    const out = parsePerMinuteSeries(payload);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(3);
    expect(out![0]).toMatchObject({
      t: 0,
      hr: 120,
      secPerKm: Math.round(1000 / 3.0),
    });
    expect(out![1]).toMatchObject({
      t: 60,
      hr: 125,
      secPerKm: Math.round(1000 / 3.1),
    });
    expect(out![2]).toMatchObject({
      t: 120,
      hr: 130,
      secPerKm: Math.round(1000 / 3.2),
    });
  });

  it("returns null on malformed payload", () => {
    expect(parsePerMinuteSeries(null)).toBeNull();
    expect(
      parsePerMinuteSeries({
        metricDescriptors: [],
        activityDetailMetrics: [],
      }),
    ).toBeNull();
  });
});

describe("buildRunDigest", () => {
  const base: RunDigestSource = {
    startedAt: "2026-08-14T08:00:00.000Z",
    sportType: "running",
    durationMinutes: 50,
    distanceMeters: 9_000,
    avgPaceSecPerKm: 333,
    avgHr: 148,
    maxHr: 172,
    avgCadence: null,
    maxCadence: null,
    elevationGain: 120,
    avgGroundContactTime: null,
    gctBalance: null,
    verticalOscillation: null,
    verticalRatio: null,
    strideLength: null,
    avgRespirationRate: null,
    hrZoneMinutes: { zone1: 5, zone2: 20, zone3: 15, zone4: 8, zone5: 2 },
    laps: [
      { distanceMeters: 1000, durationSeconds: 330, avgHr: 140 },
      { distanceMeters: 1000, durationSeconds: 336, avgHr: 150 },
      { distanceMeters: 1000, durationSeconds: 340, avgHr: 155 },
      { distanceMeters: 1000, durationSeconds: 344, avgHr: 158 },
    ],
  };

  it("renders header, splits and HR zones", () => {
    const text = buildRunDigest(base);
    expect(text).toContain("Running");
    expect(text).toContain("50 min");
    expect(text).toContain("9.0 km");
    expect(text).toContain("HR 148");
    expect(text).toContain("Splits:");
    expect(text).toContain("HR drift (2nd vs 1st half): +12");
    expect(text).toContain("Z2 40.0%");
  });

  it("renders running-form lines when score provided", () => {
    const source: RunDigestSource = {
      ...base,
      avgGroundContactTime: 210,
      verticalOscillation: 6.5,
      strideLength: 1.2,
      gctBalance: 50.5,
      avgCadence: 180,
    };
    const text = buildRunDigest(source);
    expect(text).toContain("Cadence: 180 spm");
    expect(text).toContain("Ground contact time");
    expect(text).toContain("Stride length");
  });

  it("renders downsampled per-minute curve when requested", () => {
    const perMinute = [
      { t: 0, hr: 140, secPerKm: 320 },
      { t: 60, hr: 145, secPerKm: 330 },
      { t: 120, hr: 150, secPerKm: 340 },
    ];
    const text = buildRunDigest(base, {
      includePerMinute: true,
      perMinuteHr: perMinute,
      perMinutePace: perMinute,
    });
    expect(text).toContain("Per-minute curve");
    expect(text).toContain("0:140:5:20");
  });

  it("omits per-minute curve when not requested", () => {
    const perMinute = [{ t: 0, hr: 140, secPerKm: 320 }];
    const text = buildRunDigest(base, {
      includePerMinute: false,
      perMinuteHr: perMinute,
    });
    expect(text).not.toContain("Per-minute curve");
  });
});
