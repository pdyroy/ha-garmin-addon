// SPDX-FileCopyrightText: 2026 Anil Belur <askb23@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@acme/ui";

type VersionBadgeProps = {
  version: string;
  buildTime?: string;
  fullText?: boolean;
  className?: string;
};

export function VersionBadge({
  version,
  buildTime,
  fullText = false,
  className,
}: VersionBadgeProps) {
  const label =
    fullText && buildTime
      ? `Pacer App v${version} · erstellt ${buildTime}`
      : `v${version}`;

  return (
    <span
      className={cn(
        "text-muted-foreground text-xs opacity-80",
        className,
      )}
      title={buildTime ? `Erstellt ${buildTime}` : undefined}
    >
      {label}
    </span>
  );
}
