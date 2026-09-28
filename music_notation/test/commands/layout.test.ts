import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { newPianoScore } from "@/model";
import {
  clearForcedBreaks,
  clearNudge,
  setMeasuresPerSystem,
  setNudge,
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

describe("setNudge / clearNudge", () => {
  it("records an absolute offset, replacing any previous one for the same id", () => {
    const score = newPianoScore({ measureCount: 1 });
    const nudged = produce(score, (d) => setNudge("m1", 0.5, -0.3).apply(d));
    expect(nudged.layout.nudges["m1"]).toEqual({ dx: 0.5, dy: -0.3 });

    const replaced = produce(nudged, (d) => setNudge("m1", 1, 1).apply(d));
    expect(replaced.layout.nudges["m1"]).toEqual({ dx: 1, dy: 1 });
    expect(Object.keys(replaced.layout.nudges)).toEqual(["m1"]);
  });

  it("clearNudge removes exactly the named id, leaving others untouched", () => {
    let score = newPianoScore({ measureCount: 1 });
    score = produce(score, (d) => setNudge("a", 1, 1).apply(d));
    score = produce(score, (d) => setNudge("b", 2, 2).apply(d));

    const next = produce(score, (d) => clearNudge("a").apply(d));

    expect(next.layout.nudges["a"]).toBeUndefined();
    expect(next.layout.nudges["b"]).toEqual({ dx: 2, dy: 2 });
  });

  it("clearNudge on an id with no nudge is a harmless no-op", () => {
    const score = newPianoScore({ measureCount: 1 });
    const next = produce(score, (d) => clearNudge("nothing-here").apply(d));
    expect(next.layout.nudges).toEqual({});
  });
});
