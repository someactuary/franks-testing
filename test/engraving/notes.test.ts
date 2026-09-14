import { describe, expect, it } from "vitest";
import { chord, note, rest } from "@/model/factory";
import { glyphBox, staffStep } from "@/engraving/geometry";
import { parsePitch } from "@/model/pitch";
import {
  FONT,
  glyphs,
  lines,
  makeScore,
  run,
  setStaff,
  staffTop,
  system,
  withDots,
  withRef,
  withRole,
  withStem,
} from "./helpers";

describe("staff positions", () => {
  it("puts C4 on the first leger line below the treble staff", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = note("C4", 4);
    setStaff(score, 0, 0, [ev, rest(4), rest(2)]);
    const sys = system(run(score));
    const top = staffTop(sys, 0);

    const head = glyphs(withRef(sys.primitives, ev.notes[0]!.id, "notehead"))[0];
    expect(head).toBeDefined();
    // Bottom line is top + 4; the first leger line below is top + 5.
    expect(head!.y).toBeCloseTo(top + 5, 6);

    const ledger = lines(withRef(sys.primitives, ev.id, "ledger"));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.y1).toBeCloseTo(top + 5, 6);
    expect(ledger[0]!.y1).toBe(ledger[0]!.y2);
    // The leger line overhangs the notehead on both sides.
    expect(ledger[0]!.x1).toBeLessThan(head!.x);
    expect(ledger[0]!.x2).toBeGreaterThan(head!.x);
  });

  it("puts C4 one leger line above the bass staff", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = note("C4", 4);
    setStaff(score, 0, 1, [ev, rest(4), rest(2)]);
    const sys = system(run(score));
    const top = staffTop(sys, 1);
    const head = glyphs(withRef(sys.primitives, ev.notes[0]!.id, "notehead"))[0]!;
    expect(head.y).toBeCloseTo(top - 1, 6);
  });

  it("agrees with the clef reference pitches", () => {
    expect(staffStep(parsePitch("B4"), "treble")).toBe(0);
    expect(staffStep(parsePitch("D3"), "bass")).toBe(0);
    expect(staffStep(parsePitch("C4"), "alto")).toBe(0);
    expect(staffStep(parsePitch("A3"), "tenor")).toBe(0);
  });

  it("uses whole, half and black noteheads by duration", () => {
    const score = makeScore({ measureCount: 3 });
    setStaff(score, 0, 0, [note("B4", 1)]);
    setStaff(score, 1, 0, [note("B4", 2), note("B4", 2)]);
    setStaff(score, 2, 0, [note("B4", 4), note("B4", 4), note("B4", 4), note("B4", 4)]);
    const prims = system(run(score)).primitives;
    expect(glyphs(prims, "noteheadWhole")).toHaveLength(1);
    expect(glyphs(prims, "noteheadHalf")).toHaveLength(2);
    expect(glyphs(prims, "noteheadBlack")).toHaveLength(4);
  });
});

