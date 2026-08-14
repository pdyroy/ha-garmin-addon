"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@acme/ui";

import { IngressLink as Link } from "~/app/_components/ingress-link";
import { formatDateInTz, useUserTimezone } from "~/lib/format-date";
import { fmtNum } from "~/lib/format-number";
import { useTRPC } from "~/trpc/react";
import { PageShell } from "~/components/page-shell";
import { BottomNav } from "../_components/bottom-nav";
import { DateRangeSelector } from "../_components/date-range-selector";
import { SectionHeader } from "../_components/info-button";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert minutes to "Xh Ym" display string */
function fmtDuration(minutes: number | null | undefined): string {
  if (minutes == null || isNaN(minutes)) return "—";
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.round(Math.abs(minutes) % 60);
  const sign = minutes < 0 ? "-" : "";
  if (h === 0) return `${sign}${m}m`;
  return `${sign}${h}h ${m.toString().padStart(2, "0")}m`;
}

/** Convert minutes to decimal hours for chart Y-axis */
function minToHours(min: number | null | undefined): number | null {
  if (min == null) return null;
  return +(min / 60).toFixed(2);
}

/** Format a date string as short day name or "Mon D" depending on range */
function fmtDateShort(
  iso: string,
  totalDays: number,
  timezone: string,
): string {
  if (totalDays <= 7) {
    return formatDateInTz(iso, timezone, { weekday: "short" });
  }
  return formatDateInTz(iso, timezone, { month: "short", day: "numeric" });
}

/** Format a clock time given as minutes-from-midnight (or decimal hours), German 24h style */
function fmtClockTime(minutesFromMidnight: number | null | undefined): string {
  if (minutesFromMidnight == null || isNaN(minutesFromMidnight)) return "—";
  // Handle negative values (before midnight) by wrapping
  const mins = ((minutesFromMidnight % 1440) + 1440) % 1440;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")} Uhr`;
}

