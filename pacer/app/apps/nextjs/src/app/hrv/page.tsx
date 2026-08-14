"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@acme/ui";

import { PageShell } from "~/components/page-shell";
import { formatDateInTz, useUserTimezone } from "~/lib/format-date";
import { fmtDelta, fmtNum } from "~/lib/format-number";
import { useTRPC } from "~/trpc/react";
import { BottomNav } from "../_components/bottom-nav";
import { DateRangeSelector } from "../_components/date-range-selector";
import { SectionHeader } from "../_components/info-button";

/* ─────────────── constants ─────────────── */

const STATUS_CONFIG: Record<
  string,
  { icon: string; label: string; cls: string; description: string }
> = {
  recovered: {
    icon: "✅",
    label: "Erholt",
    cls: "bg-green-500/20 text-green-400 border-green-500/30",
    description: "HRV liegt über der Baseline — dein Körper ist gut erholt.",
  },
  recovering: {
    icon: "🔄",
    label: "In Erholung",
    cls: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    description: "HRV liegt nahe der Baseline — die Erholung schreitet normal voran.",
  },
  strained: {
    icon: "⚠️",
    label: "Belastet",
    cls: "bg-red-500/20 text-red-400 border-red-500/30",
    description:
      "HRV liegt unter der Baseline oder ist stark schwankend — erwäge Ruhe oder ein lockeres Training.",
  },
  insufficient_data: {
    icon: "📊",
    label: "Unzureichende Daten",
    cls: "bg-muted text-muted-foreground border-border",
    description: "Es werden mehr HRV-Daten benötigt, um den Erholungsstatus zu bestimmen.",
  },
};

const HRV_PRESETS = [
  { label: "30d", days: 30 },
  { label: "60d", days: 60 },
  { label: "90d", days: 90 },
  { label: "180d", days: 180 },
  { label: "1y", days: 365 },
];

function fmtDateShort(d: string, timezone: string): string {
  return formatDateInTz(d, timezone, { month: "short", day: "numeric" });
}

/* ─────────────── page ─────────────── */

