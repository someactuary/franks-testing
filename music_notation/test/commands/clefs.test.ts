import { describe, expect, it } from "vitest";
import { produce } from "immer";
import {
  clefAt,
  clefChangeId,
  clefEnteringMeasure,
  frac,
  newPianoScore,
  parseClefChangeId,
  ZERO,
  type Score,
} from "@/model";
import { removeClefChange, setClefChange } from "@/commands/clefs";
import type { Command } from "@/commands/types";

function apply(score: Score, cmd: Command): Score {
  return produce(score, (draft) => cmd.apply(draft));
}

function changesOf(score: Score, measureIndex: number, staffIndex: number) {
  return score.parts[0]!.measures[measureIndex]!.staves[staffIndex]!.clefChanges;
}

describe("clefAt / clefEnteringMeasure", () => {
  const score = newPianoScore({ measureCount: 3 });
  score.parts[0]!.measures[0]!.staves[1]!.clefChanges = [{ at: frac(1, 2), clef: "treble" }];
  score.parts[0]!.measures[2]!.staves[1]!.clefChanges = [{ at: ZERO, clef: "bass" }];

  it("uses the opening clef until a change, and the change from its own offset on", () => {
    expect(clefAt(score, 0, 1, 0, ZERO)).toBe("bass");
    expect(clefAt(score, 0, 1, 0, frac(1, 4))).toBe("bass");
    expect(clefAt(score, 0, 1, 0, frac(1, 2))).toBe("treble");
    expect(clefAt(score, 0, 1, 0, frac(3, 4))).toBe("treble");
  });

  it("carries a change into later measures until the next one", () => {
    expect(clefEnteringMeasure(score, 0, 1, 1)).toBe("treble");
    expect(clefAt(score, 0, 1, 1, ZERO)).toBe("treble");
    expect(clefEnteringMeasure(score, 0, 1, 2)).toBe("treble");
    expect(clefAt(score, 0, 1, 2, ZERO)).toBe("bass");
    // The other staff is untouched.
    expect(clefAt(score, 0, 0, 2, ZERO)).toBe("treble");
  });
});

describe("clefChangeId", () => {
  it("round-trips, and unreduced offsets name the same change", () => {
    const loc = { measureId: "m-abc", partIndex: 0, staffIndex: 1, at: frac(3, 8) };
    const id = clefChangeId(loc);
    expect(parseClefChangeId(id)).toEqual(loc);
    expect(clefChangeId({ ...loc, at: { num: 6, den: 16 } })).toBe(id);
  });

  it("rejects ids that aren't clef changes", () => {
    expect(parseClefChangeId("abc123")).toBeNull();
    expect(parseClefChangeId("clefchange|m|x|1|1/2")).toBeNull();
    expect(parseClefChangeId("clefchange|m|0|1|1/0")).toBeNull();
  });
});

describe("setClefChange", () => {
  it("adds a change mid-measure", () => {
    const next = apply(
      newPianoScore({ measureCount: 2 }),
      setClefChange(0, 1, 0, frac(1, 2), "treble"),
    );
    expect(changesOf(next, 0, 1)).toEqual([{ at: frac(1, 2), clef: "treble" }]);
    expect(clefAt(next, 0, 1, 1, ZERO)).toBe("treble");
  });

  it("replaces a change at the same point", () => {
    let score = apply(newPianoScore({ measureCount: 2 }), setClefChange(0, 0, 1, ZERO, "bass"));
    score = apply(score, setClefChange(0, 0, 1, ZERO, "alto"));
    expect(changesOf(score, 1, 0)).toEqual([{ at: ZERO, clef: "alto" }]);
  });

  it("removes a change that would restate the clef in force, leaving no empty list behind", () => {
    let score = apply(newPianoScore({ measureCount: 2 }), setClefChange(0, 1, 1, ZERO, "treble"));
    score = apply(score, setClefChange(0, 1, 1, ZERO, "bass"));
    expect(changesOf(score, 1, 1)).toBeUndefined();
    // And never adds a no-op change in the first place.
    expect(
      changesOf(
        apply(newPianoScore({ measureCount: 2 }), setClefChange(0, 1, 1, frac(1, 4), "bass")),
        1,
        1,
      ),
    ).toBeUndefined();
  });

  it("at the very start of the piece, changes the staff's opening clef", () => {
    const next = apply(newPianoScore({ measureCount: 2 }), setClefChange(0, 1, 0, ZERO, "treble"));
    expect(next.parts[0]!.staves[1]!.initialClef).toBe("treble");
    expect(changesOf(next, 0, 1)).toBeUndefined();
  });
});

describe("removeClefChange", () => {
  it("removes the change its id names; the earlier clef continues", () => {
    const base = newPianoScore({ measureCount: 2 });
    const score = apply(base, setClefChange(0, 1, 1, frac(1, 4), "treble"));
    const id = clefChangeId({
      measureId: score.measures[1]!.id,
      partIndex: 0,
      staffIndex: 1,
      at: frac(1, 4),
    });
    const next = apply(score, removeClefChange(id));
    expect(changesOf(next, 1, 1)).toBeUndefined();
    expect(clefAt(next, 0, 1, 1, frac(1, 2))).toBe("bass");
  });

  it("refuses a stale id", () => {
    const score = newPianoScore({ measureCount: 1 });
    const id = clefChangeId({
      measureId: score.measures[0]!.id,
      partIndex: 0,
      staffIndex: 1,
      at: frac(1, 4),
    });
    expect(() => apply(score, removeClefChange(id))).toThrow(/no longer exists/);
  });
});
