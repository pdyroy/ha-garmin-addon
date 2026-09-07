"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { Label } from "@acme/ui/label";

import { PageShell } from "~/components/page-shell";
import { VersionBadge } from "~/components/version-badge";
import { env } from "~/env";
import {
  formatDateInTz,
  formatTimeInTz,
  useUserTimezone,
} from "~/lib/format-date";
import { useTRPC } from "~/trpc/react";
import { BottomNav } from "../_components/bottom-nav";

const HEALTH_CONDITIONS = [
  { id: "asthma", label: "🫁 Asthma" },
  { id: "hypertension", label: "❤️‍🩹 Bluthochdruck" },
  { id: "diabetes_t1", label: "💉 Diabetes Typ 1" },
  { id: "diabetes_t2", label: "🩺 Diabetes Typ 2" },
  { id: "heart_condition", label: "🫀 Herzerkrankung" },
  { id: "joint_issues", label: "🦴 Gelenkprobleme" },
  { id: "back_issues", label: "🔙 Rückenprobleme" },
  { id: "respiratory", label: "😮‍💨 Atemwegserkrankungen" },
  { id: "thyroid", label: "🦋 Schilddrüsenerkrankung" },
  { id: "anxiety_depression", label: "🧠 Angst/Depression" },
];

const BODY_PARTS = [
  "knee",
  "ankle",
  "hip",
  "shoulder",
  "lower_back",
  "upper_back",
  "wrist",
  "elbow",
  "neck",
  "foot",
  "shin",
  "hamstring",
  "calf",
  "quad",
];

// Display-only translations. The underlying values (body part IDs, sex,
// severity) are unchanged — they're stored and compared as-is; only the
// German label shown to the user is looked up here.
const BODY_PART_LABELS: Record<string, string> = {
  knee: "Knie",
  ankle: "Knöchel",
  hip: "Hüfte",
  shoulder: "Schulter",
  lower_back: "Unterer Rücken",
  upper_back: "Oberer Rücken",
  wrist: "Handgelenk",
  elbow: "Ellbogen",
  neck: "Nacken",
  foot: "Fuß",
  shin: "Schienbein",
  hamstring: "Beinbeuger",
  calf: "Wade",
  quad: "Quadrizeps",
};

const SEVERITY_LABELS: Record<"mild" | "moderate" | "severe", string> = {
  mild: "Leicht",
  moderate: "Mittel",
  severe: "Schwer",
};

const SEX_LABELS: Record<string, string> = {
  male: "Männlich",
  female: "Weiblich",
  other: "Divers",
};

function getBrowserTimezone(): string {
  if (typeof Intl === "undefined") return "UTC";
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function getSupportedTimezones(): string[] {
  if (typeof Intl.supportedValuesOf !== "function") return ["UTC"];
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

function timezonePart(
  timezone: string,
  timeZoneName: "short" | "shortOffset",
): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName,
    }).formatToParts(new Date());
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "UTC";
  } catch {
    return "UTC";
  }
}

function formatTimezoneLabel(timezone: string): string {
  const abbreviation = timezonePart(timezone, "short");
  const offset = timezonePart(timezone, "shortOffset").replace("GMT", "UTC");
  return `${timezone} (${abbreviation} ${offset})`;
}

function timezoneNeedsDefault(timezone: string | null | undefined): boolean {
  return !timezone || timezone.trim() === "" || timezone === "UTC";
}

