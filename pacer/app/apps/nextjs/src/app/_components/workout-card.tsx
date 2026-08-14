"use client";

import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";

import { IngressLink as Link } from "./ingress-link";

interface WorkoutCardProps {
  id?: string;
  title: string | null;
  description: string | null;
  sportType: string | null;
  targetDurationMin: number | null;
  targetDurationMax: number | null;
  targetHrZoneLow: number | null;
  targetHrZoneHigh: number | null;
  explanation: string | null;
  isLoading?: boolean;
  onAdjust?: (direction: "harder" | "easier") => void;
}

const sportEmoji: Record<string, string> = {
  running: "🏃",
  cycling: "🚴",
  strength: "💪",
  swimming: "🏊",
  rest: "😴",
};

export function WorkoutCard({
  id,
  title,
  description,
  sportType,
  targetDurationMin,
  targetDurationMax,
  targetHrZoneLow,
  targetHrZoneHigh,
  explanation,
  isLoading,
  onAdjust,
}: WorkoutCardProps) {
  if (isLoading) {
    return (
      <div className="bg-card animate-pulse rounded-2xl border p-6">
        <div className="bg-muted h-6 w-1/2 rounded" />
        <div className="bg-muted mt-3 h-4 w-3/4 rounded" />
        <div className="bg-muted mt-3 h-4 w-1/2 rounded" />
      </div>
    );
  }

  if (!title) {
    return (
      <div className="bg-card rounded-2xl border p-6 text-center">
        <p className="text-muted-foreground">Heute ist kein Workout geplant.</p>
      </div>
    );
  }

  const emoji = sportEmoji[sportType ?? ""] ?? "🎯";
  const isRest = sportType === "rest";

  return (
    <div className="bg-card space-y-4 rounded-2xl border p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wider uppercase">
            Heutiges Workout
          </p>
          <h3 className="text-lg font-semibold">
            {emoji} {title}
          </h3>
        </div>
        {id && !isRest && (
          <Link
            href={`/workout/${id}`}
            className="text-primary text-sm font-medium hover:underline"
          >
            Details ansehen →
          </Link>
        )}
      </div>

      {!isRest && (
        <div className="text-muted-foreground flex gap-4 text-sm">
          {targetDurationMin != null && targetDurationMax != null && (
            <span>
              ⏱ {targetDurationMin}–{targetDurationMax} min
            </span>
          )}
          {targetHrZoneLow != null && targetHrZoneHigh != null && (
            <span>
              ❤️ Zone {targetHrZoneLow}
              {targetHrZoneLow !== targetHrZoneHigh
                ? `–${targetHrZoneHigh}`
                : ""}
            </span>
          )}
        </div>
      )}

      {explanation && (
        <p className="text-foreground/70 text-sm">{explanation}</p>
      )}

      {!isRest && onAdjust && (
        <div className="flex gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAdjust("easier")}
          >
            😴 Zu müde
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAdjust("harder")}
          >
            💪 Fühle mich frisch
          </Button>
        </div>
      )}
    </div>
  );
}
