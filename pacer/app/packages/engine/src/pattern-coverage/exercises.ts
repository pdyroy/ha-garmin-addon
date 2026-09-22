/**
 * MOVEMENT PATTERN TAXONOMY + EXERCISE REFERENCE DATA
 *
 * Strength work is organised by what the body does, not by which muscle is
 * sore afterwards. Nine patterns cover the joint actions a general programme
 * has to touch; grouping them into seven collapses the two push and the two
 * pull directions, which is the granularity a weekly plan is written at.
 *
 * The rationale for pattern-based programming over muscle-group splits is
 * that a split guarantees volume per muscle but says nothing about whether
 * every joint action was loaded — the horizontal pull and the loaded carry
 * are the two that fall out of a "chest/back/legs" week most often.
 *
 * Ref: Cook G. Movement: Functional Movement Systems. On Target, 2010.
 * Ref: Boyle M. New Functional Training for Sports. 2nd ed. Human Kinetics,
 *      2016 — chapters 6-9 on pattern-based session structure.
 *
 * This is reference data, not user data: it lives in code rather than in a
 * table so there is no seed step and no migration when the list grows.
 * A user-defined exercise needs a table; nobody has asked for one yet.
 */

/** The nine movement patterns coverage is tracked against. */
export const MOVEMENT_PATTERNS = [
  "squat",
  "hinge",
  "lunge",
  "push_horizontal",
  "push_vertical",
  "pull_horizontal",
  "pull_vertical",
  "carry",
  "rotation",
] as const;

export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

/** The seven groups the nine patterns roll up into. */
export const PATTERN_GROUPS = [
  "squat",
  "hinge",
  "lunge",
  "push",
  "pull",
  "carry",
  "rotation",
] as const;

export type PatternGroup = (typeof PATTERN_GROUPS)[number];

const PATTERN_TO_GROUP: Record<MovementPattern, PatternGroup> = {
  squat: "squat",
  hinge: "hinge",
  lunge: "lunge",
  push_horizontal: "push",
  push_vertical: "push",
  pull_horizontal: "pull",
  pull_vertical: "pull",
  carry: "carry",
  rotation: "rotation",
};

export function patternGroup(pattern: MovementPattern): PatternGroup {
  return PATTERN_TO_GROUP[pattern];
}

/** German labels — the UI is German throughout (see lib/sport-labels.ts). */
export const PATTERN_LABELS: Record<MovementPattern, string> = {
  squat: "Kniebeuge",
  hinge: "Hüftbeuge",
  lunge: "Ausfallschritt",
  push_horizontal: "Druck horizontal",
  push_vertical: "Druck vertikal",
  pull_horizontal: "Zug horizontal",
  pull_vertical: "Zug vertikal",
  carry: "Tragen",
  rotation: "Rotation / Anti-Rotation",
};

export const EQUIPMENT = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "machine",
  "cable",
  "bodyweight",
  "band",
] as const;

export type Equipment = (typeof EQUIPMENT)[number];

export interface Exercise {
  /** Stable slug. Stored on every logged set — never renumber these. */
  id: string;
  name: string;
  pattern: MovementPattern;
  /** Every piece of kit the movement can be done with, for plan filtering. */
  equipment: Equipment[];
  /** Loaded one side at a time, so it also trains resisting the asymmetry. */
  unilateral: boolean;
}

