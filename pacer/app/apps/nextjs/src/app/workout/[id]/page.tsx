"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@acme/ui/button";

import { IngressLink as Link } from "~/app/_components/ingress-link";
import { PageShell } from "~/components/page-shell";
import { sportLabel } from "~/lib/sport-labels";
import { useTRPC } from "~/trpc/react";

// Raw sportType codes (e.g. "strength_training") reach this page
// unhumanized — see DailyWorkout.getDetail in packages/api. Map known
// codes to a German display label; codes are matched in code elsewhere
// and must stay untouched.
// ponytail: known sport codes only, unmapped ones fall back to a
// naive title-case of the code.
// DAILY_WORKOUT_STATUSES in packages/db/src/schema.ts — display only,
// the raw status string is still what's stored/compared everywhere else.
const STATUS_LABELS_DE: Record<string, string> = {
  planned: "Geplant",
  completed: "Abgeschlossen",
  partial: "Teilweise",
  missed: "Verpasst",
  extra: "Zusätzlich",
  skipped: "Übersprungen",
};

function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return STATUS_LABELS_DE[status] ?? status;
}

export default function WorkoutDetailPage() {
  const params = useParams<{ id: string }>();
  const trpc = useTRPC();

  const workout = useQuery(
    trpc.workout.getDetail.queryOptions({ id: params.id }),
  );

  const w = workout.data;

  if (workout.isLoading) {
    return (
      <PageShell density="data">
        <div className="space-y-4">
          <div className="bg-muted h-8 w-48 animate-pulse rounded" />
          <div className="bg-muted h-64 animate-pulse rounded-2xl" />
        </div>
      </PageShell>
    );
  }

  if (!w) {
    return (
      <PageShell density="data">
        <div className="text-center">
          <p className="text-muted-foreground">Workout nicht gefunden.</p>
          <Link href="/" className="text-primary mt-4 inline-block text-sm">
            ← Zurück zu Heute
          </Link>
        </div>
      </PageShell>
    );
  }

  const structure =
    (w.structure as {
      phase: string;
      description: string;
      durationMinutes: number;
      hrZone?: number;
    }[]) ?? [];

  return (
    <PageShell density="data">
      <div className="space-y-6">
        {/* Back */}
        <Link
          href="/"
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Zurück
        </Link>

        {/* Title */}
        <div>
          <h1 className="pl-12 text-2xl font-bold">{w.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {sportLabel(w.sportType)} · Zone {w.targetHrZoneLow}
            {w.targetHrZoneLow !== w.targetHrZoneHigh
              ? `–${w.targetHrZoneHigh}`
              : ""}{" "}
            · {w.targetDurationMin}–{w.targetDurationMax} min
          </p>
        </div>

        {/* Why This Today */}
        {w.explanation && (
          <div className="bg-primary/5 border-primary/20 rounded-xl border p-4">
            <p className="text-primary mb-1 text-xs font-semibold tracking-wider uppercase">
              Warum heute
            </p>
            <p className="text-foreground/80 text-sm">{w.explanation}</p>
          </div>
        )}

        {/* Workout Structure */}
        <div className="space-y-3">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
            Workout-Aufbau
          </h2>
          {structure.map((block, i) => (
            <div key={i} className="bg-card rounded-xl border p-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs font-semibold uppercase">
                  {block.phase === "warmup"
                    ? "🔥 Aufwärmen"
                    : block.phase === "main"
                      ? "🎯 Hauptteil"
                      : "❄️ Abkühlen"}
                </span>
                <span className="text-muted-foreground text-xs">
                  {block.durationMinutes} min
                  {block.hrZone ? ` · Zone ${block.hrZone}` : ""}
                </span>
              </div>
              <p className="text-foreground mt-1 text-sm">
                {block.description}
              </p>
            </div>
          ))}
        </div>

        {/* Target Metrics */}
        <div className="bg-card rounded-xl border p-4">
          <h2 className="text-muted-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
            Zielwerte
          </h2>
          <div className="grid-metrics text-sm">
            <div>
              <span className="text-muted-foreground">Dauer</span>
              <p className="font-medium">
                {w.targetDurationMin}–{w.targetDurationMax} min
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">HF-Zone</span>
              <p className="font-medium">
                Zone {w.targetHrZoneLow}
                {w.targetHrZoneLow !== w.targetHrZoneHigh
                  ? `–${w.targetHrZoneHigh}`
                  : ""}
              </p>
            </div>
            {w.targetStrainLow != null && (
              <div>
                <span className="text-muted-foreground">Ziel-Strain</span>
                <p className="font-medium">
                  {w.targetStrainLow}–{w.targetStrainHigh}
                </p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Status</span>
              <p className="font-medium">{statusLabel(w.status)}</p>
            </div>
          </div>
        </div>

        <Button className="w-full" size="lg">
          🎯 Workout starten
        </Button>
      </div>
    </PageShell>
  );
}
