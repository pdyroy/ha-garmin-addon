"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@acme/ui";

import { PageShell } from "~/components/page-shell";
import { fmtDelta, fmtNum } from "~/lib/format-number";
import { useTRPC } from "~/trpc/react";
import { BottomNav } from "../_components/bottom-nav";
import { DataFreshness } from "../_components/data-freshness";
import { DateRangeSelector } from "../_components/date-range-selector";
import { GarminTrainingSummary } from "../_components/garmin-training-summary";
import { SectionHeader } from "../_components/info-button";
import { WhatIfCard } from "../_components/what-if-card";

/* ─────────────── constants ─────────────── */

const STATUS_COLORS: Record<string, string> = {
  productive: "bg-green-500/20 text-green-400",
  maintaining: "bg-yellow-500/20 text-yellow-400",
  detraining: "bg-red-500/20 text-red-400",
  overreaching: "bg-orange-500/20 text-orange-400",
  peaking: "bg-blue-500/20 text-blue-400",
  recovery: "bg-purple-500/20 text-purple-400",
  unproductive: "bg-red-500/20 text-red-400",
};

const LOAD_FOCUS_COLORS: Record<string, string> = {
  aerobic: "#3b82f6",
  anaerobic: "#ef4444",
  mixed: "#a855f7",
};

// Recharts tooltips render outside the themed DOM tree, so contentStyle
// needs explicit token values (not Tailwind classes) to stay readable in
// both themes instead of the previous hardcoded dark-only colors.
const TOOLTIP_STYLE = {
  backgroundColor: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 8,
};

/* ─────────────── ACWR helpers ─────────────── */

/**
 * Describe the ratio without grading it.
 *
 * The Optimal / Caution / High Risk banding this replaced has no evidential
 * basis: Impellizzeri et al. (2021) reproduced the published injury
 * association after substituting random numbers for chronic load. The ratio
 * says how this week compares with the three weeks before it — nothing about
 * risk — so the label states the direction and the colour stays neutral.
 */
function acwrStatus(value: number): { label: string; color: string } {
  if (value < 0.85)
    return { label: "unter dem Schnitt", color: "text-muted-foreground" };
  if (value <= 1.15)
    return { label: "wie zuletzt", color: "text-muted-foreground" };
  return { label: "über dem Schnitt", color: "text-foreground" };
}

/* ─────────────── page ─────────────── */

