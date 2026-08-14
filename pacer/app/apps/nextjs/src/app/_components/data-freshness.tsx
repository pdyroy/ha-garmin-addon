"use client";

/**
 * DataFreshness — a tiny inline timestamp chip.
 *
 * Renders nothing if `computedAt` is missing; otherwise shows a short
 * relative timestamp like "updated 3m ago" so users can tell at a glance
 * whether a metric is live or stale. Used wherever we want to give a
 * card credibility without a full tooltip.
 *
 * Re-computes every 60s while mounted.
 */
import { useEffect, useState } from "react";

import {
  formatDateInTz,
  formatTimeInTz,
  useUserTimezone,
} from "~/lib/format-date";

function format(deltaMs: number): string {
  if (deltaMs < 0) return "gerade eben";
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return "gerade eben";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return `vor ${days} Tagen`;
}

interface Props {
  computedAt?: Date | string | null;
  className?: string;
  prefix?: string;
}

export function DataFreshness({
  computedAt,
  className = "",
  prefix = "aktualisiert",
}: Props) {
  const timezone = useUserTimezone();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!computedAt) return null;
  const ts =
    typeof computedAt === "string"
      ? new Date(computedAt).getTime()
      : computedAt.getTime();
  if (!Number.isFinite(ts)) return null;

  const absolute = `${formatDateInTz(computedAt, timezone, { month: "short", day: "numeric", year: "numeric" })} um ${formatTimeInTz(computedAt, timezone)}`;

  return (
    <span
      className={`text-muted-foreground text-[10px] ${className}`}
      title={absolute}
    >
      {prefix} {format(now - ts)}
    </span>
  );
}