export default function HrvPage() {
  const trpc = useTRPC();
  const timezone = useUserTimezone();
  const [days, setDays] = useState(90);

  const { data, isLoading } = useQuery(
    trpc.hrv.getAnalysis.queryOptions({ days }),
  );

  const statusConfig = data?.status
    ? STATUS_CONFIG[data.status]
    : STATUS_CONFIG.insufficient_data;

  // Chart data: merge daily, rolling7d, rolling14d into one series
  const chartData = useMemo(() => {
    if (!data?.daily.length) return [];

    const map = new Map<
      string,
      {
        date: string;
        label: string;
        daily?: number;
        rolling7d?: number;
        rolling14d?: number;
      }
    >();

    for (const d of data.daily) {
      map.set(d.date, {
        date: d.date,
        label: fmtDateShort(d.date, timezone),
        daily: d.value,
      });
    }
    for (const d of data.rolling7d) {
      const existing = map.get(d.date);
      if (existing) existing.rolling7d = d.value;
    }
    for (const d of data.rolling14d) {
      const existing = map.get(d.date);
      if (existing) existing.rolling14d = d.value;
    }

    return Array.from(map.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }, [data, timezone]);

  // CV% over time: compute rolling 7-day CV for each point
  const cvData = useMemo(() => {
    if (!data?.daily || data.daily.length < 7) return [];
    const result: { date: string; label: string; cv: number }[] = [];
    for (let i = 6; i < data.daily.length; i++) {
      const window = data.daily.slice(i - 6, i + 1);
      const mean = window.reduce((s, d) => s + d.value, 0) / window.length;
      const std = Math.sqrt(
        window.reduce((s, d) => s + (d.value - mean) ** 2, 0) / window.length,
      );
      const cv = Math.round((std / mean) * 1000) / 10;
      result.push({
        date: data.daily[i]!.date,
        label: fmtDateShort(data.daily[i]!.date, timezone),
        cv,
      });
    }
    return result;
  }, [data, timezone]);

  return (
    <PageShell density="data">
      <div className="flex flex-col gap-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="pl-12 text-2xl font-bold">HRV-Analyse</h1>
          <p className="text-muted-foreground text-sm">
            Herzfrequenzvariabilität &amp; Erholung
          </p>
        </div>
        {statusConfig && data?.status !== "insufficient_data" && (
          <span
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold",
              statusConfig.cls,
            )}
          >
            {statusConfig.icon} {statusConfig.label}
          </span>
        )}
      </div>

      {/* ── Recovery Status Card ── */}
      {isLoading ? (
        <div className="bg-card animate-pulse rounded-2xl border p-6">
          <div className="bg-muted mx-auto h-16 w-24 rounded" />
          <div className="bg-muted mx-auto mt-3 h-4 w-48 rounded" />
        </div>
      ) : data?.summary ? (
        <div
          className={cn(
            "rounded-2xl border p-6 text-center",
            statusConfig?.cls.replace(/text-\S+/, ""),
            "bg-card",
          )}
        >
          <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            Aktuelle HRV (RMSSD)
          </p>
          <p
            className={cn(
              "mt-1 text-5xl font-bold",
              data.status === "recovered"
                ? "text-green-400"
                : data.status === "recovering"
                  ? "text-yellow-400"
                  : data.status === "strained"
                    ? "text-red-400"
                    : "text-muted-foreground",
            )}
          >
            {fmtNum(data.summary.current, 0)}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">ms</p>
          {data.summary.deviationFromBaseline !== null && (
            <p className="mt-2 text-sm">
              <span
                className={cn(
                  "font-semibold",
                  data.summary.deviationFromBaseline >= 0
                    ? "text-green-400"
                    : "text-red-400",
                )}
              >
                {fmtDelta(data.summary.deviationFromBaseline, 1)} %
              </span>
              <span className="text-muted-foreground"> von der Baseline</span>
            </p>
          )}
          {statusConfig && (
            <p className="text-muted-foreground mt-2 text-xs">
              {statusConfig.description}
            </p>
          )}
        </div>
      ) : (
        <div className="bg-card rounded-2xl border p-6 text-center">
          <p className="text-muted-foreground text-sm">
            Noch keine HRV-Daten verfügbar. Trage dein Garmin-Gerät beim
            Schlafen, um HRV-Messwerte zu sammeln.
          </p>
        </div>
      )}

      {/* ── Quick Stats Row ── */}
      {data?.summary && (
        <div className="grid-metrics">
          <div className="bg-card rounded-xl border p-3 text-center">
            <p className="text-muted-foreground text-[10px] font-medium uppercase">
              Aktuell
            </p>
            <p className="mt-1 text-lg font-bold">
              {fmtNum(data.summary.current, 0)}
            </p>
          </div>
          <div className="bg-card rounded-xl border p-3 text-center">
            <p className="text-muted-foreground text-[10px] font-medium uppercase">
              7-Tage-Ø
            </p>
            <p className="mt-1 text-lg font-bold">
              {fmtNum(data.summary.avg7d, 0)}
            </p>
          </div>
          <div className="bg-card rounded-xl border p-3 text-center">
            <p className="text-muted-foreground text-[10px] font-medium uppercase">
              Baseline
            </p>
            <p className="mt-1 text-lg font-bold">
              {fmtNum(data.summary.baseline, 0)}
            </p>
          </div>
          <div className="bg-card rounded-xl border p-3 text-center">
            <p className="text-muted-foreground text-[10px] font-medium uppercase">
              CV%
            </p>
            <p
              className={cn(
                "mt-1 text-lg font-bold",
                data.summary.cv > 15
                  ? "text-red-400"
                  : data.summary.cv > 10
                    ? "text-yellow-400"
                    : "text-green-400",
              )}
            >
              {fmtNum(data.summary.cv, 1)}%
            </p>
          </div>
        </div>
      )}

      {/* ── Date Range Selector ── */}
      <DateRangeSelector
        value={days}
        onChange={setDays}
        presets={HRV_PRESETS}
        className="justify-center"
      />

      {/* ── Main HRV Chart ── */}
      {isLoading ? (
        <div className="bg-card animate-pulse rounded-2xl border p-4">
          <div className="bg-muted h-[260px] rounded" />
        </div>
      ) : chartData.length > 0 ? (
        <div className="bg-card rounded-2xl border p-4">
          <SectionHeader
            title={`HRV-Trend — ${data?.summary?.daysWithData ?? 0} Messwerte`}
            info="Heart Rate Variability (RMSSD), gemessen von deinem Garmin-Gerät während des Schlafs. Höhere HRV deutet in der Regel auf bessere Erholung und stärkere parasympathische (entspannende) Nervensystemaktivität hin. Der 7-Tage-Durchschnitt glättet Tagesschwankungen, während die 14-Tage-Baseline deine persönliche Norm abbildet. Quelle: Shaffer &amp; Ginsberg (2017). An Overview of HRV Metrics and Norms. Frontiers in Public Health."
            className="mb-3"
          />
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart
              data={chartData}
              margin={{ top: 5, right: 5, left: -10, bottom: 0 }}
            >
              <defs>
                <linearGradient id="hrvFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                width={36}
                domain={["dataMin - 5", "dataMax + 5"]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  color: "var(--popover-foreground)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              {data?.baseline && (
                <ReferenceLine
                  y={data.baseline}
                  stroke="#6366f1"
                  strokeDasharray="6 3"
                  strokeWidth={1.5}
                  label={{
                    value: `Baseline ${fmtNum(data.baseline, 0)}`,
                    position: "insideTopRight",
                    fill: "#6366f1",
                    fontSize: 10,
                  }}
                />
              )}
              <Area
                isAnimationActive={false}
                type="monotone"
                dataKey="daily"
                stroke="#22c55e"
                fill="url(#hrvFill)"
                strokeWidth={1}
                name="Tägliche HRV"
                dot={{ fill: "#22c55e", r: 2 }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="rolling7d"
                stroke="#3b82f6"
                strokeWidth={2.5}
                dot={false}
                name="7-Tage-Ø"
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="rolling14d"
                stroke="#6366f1"
                strokeWidth={1.5}
                strokeDasharray="6 3"
                dot={false}
                name="14-Tage-Baseline"
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {/* ── CV% Trend Chart ── */}
      {cvData.length > 0 && (
        <div className="bg-card rounded-2xl border p-4">
          <SectionHeader
            title="HRV-Variabilität (CV%)"
            info="Der Variationskoeffizient (CV%) misst, wie konstant deine HRV über ein rollierendes 7-Tage-Fenster ist. CV% = Standardabweichung / Mittelwert × 100. Unter 10 % deutet auf stabile, gleichbleibende Erholung hin. 10-15 % ist moderat. Über 15 % deutet auf hohen Stress oder unregelmäßige Erholungsmuster hin. Quelle: Plews et al. (2013). Training Adaptation and Heart Rate Variability in Elite Endurance Athletes. Int J Sports Physiol Perform."
            className="mb-3"
          />
          <ResponsiveContainer width="100%" height={140}>
            <ComposedChart
              data={cvData}
              margin={{ top: 5, right: 5, left: -10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                width={36}
                domain={[0, "dataMax + 5"]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  color: "var(--popover-foreground)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: unknown) => `${fmtNum(Number(value), 1)}%`}
              />
              <ReferenceLine
                y={10}
                stroke="#22c55e"
                strokeDasharray="4 2"
                strokeWidth={1}
              />
              <ReferenceLine
                y={15}
                stroke="#ef4444"
                strokeDasharray="4 2"
                strokeWidth={1}
              />
              <Line
                type="monotone"
                dataKey="cv"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                name="CV%"
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="mt-2 flex justify-center gap-4 text-[10px]">
            <span className="text-green-400">● &lt;10 % Stabil</span>
            <span className="text-yellow-400">● 10–15 % Moderat</span>
            <span className="text-red-400">● &gt;15 % Hoch</span>
          </div>
        </div>
      )}

      {/* ── Range Summary ── */}
      {data?.summary && (
        <div className="bg-card rounded-2xl border p-4">
          <SectionHeader
            title="Zeitraum-Zusammenfassung"
            info="Statistische Zusammenfassung für den gewählten Zeitraum. Min/Max zeigen die volle Bandbreite deiner HRV-Werte. Tage mit Daten zeigt die Messkonstanz — für die zuverlässigste Analyse strebe tägliche Messwerte an."
            className="mb-3"
          />
          <div className="grid-metrics">
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-muted-foreground text-[10px] font-medium uppercase">
                Min
              </p>
              <p className="text-lg font-bold">
                {fmtNum(data.summary.min, 0)}{" "}
                <span className="text-muted-foreground text-xs">ms</span>
              </p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-muted-foreground text-[10px] font-medium uppercase">
                Max
              </p>
              <p className="text-lg font-bold">
                {fmtNum(data.summary.max, 0)}{" "}
                <span className="text-muted-foreground text-xs">ms</span>
              </p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-muted-foreground text-[10px] font-medium uppercase">
                Tage mit Daten
              </p>
              <p className="text-lg font-bold">{data.summary.daysWithData}</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-muted-foreground text-[10px] font-medium uppercase">
                Abdeckung
              </p>
              <p className="text-lg font-bold">
                {Math.round((data.summary.daysWithData / days) * 100)}%
              </p>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
      </div>
    </PageShell>
  );
}
