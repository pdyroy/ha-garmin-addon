import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { and, desc, eq, gte, inArray, lte, or } from "@acme/db";
import { Activity, GarminRaw, Profile } from "@acme/db/schema";
import { analyzeRunningForm } from "@acme/engine";

import { humanizeActivityName } from "../lib/humanize";
import { protectedProcedure } from "../trpc";

export interface ActivityWeather {
  tempC: number | null;
  feelsLikeC: number | null;
  humidityPct: number | null;
  windKph: number | null;
  description: string | null;
}

/**
 * Whether Garmin served this account's numbers in Fahrenheit and mph.
 *
 * The weather payload carries no units of its own — Garmin renders it in the
 * account's measurement system. That system lives in the profile settings,
 * which the sync lands under `garmin_raw['userprofile_settings']`.
 */
function isImperial(settings: unknown): boolean | null {
  if (settings == null || typeof settings !== "object") return null;
  const s = settings as Record<string, unknown>;
  const nested = s.userData;
  const system =
    s.measurementSystem ??
    (nested != null && typeof nested === "object"
      ? (nested as Record<string, unknown>).measurementSystem
      : undefined);
  if (typeof system !== "string") return null;
  return system.toLowerCase().startsWith("statute");
}

function parseWeather(
  payload: unknown,
  imperial: boolean | null,
): ActivityWeather | null {
  if (payload == null || typeof payload !== "object") return null;
  const w = payload as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const temp = num(w.temp);

  // Fallback for the first sync, before the profile settings have landed:
  // nobody runs at 45 °C, so a reading that high is Fahrenheit. It misreads a
  // cold US day (35 °F looks like a plausible 35 °C), which is exactly why it
  // is only the fallback — one sync later the real unit system is known.
  const isF = imperial ?? (temp != null && temp > 45);

  const toC = (v: number | null) =>
    v == null ? null : isF ? Math.round(((v - 32) * 5) / 9) : Math.round(v);
  const toKph = (v: number | null) =>
    v == null ? null : Math.round(isF ? v * 1.609 : v);

  const result: ActivityWeather = {
    tempC: toC(temp),
    feelsLikeC: toC(num(w.apparentTemp)),
    humidityPct: num(w.relativeHumidity),
    windKph: toKph(num(w.windSpeed)),
    description:
      typeof (w.weatherTypeDTO as Record<string, unknown> | undefined)?.desc ===
      "string"
        ? ((w.weatherTypeDTO as Record<string, unknown>).desc as string)
        : null,
  };

  return Object.values(result).every((v) => v == null) ? null : result;
}

export interface ActivitySample {
  t: number; // seconds from activity start
  hr: number | null;
  paceSecPerKm: number | null;
  altitudeM: number | null;
}

/** Metric keys we chart, mapped from Garmin's `metricDescriptors` names. */
const SAMPLE_KEYS = {
  directTimestamp: "t",
  directHeartRate: "hr",
  directSpeed: "speed",
  directElevation: "altitudeM",
} as const;

/**
 * Reshape `get_activity_details` into a compact series.
 *
 * Garmin ships the stream column-oriented: `metricDescriptors` names the
 * columns, `activityDetailMetrics[].metrics` holds one row of values each.
 * Downsampled to at most 600 points — beyond that a line chart just draws
 * the same pixels repeatedly.
 */
