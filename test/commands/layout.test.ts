import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { newPianoScore } from "@/model";
import {
  clearForcedBreaks,
  setMeasuresPerSystem,
  setSystemsPerPage,
  togglePageBreak,
  toggleSystemBreak,
} from "@/commands/layout";

describe("toggleSystemBreak", () => {
  it("adds a forced system break, sorted, then removes it again", () => {
    const score = newPianoScore({ measureCount: 8 });

    const withOne = produce(score, (d) => toggleSystemBreak(4).apply(d));
    expect(withOne.layout.systemBreaks).toEqual([4]);

    const withTwo = produce(withOne, (d) => toggleSystemBreak(2).apply(d));
    expect(withTwo.layout.systemBreaks).toEqual([2, 4]); // stays sorted regardless of insertion order

    const withOneAgain = produce(withTwo, (d) => toggleSystemBreak(4).apply(d));
    expect(withOneAgain.layout.systemBreaks).toEqual([2]);
  });

  it("is a no-op at measure 0 (nothing before the first measure to break from)", () => {
    const score = newPianoScore({ measureCount: 4 });
    const next = produce(score, (d) => toggleSystemBreak(0).apply(d));
    expect(next.layout.systemBreaks).toEqual([]);
  });

  it("does not disturb pageBreaks", () => {
    const score = produce(newPianoScore({ measureCount: 6 }), (d) => togglePageBreak(3).apply(d));
    const next = produce(score, (d) => toggleSystemBreak(4).apply(d));
    expect(next.layout.pageBreaks).toEqual([3]);
    expect(next.layout.systemBreaks).toEqual([4]);
  });
});

describe("togglePageBreak", () => {
  it("adds and removes a forced page break, sorted", () => {
    const score = newPianoScore({ measureCount: 8 });
    const withOne = produce(score, (d) => togglePageBreak(5).apply(d));
    expect(withOne.layout.pageBreaks).toEqual([5]);
    const removed = produce(withOne, (d) => togglePageBreak(5).apply(d));
    expect(removed.layout.pageBreaks).toEqual([]);
  });

  it("is a no-op at measure 0", () => {
    const score = newPianoScore({ measureCount: 4 });
    const next = produce(score, (d) => togglePageBreak(0).apply(d));
    expect(next.layout.pageBreaks).toEqual([]);
  });
});

describe("setMeasuresPerSystem / setSystemsPerPage", () => {
  it("sets and clears (null) the measures-per-system cap", () => {
    const score = newPianoScore({ measureCount: 4 });
    const capped = produce(score, (d) => setMeasuresPerSystem(3).apply(d));
    expect(capped.layout.measuresPerSystem).toBe(3);
    const cleared = produce(capped, (d) => setMeasuresPerSystem(null).apply(d));
    expect(cleared.layout.measuresPerSystem).toBeUndefined();
  });

  it("sets and clears (null) the systems-per-page cap", () => {
    const score = newPianoScore({ measureCount: 4 });
    const capped = produce(score, (d) => setSystemsPerPage(2).apply(d));
    expect(capped.layout.systemsPerPage).toBe(2);
    const cleared = produce(capped, (d) => setSystemsPerPage(null).apply(d));
    expect(cleared.layout.systemsPerPage).toBeUndefined();
  });
});

describe("clearForcedBreaks", () => {
  it("empties both systemBreaks and pageBreaks, leaving the caps alone", () => {
    let score = newPianoScore({ measureCount: 10 });
    score = produce(score, (d) => toggleSystemBreak(3).apply(d));
    score = produce(score, (d) => togglePageBreak(6).apply(d));
    score = produce(score, (d) => setMeasuresPerSystem(4).apply(d));

    const next = produce(score, (d) => clearForcedBreaks().apply(d));

    expect(next.layout.systemBreaks).toEqual([]);
    expect(next.layout.pageBreaks).toEqual([]);
    expect(next.layout.measuresPerSystem).toBe(4);
  });
});
