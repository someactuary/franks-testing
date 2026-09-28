import { describe, expect, it } from "vitest";
import { newPianoScore, type Score } from "@/model";
import { unfoldMeasures } from "@/playback/unfold";

function scoreOf(count: number, set: (s: Score) => void = () => {}): Score {
  const s = newPianoScore({ measureCount: count });
  set(s);
  return s;
}

describe("unfoldMeasures", () => {
  it("plays measures once, in order, when there are no repeats", () => {
    expect(unfoldMeasures(scoreOf(4))).toEqual([0, 1, 2, 3]);
  });

  it("repeats from the start of the piece when a repeat end has no matching start", () => {
    const s = scoreOf(4, (s) => {
      s.measures[1]!.barline = "repeat-end";
    });
    expect(unfoldMeasures(s)).toEqual([0, 1, 0, 1, 2, 3]);
  });

  it("repeats only the bracketed section", () => {
    const s = scoreOf(5, (s) => {
      s.measures[1]!.startBarline = "repeat-start";
      s.measures[2]!.barline = "repeat-end";
    });
    expect(unfoldMeasures(s)).toEqual([0, 1, 2, 1, 2, 3, 4]);
  });

  it("follows first and second endings", () => {
    const s = scoreOf(4, (s) => {
      s.measures[1]!.ending = { numbers: [1], type: "start" };
      s.measures[1]!.barline = "repeat-end";
      s.measures[2]!.ending = { numbers: [2], type: "stop" };
    });
    // m0 m1(1st) | m0 (skip m1) m2(2nd) m3
    expect(unfoldMeasures(s)).toEqual([0, 1, 0, 2, 3]);
  });

  it("handles multi-measure endings", () => {
    const s = scoreOf(6, (s) => {
      s.measures[1]!.ending = { numbers: [1], type: "start" };
      s.measures[2]!.ending = { numbers: [1], type: "stop" };
      s.measures[2]!.barline = "repeat-end";
      s.measures[3]!.ending = { numbers: [2], type: "start" };
      s.measures[4]!.ending = { numbers: [2], type: "stop" };
    });
    expect(unfoldMeasures(s)).toEqual([0, 1, 2, 0, 3, 4, 5]);
  });

  it("treats a repeat-both barline as ending one repeat and starting the next", () => {
    const s = scoreOf(6, (s) => {
      s.measures[1]!.barline = "repeat-end";
      s.measures[2]!.barline = "repeat-both";
      s.measures[3]!.barline = "repeat-end";
    });
    // [0,1] repeated, then [2] (ended by the repeat-both) twice, then [3] (ended by its repeat-end) twice
    expect(unfoldMeasures(s)).toEqual([0, 1, 0, 1, 2, 2, 3, 3, 4, 5]);
  });

  it("does not loop forever on a malformed score", () => {
    const s = scoreOf(3, (s) => {
      s.measures[0]!.barline = "repeat-end";
      s.measures[1]!.barline = "repeat-end";
      s.measures[2]!.barline = "repeat-end";
    });
    const order = unfoldMeasures(s);
    expect(order.length).toBeLessThan(100);
    expect(order[order.length - 1]).toBe(2);
  });
});
