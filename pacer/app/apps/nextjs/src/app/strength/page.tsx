"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PatternCoverage } from "@acme/engine";
import {
  exercisesForPattern,
  findExercise,
  MAX_SETS_PER_EXERCISE,
  MOVEMENT_PATTERNS,
  PATTERN_LABELS,
} from "@acme/engine";
import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import { toast } from "@acme/ui/toast";

import { PageShell } from "~/components/page-shell";
import { useTRPC } from "~/trpc/react";
import { BottomNav } from "../_components/bottom-nav";

// ---------------------------------------------------------------------------
// Strength log — movement pattern coverage
// ---------------------------------------------------------------------------
//
// Garmin records that a strength session happened and nothing about its
// content, so sets are entered here. The nine tiles answer the question a
// session count cannot: which joint actions actually got loaded this week.

/**
 * The picker opens here. A slug that no longer exists in EXERCISES degrades
 * gracefully — the label falls back to the slug and the router rejects a save.
 */
const DEFAULT_EXERCISE_ID = "back-squat";

/** Patterns where seconds under load say more than repetitions. */
const TIMED_PATTERNS = new Set(["carry", "rotation"]);

interface SlotState {
  weightKg: string;
  reps: string;
  durationSeconds: string;
  rpe: string;
}

function emptySlots(): SlotState[] {
  return Array.from({ length: MAX_SETS_PER_EXERCISE }, () => ({
    weightKg: "",
    reps: "",
    durationSeconds: "",
    rpe: "",
  }));
}

