"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@acme/ui/button";
import { toast } from "@acme/ui/toast";

import { PageShell } from "~/components/page-shell";
import { fmtDelta, fmtNum } from "~/lib/format-number";
import { useTRPC } from "~/trpc/react";
import { BottomNav } from "../_components/bottom-nav";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEASUREMENT_TYPES = [
  { key: "lab_vo2max", emoji: "🔬", label: "Labor-VO2max" },
  { key: "lactate_threshold", emoji: "🩸", label: "Laktatschwelle" },
  { key: "body_composition", emoji: "⚖️", label: "Körperzusammensetzung" },
  { key: "chest_strap_hr", emoji: "❤️", label: "Brustgurt-Herzfrequenz" },
  { key: "ecg_hrv", emoji: "📊", label: "EKG-HRV" },
  { key: "sleep_lab", emoji: "🛏️", label: "Schlaflabor" },
] as const;

type MeasurementTypeKey = (typeof MEASUREMENT_TYPES)[number]["key"];

const MEASUREMENT_UNITS: Record<MeasurementTypeKey, string> = {
  lab_vo2max: "ml/kg/min",
  lactate_threshold: "bpm",
  body_composition: "%",
  chest_strap_hr: "bpm",
  ecg_hrv: "ms",
  sleep_lab: "min",
};

const GARMIN_LABEL: Record<MeasurementTypeKey, string> = {
  lab_vo2max: "Von Garmin geschätztes VO2max an diesem Datum",
  lactate_threshold: "Von Garmin geschätzte Laktatschwellen-HF an diesem Datum",
  body_composition: "Körperzusammensetzung (%) von Garmin an diesem Datum",
  chest_strap_hr: "Durchschnittliche HF von Garmin an diesem Datum",
  ecg_hrv: "HRV von Garmin an diesem Datum",
  sleep_lab: "Gesamtschlafminuten von Garmin an diesem Datum",
};

function today(): string {
  return new Date().toISOString().split("T")[0]!;
}

