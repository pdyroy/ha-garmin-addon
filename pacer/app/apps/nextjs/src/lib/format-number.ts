import { UI_LOCALE } from "./format-date";

/**
 * Format a number for display.
 *
 * German uses a comma as the decimal separator, so `value.toFixed(1)` puts
 * "44.4" on a screen that otherwise reads as German. Use this instead of
 * `toFixed` for anything the athlete sees; keep `toFixed` for values that
 * are parsed back, used as React keys, or written to an API.
 *
 * Returns an em dash for null and undefined so callers stop repeating the
 * same `?? "—"` dance.
 */
export function fmtNum(
  value: number | null | undefined,
  digits = 1,
): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(UI_LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Whole numbers with a thousands separator: 12.345 rather than 12345. */
export function fmtInt(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(UI_LOCALE, {
    maximumFractionDigits: 0,
  }).format(value);
}

/** A signed number, for deltas where the direction carries the meaning. */
export function fmtDelta(
  value: number | null | undefined,
  digits = 1,
): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(UI_LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: "exceptZero",
  }).format(value);
}

/** Percentages, where the unit is part of the value rather than a suffix. */
export function fmtPct(
  value: number | null | undefined,
  digits = 0,
): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(UI_LOCALE, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value / 100);
}