export const EXERCISES: Exercise[] = [
  // --- squat ---------------------------------------------------------------
  {
    id: "back-squat",
    name: "Kniebeuge",
    pattern: "squat",
    equipment: ["barbell"],
    unilateral: false,
  },
  {
    id: "front-squat",
    name: "Frontkniebeuge",
    pattern: "squat",
    equipment: ["barbell"],
    unilateral: false,
  },
  {
    id: "goblet-squat",
    name: "Goblet Squat",
    pattern: "squat",
    equipment: ["kettlebell", "dumbbell"],
    unilateral: false,
  },
  {
    id: "leg-press",
    name: "Beinpresse",
    pattern: "squat",
    equipment: ["machine"],
    unilateral: false,
  },
  {
    id: "air-squat",
    name: "Luftkniebeuge",
    pattern: "squat",
    equipment: ["bodyweight"],
    unilateral: false,
  },

  // --- hinge ---------------------------------------------------------------
  {
    id: "deadlift",
    name: "Kreuzheben",
    pattern: "hinge",
    equipment: ["barbell"],
    unilateral: false,
  },
  {
    id: "romanian-deadlift",
    name: "Rumänisches Kreuzheben",
    pattern: "hinge",
    equipment: ["barbell", "dumbbell"],
    unilateral: false,
  },
  {
    id: "kettlebell-swing",
    name: "Kettlebell Swing",
    pattern: "hinge",
    equipment: ["kettlebell"],
    unilateral: false,
  },
  {
    id: "hip-thrust",
    name: "Hip Thrust",
    pattern: "hinge",
    equipment: ["barbell", "bodyweight"],
    unilateral: false,
  },
  {
    id: "single-leg-rdl",
    name: "Einbeiniges Kreuzheben",
    pattern: "hinge",
    equipment: ["dumbbell", "kettlebell"],
    unilateral: true,
  },

  // --- lunge ---------------------------------------------------------------
  {
    id: "walking-lunge",
    name: "Gehender Ausfallschritt",
    pattern: "lunge",
    equipment: ["dumbbell", "barbell", "bodyweight"],
    unilateral: true,
  },
  {
    id: "split-squat",
    name: "Split Squat",
    pattern: "lunge",
    equipment: ["dumbbell", "barbell", "bodyweight"],
    unilateral: true,
  },
  {
    id: "bulgarian-split-squat",
    name: "Bulgarischer Split Squat",
    pattern: "lunge",
    equipment: ["dumbbell", "barbell", "bodyweight"],
    unilateral: true,
  },
  {
    id: "step-up",
    name: "Step-up",
    pattern: "lunge",
    equipment: ["dumbbell", "bodyweight"],
    unilateral: true,
  },

  // --- push, horizontal ----------------------------------------------------
  {
    id: "bench-press",
    name: "Bankdrücken",
    pattern: "push_horizontal",
    equipment: ["barbell"],
    unilateral: false,
  },
  {
    id: "dumbbell-bench-press",
    name: "Bankdrücken mit Kurzhanteln",
    pattern: "push_horizontal",
    equipment: ["dumbbell"],
    unilateral: false,
  },
  {
    id: "push-up",
    name: "Liegestütz",
    pattern: "push_horizontal",
    equipment: ["bodyweight"],
    unilateral: false,
  },
  {
    id: "chest-press-machine",
    name: "Brustpresse",
    pattern: "push_horizontal",
    equipment: ["machine"],
    unilateral: false,
  },
  {
    id: "cable-press",
    name: "Kabeldrücken",
    pattern: "push_horizontal",
    equipment: ["cable"],
    unilateral: false,
  },

  // --- push, vertical ------------------------------------------------------
  {
    id: "overhead-press",
    name: "Schulterdrücken",
    pattern: "push_vertical",
    equipment: ["barbell"],
    unilateral: false,
  },
  {
    id: "dumbbell-shoulder-press",
    name: "Schulterdrücken mit Kurzhanteln",
    pattern: "push_vertical",
    equipment: ["dumbbell"],
    unilateral: false,
  },
  {
    id: "single-arm-press",
    name: "Einarmiges Drücken",
    pattern: "push_vertical",
    equipment: ["kettlebell", "dumbbell"],
    unilateral: true,
  },
  {
    id: "pike-push-up",
    name: "Pike Push-up",
    pattern: "push_vertical",
    equipment: ["bodyweight"],
    unilateral: false,
  },

  // --- pull, horizontal ----------------------------------------------------
  {
    id: "barbell-row",
    name: "Langhantelrudern",
    pattern: "pull_horizontal",
    equipment: ["barbell"],
    unilateral: false,
  },
  {
    id: "single-arm-row",
    name: "Einarmiges Rudern",
    pattern: "pull_horizontal",
    equipment: ["dumbbell", "kettlebell"],
    unilateral: true,
  },
  {
    id: "seated-cable-row",
    name: "Rudern am Kabel",
    pattern: "pull_horizontal",
    equipment: ["cable", "machine"],
    unilateral: false,
  },
  {
    id: "inverted-row",
    name: "Schrägklimmzug",
    pattern: "pull_horizontal",
    equipment: ["bodyweight"],
    unilateral: false,
  },

  // --- pull, vertical ------------------------------------------------------
  {
    id: "pull-up",
    name: "Klimmzug",
    pattern: "pull_vertical",
    equipment: ["bodyweight"],
    unilateral: false,
  },
  {
    id: "chin-up",
    name: "Klimmzug im Untergriff",
    pattern: "pull_vertical",
    equipment: ["bodyweight"],
    unilateral: false,
  },
  {
    id: "lat-pulldown",
    name: "Latzug",
    pattern: "pull_vertical",
    equipment: ["cable", "machine"],
    unilateral: false,
  },
  {
    id: "band-pulldown",
    name: "Latzug mit Band",
    pattern: "pull_vertical",
    equipment: ["band"],
    unilateral: false,
  },

  // --- carry ---------------------------------------------------------------
  {
    id: "farmers-carry",
    name: "Farmer's Walk",
    pattern: "carry",
    equipment: ["dumbbell", "kettlebell"],
    unilateral: false,
  },
  {
    id: "suitcase-carry",
    name: "Suitcase Carry",
    pattern: "carry",
    equipment: ["dumbbell", "kettlebell"],
    unilateral: true,
  },
  {
    id: "front-rack-carry",
    name: "Front Rack Carry",
    pattern: "carry",
    equipment: ["kettlebell", "dumbbell"],
    unilateral: false,
  },
  {
    id: "overhead-carry",
    name: "Overhead Carry",
    pattern: "carry",
    equipment: ["kettlebell", "dumbbell"],
    unilateral: true,
  },

  // --- rotation / anti-rotation --------------------------------------------
  {
    id: "cable-woodchop",
    name: "Woodchopper am Kabel",
    pattern: "rotation",
    equipment: ["cable", "band"],
    unilateral: true,
  },
  {
    id: "pallof-press",
    name: "Pallof Press",
    pattern: "rotation",
    equipment: ["cable", "band"],
    unilateral: true,
  },
  {
    id: "side-plank",
    name: "Seitstütz",
    pattern: "rotation",
    equipment: ["bodyweight"],
    unilateral: true,
  },
  {
    id: "russian-twist",
    name: "Russian Twist",
    pattern: "rotation",
    equipment: ["bodyweight", "dumbbell", "kettlebell"],
    unilateral: false,
  },
  {
    id: "dead-bug",
    name: "Dead Bug",
    pattern: "rotation",
    equipment: ["bodyweight"],
    unilateral: false,
  },
];

const BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));

export function findExercise(id: string): Exercise | undefined {
  return BY_ID.get(id);
}

/**
 * The pattern a logged set trains, or null when the exercise id is unknown —
 * a set logged before an exercise was renamed away, or one written by hand.
 * Unknown ids are reported rather than silently dropped.
 */
export function patternForExercise(id: string): MovementPattern | null {
  return BY_ID.get(id)?.pattern ?? null;
}

/** Exercises for a pattern, optionally narrowed to the kit on hand. */
export function exercisesForPattern(
  pattern: MovementPattern,
  equipment?: Equipment[],
): Exercise[] {
  const pool = EXERCISES.filter((e) => e.pattern === pattern);
  if (!equipment || equipment.length === 0) return pool;
  return pool.filter((e) => e.equipment.some((eq) => equipment.includes(eq)));
}