function parseSamples(payload: unknown): ActivitySample[] | null {
  if (payload == null || typeof payload !== "object") return null;
  const d = payload as Record<string, unknown>;
  const descriptors = d.metricDescriptors;
  const rows = d.activityDetailMetrics;
  if (
    !Array.isArray(descriptors) ||
    !Array.isArray(rows) ||
    rows.length === 0
  ) {
    return null;
  }

  const index: Partial<Record<string, number>> = {};
  for (const desc of descriptors) {
    if (desc == null || typeof desc !== "object") continue;
    const key = (desc as Record<string, unknown>).key;
    const i = (desc as Record<string, unknown>).metricsIndex;
    if (
      typeof key === "string" &&
      typeof i === "number" &&
      key in SAMPLE_KEYS
    ) {
      index[SAMPLE_KEYS[key as keyof typeof SAMPLE_KEYS]] = i;
    }
  }
  if (index.t == null) return null;

  const step = Math.max(1, Math.ceil(rows.length / 600));
  const at = (metrics: unknown[], i: number | undefined) => {
    if (i == null) return null;
    const v = metrics[i];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  const samples: ActivitySample[] = [];
  let startMs: number | null = null;
  for (let r = 0; r < rows.length; r += step) {
    const row = rows[r];
    const metrics = (row as Record<string, unknown> | undefined)?.metrics;
    if (!Array.isArray(metrics)) continue;
    const ts = at(metrics, index.t);
    if (ts == null) continue;
    startMs ??= ts;
    const speed = at(metrics, index.speed);
    samples.push({
      t: Math.round((ts - startMs) / 1000),
      hr: at(metrics, index.hr),
      // Garmin's directSpeed is m/s; the UI reads seconds per kilometre.
      paceSecPerKm:
        speed != null && speed > 0.3 ? Math.round(1000 / speed) : null,
      altitudeM: at(metrics, index.altitudeM),
    });
  }

  return samples.length > 1 ? samples : null;
}

function getDateString(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0]!;
}

// Maximum allowed offset between an Activity.startedAt and "now"
// before we treat the row as garbage and hide it. The 26-hour window:
//   - tolerates the worst real-world timezone offset (UTC+14)
//   - tolerates ±2h of normal clock skew on top of that
//   - is small enough to still hide seed-data / corrupted rows that
//     land days or weeks in the future
// See packages/api/src/router/activity.ts for the regression history
// (TZ-correctness bug in the addon's Garmin sync).
const FUTURE_ROW_HORIZON_MS = 26 * 60 * 60 * 1000;

function futureRowCutoff(): Date {
  return new Date(Date.now() + FUTURE_ROW_HORIZON_MS);
}

/**
 * Humanize raw DB sport/subtype slugs at the API boundary for UI consumers.
 * Returns a shallow copy of the provided row with transformed name fields.
 */
export function humanizeActivityRow<
  T extends { sportType?: string | null; subType?: string | null },
>(activity: T): T {
  return {
    ...activity,
    sportType: activity.sportType
      ? humanizeActivityName(activity.sportType)
      : activity.sportType,
    subType: activity.subType
      ? humanizeActivityName(activity.subType)
      : activity.subType,
  };
}

