"use client";

import { useState } from "react";
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

import { UI_LOCALE, useUserTimezone } from "~/lib/format-date";
import { fmtNum } from "~/lib/format-number";
import { useTRPC } from "~/trpc/react";
import { PageShell } from "~/components/page-shell";
import { BottomNav } from "../_components/bottom-nav";
import { DateRangeSelector } from "../_components/date-range-selector";
import { SectionHeader } from "../_components/info-button";
import { IngressLink as Link } from "../_components/ingress-link";

/* ─────────────── status config ─────────────── */

type StatusConfig = Record<
  string,
  { icon: string; label: string; cls: string; desc: string }
>;

const SPO2_STATUS: StatusConfig = {
  normal: {
    icon: "✅",
    label: "Normal",
    cls: "bg-green-500/20 text-green-400 border-green-500/30",
    desc: "SpO2 liegt im Normalbereich (≥95 %). Ausreichende Sauerstoffsättigung.",
  },
  low: {
    icon: "⚠️",
    label: "Niedrig",
    cls: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    desc: "SpO2 liegt bei 90–94 % nach absolutem klinischem Grenzwert — unabhängig von deiner persönlichen Baseline. Kann auf Höhenluft, eine leichte Erkrankung oder Übertraining hindeuten.",
  },
  critical: {
    icon: "🚨",
    label: "Kritisch",
    cls: "bg-red-500/20 text-red-400 border-red-500/30",
    desc: "SpO2 liegt unter 90 % nach absolutem klinischem Grenzwert. Bei anhaltenden Werten ärztlichen Rat einholen.",
  },
  no_data: {
    icon: "📊",
    label: "Keine Daten",
    cls: "bg-muted text-muted-foreground border-border",
    desc: "Noch keine SpO2-Daten verfügbar.",
  },
};

const RR_STATUS: StatusConfig = {
  normal: {
    icon: "✅",
    label: "Normal",
    cls: "bg-green-500/20 text-green-400 border-green-500/30",
    desc: "Atemfrequenz liegt nahe deiner Baseline. Gutes Erholungszeichen.",
  },
  elevated: {
    icon: "⚠️",
    label: "Erhöht",
    cls: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    desc: "Atemfrequenz liegt 3-7 % über der Baseline. Kann auf Stress oder eine beginnende Erkrankung hindeuten.",
  },
  high: {
    icon: "🔴",
    label: "Hoch",
    cls: "bg-red-500/20 text-red-400 border-red-500/30",
    desc: "Atemfrequenz liegt >7 % über der Baseline. Starkes Signal für Erkrankung/Übertraining.",
  },
  no_data: {
    icon: "📊",
    label: "Keine Daten",
    cls: "bg-muted text-muted-foreground border-border",
    desc: "Noch keine Atemfrequenz-Daten verfügbar.",
  },
};

const TEMP_STATUS: StatusConfig = {
  normal: {
    icon: "✅",
    label: "Normal",
    cls: "bg-green-500/20 text-green-400 border-green-500/30",
    desc: "Hauttemperatur liegt innerhalb von ±0,3 °C der Baseline.",
  },
  elevated: {
    icon: "⚠️",
    label: "Erhöht",
    cls: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    desc: "Abweichung der Hauttemperatur 0,3-0,8 °C. Kann auf eine beginnende Erkrankung oder hormonelle Schwankung hindeuten.",
  },
  high: {
    icon: "🔴",
    label: "Hoch",
    cls: "bg-red-500/20 text-red-400 border-red-500/30",
    desc: "Abweichung der Hauttemperatur >0,8 °C über der Baseline. Starkes Krankheitssignal.",
  },
  no_data: {
    icon: "📊",
    label: "Keine Daten",
    cls: "bg-muted text-muted-foreground border-border",
    desc: "Noch keine Hauttemperatur-Daten verfügbar.",
  },
};

const RHR_STATUS: StatusConfig = {
  normal: {
    icon: "✅",
    label: "Normal",
    cls: "bg-green-500/20 text-green-400 border-green-500/30",
    desc: "Ruhepuls liegt auf oder unter deiner 30-Tage-Baseline.",
  },
  elevated: {
    icon: "⚠️",
    label: "Erhöht",
    cls: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    desc: "Ruhepuls liegt 3-7 % über der Baseline. Erholung und Krankheitszeichen im Blick behalten.",
  },
  high: {
    icon: "🔴",
    label: "Hoch",
    cls: "bg-red-500/20 text-red-400 border-red-500/30",
    desc: "Ruhepuls liegt >7 % über der Baseline. Erwäge Ruhe oder ein lockeres Training.",
  },
  no_data: {
    icon: "📊",
    label: "Keine Daten",
    cls: "bg-muted text-muted-foreground border-border",
    desc: "Noch keine Ruhepuls-Daten verfügbar.",
  },
};