/** Today in the browser's zone — the day the athlete is standing in. */
function todayIso(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Coverage tiles
// ---------------------------------------------------------------------------

function CoverageTiles({ patterns }: { patterns: PatternCoverage[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {patterns.map((p) => (
        <div
          key={p.pattern}
          className={cn(
            "rounded-xl border p-3 transition-colors",
            p.covered
              ? "border-emerald-600/50 bg-emerald-600/15"
              : "bg-muted/40 border-border",
            p.stale && "border-amber-500/70 bg-amber-500/15",
          )}
        >
          <div className="flex items-start justify-between gap-1">
            <span className="text-xs leading-tight font-medium">{p.label}</span>
            <span aria-hidden="true" className="text-xs">
              {p.stale ? "⚠️" : p.covered ? "✅" : "—"}
            </span>
          </div>
          <p className="text-muted-foreground mt-1.5 text-[11px]">
            {p.covered ? `${p.sets} Sätze` : "nicht im Fenster"}
          </p>
          <p className="text-muted-foreground text-[11px]">
            {p.daysSince == null
              ? "noch nie geloggt"
              : p.daysSince === 0
                ? "heute"
                : `vor ${p.daysSince} Tag${p.daysSince === 1 ? "" : "en"}`}
          </p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StrengthPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [date, setDate] = useState(todayIso);
  const [windowDays, setWindowDays] = useState(7);
  const [exerciseId, setExerciseId] = useState(DEFAULT_EXERCISE_ID);
  // Unsaved edits per day+exercise. What is rendered is the saved log with
  // these layered on top, so switching exercise or date needs no effect to
  // reload the form — and a late-arriving query result is not overwritten by
  // one either.
  const [edits, setEdits] = useState<Record<string, SlotState[]>>({});

  const coverage = useQuery(
    trpc.strength.coverage.queryOptions({ windowDays, staleAfterDays: 10 }),
  );
  const dayLog = useQuery(trpc.strength.day.queryOptions({ date }));
  const history = useQuery(
    trpc.strength.history.queryOptions({ exerciseId, days: 180 }),
  );

  function invalidateAll() {
    void queryClient.invalidateQueries({
      queryKey: trpc.strength.coverage.queryKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.strength.day.queryKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.strength.history.queryKey(),
    });
  }

  const saveMutation = useMutation(
    trpc.strength.logExercise.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          result.saved === 0
            ? "Übung aus dem Tag entfernt"
            : `${result.saved} Sätze gespeichert`,
        );
        resetForm(null);
        invalidateAll();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const deleteMutation = useMutation(
    trpc.strength.deleteSet.mutationOptions({
      onSuccess: () => {
        toast.success("Satz gelöscht");
        invalidateAll();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const exercise = findExercise(exerciseId);
  const timed = exercise ? TIMED_PATTERNS.has(exercise.pattern) : false;

  // Exercises grouped by pattern, so the picker itself shows the taxonomy.
  const grouped = useMemo(
    () =>
      MOVEMENT_PATTERNS.map((pattern) => ({
        pattern,
        label: PATTERN_LABELS[pattern],
        items: exercisesForPattern(pattern),
      })),
    [],
  );

  const loggedForExercise = dayLog.data?.find(
    (entry) => entry.exerciseId === exerciseId,
  );

  const formKey = `${date}|${exerciseId}`;
  const savedSlots = useMemo(() => {
    const next = emptySlots();
    for (const set of loggedForExercise?.sets ?? []) {
      const slot = next[set.setIndex - 1];
      if (!slot) continue;
      slot.weightKg = set.weightKg == null ? "" : String(set.weightKg);
      slot.reps = String(set.reps);
      slot.durationSeconds =
        set.durationSeconds == null ? "" : String(set.durationSeconds);
      slot.rpe = set.rpe == null ? "" : String(set.rpe);
    }
    return next;
  }, [loggedForExercise]);
  const slots = edits[formKey] ?? savedSlots;

  const lastSessions = useMemo(
    () => (history.data ?? []).slice(-6).reverse(),
    [history.data],
  );

  function updateSlot(index: number, field: keyof SlotState, value: string) {
    const next = slots.map((slot, i) =>
      i === index ? { ...slot, [field]: value } : slot,
    );
    setEdits((current) => ({ ...current, [formKey]: next }));
  }

  /** Drop the local edit so the form falls back to what is saved. */
  function resetForm(to: SlotState[] | null) {
    setEdits((current) => {
      const next = { ...current };
      if (to === null) delete next[formKey];
      else next[formKey] = to;
      return next;
    });
  }

  function handleSave() {
    const sets: {
      reps: number;
      weightKg?: number | null;
      durationSeconds?: number | null;
      rpe?: number | null;
    }[] = [];

    for (const [index, slot] of slots.entries()) {
      const reps = parseOptionalNumber(slot.reps);
      const weightKg = parseOptionalNumber(slot.weightKg);
      const durationSeconds = parseOptionalNumber(slot.durationSeconds);
      const rpe = parseOptionalNumber(slot.rpe);

      // An untouched slot is not an error — the athlete fills as many as the
      // session had. A slot with a weight but no reps is a half-entry, and
      // dropping it silently would lose work the athlete thinks is saved.
      if (reps == null) {
        if (weightKg != null || durationSeconds != null || rpe != null) {
          toast.error(`Satz ${index + 1}: Wiederholungen fehlen`);
          return;
        }
        continue;
      }
      if (!Number.isInteger(reps) || reps < 1 || reps > 500) {
        toast.error(`Satz ${index + 1}: Wiederholungen müssen 1–500 sein`);
        return;
      }
      if (weightKg != null && (weightKg < 0 || weightKg > 1000)) {
        toast.error(`Satz ${index + 1}: Gewicht muss 0–1000 kg sein`);
        return;
      }
      if (
        durationSeconds != null &&
        (!Number.isInteger(durationSeconds) ||
          durationSeconds < 1 ||
          durationSeconds > 3600)
      ) {
        toast.error(`Satz ${index + 1}: Dauer muss 1–3600 Sekunden sein`);
        return;
      }
      if (rpe != null && (rpe < 1 || rpe > 10)) {
        toast.error(`Satz ${index + 1}: RPE muss 1–10 sein`);
        return;
      }

      sets.push({ reps, weightKg, durationSeconds, rpe });
    }

    saveMutation.mutate({ date, exerciseId, sets });
  }

  const cov = coverage.data;

  return (
    <PageShell
      density="data"
      title="Kraft"
      description="Bewegungsmuster statt Muskelgruppen — was diese Woche tatsächlich belastet wurde."
    >
      <div className="space-y-6">
        {/* Coverage ------------------------------------------------------- */}
        <section className="bg-card space-y-4 rounded-2xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Musterabdeckung</h2>
              <p className="text-muted-foreground text-xs">
                {cov
                  ? `${cov.coveredCount}/9 Muster · ${cov.windowStart} bis ${cov.asOf} · ${cov.trainingDays} Trainingstage`
                  : "lädt…"}
              </p>
            </div>
            <div className="flex gap-1" role="group" aria-label="Zeitfenster">
              {[7, 14].map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setWindowDays(days)}
                  aria-pressed={windowDays === days}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs transition-colors",
                    windowDays === days
                      ? "border-primary bg-primary/15 text-foreground font-medium"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  {days} Tage
                </button>
              ))}
            </div>
          </div>

          {cov ? (
            <>
              <CoverageTiles patterns={cov.patterns} />
              {cov.stalePatterns.length > 0 && (
                <p className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs">
                  Länger als {cov.staleAfterDays} Tage nicht trainiert:{" "}
                  {cov.stalePatterns
                    .map((pattern) => PATTERN_LABELS[pattern])
                    .join(", ")}
                </p>
              )}
              {cov.unclassifiedSets > 0 && (
                <p className="text-muted-foreground text-xs">
                  {cov.unclassifiedSets} Sätze ohne zuordenbares Muster.
                </p>
              )}
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Array.from({ length: 9 }, (_, i) => (
                <div
                  key={i}
                  className="bg-muted/40 h-[76px] animate-pulse rounded-xl border"
                />
              ))}
            </div>
          )}
        </section>

        {/* Log ------------------------------------------------------------ */}
        <section className="bg-card space-y-4 rounded-2xl border p-4">
          <h2 className="text-sm font-semibold">Sätze eintragen</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Datum</span>
              <input
                type="date"
                value={date}
                max={todayIso()}
                onChange={(e) => setDate(e.target.value)}
                className="bg-secondary/50 border-border focus:ring-primary/40 w-full rounded-xl border p-2.5 text-sm focus:ring-2 focus:outline-none"
              />
            </label>

            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Übung</span>
              <select
                value={exerciseId}
                onChange={(e) => setExerciseId(e.target.value)}
                className="bg-secondary/50 border-border focus:ring-primary/40 w-full rounded-xl border p-2.5 text-sm focus:ring-2 focus:outline-none"
              >
                {grouped.map((group) => (
                  <optgroup key={group.pattern} label={group.label}>
                    {group.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>

          {exercise && (
            <p className="text-muted-foreground text-xs">
              {PATTERN_LABELS[exercise.pattern]} ·{" "}
              {exercise.equipment.join(", ")}
              {exercise.unilateral ? " · einseitig" : ""}
            </p>
          )}

          {/* Seven slots. Fill as many as the session had. */}
          <div className="space-y-2">
            <div
              className={cn(
                "text-muted-foreground grid gap-2 text-[11px]",
                timed
                  ? "grid-cols-[2.5rem_1fr_1fr_1fr_1fr]"
                  : "grid-cols-[2.5rem_1fr_1fr_1fr]",
              )}
            >
              <span>Satz</span>
              <span>kg</span>
              <span>Wdh</span>
              {timed && <span>Sek.</span>}
              <span>RPE</span>
            </div>
            {slots.map((slot, index) => (
              <div
                key={index}
                className={cn(
                  "grid items-center gap-2",
                  timed
                    ? "grid-cols-[2.5rem_1fr_1fr_1fr_1fr]"
                    : "grid-cols-[2.5rem_1fr_1fr_1fr]",
                )}
              >
                <span className="text-muted-foreground text-xs">
                  {index + 1}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min={0}
                  max={1000}
                  value={slot.weightKg}
                  onChange={(e) =>
                    updateSlot(index, "weightKg", e.target.value)
                  }
                  aria-label={`Satz ${index + 1} Gewicht in kg`}
                  placeholder="—"
                  className="bg-secondary/50 border-border focus:ring-primary/40 w-full rounded-lg border p-2 text-sm focus:ring-2 focus:outline-none"
                />
                <input
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min={1}
                  max={500}
                  value={slot.reps}
                  onChange={(e) => updateSlot(index, "reps", e.target.value)}
                  aria-label={`Satz ${index + 1} Wiederholungen`}
                  placeholder="—"
                  className="bg-secondary/50 border-border focus:ring-primary/40 w-full rounded-lg border p-2 text-sm focus:ring-2 focus:outline-none"
                />
                {timed && (
                  <input
                    type="number"
                    inputMode="numeric"
                    step="1"
                    min={1}
                    max={3600}
                    value={slot.durationSeconds}
                    onChange={(e) =>
                      updateSlot(index, "durationSeconds", e.target.value)
                    }
                    aria-label={`Satz ${index + 1} Dauer in Sekunden`}
                    placeholder="—"
                    className="bg-secondary/50 border-border focus:ring-primary/40 w-full rounded-lg border p-2 text-sm focus:ring-2 focus:outline-none"
                  />
                )}
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min={1}
                  max={10}
                  value={slot.rpe}
                  onChange={(e) => updateSlot(index, "rpe", e.target.value)}
                  aria-label={`Satz ${index + 1} RPE`}
                  placeholder="—"
                  className="bg-secondary/50 border-border focus:ring-primary/40 w-full rounded-lg border p-2 text-sm focus:ring-2 focus:outline-none"
                />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Speichert…" : "Speichern"}
            </Button>
            <Button
              variant="outline"
              onClick={() => resetForm(emptySlots())}
              disabled={saveMutation.isPending}
            >
              Felder leeren
            </Button>
            <span className="text-muted-foreground text-xs">
              Leere Sätze werden ignoriert. Speichern ersetzt diese Übung an
              diesem Tag.
            </span>
          </div>
        </section>

        {/* Day log -------------------------------------------------------- */}
        <section className="bg-card space-y-3 rounded-2xl border p-4">
          <h2 className="text-sm font-semibold">Eintrag am {date}</h2>
          {dayLog.data && dayLog.data.length > 0 ? (
            <ul className="space-y-3">
              {dayLog.data.map((entry) => (
                <li key={entry.exerciseId} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => setExerciseId(entry.exerciseId)}
                    className="text-left text-sm font-medium hover:underline"
                  >
                    {entry.name}
                    {entry.pattern && (
                      <span className="text-muted-foreground ml-2 text-xs font-normal">
                        {PATTERN_LABELS[entry.pattern]}
                      </span>
                    )}
                  </button>
                  <div className="flex flex-wrap gap-1.5">
                    {entry.sets.map((set) => (
                      <span
                        key={set.id}
                        className="bg-muted flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs"
                      >
                        {set.weightKg != null && `${set.weightKg} kg × `}
                        {set.reps}
                        {set.durationSeconds != null &&
                          ` · ${set.durationSeconds}s`}
                        {set.rpe != null && ` · RPE ${set.rpe}`}
                        <button
                          type="button"
                          onClick={() => deleteMutation.mutate({ id: set.id })}
                          disabled={deleteMutation.isPending}
                          aria-label={`Satz ${set.setIndex} von ${entry.name} löschen`}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">
              Noch nichts geloggt an diesem Tag.
            </p>
          )}
        </section>

        {/* Progression ---------------------------------------------------- */}
        <section className="bg-card space-y-3 rounded-2xl border p-4">
          <h2 className="text-sm font-semibold">
            Verlauf: {exercise?.name ?? exerciseId}
          </h2>
          {lastSessions.length > 0 ? (
            <ul className="space-y-1 text-xs">
              {lastSessions.map((row) => (
                <li
                  key={row.date}
                  className="border-border/60 flex justify-between border-b pb-1 last:border-0"
                >
                  <span>{row.date}</span>
                  <span className="text-muted-foreground">
                    {row.sets} Sätze · {row.reps} Wdh
                    {row.topWeightKg != null && ` · max ${row.topWeightKg} kg`}
                    {row.volumeKg > 0 &&
                      ` · ${Math.round(row.volumeKg)} kg Volumen`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">
              Für diese Übung liegt noch kein Verlauf vor.
            </p>
          )}
        </section>
      </div>
      <BottomNav />
    </PageShell>
  );
}
