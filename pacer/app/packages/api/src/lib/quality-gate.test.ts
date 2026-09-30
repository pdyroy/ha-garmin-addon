import { describe, expect, it } from "vitest";

import {
  collectSupportedContext,
  evaluateResponseQuality,
  extractNumericClaims,
} from "./quality-gate";

/**
 * Eval harness for the coach output gate. The whole point of the quality
 * gate is to catch fabricated figures — a model quoting a number that was
 * never in the data context it was given. These tests pin the exact bug
 * class that produced a coach reply claiming "top 30 % for your age" next
 * to a VO2max number: a percentile/unit claim must not be "confirmed" by an
 * unrelated context figure that happens to share a numeric value.
 */

const CONTEXT = [
  "## Metric Availability JSON",
  '{"vo2max":53.4,"vo2max_status":"available","ctl":48.0,"tsb":-3.0,"body_battery":72}',
  "## Recent Activities",
  "- 30km run, 42min, HR 154",
  "- 5.2km easy, 31min",
].join("\n");

describe("extractNumericClaims", () => {
  it("extracts unit-bearing claims with their unit", () => {
    const claims = extractNumericClaims("Du bist in den top 30% deiner Altersgruppe");
    const pct = claims.find((c) => c.unit === "%");
    expect(pct?.value).toBe(30);
  });

  it("ignores the markdown disclaimer block", () => {
    const claims = extractNumericClaims(
      "Dein Lauf war 30km.\n\n---\n*Disclaimer: 999 km*",
    );
    expect(claims.some((c) => c.value === 999)).toBe(false);
    expect(claims.some((c) => c.value === 30)).toBe(true);
  });
});

describe("collectSupportedContext unit-awareness", () => {
  it("tags context numbers with an explicit unit", () => {
    const ctx = collectSupportedContext(CONTEXT);
    expect(ctx.byUnit.get("km")).toContain(30);
    expect(ctx.byUnit.get("km")).toContain(5.2);
    expect(ctx.byUnit.get("min")).toContain(42);
  });

  it("keeps bare decimals (JSON-style values) separate from unit tokens", () => {
    const ctx = collectSupportedContext(CONTEXT);
    // vo2max / ctl / tsb / body_battery are bare in the JSON.
    expect(ctx.bare).toContain(53.4);
    expect(ctx.bare).toContain(48);
    // 30 appears as "30km", so it must NOT be treated as a bare 30.
    expect(ctx.bare).not.toContain(30);
  });
});

describe("evaluateResponseQuality", () => {
  it("flags a fabricated percentile that only a same-valued unit could back", () => {
    // Context has "30km" but no bare 30 and no "30%". A "top 30%" claim is
    // unsupported even though 30 appears somewhere in the context.
    const result = evaluateResponseQuality(
      "Dein VO2max ist 53.4. Du bist in den top 30% deiner Altersgruppe.",
      CONTEXT,
    );
    const pct = result.claims.find((c) => c.unit === "%");
    expect(pct).toBeDefined();
    expect(result.unsupportedClaims.some((c) => c.unit === "%")).toBe(true);
    expect(result.confidence).not.toBe("high");
  });

  it("accepts a claim backed by a same-unit context number", () => {
    const result = evaluateResponseQuality(
      "Dein Lauf heute: 30km in 42min bei HR 154.",
      CONTEXT,
    );
    expect(result.confidence).toBe("high");
  });

  it("accepts a bare JSON value the model quotes verbatim", () => {
    const result = evaluateResponseQuality(
      "Dein VO2max liegt bei 53.4 ml/kg/min.",
      CONTEXT,
    );
    // 53.4 is present bare in the JSON, so it is backed.
    expect(result.unsupportedClaims.some((c) => c.value === 53.4)).toBe(false);
    expect(result.confidence).toBe("high");
  });

  it("flags a unit claim for which only an unrelated unit's number exists", () => {
    // 30 appears only as "30km"; no bare 30 and no "30%". A "top 30%" must
    // be flagged, even though 30 exists somewhere in the context.
    const result = evaluateResponseQuality(
      "Du bist in den top 30% deiner Altersgruppe.",
      CONTEXT,
    );
    const pct = result.claims.find((c) => c.unit === "%");
    expect(pct).toBeDefined();
    expect(result.unsupportedClaims.some((c) => c.unit === "%")).toBe(true);
  });

  it("does not accept a bare value that never appears in the context", () => {
    // "Strain 999" is a labelled claim for a number nowhere in context.
    const result = evaluateResponseQuality("Strain 999.", CONTEXT);
    expect(result.unsupportedClaims.some((c) => c.value === 999)).toBe(true);
    expect(result.confidence).toBe("low");
  });
});