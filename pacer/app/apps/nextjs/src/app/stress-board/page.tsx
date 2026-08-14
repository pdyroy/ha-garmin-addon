"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@acme/ui";

import { PageShell } from "~/components/page-shell";
import { fmtNum } from "~/lib/format-number";
import type { EndChoice, InteractionRec } from "./quick-add-lib";
import { BottomNav } from "../_components/bottom-nav";
import { getIngressUrl } from "../_components/ingress-provider";
import {
  DURATION_CHIPS,
  END_CHOICES,
  endIsoFromChoice,
  fmtEnd,
  parseApiResponse,
} from "./quick-add-lib";

/* ─────────────── types (shape of meeting_stress.json) ─────────────── */

interface MeetingRow {
  title: string;
  attendees: string[];
  dbpm: number;
  z: number;
  elev: number;
}

interface PersonRow {
  attendee: string;
  n: number;
  naive: number;
  ridge: number;
  reliability: string;
  label: string;
}

interface GcalCalendar {
  id: string;
  summary: string;
  primary?: boolean;
  selected?: boolean;
}

interface StressStatus {
  running?: boolean;
  error?: string;
  unsupported?: boolean;
  unreachable?: boolean;
  calendar_linked?: boolean;
  events_file?: boolean;
  results?: {
    generated: string;
    meetings: MeetingRow[];
    people: PersonRow[];
    skipped?: {
      total: number;
      no_hr: number;
      interactions_no_hr: number;
      no_hr_titles: string[];
      by_reason?: Record<string, number>;
    };
  };
}

/* ─────────────── helpers ─────────────── */

function dbpmColor(v: number): string {
  if (v >= 5) return "text-red-400";
  if (v >= 2) return "text-orange-400";
  if (v > -0.5) return "text-muted-foreground";
  return "text-green-400";
}

function labelColor(label: string): string {
  if (label === "prime suspect") return "text-red-400";
  if (label === "mild stressor") return "text-orange-400";
  if (label === "slightly raises HR") return "text-yellow-400";
  if (label === "calming") return "text-green-400";
  return "text-muted-foreground";
}

// p.label comes from the meeting-stress addon's JSON response as one of
// these fixed English phrases — labelColor() above still switches on the
// raw value, this only translates what's shown.
const LABEL_TEXT_DE: Record<string, string> = {
  "prime suspect": "Hauptverdächtiger",
  "mild stressor": "leichter Stressfaktor",
  "slightly raises HR": "erhöht Puls leicht",
  calming: "beruhigend",
};

function labelText(label: string): string {
  return LABEL_TEXT_DE[label] ?? label;
}

async function fetchStatus(): Promise<StressStatus> {
  try {
    const res = await fetch(getIngressUrl("/api/garmin/meeting-stress"));
    return (await res.json()) as StressStatus;
  } catch {
    return { running: false, unreachable: true };
  }
}

/** Stable short alias per attendee: "Waffle Nimbus" → WN, "jbolt" → JB.
 * Names are sorted first so collision suffixes don't depend on rank order. */
function buildMaskMap(people: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const name of [...people].sort()) {
    const words = name.split(/[\s._-]+/).filter(Boolean);
    let alias =
      words.length > 1
        ? words.map((w) => (w[0] ?? "").toUpperCase()).join("")
        : name.slice(0, 2).toUpperCase();
    let candidate = alias;
    let i = 2;
    while (used.has(candidate)) candidate = `${alias}${i++}`;
    alias = candidate;
    used.add(alias);
    map.set(name, alias);
  }
  return map;
}

/* ─────────────── page ─────────────── */

