"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { cn } from "@acme/ui";

import { useActivePath, useNavSections } from "./app-nav";
import { MoreMenu } from "./hamburger-menu";
import { IngressLink as Link } from "./ingress-link";

/** How many sections fit in the bar before the rest move behind "Mehr". */
const PRIMARY_SECTION_COUNT = 5;

export function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const isActive = useActivePath();
  const pathname = usePathname();
  const sections = useNavSections();

  // Same sections as the sidebar: the first five in the bar, the remainder
  // (with their tabs listed out) in the sheet behind "Mehr".
  const primarySections = sections.slice(0, PRIMARY_SECTION_COUNT);
  const moreSections = sections.slice(PRIMARY_SECTION_COUNT);

  // Close the "Mehr" sheet on route change (matters outside ingress, where
  // navigation is client-side and this component stays mounted).
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Spacer so the fixed nav never overlaps page content on mobile.
          Height matches the nav: 48px button + py-1 wrapper (8px) +
          safe-area-inset-bottom. Hidden on sm+ where the nav is hidden. */}
      <div
        aria-hidden="true"
        className="h-[calc(3.5rem+env(safe-area-inset-bottom))] sm:hidden"
      />
      <nav
        aria-label="Hauptnavigation"
        className="bg-card border-border fixed right-0 bottom-0 left-0 z-50 border-t pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        <div className="mx-auto flex max-w-md items-center justify-around px-1 py-1">
          {primarySections.map((section) => {
            // A section's entry lights up for any of its tabs, not just its
            // landing page.
            const active = section.items.some((tab) => isActive(tab.href));
            return (
              <Link
                key={section.title}
                href={section.items[0].href}
                aria-current={active ? "page" : undefined}
                aria-label={section.title}
                className={cn(
                  "focus-visible:ring-primary flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none",
                  active
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="text-lg" aria-hidden="true">
                  {section.icon}
                </span>
                <span className="max-[379px]:hidden">{section.title}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="Mehr"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-primary flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <span className="text-lg" aria-hidden="true">
              ⋯
            </span>
            <span className="max-[379px]:hidden">Mehr</span>
          </button>
        </div>
      </nav>
      <MoreMenu
        open={moreOpen}
        onOpenChange={setMoreOpen}
        sections={moreSections}
      />
    </>
  );
}
