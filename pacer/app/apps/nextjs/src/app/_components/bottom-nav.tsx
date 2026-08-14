"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { cn } from "@acme/ui";

import type { NavItem } from "./app-nav";
import { navSections, useActivePath } from "./app-nav";
import { MoreMenu } from "./hamburger-menu";
import { IngressLink as Link } from "./ingress-link";

/** The five most-used destinations, always visible below `sm`. */
const primaryItems: NavItem[] = [
  { href: "/", label: "Today", icon: "🏠" },
  { href: "/trends", label: "Trends", icon: "📊" },
  { href: "/training", label: "Training Load", icon: "💪" },
  { href: "/sleep", label: "Sleep", icon: "🌙" },
  { href: "/coach", label: "AI Coach", icon: "🤖" },
];

const primaryHrefs = new Set(primaryItems.map((item) => item.href));

/** Everything not in the bottom bar, grouped the same way as the sidebar. */
const moreSections = navSections
  .map((section) => ({
    ...section,
    items: section.items.filter((item) => !primaryHrefs.has(item.href)),
  }))
  .filter((section) => section.items.length > 0);

export function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const isActive = useActivePath();
  const pathname = usePathname();

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
        aria-label="Main"
        className="bg-card border-border fixed right-0 bottom-0 left-0 z-50 border-t pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        <div className="mx-auto flex max-w-md items-center justify-around px-1 py-1">
          {primaryItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                className={cn(
                  "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  active
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="text-lg" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="max-[379px]:hidden">{item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="Mehr"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className="text-muted-foreground hover:text-foreground flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
