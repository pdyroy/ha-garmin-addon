"use client";

import { usePathname } from "next/navigation";

import { cn } from "@acme/ui";

import { IngressLink as Link } from "./ingress-link";
import { useIngressPath } from "./ingress-provider";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const navSections: NavSection[] = [
  {
    title: "Heute",
    items: [
      { href: "/", label: "Today", icon: "🏠" },
      { href: "/coach", label: "AI Coach", icon: "🤖" },
      { href: "/insights", label: "Insights", icon: "💡" },
    ],
  },
  {
    title: "Analyse",
    items: [
      { href: "/trends", label: "Trends", icon: "📊" },
      { href: "/training", label: "Training Load", icon: "💪" },
      { href: "/hrv", label: "HRV Analysis", icon: "💓" },
      { href: "/zones", label: "HR Zones", icon: "📶" },
      { href: "/fitness", label: "Fitness", icon: "🏋️" },
      { href: "/power", label: "Power", icon: "⚡" },
      { href: "/correlations", label: "Correlations", icon: "🔗" },
    ],
  },
  {
    title: "Protokoll",
    items: [
      { href: "/activities", label: "Activities", icon: "🏃" },
      { href: "/sleep", label: "Sleep", icon: "🌙" },
      { href: "/journal", label: "Journal", icon: "📓" },
      { href: "/interventions", label: "Interventions", icon: "💊" },
      { href: "/stress-board", label: "Stress Board", icon: "🚨" },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/validation", label: "Validation", icon: "📏" },
      { href: "/export", label: "Export", icon: "📤" },
      { href: "/team", label: "Team", icon: "👥" },
      { href: "/settings", label: "Settings", icon: "⚙️" },
    ],
  },
];

/** Matches a route against the current path, stripping the HA ingress base path prefix. */
export function useActivePath() {
  const pathname = usePathname();
  const ingressBase = useIngressPath();
  const stripped = ingressBase
    ? pathname.replace(ingressBase, "") || "/"
    : pathname;
  return (href: string) =>
    href === "/" ? stripped === "/" : stripped.startsWith(href);
}

/**
 * Fixed left navigation for sm+ viewports.
 * sm–lg: a 4rem icon rail that widens to 16rem (showing labels) on hover/focus.
 * lg+: always the full 16rem sidebar with section headings.
 */
export function AppNav() {
  const isActive = useActivePath();

  return (
    <nav
      aria-label="Main"
      className="bg-card border-border group fixed inset-y-0 left-0 z-40 hidden flex-col overflow-x-hidden overflow-y-auto border-r transition-[width] duration-200 sm:flex sm:w-16 sm:hover:w-64 sm:focus-within:w-64 lg:w-64"
    >
      <div className="flex flex-col gap-4 px-2 py-4">
        {navSections.map((section) => (
          <div key={section.title}>
            <h2 className="text-muted-foreground mb-1 px-3 text-xs font-medium tracking-wider whitespace-nowrap uppercase opacity-0 transition-opacity duration-200 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 lg:opacity-100">
              {section.title}
            </h2>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        active
                          ? "bg-primary/10 text-primary font-semibold"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <span className="shrink-0 text-base" aria-hidden="true">
                        {item.icon}
                      </span>
                      <span className="opacity-0 whitespace-nowrap transition-opacity duration-200 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 lg:opacity-100">
                        {item.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
