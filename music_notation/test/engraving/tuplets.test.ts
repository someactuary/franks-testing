import { describe, expect, it } from "vitest";
import { add, frac, fracToString, notated, type NoteValue } from "@/model/duration";
import { newId } from "@/model/ids";
import { note, rest } from "@/model/factory";
import type { Score, TupletGroup, VoiceItem } from "@/model/score";
import { itemLength, positionedEvents } from "@/model/traverse";
import { tuplets as tupletsFixture } from "../fixtures/tuplets";
import {
  glyphs,
  lines,
  makeScore,
  polygons,
  run,
  setStaff,
  staffTop,
  system,
  withRole,
} from "./helpers";

function tuplet(
  actual: number,
  normal: number,
  unit: NoteValue,
  items: VoiceItem[],
  opts: { bracket?: TupletGroup["bracket"]; showNumber?: TupletGroup["showNumber"] } = {},
): TupletGroup {
  return {
    kind: "tuplet",
    id: newId(),
    ratio: { actual, normal, unit },
    items,
    ...(opts.bracket ? { bracket: opts.bracket } : {}),
    ...(opts.showNumber ? { showNumber: opts.showNumber } : {}),
  };
}

/** A measure of 4/4 whose first beat is `group`, padded out with rests. */
function withTuplet(group: TupletGroup, tail: VoiceItem[] = [rest(4), rest(2)]): Score {
  const score = makeScore({ measureCount: 1 });
  setStaff(score, 0, 0, [group, ...tail]);
  return score;
}

function tupletPrims(score: Score) {
  return withRole(system(run(score)).primitives, "tuplet");
}

const eighthTriplet = (pitches: string[], opts?: Parameters<typeof tuplet>[4]) =>
  tuplet(
    3,
    2,
    8,
    pitches.map((p) => note(p, 8)),
    opts,
  );

describe("tuplet duration handling", () => {
  it("draws the notated duration and spaces by the sounding length", () => {
    const score = withTuplet(eighthTriplet(["C5", "D5", "E5"]));
    const sys = system(run(score));
    // Notated eighths: black noteheads under one beam, no flags.
    expect(glyphs(withRole(sys.primitives, "notehead"), "noteheadBlack")).toHaveLength(3);
    expect(withRole(sys.primitives, "flag")).toHaveLength(0);
    expect(polygons(withRole(sys.primitives, "beam"))).toHaveLength(1);
    // Sounding thirds of a quarter: 0, 1/12, 1/6, then the rest of the measure.
    expect(sys.measures[0]!.columns.map((c) => fracToString(c.offset))).toEqual([
      "0/1",
      "1/12",
      "1/6",
      "1/4",
      "1/2",
    ]);
  });

  it("beams the three eighths of a triplet as one group", () => {
    const score = withTuplet(eighthTriplet(["C5", "D5", "E5"]));
    expect(polygons(withRole(system(run(score)).primitives, "beam"))).toHaveLength(1);
  });

  it("never beams a tuplet together with the notes beside it", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [
      eighthTriplet(["C5", "D5", "E5"]),
      note("F5", 8),
      note("G5", 8),
      rest(2),
    ]);
    // The triplet is one group and the loose pair is another.
    expect(polygons(withRole(system(run(score)).primitives, "beam"))).toHaveLength(2);
  });

  it("sums the sounding lengths of a nested tuplet to the notated slot", () => {
    const inner = tuplet(
      3,
      2,
      16,
      ["D5", "E5", "F5"].map((p) => note(p, 16)),
    );
    const outer = tuplet(3, 2, 8, [note("C5", 8), inner, note("G5", 8)]);
    // Three eighths in the time of two = one quarter.
    expect(itemLength(outer)).toEqual(frac(1, 4));
    // The inner triplet fills exactly one of the outer's eighth slots.
    expect(itemLength(inner, frac(2, 3))).toEqual(frac(1, 12));

    const score = withTuplet(outer);
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const inTuplet = positionedEvents(voice).filter((pe) => pe.tuplets.length > 0);
    expect(inTuplet).toHaveLength(5);
    const total = inTuplet.reduce((acc, pe) => add(acc, pe.length), frac(0, 1));
    expect(total).toEqual(frac(1, 4));
  });

  it("beams a nested tuplet with its parent", () => {
    const inner = tuplet(
      3,
      2,
      16,
      ["D5", "E5", "F5"].map((p) => note(p, 16)),
    );
    const outer = tuplet(3, 2, 8, [note("C5", 8), inner, note("G5", 8)]);
    const sys = system(run(withTuplet(outer)));
    // One primary beam over all five plus one secondary over the three sixteenths.
    expect(polygons(withRole(sys.primitives, "beam"))).toHaveLength(2);
    expect(withRole(sys.primitives, "flag")).toHaveLength(0);
  });
});

