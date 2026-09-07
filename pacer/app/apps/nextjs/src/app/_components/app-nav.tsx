"use client";

import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@acme/ui";

import { useTRPC } from "~/trpc/react";
import { IngressLink as Link } from "./ingress-link";
import { useIngressPath } from "./ingress-provider";

/**
 * `all` shows everything. `athlete` hides the pages that only make sense to
 * someone tracking health rather than performance, `health` hides the
 * performance analytics. Stored on Profile.audienceMode.
 */
type Audience = "athlete" | "health";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Omitted = shown in every audience. */
  audience?: Audience;
}

export interface NavSection {
  title: string;
  icon: string;
  /** First entry is the section's landing page; the rest are its tabs. */
  items: [NavItem, ...NavItem[]];
}

/**
 * Seven destinations, each grouping the pages that belong together.
 *
 * The routes themselves are unchanged — bookmarks and deep links still work.
 * What used to be twenty-two sidebar entries is now seven, with the rest
 * reachable as tabs inside the section (see SectionTabs, rendered by
 * PageShell). This list is the single source for the sidebar, the mobile bar
 * and those tabs; do not restate it anywhere else.
 */
const navSections: NavSection[] = [
  {
    title: "Heute",
    icon: "🏠",
    items: [{ href: "/", label: "Heute", icon: "🏠" }],
  },
  {
    title: "Training",
    icon: "💪",
    items: [
      { href: "/training", label: "Belastung", icon: "💪" },
      { href: "/zones", label: "HF-Zonen", icon: "📶", audience: "athlete" },
      { href: "/fitness", label: "Fitness", icon: "🏋️", audience: "athlete" },
      { href: "/power", label: "Power", icon: "⚡", audience: "athlete" },
    ],
  },
  {
    title: "Körper",
    icon: "💓",
    items: [
      { href: "/hrv", label: "HRV", icon: "💓" },
      { href: "/sleep", label: "Schlaf", icon: "🌙" },
      { href: "/vitals", label: "Vitalwerte", icon: "🩺", audience: "health" },
      { href: "/energy", label: "Energiekonto", icon: "🔋" },
      { href: "/stress-board", label: "Stress Board", icon: "🚨" },
    ],
  },
  {
    title: "Analyse",
    icon: "📊",
    items: [
      { href: "/trends", label: "Trends", icon: "📊" },
      { href: "/insights", label: "Insights", icon: "💡" },
      { href: "/correlations", label: "Korrelationen", icon: "🔗" },
    ],
  },
  {
    title: "Aktivitäten",
    icon: "🏃",
    items: [
      { href: "/activities", label: "Aktivitäten", icon: "🏃" },
      { href: "/journal", label: "Journal", icon: "📓" },
      { href: "/interventions", label: "Maßnahmen", icon: "💊" },
    ],
  },
  {
    title: "Coach",
    icon: "🤖",
    items: [{ href: "/coach", label: "KI-Coach", icon: "🤖" }],
  },
  {
    title: "Einstellungen",
    icon: "⚙️",
    items: [
      { href: "/settings", label: "Einstellungen", icon: "⚙️" },
      { href: "/export", label: "Export", icon: "📤" },
      { href: "/validation", label: "Validierung", icon: "📏" },
      { href: "/debug", label: "Diagnose", icon: "🔍" },
    ],
  },
];

/** One section as this audience sees it, or null if nothing in it survives. */
function forAudience(section: NavSection, audience: string): NavSection | null {
  if (audience !== "athlete" && audience !== "health") return section;
  const [first, ...rest] = section.items.filter(
    (item) => item.audience == null || item.audience === audience,
  );
  return first ? { ...section, items: [first, ...rest] } : null;
}

/**
 * The sections and tabs this user should see, per Profile.audienceMode.
 * Falls back to showing everything while the profile query is in flight, so
 * navigation never flickers items in.
 */
export function useNavSections(): NavSection[] {
  const trpc = useTRPC();
  const profile = useQuery(trpc.profile.get.queryOptions());
  const audience =
    (profile.data as { audienceMode?: string } | null | undefined)
      ?.audienceMode ?? "all";

  return navSections.flatMap((section) => forAudience(section, audience) ?? []);
}

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
 * lg+: always the full 16rem sidebar.
 */
export function AppNav() {
  const isActive = useActivePath();
  const sections = useNavSections();

  return (
    <nav
      aria-label="Hauptnavigation"
      className="bg-card border-border group fixed inset-y-0 left-0 z-40 hidden flex-col overflow-x-hidden overflow-y-auto border-r transition-[width] duration-200 sm:flex sm:w-16 sm:focus-within:w-64 sm:hover:w-64 lg:w-64"
    >
      <ul className="flex flex-col gap-0.5 px-2 py-4">
        {sections.map((section) => {
          // A section counts as active when any of its tabs is.
          const active = section.items.some((item) => isActive(item.href));
          return (
            <li key={section.title}>
              <Link
                href={section.items[0].href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-visible:ring-primary flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none",
                  active
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span className="shrink-0 text-base" aria-hidden="true">
                  {section.icon}
                </span>
                <span className="whitespace-nowrap opacity-0 transition-opacity duration-200 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 lg:opacity-100">
                  {section.title}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