function ProfileEditor() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useQuery(
    trpc.profile.get.queryOptions(),
  );

  const [editing, setEditing] = useState(false);
  const [age, setAge] = useState("");
  const [massKg, setMassKg] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [sex, setSex] = useState<string>("male");

  useEffect(() => {
    if (profile) {
      setAge(profile.age?.toString() ?? "");
      setMassKg(profile.massKg?.toString() ?? "");
      setHeightCm(profile.heightCm?.toString() ?? "");
      setSex(profile.sex ?? "male");
    }
  }, [profile]);

  const upsertProfile = useMutation(
    trpc.profile.upsert.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.profile.get.queryKey(),
        });
        setEditing(false);
      },
    }),
  );

  if (isLoading) {
    return (
      <div className="bg-card space-y-3 rounded-2xl border p-4">
        <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
          Athleten-Profil
        </h2>
        <p className="text-muted-foreground text-sm">Profil wird geladen…</p>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="bg-card space-y-3 rounded-2xl border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
            Athleten-Profil
          </h2>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Bearbeiten
          </Button>
        </div>
        <div className="grid-metrics text-sm">
          <div>
            <span className="text-muted-foreground">Alter:</span>{" "}
            {profile?.age ?? "—"}
          </div>
          <div>
            <span className="text-muted-foreground">Geschlecht:</span>{" "}
            <span>
              {profile?.sex ? (SEX_LABELS[profile.sex] ?? profile.sex) : "—"}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Gewicht:</span>{" "}
            {profile?.massKg ? `${profile.massKg} kg` : "—"}
          </div>
          <div>
            <span className="text-muted-foreground">Größe:</span>{" "}
            {profile?.heightCm ? `${profile.heightCm} cm` : "—"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card space-y-3 rounded-2xl border p-4">
      <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
        Athleten-Profil
      </h2>
      <div className="grid-metrics">
        <div>
          <Label>Alter</Label>
          <Input
            type="number"
            value={age}
            onChange={(e) => setAge(e.target.value)}
          />
        </div>
        <div>
          <Label>Geschlecht</Label>
          <div className="flex gap-1">
            {(["male", "female", "other"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSex(s)}
                className={cn(
                  "flex-1 rounded-lg border px-2 py-1.5 text-xs",
                  sex === s
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground",
                )}
              >
                {SEX_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>Gewicht (kg)</Label>
          <Input
            type="number"
            value={massKg}
            onChange={(e) => setMassKg(e.target.value)}
          />
        </div>
        <div>
          <Label>Größe (cm)</Label>
          <Input
            type="number"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={upsertProfile.isPending}
          onClick={() =>
            upsertProfile.mutate({
              userId: "current-user",
              age: age ? parseInt(age) : null,
              sex: sex as "male" | "female" | "other",
              massKg: massKg ? parseFloat(massKg) : null,
              heightCm: heightCm ? parseFloat(heightCm) : null,
            })
          }
        >
          {upsertProfile.isPending ? "Wird gespeichert…" : "Speichern"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}

function HealthProfile() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useQuery(
    trpc.profile.get.queryOptions(),
  );

  const [editing, setEditing] = useState(false);
  const [conditions, setConditions] = useState<string[]>([]);
  const [injuries, setInjuries] = useState<
    { bodyPart: string; severity: "mild" | "moderate" | "severe" }[]
  >([]);
  const [medications, setMedications] = useState("");
  const [allergies, setAllergies] = useState("");

  useEffect(() => {
    if (profile) {
      setConditions(profile.healthConditions! ?? []);
      setInjuries(
        (profile.currentInjuries as {
          bodyPart: string;
          severity: "mild" | "moderate" | "severe";
        }[]) ?? [],
      );
      setMedications(profile.medications! ?? "");
      setAllergies(profile.allergies! ?? "");
    }
  }, [profile]);

  const updateHealth = useMutation(
    trpc.profile.updateHealth.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.profile.get.queryKey(),
        });
        setEditing(false);
      },
    }),
  );

  if (isLoading) return null;

  const hasAny =
    conditions.length > 0 || injuries.length > 0 || medications || allergies;

  if (!editing) {
    return (
      <div className="bg-card space-y-3 rounded-2xl border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
            Gesundheit & Sicherheit
          </h2>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {hasAny ? "Bearbeiten" : "Hinzufügen"}
          </Button>
        </div>
        {hasAny ? (
          <div className="space-y-2 text-sm">
            {conditions.length > 0 && (
              <p>
                <span className="text-muted-foreground">Erkrankungen:</span>{" "}
                {conditions
                  .map(
                    (c) =>
                      HEALTH_CONDITIONS.find((h) => h.id === c)?.label ?? c,
                  )
                  .join(", ")}
              </p>
            )}
            {injuries.length > 0 && (
              <p>
                <span className="text-muted-foreground">Verletzungen:</span>{" "}
                {injuries
                  .map(
                    (i) =>
                      `${BODY_PART_LABELS[i.bodyPart] ?? i.bodyPart} (${SEVERITY_LABELS[i.severity]})`,
                  )
                  .join(", ")}
              </p>
            )}
            {medications && (
              <p>
                <span className="text-muted-foreground">Medikamente:</span>{" "}
                {medications}
              </p>
            )}
            {allergies && (
              <p>
                <span className="text-muted-foreground">Allergien:</span>{" "}
                {allergies}
              </p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            Keine Gesundheitsinformationen hinterlegt. Füge Erkrankungen,
            Verletzungen oder Medikamente hinzu, damit der KI-Coach sichere
            Empfehlungen geben kann.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-card space-y-4 rounded-2xl border p-4">
      <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
        Gesundheit & Sicherheit
      </h2>

      {/* Conditions */}
      <div>
        <Label className="text-sm font-medium">
          Gesundheitliche Vorerkrankungen
        </Label>
        <div className="mt-1 flex flex-wrap gap-1">
          {HEALTH_CONDITIONS.map((c) => (
            <button
              key={c.id}
              onClick={() =>
                setConditions((prev) =>
                  prev.includes(c.id)
                    ? prev.filter((x) => x !== c.id)
                    : [...prev, c.id],
                )
              }
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                conditions.includes(c.id)
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:border-foreground/30",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Injuries */}
      <div>
        <Label className="text-sm font-medium">Aktuelle Verletzungen</Label>
        <div className="mt-1 flex flex-wrap gap-1">
          {BODY_PARTS.map((part) => {
            const existing = injuries.find((i) => i.bodyPart === part);
            return (
              <button
                key={part}
                onClick={() =>
                  setInjuries((prev) =>
                    existing
                      ? prev.filter((i) => i.bodyPart !== part)
                      : [
                          ...prev,
                          { bodyPart: part, severity: "mild" as const },
                        ],
                  )
                }
                className={cn(
                  "rounded-full border px-2 py-1 text-xs transition-colors",
                  existing
                    ? "border-amber-500 bg-amber-500/10 font-medium text-amber-600"
                    : "text-muted-foreground hover:border-foreground/30",
                )}
              >
                {BODY_PART_LABELS[part] ?? part}
              </button>
            );
          })}
        </div>
        {injuries.length > 0 && (
          <div className="mt-2 space-y-1">
            {injuries.map((injury) => (
              <div
                key={injury.bodyPart}
                className="flex items-center gap-2 text-xs"
              >
                <span className="min-w-[70px] font-medium">
                  {BODY_PART_LABELS[injury.bodyPart] ?? injury.bodyPart}:
                </span>
                {(["mild", "moderate", "severe"] as const).map((sev) => (
                  <button
                    key={sev}
                    onClick={() =>
                      setInjuries((prev) =>
                        prev.map((i) =>
                          i.bodyPart === injury.bodyPart
                            ? { ...i, severity: sev }
                            : i,
                        ),
                      )
                    }
                    className={cn(
                      "rounded border px-2 py-0.5",
                      injury.severity === sev
                        ? sev === "mild"
                          ? "border-green-500 bg-green-500/10 text-green-700"
                          : sev === "moderate"
                            ? "border-amber-500 bg-amber-500/10 text-amber-700"
                            : "border-red-500 bg-red-500/10 text-red-700"
                        : "text-muted-foreground",
                    )}
                  >
                    {SEVERITY_LABELS[sev]}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Medications */}
      <div>
        <Label>Medikamente</Label>
        <Input
          value={medications}
          onChange={(e) => setMedications(e.target.value)}
          placeholder="z. B. Betablocker, Metformin…"
        />
      </div>

      {/* Allergies */}
      <div>
        <Label>Allergien oder Unverträglichkeiten</Label>
        <Input
          value={allergies}
          onChange={(e) => setAllergies(e.target.value)}
          placeholder="z. B. Pollen, Laktose…"
        />
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={updateHealth.isPending}
          onClick={() =>
            updateHealth.mutate({
              healthConditions: conditions,
              currentInjuries: injuries,
              medications: medications || undefined,
              allergies: allergies || undefined,
            })
          }
        >
          {updateHealth.isPending ? "Wird gespeichert…" : "Speichern"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
          Abbrechen
        </Button>
      </div>

      <p className="text-muted-foreground text-xs italic">
        💡 Alle Gesundheitsinformationen werden lokal gespeichert und dienen nur
        einem sicheren KI-Coaching.
      </p>
      <p className="text-xs text-amber-700 dark:text-amber-400">
        ⚠️ Kein Ersatz für professionelle medizinische Beratung. Wende dich für
        eine individuelle Einschätzung an eine qualifizierte Ärztin oder einen
        qualifizierten Arzt.
      </p>
    </div>
  );
}

interface GarminStatus {
  connected: boolean;
  email: string;
  lastSync: string;
}

interface AuthResponse {
  success: boolean;
  needsMfa?: boolean;
  message?: string;
}

const AUDIENCE_OPTIONS = [
  {
    value: "all" as const,
    label: "Alles",
    hint: "Jede Seite, nichts ausgeblendet",
  },
  {
    value: "athlete" as const,
    label: "Sport",
    hint: "Leistung im Fokus — Vitalwerte ausgeblendet",
  },
  {
    value: "health" as const,
    label: "Gesundheit",
    hint: "Erholung im Fokus — HF-Zonen, Fitness und Power ausgeblendet",
  },
];

/**
 * Which slice of the app the navigation shows. Fewer sichtbare Seiten, ohne
 * eine davon zu löschen — die Routen bleiben per Direktlink erreichbar.
 */
function AudienceSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: profile } = useQuery(trpc.profile.get.queryOptions());
  const current =
    (profile as { audienceMode?: string } | null | undefined)?.audienceMode ??
    "all";

  const updateAudience = useMutation(
    trpc.profile.updateAudienceMode.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.profile.get.queryKey(),
        });
      },
    }),
  );

  return (
    <div className="bg-card space-y-3 rounded-2xl border p-4">
      <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
        Umfang der Oberfläche
      </h2>
      <div className="space-y-2">
        {AUDIENCE_OPTIONS.map((option) => {
          const active = current === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={updateAudience.isPending}
              onClick={() =>
                updateAudience.mutate({ audienceMode: option.value })
              }
              aria-pressed={active}
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input hover:bg-accent",
              )}
            >
              <span className="font-medium">{option.label}</span>
              <span className="text-muted-foreground block text-xs">
                {option.hint}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TimezoneSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const currentTimezone = useUserTimezone();
  const { data: profile } = useQuery(trpc.profile.get.queryOptions());
  const timezones = useMemo(() => getSupportedTimezones(), []);
  const browserTimezone = useMemo(() => getBrowserTimezone(), []);
  const [selectedTimezone, setSelectedTimezone] = useState(browserTimezone);

  useEffect(() => {
    const savedTimezone = profile?.timezone;
    setSelectedTimezone(
      timezoneNeedsDefault(savedTimezone)
        ? browserTimezone
        : (savedTimezone ?? browserTimezone),
    );
  }, [browserTimezone, profile?.timezone]);

  const updateTimezone = useMutation(
    trpc.profile.updateTimezone.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.profile.get.queryKey(),
        });
      },
    }),
  );

  return (
    <div className="bg-card space-y-3 rounded-2xl border p-4">
      <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
        Zeitzone
      </h2>
      <p className="text-sm">
        <span className="text-muted-foreground">Aktuell:</span>{" "}
        {formatTimezoneLabel(currentTimezone)}
      </p>
      <div className="space-y-2">
        <Label htmlFor="timezone-select">IANA-Zeitzone</Label>
        <input
          id="timezone-select"
          list="timezone-options"
          role="combobox"
          value={selectedTimezone}
          onChange={(event) => setSelectedTimezone(event.target.value)}
          className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
          placeholder="Zeitzone suchen"
        />
        <datalist id="timezone-options">
          {timezones.map((timezone) => (
            <option key={timezone} value={timezone}>
              {formatTimezoneLabel(timezone)}
            </option>
          ))}
        </datalist>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setSelectedTimezone(browserTimezone)}
        >
          Automatisch aus Browser erkennen
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={
            updateTimezone.isPending || !timezones.includes(selectedTimezone)
          }
          onClick={() => updateTimezone.mutate({ timezone: selectedTimezone })}
        >
          {updateTimezone.isPending
            ? "Wird gespeichert…"
            : "Zeitzone speichern"}
        </Button>
      </div>
      {!timezones.includes(selectedTimezone) ? (
        <p className="text-xs text-red-500">
          Wähle eine gültige IANA-Zeitzone.
        </p>
      ) : null}
    </div>
  );
}

function GarminConnection() {
  const timezone = useUserTimezone();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<GarminStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [debugUrl, setDebugUrl] = useState("");

  // Inline ingress detection — no external deps
  const apiUrl = useCallback((path: string) => {
    if (typeof window === "undefined") return path;
    const match = /^(\/api\/hassio_ingress\/[^/]+)/.exec(
      window.location.pathname,
    );
    return match ? match[1] + path : path;
  }, []);

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [showMfa, setShowMfa] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{
    syncing: boolean;
    phase: string;
    detail: string;
    progress: number;
  } | null>(null);
  const [triggeringSyncState, setTriggeringSyncState] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const url = apiUrl("/api/garmin/auth");
      setDebugUrl(url);
      console.log("[GarminAuth] fetching:", url);
      const res = await fetch(url);
      const data = (await res.json()) as GarminStatus;
      setStatus(data);
    } catch (e) {
      console.error("[GarminAuth] fetch error:", e);
      setStatus({ connected: false, email: "", lastSync: "" });
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Poll sync status when connected. When syncing flips from true to
  // false we invalidate every React Query cache so all dashboards pick
  // up the freshly synced rows (and the recompute that auto-chains
  // after sync in addon ≥ 0.16.29) without waiting for a manual
  // refresh.
  const prevSyncingRef = useRef(false);
  const lastSyncingRef = useRef(false);
  useEffect(() => {
    if (!status?.connected) {
      // Reset the falling-edge tracker so a previous session ending
      // mid-sync doesn't trigger a spurious invalidate on reconnect.
      prevSyncingRef.current = false;
      lastSyncingRef.current = false;
      return;
    }

    const fetchSyncStatus = async () => {
      try {
        const res = await fetch(apiUrl("/api/garmin/sync"));
        const data = (await res.json()) as {
          syncing: boolean;
          phase: string;
          detail: string;
          progress: number;
        };
        setSyncStatus(data);
        if (prevSyncingRef.current && !data.syncing) {
          void queryClient.invalidateQueries();
        }
        prevSyncingRef.current = data.syncing;
        lastSyncingRef.current = data.syncing;
      } catch {
        // Transient fetch error — keep the last-known syncing flag so
        // the polling cadence below stays fast while a job is in
        // flight. Surface a null status to the UI only after a full
        // poll interval has passed without recovery.
        setSyncStatus(null);
      }
    };

    void fetchSyncStatus();
    // Poll every 3s while syncing, 30s otherwise. Fall back to the
    // last-known syncing flag if syncStatus is currently null due to a
    // transient error.
    const interval = setInterval(
      () => {
        void fetchSyncStatus();
      },
      (syncStatus?.syncing ?? lastSyncingRef.current) ? 3000 : 30000,
    );

    return () => clearInterval(interval);
  }, [status?.connected, apiUrl, syncStatus?.syncing, queryClient]);

  // Poll recompute status. When it transitions from running:true to
  // running:false we invalidate every React Query cache so the
  // refreshed readiness_score / advanced_metric rows surface
  // everywhere without a manual page reload.
  const [recomputeRunning, setRecomputeRunning] = useState(false);
  const prevRecomputingRef = useRef(false);
  const lastRecomputingRef = useRef(false);
  useEffect(() => {
    if (!status?.connected) {
      prevRecomputingRef.current = false;
      lastRecomputingRef.current = false;
      return;
    }

    let cancelled = false;

    const fetchRecomputeStatus = async () => {
      try {
        const res = await fetch(apiUrl("/api/garmin/recompute"));
        const data = (await res.json()) as { running?: boolean };
        if (cancelled) return;
        const running = data.running === true;
        if (prevRecomputingRef.current && !running) {
          void queryClient.invalidateQueries();
        }
        prevRecomputingRef.current = running;
        lastRecomputingRef.current = running;
        setRecomputeRunning(running);
      } catch {
        // Older addons may not expose the status endpoint, or a
        // transient fetch error occurred — keep the last-known
        // running flag so polling cadence stays fast.
      }
    };

    void fetchRecomputeStatus();
    // Faster cadence while recompute is in flight so dashboards light
    // up promptly when the worker finishes.
    const interval = setInterval(
      () => {
        void fetchRecomputeStatus();
      },
      recomputeRunning || lastRecomputingRef.current ? 3000 : 30000,
    );

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [status?.connected, apiUrl, recomputeRunning, queryClient]);

  const handleSyncNow = async () => {
    setTriggeringSyncState(true);
    try {
      const res = await fetch(apiUrl("/api/garmin/sync"), { method: "POST" });
      const data = (await res.json()) as { success: boolean; message?: string };
      if (!data.success) {
        setError(
          data.message ?? "Synchronisierung konnte nicht gestartet werden.",
        );
      }
    } catch {
      setError(
        "Synchronisierung fehlgeschlagen. Prüfe deine Verbindung und versuche es erneut.",
      );
    } finally {
      setTriggeringSyncState(false);
    }
  };

  const [recomputing, setRecomputing] = useState(false);

  const handleRecompute = async () => {
    setRecomputing(true);
    try {
      const res = await fetch(apiUrl("/api/garmin/recompute"), {
        method: "POST",
      });
      const data = (await res.json()) as {
        success: boolean;
        message?: string;
      };
      if (!data.success) {
        setError(
          data.message ?? "Neuberechnung konnte nicht gestartet werden.",
        );
      }
    } catch {
      setError(
        "Neuberechnung fehlgeschlagen. Prüfe deine Verbindung und versuche es erneut.",
      );
    } finally {
      setRecomputing(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const res = await fetch(apiUrl("/api/garmin/auth"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as AuthResponse;

      if (data.success) {
        setEmail("");
        setPassword("");
        await fetchStatus();
      } else if (data.needsMfa) {
        setShowMfa(true);
      } else {
        setError(
          data.message ??
            "Anmeldung fehlgeschlagen. Prüfe E-Mail und Passwort.",
        );
      }
    } catch {
      setError(
        "Verbindungsfehler. Prüfe deine Internetverbindung und versuche es erneut.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const res = await fetch(apiUrl("/api/garmin/auth"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: mfaCode }),
      });
      const data = (await res.json()) as AuthResponse;

      if (data.success) {
        setShowMfa(false);
        setMfaCode("");
        setEmail("");
        setPassword("");
        await fetchStatus();
      } else {
        setError(
          data.message ?? "MFA-Verifizierung fehlgeschlagen. Prüfe den Code.",
        );
      }
    } catch {
      setError(
        "Verbindungsfehler. Prüfe deine Internetverbindung und versuche es erneut.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisconnect = async () => {
    setSubmitting(true);
    setError("");
    try {
      await fetch(apiUrl("/api/garmin/auth"), { method: "DELETE" });
      await fetchStatus();
    } catch {
      setError("Trennen fehlgeschlagen. Versuche es erneut.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-card space-y-3 rounded-2xl border p-4">
        <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
          Garmin-Verbindung
        </h2>
        <p className="text-muted-foreground text-sm">
          Verbindung wird geprüft… {debugUrl && `(${debugUrl})`}
        </p>
      </div>
    );
  }

  // Connected state
  if (status?.connected) {
    return (
      <div className="bg-card space-y-3 rounded-2xl border p-4">
        <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
          Garmin-Verbindung
        </h2>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10">
            <span className="text-lg">⌚</span>
          </div>
          <div>
            <p className="text-sm font-medium">Garmin Connect</p>
            <p className="text-muted-foreground text-xs">
              Verbunden{status.email ? ` · ${status.email}` : ""}
            </p>
            {status.lastSync && (
              <p className="text-muted-foreground text-xs">
                Letzter Sync:{" "}
                {formatDateInTz(status.lastSync, timezone, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}{" "}
                um {formatTimeInTz(status.lastSync, timezone)}
              </p>
            )}
          </div>
        </div>
        {/* Sync status and trigger */}
        {syncStatus?.syncing ? (
          <div className="space-y-2 pt-2">
            <div className="flex items-center gap-2">
              <svg
                className="text-primary h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span className="text-primary text-sm font-medium">
                Wird synchronisiert …
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              {syncStatus.detail || syncStatus.phase}
            </p>
            <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full transition-all duration-500"
                style={{ width: `${syncStatus.progress}%` }}
              />
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncNow}
            disabled={triggeringSyncState}
            className="mt-2"
          >
            {triggeringSyncState
              ? "Wird gestartet …"
              : "🔄 Jetzt synchronisieren"}
          </Button>
        )}
        <Button
          size="sm"
          onClick={handleRecompute}
          disabled={recomputing || !status?.connected}
        >
          {recomputing ? "Wird berechnet …" : "🔄 Metriken neu berechnen"}
        </Button>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <Button
          variant="outline"
          size="sm"
          onClick={handleDisconnect}
          disabled={submitting}
        >
          {submitting ? "Wird getrennt …" : "Trennen"}
        </Button>
      </div>
    );
  }

  // MFA step
  if (showMfa) {
    return (
      <div className="bg-card space-y-3 rounded-2xl border p-4">
        <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
          Garmin-Verbindung
        </h2>
        <p className="text-sm">
          Ein Bestätigungscode wurde an dein Gerät gesendet. Gib ihn unten ein.
        </p>
        <form onSubmit={handleMfa} className="space-y-3">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="MFA-Code"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
            required
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? "Wird überprüft …" : "Bestätigen"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setShowMfa(false);
                setMfaCode("");
                setError("");
              }}
            >
              Abbrechen
            </Button>
          </div>
        </form>
      </div>
    );
  }

  // Disconnected — login form
  return (
    <div className="bg-card space-y-3 rounded-2xl border p-4">
      <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
        Garmin-Verbindung
      </h2>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
          <span className="text-lg">⌚</span>
        </div>
        <div>
          <p className="text-sm font-medium">Garmin Connect</p>
          <p className="text-muted-foreground text-xs">Nicht verbunden</p>
        </div>
      </div>
      <form onSubmit={handleLogin} className="space-y-3">
        <input
          type="email"
          placeholder="Garmin-E-Mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
          required
        />
        <input
          type="password"
          placeholder="Passwort"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
          required
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Wird verbunden …" : "Verbinden"}
        </Button>
      </form>
    </div>
  );
}

export default function SettingsPage() {
  const version = env.NEXT_PUBLIC_APP_VERSION;
  const buildTime = env.NEXT_PUBLIC_BUILD_TIME;

  return (
    <PageShell density="reading">
      <h1 className="pl-12 text-2xl font-bold">Einstellungen</h1>

      <div className="mt-6 space-y-6">
        {/* Athlete Profile */}
        <ProfileEditor />

        {/* Health & Safety */}
        <HealthProfile />

        {/* How much of the app the navigation shows */}
        <AudienceSettings />

        {/* Timezone */}
        <TimezoneSettings />

        {/* Garmin Connection — must work for data sync */}
        <GarminConnection />

        {/* Data & Privacy */}
        <div className="bg-card space-y-3 rounded-2xl border p-4">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
            Daten & Datenschutz
          </h2>
          <p className="text-muted-foreground text-xs">
            Deine Garmin-Daten werden sicher gespeichert und ausschließlich zur
            Berechnung deines Readiness-Werts und deiner Trainingsempfehlungen
            genutzt. Wir geben deine Daten niemals weiter.
          </p>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              <strong>⚠️ Medizinischer Hinweis:</strong> Pacer liefert
              KI-generierte Trainingshinweise und ersetzt keine professionelle
              medizinische Beratung, Diagnose oder Behandlung. Konsultiere vor
              Beginn oder Änderung eines Trainingsprogramms immer eine
              qualifizierte Ärztin oder einen qualifizierten Arzt. Individuelle
              Ergebnisse können variieren.
            </p>
          </div>
        </div>

        <div className="pb-2 text-center">
          <VersionBadge version={version} buildTime={buildTime} fullText />
        </div>
      </div>

      <BottomNav />
    </PageShell>
  );
}
