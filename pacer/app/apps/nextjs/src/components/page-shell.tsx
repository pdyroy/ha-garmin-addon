import type { ReactNode } from "react";

import { cn } from "@acme/ui";

import { SectionTabs } from "~/app/_components/section-tabs";

const DENSITY_STYLES = {
  /** Prose surfaces (coach, insights, journal, settings) — capped for readable line length. */
  reading: "max-w-[70ch]",
  /** Dense numbers/charts (training, trends, vitals) — capped so wide data doesn't stretch thin. */
  data: "max-w-[1400px]",
} as const;

interface PageShellProps {
  density: keyof typeof DENSITY_STYLES;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Shared wrapper every page renders its content into, replacing each page's
 * own ad-hoc `max-w-*` + padding. Reserves layout space for the fixed left
 * sidebar (16rem, from `lg`) and the bottom nav bar (4rem, below `sm`) via
 * padding on this wrapper — never margins on children — and caps content
 * width per `density`.
 */
export function PageShell({
  density,
  title,
  description,
  children,
  className,
}: PageShellProps) {
  return (
    <main
      className={cn(
        // Left padding clears the navigation at each of its three widths:
        // nothing below sm, the 4rem icon rail from sm, the 16rem sidebar
        // from lg. Without the sm step content sat underneath the rail on
        // tablet widths.
        //
        // Bottom padding is breathing room only. Clearance for the mobile bar
        // comes from the spacer BottomNav renders itself, which every page
        // has whether or not it uses this shell — reserving it here as well
        // produced a double gap on the migrated pages.
        "px-4 pt-6 pb-10 sm:px-6 sm:pl-[calc(4rem+1.5rem)] lg:pr-8 lg:pl-[calc(16rem+2rem)]",
        className,
      )}
    >
      <div className={cn("mx-auto", DENSITY_STYLES[density])}>
        <SectionTabs />
        {(title ?? description) && (
          <div className="mb-8">
            {title && <h1 className="text-2xl font-bold">{title}</h1>}
            {description && (
              <p className="text-muted-foreground mt-1 text-sm">
                {description}
              </p>
            )}
          </div>
        )}
        {children}
      </div>
    </main>
  );
}