describe("tuplet number", () => {
  it("shows the actual count by default", () => {
    const group = eighthTriplet(["C5", "D5", "E5"]);
    const prims = tupletPrims(withTuplet(group));
    expect(glyphs(prims).map((g) => g.glyph)).toEqual(["tuplet3"]);
    expect(glyphs(prims).every((g) => g.ref?.id === group.id)).toBe(true);
  });

  it("shows the full ratio when asked", () => {
    const group = eighthTriplet(["C5", "D5", "E5"], { showNumber: "ratio" });
    expect(glyphs(tupletPrims(withTuplet(group))).map((g) => g.glyph)).toEqual([
      "tuplet3",
      "tupletColon",
      "tuplet2",
    ]);
  });

  it("shows nothing when showNumber is none", () => {
    const group = eighthTriplet(["C5", "D5", "E5"], { showNumber: "none" });
    expect(glyphs(tupletPrims(withTuplet(group)))).toHaveLength(0);
  });

  it("uses two digits for a tuplet past nine", () => {
    const items = Array.from({ length: 11 }, () => note("C5", 16));
    const group = tuplet(11, 8, 16, items, { bracket: "show" });
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [group, rest(4), rest(4), rest(4)]);
    expect(glyphs(tupletPrims(score)).map((g) => g.glyph)).toEqual(["tuplet1", "tuplet1"]);
  });
});

describe("tuplet bracket", () => {
  it("is omitted when the whole tuplet is one beam group", () => {
    const score = withTuplet(eighthTriplet(["C5", "D5", "E5"]));
    const prims = tupletPrims(score);
    expect(lines(prims)).toHaveLength(0);
    expect(glyphs(prims)).toHaveLength(1);
  });

  it("is drawn for an unbeamed tuplet", () => {
    const group = tuplet(
      3,
      2,
      4,
      ["E5", "D5", "C5"].map((p) => note(p, 4)),
    );
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [group, rest(2)]);
    const prims = tupletPrims(score);
    // Two bracket segments either side of the number, plus two hooks.
    expect(lines(prims)).toHaveLength(4);
    expect(glyphs(prims).map((g) => g.glyph)).toEqual(["tuplet3"]);
  });

  it("is forced by bracket: show even when beamed", () => {
    const group = eighthTriplet(["C5", "D5", "E5"], { bracket: "show" });
    expect(lines(tupletPrims(withTuplet(group)))).toHaveLength(4);
  });

  it("is suppressed by bracket: hide even when unbeamed", () => {
    const group = tuplet(
      3,
      2,
      4,
      ["E5", "D5", "C5"].map((p) => note(p, 4)),
      {
        bracket: "hide",
      },
    );
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [group, rest(2)]);
    const prims = tupletPrims(score);
    expect(lines(prims)).toHaveLength(0);
    expect(glyphs(prims)).toHaveLength(1);
  });

  it("has no gap when there is no number to make room for", () => {
    const group = tuplet(
      3,
      2,
      4,
      ["E5", "D5", "C5"].map((p) => note(p, 4)),
      {
        showNumber: "none",
      },
    );
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [group, rest(2)]);
    // One unbroken bracket plus two hooks.
    expect(lines(tupletPrims(score))).toHaveLength(3);
  });

  it("sits above notes with upward stems and below notes with downward stems", () => {
    const low = tuplet(
      3,
      2,
      4,
      ["E4", "D4", "C4"].map((p) => note(p, 4)),
    );
    const lowScore = makeScore({ measureCount: 1 });
    setStaff(lowScore, 0, 0, [low, rest(2)]);
    const lowSys = system(run(lowScore));
    const lowTop = staffTop(lowSys, 0);
    for (const l of lines(withRole(lowSys.primitives, "tuplet"))) {
      expect(l.y1).toBeLessThan(lowTop);
    }

    const high = tuplet(
      3,
      2,
      4,
      ["E5", "D5", "C5"].map((p) => note(p, 4)),
    );
    const highScore = makeScore({ measureCount: 1 });
    setStaff(highScore, 0, 0, [high, rest(2)]);
    const highSys = system(run(highScore));
    const highBottom = staffTop(highSys, 0) + 4;
    for (const l of lines(withRole(highSys.primitives, "tuplet"))) {
      expect(l.y1).toBeGreaterThan(highBottom);
    }
  });

  it("stacks a nested tuplet inside its parent", () => {
    const inner = tuplet(
      3,
      2,
      16,
      ["D5", "E5", "F5"].map((p) => note(p, 16)),
    );
    const outer = tuplet(3, 2, 8, [note("C5", 8), inner, note("G5", 8)]);
    const sys = system(run(withTuplet(outer)));
    const prims = withRole(sys.primitives, "tuplet");
    const innerNumber = glyphs(prims).find((g) => g.ref?.id === inner.id);
    const outerNumber = glyphs(prims).find((g) => g.ref?.id === outer.id);
    expect(innerNumber).toBeDefined();
    expect(outerNumber).toBeDefined();
    // Stems are down here, so the outer ornament sits further below than the inner one.
    expect(outerNumber!.y).toBeGreaterThan(innerNumber!.y);
    // Only the inner tuplet is a proper subset of the beam, so only it is bracketed.
    expect(lines(prims).every((l) => l.ref?.id === inner.id)).toBe(true);
  });
});

describe("the tuplets fixture", () => {
  it("engraves one ornament per tuplet on the treble staff", () => {
    const sys = system(run(tupletsFixture()));
    const ids = new Set(
      withRole(sys.primitives, "tuplet").map((p) => ("ref" in p ? p.ref?.id : undefined)),
    );
    // Two in m0, one in m1, three in m2 (nested pair + quintuplet), one in m3.
    expect(ids.size).toBe(7);
  });

  it("keeps the duplet inside a 6/8 measure", () => {
    const score = tupletsFixture();
    const voice = score.parts[0]!.measures[3]!.staves[0]!.voices[0]!;
    const duplet = voice.items[0]!;
    expect(duplet.kind).toBe("tuplet");
    expect(itemLength(duplet)).toEqual(frac(3, 8));
    expect(notated(8).base).toBe(8);
  });
});
