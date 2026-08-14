"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@acme/ui/button";

import { IngressLink as Link } from "~/app/_components/ingress-link";
import { PageShell } from "~/components/page-shell";
import { useTRPC } from "~/trpc/react";

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
          <p className="text-muted-foreground">Workout not found.</p>
          <Link href="/" className="text-primary mt-4 inline-block text-sm">
            ← Back to Today
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
      <Link href="/" className="text-muted-foreground text-sm hover:underline">
        ← Back
      </Link>

      {/* Title */}
      <div>
        <h1 className="pl-12 text-2xl font-bold">{w.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {w.sportType} · Zone {w.targetHrZoneLow}
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
            Why This Today
          </p>
          <p className="text-foreground/80 text-sm">{w.explanation}</p>
        </div>
      )}

      {/* Workout Structure */}
      <div className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
          Workout Structure
        </h2>
        {structure.map((block, i) => (
          <div key={i} className="bg-card rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-semibold uppercase">
                {block.phase === "warmup"
                  ? "🔥 Warm-up"
                  : block.phase === "main"
                    ? "🎯 Main Set"
                    : "❄️ Cool-down"}
              </span>
              <span className="text-muted-foreground text-xs">
                {block.durationMinutes} min
                {block.hrZone ? ` · Zone ${block.hrZone}` : ""}
              </span>
            </div>
            <p className="text-foreground mt-1 text-sm">{block.description}</p>
          </div>
        ))}
      </div>

      {/* Target Metrics */}
      <div className="bg-card rounded-xl border p-4">
        <h2 className="text-muted-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
          Target Metrics
        </h2>
        <div className="grid-metrics text-sm">
          <div>
            <span className="text-muted-foreground">Duration</span>
            <p className="font-medium">
              {w.targetDurationMin}–{w.targetDurationMax} min
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">HR Zone</span>
            <p className="font-medium">
              Zone {w.targetHrZoneLow}
              {w.targetHrZoneLow !== w.targetHrZoneHigh
                ? `–${w.targetHrZoneHigh}`
                : ""}
            </p>
          </div>
          {w.targetStrainLow != null && (
            <div>
              <span className="text-muted-foreground">Target Strain</span>
              <p className="font-medium">
                {w.targetStrainLow}–{w.targetStrainHigh}
              </p>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Status</span>
            <p className="font-medium capitalize">{w.status}</p>
          </div>
        </div>
      </div>

      <Button className="w-full" size="lg">
        🎯 Start Workout
      </Button>
      </div>
    </PageShell>
  );
}
