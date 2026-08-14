"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { Label } from "@acme/ui/label";

import { PageShell } from "~/components/page-shell";
import { useTRPC } from "~/trpc/react";

const HEALTH_CONDITIONS = [
  { id: "asthma", label: "🫁 Asthma", desc: "Belastungsinduziert oder chronisch" },
  {
    id: "hypertension",
    label: "❤️‍🩹 Bluthochdruck",
    desc: "Behandelt oder unbehandelt",
  },
  { id: "diabetes_t1", label: "💉 Diabetes Typ 1", desc: "Insulinpflichtig" },
  {
    id: "diabetes_t2",
    label: "🩺 Diabetes Typ 2",
    desc: "Diät- oder medikamentös eingestellt",
  },
  {
    id: "heart_condition",
    label: "🫀 Herzerkrankung",
    desc: "Herzrhythmusstörungen, Herzgeräusch usw.",
  },
  {
    id: "joint_issues",
    label: "🦴 Gelenkprobleme",
    desc: "Arthrose, chronische Schmerzen",
  },
  {
    id: "back_issues",
    label: "🔙 Rückenprobleme",
    desc: "Bandscheibenvorfall, chronische Schmerzen",
  },
  {
    id: "respiratory",
    label: "😮‍💨 Atemwegserkrankungen",
    desc: "COPD, Schlafapnoe",
  },
  { id: "thyroid", label: "🦋 Schilddrüsenerkrankung", desc: "Unter- oder Überfunktion" },
  {
    id: "anxiety_depression",
    label: "🧠 Angst/Depression",
    desc: "Beeinflusst die Trainingsmotivation",
  },
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

// Display-only translations. The underlying values (body part IDs, sport
// IDs, day IDs, severity) are unchanged — they're stored, sent to the API,
// and compared as-is; only the German label shown to the user is looked
// up here.
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

const SEX_LABELS: Record<"male" | "female" | "other", string> = {
  male: "Männlich",
  female: "Weiblich",
  other: "Divers",
};

const SPORT_LABELS: Record<string, string> = {
  running: "Laufen",
  cycling: "Radfahren",
  strength: "Krafttraining",
  swimming: "Schwimmen",
  team_sport: "Mannschaftssport",
};

const DAY_LABELS: Record<string, string> = {
  mon: "Mo",
  tue: "Di",
  wed: "Mi",
  thu: "Do",
  fri: "Fr",
  sat: "Sa",
  sun: "So",
};

const SPORTS = ["running", "cycling", "strength", "swimming", "team_sport"];
const GOALS = [
  "maintain",
  "performance",
  "body_composition",
  "return_from_injury",
];
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const GOAL_LABELS: Record<string, string> = {
  maintain: "🏃 Fitness erhalten",
  performance: "🏆 Leistung steigern",
  body_composition: "💪 Körperzusammensetzung",
  return_from_injury: "🔄 Wiedereinstieg nach Pause",
};

export default function OnboardingPage() {
  const router = useRouter();
  const trpc = useTRPC();
  const [step, setStep] = useState(0);

  // Profile state
  const [age, setAge] = useState("");
  const [sex, setSex] = useState<"male" | "female" | "other">("male");
  const [massKg, setMassKg] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [goals, setGoals] = useState<{ sport: string; goalType: string }[]>([]);
  const [weeklyDays, setWeeklyDays] = useState<string[]>([
    "mon",
    "wed",
    "fri",
    "sat",
  ]);
  const [minutesPerDay, setMinutesPerDay] = useState(45);
  const [healthConditions, setHealthConditions] = useState<string[]>([]);
  const [injuries, setInjuries] = useState<
    {
      bodyPart: string;
      severity: "mild" | "moderate" | "severe";
      since?: string;
      notes?: string;
    }[]
  >([]);
  const [medications, setMedications] = useState("");
  const [allergies, setAllergies] = useState("");

  const upsertProfile = useMutation(
    trpc.profile.upsert.mutationOptions({
      onSuccess: () => router.push("/"),
    }),
  );

  const toggleSport = (s: string) => {
    setSelectedSports((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  };

  const toggleDay = (d: string) => {
    setWeeklyDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  };

  const handleFinish = () => {
    upsertProfile.mutate({
      userId: "current-user", // will be overridden by server
      age: age ? parseInt(age) : null,
      sex,
      massKg: massKg ? parseFloat(massKg) : null,
      heightCm: heightCm ? parseFloat(heightCm) : null,
      experienceLevel: "intermediate",
      primarySports: selectedSports,
      goals: selectedSports.map((sport) => ({
        sport,
        goalType: goals.find((g) => g.sport === sport)?.goalType ?? "maintain",
      })),
      weeklyDays,
      minutesPerDay,
      healthConditions,
      currentInjuries: injuries,
      medications: medications || undefined,
      allergies: allergies || undefined,
    });
  };

  const steps = [
    // Step 0: Profile
    <div key="profile" className="space-y-4">
      <h2 className="text-xl font-bold">Über dich</h2>
      <p className="text-muted-foreground text-sm">
        Damit können wir dein Training persönlich zuschneiden.
      </p>
      <div className="grid-metrics">
        <div>
          <Label>Alter</Label>
          <Input
            type="number"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            placeholder="32"
          />
        </div>
        <div>
          <Label>Geschlecht</Label>
          <div className="flex gap-2">
            {(["male", "female", "other"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSex(s)}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2 text-sm",
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
            placeholder="78"
          />
        </div>
        <div>
          <Label>Größe (cm)</Label>
          <Input
            type="number"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            placeholder="180"
          />
        </div>
      </div>
    </div>,

    // Step 1: Sports
    <div key="sports" className="space-y-4">
      <h2 className="text-xl font-bold">Deine Sportarten</h2>
      <p className="text-muted-foreground text-sm">
        Wähle alle Sportarten aus, die du trainierst.
      </p>
      <div className="flex flex-wrap gap-2">
        {SPORTS.map((sport) => (
          <button
            key={sport}
            onClick={() => toggleSport(sport)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm transition-colors",
              selectedSports.includes(sport)
                ? "border-primary bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:border-foreground/30",
            )}
          >
            {SPORT_LABELS[sport] ?? sport}
          </button>
        ))}
      </div>

      {selectedSports.length > 0 && (
        <div className="space-y-3 pt-2">
          <p className="text-sm font-medium">Ziel für jede Sportart:</p>
          {selectedSports.map((sport) => (
            <div key={sport} className="space-y-1">
              <p className="text-muted-foreground text-xs">
                {SPORT_LABELS[sport] ?? sport}
              </p>
              <div className="flex flex-wrap gap-1">
                {GOALS.map((goal) => (
                  <button
                    key={goal}
                    onClick={() =>
                      setGoals((prev) => [
                        ...prev.filter((g) => g.sport !== sport),
                        { sport, goalType: goal },
                      ])
                    }
                    className={cn(
                      "rounded-lg border px-2 py-1 text-xs transition-colors",
                      goals.find(
                        (g) => g.sport === sport && g.goalType === goal,
                      )
                        ? "border-primary bg-primary/10 text-primary"
                        : "text-muted-foreground",
                    )}
                  >
                    {GOAL_LABELS[goal]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>,

    // Step 2: Availability
    <div key="availability" className="space-y-4">
      <h2 className="text-xl font-bold">Wochenplan</h2>
      <p className="text-muted-foreground text-sm">An welchen Tagen kannst du trainieren?</p>
      <div className="flex gap-2">
        {DAYS.map((d) => (
          <button
            key={d}
            onClick={() => toggleDay(d)}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full border text-xs font-medium uppercase transition-colors",
              weeklyDays.includes(d)
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground",
            )}
          >
            {DAY_LABELS[d]}
          </button>
        ))}
      </div>
      <div>
        <Label>Minuten pro Einheit: {minutesPerDay}</Label>
        <input
          type="range"
          min={15}
          max={120}
          step={5}
          value={minutesPerDay}
          onChange={(e) => setMinutesPerDay(parseInt(e.target.value))}
          className="w-full"
        />
        <div className="text-muted-foreground flex justify-between text-xs">
          <span>15 Min.</span>
          <span>120 Min.</span>
        </div>
      </div>
    </div>,

    // Step 3: Health & Safety
    <div key="health" className="space-y-4">
      <h2 className="text-xl font-bold">Gesundheit & Sicherheit</h2>
      <p className="text-muted-foreground text-sm">
        Optional — hilft uns, sichere Empfehlungen für deinen Körper zu geben.
      </p>

      {/* Health conditions */}
      <div>
        <Label className="text-sm font-medium">Gesundheitliche Vorerkrankungen?</Label>
        <div className="mt-2 grid-wide">
          {HEALTH_CONDITIONS.map((c) => (
            <button
              key={c.id}
              onClick={() =>
                setHealthConditions((prev) =>
                  prev.includes(c.id)
                    ? prev.filter((x) => x !== c.id)
                    : [...prev, c.id],
                )
              }
              className={cn(
                "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                healthConditions.includes(c.id)
                  ? "border-primary bg-primary/5"
                  : "hover:border-foreground/20",
              )}
            >
              <span className="text-lg leading-none">
                {c.label.split(" ")[0]}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {c.label.split(" ").slice(1).join(" ")}
                </p>
                <p className="text-muted-foreground text-xs">{c.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Current injuries */}
      <div>
        <Label className="text-sm font-medium">Aktuelle Verletzungen?</Label>
        <div className="mt-2 flex flex-wrap gap-2">
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
                  "rounded-full border px-3 py-1.5 text-xs transition-colors",
                  existing
                    ? "border-amber-500 bg-amber-500/10 font-medium text-amber-700 dark:text-amber-400"
                    : "text-muted-foreground hover:border-foreground/30",
                )}
              >
                {BODY_PART_LABELS[part] ?? part}
              </button>
            );
          })}
        </div>
        {injuries.length > 0 && (
          <div className="mt-2 space-y-2">
            {injuries.map((injury) => (
              <div
                key={injury.bodyPart}
                className="flex items-center gap-2 text-sm"
              >
                <span className="min-w-[80px] font-medium">
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
                      "rounded-md border px-2 py-0.5 text-xs",
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
        <Label>Aktuelle Medikamente</Label>
        <Input
          value={medications}
          onChange={(e) => setMedications(e.target.value)}
          placeholder="z. B. Betablocker, Metformin, Inhalator…"
        />
      </div>

      {/* Allergies */}
      <div>
        <Label>Allergien oder Unverträglichkeiten</Label>
        <Input
          value={allergies}
          onChange={(e) => setAllergies(e.target.value)}
          placeholder="z. B. Pollen, laktoseintolerant…"
        />
      </div>

      <p className="text-muted-foreground text-xs italic">
        💡 Alle Gesundheitsinformationen sind optional und werden lokal
        gespeichert. Sie helfen unserer KI, unsichere Empfehlungen zu vermeiden.
      </p>
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
        <p className="text-xs text-amber-700 dark:text-amber-400">
          <strong>⚠️ Medizinischer Hinweis:</strong> Pacer ersetzt keine
          professionelle medizinische Beratung, Diagnose oder Behandlung.
          Empfehlungen werden von einer KI erstellt und berücksichtigen
          möglicherweise nicht alle individuellen Faktoren. Konsultiere vor
          Beginn oder Änderung eines Trainingsprogramms immer eine
          qualifizierte Ärztin oder einen qualifizierten Arzt, besonders bei
          bestehenden Vorerkrankungen. Individuelle Ergebnisse können
          variieren.
        </p>
      </div>
    </div>,
  ];

  return (
    <PageShell density="reading">
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center">
      {/* Progress */}
      <div className="mb-6 flex gap-1">
        {steps.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full",
              i <= step ? "bg-primary" : "bg-muted",
            )}
          />
        ))}
      </div>

      {steps[step]}

      {/* Navigation */}
      <div className="mt-8 flex gap-3">
        {step > 0 && (
          <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
            Zurück
          </Button>
        )}
        {step < steps.length - 1 ? (
          <Button className="flex-1" onClick={() => setStep((s) => s + 1)}>
            Weiter
          </Button>
        ) : (
          <Button
            className="flex-1"
            onClick={handleFinish}
            disabled={upsertProfile.isPending}
          >
            {upsertProfile.isPending ? "Wird gespeichert…" : "Los geht's 🚀"}
          </Button>
        )}
      </div>
      </div>
    </PageShell>
  );
}