export default function TrainingLoadPage() {
  const trpc = useTRPC();
  const [pmcDays, setPmcDays] = useState(90);

  const loads = useQuery(trpc.analytics.getTrainingLoads.queryOptions());
  const status = useQuery(trpc.analytics.getTrainingStatus.queryOptions());
  const recovery = useQuery(trpc.analytics.getRecoveryTime.queryOptions());
  const strainChart = useQuery(
    trpc.trends.getChart.queryOptions({ metric: "strain", days: 42 }),
  );
  const recentStrain = useQuery(
    trpc.trends.getChart.queryOptions({ metric: "strain", days: 14 }),
  );
  const stressChart = useQuery(
    trpc.trends.getChart.queryOptions({ metric: "stress", days: 42 }),
  );
  const recentStress = useQuery(
    trpc.trends.getChart.queryOptions({ metric: "stress", days: 14 }),
  );
  // @ts-ignore — route added by gc-backend branch
  const pmcData = useQuery(
    trpc.advancedMetrics.list.queryOptions({ days: pmcDays }),
  );

  /* ── derive PMC chart data ── */
  interface PmcEntry {
    date: string;
    ctl?: number | null;
    atl?: number | null;
    tsb?: number | null;
    acwr?: number | null;
  }
  const pmcChartData = ((pmcData.data ?? []) as PmcEntry[]).map(
    (d, idx, arr) => {
      // Show ~8 labels regardless of window size so 180-day views don't
      // mash dates together. Recharts respects `interval={0}` so we control
      // visibility by emitting empty strings on the off-ticks.
      const step = Math.max(1, Math.ceil(arr.length / 8));
      const showLabel = idx % step === 0 || idx === arr.length - 1;
      return {
        date: showLabel ? (d.date?.slice(5) ?? "") : "",
        fullDate: d.date ?? "",
        ctl: d.ctl ?? null,
        atl: d.atl ?? null,
        tsb: d.tsb ?? null,
        acwr: d.acwr ?? null,
        tsbPos: (d.tsb ?? 0) >= 0 ? (d.tsb ?? 0) : 0,
        tsbNeg: (d.tsb ?? 0) < 0 ? (d.tsb ?? 0) : 0,
      };
    },
  );

  // ACWR gauge: prefer the dedicated analytics endpoint, but fall back to
  // the last point on the PMC chart series. This guarantees the gauge and
  // the chart never disagree by definition. Previously, if
  // `analytics.getTrainingLoads` returned null (the v0.16.6 invalid-date
  // bug), the gauge said "No data yet" while the chart happily plotted
  // ACWR — exact mismatch the screenshot review flagged.
  const currentAcwr =
    loads.data?.acwr ?? pmcChartData[pmcChartData.length - 1]?.acwr ?? null;

  return (
    <PageShell density="data">
      {/* ── Header ── */}
      <div className="mb-8 space-y-2">
        <div className="flex items-center justify-between">
          <h1 className="pl-12 text-2xl font-bold">Training</h1>
          {status.data ? (
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold capitalize",
                STATUS_COLORS[status.data.status] ??
                  "bg-muted text-muted-foreground",
              )}
            >
              {status.data.status}
            </span>
          ) : status.isLoading ? (
            <div className="bg-muted h-6 w-20 animate-pulse rounded-full" />
          ) : null}
        </div>

        {status.data && (
          <p className="text-muted-foreground text-sm">
            {status.data.explanation}
          </p>
        )}
      </div>

      <div className="space-y-4">
        {/* ── Garmin Training Summary (native readings) ── */}
        <GarminTrainingSummary />

        {/* ── What-if: today's training-choice simulation ── */}
        <WhatIfCard />

        {/* ── PMC — Performance Management Chart ── */}
        <div className="bg-card rounded-2xl border p-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <SectionHeader
              title="Performance Management Chart"
              info="CTL (Chronic Training Load) = über 42 Tage aufgebaute Fitness. ATL (Acute Training Load) = Ermüdung über 7 Tage. TSB (Training Stress Balance) = CTL - ATL = Form. ACWR (Acute:Chronic Workload Ratio) = diese Woche gegen die 21 Tage davor, beschreibend ohne Risikoschwelle. Quelle: Banister (1991)."
            />
            <DateRangeSelector
              value={pmcDays}
              onChange={setPmcDays}
              presets={[
                { label: "42d", days: 42 },
                { label: "90d", days: 90 },
                { label: "180d", days: 180 },
              ]}
            />
          </div>

          {pmcData.isLoading ? (
            <div className="bg-muted h-52 animate-pulse rounded-lg" />
          ) : pmcChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart
                data={pmcChartData}
                margin={{ top: 5, right: 40, left: -10, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="tsbPosGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4ade80" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#4ade80" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="tsbNegGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.05} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0.3} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                  interval={0}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                  width={32}
                  domain={[
                    (dataMin: number) => Math.floor(dataMin) - 5,
                    (dataMax: number) => Math.ceil(dataMax) + 5,
                  ]}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: "#f97316", fontSize: 10 }}
                  width={32}
                  domain={[0, 2]}
                />
                <ReferenceLine
                  yAxisId="left"
                  y={0}
                  stroke="#555"
                  strokeDasharray="4 2"
                />
                <Tooltip
                  contentStyle={{ ...TOOLTIP_STYLE, fontSize: 11 }}
                  formatter={(value: unknown, name: unknown) => {
                    const v = Number(value);
                    const n = String(name);
                    if (n === "ACWR") {
                      const s = acwrStatus(v);
                      return `${fmtNum(v, 2)} (${s.label})`;
                    }
                    return !isNaN(v) ? fmtNum(v, 1) : String(value);
                  }}
                  labelFormatter={(label, payload) => {
                    const p = payload?.[0]?.payload as
                      | { fullDate?: string }
                      | undefined;
                    return p?.fullDate ?? String(label);
                  }}
                />
                {/* TSB filled areas */}
                <Area
                  isAnimationActive={false}
                  yAxisId="left"
                  type="monotone"
                  dataKey="tsbPos"
                  fill="url(#tsbPosGrad)"
                  stroke="none"
                  name="TSB+"
                  legendType="none"
                />
                <Area
                  isAnimationActive={false}
                  yAxisId="left"
                  type="monotone"
                  dataKey="tsbNeg"
                  fill="url(#tsbNegGrad)"
                  stroke="none"
                  name="TSB-"
                  legendType="none"
                />
                {/* CTL / ATL lines */}
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="ctl"
                  stroke="#60a5fa"
                  strokeWidth={2.5}
                  dot={false}
                  name="CTL"
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="atl"
                  stroke="#c084fc"
                  strokeWidth={2.5}
                  dot={false}
                  name="ATL"
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="tsb"
                  stroke="#4ade80"
                  strokeWidth={2}
                  strokeDasharray="4 2"
                  dot={false}
                  name="TSB"
                />
                {/* ACWR on right axis */}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="acwr"
                  stroke="#fb923c"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={false}
                  name="ACWR"
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Noch keine PMC-Daten. Schließe ein paar Workouts ab, um dein
              Diagramm zu sehen.
            </p>
          )}

          {/* Legend */}
          <div className="mt-2 flex flex-wrap gap-3 text-[10px]">
            {[
              { color: "#60a5fa", label: "CTL (Fitness)" },
              { color: "#c084fc", label: "ATL (Ermüdung)" },
              { color: "#4ade80", label: "TSB (Form)" },
              { color: "#fb923c", label: "ACWR (rechts)" },
            ].map((l) => (
              <span key={l.label} className="flex items-center gap-1">
                <span
                  className="inline-block h-0.5 w-5 rounded"
                  style={{ background: l.color }}
                />
                <span className="text-muted-foreground">{l.label}</span>
              </span>
            ))}
          </div>
        </div>

        {/* ── ACWR Gauge + Risk Zone Legend ── */}
        <div className="grid-panels">
          <div className="bg-card rounded-2xl border p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <SectionHeader
                title="ACWR"
                info="Diese Woche im Verhältnis zu den 21 Tagen davor. Beschreibend, keine Risikoschwelle: Impellizzeri et al. (2021) erzeugten dieselbe Verletzungsassoziation, nachdem sie die chronische Last durch Zufallszahlen ersetzt hatten. Immer zusammen mit der absoluten chronischen Last lesen."
              />
              <DataFreshness computedAt={loads.data?.computedAt} />
            </div>
            {currentAcwr != null ? (
              <ACWRGaugeEnhanced value={currentAcwr} />
            ) : loads.isLoading ? (
              <div className="bg-muted h-12 animate-pulse rounded-lg" />
            ) : (
              <p className="text-muted-foreground py-4 text-center text-sm">
                Noch keine Daten
              </p>
            )}
          </div>

          <div className="bg-card rounded-2xl border p-4">
            <h3 className="mb-3 text-sm font-semibold">ACWR-Bereiche</h3>
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="text-base">⚫</span>
                <span className="text-muted-foreground">
                  &lt;0,8 — unter dem Durchschnitt
                </span>
              </span>
              <span className="text-muted-foreground">
                1,0 = diese Woche wie die 21 Tage davor. Darunter weniger,
                darüber mehr. Kein Risikowert — immer zusammen mit der
                absoluten chronischen Last lesen.
              </span>
            </div>
          </div>
        </div>

        {/* ── Strain Trend + Body Stress (42 day) ── */}
        <div className="grid-panels">
          <div className="bg-card rounded-2xl border p-4">
            <SectionHeader
              title="Training Strain — 42-Tage-Trend"
              info="Aktivitätsbasierter Trainings-Strain (Skala 0–21), berechnet aus TRIMP (Training Impulse). Misst die kardiovaskuläre Belastung pro Workout anhand der HF-Zonen. Höher = härtere Einheit. Basiert auf dem exponentiellen HF-Modell von Banister (1991). Unterscheidet sich von Garmin Stress — hier wird die Workout-Intensität erfasst, nicht der Körperstress."
              className="mb-3"
            />
            {strainChart.isLoading ? (
              <div className="bg-muted h-48 animate-pulse rounded-lg" />
            ) : strainChart.data &&
              strainChart.data.length > 0 &&
              strainChart.data.some((d) => (d.value ?? 0) > 0) ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart
                  data={strainChart.data.map((d) => ({
                    date: d.date.slice(5),
                    value: d.value ?? null,
                  }))}
                >
                  <defs>
                    <linearGradient id="strainFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    width={32}
                    domain={[0, 21]}
                    ticks={[0, 5, 10, 15, 20]}
                  />
                  <Tooltip contentStyle={{ ...TOOLTIP_STYLE, fontSize: 12 }} />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="value"
                    stroke="#ef4444"
                    fill="url(#strainFill)"
                    strokeWidth={2}
                    name="Strain"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground py-8 text-center text-sm">
                Noch keine Trainings-Strain-Daten — absolviere ein Workout mit
                Herzfrequenzmessung, um sie zu befüllen
              </p>
            )}
          </div>

          <div className="bg-card rounded-2xl border p-4">
            <SectionHeader
              title="Body Stress — 42-Tage-Trend"
              info="Garmins täglicher Stress-Score (0–100), abgeleitet aus der Herzfrequenzvariabilität (HRV). Niedriger = ruhiger, höher = gestresster. Zeigt über 6 Wochen, wie dein Körper mit Training und Alltagsstress umgeht. Nützlich, um angesammelte Ermüdung zu erkennen, bevor daraus Übertraining wird."
              className="mb-3"
            />
            {stressChart.isLoading ? (
              <div className="bg-muted h-48 animate-pulse rounded-lg" />
            ) : stressChart.data &&
              stressChart.data.length > 0 &&
              stressChart.data.some((d) => (d.value ?? 0) > 0) ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart
                  data={stressChart.data.map((d) => ({
                    date: d.date.slice(5),
                    value: d.value ?? null,
                  }))}
                >
                  <defs>
                    <linearGradient id="stressFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} width={32} />
                  <Tooltip contentStyle={{ ...TOOLTIP_STYLE, fontSize: 12 }} />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="value"
                    stroke="#3b82f6"
                    fill="url(#stressFill)"
                    strokeWidth={2}
                    name="Stress"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground py-8 text-center text-sm">
                Noch keine Stressdaten
              </p>
            )}
          </div>
        </div>

        {/* ── Key Metric Cards ── */}
        {loads.isLoading ? (
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
        ) : loads.data ? (
          <div className="grid-metrics">
            {/* CTL */}
            <div className="bg-card rounded-xl border p-4 text-center">
              <p className="text-2xl font-bold text-blue-500">
                {fmtNum(loads.data.ctl, 1)}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                CTL — Fitness
              </p>
              <p className="text-muted-foreground mt-0.5 text-[10px]">
                42 Tage chronische Last
              </p>
            </div>

            {/* ATL */}
            <div className="bg-card rounded-xl border p-4 text-center">
              <p className="text-2xl font-bold text-red-500">
                {fmtNum(loads.data.atl, 1)}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                ATL — Ermüdung
              </p>
              <p className="text-muted-foreground mt-0.5 text-[10px]">
                7 Tage akute Last
              </p>
            </div>

            {/* TSB */}
            <div className="bg-card rounded-xl border p-4 text-center">
              <p
                className={cn(
                  "text-2xl font-bold",
                  loads.data.tsb >= 0 ? "text-green-500" : "text-red-500",
                )}
              >
                {fmtDelta(loads.data.tsb, 1)}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">TSB — Form</p>
              <p className="text-muted-foreground mt-0.5 text-[10px]">
                {loads.data.tsb >= 0 ? "Frisch" : "Ermüdet"}
              </p>
            </div>

            {/* Ramp Rate */}
            <div className="bg-card rounded-xl border p-4 text-center">
              <p
                className={cn(
                  "text-2xl font-bold",
                  loads.data.rampRate > 8
                    ? "text-orange-500"
                    : "text-foreground",
                )}
              >
                {fmtNum(loads.data.rampRate, 1)}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">Ramp Rate</p>
              <p className="text-muted-foreground mt-0.5 text-[10px]">
                {loads.data.rampRate > 8 ? "⚠ steiler Aufbau" : "Pkt./Woche"}
              </p>
            </div>
          </div>
        ) : null}

        {/* ── Load Focus + Recovery Time ── */}
        <div className="grid-panels">
          <div className="bg-card rounded-2xl border p-4">
            <SectionHeader
              title="Load Focus"
              info="Balance zwischen den Trainingsintensitäten, abgeleitet aus der Zonenverteilung der letzten Aktivitäten. Zeigt die prozentuale Aufteilung zwischen aerob (Z1–2), Threshold (Z3) und hochintensiv (Z4–5). Ausdauersportler sollten >70 % aerob liegen. Methode: Aggregation der Zonenminuten über den gewählten Zeitraum."
              className="mb-3"
            />
            {loads.isLoading ? (
              <div className="flex items-center justify-center py-6">
                <div className="bg-muted h-28 w-28 animate-pulse rounded-full" />
              </div>
            ) : loads.data ? (
              <LoadFocusChart focus={loads.data.loadFocus} />
            ) : (
              <p className="text-muted-foreground py-4 text-center text-sm">
                Noch keine Daten
              </p>
            )}
          </div>

          <div className="bg-card rounded-2xl border p-4">
            <SectionHeader
              title="Erholungsschätzung"
              info="Geschätzte Stunden bis zur vollständigen Erholung, basierend auf aktuellem Strain, Schlafqualität, HRV-Trend und Ruhepuls. Höherer Strain + schlechter Schlaf = längere Erholung. Leichte Zone-1-Aktivität während der Erholung fördert die Durchblutung und beschleunigt die Anpassung. Methode: Kombination aus TRIMP-Abklingrate und Erholungsmarkern."
              className="mb-3"
            />
            {recovery.isLoading ? (
              <div className="space-y-2">
                <div className="bg-muted mx-auto h-10 w-20 animate-pulse rounded" />
                <div className="bg-muted mx-auto h-3 w-40 animate-pulse rounded" />
              </div>
            ) : recovery.data ? (
              <div className="space-y-3">
                <p className="text-center text-3xl font-bold">
                  {recovery.data.hoursUntilRecovered}
                  <span className="text-muted-foreground ml-1 text-base font-normal">
                    Stunden
                  </span>
                </p>
                {recovery.data.factors.length > 0 && (
                  <ul className="space-y-1">
                    {recovery.data.factors.map((f, i) => (
                      <li
                        key={i}
                        className="text-muted-foreground text-center text-xs"
                      >
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground py-4 text-center text-sm">
                Noch keine Daten
              </p>
            )}
          </div>
        </div>

        {/* ── Recent Strain + Recent Body Stress (14 day bar charts) ── */}
        <div className="grid-panels">
          <div className="bg-card rounded-2xl border p-4">
            <SectionHeader
              title="Täglicher Strain — Letzte 14 Tage"
              info="Trainings-Strain (0–21) pro Tag über die letzten 2 Wochen. Berechnet aus TRIMP (HF-Zonen-Intensität × Dauer). Zeigt den maximalen Strain pro Tag. Tage ohne Workouts erscheinen nicht. Vergleiche mit Body Stress unten, um zu sehen, wie sich die Trainingsbelastung auf die Erholung auswirkt."
              className="mb-3"
            />
            {recentStrain.isLoading ? (
              <div className="bg-muted h-40 animate-pulse rounded-lg" />
            ) : recentStrain.data && recentStrain.data.length > 0 ? (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart
                  data={recentStrain.data.map((d) => ({
                    date: d.date.slice(5),
                    value: d.value ?? 0,
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    width={28}
                    domain={[0, 21]}
                    ticks={[0, 5, 10, 15, 20]}
                    tickFormatter={(v: number) => Math.round(v).toString()}
                  />
                  <Tooltip contentStyle={{ ...TOOLTIP_STYLE, fontSize: 12 }} />
                  <Bar
                    isAnimationActive={false}
                    dataKey="value"
                    fill="#ef4444"
                    radius={[4, 4, 0, 0]}
                    name="Strain"
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground py-8 text-center text-sm">
                Noch keine Trainings-Strain-Daten — Workouts mit
                Herzfrequenzmessung nötig
              </p>
            )}
          </div>

          <div className="bg-card rounded-2xl border p-4">
            <SectionHeader
              title="Täglicher Stress — Letzte 14 Tage"
              info="Garmins täglicher Stress-Score (0–100) über die letzten 2 Wochen. Abgeleitet aus der HRV-Analyse. Hohe Werte an Ruhetagen können auf unvollständige Erholung, Krankheit oder Alltagsstress hindeuten. Achte auf einen Abwärtstrend nach Deload-Wochen."
              className="mb-3"
            />
            {recentStress.isLoading ? (
              <div className="bg-muted h-40 animate-pulse rounded-lg" />
            ) : recentStress.data && recentStress.data.length > 0 ? (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart
                  data={recentStress.data.map((d) => ({
                    date: d.date.slice(5),
                    value: d.value ?? 0,
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} width={28} />
                  <Tooltip contentStyle={{ ...TOOLTIP_STYLE, fontSize: 12 }} />
                  <Bar
                    isAnimationActive={false}
                    dataKey="value"
                    fill="#6366f1"
                    radius={[4, 4, 0, 0]}
                    name="Stress"
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground py-8 text-center text-sm">
                Noch keine Stressdaten
              </p>
            )}
          </div>
        </div>

        {/* ── Recommendation ── */}
        {status.data?.recommendation && (
          <div className="bg-card rounded-2xl border p-4">
            <SectionHeader
              title="Empfehlung"
              info="KI-generierte Trainingsempfehlung, kombiniert aus: ACWR (Lastverhältnis), TSB (Frische = CTL - ATL), Schlafqualitäts-Score und aktuellem Strain-Muster. Schlägt intensivieren/halten/ruhen vor, basierend auf der zusammengesetzten Readiness. Methode: Regelbasierte Engine mit sportwissenschaftlichen Schwellenwerten."
              className="mb-2"
            />
            <p className="text-sm leading-relaxed">
              {status.data.recommendation}
            </p>
          </div>
        )}
      </div>

      <BottomNav />
    </PageShell>
  );
}

/* ─────────────── ACWR Gauge Enhanced ─────────────── */

function ACWRGaugeEnhanced({ value }: { value: number }) {
  const clamped = Math.min(2, Math.max(0, value));
  const pct = (clamped / 2) * 100;
  const { label, color } = acwrStatus(value);

  // One neutral track. The graded segments this replaced encoded an
  // injury-risk threshold the evidence does not support.
  const segments = [{ color: "var(--muted)", width: "100%", label: "scale" }];

  return (
    <div className="space-y-2">
      <div className="relative h-5 w-full overflow-hidden rounded-full">
        <div className="flex h-full w-full">
          {segments.map((s) => (
            <div
              key={s.label}
              style={{ width: s.width, backgroundColor: s.color + "60" }}
            />
          ))}
        </div>
        {/* Marker */}
        <div
          className="bg-foreground absolute top-0 h-full w-1.5 rounded-full shadow-lg transition-all"
          style={{ left: `calc(${pct}% - 3px)` }}
        />
      </div>
      <div className="text-muted-foreground flex justify-between text-[10px]">
        <span>0</span>
        <span>0.8</span>
        <span>1.3</span>
        <span>1.5</span>
        <span>2.0</span>
      </div>
      <p className="text-center">
        <span className="text-xl font-bold">{fmtNum(value, 2)}</span>
        <span className={cn("ml-2 text-sm font-semibold", color)}>{label}</span>
      </p>
    </div>
  );
}

/* ─────────────── ACWR Gauge ─────────────── */

function ACWRGauge({ value }: { value: number }) {
  const clampedValue = Math.min(2, Math.max(0, value));
  const pct = (clampedValue / 2) * 100;

  let label: string;
  let labelColor: string;
  if (value < 0.8) {
    label = "Untertrainiert";
    labelColor = "text-red-400";
  } else if (value <= 1.3) {
    label = "Optimalbereich";
    labelColor = "text-green-400";
  } else {
    label = "Lastspitze";
    labelColor = "text-red-400";
  }

  return (
    <div className="space-y-2">
      {/* Colored zone bar */}
      <div className="relative h-4 w-full overflow-hidden rounded-full">
        {/* Neutral track. The green/amber/red banding this replaced implied
            an injury-risk threshold the evidence does not support — see the
            section info text. A single reference tick at 1.0 is all the
            ratio can honestly carry. */}
        <div className="bg-muted absolute inset-0" />
        <div
          className="bg-border absolute inset-y-0 w-px"
          style={{ left: "50%" }}
        />
        {/* Marker */}
        <div
          className="bg-foreground absolute top-0 h-full w-1 rounded-full shadow-md transition-all"
          style={{ left: `${pct}%` }}
        />
      </div>

      {/* Labels */}
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">0</span>
        <span className="text-muted-foreground">0.8</span>
        <span className="text-muted-foreground">1.3</span>
        <span className="text-muted-foreground">2.0</span>
      </div>

      <p className="text-center">
        <span className="text-lg font-bold">{fmtNum(value, 2)}</span>
        <span className={cn("ml-2 text-sm font-medium", labelColor)}>
          {label}
        </span>
      </p>
    </div>
  );
}

/* ─────────────── Load Focus Chart ─────────────── */

function LoadFocusChart({ focus }: { focus: string }) {
  const focusData = getFocusPieData(focus);

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <ResponsiveContainer width="100%" height={140}>
        <PieChart>
          <Pie
            isAnimationActive={false}
            data={focusData}
            cx="50%"
            cy="50%"
            innerRadius={36}
            outerRadius={56}
            paddingAngle={4}
            dataKey="value"
          >
            {focusData.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ ...TOOLTIP_STYLE, fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>

      <span
        className={cn(
          "rounded-full px-3 py-1 text-xs font-semibold capitalize",
          focus === "aerobic"
            ? "bg-blue-500/20 text-blue-400"
            : focus === "anaerobic"
              ? "bg-red-500/20 text-red-400"
              : "bg-purple-500/20 text-purple-400",
        )}
      >
        {focus}
      </span>
    </div>
  );
}

function getFocusPieData(focus: string) {
  switch (focus) {
    case "aerobic":
      return [
        { name: "Aerob", value: 70, color: LOAD_FOCUS_COLORS.aerobic },
        { name: "Anaerob", value: 30, color: LOAD_FOCUS_COLORS.anaerobic },
      ];
    case "anaerobic":
      return [
        { name: "Aerob", value: 30, color: LOAD_FOCUS_COLORS.aerobic },
        { name: "Anaerob", value: 70, color: LOAD_FOCUS_COLORS.anaerobic },
      ];
    default:
      return [
        { name: "Aerob", value: 50, color: LOAD_FOCUS_COLORS.aerobic },
        { name: "Anaerob", value: 50, color: LOAD_FOCUS_COLORS.anaerobic },
      ];
  }
}
