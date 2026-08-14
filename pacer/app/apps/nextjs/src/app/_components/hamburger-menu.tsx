"use client";

import { useEffect } from "react";

import { cn } from "@acme/ui";

import type { NavSection } from "./app-nav";
import { useActivePath } from "./app-nav";
import { IngressLink as Link } from "./ingress-link";

interface MoreMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: NavSection[];
}

/**
 * Bottom sheet listing the destinations that don't fit in the mobile bottom
 * bar. Opened by BottomNav's "Mehr" entry; state is owned by the caller so
 * navigating (which unmounts nothing under ingress full-page nav, but does
 * under client-side dev nav) can close it from outside.
 */
export function MoreMenu({ open, onOpenChange, sections }: MoreMenuProps) {
  const isActive = useActivePath();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <>
      {/* Dark overlay */}
      <div
        className={cn(
          "fixed inset-0 z-50 bg-black/50 transition-opacity duration-300 sm:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      {/* Slide-up sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Mehr"
        className={cn(
          "bg-card border-border fixed inset-x-0 bottom-0 z-50 flex max-h-[75vh] flex-col rounded-t-xl border-t transition-transform duration-300 ease-in-out sm:hidden",
          open ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <span className="text-foreground text-sm font-semibold">Mehr</span>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground flex h-11 w-11 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Menü schließen"
          >
            <span className="text-lg">✕</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {sections.map((section) => (
            <div key={section.title} className="mb-4">
              <h3 className="text-muted-foreground mb-1 px-2 text-xs font-medium tracking-wider uppercase">
                {section.title}
              </h3>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-11 items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                          active
                            ? "text-primary bg-primary/10 font-semibold"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        <span className="text-base" aria-hidden="true">
                          {item.icon}
                        </span>
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
