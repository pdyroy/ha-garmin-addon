"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@acme/ui";

import { PageShell } from "~/components/page-shell";
import {
  formatDateInTz,
  formatTimeInTz,
  useUserTimezone,
} from "~/lib/format-date";
import { sportLabel } from "~/lib/sport-labels";
import { useTRPC } from "~/trpc/react";
import { BottomNav } from "../_components/bottom-nav";
import { SectionHeader } from "../_components/info-button";

const SOURCE_LABEL: Record<string, string> = {
  sleep: "Schlaf",
  activity: "Training",
  day: "Tagesabschnitt",
};

export default function EnergyPage() {
  const trpc = useTRPC();
  const timezone = useUserTimezone();
  const energy = useQuery(trpc.vitals.getEnergyBank.queryOptions({}));

  const data = energy.data;
  const bank = data?.energyBank.value ?? null;

  const chartData = useMemo(
    () =>
      (data?.series ?? []).map(([ts, value]) => ({
        ts,
        value,
        label: formatTimeInTz(ts, timezone, {
          hour: "2-digit",
          minute: "2-digit",
        }),
      })),
    [data?.series, timezone],
  );

  /** Activity bands, clipped to the range the curve actually covers. */
  const bands = useMemo(() => {
    if (chartData.length === 0) return [];
    const first = chartData[0]!.ts;
    const last = chartData[chartData.length - 1]!.ts;
    return (data?.activities ?? [])
      .map((a) => ({
        id: a.id,
        label: sportLabel(a.label),
        from: Math.max(a.startTs, first),
        to: Math.min(a.endTs, last),
      }))
      .filter((a) => a.to > a.from);
  }, [data?.activities, chartData]);

  return (
    <>
      <PageShell
        density="data"
        title="Energiekonto"
        description={
          data?.date
            ? `Body Battery am ${formatDateInTz(data.date, timezone)}`
            : "Body Battery im Tagesverlauf"
        }
      >
        <div className="space-y-6">
          {energy.isLoading ? (
            <div className="bg-card h-72 animate-pulse rounded-2xl border" />
          ) : !bank ? (
            <div className="bg-card rounded-2xl border p-6 text-center">
              <p className="text-muted-foreground text-sm">
                {data?.energyBank.reason ??
                  "Noch keine Intraday-Daten für diesen Tag."}
              </p>
            </div>
          ) : (
            <>
              {/* ── Tagesbilanz ── */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label="Netto"
                  value={`${bank.net > 0 ? "+" : ""}${bank.net}`}
                  tone={bank.net >= 0 ? "good" : "bad"}
                />
                <Stat label="Höchstwert" value={`${bank.peak.value}`} />
                <Stat label="Tiefstwert" value={`${bank.trough.value}`} />
                <Stat label="Messpunkte" value={`${bank.pointsUsed}`} muted />
              </div>

              {/* ── Kurve ── */}
              <div className="bg-card rounded-2xl border p-4">
                <SectionHeader
                  title="Body Battery im Tagesverlauf"
                  info="Body Battery ist Garmins eigene Schätzung der verfügbaren Energie (Firstbeat-Modell aus HRV, Stress und Aktivität) — eine Modellgröße, keine Messung. Die farbigen Bänder markieren Trainingseinheiten. Quelle: Firstbeat Technologies. Stress and Recovery Analysis Method Based on 24-Hour Heart Rate Variability. White Paper, 2014."
                  className="mb-3"
                />
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-border"
                      />
                      <XAxis
                        dataKey="label"
                        minTickGap={48}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(v: unknown) => [
                          `${String(v)}`,
                          "Body Battery",
                        ]}
                        labelFormatter={(label: unknown) =>
                          `${String(label)} Uhr`
                        }
                      />
                      {bands.map((b) => (
                        <ReferenceArea
                          key={b.id}
                          x1={
                            chartData.find((p) => p.ts >= b.from)?.label ??
                            undefined
                          }
                          x2={
                            [...chartData].reverse().find((p) => p.ts <= b.to)
                              ?.label ?? undefined
                          }
                          fill="#f97316"
                          fillOpacity={0.15}
                          label={{ value: b.label, fontSize: 10 }}
                        />
                      ))}
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="#22c55e"
                        fill="#22c55e"
                        fillOpacity={0.2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* ── Was hat gebracht / gekostet ── */}
              <div className="grid gap-4 lg:grid-cols-2">
                <SegmentList
                  title="Was aufgeladen hat"
                  info="Positive Abschnitte der Kurve, dem Schlaffenster, einer Aktivität oder einem Tagesabschnitt zugeordnet und nach Größe sortiert. Abschnitte unter einem Body-Battery-Punkt werden als Modellrauschen weggelassen, deshalb ergibt die Summe nicht exakt den Nettowert."
                  segments={bank.charges}
                  timezone={timezone}
                  tone="good"
                />
                <SegmentList
                  title="Was gekostet hat"
                  info="Negative Abschnitte der Kurve. Eine Aktivität bekommt den Verbrauch gutgeschrieben, der während ihrer Dauer anfällt — der Nachlauf einer harten Einheit landet im folgenden Tagesabschnitt."
                  segments={bank.drains}
                  timezone={timezone}
                  tone="bad"
                />
              </div>
            </>
          )}
        </div>
      </PageShell>
      <BottomNav />
    </>
  );
}

function Stat({
  label,
  value,
  tone,
  muted,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
  muted?: boolean;
}) {
  return (
    <div className="bg-card rounded-xl border p-4">
      <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold",
          tone === "good" && "text-green-400",
          tone === "bad" && "text-red-400",
          muted && "text-muted-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function SegmentList({
  title,
  info,
  segments,
  timezone,
  tone,
}: {
  title: string;
  info: string;
  segments: {
    key: string;
    label: string;
    source: string;
    delta: number;
    startTs: number;
    endTs: number;
    meanStress: number | null;
  }[];
  timezone: string;
  tone: "good" | "bad";
}) {
  return (
    <div className="bg-card rounded-2xl border p-4">
      <SectionHeader title={title} info={info} className="mb-3" />
      {segments.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nichts Nennenswertes.</p>
      ) : (
        <ul className="divide-border divide-y">
          {segments.map((s) => (
            <li key={s.key} className="flex items-center gap-3 py-2">
              <span
                className={cn(
                  "w-14 text-right font-semibold tabular-nums",
                  tone === "good" ? "text-green-400" : "text-red-400",
                )}
              >
                {s.delta > 0 ? "+" : ""}
                {s.delta}
              </span>
              <span className="flex-1">
                <span className="font-medium">{s.label}</span>
                <span className="text-muted-foreground block text-xs">
                  {SOURCE_LABEL[s.source] ?? s.source} ·{" "}
                  {formatTimeInTz(s.startTs, timezone, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  –
                  {formatTimeInTz(s.endTs, timezone, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {s.meanStress !== null && ` · ø Stress ${s.meanStress}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
