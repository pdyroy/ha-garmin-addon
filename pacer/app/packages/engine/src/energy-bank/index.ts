/**
 * ENERGY BANK — where the day's energy went
 *
 * Garmin's Body Battery is a 0-100 estimate of available energy, updated
 * every few minutes. The daily high and low alone say how much was charged
 * and spent; this module says *when* and *to what*, by walking the intraday
 * series and attributing every step change to the activity, the sleep
 * window, or the part of the day it falls in.
 *
 * Body Battery is Firstbeat's own model over HRV, stress and activity — a
 * proprietary estimate, not a measurement. Nothing here validates it; the
 * attribution is only as good as the curve it is handed. What it does add
 * is honesty about size: a 6-point dip during a meeting is noise next to a
 * 30-point drain across a long run, and ranking by magnitude makes that
 * visible instead of leaving every wiggle looking equally meaningful.
 *
 * Ref: Firstbeat Technologies. Stress and Recovery Analysis Method Based on
 *      24-Hour Heart Rate Variability. White paper, 2014.
 */

export interface EnergyBankPoint {
  /** Epoch milliseconds. */
  ts: number;
  /** Body Battery level, 0-100. */
  value: number;
}

export type EnergyBankSource = "sleep" | "activity" | "day";

export interface EnergyBankSegment {
  /** Bucket key — activity id, "sleep", or a day-block name. */
  key: string;
  label: string;
  source: EnergyBankSource;
  /** Net Body Battery change attributed to this bucket. */
  delta: number;
  /** First and last sample that contributed, epoch millis. */
  startTs: number;
  endTs: number;
  /** Mean stress level over the same samples, when a stress series exists. */
  meanStress: number | null;
}

export interface EnergyBankActivityInput {
  id: string;
  label: string;
  startTs: number;
  endTs: number;
}

export interface EnergyBankInput {
  /** Intraday Body Battery, [[epoch_millis, value], ...] or point objects. */
  bodyBattery:
    | readonly (readonly [number, number])[]
    | readonly EnergyBankPoint[];
  /** Intraday stress, same shape. Optional. */
  stress?:
    | readonly (readonly [number, number])[]
    | readonly EnergyBankPoint[]
    | null;
  activities?: readonly EnergyBankActivityInput[];
  /** IANA timezone the clock-time buckets are read in. */
  timezone?: string;
  /** Local "HH:MM" bounds of the night, from Garmin's sleep session. */
  sleepStartTime?: string | null;
  sleepEndTime?: string | null;
}

export interface EnergyBankOutput {
  /** Last level minus first level over the whole series. */
  net: number;
  peak: EnergyBankPoint;
  trough: EnergyBankPoint;
  /** Positive buckets, largest first. */
  charges: EnergyBankSegment[];
  /** Negative buckets, largest drain first. */
  drains: EnergyBankSegment[];
  /** Samples that carried a usable value. */
  pointsUsed: number;
}

export type EnergyBankResult =
  | { value: EnergyBankOutput; reason?: undefined }
  | { value: null; reason: string };

/** Day blocks, keyed by local hour. Night wraps midnight. */
const DAY_BLOCKS: { key: string; label: string; from: number; to: number }[] = [
  { key: "morning", label: "Vormittag", from: 5, to: 11 },
  { key: "midday", label: "Mittag", from: 11, to: 14 },
  { key: "afternoon", label: "Nachmittag", from: 14, to: 18 },
  { key: "evening", label: "Abend", from: 18, to: 23 },
  { key: "night", label: "Nacht", from: 23, to: 5 },
];

/** Below this the "drain" is model noise, not an event worth naming. */
const MIN_REPORTABLE_DELTA = 1;

function toPoints(
  series:
    | readonly (readonly [number, number])[]
    | readonly EnergyBankPoint[]
    | null
    | undefined,
): EnergyBankPoint[] {
  if (!series) return [];
  const points: EnergyBankPoint[] = [];
  for (const entry of series) {
    const ts = Array.isArray(entry) ? entry[0] : (entry as EnergyBankPoint).ts;
    const value = Array.isArray(entry)
      ? entry[1]
      : (entry as EnergyBankPoint).value;
    if (typeof ts !== "number" || typeof value !== "number") continue;
    if (!Number.isFinite(ts) || !Number.isFinite(value)) continue;
    points.push({ ts, value });
  }
  return points.sort((a, b) => a.ts - b.ts);
}

/** Local minutes since midnight for an epoch, in the given timezone. */
function localMinutesFactory(timezone: string): (ts: number) => number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return (ts) => {
    const [h, m] = formatter.format(new Date(ts)).split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
}

function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  if (h === undefined || m === undefined) return null;
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** Circular containment: 22:30-06:00 contains 23:00 and 01:00. */
function withinWindow(minutes: number, start: number, end: number): boolean {
  return start <= end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}