describe("stems", () => {
  it("points up below the middle line and down on or above it", () => {
    const score = makeScore({ measureCount: 1 });
    const low = note("C4", 4); // below the middle line
    const mid = note("B4", 4); // the middle line itself
    const high = note("G5", 4); // above the middle line
    setStaff(score, 0, 0, [low, mid, high, rest(4)]);
    const prims = system(run(score)).primitives;

    const stemOf = (id: string) => lines(withRef(prims, id, "stem"))[0]!;
    // y grows downwards, so an up stem ends above (smaller y) where it starts.
    expect(stemOf(low.id).y2).toBeLessThan(stemOf(low.id).y1);
    expect(stemOf(mid.id).y2).toBeGreaterThan(stemOf(mid.id).y1);
    expect(stemOf(high.id).y2).toBeGreaterThan(stemOf(high.id).y1);
  });

  it("has no stem on a whole note", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = note("B4", 1);
    setStaff(score, 0, 0, [ev]);
    expect(withRef(system(run(score)).primitives, ev.id, "stem")).toHaveLength(0);
  });

  it("uses the standard 3.5 sp length inside the staff", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = note("D5", 4); // step 2, stem down
    setStaff(score, 0, 0, [ev, rest(4), rest(2)]);
    const sys = system(run(score));
    const top = staffTop(sys, 0);
    const stem = lines(withRef(sys.primitives, ev.id, "stem"))[0]!;
    const headY = top + 1; // D5 = step 2 => top + 2 - 1
    expect(stem.y2).toBeCloseTo(headY + 3.5, 6);
  });

  it("extends the stem to the middle line for notes beyond the first leger line", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = note("A3", 4); // two leger lines below the treble staff
    setStaff(score, 0, 0, [ev, rest(4), rest(2)]);
    const sys = system(run(score));
    const top = staffTop(sys, 0);
    const stem = lines(withRef(sys.primitives, ev.id, "stem"))[0]!;
    expect(stem.y2).toBeCloseTo(top + 2, 6); // the middle line
  });

  it("honours an explicit stem override", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = withStem(note("C4", 4), "down");
    setStaff(score, 0, 0, [ev, rest(4), rest(2)]);
    const stem = lines(withRef(system(run(score)).primitives, ev.id, "stem"))[0]!;
    expect(stem.y2).toBeGreaterThan(stem.y1);
  });

  it("takes the chord's direction from the note farthest from the middle line", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = chord(["D4", "A4"], 4); // D4 is 5 steps below, A4 is 1 below
    setStaff(score, 0, 0, [ev, rest(4), rest(2)]);
    const stem = lines(withRef(system(run(score)).primitives, ev.id, "stem"))[0]!;
    expect(stem.y2).toBeLessThan(stem.y1);
  });
});

describe("chords", () => {
  it("displaces the upper note of a second to the right of an up stem", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = chord(["C4", "D4"], 4);
    setStaff(score, 0, 0, [ev, rest(4), rest(2)]);
    const prims = system(run(score)).primitives;
    const lower = glyphs(withRef(prims, ev.notes[0]!.id, "notehead"))[0]!;
    const upper = glyphs(withRef(prims, ev.notes[1]!.id, "notehead"))[0]!;
    const stem = lines(withRef(prims, ev.id, "stem"))[0]!;
    expect(stem.y2).toBeLessThan(stem.y1); // stem up
    expect(upper.x).toBeGreaterThan(lower.x);
    // The displaced head's left edge meets the stem's left edge.
    expect(upper.x).toBeCloseTo(stem.x1 - stem.thickness / 2, 6);
  });

  it("displaces the lower note of a second to the left of a down stem", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = chord(["E5", "F5"], 4);
    setStaff(score, 0, 0, [ev, rest(4), rest(2)]);
    const prims = system(run(score)).primitives;
    const lower = glyphs(withRef(prims, ev.notes[0]!.id, "notehead"))[0]!;
    const upper = glyphs(withRef(prims, ev.notes[1]!.id, "notehead"))[0]!;
    const stem = lines(withRef(prims, ev.id, "stem"))[0]!;
    expect(stem.y2).toBeGreaterThan(stem.y1); // stem down
    expect(lower.x).toBeLessThan(upper.x);
    // The displaced head's right edge meets the stem's right edge.
    const headWidth = glyphBox(FONT, "noteheadBlack").width;
    expect(lower.x + headWidth).toBeCloseTo(stem.x1 + stem.thickness / 2, 6);
  });

  it("leaves a third undisplaced", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = chord(["C4", "E4"], 4);
    setStaff(score, 0, 0, [ev, rest(4), rest(2)]);
    const prims = system(run(score)).primitives;
    const a = glyphs(withRef(prims, ev.notes[0]!.id, "notehead"))[0]!;
    const b = glyphs(withRef(prims, ev.notes[1]!.id, "notehead"))[0]!;
    expect(a.x).toBeCloseTo(b.x, 6);
  });

  it("draws one leger line per level spanning the whole chord", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = chord(["A3", "C4"], 4); // A3 needs two leger lines, C4 one
    setStaff(score, 0, 0, [ev, rest(4), rest(2)]);
    const sys = system(run(score));
    const top = staffTop(sys, 0);
    const ledgers = lines(withRef(sys.primitives, ev.id, "ledger"));
    expect(ledgers.map((l) => l.y1).sort((x, y) => x - y)).toEqual([top + 5, top + 6]);
  });
});

