import { describe, expect, it } from "vitest";
import { add, cmp, frac, measureLength, notated, notatedToFraction } from "@/model/duration";

describe("fractions", () => {
  it("normalizes", () => {
    expect(frac(2, 4)).toEqual({ num: 1, den: 2 });
    expect(frac(-1, -2)).toEqual({ num: 1, den: 2 });
    expect(frac(1, -2)).toEqual({ num: -1, den: 2 });
  });
  it("adds exactly", () => {
    expect(add(frac(1, 3), frac(1, 6))).toEqual({ num: 1, den: 2 });
    expect(cmp(frac(1, 4), frac(2, 8))).toBe(0);
  });
  it("notated durations", () => {
    expect(notatedToFraction(notated(4))).toEqual(frac(1, 4));
    expect(notatedToFraction(notated(4, 1))).toEqual(frac(3, 8));
    expect(notatedToFraction(notated(8, 2))).toEqual(frac(7, 32));
    expect(measureLength({ numerator: 6, denominator: 8 })).toEqual(frac(3, 4));
  });
});
