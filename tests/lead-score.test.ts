import { describe, expect, it } from "vitest";
import { breakdownEntries, formatDelta, scoreTier, tierClasses } from "@/lib/lead-score";

describe("scoreTier", () => {
  it("buckets scores into tiers", () => {
    expect(scoreTier(95)).toBe("hot");
    expect(scoreTier(70)).toBe("hot");
    expect(scoreTier(69.9)).toBe("warm");
    expect(scoreTier(45)).toBe("warm");
    expect(scoreTier(20)).toBe("cool");
    expect(scoreTier(19.9)).toBe("cold");
    expect(scoreTier(0)).toBe("cold");
  });

  it("treats invalid scores as cold", () => {
    expect(scoreTier(Number.NaN)).toBe("cold");
  });

  it("returns a class for every tier", () => {
    for (const s of [0, 25, 50, 80]) {
      expect(tierClasses(scoreTier(s)).length).toBeGreaterThan(0);
    }
  });
});

describe("formatDelta", () => {
  it("signs and rounds deltas", () => {
    expect(formatDelta(10, 22.54)).toBe("+12.5");
    expect(formatDelta(30, 27)).toBe("-3");
    expect(formatDelta(12, 12)).toBe("0");
  });
});

describe("breakdownEntries", () => {
  it("orders known rule keys and skips unknown ones", () => {
    const entries = breakdownEntries({ recency: 9, stage: 16, bogus: 5 });
    expect(entries.map((e) => e.key)).toEqual(["stage", "recency"]);
    expect(entries[0].value).toBe(16);
  });

  it("handles empty input", () => {
    expect(breakdownEntries(null)).toEqual([]);
  });
});