export const activityRouter = {
  list: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(365).default(30),
        sportType: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      const conditions = [
        eq(Activity.userId, userId),
        gte(Activity.startedAt, since),
        // Hide implausibly-future rows. We previously used `new Date()`
        // which collided with a TZ-correctness bug in the addon's sync
        // (startTimeLocal stored as UTC for AEST users → morning
        // workouts timestamped ~10h in the future and silently
        // disappeared from the home page until the wall clock caught
        // up). Widen the horizon by ~26h so a sync regression like
        // that fails loudly (we see a future date) instead of hiding
        // data. The addon fix lands in v0.16.22; this guardrail stays
        // so a future timezone regression can't reintroduce silent
        // data-loss.
        lte(Activity.startedAt, futureRowCutoff()),
      ];

      if (input.sportType) {
        conditions.push(eq(Activity.sportType, input.sportType));
      }

      const activities = await ctx.db.query.Activity.findMany({
        where: and(...conditions),
        orderBy: desc(Activity.startedAt),
        limit: 50,
        columns: {
          id: true,
          sportType: true,
          subType: true,
          startedAt: true,
          durationMinutes: true,
          distanceMeters: true,
          avgHr: true,
          strainScore: true,
          vo2maxEstimate: true,
          avgPaceSecPerKm: true,
          calories: true,
          aerobicTE: true,
          anaerobicTE: true,
          avgPower: true,
          normalizedPower: true,
        },
      });

      // Hide tiny incidental activities (< 10 min AND < 500 m). Garmin's
      // auto-detected "phantom walks" otherwise dominate the list and
      // bury real workouts (#158). Same filter as `getRecent` above.
      return activities
        .filter(
          (a) =>
            (a.durationMinutes ?? 0) >= 10 || (a.distanceMeters ?? 0) >= 500,
        )
        .map(humanizeActivityRow);
    }),

  getDetail: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const activity = await ctx.db.query.Activity.findFirst({
        where: and(eq(Activity.id, input.id), eq(Activity.userId, userId)),
      });

      if (!activity) {
        return null;
      }

      const profile = await ctx.db.query.Profile.findFirst({
        where: eq(Profile.userId, userId),
      });

      let runningFormScore = null;
      if (activity.sportType?.toLowerCase().includes("run")) {
        runningFormScore = analyzeRunningForm(
          activity.avgGroundContactTime,
          activity.verticalOscillation,
          activity.strideLength,
          activity.gctBalance,
          activity.avgCadence,
          profile?.heightCm ?? null,
          activity.verticalRatio,
        );
      }

      // Detail Garmin serves per activity but that has no column of its own:
      // it lands raw in garmin_raw (see rootfs/app/scripts/garmin-sync.py) and
      // is reshaped here rather than duplicated into the Activity table.
      const rawRows = await ctx.db
        .select({ endpoint: GarminRaw.endpoint, payload: GarminRaw.payload })
        .from(GarminRaw)
        .where(
          and(
            eq(GarminRaw.userId, userId),
            or(
              // Weather carries no units of its own; the profile settings say
              // which system Garmin rendered it in.
              and(
                eq(GarminRaw.scopeKey, "latest"),
                eq(GarminRaw.endpoint, "userprofile_settings"),
              ),
              activity.garminActivityId
                ? and(
                    eq(GarminRaw.scopeKey, activity.garminActivityId),
                    inArray(GarminRaw.endpoint, [
                      "activity_weather",
                      "activity_details",
                    ]),
                  )
                : undefined,
            ),
          ),
        );

      const rawByEndpoint = new Map(
        rawRows.map((r) => [r.endpoint, r.payload]),
      );
      const imperial = isImperial(rawByEndpoint.get("userprofile_settings"));

      return humanizeActivityRow({
        ...activity,
        runningFormScore,
        weather: parseWeather(rawByEndpoint.get("activity_weather"), imperial),
        samples: parseSamples(rawByEndpoint.get("activity_details")),
      });
    }),

  getRecent: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Hide implausibly-future activities. The 26-hour window
    // protects against the TZ-correctness regression that used to
    // hide AEST morning workouts (see `list` above for details)
    // while still excluding actual clock-skew / seed-data anomalies.
    //
    // We over-fetch (15) then filter client-side for the home page
    // top-3 so auto-detected micro-activities (Garmin's "incidental"
    // 1-minute walks etc.) don't push the user's real workout out
    // of the carousel. See issue #143.
    const activities = await ctx.db.query.Activity.findMany({
      where: and(
        eq(Activity.userId, userId),
        lte(Activity.startedAt, futureRowCutoff()),
      ),
      orderBy: desc(Activity.startedAt),
      limit: 15,
      columns: {
        id: true,
        sportType: true,
        subType: true,
        startedAt: true,
        durationMinutes: true,
        distanceMeters: true,
        avgHr: true,
        strainScore: true,
        calories: true,
      },
    });

    // Hide tiny incidental activities (< 10 min AND < 500 m) so a real
    // workout always surfaces on the home carousel. If everything we
    // have is "incidental", fall back to the raw list rather than
    // showing nothing.
    const meaningful = activities.filter(
      (a) => (a.durationMinutes ?? 0) >= 10 || (a.distanceMeters ?? 0) >= 500,
    );
    return (meaningful.length > 0 ? meaningful : activities)
      .slice(0, 5)
      .map(humanizeActivityRow);
  }),
} satisfies TRPCRouterRecord;
