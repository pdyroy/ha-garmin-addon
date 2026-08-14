"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@acme/ui";
import { toast } from "@acme/ui/toast";

import { formatDateInTz, useUserTimezone } from "~/lib/format-date";
import { fmtNum, fmtPct } from "~/lib/format-number";
import { useTRPC } from "~/trpc/react";
import { PageShell } from "~/components/page-shell";
import { BottomNav } from "../_components/bottom-nav";
import { SectionHeader } from "../_components/info-button";
import { WhatsWorkingCard } from "../_components/whats-working-card";

/* ─────────────── ProactiveInsightCard ─────────────── */

type AiSeverity = "info" | "warn" | "critical";

const AI_SEVERITY_STYLES: Record<
  AiSeverity,
  { border: string; bg: string; iconBg: string; badge: string }
> = {
  info: {
    border: "border-blue-500/30",
    bg: "bg-blue-500/5",
    iconBg: "bg-blue-500/20",
    badge: "bg-blue-500/20 text-blue-400",
  },
  warn: {
    border: "border-amber-500/30",
    bg: "bg-amber-500/5",
    iconBg: "bg-amber-500/20",
    badge: "bg-amber-500/20 text-amber-400",
  },
  critical: {
    border: "border-red-500/30",
    bg: "bg-red-500/5",
    iconBg: "bg-red-500/20",
    badge: "bg-red-500/20 text-red-400",
  },
};

interface ProactiveInsight {
  id: string;
  title: string;
  body: string;
  severity: string;
  confidence: number | null;
  actionSuggestion: string | null;
  metrics: Record<string, number | string> | null;
  isRead: boolean | null;
}

/** Friendly labels for metric keys cited by AI insights. */
const METRIC_LABELS: Record<string, string> = {
  hrv: "HRV",
  rhr: "Ruhepuls",
  resting_hr: "Ruhepuls",
  restingHr: "Ruhepuls",
  acwr: "ACWR",
  tsb: "Form (TSB)",
  ctl: "Fitness (CTL)",
  atl: "Ermüdung (ATL)",
  spo2: "SpO₂",
  zone: "Zone",
  readiness: "Readiness",
  sleephours: "Schlaf",
  sleep_hours: "Schlaf",
  sleepHours: "Schlaf",
  sleep_duration: "Schlafdauer",
  sleep_quality: "Schlafqualität",
  next_day_hrv: "HRV (Folgetag)",
  stress: "Stress",
  rr: "Atemfreq.",
};

function prettyMetricKey(k: string): string {
  return k
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function ProactiveInsightCard({
  insight,
  onMarkRead,
}: {
  insight: ProactiveInsight;
  onMarkRead: (id: string) => void;
}) {
  const severity = (insight.severity ?? "info") as AiSeverity;
  const style = AI_SEVERITY_STYLES[severity] ?? AI_SEVERITY_STYLES.info;
  const confidencePct =
    insight.confidence != null
      ? `${fmtPct(insight.confidence * 100, 0)} Konfidenz`
      : null;
  const metricEntries = insight.metrics ? Object.entries(insight.metrics) : [];

  return (
    <div
      className={cn(
        "rounded-2xl border p-4 transition-opacity",
        style.border,
        style.bg,
        insight.isRead && "opacity-50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm leading-snug font-semibold">{insight.title}</h3>
        <div className="flex shrink-0 items-center gap-1">
          {confidencePct && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                style.badge,
              )}
            >
              {confidencePct}
            </span>
          )}
        </div>
      </div>

      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        {insight.body}
      </p>

      {/* Cited metrics */}
      {metricEntries.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {metricEntries.map(([k, v]) => {
            const num = typeof v === "number" ? v : parseFloat(String(v));
            const display = isNaN(num)
              ? String(v)
              : Number.isInteger(num)
                ? String(num)
                : fmtNum(num, 1);
            const label = METRIC_LABELS[k] ?? prettyMetricKey(k);
            return (
              <span
                key={k}
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums",
                  style.badge,
                )}
              >
                {label}: {display}
              </span>
            );
          })}
        </div>
      )}

      {/* Action suggestion */}
      {insight.actionSuggestion && (
        <div className="mt-3 rounded-xl bg-muted px-3 py-2 text-sm">
          <span className="mr-1">💡</span>
          <span className="text-foreground/80">
            Empfohlene Maßnahme: {insight.actionSuggestion}
          </span>
        </div>
      )}

      {/* Mark read */}
      {!insight.isRead && (
        <button
          onClick={() => onMarkRead(insight.id)}
          className="text-muted-foreground mt-3 text-xs underline underline-offset-2 hover:text-foreground"
        >
          Als gelesen markieren
        </button>
      )}
    </div>
  );
}