function deviationBadge(pct: number | null | undefined): React.ReactNode {
  if (pct == null) return null;
  const abs = Math.abs(pct);
  if (abs < 5)
    return (
      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        🟢 Ausgezeichnet ({fmtDelta(pct, 1)}%)
      </span>
    );
  if (abs < 10)
    return (
      <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
        🟡 Gut ({fmtDelta(pct, 1)}%)
      </span>
    );
  if (abs < 15)
    return (
      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
        🟠 Mäßig ({fmtDelta(pct, 1)}%)
      </span>
    );
  return (
    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
      🔴 Schwach ({fmtDelta(pct, 1)}%)
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface RvcRow {
  date: string;
  raw: number;
  computed: number;
  deltaPct: number | null;
  status: "match" | "minor" | "diverged" | "invalid";
}

const RVC_STATUS_STYLE: Record<RvcRow["status"], string> = {
  match: "bg-green-100 text-green-700",
  minor: "bg-yellow-100 text-yellow-700",
  diverged: "bg-red-100 text-red-700",
  invalid: "bg-muted text-muted-foreground",
};

const RVC_STATUS_LABEL: Record<RvcRow["status"], string> = {
  match: "🟢 Übereinstimmung",
  minor: "🟡 Gering",
  diverged: "🔴 Abweichend",
  invalid: "⚪ Außerhalb des Bereichs",
};

function RawVsComputedTable({
  title,
  hint,
  rows,
  unit,
}: {
  title: string;
  hint: string;
  rows: RvcRow[];
  unit: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="text-foreground text-sm font-semibold">{title}</h3>
      <p className="text-muted-foreground mb-2 text-xs">{hint}</p>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Datum</th>
              <th className="px-2 py-1.5 text-right font-medium">Garmin</th>
              <th className="px-2 py-1.5 text-right font-medium">Engine</th>
              <th className="px-2 py-1.5 text-right font-medium">Δ</th>
              <th className="px-2 py-1.5 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((r) => (
              <tr key={r.date} className="border-t">
                <td className="px-2 py-1.5">{r.date}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {fmtNum(r.raw, 1)}
                  {unit}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {fmtNum(r.computed, 1)}
                  {unit}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {r.deltaPct == null ? "—" : `${fmtDelta(r.deltaPct, 1)}%`}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${RVC_STATUS_STYLE[r.status]}`}
                  >
                    {RVC_STATUS_LABEL[r.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ValidationPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [selectedType, setSelectedType] =
    useState<MeasurementTypeKey>("lab_vo2max");
  const [date, setDate] = useState(today());
  const [value, setValue] = useState("");
  const [garminValue, setGarminValue] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const unit = MEASUREMENT_UNITS[selectedType];

  const { data: measurements = [], isLoading } = useQuery(
    trpc.reference.list.queryOptions(),
  );

  const { data: rawVsComputed } = useQuery(
    trpc.dataQuality.getRawVsComputed.queryOptions({ days: 30 }),
  );

  const createMutation = useMutation(
    trpc.reference.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.reference.list.queryFilter());
        setValue("");
        setGarminValue("");
        setNotes("");
        toast.success("Referenzmessung gespeichert");
      },
      onError: () => toast.error("Messung konnte nicht gespeichert werden"),
    }),
  );

  const deleteMutation = useMutation(
    trpc.reference.delete.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.reference.list.queryFilter());
        setConfirmDelete(null);
        toast.success("Messung gelöscht");
      },
      onError: () => toast.error("Löschen fehlgeschlagen"),
    }),
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = parseFloat(value);
    if (isNaN(num)) return toast.error("Gib eine gültige Zahl ein");
    const garminNum = garminValue ? parseFloat(garminValue) : undefined;
    createMutation.mutate({
      measurementType: selectedType,
      date,
      value: num,
      unit,
      source: "manual",
      garminComparableValue: garminNum ?? null,
      notes: notes || null,
    });
  }

  // Match quality: average deviation % per type
  const matchQuality: Record<string, { sum: number; count: number }> = {};
  for (const m of measurements) {
    if (m.deviationPercent == null) continue;
    matchQuality[m.measurementType] ??= { sum: 0, count: 0 };
    matchQuality[m.measurementType]!.sum += Math.abs(m.deviationPercent);
    matchQuality[m.measurementType]!.count += 1;
  }

  return (
    <PageShell density="data">
      {/* Header (custom: pl-12 clears the fixed mobile hamburger button) */}
      <div className="mb-8">
        <h1 className="pl-12 text-2xl font-bold">Datenvalidierung</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Garmin-Schätzungen mit Referenzmessungen vergleichen
        </p>
      </div>

      <div className="space-y-4">
        {/* Engine vs Garmin — raw vs computed transparency */}
        {rawVsComputed && rawVsComputed.summary.comparedPairs > 0 && (
          <div className="bg-card rounded-xl border p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-foreground font-semibold">
                Engine vs. Garmin
              </h2>
              {rawVsComputed.summary.agreementPct != null && (
                <span className="text-muted-foreground text-xs">
                  {rawVsComputed.summary.agreementPct}% Übereinstimmung ·{" "}
                  {rawVsComputed.summary.comparedPairs} Paare
                </span>
              )}
            </div>
            <p className="text-muted-foreground mb-3 text-xs">
              Wie Pacers berechnete Metriken über die letzten 30 Tage mit den
              Rohwerten von Garmin übereinstimmen. Große Abweichungen zeigen,
              wo sich das Modell der Engine von Garmins unterscheidet —
              nützlich für Vertrauen und Fehlersuche.
            </p>
            <div className="space-y-4">
              <RawVsComputedTable
                title="Readiness"
                hint="Garmin Training Readiness vs. der Buchheit-Kompositwert."
                rows={rawVsComputed.readiness}
                unit=""
              />
              <RawVsComputedTable
                title="VO2max"
                hint="Offizielles Garmin VO2max vs. effektives VO2max der Engine."
                rows={rawVsComputed.vo2max}
                unit=""
              />
            </div>
          </div>
        )}

        {/* Add Reference Measurement */}
        <div className="bg-card rounded-xl border p-4 shadow-sm">
          <h2 className="text-foreground mb-3 font-semibold">
            Referenzmessung hinzufügen
          </h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Type selector */}
            <div className="grid-metrics">
              {MEASUREMENT_TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setSelectedType(t.key)}
                  className={`rounded-lg border p-2 text-center text-xs transition-colors ${
                    selectedType === t.key
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-border bg-card text-muted-foreground hover:border-border"
                  }`}
                >
                  <div className="text-lg">{t.emoji}</div>
                  <div className="mt-0.5 font-medium">{t.label}</div>
                </button>
              ))}
            </div>

            {/* Date */}
            <div>
              <label className="text-foreground mb-1 block text-sm font-medium">
                Datum
              </label>
              <input
                type="date"
                value={date}
                max={today()}
                onChange={(e) => setDate(e.target.value)}
                className="border-border w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Value + unit */}
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-foreground mb-1 block text-sm font-medium">
                  Referenzwert
                </label>
                <input
                  type="number"
                  step="any"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="z. B. 52,4"
                  className="border-border w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="w-28">
                <label className="text-foreground mb-1 block text-sm font-medium">
                  Einheit
                </label>
                <div className="border-border bg-muted text-muted-foreground flex h-[38px] items-center rounded-lg border px-3 text-sm">
                  {unit}
                </div>
              </div>
            </div>

            {/* Garmin comparable */}
            <div>
              <label className="text-foreground mb-1 block text-sm font-medium">
                {GARMIN_LABEL[selectedType]}{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </label>
              <input
                type="number"
                step="any"
                value={garminValue}
                onChange={(e) => setGarminValue(e.target.value)}
                placeholder={`Garmins ${unit}-Schätzung`}
                className="border-border w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="text-foreground mb-1 block text-sm font-medium">
                Notizen{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Laborbedingungen, Protokoll, Kontext…"
                className="border-border w-full resize-none rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            <Button
              type="submit"
              disabled={createMutation.isPending || !value}
              className="w-full"
            >
              {createMutation.isPending ? "Wird gespeichert…" : "Messung speichern"}
            </Button>
          </form>
        </div>

        {/* Match Quality Summary */}
        {Object.keys(matchQuality).length > 0 && (
          <div className="bg-card rounded-xl border p-4 shadow-sm">
            <h2 className="text-foreground mb-3 font-semibold">
              Übereinstimmungsqualität
            </h2>
            <div className="space-y-2">
              {Object.entries(matchQuality).map(([type, { sum, count }]) => {
                const avg = sum / count;
                const typeInfo = MEASUREMENT_TYPES.find((t) => t.key === type);
                return (
                  <div
                    key={type}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-foreground">
                      {typeInfo?.emoji} {typeInfo?.label ?? type}
                      <span className="text-muted-foreground ml-1">
                        ({count} Messungen)
                      </span>
                    </span>
                    {deviationBadge(avg)}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* History */}
        <div className="bg-card rounded-xl border p-4 shadow-sm">
          <h2 className="text-foreground mb-3 font-semibold">
            Referenzmessungen
          </h2>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Lädt…</p>
          ) : measurements.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Noch keine Referenzmessungen. Füge oben einen Labor- oder
              Referenzwert hinzu, um ihn mit Garmins Schätzung zu vergleichen
              und die Genauigkeit zu verfolgen.
            </p>
          ) : (
            <div className="space-y-3">
              {measurements.map((m) => {
                const typeInfo = MEASUREMENT_TYPES.find(
                  (t) => t.key === m.measurementType,
                );
                return (
                  <div
                    key={m.id}
                    className="border-border rounded-lg border p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="text-foreground flex items-center gap-1.5 text-sm font-medium">
                          <span>{typeInfo?.emoji ?? "📐"}</span>
                          <span>{typeInfo?.label ?? m.measurementType}</span>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">
                            {m.date}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-foreground text-sm">
                            {m.value} {m.unit}
                          </span>
                          {m.garminComparableValue != null && (
                            <span className="text-muted-foreground text-xs">
                              Garmin: {m.garminComparableValue} {m.unit}
                            </span>
                          )}
                          {deviationBadge(m.deviationPercent)}
                        </div>
                        {m.notes && (
                          <p className="text-muted-foreground mt-1 text-xs">
                            {m.notes}
                          </p>
                        )}
                      </div>
                      <div>
                        {confirmDelete === m.id ? (
                          <div className="flex gap-1">
                            <button
                              onClick={() =>
                                deleteMutation.mutate({ id: m.id })
                              }
                              className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                            >
                              Bestätigen
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="text-muted-foreground hover:bg-muted rounded px-2 py-1 text-xs"
                            >
                              Abbrechen
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(m.id)}
                            className="text-muted-foreground hover:bg-muted rounded p-1 hover:text-red-500"
                            aria-label="Löschen"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <BottomNav />
    </PageShell>
  );
}
