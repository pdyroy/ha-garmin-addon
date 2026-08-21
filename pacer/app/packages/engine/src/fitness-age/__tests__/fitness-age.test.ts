import { describe, expect, it } from "vitest";

import { computeFitnessAge } from "../index";

describe("computeFitnessAge", () => {
  it("returns the athlete's own age when VO2max is the population mean", () => {
    // Loe 2013, men 40-49: mean 47.2 mL/kg/min at the decade midpoint 45.
    const result = computeFitnessAge({ vo2max: 47.2, age: 45, sex: "male" });
    expect(result).not.toBeNull();
    expect(result?.fitnessAge).toBeGreaterThanOrEqual(43);
    expect(result?.fitnessAge).toBeLessThanOrEqual(47);
    expect(Math.abs(result?.deltaYears ?? 99)).toBeLessThanOrEqual(2);
  });

  it("stays within 1.2 mL/kg/min of every published decade mean", () => {
    const published: [string, number, number][] = [
      ["male", 25, 54.4],
      ["male", 35, 49.1],
      ["male", 45, 47.2],
      ["male", 55, 42.6],
      ["male", 65, 39.2],
      ["male", 75, 35.3],
      ["female", 25, 43.0],
      ["female", 35, 40.0],
      ["female", 45, 38.4],
      ["female", 55, 34.4],
      ["female", 65, 31.1],
      ["female", 75, 28.3],
    ];
    for (const [sex, age, mean] of published) {
      const result = computeFitnessAge({ vo2max: mean, age, sex });
      expect(Math.abs((result?.populationMean ?? 0) - mean)).toBeLessThan(1.2);
    }
  });

  it("makes a fitter athlete younger", () => {
    const average = computeFitnessAge({ vo2max: 42.6, age: 55, sex: "male" });
    const fitter = computeFitnessAge({ vo2max: 52.6, age: 55, sex: "male" });
    expect(fitter?.fitnessAge).toBeLessThan(average?.fitnessAge ?? 0);
    expect(fitter?.deltaYears).toBeLessThan(0);
    // 10 mL/kg/min is ~2.7 decades on the men's line.
    expect(fitter?.fitnessAge).toBe(29);
  });

  it("uses the women's line, which sits lower than the men's", () => {
    const woman = computeFitnessAge({ vo2max: 40, age: 40, sex: "female" });
    const man = computeFitnessAge({ vo2max: 40, age: 40, sex: "male" });
    expect(woman?.method).toBe("female");
    expect(woman?.fitnessAge).toBeLessThan(man?.fitnessAge ?? 0);
  });

  it("falls back to the pooled line for unknown or other sex", () => {
    expect(
      computeFitnessAge({ vo2max: 45, age: 40, sex: "other" })?.method,
    ).toBe("pooled");
    expect(computeFitnessAge({ vo2max: 45, age: 40, sex: null })?.method).toBe(
      "pooled",
    );
  });

  it("clamps outside the reference cohort and says so", () => {
    const elite = computeFitnessAge({ vo2max: 80, age: 40, sex: "male" });
    expect(elite?.fitnessAge).toBe(20);
    expect(elite?.clamped).toBe(true);
  });

  it("returns null instead of guessing missing inputs", () => {
    expect(
      computeFitnessAge({ vo2max: null, age: 40, sex: "male" }),
    ).toBeNull();
    expect(
      computeFitnessAge({ vo2max: 45, age: null, sex: "male" }),
    ).toBeNull();
    expect(computeFitnessAge({ vo2max: 0, age: 40, sex: "male" })).toBeNull();
    expect(computeFitnessAge({ vo2max: NaN, age: 40, sex: "male" })).toBeNull();
  });
});