const BODY_BATTERY_STATUS: StatusConfig = {
  normal: {
    icon: "✅",
    label: "Aufgeladen",
    cls: "bg-green-500/20 text-green-400 border-green-500/30",
    desc: "Der tägliche Body-Battery-Höchstwert liegt nahe oder über deiner 30-Tage-Baseline.",
  },
  low: {
    icon: "⚠️",
    label: "Niedrig",
    cls: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    desc: "Täglicher Höchstwert liegt 3-7 % unter der Baseline. Die Erholung könnte hinterherhinken.",
  },
  depleted: {
    icon: "🔴",
    label: "Erschöpft",
    cls: "bg-red-500/20 text-red-400 border-red-500/30",
    desc: "Täglicher Höchstwert liegt >7 % unter der Baseline. Priorisiere Erholung.",
  },
  no_data: {
    icon: "📊",
    label: "Keine Daten",
    cls: "bg-muted text-muted-foreground border-border",
    desc: "Noch keine Body-Battery-Daten verfügbar.",
  },
};

const STRESS_STATUS: StatusConfig = {
  normal: {
    icon: "✅",
    label: "Niedrig",
    cls: "bg-green-500/20 text-green-400 border-green-500/30",
    desc: "Stresswert liegt auf oder unter deiner 30-Tage-Baseline.",
  },
  elevated: {
    icon: "⚠️",
    label: "Erhöht",
    cls: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    desc: "Stress liegt 3-7 % über der Baseline. Die Erholungslast steigt.",
  },
  high: {
    icon: "🔴",
    label: "Hoch",
    cls: "bg-red-500/20 text-red-400 border-red-500/30",
    desc: "Stress liegt >7 % über der Baseline. Erwäge, den Trainingsumfang zu reduzieren.",
  },
  no_data: {
    icon: "📊",
    label: "Keine Daten",
    cls: "bg-muted text-muted-foreground border-border",
    desc: "Noch keine Stresswert-Daten verfügbar.",
  },
};

/* ─────────────── helpers ─────────────── */

type TrendPoint = { date: string; value: number };
type VitalMetric = {
  daily: TrendPoint[];
  rolling7d: TrendPoint[];
  baseline: number | null;
  latest: number | null;
  status: string;
  deviation: number | null;
  daysWithData: number;
  baselineDays: number;
};

type Preference = "higher" | "lower";

const COMPACT_UNITS = new Set(["%", "°C"]);

