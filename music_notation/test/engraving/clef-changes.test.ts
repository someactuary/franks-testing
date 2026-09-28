import { describe, expect, it } from "vitest";
import {
  clefChangeId,
  frac,
  note,
  ZERO,
  type ClefKind,
  type Fraction,
  type NoteEvent,
  type Score,
} from "@/model";
import { ENGRAVING } from "@/engraving/constants";
import { glyphBox } from "@/engraving/geometry";
import type { GlyphPrim } from "@/engraving/layout-types";
import {
  allSystems,
  FONT,
  glyphs,
  lines,
  makeScore,
  run,
  setStaff,
  staffTop,
  stemDirection,
  system,
  withRef,
  withRole,
} from "./helpers";

function addChange(
  score: Score,
  measureIndex: number,
  staffIndex: number,
  at: Fraction,
  clef: ClefKind,
): void {
  const sm = score.parts[0]!.measures[measureIndex]!.staves[staffIndex]!;
  sm.clefChanges = [...(sm.clefChanges ?? []), { at, clef }];
}

/** The notehead of a single-note event (noteheads are tagged with the note's id). */
function noteheadOf(prims: ReturnType<typeof system>["primitives"], ev: NoteEvent): GlyphPrim {
  return glyphs(withRef(prims, ev.notes[0]!.id, "notehead"))[0]!;
}

function idOf(score: Score, measureIndex: number, staffIndex: number, at: Fraction): string {
  return clefChangeId({
    measureId: score.measures[measureIndex]!.id,
    partIndex: 0,
    staffIndex,
    at,
  });
}

describe("clef changes inside a measure", () => {
  function midMeasureScore() {
    const score = makeScore({ measureCount: 1 });
    const c5 = note("C5", 4);
    const d5 = note("D5", 4);
    const c3 = note("C3", 4);
    const e3 = note("E3", 4);
    setStaff(score, 0, 0, [c5, d5, c3, e3]);
    addChange(score, 0, 0, frac(1, 2), "bass");
    return { score, d5, c3, e3 };
  }

  it("draws a small clef, selectable by its own id, before the first note it applies to", () => {
    const { score, d5, c3 } = midMeasureScore();
    const sys = system(run(score));
    const marks = glyphs(withRole(sys.primitives, "clefChange"));
    expect(marks).toHaveLength(1);
    const mark = marks[0]!;
    expect(mark.glyph).toBe("fClef");
    expect(mark.scale).toBe(ENGRAVING.clefChangeScale);
    expect(mark.ref!.id).toBe(idOf(score, 0, 0, frac(1, 2)));
    // On the F line of the top staff, like a full-size bass clef.
    expect(mark.y).toBeCloseTo(staffTop(sys, 0) + 1, 6);

    const clefRight = mark.x + glyphBox(FONT, "fClef").width * ENGRAVING.clefChangeScale;
    const before = noteheadOf(sys.primitives, d5);
    const after = noteheadOf(sys.primitives, c3);
    expect(mark.x).toBeGreaterThan(before.x + glyphBox(FONT, before.glyph).width);
    expect(clefRight).toBeLessThan(after.x);
  });

  it("places the notes after the change by the new clef, notes before it by the old one", () => {
    const { score, d5, c3 } = midMeasureScore();
    const sys = system(run(score));
    // D5 in treble: two steps above the middle line. C3 in bass: one step below it.
    expect(noteheadOf(sys.primitives, d5).y).toBeCloseTo(staffTop(sys, 0) + 1, 6);
    expect(noteheadOf(sys.primitives, c3).y).toBeCloseTo(staffTop(sys, 0) + 2.5, 6);
  });

  it("chooses stem direction and ledger lines by the new clef", () => {
    const { score, e3 } = midMeasureScore();
    const sys = system(run(score));
    // E3 sits above the middle line in bass clef (stem down); in treble it would hang below the staff.
    expect(stemDirection(sys.primitives, e3.id)).toBe("down");
    expect(withRef(sys.primitives, e3.id, "ledger")).toHaveLength(0);
    // Without the change, the same E3 in treble takes ledger lines and an up stem.
    const plain = midMeasureScore();
    plain.score.parts[0]!.measures[0]!.staves[0]!.clefChanges = [];
    const plainSys = system(run(plain.score));
    expect(withRef(plainSys.primitives, plain.e3.id, "ledger").length).toBeGreaterThan(0);
    expect(stemDirection(plainSys.primitives, plain.e3.id)).toBe("up");
  });

  it("widens the measure by the clef's room", () => {
    const { score } = midMeasureScore();
    const plain = makeScore({ measureCount: 1 });
    setStaff(plain, 0, 0, [note("C5", 4), note("D5", 4), note("C5", 4), note("E5", 4)]);
    const withClef = run(score).pages[0]!.systems[0]!.measures[0]!;
    const without = run(plain).pages[0]!.systems[0]!.measures[0]!;
    // The one system is justified to the page width, so compare where the third note's column sits instead.
    const gap = (m: typeof withClef) => m.columns[2]!.x - m.columns[1]!.x;
    expect(gap(withClef)).toBeGreaterThan(gap(without));
  });

  it("draws nothing for a change that restates the clef already in force", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 1, [note("C3", 2), note("E3", 2)]);
    addChange(score, 0, 1, frac(1, 2), "bass");
    expect(withRole(system(run(score)).primitives, "clefChange")).toHaveLength(0);
  });
});

