"use client";

import { useQuery } from "@tanstack/react-query";

import { cn } from "@acme/ui";

import { formatDateInTz, useUserTimezone } from "~/lib/format-date";
import { useTRPC } from "~/trpc/react";
import { DataFreshness } from "./data-freshness";

/* ── readiness zone styling ─────────────────────────────────────── */
function readinessZone(score: number | null): {
  label: string;
  className: string;
} {
  if (score == null) return { label: "—", className: "text-muted-foreground" };
  if (score >= 80) return { label: "Top", className: "text-emerald-400" };
  if (score >= 60) return { label: "Gut", className: "text-green-400" };
  if (score >= 40) return { label: "Mittel", className: "text-yellow-400" };
  if (score >= 20) return { label: "Niedrig", className: "text-orange-400" };
  return { label: "Schwach", className: "text-red-400" };
}

function trendChip(trend: "rising" | "falling" | "stable" | null): {
  symbol: string;
  className: string;
} {
  if (trend === "rising") return { symbol: "▲", className: "text-emerald-400" };
  if (trend === "falling") return { symbol: "▼", className: "text-red-400" };
  if (trend === "stable") return { symbol: "▶", className: "text-blue-400" };
  return { symbol: "—", className: "text-muted-foreground" };
}

// Display-only German labels for the trend enum — the enum values
// themselves (used above for comparisons) stay untouched.
const TREND_LABELS: Record<string, string> = {
  rising: "steigend",
  falling: "fallend",
  stable: "stabil",
};

/* ── component ──────────────────────────────────────────────────── */
export function GarminTrainingSummary() {
  const trpc = useTRPC();
  const timezone = useUserTimezone();
  const summary = useQuery(
    trpc.garmin.getTrainingSummary.queryOptions({ days: 14 }),
  );

  if (summary.isLoading) {
    return <div className="bg-muted h-32 animate-pulse rounded-2xl" />;
  }

  const latest = summary.data?.latest;
  if (!latest) {
    return (
      <div className="bg-card text-muted-foreground rounded-2xl border p-4 text-sm">
        Noch keine Garmin-Trainingszusammenfassung — synchronisiere dein
        Gerät, um Readiness, Erholung und HRV zu befüllen.
      </div>
    );
  }

  const todayKey = formatDateInTz(new Date(), timezone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const staleCaption = (date: string | null | undefined) => {
    if (!date) return null;
    // `date` is YYYY-MM-DD from the API. Anchor at noon in the *target*
    // timezone (not UTC) so we don't drift a day at UTC±12. We do this by
    // building the ISO timestamp `${date}T12:00:00` and parsing it as local
    // (no Z), then formatting with `timeZone: timezone`.
    const local = new Date(`${date}T12:00:00`);
    const dateKey = formatDateInTz(local, timezone, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    if (dateKey === todayKey) return null;
    return `Stand ${formatDateInTz(local, timezone, {
      month: "short",
      day: "numeric",
    })}`;
  };

  const readiness = readinessZone(latest.garminTrainingReadiness ?? null);
  const readinessAsOf = staleCaption(
    summary.data?.latestDates.garminTrainingReadiness,
  );
  const recoveryAsOf = staleCaption(
    summary.data?.latestDates.garminRecoveryHours,
  );
  // Only show the status date when the status itself is available — falling
  // back to garminTrainingReadinessLevel's date here would attach an unrelated
  // timestamp to an "unavailable" status (e.g. rendering
  // "unavailable · as of Mon May 12" when the status column is genuinely null).
  const statusAsOf = staleCaption(
    summary.data?.latestDates.garminTrainingStatus,
  );
  const trend = trendChip(
    (summary.data?.hrvTrend as "rising" | "falling" | "stable" | null) ?? null,
  );

  return (
    <div className="bg-card space-y-3 rounded-2xl border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide uppercase">
          Garmin Native (Firstbeat)
        </h2>
        <DataFreshness computedAt={summary.data?.computedAt} />
      </div>
      <p className="text-muted-foreground -mt-1 text-xs leading-relaxed">
        Direkt von den Firstbeat-Algorithmen deiner Uhr. Erfordert Forerunner
        245+, Fenix 6+ oder ein vergleichbares Modell. Den von uns
        berechneten Readiness-Score, der HRV, Ruhepuls und Schlaf nutzt und
        mit jedem Gerät funktioniert, findest du auf der Startseite.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Training Readiness */}
        <div className="bg-background/40 rounded-lg p-3">
          <div className="text-muted-foreground text-[10px] tracking-wide uppercase">
            Readiness
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className={cn("text-2xl font-bold", readiness.className)}>
              {latest.garminTrainingReadiness ?? "—"}
            </span>
            {latest.garminTrainingReadiness != null && (
              <span className="text-muted-foreground text-xs">/100</span>
            )}
          </div>
          <div className={cn("mt-0.5 text-xs", readiness.className)}>
            {readiness.label}
            {readinessAsOf && (
              <span className="text-muted-foreground"> · {readinessAsOf}</span>
            )}
          </div>
        </div>

        {/* Recovery Time */}
        <div className="bg-background/40 rounded-lg p-3">
          <div className="text-muted-foreground text-[10px] tracking-wide uppercase">
            Erholung
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-bold">
              {latest.garminRecoveryHours != null
                ? Math.round(latest.garminRecoveryHours)
                : "—"}
            </span>
            {latest.garminRecoveryHours != null && (
              <span className="text-muted-foreground text-xs">h</span>
            )}
          </div>
          <div className="text-muted-foreground mt-0.5 text-xs">
            verbleibend{recoveryAsOf ? ` · ${recoveryAsOf}` : ""}
          </div>
        </div>

        {/* Training Status */}
        <div className="bg-background/40 rounded-lg p-3">
          <div className="text-muted-foreground text-[10px] tracking-wide uppercase">
            Status
          </div>
          <div
            className={cn(
              "mt-1 text-lg leading-snug font-semibold capitalize",
              !latest.garminTrainingStatus && "text-muted-foreground/70",
            )}
          >
            {latest.garminTrainingStatus
              ? latest.garminTrainingStatus.toLowerCase().replace(/_/g, " ")
              : "Nicht verfügbar"}
          </div>
          <div className="text-muted-foreground mt-0.5 text-xs">
            {latest.garminTrainingStatus
              ? (latest.garminTrainingReadinessLevel?.toLowerCase() ?? "")
              : "nicht verfügbar"}
            {statusAsOf ? ` · ${statusAsOf}` : ""}
          </div>
        </div>

        {/* HRV (weekly avg + trend) */}
        <div className="bg-background/40 rounded-lg p-3">
          <div className="text-muted-foreground text-[10px] tracking-wide uppercase">
            HRV (14 T.)
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-bold">
              {summary.data?.hrvAvg ?? "—"}
            </span>
            {summary.data?.hrvAvg != null && (
              <span className="text-muted-foreground text-xs">ms</span>
            )}
          </div>
          <div className={cn("mt-0.5 text-xs", trend.className)}>
            {trend.symbol}{" "}
            {summary.data?.hrvTrend
              ? (TREND_LABELS[summary.data.hrvTrend] ?? summary.data.hrvTrend)
              : "kein Trend"}
          </div>
        </div>
      </div>
    </div>
  );
}