function blockFor(minutes: number): { key: string; label: string } {
  const hour = Math.floor(minutes / 60);
  const block =
    DAY_BLOCKS.find((b) =>
      b.from <= b.to
        ? hour >= b.from && hour < b.to
        : hour >= b.from || hour < b.to,
    ) ?? DAY_BLOCKS[0]!;
  return { key: block.key, label: block.label };
}

/**
 * Attribute every step change in the Body Battery curve.
 *
 * A step is credited to the activity that was running at its END sample —
 * the level that a run costs shows up while and just after it, so anchoring
 * on the end keeps a session's own drain inside the session rather than
 * spilling it into the block before it.
 *
 * Missing samples are gaps, not zero: a step across a two-hour hole is
 * still one step, and is attributed by where it lands. Nothing is
 * interpolated.
 *
 * Buckets whose whole-day net stays under {@link MIN_REPORTABLE_DELTA} are
 * dropped as model noise, so the listed segments can sum to slightly less
 * than `net`. `net` itself is always the raw first-to-last difference.
 */
export function computeEnergyBank({
  bodyBattery,
  stress,
  activities = [],
  timezone = "UTC",
  sleepStartTime,
  sleepEndTime,
}: EnergyBankInput): EnergyBankResult {
  const points = toPoints(bodyBattery);
  if (points.length < 2) {
    return {
      value: null,
      reason: `Only ${points.length} intraday Body Battery sample(s) — need at least 2.`,
    };
  }

  const stressPoints = toPoints(stress);
  let localMinutes: (ts: number) => number;
  try {
    localMinutes = localMinutesFactory(timezone);
  } catch {
    localMinutes = localMinutesFactory("UTC");
  }

  const sleepStart = parseHHMM(sleepStartTime);
  const sleepEnd = parseHHMM(sleepEndTime);

  interface Bucket {
    key: string;
    label: string;
    source: EnergyBankSource;
    delta: number;
    startTs: number;
    endTs: number;
    stressSum: number;
    stressCount: number;
  }
  const buckets = new Map<string, Bucket>();

  /** Mean stress over [from, to], or null when the series has no cover. */
  function stressBetween(from: number, to: number): [number, number] {
    let sum = 0;
    let count = 0;
    for (const p of stressPoints) {
      if (p.ts > from && p.ts <= to) {
        sum += p.value;
        count += 1;
      }
    }
    return [sum, count];
  }

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const delta = curr.value - prev.value;
    if (delta === 0) continue;

    const minutes = localMinutes(curr.ts);
    const activity = activities.find(
      (a) => curr.ts > a.startTs && curr.ts <= a.endTs,
    );

    let key: string;
    let label: string;
    let source: EnergyBankSource;
    if (activity) {
      key = `activity:${activity.id}`;
      label = activity.label;
      source = "activity";
    } else if (
      sleepStart !== null &&
      sleepEnd !== null &&
      withinWindow(minutes, sleepStart, sleepEnd)
    ) {
      key = "sleep";
      label = "Schlaf";
      source = "sleep";
    } else {
      const block = blockFor(minutes);
      key = `day:${block.key}`;
      label = block.label;
      source = "day";
    }

    const [stressSum, stressCount] = stressBetween(prev.ts, curr.ts);
    const existing = buckets.get(key);
    if (existing) {
      existing.delta += delta;
      existing.endTs = curr.ts;
      existing.stressSum += stressSum;
      existing.stressCount += stressCount;
    } else {
      buckets.set(key, {
        key,
        label,
        source,
        delta,
        startTs: prev.ts,
        endTs: curr.ts,
        stressSum,
        stressCount,
      });
    }
  }

  const segments: EnergyBankSegment[] = [...buckets.values()]
    .filter((b) => Math.abs(b.delta) >= MIN_REPORTABLE_DELTA)
    .map((b) => ({
      key: b.key,
      label: b.label,
      source: b.source,
      delta: Math.round(b.delta * 10) / 10,
      startTs: b.startTs,
      endTs: b.endTs,
      meanStress:
        b.stressCount > 0
          ? Math.round((b.stressSum / b.stressCount) * 10) / 10
          : null,
    }));

  const byMagnitude = (a: EnergyBankSegment, b: EnergyBankSegment) =>
    Math.abs(b.delta) - Math.abs(a.delta);

  const peak = points.reduce((best, p) => (p.value > best.value ? p : best));
  const trough = points.reduce((worst, p) =>
    p.value < worst.value ? p : worst,
  );

  return {
    value: {
      net:
        Math.round((points[points.length - 1]!.value - points[0]!.value) * 10) /
        10,
      peak,
      trough,
      charges: segments.filter((s) => s.delta > 0).sort(byMagnitude),
      drains: segments.filter((s) => s.delta < 0).sort(byMagnitude),
      pointsUsed: points.length,
    },
  };
}