/* ─────────────── types ─────────────── */

interface InsightCard {
  icon: string;
  title: string;
  body: string;
  severity: "alert" | "warning" | "positive" | "info";
  metric?: string;
}

/* ─────────────── severity styles ─────────────── */

const SEVERITY_STYLES: Record<
  InsightCard["severity"],
  { border: string; bg: string; iconBg: string }
> = {
  alert: {
    border: "border-red-500/30",
    bg: "bg-red-500/5",
    iconBg: "bg-red-500/20",
  },
  warning: {
    border: "border-orange-500/30",
    bg: "bg-orange-500/5",
    iconBg: "bg-orange-500/20",
  },
  positive: {
    border: "border-green-500/30",
    bg: "bg-green-500/5",
    iconBg: "bg-green-500/20",
  },
  info: {
    border: "border-blue-500/30",
    bg: "bg-blue-500/5",
    iconBg: "bg-blue-500/20",
  },
};

const SEVERITY_ORDER: Record<InsightCard["severity"], number> = {
  alert: 0,
  warning: 1,
  positive: 2,
  info: 3,
};

/* ─────────────── insight generation ─────────────── */

interface InsightData {
  readiness: Record<string, unknown> | null;
  loads: Record<string, unknown> | null;
  sleepCoach: Record<string, unknown> | null;
  recovery: Record<string, unknown> | null;
  hrvTrend: Record<string, unknown> | null;
  trainingStatus: Record<string, unknown> | null;
  summary: Record<string, unknown> | null;
}

/** Display labels for the readiness engine's zone keys (mirrors readiness-card.tsx). */
const ZONE_LABEL_DE: Record<string, string> = {
  prime: "Optimal",
  high: "Hoch",
  moderate: "Moderat",
  low: "Niedrig",
  poor: "Schwach",
};