function formatDate(d: string) {
  // Note: chart axis labels — noon-UTC anchor is acceptable here since
  // we only render month/day on the axis, not the full timestamp.
  return new Date(d + "T12:00:00Z").toLocaleDateString(UI_LOCALE, {
    month: "short",
    day: "numeric",
  });
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatNumber(value: number): string {
  return fmtNum(round1(value), 1);
}

function formatWithUnit(value: number, unit?: string): string {
  const formatted = formatNumber(value);
  if (!unit) return formatted;
  return COMPACT_UNITS.has(unit)
    ? `${formatted}${unit}`
    : `${formatted} ${unit}`;
}

function formatDeviation(
  value: number | null,
  unit: "%" | "°C",
): string | null {
  if (value === null) return null;
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value)}${unit}`;
}

function deviationClass(
  deviation: number | null,
  preference: Preference | null,
): string | undefined {
  if (deviation === null || preference === null) return undefined;

  if (preference === "higher") {
    if (deviation < -7) return "text-red-400";
    if (deviation < -3) return "text-yellow-400";
    if (deviation > 3) return "text-green-400";
    return undefined;
  }

  if (deviation > 7) return "text-red-400";
  if (deviation > 3) return "text-yellow-400";
  if (deviation < -3) return "text-green-400";
  return undefined;
}

function baselineSubtext(metric: VitalMetric): string | undefined {
  if (metric.baseline !== null || metric.baselineDays >= 30) return undefined;
  return `Baseline wird noch aufgebaut (${metric.baselineDays} Tage)`;
}

function Unit({ unit, className }: { unit: string; className: string }) {
  return <span className={className}>{unit}</span>;
}

function StatCard({
  label,
  value,
  unit,
  subtext,
  valueClassName,
}: {
  label: string;
  value: string | number | null;
  unit?: string;
  subtext?: string;
  valueClassName?: string;
}) {
  const isCompactUnit = Boolean(unit && COMPACT_UNITS.has(unit));
  const displayValue =
    isCompactUnit && value !== null ? `${value}${unit}` : (value ?? "—");

  return (
    <div className="bg-card rounded-lg border p-3">
      <p className="text-muted-foreground text-[11px]">{label}</p>
      <p className={cn("text-foreground text-lg font-bold", valueClassName)}>
        {displayValue}
        {unit && !isCompactUnit && value !== null && (
          <Unit unit={unit} className="text-muted-foreground ml-1 text-xs" />
        )}
      </p>
      {subtext && (
        <p className="text-muted-foreground text-[10px]">{subtext}</p>
      )}
    </div>
  );
}

function VitalMetricSection({
  title,
  info,
  metric,
  statusConfig,
  unit,
  color,
  chartName,
  emptyMessage,
  preference,
  latestLabel = "Aktuell",
  deviationUnit = "%",
  yDomain,
  referenceLines = [],
}: {
  title: string;
  info: string;
  metric: VitalMetric | undefined;
  statusConfig: StatusConfig;
  unit?: string;
  color: string;
  chartName: string;
  emptyMessage: string;
  preference: Preference | null;
  latestLabel?: string;
  deviationUnit?: "%" | "°C";
  yDomain?: [number, number];
  referenceLines?: { y: number; label: string; color: string }[];
}) {
  const status = metric ? statusConfig[metric.status] : undefined;

  return (
    <section className="space-y-3">
      <SectionHeader title={title} info={info} />

      {metric && status && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2",
            status.cls,
          )}
        >
          <span className="text-lg">{status.icon}</span>
          <div>
            <p className="text-sm font-semibold">{status.label}</p>
            <p className="text-[11px] opacity-80">{status.desc}</p>
          </div>
        </div>
      )}

      {metric && (
        <div className="grid-metrics">
          <StatCard
            label={latestLabel}
            value={metric.latest != null ? formatNumber(metric.latest) : null}
            unit={unit}
          />
          <StatCard
            label="Baseline"
            value={
              metric.baseline != null ? formatNumber(metric.baseline) : null
            }
            unit={unit}
            subtext={baselineSubtext(metric)}
          />
          <StatCard
            label="Abweichung"
            value={formatDeviation(metric.deviation, deviationUnit)}
            valueClassName={deviationClass(metric.deviation, preference)}
          />
        </div>
      )}

      {metric && metric.daily.length > 0 ? (
        <div className="bg-card rounded-lg border p-3">
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart
              data={metric.daily.map((d, i) => ({
                date: d.date,
                value: round1(d.value),
                avg: metric.rolling7d[i]?.value,
              }))}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={false}
              />
              <YAxis
                domain={yDomain}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={false}
                width={35}
              />
              <Tooltip
                labelFormatter={(label: unknown) => formatDate(String(label))}
                formatter={(v: unknown) => [
                  formatWithUnit(Number(v), unit),
                  "",
                ]}
                contentStyle={{
                  background: "var(--popover)",
                  color: "var(--popover-foreground)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              {metric.baseline !== null && (
                <ReferenceLine
                  y={metric.baseline}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 4"
                  label={{
                    value: "Baseline",
                    fill: "var(--muted-foreground)",
                    fontSize: 10,
                    position: "insideTopRight",
                  }}
                />
              )}
              {referenceLines.map((line) => (
                <ReferenceLine
                  key={`${line.y}-${line.label}`}
                  y={line.y}
                  stroke={line.color}
                  strokeDasharray="2 2"
                  label={{ value: line.label, fill: line.color, fontSize: 10 }}
                />
              ))}
              <Area
                isAnimationActive={false}
                dataKey="value"
                fill={color}
                fillOpacity={0.15}
                stroke="none"
              />
              <Line
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                dot={{ r: 2, fill: color }}
                name={chartName}
              />
              <Line
                dataKey="avg"
                stroke="#f59e0b"
                strokeWidth={2}
                strokeDasharray="4 2"
                dot={false}
                name="7-Tage-Ø"
              />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-muted-foreground mt-1 text-center text-[10px]">
            {metric.daysWithData} Tage mit Daten · 7-Tage-Ø in Orange
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground py-4 text-center text-xs">
          {emptyMessage}
        </p>
      )}
    </section>
  );
}

/* ─────────────── main page ─────────────── */

export default function VitalsPage() {
  const [days, setDays] = useState(30);
  const trpc = useTRPC();
  const timezone = useUserTimezone();

  const { data, isLoading } = useQuery(
    trpc.vitals.getTrends.queryOptions({ days }),
  );

  return (
    <PageShell density="data">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">🫁 Vitalwerte</h1>
            <p className="text-muted-foreground text-xs">
              Blutsauerstoff, Atmung, Temperatur, Herzfrequenz, Body Battery,
              Stress und Körperzusammensetzung — die wichtigsten
              Erholungs-Biomarker von Garmin.
            </p>
          </div>
          <Link
            href="/hrv"
            className="text-primary mt-1 rounded-md border px-2 py-1 text-xs whitespace-nowrap hover:bg-accent"
          >
            💓 HRV
          </Link>
        </div>

        <DateRangeSelector
          value={days}
          onChange={setDays}
          presets={[
            { label: "7d", days: 7 },
            { label: "14d", days: 14 },
            { label: "30d", days: 30 },
            { label: "90d", days: 90 },
          ]}
        />

        {isLoading && (
          <div className="text-muted-foreground py-12 text-center text-sm">
            Vitaldaten werden geladen …
          </div>
        )}

        {!isLoading && data && (
          <>
            <VitalMetricSection
              title="Blutsauerstoff (SpO2)"
              info="Pulsoximeter-Messung von deinem Garmin. Normalbereich ist 95-100 %. Werte unter der Baseline können auf Höhenluft, eine beginnende Erkrankung, Schlafapnoe oder Übertraining hindeuten. Jedes 1 % unter deiner Baseline senkt die Readiness um ~20 Punkte."
              metric={data.spo2}
              statusConfig={SPO2_STATUS}
              unit="%"
              color="#3b82f6"
              chartName="SpO2"
              emptyMessage="Keine SpO2-Daten in diesem Zeitraum. Stelle sicher, dass Pulsoximetrie auf deinem Garmin aktiviert ist."
              preference="higher"
              yDomain={[88, 100]}
              referenceLines={[{ y: 95, label: "95 %", color: "#ef4444" }]}
            />

            <VitalMetricSection
              title="Ruhepuls"
              info="Niedrigster von Garmin gemessener Ruhepuls. Niedrigere Werte gegenüber deiner 30-Tage-Baseline deuten meist auf bessere Erholung hin; anhaltend erhöhte Werte können Ermüdung, Hitzestress, Alkohol oder eine beginnende Erkrankung signalisieren."
              metric={data.restingHr}
              statusConfig={RHR_STATUS}
              unit="bpm"
              color="#f97316"
              chartName="RHR"
              emptyMessage="Keine Ruhepuls-Daten in diesem Zeitraum."
              preference="lower"
            />

            <VitalMetricSection
              title="Body Battery"
              info="Garmin Body Battery schätzt die verfügbare Energie aus Herzfrequenzvariabilität, Stress und Schlaf. Diese Karte nutzt den täglichen Höchstwert (body_battery_high, ersatzweise den Tagesendwert) auf einer Skala von 0-100. Höher ist besser."
              metric={data.bodyBattery}
              statusConfig={BODY_BATTERY_STATUS}
              color="#22c55e"
              chartName="Body Battery"
              emptyMessage="Keine Body-Battery-Daten in diesem Zeitraum."
              preference="higher"
              latestLabel="Tageshöchstwert"
              yDomain={[0, 100]}
            />

            <VitalMetricSection
              title="Stress"
              info="Garmins ganztägiger Stresswert schätzt die sympathische Belastung anhand der HRV. Niedrigerer Stress gegenüber deiner 30-Tage-Baseline ist besser; anhaltend erhöhte Werte können die Erholungsfähigkeit verringern."
              metric={data.stress}
              statusConfig={STRESS_STATUS}
              color="#a855f7"
              chartName="Stress"
              emptyMessage="Keine Stresswert-Daten in diesem Zeitraum."
              preference="lower"
              yDomain={[0, 100]}
            />

            <VitalMetricSection
              title="Atemfrequenz"
              info="Durchschnittliche Atemfrequenz während des Schlafs (Atemzüge pro Minute). Normal: 12-20 Atemzüge/min. Eine erhöhte Atemfrequenz (>2 Atemzüge/min über deiner Baseline) ist ein früher Marker für Erkrankung, Übertraining oder Stress (Buchheit 2014). Wird auch in WHOOPs Recovery-Algorithmus verwendet."
              metric={data.respirationRate}
              statusConfig={RR_STATUS}
              unit="brpm"
              color="#10b981"
              chartName="RR"
              emptyMessage="Keine Atemfrequenz-Daten in diesem Zeitraum."
              preference="lower"
            />

            <VitalMetricSection
              title="Hauttemperatur"
              info="Abweichung der Handgelenk-Hauttemperatur von deiner persönlichen Baseline. Eine erhöhte Hauttemperatur (+0,5 °C oder mehr) ist ein starkes Frühwarnzeichen für eine Erkrankung — eines von WHOOPs wichtigsten Recovery-Signalen. Auch hormonelle Zyklen können regelmäßige Schwankungen verursachen."
              metric={data.skinTemp}
              statusConfig={TEMP_STATUS}
              unit="°C"
              color="#f43f5e"
              chartName="Skin Temp"
              emptyMessage="Keine Hauttemperatur-Daten in diesem Zeitraum."
              preference={null}
              deviationUnit="°C"
            />

            <section className="space-y-3">
              <SectionHeader
                title="Körperzusammensetzung"
                info="Gewichts- und Körperfett-Trends benötigen eine kompatible Garmin-Index-Waage oder eine andere Quelle für Körperzusammensetzung. Das aktuelle daily_metric-Schema enthält keine Gewicht/Körperfett-Spalten, daher zeigt diese Karte bis dahin nur einen Platzhalter."
              />
              <div className="bg-card rounded-lg border p-4 text-center">
                <div className="mb-2 text-3xl">⚖️</div>
                <p className="text-foreground text-sm font-semibold">
                  {data.bodyComposition.message}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Gewichts- und Körperfettwerte erscheinen hier, sobald die
                  entsprechenden Spalten in daily_metric verfügbar sind.
                </p>
              </div>
            </section>

            {/* ────── Science / WHOOP Context ────── */}
            <section className="bg-card rounded-lg border p-4">
              <h3 className="text-foreground mb-2 text-sm font-semibold">
                🔬 Wie diese Vitalwerte die Erholung beeinflussen
              </h3>
              <div className="text-muted-foreground space-y-2 text-xs leading-relaxed">
                <p>
                  <strong className="text-foreground">Ruhepuls + Stress</strong>{" "}
                  — Erhöhter Ruhepuls und Stress gegenüber einer persönlichen
                  30-Tage-Baseline deuten auf höhere autonome Belastung und
                  geringere Readiness hin.
                </p>
                <p>
                  <strong className="text-foreground">Body Battery</strong> — Ein
                  niedrigerer Tageshöchstwert deutet auf unvollständige
                  nächtliche Erholung oder erhöhte Stressbelastung hin, selbst
                  wenn der Trainingsumfang unverändert bleibt.
                </p>
                <p>
                  <strong className="text-foreground">SpO2</strong> —
                  Nächtliche Abfälle der Sauerstoffsättigung unter die Baseline
                  korrelieren mit Höhenanpassungsstress, Schlafapnoe und
                  Übertrainingssyndrom (Millet et al., 2016).
                </p>
                <p>
                  <strong className="text-foreground">Atemfrequenz</strong>{" "}
                  — Eine erhöhte Atemfrequenz im Schlaf (&gt;2 Atemzüge/min über
                  der Baseline) ist einer der frühesten Biomarker für eine
                  beginnende Erkrankung und autonomen Stress, verwendet in
                  Buchheits (2014) Monitoring-Framework.
                </p>
                <p>
                  <strong className="text-foreground">Hauttemperatur</strong>{" "}
                  — WHOOPs Recovery-Modell gewichtet die Abweichung der
                  Handgelenk-Hauttemperatur stark. Eine Verschiebung um +0,5 °C
                  sagt eine Erkrankung 1-2 Tage vor Symptombeginn voraus
                  (Miller et al., 2018).
                </p>
              </div>
            </section>
          </>
        )}
      </div>
      <BottomNav />
    </PageShell>
  );
}
