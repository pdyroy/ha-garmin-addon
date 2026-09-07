// ---------------------------------------------------------------------------
// Compact per-activity running digest for the coach LLM.
//
// The raw run data lives in `garmin_raw` (activity_full, activity_splits,
// activity_details) and in the typed Activity columns. This module renders a
// single activity into a small, token-aware plain-text block the coach can
// reason over — splits/kilometres, running form, HR zones and an optional
// downsampled per-minute HR/pace series. It is deliberately deterministic:
// the digest is data, the LLM only analyses it.
//
// Backends (OpenRouter, Requesty, Ollama, ha_conversation) all receive this as
// ordinary prompt text, so nothing here depends on tool-calling support.
// ---------------------------------------------------------------------------

import type { RunningFormScore } from "@acme/engine";
import { analyzeRunningForm } from "@acme/engine";

import { dayInTimezone } from "./timezone";

/** Compute the running-form score from raw activity columns (see engine). */
export function computeRunFormScore(
  source: RunDigestSource,
): RunningFormScore | null {
  return analyzeRunningForm(
    source.avgGroundContactTime ?? null,
    source.verticalOscillation ?? null,
    source.strideLength ?? null,
    source.gctBalance ?? null,
    source.avgCadence ?? null,
    source.profile?.heightCm ?? null,
    source.verticalRatio ?? null,
  );
}

export const RUN_DIGEST_MAX_CHARS = parseInt(
  process.env.COACH_RUN_DIGEST_MAX_CHARS ?? "1400",
  10,
);
// A per-minute HR/pace curve, only rendered on explicit request, never for the
// ordinary digest. 90 points covers a 90-minute session at 1/min resolution.
export const RUN_DIGEST_PER_MINUTE_MAX_POINTS = parseInt(
  process.env.COACH_RUN_DIGEST_PER_MINUTE_MAX_POINTS ?? "90",
  10,
);

export interface RunDigestSource {
  id?: string | null;
  startedAt: Date | string | null;
  sportType: string | null;
  durationMinutes: number | null;
  distanceMeters: number | null;
  avgPaceSecPerKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  maxCadence?: number | null;
  elevationGain: number | null;
  avgGroundContactTime: number | null;
  gctBalance: number | null;
  verticalOscillation: number | null;
  verticalRatio: number | null;
  strideLength: number | null;
  avgRespirationRate: number | null;
  // The typed laps column already reshaped from activity_splits by the sync.
  laps?:
    | {
        distanceMeters?: number | null;
        durationSeconds?: number | null;
        avgHr?: number | null;
        avgPaceSecPerKm?: number | null;
        avgCadence?: number | null;
        elevationGain?: number | null;
      }[]
    | null;
  hrZoneMinutes?: {
    zone1?: number | null;
    zone2?: number | null;
    zone3?: number | null;
    zone4?: number | null;
    zone5?: number | null;
  } | null;
  profile?: { heightCm?: number | null } | null;
  runningFormScore?: RunningFormScore | null;
}

export interface RunDigestOptions {
  /** Include the downsampled per-minute HR/pace series (expensive, opt-in). */
  includePerMinute?: boolean;
  /** Already-parsed per-minute HR series (t seconds, hr bpm); opt-in. */
  perMinuteHr?: { t: number; hr: number | null }[] | null;
  /** Already-parsed per-minute pace series (t seconds, secPerKm). */
  perMinutePace?: { t: number; secPerKm: number | null }[] | null;
}

// ---------------------------------------------------------------------------
// Small pure parsing helpers (mirror the sync/_laps_from_splits shapes so the
// digest can also be fed raw activity_splits / activity_details payloads).
// ---------------------------------------------------------------------------

