"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { VersionBadge } from "~/components/version-badge";
import { env } from "~/env";
import {
  formatDateInTz,
  getGreeting,
  useUserTimezone,
} from "~/lib/format-date";
import { fmtNum } from "~/lib/format-number";
import { useTRPC } from "~/trpc/react";
import { AdherenceTrendCard } from "./adherence-trend-card";
import { BottomNav } from "./bottom-nav";
import { DailyOutlookCard } from "./daily-outlook-card";
import { IngressLink as Link } from "./ingress-link";
import { QuickStats } from "./quick-stats";
import { ReadinessCard } from "./readiness-card";
import { getReadinessComponent } from "./readiness-helpers";
import { TodayRecommendationCard } from "./today-recommendation-card";
import { WorkoutCard } from "./workout-card";

export function DashboardHome({ userId }: { userId: string }) {
  const trpc = useTRPC();
  const timezone = useUserTimezone();
  const greeting = getGreeting(new Date(), timezone);
  const queryClient = useQueryClient();
  const version = env.NEXT_PUBLIC_APP_VERSION;
  const buildTime = env.NEXT_PUBLIC_BUILD_TIME;

  const readiness = useQuery(trpc.readiness.getToday.queryOptions());
  const workout = useQuery(trpc.workout.getToday.queryOptions());
  const recentActivities = useQuery(trpc.activity.getRecent.queryOptions());

  const adjustMutation = useMutation(
    trpc.workout.adjustDifficulty.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.workout.getToday.queryKey(),
        });
      },
    }),
  );

  const r = readiness.data as Record<string, unknown> | null | undefined;
  const w = workout.data as Record<string, unknown> | null | undefined;

  // Extract readiness component (0-100 scale each).
  // Cached DB rows use top-level fields (e.g. hrvComponent);
  // freshly computed results nest under components.xxx; legacy
  // Garmin-native rows preserve scores only in the factors JSONB.
  // See readiness-helpers.ts for the lookup priority.

  const sleepRaw = getReadinessComponent(
    r,
    "sleepQuantityComponent",
    "sleepQuantity",
  );
  const hrvRaw = getReadinessComponent(r, "hrvComponent", "hrv");
  const loadRaw = getReadinessComponent(
    r,
    "trainingLoadComponent",
    "trainingLoad",
  );
  const stressRaw = getReadinessComponent(r, "stressComponent", "stress");

  const sleepVal = sleepRaw != null ? Math.round(sleepRaw) : null;
  const hrvVal = hrvRaw != null ? Math.round(hrvRaw) : null;
  const loadVal = loadRaw != null ? Math.round(loadRaw) : null;
  const stressVal = stressRaw != null ? Math.round(stressRaw) : null;

  // All components are 0-100. Thresholds based on readiness engine z-score mapping:
  // 70+ = good recovery, 40-69 = moderate, <40 = concern
  type ZoneInfo = {
    zone: "good" | "caution" | "concern";
    label: string;
    scale: number;
  };

  function classifySleep(v: number): ZoneInfo {
    if (v >= 70) return { zone: "good", label: "Gut", scale: v };
    if (v >= 40) return { zone: "caution", label: "Mittel", scale: v };
    return { zone: "concern", label: "Schlecht", scale: v };
  }

  function classifyHrv(v: number): ZoneInfo {
    if (v >= 65) return { zone: "good", label: "Optimal", scale: v };
    if (v >= 35) return { zone: "caution", label: "Moderat", scale: v };
    return { zone: "concern", label: "Niedrig", scale: v };
  }

  function classifyLoad(v: number): ZoneInfo {
    if (v >= 60) return { zone: "good", label: "Ausgeglichen", scale: v };
    if (v >= 30) return { zone: "caution", label: "Aufbauend", scale: v };
    return { zone: "concern", label: "Hohe Belastung", scale: v };
  }

  function classifyStress(v: number): ZoneInfo {
    // Higher score = less stress = better
    if (v >= 60) return { zone: "good", label: "Niedrig", scale: v };
    if (v >= 30) return { zone: "caution", label: "Moderat", scale: v };
    return { zone: "concern", label: "Hoch", scale: v };
  }

  const sleepCtx = sleepVal != null ? classifySleep(sleepVal) : null;
  const hrvCtx = hrvVal != null ? classifyHrv(hrvVal) : null;
  const loadCtx = loadVal != null ? classifyLoad(loadVal) : null;
  const stressCtx = stressVal != null ? classifyStress(stressVal) : null;

  const stats = [
    {
      label: "Schlaf",
      value: sleepVal != null ? `${sleepVal}` : null,
      unit: "/100",
      icon: "😴",
      scale: sleepCtx?.scale,
      zone: sleepCtx?.zone,
      zoneLabel: sleepCtx?.label,
    },
    {
      label: "HRV",
      value: hrvVal != null ? `${hrvVal}` : null,
      unit: "/100",
      icon: "💓",
      scale: hrvCtx?.scale,
      zone: hrvCtx?.zone,
      zoneLabel: hrvCtx?.label,
    },
    {
      label: "Load",
      value: loadVal != null ? `${loadVal}` : null,
      unit: "/100",
      icon: "🔥",
      scale: loadCtx?.scale,
      zone: loadCtx?.zone,
      zoneLabel: loadCtx?.label,
    },
    {
      label: "Stress",
      value: stressVal != null ? `${stressVal}` : null,
      unit: "/100",
      icon: "🧘",
      scale: stressCtx?.scale,
      zone: stressCtx?.zone,
      zoneLabel: stressCtx?.label,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header (pl-12 clears the fixed mobile hamburger button) */}
      <div>
        <h1 className="pl-12 text-2xl font-bold">{greeting}</h1>
        <p className="text-muted-foreground text-sm">
          {formatDateInTz(new Date(), timezone, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      {/* Readiness — the lede: how ready am I today */}
      <ReadinessCard
        score={(r?.score as number) ?? null}
        zone={(r?.zone as string) ?? null}
        explanation={(r?.explanation as string) ?? null}
        confidence={(r?.confidence as number) ?? null}
        dataQuality={
          (r?.dataQuality as {
            hrv: "good" | "missing" | "stale";
            sleep: "good" | "missing" | "stale";
            restingHr: "good" | "missing" | "stale";
            trainingLoad: "good" | "missing" | "stale";
          }) ?? null
        }
        actionSuggestion={(r?.actionSuggestion as string) ?? null}
        doNotOverinterpret={(r?.doNotOverinterpret as boolean) ?? null}
        isLoading={readiness.isLoading}
      />

      {/* Today's Recommendation — what to do about it */}
      <TodayRecommendationCard userId={userId} />

      {/* Component breakdown */}
      <QuickStats stats={stats} />

      {/* Supporting panels — evenly weighted, no single card dominant */}
      <div className="grid-panels">
        <DailyOutlookCard
          targetStrain={
            (r?.targetStrain as import("@acme/engine").TargetStrainBand) ??
            null
          }
          isLoading={readiness.isLoading}
        />

        <WorkoutCard
          id={w?.id as string | undefined}
          title={(w?.title as string) ?? null}
          description={(w?.description as string) ?? null}
          sportType={(w?.sportType as string) ?? null}
          targetDurationMin={(w?.targetDurationMin as number) ?? null}
          targetDurationMax={(w?.targetDurationMax as number) ?? null}
          targetHrZoneLow={(w?.targetHrZoneLow as number) ?? null}
          targetHrZoneHigh={(w?.targetHrZoneHigh as number) ?? null}
          explanation={(w?.explanation as string) ?? null}
          isLoading={workout.isLoading}
          onAdjust={(direction) => adjustMutation.mutate({ direction })}
        />

        <AdherenceTrendCard userId={userId} />
      </div>

      {/* Quick Navigation */}
      <div className="grid-panels">
        <Link
          href="/fitness"
          className="bg-card hover:bg-accent flex items-center gap-3 rounded-xl border p-4 transition-colors"
        >
          <span className="text-2xl">🏃</span>
          <div>
            <p className="text-sm font-semibold">Fitness</p>
            <p className="text-muted-foreground text-xs">
              VO2max &amp; Wettkampfprognosen
            </p>
          </div>
        </Link>
        <Link
          href="/insights"
          className="bg-card hover:bg-accent flex items-center gap-3 rounded-xl border p-4 transition-colors"
        >
          <span className="text-2xl">💡</span>
          <div>
            <p className="text-sm font-semibold">Insights</p>
            <p className="text-muted-foreground text-xs">
              Tägliche Empfehlungen
            </p>
          </div>
        </Link>
      </div>

      {/* Recent Activities */}
      {recentActivities.data && recentActivities.data.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Letzte Aktivitäten</h2>
            <Link
              href="/activities"
              className="text-primary text-xs font-medium"
            >
              Alle anzeigen →
            </Link>
          </div>
          <div className="space-y-2">
            {recentActivities.data.slice(0, 3).map((a) => {
              const mins = a.durationMinutes;
              const dur =
                mins != null
                  ? mins >= 60
                    ? `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`
                    : `${Math.round(mins)} min`
                  : "—";
              const dist =
                a.distanceMeters != null && a.distanceMeters > 0
                  ? `${fmtNum(a.distanceMeters / 1000, 1)} km`
                  : null;
              const sport = a.sportType
                ? a.sportType
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (c: string) => c.toUpperCase())
                : "Aktivität";
              const date = formatDateInTz(a.startedAt, timezone, {
                weekday: "long",
                month: "long",
                day: "numeric",
              });
              return (
                <Link
                  key={a.id}
                  href={`/activities/${a.id}`}
                  className="bg-card hover:bg-accent flex items-center gap-3 rounded-xl p-3 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{sport}</p>
                    <p className="text-muted-foreground text-xs">{date}</p>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <p className="font-semibold">{dur}</p>
                    {dist && (
                      <p className="text-muted-foreground text-xs">{dist}</p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Coach FAB */}
      <Link
        href="/coach"
        className="bg-primary text-primary-foreground hover:bg-primary/90 fixed right-4 bottom-20 z-50 flex h-14 w-14 items-center justify-center rounded-full text-2xl shadow-lg transition-colors"
      >
        🏋️
      </Link>

      <VersionBadge
        version={version}
        buildTime={buildTime}
        className="fixed right-4 bottom-4 z-40"
      />

      <BottomNav />
    </div>
  );
}