function generateInsights(data: InsightData): InsightCard[] {
  const insights: InsightCard[] = [];

  // Readiness insight
  if (data.readiness) {
    const score = data.readiness.score as number;
    const zone = data.readiness.zone as string;
    const zoneLabel = ZONE_LABEL_DE[zone] ?? zone;
    const explanation = data.readiness.explanation as string;
    const severity: InsightCard["severity"] =
      score >= 70 ? "positive" : score >= 40 ? "info" : "warning";
    insights.push({
      icon:
        severity === "positive" ? "✅" : severity === "warning" ? "⚠️" : "📊",
      title: `Readiness: ${score} (${zoneLabel})`,
      body:
        explanation ||
        `Dein Readiness-Score liegt bei ${score}, in der Zone „${zoneLabel}“.`,
      severity,
      metric: `${score}`,
    });
  }

  // Training load insights
  if (data.loads) {
    const acwr = data.loads.acwr as number;
    const tsb = data.loads.tsb as number;
    const rampRate = data.loads.rampRate as number;

    if (acwr > 1.3) {
      insights.push({
        icon: "⚠️",
        title: "Trainingsspitze erkannt",
        body: `Dein ACWR (Verhältnis von akuter zu chronischer Belastung) liegt bei ${fmtNum(acwr, 2)} und damit über dem sicheren Bereich (0,8–1,3). Reduziere die Intensität, um dein Verletzungsrisiko zu senken.`,
        severity: "alert",
        metric: `ACWR: ${fmtNum(acwr, 2)}`,
      });
    } else if (acwr >= 0.8 && acwr <= 1.3) {
      insights.push({
        icon: "👍",
        title: "Training Load im optimalen Bereich",
        body: `Dein ACWR liegt bei ${fmtNum(acwr, 2)} und damit im optimalen Bereich von 0,8–1,3. Weiter so mit diesem ausgewogenen Ansatz.`,
        severity: "positive",
        metric: `ACWR: ${fmtNum(acwr, 2)}`,
      });
    }

    if (tsb < -20) {
      insights.push({
        icon: "😴",
        title: "Deutliche Ermüdung",
        body: `Deine Training Stress Balance (TSB) liegt bei ${fmtNum(tsb, 1)} und zeigt eine deutlich angesammelte Ermüdung. Erwäge einen Erholungstag oder eine leichtere Einheit.`,
        severity: "warning",
        metric: `TSB: ${fmtNum(tsb, 1)}`,
      });
    } else if (tsb > 15) {
      insights.push({
        icon: "⚡",
        title: "Frisch und leistungsbereit",
        body: `Dein TSB liegt bei +${fmtNum(tsb, 1)} — ein Zeichen, dass du gut erholt bist. Ein guter Zeitpunkt für eine Schlüsseleinheit oder ein Rennen.`,
        severity: "positive",
        metric: `TSB: +${fmtNum(tsb, 1)}`,
      });
    }

    if (rampRate > 8) {
      insights.push({
        icon: "📈",
        title: "Schneller Belastungsanstieg",
        body: `Deine Trainingsbelastung steigt um ${fmtNum(rampRate, 1)} Punkte pro Woche. Eine Ramp Rate über 8 erhöht das Übertrainingsrisiko. Erwäge eine ruhigere Woche.`,
        severity: "warning",
        metric: `Ramp: ${fmtNum(rampRate, 1)}/Wo.`,
      });
    }
  }

  // Sleep coach insight
  if (data.sleepCoach) {
    const sleepDebt = data.sleepCoach.sleepDebtMinutes as number;
    const insight = data.sleepCoach.insight as string;
    const recommendedBedtime = data.sleepCoach.recommendedBedtime as
      | string
      | undefined;

    if (sleepDebt > 60) {
      const bedtimeHint = recommendedBedtime
        ? ` Versuch, bis ${recommendedBedtime} Uhr ins Bett zu gehen.`
        : "";
      insights.push({
        icon: "🛏️",
        title: "Schlafdefizit wächst",
        body: `Du hast ${sleepDebt} Minuten Schlafdefizit.${bedtimeHint}`,
        severity: "warning",
        metric: `${sleepDebt} Min. Defizit`,
      });
    } else if (insight) {
      insights.push({
        icon: "🌙",
        title: "Schlaf-Coach",
        body: insight,
        severity: "info",
      });
    }
  }

  // Recovery time
  if (data.recovery) {
    const hours = data.recovery.hoursUntilRecovered as number;
    const severity: InsightCard["severity"] = hours > 48 ? "warning" : "info";
    insights.push({
      icon: hours > 48 ? "🔋" : "⏱️",
      title: "Geschätzte Erholungszeit",
      body: `Geschätzte ${hours} Stunden bis zur vollständigen Erholung nach deiner letzten Einheit.`,
      severity,
      metric: `${hours} Std.`,
    });
  }

  // HRV long-term trend
  if (data.hrvTrend) {
    const direction = data.hrvTrend.direction as string;
    const percentChange = data.hrvTrend.percentChange as number;

    if (direction === "declining" || direction === "down") {
      insights.push({
        icon: "💓",
        title: "HRV sinkt",
        body: `Deine HRV sinkt (${fmtNum(Math.abs(percentChange), 1)} % Veränderung). Das kann auf angesammelten Stress oder unzureichende Erholung hindeuten.`,
        severity: "warning",
        metric: `${fmtNum(percentChange, 1)} %`,
      });
    } else if (direction === "improving" || direction === "up") {
      insights.push({
        icon: "💓",
        title: "HRV steigt",
        body: `Deine HRV entwickelt sich positiv (+${fmtNum(Math.abs(percentChange), 1)} %), ein Zeichen für gute Erholung und Anpassung.`,
        severity: "positive",
        metric: `+${fmtNum(Math.abs(percentChange), 1)} %`,
      });
    }
  }

  // Training status
  if (data.trainingStatus) {
    const status = data.trainingStatus.status as string;
    const recommendation = data.trainingStatus.recommendation as
      | string
      | undefined;
    const explanation = data.trainingStatus.explanation as string;

    const severity: InsightCard["severity"] =
      status === "productive" || status === "peaking"
        ? "positive"
        : status === "overreaching" ||
            status === "detraining" ||
            status === "unproductive"
          ? "warning"
          : "info";

    insights.push({
      icon:
        status === "productive"
          ? "🚀"
          : status === "peaking"
            ? "🏆"
            : status === "recovery"
              ? "🧘"
              : "📋",
      title: `Status: ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      body: recommendation ?? explanation,
      severity,
    });
  }

  // Sort by severity (alerts first)
  return insights.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

/* ─────────────── InsightCard component ─────────────── */

function InsightCardUI({ insight }: { insight: InsightCard }) {
  const style = SEVERITY_STYLES[insight.severity];
  return (
    <div className={cn("rounded-2xl border p-4", style.border, style.bg)}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg",
            style.iconBg,
          )}
        >
          {insight.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{insight.title}</h3>
            {insight.metric && (
              <span className="text-muted-foreground shrink-0 text-xs font-medium tabular-nums">
                {insight.metric}
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
            {insight.body}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── page ─────────────── */

export default function InsightsPage() {
  const trpc = useTRPC();
  const timezone = useUserTimezone();
  const queryClient = useQueryClient();

  // Proactive AI insights — refetch every 5 minutes to catch post-sync updates
  const proactiveInsights = useQuery({
    ...trpc.proactive.listInsights.queryOptions(),
    refetchInterval: 5 * 60 * 1000,
  });
  const generateMutation = useMutation(
    trpc.proactive.generateInsights.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.proactive.listInsights.queryKey(),
        });
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  // Auto-generate insights on first load when none exist
  const hasAutoGenerated = useRef(false);
  useEffect(() => {
    if (
      !hasAutoGenerated.current &&
      !proactiveInsights.isLoading &&
      proactiveInsights.data &&
      proactiveInsights.data.length === 0 &&
      !generateMutation.isPending
    ) {
      hasAutoGenerated.current = true;
      generateMutation.mutate();
    }
  }, [proactiveInsights.isLoading, proactiveInsights.data, generateMutation]);
  const markReadMutation = useMutation(
    trpc.proactive.markRead.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.proactive.listInsights.queryKey(),
        });
      },
    }),
  );

  const readiness = useQuery(trpc.readiness.getToday.queryOptions());
  const loads = useQuery(trpc.analytics.getTrainingLoads.queryOptions());
  const sleepCoach = useQuery(trpc.sleep.getCoach.queryOptions());
  const recovery = useQuery(trpc.analytics.getRecoveryTime.queryOptions());
  const hrvTrend = useQuery(
    trpc.trends.getLongTermTrend.queryOptions({ metric: "hrv", period: "30d" }),
  );
  const trainingStatus = useQuery(
    trpc.analytics.getTrainingStatus.queryOptions(),
  );
  const summary = useQuery(
    trpc.trends.getSummary.queryOptions({ period: "7d" }),
  );

  // Show the skeleton only during the *initial* fetch of every query. Once
  // any of them errors or returns, we drop out so the page is never stuck on
  // a perpetual placeholder. Previously a single hanging query (e.g. when
  // the analytics endpoint timed out) left four skeletons spinning forever.
  const isLoading =
    readiness.isPending &&
    loads.isPending &&
    sleepCoach.isPending &&
    recovery.isPending &&
    trainingStatus.isPending;

  const insights = useMemo(() => {
    return generateInsights({
      readiness:
        (readiness.data as Record<string, unknown> | undefined) ?? null,
      loads: (loads.data as Record<string, unknown> | undefined) ?? null,
      sleepCoach:
        (sleepCoach.data as unknown as Record<string, unknown> | undefined) ??
        null,
      recovery: (recovery.data as Record<string, unknown> | undefined) ?? null,
      hrvTrend:
        (hrvTrend.data as unknown as Record<string, unknown> | undefined) ??
        null,
      trainingStatus:
        (trainingStatus.data as unknown as
          | Record<string, unknown>
          | undefined) ?? null,
      summary: (summary.data as Record<string, unknown> | undefined) ?? null,
    });
  }, [
    readiness.data,
    loads.data,
    sleepCoach.data,
    recovery.data,
    hrvTrend.data,
    trainingStatus.data,
    summary.data,
  ]);

  const summaryData = summary.data as
    | Record<string, unknown>
    | null
    | undefined;

  return (
    <div className="bg-background min-h-screen">
      <PageShell density="reading">
        <div className="space-y-4">
        {/* ── Header ── */}
        <div>
          <h1 className="pl-12 text-2xl font-bold">Insights</h1>
          <p className="text-muted-foreground text-sm">
            {formatDateInTz(new Date(), timezone, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>

        {/* ── Proactive AI Insights ── */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <SectionHeader
              title="KI-Insights"
              info="Proaktive Insights, erzeugt durch evidenzbasierte Regeln, die deinen ACWR, TSB, deine HRV-Abweichung von der Baseline, dein Schlafdefizit, deine Ramp Rate und Interventionsmuster analysieren. Regeln lösen aus, wenn Schwellenwerte überschritten werden. Die Konfidenz spiegelt die Vollständigkeit der Daten wider."
            />
            <button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="rounded-lg bg-blue-500/20 px-3 py-1 text-xs font-medium text-blue-400 hover:bg-blue-500/30 disabled:opacity-50"
            >
              {generateMutation.isPending ? "Wird analysiert…" : "Insights aktualisieren"}
            </button>
          </div>
          {proactiveInsights.isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="bg-card animate-pulse rounded-2xl border p-4"
                >
                  <div className="bg-muted h-4 w-2/3 rounded" />
                  <div className="bg-muted mt-2 h-3 w-full rounded" />
                </div>
              ))}
            </div>
          ) : proactiveInsights.data && proactiveInsights.data.length > 0 ? (
            <div className="space-y-3">
              {(proactiveInsights.data as ProactiveInsight[]).map((insight) => (
                <ProactiveInsightCard
                  key={insight.id}
                  insight={insight}
                  onMarkRead={(id) => markReadMutation.mutate({ id })}
                />
              ))}
            </div>
          ) : (
            <div className="bg-card rounded-2xl border p-4 text-center">
              <p className="text-muted-foreground text-sm">
                Noch keine KI-Insights. Tippe auf „Insights aktualisieren“,
                um die Analyse zu starten.
              </p>
            </div>
          )}
        </div>

        {/* ── What's working for you (learning loop) ── */}
        <WhatsWorkingCard />

        {/* ── Weekly Summary ── */}
        {summary.isLoading ? (
          <div className="bg-card animate-pulse rounded-2xl border p-4">
            <div className="bg-muted h-4 w-32 rounded" />
            <div className="mt-3 grid-metrics">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-muted h-14 rounded-lg" />
              ))}
            </div>
          </div>
        ) : summaryData ? (
          <div className="bg-card rounded-2xl border p-4">
            <SectionHeader
              title="Diese Woche"
              info="Wochenübersicht, die zentrale Metriken mit deinen persönlichen 30-Tage-Baselines vergleicht. Grün = besser als der Durchschnitt, Rot = darunter. Methode: Mittelwert der aktuellen Woche vs. 30-Tage-EMA-Baseline je Metrik (Schlaf, Aktivität, RHR, Stress, HRV). Schwelle: Abweichung >0,5 SD wird markiert. Quelle: Individuelles Monitoring mittels Z-Scores (Buchheit 2014)."
              className="mb-3"
            />
            <div className="grid-metrics">
              {summaryData.totalDays != null && (
                <div className="bg-muted/60 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-blue-400">
                    {summaryData.totalDays as number}
                  </p>
                  <p className="text-foreground/80 mt-0.5 text-[11px]">
                    Erfasste Tage
                  </p>
                </div>
              )}
              {summaryData.avgReadiness != null && (
                <div className="bg-muted/60 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-green-400">
                    {Math.round(summaryData.avgReadiness as number)}
                  </p>
                  <p className="text-foreground/80 mt-0.5 text-[11px]">
                    Ø Readiness
                  </p>
                </div>
              )}
              {summaryData.avgSleepMinutes != null && (
                <div className="bg-muted/60 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-purple-400">
                    {fmtNum((summaryData.avgSleepMinutes as number) / 60, 1)}h
                  </p>
                  <p className="text-foreground/80 mt-0.5 text-[11px]">
                    Ø Schlaf
                  </p>
                </div>
              )}
              {summaryData.avgHrv != null && (
                <div className="bg-muted/60 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-pink-400">
                    {Math.round(summaryData.avgHrv as number)}
                  </p>
                  <p className="text-foreground/80 mt-0.5 text-[11px]">
                    Ø HRV
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* ── Insight Cards ── */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="bg-card animate-pulse rounded-2xl border p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="bg-muted h-9 w-9 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <div className="bg-muted h-4 w-2/3 rounded" />
                    <div className="bg-muted h-3 w-full rounded" />
                    <div className="bg-muted h-3 w-3/4 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : insights.length > 0 ? (
          <div className="space-y-3">
            <SectionHeader
              title="Tägliche Insights"
              info="Auffällige Muster und Anomalien Tag für Tag. Methode: Markiert Tage, an denen Metriken um >2 SD von der persönlichen 30-Tage-Baseline abweichen (Z-Score-Analyse). Sowohl positive Erfolge als auch Auffälligkeiten werden hervorgehoben. Anomaliequellen: HRV-Ausschläge, ungewöhnlicher RHR, Schlafstörungen, Änderungen der Trainingsbelastung. Quelle: Plews et al. (2013) HRV-Monitoring."
            />
            {insights.map((insight, i) => (
              <InsightCardUI key={i} insight={insight} />
            ))}
          </div>
        ) : (
          <div className="bg-card rounded-2xl border p-6 text-center">
            <p className="text-3xl">🔍</p>
            <p className="text-muted-foreground mt-2 text-sm">
              Noch keine Insights verfügbar. Sobald mehr Daten vorliegen,
              erscheinen hier deine persönlichen Insights.
            </p>
          </div>
        )}

        </div>

        <BottomNav />
      </PageShell>
    </div>
  );
}
