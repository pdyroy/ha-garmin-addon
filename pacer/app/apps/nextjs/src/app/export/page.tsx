"use client";

// Data Export & Portability
import { useQuery } from "@tanstack/react-query";

import { Button } from "@acme/ui/button";
import { toast } from "@acme/ui/toast";

import { PageShell } from "~/components/page-shell";
import { formatDateInTz, useUserTimezone } from "~/lib/format-date";
import { useTRPC } from "~/trpc/react";
import { BottomNav } from "../_components/bottom-nav";

/* ─────────────── helpers ─────────────── */

function exportToCSV(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) {
    toast.error("Keine Daten zum Exportieren");
    return;
  }
  const headers = Object.keys(data[0]!);
  const rows = data.map((row) =>
    headers
      .map((h) => {
        const val = row[h];
        const str = val == null ? "" : String(val);
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      })
      .join(","),
  );
  const csv = [headers.join(","), ...rows].join("\n");
  triggerDownload(new Blob([csv], { type: "text/csv" }), filename);
}

function exportToJSON(data: unknown, filename: string) {
  const json = JSON.stringify(data, null, 2);
  triggerDownload(new Blob([json], { type: "application/json" }), filename);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatDateForFilename() {
  return new Date().toISOString().slice(0, 10);
}

/* ─────────────── page ─────────────── */

export default function ExportPage() {
  const trpc = useTRPC();
  const timezone = useUserTimezone();

  // Data queries
  const activities = useQuery(trpc.activity.list.queryOptions({ days: 365 }));
  const trendsSummary = useQuery(
    trpc.trends.getSummary.queryOptions({ period: "28d" }),
  );
  const journalQuery = useQuery(
    trpc.journal.list.queryOptions({
      startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
    }),
  );
  const advancedMetrics = useQuery(
    trpc.advancedMetrics.list.queryOptions({ days: 365 }),
  );
  const hrvData = useQuery(trpc.hrv.getAnalysis.queryOptions({ days: 365 }));

  /* ── Data summary counts ── */
  const activityCount = activities.data?.length ?? 0;
  const journalCount = journalQuery.data?.length ?? 0;
  const advMetricCount = Array.isArray(advancedMetrics.data)
    ? advancedMetrics.data.length
    : 0;
  const hrvDayCount = hrvData.data?.daily?.length ?? 0;

  const earliestDate = activities.data?.length
    ? [...(activities.data as { startedAt?: Date | string | null }[])]
        .filter((a) => a.startedAt != null)
        .sort(
          (a, b) =>
            new Date(a.startedAt as string).getTime() -
            new Date(b.startedAt as string).getTime(),
        )[0]?.startedAt
    : null;

  /* ── Export handlers ── */
  function handleExportActivities() {
    if (!activities.data) return toast.error("Aktivitätsdaten noch nicht geladen");
    exportToCSV(
      activities.data as Record<string, unknown>[],
      `pacer-activities-${formatDateForFilename()}.csv`,
    );
  }

  function handleExportMetrics() {
    const summary = trendsSummary.data;
    if (!summary) return toast.error("Metrikdaten noch nicht geladen");
    const rows = [summary as Record<string, unknown>];
    exportToCSV(rows, `pacer-metrics-${formatDateForFilename()}.csv`);
  }

  function handleExportJournal() {
    if (!journalQuery.data) return toast.error("Journaldaten noch nicht geladen");
    exportToCSV(
      journalQuery.data as Record<string, unknown>[],
      `pacer-journal-${formatDateForFilename()}.csv`,
    );
  }

  function handleExportAdvancedMetrics() {
    if (!advancedMetrics.data || !Array.isArray(advancedMetrics.data))
      return toast.error("Erweiterte Metriken noch nicht geladen");
    exportToCSV(
      advancedMetrics.data as Record<string, unknown>[],
      `pacer-advanced-metrics-${formatDateForFilename()}.csv`,
    );
  }

  function handleExportHrv() {
    const d = hrvData.data;
    if (!d?.daily?.length) return toast.error("HRV-Daten noch nicht geladen");

    const rolling7dByDate = new Map(d.rolling7d.map((r) => [r.date, r.value]));
    const rolling14dByDate = new Map(
      d.rolling14d.map((r) => [r.date, r.value]),
    );

    const rows = d.daily.map((pt, i) => ({
      date: pt.date,
      hrv_ms: pt.value,
      rolling_7d: rolling7dByDate.get(pt.date) ?? "",
      rolling_14d: rolling14dByDate.get(pt.date) ?? "",
      baseline: i === d.daily.length - 1 ? d.baseline : "",
      cv_pct: i === d.daily.length - 1 ? d.cv : "",
    }));
    exportToCSV(
      rows as unknown as Record<string, unknown>[],
      `pacer-hrv-${formatDateForFilename()}.csv`,
    );
  }

  function handleFullExport() {
    const payload = {
      schemaVersion: "1.1",
      exportedAt: new Date().toISOString(),
      activities: activities.data ?? [],
      metrics: trendsSummary.data ?? {},
      advancedMetrics: advancedMetrics.data ?? [],
      hrv: hrvData.data ?? {},
      journal: journalQuery.data ?? [],
    };
    exportToJSON(payload, `pacer-backup-${formatDateForFilename()}.json`);
  }

  return (
    <PageShell density="reading">
      <div className="space-y-4">
      {/* ── Header ── */}
      <div>
        <h1 className="pl-12 text-2xl font-bold">Datenexport</h1>
        <p className="text-muted-foreground text-sm">
          Trainingsdaten herunterladen · Backups importieren
        </p>
      </div>

      {/* ── Data Summary ── */}
      <div className="bg-card rounded-2xl border p-4">
        <h2 className="mb-3 text-sm font-semibold tracking-wider uppercase">
          Deine Daten
        </h2>
        {activities.isLoading ? (
          <div className="bg-muted h-12 animate-pulse rounded-lg" />
        ) : (
          <div className="grid-metrics text-center">
            <div className="bg-secondary/40 rounded-xl p-3">
              <p className="text-xl font-bold">{activityCount}</p>
              <p className="text-muted-foreground text-xs">Aktivitäten</p>
            </div>
            <div className="bg-secondary/40 rounded-xl p-3">
              <p className="text-xl font-bold">{journalCount}</p>
              <p className="text-muted-foreground text-xs">Journaleinträge</p>
            </div>
            <div className="bg-secondary/40 rounded-xl p-3">
              <p className="truncate text-sm font-bold">
                {earliestDate
                  ? formatDateInTz(earliestDate, timezone, {
                      month: "short",
                      year: "numeric",
                    })
                  : "—"}
              </p>
              <p className="text-muted-foreground text-xs">Älteste Daten</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Export Cards ── */}
      <div className="grid-panels">
        <div className="bg-card space-y-3 rounded-2xl border p-4">
          <div>
            <p className="font-semibold">Tägliche Metriken</p>
            <p className="text-muted-foreground mt-0.5 text-xs">CSV-Export</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={trendsSummary.isLoading}
            onClick={handleExportMetrics}
          >
            CSV herunterladen
          </Button>
        </div>

        <div className="bg-card space-y-3 rounded-2xl border p-4">
          <div>
            <p className="font-semibold">Aktivitäten</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {activityCount} Einträge · CSV
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={activities.isLoading}
            onClick={handleExportActivities}
          >
            CSV herunterladen
          </Button>
        </div>

        <div className="bg-card space-y-3 rounded-2xl border p-4">
          <div>
            <p className="font-semibold">Journal</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {journalCount} Einträge · CSV
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={journalQuery.isLoading}
            onClick={handleExportJournal}
          >
            CSV herunterladen
          </Button>
        </div>

        <div className="bg-card space-y-3 rounded-2xl border p-4">
          <div>
            <p className="font-semibold">Erweiterte Metriken</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {advMetricCount} Tage · CTL/ATL/TSB/ACWR · CSV
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={advancedMetrics.isLoading}
            onClick={handleExportAdvancedMetrics}
          >
            CSV herunterladen
          </Button>
        </div>

        <div className="bg-card space-y-3 rounded-2xl border p-4">
          <div>
            <p className="font-semibold">HRV-Analyse</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {hrvDayCount} Tage · Gleitender Durchschnitt + CV% · CSV
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={hrvData.isLoading}
            onClick={handleExportHrv}
          >
            CSV herunterladen
          </Button>
        </div>
      </div>

      {/* ── Full JSON Backup ── */}
      <div className="bg-card space-y-3 rounded-2xl border p-4">
        <div>
          <h2 className="font-semibold">Vollständiger Datenexport (JSON)</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Aktivitäten, Journal und Metriken in einer einzigen Backup-Datei
            mit Schemaversion und Zeitstempel.
          </p>
        </div>
        <Button
          className="w-full"
          disabled={activities.isLoading || journalQuery.isLoading}
          onClick={handleFullExport}
        >
          JSON-Backup herunterladen
        </Button>
      </div>

      {/* ── Import (Coming Soon) ── */}
      <div className="bg-card space-y-3 rounded-2xl border p-4 opacity-75">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Aus Datei importieren</h2>
          <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-[10px] font-semibold text-yellow-600 dark:text-yellow-400">
            Demnächst
          </span>
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Der Import folgt in einem zukünftigen Update. Du wirst damit
          JSON-Backups wiederherstellen können, die aus dieser App exportiert
          wurden.
        </p>
      </div>
      </div>

      <BottomNav />
    </PageShell>
  );
}
