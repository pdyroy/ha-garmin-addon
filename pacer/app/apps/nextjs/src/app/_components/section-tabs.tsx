"use client";

import { cn } from "@acme/ui";

import { useActivePath, useNavSections } from "./app-nav";
import { IngressLink as Link } from "./ingress-link";

/**
 * Tab strip for the section the current route belongs to.
 *
 * The sidebar shows seven destinations; the pages inside a section reach each
 * other through this strip. Renders nothing for single-page sections (Heute,
 * Coach) and nothing for routes outside the navigation altogether — activity
 * detail, onboarding, the workout view.
 */
export function SectionTabs() {
  const sections = useNavSections();
  const isActive = useActivePath();

  const section = sections.find((s) => s.items.some((i) => isActive(i.href)));
  if (!section || section.items.length < 2) return null;

  return (
    <div className="-mx-1 mb-6 overflow-x-auto">
      <div
        role="tablist"
        aria-label={section.title}
        className="flex w-max gap-1 px-1"
      >
        {section.items.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              role="tab"
              aria-selected={active}
              className={cn(
                "focus-visible:ring-primary flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none",
                active
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