describe("clef changes at a measure's start", () => {
  function startChangeScore(measureCount = 3) {
    const score = makeScore({ measureCount });
    for (let m = 0; m < measureCount; m++) setStaff(score, m, 1, [note("C3", 1)]);
    const high = note("G4", 1);
    setStaff(score, 1, 1, [high]);
    addChange(score, 1, 1, ZERO, "treble");
    return { score, high };
  }

  it("draws the new clef small before the previous measure's barline, mid-system", () => {
    const { score, high } = startChangeScore();
    const result = run(score);
    const sys = system(result);
    const marks = glyphs(withRole(sys.primitives, "clefChange"));
    expect(marks.map((m) => m.glyph)).toEqual(["gClef"]);
    const mark = marks[0]!;
    expect(mark.ref!.id).toBe(idOf(score, 1, 1, ZERO));
    const m1 = sys.measures[0]!;
    // Inside measure 1, after its note, before its closing barline.
    expect(mark.x).toBeGreaterThan(m1.columns[0]!.x); // columns are in system coordinates
    expect(mark.x + glyphBox(FONT, "gClef").width * ENGRAVING.clefChangeScale).toBeLessThan(
      m1.x + m1.width,
    );
    // No full-size clef mid-system.
    expect(glyphs(withRole(sys.primitives, "clef"), "gClef")).toHaveLength(1); // the top staff's opening clef
    // G4 in treble: two steps below the middle line of the lower staff.
    expect(noteheadOf(sys.primitives, high).y).toBeCloseTo(staffTop(sys, 1) + 3, 6);
  });

  it("at a system break: full-size new clef on the new system, small courtesy clef at the old system's end", () => {
    const { score } = startChangeScore();
    score.layout.systemBreaks = [1];
    const [first, second] = allSystems(run(score));
    const courtesy = glyphs(withRole(first!.primitives, "clefChange"));
    expect(courtesy.map((g) => g.glyph)).toEqual(["gClef"]);
    // Second system opens with a treble clef on both staves.
    const opening = glyphs(withRole(second!.primitives, "clef"));
    expect(opening.map((g) => g.glyph).sort()).toEqual(["gClef", "gClef"]);
    expect(withRole(second!.primitives, "clefChange")).toHaveLength(0);
  });

  it("switches back later: each change is drawn once, and the staff ends in the last clef", () => {
    const { score } = startChangeScore(4);
    setStaff(score, 2, 1, [note("A4", 1)]); // still in treble
    addChange(score, 3, 1, ZERO, "bass");
    const sys = system(run(score));
    expect(glyphs(withRole(sys.primitives, "clefChange")).map((g) => g.glyph)).toEqual([
      "gClef",
      "fClef",
    ]);
    // Ledger lines only where a note sits outside its clef's staff: none here.
    expect(lines(withRole(sys.primitives, "ledger"))).toHaveLength(0);
  });
});
