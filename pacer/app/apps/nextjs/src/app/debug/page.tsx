"use client";

/**
 * Debug / Data Consistency Page
 *
 * Surfaces drift between different sources of truth for the same metric.
 * This is the foundation for Phase 2 of the UX consistency overhaul
 * (see issue #87 in this repo).
 *
 * What it checks (so far):
 *   1. ACWR drift — live compute (analytics.getTrainingLoads) vs.
 *      cached daily snapshot (advancedMetrics.list latest).
 *   2. CTL / ATL drift — same two sources.
 *
 * Why this matters: the fitness dashboard ACWR gauge reads from one
 * source, while the chart and proactive insights read from another.
 * They can — and do — disagree. Anything > 0.05 absolute delta is
 * suspicious.
 */
import { useQuery } from "@tanstack/react-query";

import { PageShell } from "~/components/page-shell";
import { fmtDelta, fmtNum } from "~/lib/format-number";
import { useTRPC } from "~/trpc/react";
import { BottomNav } from "../_components/bottom-nav";
import { DataFreshness } from "../_components/data-freshness";

interface PmcEntry {
  date: string;
  ctl?: number | null;
  atl?: number | null;
  tsb?: number | null;
  acwr?: number | null;
}

function fmt(v: number | null | undefined, digits = 2): string {
  return fmtNum(v, digits);
}

function delta(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  if (a == null || b == null) return null;
  return a - b;
}

function statusBadge(d: number | null, tolerance: number): React.ReactNode {
  if (d == null) {
    return (
      <span className="bg-muted text-foreground rounded-full px-2 py-0.5 text-xs font-medium">
        ⚪ N/V
      </span>
    );
  }
  const abs = Math.abs(d);
  if (abs <= tolerance) {
    return (
      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        🟢 OK ({fmtDelta(d, 3)})
      </span>
    );
  }
  if (abs <= tolerance * 3) {
    return (
      <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
        🟡 Abweichung ({fmtDelta(d, 3)})
      </span>
    );
  }
  return (
    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
      🔴 Unstimmigkeit ({fmtDelta(d, 3)})
    </span>
  );
}

export default function DebugPage() {
  const trpc = useTRPC();

  const loads = useQuery(trpc.analytics.getTrainingLoads.queryOptions());
  // @ts-ignore — route added by gc-backend branch
  const pmc = useQuery(trpc.advancedMetrics.list.queryOptions({ days: 1 }));

  const liveAcwr = loads.data?.acwr ?? null;
  const liveCtl = loads.data?.ctl ?? null;
  const liveAtl = loads.data?.atl ?? null;

  const cachedLatest = ((pmc.data ?? []) as PmcEntry[])[0] ?? null;
  const cachedAcwr = cachedLatest?.acwr ?? null;
  const cachedCtl = cachedLatest?.ctl ?? null;
  const cachedAtl = cachedLatest?.atl ?? null;

  const acwrDelta = delta(liveAcwr, cachedAcwr);
  const ctlDelta = delta(liveCtl, cachedCtl);
  const atlDelta = delta(liveAtl, cachedAtl);

  const isLoading = loads.isLoading || pmc.isLoading;
  const error = loads.error ?? pmc.error;

  return (
    <PageShell density="data">
      <div className="space-y-4">
      <div>
        <h1 className="pl-12 text-2xl font-bold">
          🔧 Debug — Datenkonsistenz
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Direkter Vergleich derselben Metrik aus unterschiedlichen Quellen.
          Alles außer 🟢 bedeutet, dass die Dashboard-Karten voneinander
          abweichen können.
        </p>
        <div className="mt-1">
          <DataFreshness
            computedAt={loads.data?.computedAt}
            prefix="Live-Werte berechnet"
          />
        </div>
      </div>

      {isLoading && (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          Lädt…
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          Fehler beim Laden der Daten: {error.message}
        </div>
      )}

      {!isLoading && !error && (
        <>
          <div className="grid-panels">
          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-lg font-semibold">
              ACWR (Acute:Chronic Workload Ratio)
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Toleranz: ±0,05. Größere Abweichung = Anzeige und Diagramm
              stimmen nicht überein.
            </p>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Quelle</th>
                  <th className="py-1">Endpunkt</th>
                  <th className="py-1 text-right">Wert</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="py-1">Live-Berechnung</td>
                  <td className="py-1 font-mono text-xs">
                    analytics.getTrainingLoads
                  </td>
                  <td className="py-1 text-right font-mono">{fmt(liveAcwr)}</td>
                </tr>
                <tr className="border-t">
                  <td className="py-1">Zwischengespeichert (letzter Tag)</td>
                  <td className="py-1 font-mono text-xs">
                    advancedMetrics.list[0]
                  </td>
                  <td className="py-1 text-right font-mono">
                    {fmt(cachedAcwr)}
                  </td>
                </tr>
                <tr className="border-t bg-muted">
                  <td className="py-1 font-semibold">Delta</td>
                  <td className="py-1"></td>
                  <td className="py-1 text-right">
                    {statusBadge(acwrDelta, 0.05)}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-lg font-semibold">
              CTL (Chronic Training Load)
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Toleranz: ±1,0 TSS-äquivalente Einheiten.
            </p>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-t">
                  <td className="py-1">Live-Berechnung</td>
                  <td className="py-1 text-right font-mono">
                    {fmt(liveCtl, 1)}
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="py-1">Zwischengespeichert (letzter Tag)</td>
                  <td className="py-1 text-right font-mono">
                    {fmt(cachedCtl, 1)}
                  </td>
                </tr>
                <tr className="border-t bg-muted">
                  <td className="py-1 font-semibold">Delta</td>
                  <td className="py-1 text-right">
                    {statusBadge(ctlDelta, 1.0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-lg font-semibold">ATL (Acute Training Load)</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Toleranz: ±1,0 TSS-äquivalente Einheiten.
            </p>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-t">
                  <td className="py-1">Live-Berechnung</td>
                  <td className="py-1 text-right font-mono">
                    {fmt(liveAtl, 1)}
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="py-1">Zwischengespeichert (letzter Tag)</td>
                  <td className="py-1 text-right font-mono">
                    {fmt(cachedAtl, 1)}
                  </td>
                </tr>
                <tr className="border-t bg-muted">
                  <td className="py-1 font-semibold">Delta</td>
                  <td className="py-1 text-right">
                    {statusBadge(atlDelta, 1.0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
          </div>

          <section className="rounded-lg border bg-primary/10 p-4 text-sm">
            <h2 className="mb-2 font-semibold">📖 So liest du das</h2>
            <ul className="list-inside list-disc space-y-1 text-foreground">
              <li>
                <strong>🟢 OK</strong> — Quellen stimmen innerhalb der Toleranz
                überein, das Dashboard sollte konsistent sein.
              </li>
              <li>
                <strong>🟡 Abweichung</strong> — kleine Diskrepanz (vermutlich
                Rundung / asynchrones Snapshot-Timing). Meist unbedenklich,
                aber beobachtenswert.
              </li>
              <li>
                <strong>🔴 Unstimmigkeit</strong> — deutliche Abweichung. Die
                Anzeige und das Diagramm auf der Fitness-Seite werden sichtbar
                nicht übereinstimmen. Cache-Alter oder Berechnungsunterschiede
                prüfen.
              </li>
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Siehe dazu Issues #86 (Audit), #87 (Validierungs-Tooling) und #88
              (Refactor) in diesem Repo.
            </p>
          </section>
        </>
      )}
      </div>

      <BottomNav />
    </PageShell>
  );
}
