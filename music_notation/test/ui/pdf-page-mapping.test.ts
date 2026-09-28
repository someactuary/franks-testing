import { describe, expect, it } from "vitest";
import { pdfPageForMeasure } from "@/ui/layout-utils";

describe("pdfPageForMeasure", () => {
  it("is page 0 with no page breaks at all", () => {
    expect(pdfPageForMeasure([], 0)).toBe(0);
    expect(pdfPageForMeasure([], 500)).toBe(0);
  });

  it("stays on page 0 before the first break", () => {
    expect(pdfPageForMeasure([4, 9], 0)).toBe(0);
    expect(pdfPageForMeasure([4, 9], 3)).toBe(0);
  });

  it("increments exactly at the break's measure index (inclusive)", () => {
    expect(pdfPageForMeasure([4, 9], 4)).toBe(1);
    expect(pdfPageForMeasure([4, 9], 8)).toBe(1);
    expect(pdfPageForMeasure([4, 9], 9)).toBe(2);
  });

  it("stays on the last page for every measure after the last break", () => {
    expect(pdfPageForMeasure([4, 9], 10)).toBe(2);
    expect(pdfPageForMeasure([4, 9], 1000)).toBe(2);
  });

  it("counts every break at or before the measure regardless of input order", () => {
    expect(pdfPageForMeasure([9, 4], 9)).toBe(2);
    expect(pdfPageForMeasure([9, 4], 4)).toBe(1);
  });
});