export default function StressBoardPage() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [masked, setMasked] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ["meeting-stress"],
    queryFn: fetchStatus,
    refetchInterval: (query) => (query.state.data?.running ? 5_000 : false),
  });

  const run = useMutation({
    mutationFn: async () => {
      const res = await fetch(getIngressUrl("/api/garmin/meeting-stress"), {
        method: "POST",
      });
      const data = (await res.json()) as { success: boolean; message?: string };
      if (!data.success)
        throw new Error(data.message ?? "Start fehlgeschlagen");
      return data;
    },
    onSuccess: () => {
      setMessage(null);
      void queryClient.invalidateQueries({ queryKey: ["meeting-stress"] });
    },
    onError: (err) => setMessage(err.message),
  });

  /* ─────────────── Google Calendar linking ─────────────── */
  const [tokenText, setTokenText] = useState("");
  const [showCals, setShowCals] = useState(false);
  // null = follow the server's saved selection; a Set = the user's edits.
  const [selectedOverride, setSelectedOverride] = useState<Set<string> | null>(
    null,
  );

  const link = useMutation({
    mutationFn: async () => {
      let payload: unknown;
      try {
        payload = JSON.parse(tokenText);
      } catch {
        throw new Error(
          "Das ist kein gültiges JSON — füge den Inhalt der gcal-token.json vollständig ein.",
        );
      }
      const res = await fetch(getIngressUrl("/api/garmin/gcal-link"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { success: boolean; message?: string };
      if (!data.success)
        throw new Error(data.message ?? "Verbinden fehlgeschlagen");
      return data;
    },
    onSuccess: () => {
      setTokenText("");
      setMessage(null);
      setShowCals(true);
      void queryClient.invalidateQueries({ queryKey: ["meeting-stress"] });
      void queryClient.invalidateQueries({ queryKey: ["gcal-calendars"] });
    },
    onError: (err) => setMessage(err.message),
  });

  const unlink = useMutation({
    mutationFn: async () => {
      const res = await fetch(getIngressUrl("/api/garmin/gcal-link"), {
        method: "DELETE",
      });
      const data = (await res.json()) as { success: boolean; message?: string };
      if (!data.success)
        throw new Error(data.message ?? "Trennen fehlgeschlagen");
      return data;
    },
    onSuccess: () => {
      setMessage(null);
      setShowCals(false);
      setSelectedOverride(null);
      void queryClient.invalidateQueries({ queryKey: ["meeting-stress"] });
      void queryClient.invalidateQueries({ queryKey: ["gcal-calendars"] });
    },
    onError: (err) => setMessage(err.message),
  });

  const { data: calData, isLoading: calLoading } = useQuery({
    queryKey: ["gcal-calendars"],
    queryFn: async (): Promise<{
      calendars?: GcalCalendar[];
      success?: boolean;
      message?: string;
    }> => {
      try {
        const res = await fetch(getIngressUrl("/api/garmin/gcal-calendars"));
        return (await res.json()) as {
          calendars?: GcalCalendar[];
          success?: boolean;
          message?: string;
        };
      } catch {
        return { success: false, message: "Addon nicht erreichbar." };
      }
    },
    // Only hit the addon once the panel is actually open.
    enabled: !!status?.calendar_linked && showCals,
  });

  const calendars = useMemo(() => calData?.calendars ?? [], [calData]);
  const calError =
    calData?.success === false
      ? (calData.message ?? "Kalender konnten nicht geladen werden.")
      : null;
  // Effective selection: the user's edits if any, else the server's saved set.
  const serverSelected = useMemo(
    () => new Set(calendars.filter((c) => c.selected).map((c) => c.id)),
    [calendars],
  );
  const selected = selectedOverride ?? serverSelected;

  const saveCals = useMutation({
    mutationFn: async () => {
      const res = await fetch(getIngressUrl("/api/garmin/gcal-calendars"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendar_ids: [...selected] }),
      });
      const data = (await res.json()) as { success: boolean; message?: string };
      if (!data.success)
        throw new Error(data.message ?? "Speichern fehlgeschlagen");
      return data;
    },
    onSuccess: () => {
      setMessage("Kalenderauswahl gespeichert — auf ▶ starten klicken, um zu aktualisieren.");
      setSelectedOverride(null);
      void queryClient.invalidateQueries({ queryKey: ["meeting-stress"] });
      void queryClient.invalidateQueries({ queryKey: ["gcal-calendars"] });
    },
    onError: (err) => setMessage(err.message),
  });

  /* ─────────────── interaction quick-add ─────────────── */
  const [personInput, setPersonInput] = useState("");
  const [minutes, setMinutes] = useState<number>(30);
  const [endChoice, setEndChoice] = useState<EndChoice>("now");

  const addonHealthy =
    !isLoading && !!status && !status.unsupported && !status.unreachable;

  const { data: ixData } = useQuery({
    queryKey: ["interactions"],
    queryFn: async (): Promise<{
      interactions?: InteractionRec[];
      success?: boolean;
      unsupported?: boolean;
      message?: string;
    }> => {
      try {
        const res = await fetch(getIngressUrl("/api/garmin/interactions"));
        // The proxy marks addon-predates-endpoint 404s with an explicit
        // `unsupported` flag; a plain JSON 404 is a real answer.
        return (await res.json()) as {
          interactions?: InteractionRec[];
          success?: boolean;
          unsupported?: boolean;
          message?: string;
        };
      } catch {
        return { success: false };
      }
    },
    enabled: addonHealthy,
  });
  const recent = ixData?.interactions ?? [];
  // Only show the panel once the probe has answered — defaulting to
  // "supported" would flash the form on addons that predate the endpoint.
  const ixSupported = !!ixData && !ixData.unsupported;

  const addInteraction = useMutation({
    mutationFn: async () => {
      const res = await fetch(getIngressUrl("/api/garmin/interactions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person: personInput.trim(),
          minutes,
          end: endIsoFromChoice(endChoice),
        }),
      });
      const data = await parseApiResponse(res);
      if (!data.success)
        throw new Error(data.message ?? "Protokollieren fehlgeschlagen");
      return data;
    },
    onSuccess: () => {
      setPersonInput("");
      setEndChoice("now");
      setMessage(
        "Protokolliert — auf ▶ starten klicken, um es gegen deinen Puls auszuwerten.",
      );
      void queryClient.invalidateQueries({ queryKey: ["interactions"] });
    },
    onError: (err) => setMessage(err.message),
  });

  const deleteInteraction = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        getIngressUrl(`/api/garmin/interactions/${encodeURIComponent(id)}`),
        { method: "DELETE" },
      );
      const data = await parseApiResponse(res);
      if (!data.success)
        throw new Error(data.message ?? "Löschen fehlgeschlagen");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["interactions"] });
    },
    onError: (err) => setMessage(err.message),
  });

  const canLog =
    personInput.trim().length > 0 &&
    !addInteraction.isPending &&
    minutes > 0 &&
    minutes <= 1440;

  const results = status?.results;
  const maxAbsRidge = useMemo(
    () => Math.max(1, ...(results?.people ?? []).map((p) => Math.abs(p.ridge))),
    [results],
  );
  const maskMap = useMemo(
    () => buildMaskMap((results?.people ?? []).map((p) => p.attendee)),
    [results],
  );
  // Screenshot mode: alias people, hide meeting titles (titles leak names too).
  const person = (name: string) =>
    masked ? (maskMap.get(name) ?? "??") : name;
  const title = (t: string, i: number) => (masked ? `meeting #${i + 1}` : t);
  const hasSource = !!(status?.calendar_linked ?? status?.events_file);
  const broken = !!(status?.unsupported ?? status?.unreachable);
  // Setup guidance only when status loaded, addon healthy, and no source.
  const showSetup = !isLoading && !!status && !broken && !hasSource;

  // Notice for events dropped because Garmin hadn't synced HR for that window
  // (often a just-logged interaction). Built as one string so JSX whitespace
  // can't inject a stray space before punctuation; names only when unmasked.
  const skip = status?.results?.skipped;
  const noHrTitles = Array.isArray(skip?.no_hr_titles) ? skip.no_hr_titles : [];
  const skipNote =
    skip && skip.no_hr > 0
      ? `⚠ ${skip.no_hr} ${skip.no_hr === 1 ? "Ereignis hatte" : "Ereignisse hatten"} noch keine Puls-Daten` +
        (skip.interactions_no_hr > 0
          ? ` (davon ${skip.interactions_no_hr} protokollierte ${
              skip.interactions_no_hr === 1 ? "Interaktion" : "Interaktionen"
            })`
          : "") +
        (!masked && noHrTitles.length > 0
          ? ` — ${noHrTitles.join(", ")}`
          : "") +
        `. Sie erscheinen, sobald Garmin dieses Zeitfenster synchronisiert hat — dann erneut auf ▶ starten klicken.`
      : null;

  return (
    <PageShell density="data" className="font-mono text-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-foreground text-lg font-bold">
              STRESS BOARD{" "}
              <span className="text-muted-foreground text-xs font-normal">
                wer meinen puls hochtreibt
              </span>
            </h1>
            <p className="text-muted-foreground text-xs">
              {isLoading || !status
                ? "kalender: wird geprüft…"
                : status.calendar_linked
                  ? "kalender: verbunden (Google)"
                  : status.events_file
                    ? "kalender: datei (/share/pacer)"
                    : "kalender: nicht verbunden"}
              {results?.generated
                ? ` · letzter lauf ${new Date(results.generated).toLocaleString()}`
                : ""}
            </p>
          </div>
          <div className="flex gap-2">
            {status?.calendar_linked && (
              <button
                onClick={() => setShowCals((s) => !s)}
                title="Kalender wählen / trennen"
                className={cn(
                  "rounded border px-3 py-1.5 text-xs",
                  showCals
                    ? "border-sky-600 text-sky-400"
                    : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                📅 kalender
              </button>
            )}
            <button
              onClick={() => setMasked((m) => !m)}
              title="Namen für Screenshots maskieren"
              className={cn(
                "rounded border px-3 py-1.5 text-xs",
                masked
                  ? "border-yellow-600 text-yellow-400"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {masked ? "🙈 maskiert" : "👁 namen"}
            </button>
            <button
              onClick={() => run.mutate()}
              disabled={status?.running || run.isPending || !hasSource}
              className={cn(
                "border-border rounded border px-3 py-1.5 text-xs",
                status?.running || run.isPending
                  ? "text-muted-foreground cursor-wait"
                  : "text-foreground hover:bg-accent",
              )}
            >
              {status?.running ? "läuft…" : "▶ starten"}
            </button>
          </div>
        </div>

        {message && (
          <p className="mb-3 rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">
            {message}
          </p>
        )}

        {skipNote && (
          <p className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">
            {skipNote}
          </p>
        )}

        {status?.calendar_linked && showCals && (
          <div className="mb-3 rounded border border-sky-500/30 bg-sky-500/5 p-3 text-xs">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-foreground font-bold">Google-Kalender</p>
              <button
                onClick={() => unlink.mutate()}
                disabled={unlink.isPending}
                className="rounded border border-red-500/40 px-2 py-1 text-red-400 hover:bg-red-500/10"
              >
                {unlink.isPending ? "wird getrennt…" : "Trennen"}
              </button>
            </div>
            {calError ? (
              <p className="text-amber-400">{calError}</p>
            ) : calLoading ? (
              <p className="text-muted-foreground">Kalender werden geladen…</p>
            ) : calendars.length === 0 ? (
              <p className="text-muted-foreground">
                Keine Kalender in diesem Konto gefunden.
              </p>
            ) : (
              <>
                <p className="text-muted-foreground mb-2">
                  Wähle, welche Kalender das Board speisen (Termine in
                  mehreren Kalendern werden nur einmal gezählt).
                </p>
                <div className="mb-2 max-h-48 space-y-1 overflow-y-auto">
                  {calendars.map((c) => (
                    <label
                      key={c.id}
                      className="text-foreground flex cursor-pointer items-center gap-2"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={(e) =>
                          setSelectedOverride((prev) => {
                            // Build from the latest state (prev), falling back
                            // to the server set, so rapid toggles never drop.
                            const next = new Set(prev ?? serverSelected);
                            if (e.target.checked) next.add(c.id);
                            else next.delete(c.id);
                            return next;
                          })
                        }
                      />
                      <span>{c.summary}</span>
                      {c.primary && (
                        <span className="text-muted-foreground">(primär)</span>
                      )}
                    </label>
                  ))}
                </div>
                <button
                  onClick={() => saveCals.mutate()}
                  disabled={saveCals.isPending || selected.size === 0}
                  className="border-border text-foreground hover:bg-accent disabled:text-muted-foreground rounded border px-3 py-1.5 disabled:cursor-not-allowed"
                >
                  {saveCals.isPending ? "wird gespeichert…" : "Auswahl speichern"}
                </button>
              </>
            )}
          </div>
        )}

        {addonHealthy && ixSupported && (
          <div className="border-border bg-card mb-3 rounded border p-3 text-xs">
            <p className="text-foreground mb-2 font-bold tracking-widest">
              INTERAKTION PROTOKOLLIEREN{" "}
              <span className="text-muted-foreground font-normal tracking-normal">
                chat, anruf oder spontanes gespräch außerhalb des kalenders
              </span>
            </p>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (canLog) addInteraction.mutate();
              }}
            >
              <input
                value={personInput}
                onChange={(e) => setPersonInput(e.target.value)}
                list="known-people"
                placeholder="wer?"
                aria-label="Person, mit der du interagiert hast"
                autoComplete="off"
                autoCapitalize="off"
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground w-36 rounded border px-2 py-1.5"
              />
              <datalist id="known-people">
                {(results?.people ?? []).map((p) => (
                  <option key={p.attendee} value={p.attendee} />
                ))}
              </datalist>
              <span className="border-border flex overflow-hidden rounded border">
                {DURATION_CHIPS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMinutes(m)}
                    className={cn(
                      "px-2 py-1.5",
                      minutes === m
                        ? "bg-accent text-accent-foreground font-bold"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {m}m
                  </button>
                ))}
              </span>
              <select
                value={endChoice}
                onChange={(e) => setEndChoice(e.target.value as EndChoice)}
                aria-label="Wann die Interaktion endete"
                className="border-border bg-muted text-foreground rounded border px-2 py-1.5"
              >
                {END_CHOICES.map((c) => (
                  <option key={c.key} value={c.key}>
                    beendet {c.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!canLog}
                className="border-border text-foreground hover:bg-accent disabled:text-muted-foreground rounded border px-3 py-1.5 disabled:cursor-not-allowed"
              >
                {addInteraction.isPending ? "wird protokolliert…" : "+ eintragen"}
              </button>
            </form>
            {recent.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {recent.slice(0, 6).map((r) => (
                  <li
                    key={r.id}
                    className="text-muted-foreground flex items-center gap-2"
                  >
                    <span className="text-foreground">{person(r.person)}</span>
                    <span>
                      {r.minutes}m · beendet {fmtEnd(r.end)}
                    </span>
                    <button
                      onClick={() => deleteInteraction.mutate(r.id)}
                      disabled={deleteInteraction.isPending}
                      title="Diese Interaktion entfernen"
                      aria-label={`Interaktion mit ${person(r.person)} entfernen`}
                      className="text-muted-foreground rounded px-1 hover:bg-red-500/10 hover:text-red-400"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!showSetup && !results && !isLoading && (
          <p className="border-border bg-card text-muted-foreground rounded border p-4 text-xs">
            {status?.unsupported
              ? "Addon bietet Meeting-Stress noch nicht — aktualisiere auf v0.20.0+."
              : status?.unreachable
                ? "Auth-Server des Addons nicht erreichbar."
                : "Noch keine Ergebnisse — auf ▶ starten klicken."}
          </p>
        )}

        {showSetup && (
          <div className="border-border bg-card text-muted-foreground rounded border p-4 text-xs">
            <p className="text-foreground mb-2 font-bold">
              Google Kalender verbinden
            </p>
            <p className="mb-2">
              Erzeuge auf deinem Rechner einen Read-only-Token mit{" "}
              <code className="text-foreground">
                scripts/generate-gcal-token.py
              </code>{" "}
              (Addon-Repo) und füge dann den Inhalt der erzeugten{" "}
              <code className="text-foreground">gcal-token.json</code> hier
              ein:
            </p>
            <textarea
              value={tokenText}
              onChange={(e) => setTokenText(e.target.value)}
              rows={4}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              data-1p-ignore
              data-lpignore="true"
              placeholder='{"client_id":"…","client_secret":"…","refresh_token":"…"}'
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground mb-2 w-full rounded border p-2 font-mono text-[11px]"
            />
            <button
              onClick={() => link.mutate()}
              disabled={link.isPending || tokenText.trim().length === 0}
              className="border-border text-foreground hover:bg-accent disabled:text-muted-foreground rounded border px-3 py-1.5 disabled:cursor-not-allowed"
            >
              {link.isPending ? "wird verbunden…" : "Verbinden"}
            </button>
            <p className="text-muted-foreground mt-3">
              Lieber Dateien? Lege den Token in{" "}
              <code className="text-muted-foreground">/share/pacer/</code> ab,
              oder exportiere eine ICS-Datei und konvertiere sie mit{" "}
              <code className="text-muted-foreground">scripts/ics_to_events.py</code>.
            </p>
          </div>
        )}

        {results && (
          <>
            {/* PER-PERSON leaderboard — the headline, like the post */}
            <section className="mb-6">
              <h2 className="border-border text-foreground mb-1 border-b pb-1 text-xs font-bold tracking-widest">
                PRO PERSON{" "}
                <span className="text-muted-foreground font-normal">
                  sortiert nach ridge-grenzeffekt (bpm)
                </span>
              </h2>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="py-1 pr-2 font-normal">teilnehmer</th>
                    <th className="pr-2 text-right font-normal">n</th>
                    <th className="pr-2 text-right font-normal">naiv</th>
                    <th className="pr-2 text-right font-normal">ridge</th>
                    <th className="pr-2 font-normal">rel</th>
                    <th className="pr-2 font-normal">
                      beruhigend ← 0 → stressig
                    </th>
                    <th className="font-normal">label</th>
                  </tr>
                </thead>
                <tbody>
                  {results.people.map((p) => {
                    const w = Math.round(
                      (Math.abs(p.ridge) / maxAbsRidge) * 48,
                    );
                    return (
                      <tr key={p.attendee} className="align-middle">
                        <td className="text-foreground py-0.5 pr-2 font-bold">
                          {person(p.attendee)}
                        </td>
                        <td className="pr-2 text-right">{p.n}</td>
                        <td className="pr-2 text-right">
                          {fmtNum(p.naive, 2)}
                        </td>
                        <td
                          className={cn(
                            "pr-2 text-right font-bold",
                            dbpmColor(p.ridge),
                          )}
                        >
                          {fmtNum(p.ridge, 2)}
                        </td>
                        <td className="text-muted-foreground pr-2">{p.reliability}</td>
                        <td className="pr-2">
                          <div className="flex h-3 w-28 items-center">
                            <div className="flex w-14 justify-end">
                              {p.ridge < 0 && (
                                <div
                                  className="h-2.5 bg-green-500/70"
                                  style={{ width: `${Math.min(w, 56)}px` }}
                                />
                              )}
                            </div>
                            <div className="bg-border h-3 w-px" />
                            <div className="w-14">
                              {p.ridge > 0 && (
                                <div
                                  className="h-2.5 bg-red-500/70"
                                  style={{ width: `${Math.min(w, 56)}px` }}
                                />
                              )}
                            </div>
                          </div>
                        </td>
                        <td className={labelColor(p.label)}>
                          {labelText(p.label)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            {/* MEETING STRESS table */}
            <section className="mb-6">
              <h2 className="border-border text-foreground mb-1 border-b pb-1 text-xs font-bold tracking-widest">
                MEETING-STRESS{" "}
                <span className="text-muted-foreground font-normal">
                  mittlerer puls über umgebender baseline
                </span>
              </h2>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="py-1 pr-2 text-right font-normal">dbpm</th>
                    <th className="pr-2 text-right font-normal">z</th>
                    <th className="pr-2 text-right font-normal">elev</th>
                    <th className="pr-2 font-normal">meeting</th>
                    <th className="font-normal">teilnehmer</th>
                  </tr>
                </thead>
                <tbody>
                  {results.meetings.map((m, i) => (
                    <tr key={i}>
                      <td
                        className={cn(
                          "py-0.5 pr-2 text-right font-bold",
                          dbpmColor(m.dbpm),
                        )}
                      >
                        {m.dbpm >= 0 ? "+" : ""}
                        {fmtNum(m.dbpm, 1)}
                      </td>
                      <td className="pr-2 text-right">{fmtNum(m.z, 2)}</td>
                      <td className="pr-2 text-right">
                        {Math.round(m.elev * 100)}%
                      </td>
                      <td className="text-foreground max-w-40 truncate pr-2">
                        {title(m.title, i)}
                      </td>
                      <td className="text-muted-foreground">
                        {m.attendees.map(person).join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <p className="text-muted-foreground text-[10px]">
              korrelation ≠ kausalität — eine bestenliste zum spaß, keine
              wissenschaft. bei wenig daten (n &lt; 3) ist das ranking nur
              rauschen.
            </p>
          </>
        )}
      <BottomNav />
    </PageShell>
  );
}