/** Simple moving average over an array of numbers */
function movingAvg(arr: (number | null)[], window: number): (number | null)[] {
  return arr.map((_, i) => {
    if (i < window - 1) return null;
    const slice = arr
      .slice(i - window + 1, i + 1)
      .filter((v): v is number => v != null);
    if (slice.length < Math.ceil(window / 2)) return null;
    return +(slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(1);
  });
}

/**
 * Chart color for a sleep-debt value, escalating along the theme's
 * sequential chart ramp and landing on the destructive token once debt is
 * genuinely concerning (theme tokens only — no hardcoded hex).
 */
function debtColor(debt: number): string {
  if (debt < 30) return "var(--chart-4)";
  if (debt < 60) return "var(--chart-2)";
  return "var(--destructive)";
}

/** Tailwind text color (theme tokens only) matching debtColor's severity */
function debtTextColor(debt: number): string {
  if (debt < 30) return "text-muted-foreground";
  if (debt < 60) return "text-foreground";
  return "text-destructive";
}

/** Badge background+text for the debt pill (theme tokens only) */
function debtBadgeClass(debt: number): string {
  if (debt < 30) return "bg-muted text-muted-foreground";
  if (debt < 60) return "bg-muted text-foreground";
  return "bg-destructive/10 text-destructive";
}

// Shared recharts styling pulled from theme tokens instead of hardcoded hex.
const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 };
const AXIS_LABEL_STYLE = { fill: "var(--muted-foreground)", fontSize: 10 };
const GRID_STROKE = "var(--border)";
const AXIS_LINE = { stroke: "var(--border)" };
const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: "var(--muted-foreground)" },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SleepDashboard() {
  const trpc = useTRPC();
  const timezone = useUserTimezone();
  const [sleepDays, setSleepDays] = useState(28);

  // ---- Data queries ----
  const coach = useQuery(trpc.sleep.getCoach.queryOptions());

  // Surface coach data early so it can be referenced by derived data
  // (e.g. debt chart fallback) declared further down.
  const coachData = coach.data as
    | {
        recommendedDurationMinutes: number;
        recommendedBedtime: string;
        sleepDebtMinutes: number;
        insight: string;
      }
    | undefined;

  const stages = useQuery(
    trpc.sleep.getStages.queryOptions({ days: sleepDays }),
  );

  const history = useQuery(
    trpc.sleep.getHistory.queryOptions({ days: sleepDays }),
  );

  // ---- Derived: Key stats ----
  const stats = useMemo(() => {
    const data = history.data as
      | {
          date: string;
          sleepScore: number | null;
          totalSleepMinutes: number | null;
          sleepNeedMinutes: number | null;
          sleepDebt: number | null;
          awakeMinutes: number | null;
          sleepStartTime: number | null;
          sleepEndTime: number | null;
        }[]
      | undefined;
    if (!data || data.length === 0) return null;

    const scores = data
      .map((d) => d.sleepScore)
      .filter((v): v is number => v != null);
    const durations = data
      .map((d) => d.totalSleepMinutes)
      .filter((v): v is number => v != null);
    const awakes = data
      .map((d) => d.awakeMinutes)
      .filter((v): v is number => v != null);
    const totals = data
      .map((d) => d.totalSleepMinutes)
      .filter((v): v is number => v != null);
    const debts = data
      .map((d) => d.sleepDebt)
      .filter((v): v is number => v != null);

    const avgDuration =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : null;
    const avgScore =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null;
    // `history.data` is ordered DESC (newest first), so [0] is the most recent
    const currentDebt = debts.length > 0 ? (debts[0] ?? null) : null;

    // Efficiency: (total - awake) / total * 100
    let avgEfficiency: number | null = null;
    if (totals.length > 0 && awakes.length > 0) {
      const totalSum = totals.reduce((a, b) => a + b, 0);
      const awakeSum = awakes.reduce((a, b) => a + b, 0);
      if (totalSum > 0) {
        avgEfficiency = Math.round(((totalSum - awakeSum) / totalSum) * 100);
      }
    }

    return { avgDuration, avgScore, currentDebt, avgEfficiency };
  }, [history.data, timezone]);

  // ---- Derived: Sleep stages chart data ----
  const stagesChartData = useMemo(() => {
    const raw = stages.data as
      | {
          date: string;
          deepMinutes: number | null;
          remMinutes: number | null;
          lightMinutes: number | null;
          awakeMinutes: number | null;
          sleepNeedMinutes?: number | null;
        }[]
      | undefined;
    if (!raw) return [];
    const data = [...raw].reverse();
    return data.map((d) => ({
      date: fmtDateShort(d.date, data.length, timezone),
      deep: minToHours(d.deepMinutes),
      rem: minToHours(d.remMinutes),
      light: minToHours(d.lightMinutes),
      awake: minToHours(d.awakeMinutes),
      need: d.sleepNeedMinutes ? minToHours(d.sleepNeedMinutes) : undefined,
    }));
  }, [stages.data, timezone]);

  // True when data exists but all detailed stage values are zero/null —
  // indicating the device doesn't support sleep stage tracking.
  const hasNoSleepStages = useMemo(
    () =>
      stagesChartData.length > 0 &&
      stagesChartData.every(
        (d) =>
          !(d.deep != null && d.deep > 0) &&
          !(d.rem != null && d.rem > 0) &&
          !(d.light != null && d.light > 0),
      ),
    [stagesChartData],
  );

  // ---- Derived: Sleep score trend with moving average ----
  const scoreChartData = useMemo(() => {
    const raw = history.data as
      | { date: string; sleepScore: number | null }[]
      | undefined;
    if (!raw) return [];
    const data = [...raw].reverse();
    const scores = data.map((d) => d.sleepScore);
    const ma = data.length > 14 ? movingAvg(scores, 7) : null;
    return data.map((d, i) => ({
      date: fmtDateShort(d.date, data.length, timezone),
      score: d.sleepScore,
      avg: ma ? ma[i] : undefined,
    }));
  }, [history.data, timezone]);

  // ---- Derived: Sleep vs Need chart ----
  const vsNeedChartData = useMemo(() => {
    const raw = history.data as
      | {
          date: string;
          totalSleepMinutes: number | null;
          sleepNeedMinutes: number | null;
        }[]
      | undefined;
    if (!raw) return [];
    const data = [...raw].reverse();
    // Show last 14 days for readability
    const slice = data.slice(-14);
    return slice.map((d) => ({
      date: fmtDateShort(d.date, slice.length, timezone),
      actual: d.totalSleepMinutes ? minToHours(d.totalSleepMinutes) : null,
      need: d.sleepNeedMinutes ? minToHours(d.sleepNeedMinutes) : null,
    }));
  }, [history.data, timezone]);

  // ---- Derived: Sleep debt tracker (last 7 days) ----
  // Daily debt = max(0, sleepNeed - actualSleep). The historic
  // DailyMetric.sleepDebtMinutes and sleepNeedMinutes columns are
  // not backfilled by the ETL, so we fall back to the coach's
  // computed need (constant across the 7-day window) and compute
  // each day's debt from totalSleepMinutes (which IS populated).
  const debtChartData = useMemo(() => {
    const raw = history.data as
      | {
          date: string;
          sleepDebt: number | null;
          sleepNeedMinutes: number | null;
          totalSleepMinutes: number | null;
        }[]
      | undefined;
    if (!raw) return [];
    const data = [...raw].reverse();
    const slice = data.slice(-7);
    const fallbackNeed = coachData?.recommendedDurationMinutes ?? 480; // 8h default
    return slice.map((d) => {
      const need = d.sleepNeedMinutes ?? fallbackNeed;
      const actual = d.totalSleepMinutes;
      const computed = actual != null ? Math.max(0, need - actual) : 0;
      const debt = d.sleepDebt ?? computed;
      return {
        date: fmtDateShort(d.date, slice.length, timezone),
        debt,
        color: debtColor(debt),
      };
    });
  }, [history.data, coachData?.recommendedDurationMinutes, timezone]);

  // ---- Derived: Sleep timing range chart / nightly history ----
  const timingChartData = useMemo(() => {
    const raw = history.data as
      | {
          date: string;
          sleepStartTime: number | null;
          sleepEndTime: number | null;
        }[]
      | undefined;
    if (!raw) return [];
    const data = [...raw].reverse();
    const slice = data.slice(-14);
    return slice.map((d) => {
      // Normalize bedtime: if after noon treat as same day, otherwise add 24h
      // so e.g. 22:00 (1320 min) stays as is, and 01:00 (60 min) → 1500 min
      let start = d.sleepStartTime;
      if (start != null && start < 720) start += 1440;
      return {
        date: fmtDateShort(d.date, slice.length, timezone),
        bedtime: start ?? null,
        wakeTime: d.sleepEndTime ?? null,
        range:
          start != null && d.sleepEndTime != null
            ? [start, d.sleepEndTime + 1440]
            : [null, null],
      };
    });
  }, [history.data, timezone]);

  // ---------------------------------------------------------------------------
  return (
    <PageShell density="data">
      <div className="space-y-6">
        {/* ================================================================ */}
        {/* Header (own h1: pl-12 clears the fixed mobile hamburger button) */}
        {/* ================================================================ */}
        <div>
          <h1 className="pl-12 text-2xl font-bold">Schlaf-Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Deine Schlaf-Insights &amp; dein Coaching
          </p>
        </div>

        {/* ── Date Range ── */}
        <DateRangeSelector
          value={sleepDays}
          onChange={setSleepDays}
          presets={[
            { label: "7d", days: 7 },
            { label: "14d", days: 14 },
            { label: "28d", days: 28 },
            { label: "90d", days: 90 },
          ]}
        />

        {/* ================================================================ */}
        {/* Tonight's Recommendation                                         */}
        {/* ================================================================ */}
        {coach.isLoading ? (
          <div className="bg-card animate-pulse rounded-xl border p-6">
            <div className="bg-muted h-8 w-48 rounded" />
            <div className="bg-muted mt-3 h-4 w-64 rounded" />
            <div className="bg-muted mt-2 h-4 w-56 rounded" />
          </div>
        ) : coachData ? (
          <div className="bg-card rounded-xl border p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-muted-foreground text-sm font-medium">
                  Empfehlung für heute Nacht
                </p>
                <p className="mt-1 text-3xl font-bold">
                  {fmtDuration(coachData.recommendedDurationMinutes)}
                </p>
                <p className="text-muted-foreground mt-1 text-sm">
                  Zubettgehen: {coachData.recommendedBedtime}
                </p>
              </div>
              <span
                className={cn(
                  "inline-block rounded-full px-3 py-1 text-sm font-semibold",
                  debtBadgeClass(coachData.sleepDebtMinutes),
                )}
              >
                {coachData.sleepDebtMinutes > 0 ? "+" : ""}
                {fmtDuration(coachData.sleepDebtMinutes)} Schlafdefizit
              </span>
            </div>
            {coachData.insight && (
              <p className="text-muted-foreground mt-3 text-sm">
                💡 {coachData.insight}
              </p>
            )}
          </div>
        ) : null}

        {/* ================================================================ */}
        {/* Key Stats                                                        */}
        {/* ================================================================ */}
        {history.isLoading ? (
          <div className="grid-metrics">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="bg-card animate-pulse rounded-xl border p-4"
              >
                <div className="bg-muted mx-auto h-8 w-14 rounded" />
                <div className="bg-muted mx-auto mt-2 h-3 w-20 rounded" />
              </div>
            ))}
          </div>
        ) : stats ? (
          <div className="grid-metrics">
            <StatCard
              label="Ø Dauer"
              value={fmtDuration(stats.avgDuration)}
              icon="⏱️"
            />
            <StatCard
              label="Ø Sleep Score"
              value={stats.avgScore != null ? String(stats.avgScore) : "—"}
              icon="⭐"
            />
            <StatCard
              label="Schlafdefizit"
              value={
                // Prefer the live coach value (used for the "+14h 47m debt"
                // badge); fall back to last entry in history. Previously the
                // badge and stat card could disagree because the StatCard
                // pulled only from history.sleepDebt, which is often null on
                // today's row before Garmin syncs.
                coachData != null
                  ? `${coachData.sleepDebtMinutes > 0 ? "+" : ""}${fmtDuration(coachData.sleepDebtMinutes)}`
                  : fmtDuration(stats.currentDebt)
              }
              icon="📉"
              valueClassName={debtTextColor(
                coachData?.sleepDebtMinutes ?? stats.currentDebt ?? 0,
              )}
            />
            <StatCard
              label="Effizienz"
              value={
                stats.avgEfficiency != null ? `${stats.avgEfficiency}%` : "—"
              }
              icon="✨"
            />
          </div>
        ) : null}

        {/* ================================================================ */}
        {/* Sleep Stages Stacked Bar Chart                                   */}
        {/* ================================================================ */}
        <div className="bg-card rounded-xl border p-4">
          <SectionHeader
            title="Schlafphasen · Letzte 14 Nächte"
            info="Gestapeltes Balkendiagramm der nächtlichen Schlafphasen aus Garmins Firstbeat-Schlafanalyse. Tiefschlaf (N3): körperliche Erholung + Wachstumshormon — Ziel 1-2h. REM-Schlaf: Gedächtnis + emotionale Regulation — Ziel 1,5-2h. Leichtschlaf ist der Übergang zwischen den Phasen. Methode: sleepDeepMinutes, sleepRemMinutes, sleepLightMinutes aus den Tagesmetriken."
            className="mb-4"
          />
          {stages.isLoading ? (
            <div className="bg-muted h-64 animate-pulse rounded-lg" />
          ) : stagesChartData.length === 0 ? (
            <p className="text-muted-foreground py-12 text-center text-sm">
              Noch keine Schlafphasen-Daten
            </p>
          ) : hasNoSleepStages ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="border-border text-muted-foreground inline-flex h-10 w-10 items-center justify-center rounded-full border">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </span>
              <p className="text-muted-foreground max-w-sm text-sm">
                Dein Garmin-Gerät unterstützt vermutlich kein detailliertes
                Schlafphasen-Tracking. Geräte wie Fenix 7+, Venu 3 und
                Forerunner 265+ liefern eine Aufschlüsselung nach
                Tiefschlaf/Leichtschlaf/REM-Schlaf/Wach.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={stagesChartData}
                margin={{ top: 5, right: 5, left: -10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis
                  dataKey="date"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={AXIS_LINE}
                />
                <YAxis
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={35}
                  label={{
                    value: "Stunden",
                    angle: -90,
                    position: "insideLeft",
                    style: AXIS_LABEL_STYLE,
                  }}
                />
                <Tooltip
                  {...TOOLTIP_STYLE}
                  formatter={(value, name) => [
                    `${fmtNum(Number(value), 1)}h`,
                    String(name),
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                {stagesChartData.some((d) => d.need != null) && (
                  <ReferenceLine
                    y={
                      stagesChartData.find((d) => d.need != null)?.need ??
                      undefined
                    }
                    stroke="var(--muted-foreground)"
                    strokeDasharray="6 3"
                    label={{
                      value: "Bedarf",
                      fill: "var(--muted-foreground)",
                      fontSize: 10,
                      position: "right",
                    }}
                  />
                )}
                <Bar
                  isAnimationActive={false}
                  dataKey="deep"
                  stackId="sleep"
                  fill="var(--chart-1)"
                  radius={[0, 0, 0, 0]}
                  name="Tiefschlaf"
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="rem"
                  stackId="sleep"
                  fill="var(--chart-2)"
                  name="REM-Schlaf"
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="light"
                  stackId="sleep"
                  fill="var(--chart-3)"
                  name="Leichtschlaf"
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="awake"
                  stackId="sleep"
                  fill="var(--destructive)"
                  radius={[4, 4, 0, 0]}
                  name="Wach"
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ================================================================ */}
        {/* Sleep Score Trend (LineChart)                                    */}
        {/* ================================================================ */}
        <div className="bg-card rounded-xl border p-4">
          <SectionHeader
            title="Sleep Score · Letzte 28 Tage"
            info="Garmins zusammengesetzter Sleep Score (0-100) basiert auf Dauer, Tiefe, Kontinuität und dem Anteil an REM-/Tiefschlaf. Werte >75 = gute Erholung. Konstante Werte >70 korrelieren mit besserer Trainingsadaption. Ein Abfall <60 kann auf Stress oder Übertraining hindeuten. Methode: Feld sleepScore aus der Tabelle dailyMetrics. Quelle: Garmin Firstbeat Analytics."
            className="mb-4"
          />
          {history.isLoading ? (
            <div className="bg-muted h-64 animate-pulse rounded-lg" />
          ) : scoreChartData.length === 0 ? (
            <p className="text-muted-foreground py-12 text-center text-sm">
              Noch keine Daten zum Sleep Score
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart
                data={scoreChartData}
                margin={{ top: 5, right: 5, left: -10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis
                  dataKey="date"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={AXIS_LINE}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[0, 100]}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip {...TOOLTIP_STYLE} />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "var(--primary)" }}
                  connectNulls
                  name="Sleep Score"
                />
                {scoreChartData.some((d) => d.avg != null) && (
                  <Line
                    type="monotone"
                    dataKey="avg"
                    stroke="var(--muted-foreground)"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false}
                    connectNulls
                    name="7-Tage-Ø"
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ================================================================ */}
        {/* Actual vs Need  +  Sleep Debt Tracker                            */}
        {/* ================================================================ */}
        <div className="grid-panels">
          <div className="bg-card rounded-xl border p-4">
            <SectionHeader
              title="Ist vs. Bedarf"
              info="Vergleicht die tatsächliche Schlafdauer mit dem geschätzten Bedarf (typischerweise 7-9h bei Erwachsenen). Schon ein chronisches Defizit von 30-60 Min/Nacht beeinträchtigt Reaktionszeit, Immunsystem und Trainingsadaption. Methode: sleepDurationMinutes vs. sleepNeedMinutes aus den Tagesmetriken. Quelle: Hirshkowitz M et al. (2015) Sleep Recommendations."
              className="mb-4"
            />
            {history.isLoading ? (
              <div className="bg-muted h-56 animate-pulse rounded-lg" />
            ) : vsNeedChartData.length === 0 ? (
              <p className="text-muted-foreground py-12 text-center text-sm">
                Noch keine Daten
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart
                  data={vsNeedChartData}
                  margin={{ top: 5, right: 5, left: -10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                  <XAxis
                    dataKey="date"
                    tick={{ ...AXIS_TICK, fontSize: 10 }}
                    tickLine={false}
                    axisLine={AXIS_LINE}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                    width={30}
                    label={{
                      value: "Std.",
                      angle: -90,
                      position: "insideLeft",
                      style: AXIS_LABEL_STYLE,
                    }}
                  />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(value, name) => [
                      `${fmtNum(Number(value), 1)}h`,
                      name === "actual" ? "Ist" : "Bedarf",
                    ]}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                    formatter={(v: string) => (v === "actual" ? "Ist" : "Bedarf")}
                  />
                  <Bar
                    isAnimationActive={false}
                    dataKey="actual"
                    fill="var(--primary)"
                    radius={[4, 4, 0, 0]}
                    name="actual"
                  />
                  <Line
                    type="monotone"
                    dataKey="need"
                    stroke="var(--muted-foreground)"
                    strokeWidth={2}
                    strokeDasharray="4 2"
                    dot={false}
                    name="need"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-card rounded-xl border p-4">
            <SectionHeader
              title="Schlafdefizit · Letzte 7 Tage"
              info="Laufende Summe des angesammelten Schlafdefizits über 7 Tage. Formel: Tägliches Defizit = sleepNeedMinutes - sleepDurationMinutes (falls positiv). Ein Wochendefizit >5 Stunden beeinträchtigt die sportliche Leistung deutlich und erhöht das Verletzungsrisiko um das 1,7-fache. Methode: kumulierte Summe der nächtlichen Defizite. Quelle: Milewski et al. (2014) Sleep & Injury."
              className="mb-4"
            />
            {history.isLoading ? (
              <div className="bg-muted h-56 animate-pulse rounded-lg" />
            ) : debtChartData.length === 0 ? (
              <p className="text-muted-foreground py-12 text-center text-sm">
                Noch keine Daten zum Schlafdefizit
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart
                  data={debtChartData}
                  margin={{ top: 5, right: 5, left: -10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                  <XAxis
                    dataKey="date"
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={AXIS_LINE}
                  />
                  <YAxis
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    label={{
                      value: "Min.",
                      angle: -90,
                      position: "insideLeft",
                      style: AXIS_LABEL_STYLE,
                    }}
                  />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(value) => [
                      fmtDuration(Number(value)),
                      "Defizit",
                    ]}
                  />
                  <ReferenceLine
                    y={30}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="4 2"
                    label={{
                      value: "30 Min",
                      fill: "var(--muted-foreground)",
                      fontSize: 10,
                      position: "right",
                    }}
                  />
                  <ReferenceLine
                    y={60}
                    stroke="var(--destructive)"
                    strokeDasharray="4 2"
                    label={{
                      value: "60 Min",
                      fill: "var(--destructive)",
                      fontSize: 10,
                      position: "right",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="debt"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={(props) => {
                      const cx = props.cx ?? 0;
                      const cy = props.cy ?? 0;
                      const debt =
                        (props.payload as { debt?: number }).debt ?? 0;
                      return (
                        <circle
                          key={`${cx}-${cy}`}
                          cx={cx}
                          cy={cy}
                          r={4}
                          fill={debtColor(debt)}
                          stroke="none"
                        />
                      );
                    }}
                    name="Defizit"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ================================================================ */}
        {/* Sleep Timing / Nightly History                                   */}
        {/* ================================================================ */}
        <div className="bg-card rounded-xl border p-4">
          <SectionHeader
            title="Schlafenszeiten-Konsistenz"
            info="Verfolgt Zubettgeh- und Aufstehzeiten über die Zeit. Konsistente Zeiten (±30 Min) stärken den zirkadianen Rhythmus. Unregelmäßige Zeiten (>1h Abweichung) hängen mit schlechterer Stoffwechselgesundheit und geringerer Schlafqualität zusammen. Methode: sleepStartTime und sleepEndTime aus den Tagesmetriken. Quelle: Phillips AJK et al. (2017) Irregular Sleep & Health."
            className="mb-4"
          />
          {history.isLoading ? (
            <div className="bg-muted h-56 animate-pulse rounded-lg" />
          ) : timingChartData.length === 0 ? (
            <p className="text-muted-foreground py-12 text-center text-sm">
              Noch keine Daten zu den Schlafenszeiten
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-border text-muted-foreground border-b text-left text-xs">
                      <th className="py-2 pr-3 font-medium">Nacht</th>
                      <th className="py-2 pr-3 font-medium">Zubettgehen</th>
                      <th className="py-2 pr-3 font-medium">Aufstehzeit</th>
                      <th className="py-2 font-medium">
                        Zeitverlauf (20–12 Uhr)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {timingChartData.map((d, i) => {
                      const bedLabel =
                        d.bedtime != null
                          ? fmtClockTime(
                              d.bedtime > 1440 ? d.bedtime - 1440 : d.bedtime,
                            )
                          : "—";
                      const wakeLabel =
                        d.wakeTime != null ? fmtClockTime(d.wakeTime) : "—";

                      // For bar width: normalize bedtime (20:00-02:00 → 1200-1560)
                      // and wake time (05:00-10:00 → 300-600) to percentage of
                      // a 16-hour window from 8PM (1200) to 12PM (1920).
                      const windowStart = 1200; // 8 PM in minutes
                      const windowEnd = 1920; // 12 PM next day (8PM + 12h)
                      const windowSize = windowEnd - windowStart;

                      const barStart =
                        d.bedtime != null
                          ? Math.max(
                              0,
                              ((d.bedtime - windowStart) / windowSize) * 100,
                            )
                          : 0;
                      const barEnd =
                        d.wakeTime != null
                          ? Math.min(
                              100,
                              ((d.wakeTime + 1440 - windowStart) /
                                windowSize) *
                                100,
                            )
                          : 0;
                      const barWidth = barEnd - barStart;

                      return (
                        <tr
                          key={i}
                          className="border-border/60 border-b last:border-0"
                        >
                          <td className="text-muted-foreground py-2 pr-3 whitespace-nowrap">
                            {d.date}
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {bedLabel}
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {wakeLabel}
                          </td>
                          <td className="w-full min-w-[140px] py-2">
                            <div className="bg-muted relative h-2 rounded-full">
                              {d.bedtime != null &&
                                d.wakeTime != null &&
                                barWidth > 0 && (
                                  <div
                                    className="bg-primary absolute inset-y-0 rounded-full"
                                    style={{
                                      left: `${Math.max(0, Math.min(barStart, 100))}%`,
                                      width: `${Math.max(0, Math.min(barWidth, 100 - barStart))}%`,
                                    }}
                                  />
                                )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="text-muted-foreground mt-2 flex justify-between text-[10px]">
                <span>20 Uhr</span>
                <span>0 Uhr</span>
                <span>4 Uhr</span>
                <span>8 Uhr</span>
                <span>12 Uhr</span>
              </div>
            </>
          )}
        </div>

        {/* ---- Bottom nav link ---- */}
        <div className="pt-2 text-center">
          <Link href="/" className="text-primary text-sm hover:underline">
            ← Zurück zur Startseite
          </Link>
        </div>
      </div>

      <BottomNav />
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Stat Card component
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  icon,
  valueClassName,
}: {
  label: string;
  value: string;
  icon: string;
  valueClassName?: string;
}) {
  return (
    <div className="bg-card rounded-xl border p-4 text-center">
      <span className="text-lg" aria-hidden="true">
        {icon}
      </span>
      <p className={cn("mt-1 text-2xl font-bold", valueClassName)}>{value}</p>
      <p className="text-muted-foreground text-xs">{label}</p>
    </div>
  );
}