describe("augmentation dots", () => {
  it("puts the dot of a line note in the space above", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = withDots(note("B4", 2), 1); // B4 is the middle line
    setStaff(score, 0, 0, [ev, rest(4)]);
    const sys = system(run(score));
    const top = staffTop(sys, 0);
    const dots = glyphs(withRef(sys.primitives, ev.id, "dot"));
    expect(dots).toHaveLength(1);
    expect(dots[0]!.y).toBeCloseTo(top + 1.5, 6);
  });

  it("keeps the dot of a space note in its own space", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = withDots(note("C5", 2), 1); // C5 sits in the third space (step 1)
    setStaff(score, 0, 0, [ev, rest(4)]);
    const sys = system(run(score));
    const top = staffTop(sys, 0);
    const dots = glyphs(withRef(sys.primitives, ev.id, "dot"));
    expect(dots[0]!.y).toBeCloseTo(top + 1.5, 6);
  });

  it("emits two dots for a double-dotted note", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = withDots(note("B4", 2), 2);
    setStaff(score, 0, 0, [ev, rest(8)]);
    const dots = glyphs(withRef(system(run(score)).primitives, ev.id, "dot"));
    expect(dots).toHaveLength(2);
    expect(dots[1]!.x).toBeGreaterThan(dots[0]!.x);
  });

  it("places the dot to the right of every notehead in a chord", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = withDots(chord(["C4", "E4", "G4"], 2), 1);
    setStaff(score, 0, 0, [ev, rest(4)]);
    const prims = system(run(score)).primitives;
    const dots = glyphs(withRef(prims, ev.id, "dot"));
    expect(dots).toHaveLength(3);
    const heads = glyphs(withRole(prims, "notehead"));
    const rightmost = Math.max(...heads.map((h) => h.x));
    for (const d of dots) expect(d.x).toBeGreaterThan(rightmost);
  });
});

describe("flags", () => {
  it("flags an unbeamed eighth and a sixteenth", () => {
    const score = makeScore({ measureCount: 1 });
    const e = note("C4", 8);
    const s = note("C4", 16);
    setStaff(score, 0, 0, [e, rest(8), s, rest(16), rest(2)]);
    const prims = system(run(score)).primitives;
    expect(glyphs(withRef(prims, e.id, "flag")).map((g) => g.glyph)).toEqual(["flag8thUp"]);
    expect(glyphs(withRef(prims, s.id, "flag")).map((g) => g.glyph)).toEqual(["flag16thUp"]);
  });

  it("attaches the flag at the stem tip", () => {
    const score = makeScore({ measureCount: 1 });
    const e = note("C4", 8);
    setStaff(score, 0, 0, [e, rest(8), rest(2), rest(4)]);
    const prims = system(run(score)).primitives;
    const stem = lines(withRef(prims, e.id, "stem"))[0]!;
    const flag = glyphs(withRef(prims, e.id, "flag"))[0]!;
    // flag8thUp's stemUpNW anchor is (0, -0.04) in SMuFL (y up) => (0, +0.04) here.
    expect(flag.x).toBeCloseTo(stem.x1 - stem.thickness / 2, 6);
    expect(flag.y).toBeCloseTo(stem.y2 - 0.04, 6);
  });

  it("uses the down flag for a stem-down note", () => {
    const score = makeScore({ measureCount: 1 });
    const e = note("G5", 8);
    setStaff(score, 0, 0, [e, rest(8), rest(2), rest(4)]);
    const prims = system(run(score)).primitives;
    expect(glyphs(withRef(prims, e.id, "flag")).map((g) => g.glyph)).toEqual(["flag8thDown"]);
  });
});
