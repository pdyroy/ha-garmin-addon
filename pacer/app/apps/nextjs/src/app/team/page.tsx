"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import { toast } from "@acme/ui/toast";

import { PageShell } from "~/components/page-shell";
import { fmtDelta, fmtNum } from "~/lib/format-number";
import { useTRPC } from "~/trpc/react";
import { BottomNav } from "../_components/bottom-nav";

/* ─────────────── types ─────────────── */

interface SavedAthlete {
  name: string;
  url: string;
  lastReadiness: number | null;
}

const LS_KEY = "gc_saved_athletes";

function loadAthletes(): SavedAthlete[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as SavedAthlete[];
  } catch {
    return [];
  }
}

function saveAthletes(athletes: SavedAthlete[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(athletes));
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

/* ─────────────── page ─────────────── */

export default function TeamPage() {
  const trpc = useTRPC();

  const [athletes, setAthletes] = useState<SavedAthlete[]>([]);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [mounted, setMounted] = useState(false);

  // Current athlete data
  const profile = useQuery(trpc.profile.get.queryOptions());
  const readiness = useQuery(trpc.readiness.getToday.queryOptions());
  const loads = useQuery(trpc.analytics.getTrainingLoads.queryOptions());

  useEffect(() => {
    setAthletes(loadAthletes());
    setMounted(true);
  }, []);

  function addAthlete() {
    if (!newName.trim() || !newUrl.trim()) {
      toast.error("Name und URL sind erforderlich");
      return;
    }
    let url = newUrl.trim();
    try {
      const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
      if (!["http:", "https:"].includes(parsed.protocol))
        throw new Error("Invalid protocol");
      url = parsed.href;
    } catch {
      toast.error("Bitte gib eine gültige HTTP/HTTPS-URL ein");
      return;
    }
    const updated = [
      ...athletes,
      { name: newName.trim(), url, lastReadiness: null },
    ];
    setAthletes(updated);
    saveAthletes(updated);
    setNewName("");
    setNewUrl("");
    toast.success(`${newName} hinzugefügt`);
  }

  function removeAthlete(index: number) {
    const updated = athletes.filter((_, i) => i !== index);
    setAthletes(updated);
    saveAthletes(updated);
  }

  const athleteName =
    (profile.data as { name?: string | null } | null)?.name ?? "Athlet";
  const currentReadiness =
    (readiness.data as { score?: number | null } | null)?.score ?? null;
  const tsb = loads.data?.tsb ?? null;
  const acwr = loads.data?.acwr ?? null;

  return (
    <PageShell density="reading">
      <div className="space-y-4">
      {/* ── Header ── */}
      <div>
        <h1 className="pl-12 text-2xl font-bold">Team</h1>
        <p className="text-muted-foreground text-sm">Dashboard für mehrere Athleten</p>
      </div>

      {/* ── Current Athlete ── */}
      <div className="bg-card rounded-2xl border p-4">
        <h2 className="mb-3 text-sm font-semibold tracking-wider uppercase">
          Aktueller Athlet
        </h2>
        {profile.isLoading ? (
          <div className="flex items-center gap-4">
            <div className="bg-muted h-14 w-14 animate-pulse rounded-full" />
            <div className="space-y-2">
              <div className="bg-muted h-4 w-32 animate-pulse rounded" />
              <div className="bg-muted h-3 w-24 animate-pulse rounded" />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="bg-primary/20 text-primary flex h-14 w-14 items-center justify-center rounded-full text-xl font-bold">
              {initials(athleteName)}
            </div>
            <div>
              <p className="text-lg font-bold">{athleteName}</p>
              {currentReadiness != null && (
                <p className="text-muted-foreground text-sm">
                  Readiness:{" "}
                  <span
                    className={cn(
                      "font-semibold",
                      currentReadiness >= 70
                        ? "text-green-400"
                        : currentReadiness >= 50
                          ? "text-yellow-400"
                          : "text-red-400",
                    )}
                  >
                    {currentReadiness}
                  </span>
                </p>
              )}
            </div>
          </div>
        )}

        {/* Quick Stats */}
        <div className="grid-metrics mt-4 text-center">
          <div className="bg-secondary/40 rounded-xl p-3">
            <p
              className={cn(
                "text-xl font-bold",
                currentReadiness != null && currentReadiness >= 70
                  ? "text-green-400"
                  : currentReadiness != null && currentReadiness >= 50
                    ? "text-yellow-400"
                    : "text-red-400",
              )}
            >
              {currentReadiness ?? "—"}
            </p>
            <p className="text-muted-foreground text-xs">Readiness</p>
          </div>
          <div className="bg-secondary/40 rounded-xl p-3">
            <p
              className={cn(
                "text-xl font-bold",
                tsb != null && tsb >= 0 ? "text-green-400" : "text-red-400",
              )}
            >
              {fmtDelta(tsb, 0)}
            </p>
            <p className="text-muted-foreground text-xs">Form (TSB)</p>
          </div>
          <div className="bg-secondary/40 rounded-xl p-3">
            <p
              className={cn(
                "text-xl font-bold",
                acwr != null && acwr >= 0.8 && acwr <= 1.3
                  ? "text-green-400"
                  : acwr != null && acwr > 1.5
                    ? "text-red-400"
                    : "text-yellow-400",
              )}
            >
              {fmtNum(acwr, 2)}
            </p>
            <p className="text-muted-foreground text-xs">ACWR</p>
          </div>
        </div>
      </div>

      {/* ── Saved Athletes ── */}
      {mounted && (
        <div className="bg-card rounded-2xl border p-4">
          <h2 className="mb-3 text-sm font-semibold tracking-wider uppercase">
            Gespeicherte Athleten
          </h2>
          {athletes.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              Noch keine Athleten hinzugefügt. Füge unten eine Pacer-Instanz
              hinzu.
            </p>
          ) : (
            <div className="space-y-2">
              {athletes.map((athlete, i) => (
                <div
                  key={i}
                  className="bg-secondary/40 flex items-center justify-between rounded-xl px-3 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="bg-primary/20 text-primary flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold">
                      {initials(athlete.name)}
                    </div>
                    <div>
                      <p className="font-medium">{athlete.name}</p>
                      {athlete.lastReadiness != null && (
                        <p className="text-muted-foreground text-xs">
                          Letzte Readiness: {athlete.lastReadiness}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => window.open(athlete.url, "_blank")}
                    >
                      Ansehen →
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground h-7 px-2 text-xs hover:text-red-400"
                      onClick={() => removeAthlete(i)}
                    >
                      ✕
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Add Athlete ── */}
      <div className="bg-card space-y-3 rounded-2xl border p-4">
        <h2 className="text-sm font-semibold tracking-wider uppercase">
          Athlet hinzufügen
        </h2>
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Name des Athleten"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="bg-secondary/50 border-border focus:ring-primary/40 w-full rounded-xl border p-2.5 text-sm focus:ring-2 focus:outline-none"
          />
          <input
            type="url"
            placeholder="URL der Pacer-Instanz"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addAthlete()}
            className="bg-secondary/50 border-border focus:ring-primary/40 w-full rounded-xl border p-2.5 text-sm focus:ring-2 focus:outline-none"
          />
          <Button className="w-full" onClick={addAthlete}>
            Athlet speichern
          </Button>
        </div>
      </div>

      {/* ── About Team Mode ── */}
      <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4">
        <h2 className="mb-2 text-sm font-semibold text-blue-400">
          ℹ️ Über den Team-Modus
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Der Team-Modus verbindet mehrere Pacer-Instanzen. Jeder Athlet
          betreibt sein eigenes Addon — füge hier dessen Ingress-URL hinzu, um
          schnell zwischen den Dashboards zu wechseln. Die Athletendaten werden
          lokal in deinem Browser gespeichert.
        </p>
      </div>

      </div>

      <BottomNav />
    </PageShell>
  );
}