function fmtPace(secPerKm: number | null | undefined): string {
  if (secPerKm == null || !Number.isFinite(secPerKm)) return "n/a";
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function toFixed(v: number | null | undefined, dp = 1): string {
  return v != null && Number.isFinite(v) ? v.toFixed(dp) : "n/a";
}

/**
 * Derive an HR-drift value in bpm: average of the split HR in the first half
 * of the session versus the second half. A positive value means HR rose — the
 * classic cardiac-drift marker of fatigue / poor fitness at that pace.
 */
function computeHrDrift(laps: RunDigestSource["laps"]): number | null {
  const hrs = (laps ?? [])
    .map((l) => l.avgHr)
    .filter((v): v is number => v != null);
  if (hrs.length < 4) return null;
  const half = Math.floor(hrs.length / 2);
  const first = hrs.slice(0, half);
  const last = hrs.slice(half);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  return Math.round(mean(last) - mean(first));
}

// ---------------------------------------------------------------------------
// Digest builder
// ---------------------------------------------------------------------------

function renderForm(formScore: RunningFormScore | null): string[] | null {
  if (!formScore) return null;
  const lines: string[] = [];
  const gct = formScore.groundContactTime;
  const vo = formScore.verticalOscillation;
  const stride = formScore.strideLength;
  const cadence = formScore.cadence;
  if (cadence.value > 0)
    lines.push(`- Cadence: ${cadence.value} spm (${cadence.rating})`);
  if (gct.value > 0)
    lines.push(
      `- Ground contact time: ${toFixed(gct.value)} ms (${gct.rating})`,
    );
  if (vo.value > 0)
    lines.push(
      `- Vertical oscillation: ${toFixed(vo.value)} cm (${vo.rating})`,
    );
  if (stride.value > 0)
    lines.push(
      `- Stride length: ${toFixed(stride.value)} m (${stride.rating})`,
    );
  const vr = formScore.verticalRatio;
  if (vr.value > 0)
    lines.push(`- Vertical ratio: ${toFixed(vr.value)}% (${vr.rating})`);
  const bal = formScore.gctBalance;
  if (bal.value > 0)
    lines.push(`- GCT balance L/R: ${toFixed(bal.value)} (${bal.rating})`);
  if (formScore.overall > 0)
    lines.push(`- Running form score: ${formScore.overall}/100`);
  return lines.length > 0 ? lines : null;
}

/** Downsample an already-secondly series to ~N evenly spaced points. */
function downsample<T extends { t: number }>(
  rows: T[] | null | undefined,
  maxPoints: number,
): T[] {
  if (!rows || rows.length === 0) return [];
  const step = Math.max(1, Math.ceil(rows.length / maxPoints));
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += step) {
    const row = rows[i];
    if (row) out.push(row);
  }
  const last = rows[rows.length - 1];
  if (last && out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * Render a full plain-text digest for one activity. Pure — no DB access; the
 * caller assembles `source` from the Activity row, typed `laps` /
 * `hrZoneMinutes` and the raw garmin_raw payloads, plus parsed per-minute
 * series when requested.
 */
export function buildRunDigest(
  source: RunDigestSource,
  options: RunDigestOptions = {},
): string {
  const when = source.startedAt
    ? new Date(source.startedAt).toISOString().split("T")[0]
    : null;
  const sportLabel = source.sportType
    ? source.sportType
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : "Activity";
  const lines: string[] = [];
  lines.push(`### ${sportLabel}${when ? ` — ${when}` : ""}`);

  const header: string[] = [];
  if (source.durationMinutes != null)
    header.push(`${Math.round(source.durationMinutes)} min`);
  if (source.distanceMeters != null) {
    const distKm = source.distanceMeters / 1000;
    // fmtPace expects seconds per km; speed (km/h) = distKm / (durMin/60).
    const paceFromDist =
      source.durationMinutes != null && source.durationMinutes > 0 && distKm > 0
        ? fmtPace(3600 / (distKm / (source.durationMinutes / 60)))
        : "";
    header.push(
      `${distKm.toFixed(1)} km${paceFromDist ? ` (~${paceFromDist})` : ""}`,
    );
  }
  if (source.avgPaceSecPerKm != null)
    header.push(`avg ${fmtPace(source.avgPaceSecPerKm)}/km`);
  if (source.avgHr != null) header.push(`HR ${source.avgHr}`);
  if (source.maxHr != null) header.push(`max ${source.maxHr}`);
  if (source.avgCadence != null)
    header.push(`${Math.round(source.avgCadence)} spm`);
  if (source.elevationGain != null)
    header.push(`↑${Math.round(source.elevationGain)}m`);
  if (header.length > 0) lines.push(`- ${header.join(", ")}`);

  const laps = source.laps ?? [];
  if (laps.length > 0) {
    const lapLines = ["- Splits:"];
    laps.forEach((l, i) => {
      const parts: string[] = [];
      const distKm = l.distanceMeters != null ? l.distanceMeters / 1000 : null;
      if (distKm != null) parts.push(`${distKm.toFixed(1)} km`);
      const pace =
        l.avgPaceSecPerKm != null
          ? fmtPace(l.avgPaceSecPerKm)
          : l.distanceMeters != null &&
              l.durationSeconds != null &&
              l.distanceMeters > 0
            ? fmtPace((l.durationSeconds / l.distanceMeters) * 1000)
            : null;
      if (pace) parts.push(pace);
      if (l.avgHr != null) parts.push(`HR ${l.avgHr}`);
      if (l.avgCadence != null) parts.push(`${Math.round(l.avgCadence)} spm`);
      if (l.elevationGain != null)
        parts.push(`↑${Math.round(l.elevationGain)}m`);
      lapLines.push(`  ${i + 1}. ${parts.join(", ") || "..."}`);
    });
    lines.push(lapLines.join("\n"));
  }

  const drift = computeHrDrift(laps);
  if (drift != null)
    lines.push(
      `- HR drift (2nd vs 1st half): ${drift >= 0 ? "+" : ""}${drift} bpm`,
    );

  const formLines = renderForm(source.runningFormScore ?? null);
  if (formLines) lines.push(...formLines);

  const zones = source.hrZoneMinutes;
  if (
    zones &&
    (zones.zone1 || zones.zone2 || zones.zone3 || zones.zone4 || zones.zone5)
  ) {
    const total =
      (zones.zone1 ?? 0) +
      (zones.zone2 ?? 0) +
      (zones.zone3 ?? 0) +
      (zones.zone4 ?? 0) +
      (zones.zone5 ?? 0);
    const totalMin = Math.round(total);
    if (totalMin > 0) {
      const z = (v?: number | null) => (((v ?? 0) / total) * 100).toFixed(1);
      lines.push(
        `- HR zones: Z1 ${z(zones.zone1)}%, Z2 ${z(zones.zone2)}%, Z3 ${z(zones.zone3)}%, Z4 ${z(zones.zone4)}%, Z5 ${z(zones.zone5)}% (${totalMin} active min)`,
      );
    }
  }

  if (options.includePerMinute) {
    const hr = downsample(
      options.perMinuteHr ?? [],
      RUN_DIGEST_PER_MINUTE_MAX_POINTS,
    );
    const pace = downsample(
      options.perMinutePace ?? [],
      RUN_DIGEST_PER_MINUTE_MAX_POINTS,
    );
    if (hr.length > 0 || pace.length > 0) {
      lines.push("- Per-minute curve (time, HR bpm[, pace /km]):");
      const minutes = new Map<
        number,
        { hr: number | null; pace: number | null }
      >();
      const known = new Set<number>();
      for (const p of hr) known.add(p.t);
      for (const p of pace) known.add(p.t);
      for (const t of known) {
        const hrRow = hr.find((p) => p.t === t);
        const paceRow = pace.find((p) => p.t === t);
        minutes.set(t, {
          hr: hrRow?.hr ?? null,
          pace: paceRow?.secPerKm ?? null,
        });
      }
      const sorted = [...minutes.keys()].sort((a, b) => a - b);
      const minIdx = (t: number) => Math.round(t / 60);
      const chunks: string[] = [];
      for (const t of sorted) {
        const m = minutes.get(t)!;
        const parts = [`${minIdx(t)}'`];
        if (m.hr != null) parts.push(String(Math.round(m.hr)));
        if (m.pace != null) parts.push(fmtPace(m.pace));
        chunks.push(parts.join(":"));
      }
      lines.push(`  ${chunks.join("  ")}`);
    }
  }

  let text = lines.join("\n");
  if (text.length > RUN_DIGEST_MAX_CHARS) {
    text = text.slice(0, RUN_DIGEST_MAX_CHARS) + "\n[... digest trimmed]";
  }
  return text;
}

// ---------------------------------------------------------------------------
// Intent detection — does this question want concrete run detail (splits,
// form, per-minute HR/cadence) rather than the aggregate summary?
// ---------------------------------------------------------------------------

const WEEKDAYS_DE = {
  montag: 1,
  monday: 1,
  dienstag: 2,
  tuesday: 2,
  mittwoch: 3,
  wednesday: 3,
  donnerstag: 4,
  thursday: 4,
  freitag: 5,
  friday: 5,
  samstag: 6,
  saturday: 6,
  sonntag: 0,
  sunday: 0,
} as const;

/**
 * Match "der/mein lauf am <Tag> / vom <Datum>" — a concrete, dated/attributed
 * session. Unlike the generic "letzter lauf" trigger, this fires on the
 * weekday/date the user names so the coach can target that specific run.
 */
const RUN_ON_DAY_PATTERN =
  /\b(?:la[au]f|la[au]feinheit|run|einheit)\b\s*(?:am|vom|von)\s+([a-zäöü]+|\d{1,2}(?:[.\\/ -]\d{1,2})?(?:[.\\/ -]\d{2,4})?)/i;
const WEEKDAY_RUN_PATTERN =
  /\b(?:sonntags|samstags|montags|dienstags|mittwochs|donnerstags|freitags)lauf\b/i;

const RUN_DETAIL_PATTERNS: RegExp[] = [
  /\b(analse|analyse|analysiere|untersuche|har run|den gar|meistens|zuletzt|gestrigen?|heutigen?)\b/i,
  /(letzter|letzte|letzten|gestrig|heutig)[ a-z]*(lauf|run|laufeinheit|einheit|interall|intervall)/i,
  // "der lauf am dienstag", "mein lauf vom 06.09."
  RUN_ON_DAY_PATTERN,
  // "sonntagslauf", "samstagslauf"
  WEEKDAY_RUN_PATTERN,
  /\bintervall(?:e)?\b/i,
  /\b(split|splits|km section|kilometerweise)\b/i,
  /\b(cadence|spm|trittfrequen[az])\b/i,
  /\b(effizien|lauf.?form|laufeffizien)\b/i,
  /\b(ground.?contact|gct|balan[cz]e|l.r|vert.*oscill|vertical.?ratio)\b/i,
  /\b(hr.?drift|drift.*hr)\b/i,
  /\bminute[n]?weise\b/i,
];

export interface RunDetailIntent {
  /** Whether the message asks for concrete run detail. */
  wantsRunDetail: boolean;
  /** Whether the downsampled per-minute HR/pace series is explicitly asked. */
  wantsPerMinute: boolean;
}

/** True when the message requests the minute-resolution HR/pace curve. */
export function detectPerMinuteWanted(message: string): boolean {
  return /(per.?minute|minute[n]?weise|minütlich(?:en|e|es|er)?\b|im minuten[ r]|ab der \d+\.? min)/i.test(
    message,
  );
}

export function detectRunDetailIntent(message: string): RunDetailIntent {
  if (!message) return { wantsRunDetail: false, wantsPerMinute: false };
  const wantsRunDetail = RUN_DETAIL_PATTERNS.some((re) => re.test(message));
  const wantsPerMinute = wantsRunDetail && detectPerMinuteWanted(message);
  return { wantsRunDetail, wantsPerMinute };
}

// ---------------------------------------------------------------------------
// Run target resolution — which individual run does the question name?
// ---------------------------------------------------------------------------

export type RunTarget =
  | { type: "weekday"; weekday: string; day: string }
  | { type: "date"; day: string }
  | { type: "latest" };

function toIsoDay(day: string): string {
  // Callers pass day.cmp(a.startedAt, profile.timezone) already-formatted,
  // and the date regex captures YYYY-MM-DD, DD.MM.YYYY or DD.MM. Normalize
  // the latter two into YYYY-MM-DD. Weekday targets arrive pre-resolved.
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const m = /^(\d{1,2})[.\/ -](\d{1,2})(?:[.\/ -](\d{2,4}))?$/.exec(day);
  if (!m) return day; // fall through (usually a weekday name)
  const dd = m[1]!.padStart(2, "0");
  const mm = m[2]!.padStart(2, "0");
  let yy = m[3] ?? String(new Date().getUTCFullYear());
  if (/^\d{2}$/.test(yy)) {
    const n = Number(yy);
    // 00–49 → 2000s, 50–99 → 1900s (common 2-digit year rule).
    yy = n < 50 ? `20${yy}` : `19${yy}`;
  }
  return `${yy}-${mm}-${dd}`;
}

function weekdayIsoDay(weekday: string, tz: string | null | undefined): string {
  const dow = WEEKDAYS_DE[weekday.toLowerCase() as keyof typeof WEEKDAYS_DE];
  // Today's weekday number in the athlete's timezone (Intl can't give us
  // weekday here cheaply without a full formatter; reuse dayInTimezone "now").
  const now = new Date();
  const todayIso = dayInTimezone(now, tz);
  const todayDow = new Date(`${todayIso}T12:00:00Z`).getUTCDay();
  let back = todayDow - dow;
  if (back < 0) back += 7;
  // "am sonntag" in the middle of the week usually means the *most recent*
  // occurrence, not the coming one; walk back one full week if the most
  // recent would be 0 (today) so we don't point at the current day unless
  // the user explicitly said "heute".
  if (back === 0 && !/heute|today/i.test(weekday)) back = 7;
  const d = new Date(`${todayIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().split("T")[0]!;
}

const RUN_ON_DAY_CAPTURE =
  /\b(?:la[au]f|la[au]feinheit|run|einheit)\b\s*(?:am|vom|von)\s+([a-zäöü]+|\d{1,2}(?:[.\/ -]\d{1,2})?(?:[.\/ -]\d{2,4})?)/i;
const WEEKDAY_NAME =
  /\b(montag|monday|dienstag|tuesday|mittwoch|wednesday|donnerstag|thursday|freitag|friday|samstag|saturday|sonntag|sunday)\b/i;

/**
 * Resolve which run the question targets: an explicit weekday, a date, or the
 * most recent session. Weekday/date resolution is timezone-aware so a run
 * started late at night lands on the correct calendar day for the athlete.
 * Returns `{ type: 'latest' }` when no clear target is named.
 */
export function parseRunTarget(
  message: string,
  tz: string | null | undefined,
): RunTarget {
  if (!message) return { type: "latest" };

  const onDay = RUN_ON_DAY_CAPTURE.exec(message);
  if (onDay?.[1]) {
    const token = onDay[1].trim();
    if (WEEKDAY_NAME.test(token)) {
      return {
        type: "weekday",
        weekday: token,
        day: weekdayIsoDay(token, tz),
      };
    }
    const iso = toIsoDay(token);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      return { type: "date", day: iso };
    }
    return { type: "latest" };
  }

  // "sonntagslauf" / "samstagslauf" without "am".
  const weekdayRun =
    /\b(sonntags|samstags|montags|dienstags|mittwochs|donnerstags|freitags)lauf\b/i.exec(
      message,
    );
  if (weekdayRun?.[1]) {
    // group 1 is "sonntags"/"samstags"/… (the `lauf` is outside the group);
    // strip the trailing plural "s" to get the base weekday name.
    const weekday = weekdayRun[1].replace(/s$/, "");
    return { type: "weekday", weekday, day: weekdayIsoDay(weekday, tz) };
  }

  return { type: "latest" };
}

// ---------------------------------------------------------------------------
// Per-minute series parsing (from the raw `activity_details` payload, same
// column-oriented shape `router/activity.ts` reads).
// ---------------------------------------------------------------------------

export interface RawPerMinutePair {
  t: number;
  hr: number | null;
  secPerKm: number | null;
}

/**
 * Extract per-minute HR and pace from a `get_activity_details` payload.
 * Garmin ships the stream column-oriented: `metricDescriptors` names the
 * columns, `activityDetailMetrics[].metrics` holds one row per second. Returns
 * one row per minute (first row of each 60 s bucket), null on malformed data.
 */
export function parsePerMinuteSeries(
  payload: unknown,
): RawPerMinutePair[] | null {
  if (payload == null || typeof payload !== "object") return null;
  const d = payload as Record<string, unknown>;
  const descriptors = d.metricDescriptors;
  const rows = d.activityDetailMetrics;
  if (
    !Array.isArray(descriptors) ||
    !Array.isArray(rows) ||
    rows.length === 0
  ) {
    return null;
  }
  const index: Partial<Record<string, number>> = {};
  for (const desc of descriptors) {
    if (desc == null || typeof desc !== "object") continue;
    const key = (desc as Record<string, unknown>).key;
    const i = (desc as Record<string, unknown>).metricsIndex;
    if (typeof key === "string" && typeof i === "number") {
      index[key] = i;
    }
  }
  const tIdx = index.directTimestamp;
  const hrIdx = index.directHeartRate;
  const speedIdx = index.directSpeed;
  if (tIdx == null) return null;

  let startMs: number | null = null;
  const out: RawPerMinutePair[] = [];
  for (const row of rows) {
    const metrics = (row as Record<string, unknown> | undefined)?.metrics;
    if (!Array.isArray(metrics)) continue;
    const ts = metrics[tIdx];
    if (typeof ts !== "number") continue;
    startMs ??= ts;
    const t = Math.round((ts - startMs) / 1000);
    if (t % 60 !== 0) continue; // first second of each minute bucket
    const hrVal = hrIdx != null ? metrics[hrIdx] : undefined;
    const hr =
      typeof hrVal === "number" && Number.isFinite(hrVal) ? hrVal : null;
    // Garmin reports directSpeed in m/s; convert to seconds per kilometre.
    const speedVal = speedIdx != null ? metrics[speedIdx] : undefined;
    const speed =
      typeof speedVal === "number" && speedVal > 0.3 ? speedVal : null;
    const secPerKm = speed != null ? Math.round(1000 / speed) : null;
    out.push({ t, hr, secPerKm });
  }
  if (out.length < 2) return null;
  return out;
}
