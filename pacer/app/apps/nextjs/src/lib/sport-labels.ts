/**
 * German display names for Garmin sport types.
 *
 * Lived as two drifting copies in `activities/page.tsx` and
 * `workout/[id]/page.tsx` — the copies disagreed on whether
 * `strength_training` resolved at all.
 */
const SPORT_LABELS_DE: Record<string, string> = {
  running: "Laufen",
  "trail running": "Trailrunning",
  "treadmill running": "Laufband",
  "indoor running": "Indoor-Laufen",
  cycling: "Radfahren",
  "road biking": "Rennradfahren",
  "mountain biking": "Mountainbiken",
  "indoor cycling": "Indoor-Radfahren",
  "virtual ride": "Virtuelle Fahrt",
  strength_training: "Krafttraining",
  "strength training": "Krafttraining",
  weightlifting: "Gewichtheben",
  swimming: "Schwimmen",
  "lap swimming": "Bahnenschwimmen",
  "open water swimming": "Freiwasserschwimmen",
  walking: "Gehen",
  "treadmill walking": "Gehen (Laufband)",
  hiking: "Wandern",
  yoga: "Yoga",
  pilates: "Pilates",
  meditation: "Meditation",
  stretching: "Dehnen",
  breathwork: "Atemübungen",
  mobility: "Beweglichkeit",
  elliptical: "Crosstrainer",
  rowing: "Rudern",
  "indoor rowing": "Indoor-Rudern",
  other: "Sonstiges",
};

/** Falls back to a title-cased version of the raw type for unknown sports. */
export function sportLabel(sportType: string | null | undefined): string {
  if (!sportType) return "Aktivität";
  const spaced = sportType.replace(/_/g, " ").toLowerCase();
  return (
    SPORT_LABELS_DE[sportType.toLowerCase()] ??
    SPORT_LABELS_DE[spaced] ??
    spaced.replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
