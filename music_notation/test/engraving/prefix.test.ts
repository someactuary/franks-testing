import { describe, expect, it } from "vitest";
import { note, rest } from "@/model/factory";
import { glyphBox, keyCancellationLayout, keySignatureLayout } from "@/engraving/geometry";
import { minuet } from "../fixtures/minuet";
import {
  allSystems,
  FONT,
  glyphs,
  lines,
  makeScore,
  run,
  setStaff,
  staffTop,
  system,
  withRef,
  withRole,
} from "./helpers";

describe("clefs", () => {
  it("draws the G clef on the second line from the bottom and the F clef on the fourth", () => {
    const score = makeScore({ measureCount: 1 });
    const sys = system(run(score));
    const g = glyphs(sys.primitives, "gClef")[0]!;
    const f = glyphs(sys.primitives, "fClef")[0]!;
    expect(g.y).toBeCloseTo(staffTop(sys, 0) + 3, 6); // G4 line
    expect(f.y).toBeCloseTo(staffTop(sys, 1) + 1, 6); // F3 line
  });

  it("repeats the clef on every system", () => {
    const score = makeScore({ measureCount: 40 });
    for (let m = 0; m < 40; m++) {
      setStaff(score, m, 0, [note("C5", 4), note("D5", 4), note("E5", 4), note("F5", 4)]);
    }
    const systems = allSystems(run(score));
    expect(systems.length).toBeGreaterThan(1);
    for (const sys of systems) {
      expect(glyphs(sys.primitives, "gClef")).toHaveLength(1);
      expect(glyphs(sys.primitives, "fClef")).toHaveLength(1);
    }
  });

  it("tags clef glyphs with the measure id", () => {
    const score = makeScore({ measureCount: 1 });
    const sys = system(run(score));
    const clefs = glyphs(withRole(sys.primitives, "clef"));
    expect(clefs).toHaveLength(2);
    for (const c of clefs) expect(c.ref!.id).toBe(score.measures[0]!.id);
  });
});

describe("key signatures", () => {
  it("places the treble sharps in the standard octaves", () => {
    // F#5, C#5, G#5, D#5, A#4, E#5, B#4 measured in staff steps from the middle line.
    expect(keySignatureLayout({ fifths: 7, mode: "major" }, "treble").map((a) => a.staffStep)).toEqual([
      4, 1, 5, 2, -1, 3, 0,
    ]);
  });

  it("places the bass sharps two steps lower than the treble", () => {
    expect(keySignatureLayout({ fifths: 7, mode: "major" }, "bass").map((a) => a.staffStep)).toEqual([
      2, -1, 3, 0, -3, 1, -2,
    ]);
  });

  it("places the flats in the standard octaves", () => {
    expect(keySignatureLayout({ fifths: -7, mode: "major" }, "treble").map((a) => a.staffStep)).toEqual([
      0, 3, -1, 2, -2, 1, -3,
    ]);
    expect(keySignatureLayout({ fifths: -7, mode: "major" }, "bass").map((a) => a.staffStep)).toEqual([
      -2, 1, -3, 0, -4, -1, -5,
    ]);
  });

  it("draws three sharps on both staves at the right heights", () => {
    const score = makeScore({ measureCount: 1, keySig: { fifths: 3, mode: "major" } });
    const sys = system(run(score));
    const sharps = glyphs(withRole(sys.primitives, "keysig"));
    expect(sharps).toHaveLength(6); // 3 per staff
    expect(sharps.every((s) => s.glyph === "accidentalSharp")).toBe(true);

    const treble = sharps.filter((s) => s.y < staffTop(sys, 1) - 2).sort((a, b) => a.x - b.x);
    const top = staffTop(sys, 0);
    expect(treble.map((s) => s.y)).toEqual([top + 0, top + 1.5, top - 0.5]);
    // Accidentals run left to right in key order.
    expect(treble[0]!.x).toBeLessThan(treble[1]!.x);
    expect(treble[1]!.x).toBeLessThan(treble[2]!.x);
  });

  it("draws nothing for C major", () => {
    const score = makeScore({ measureCount: 1, keySig: { fifths: 0, mode: "major" } });
    expect(withRole(system(run(score)).primitives, "keysig")).toHaveLength(0);
  });

  it("draws flats for a flat key", () => {
    const score = makeScore({ measureCount: 1, keySig: { fifths: -2, mode: "major" } });
    const flats = glyphs(withRole(system(run(score)).primitives, "keysig"));
    expect(flats).toHaveLength(4);
    expect(flats.every((f) => f.glyph === "accidentalFlat")).toBe(true);
  });

  it("repeats the key signature at the start of every system", () => {
    const score = makeScore({ measureCount: 40, keySig: { fifths: 3, mode: "major" } });
    for (let m = 0; m < 40; m++) {
      setStaff(score, m, 0, [note("C5", 4), note("D5", 4), note("E5", 4), note("F5", 4)]);
      setStaff(score, m, 1, [note("C3", 2), note("G2", 2)]);
    }
    const systems = allSystems(run(score));
    expect(systems.length).toBeGreaterThan(1);
    for (const sys of systems) {
      const keysig = glyphs(withRole(sys.primitives, "keysig"));
      // Exactly one signature per staff at the system start, nowhere else.
      expect(keysig).toHaveLength(6);
      expect(keysig.every((g) => g.glyph === "accidentalSharp")).toBe(true);
    }
  });

  it("shows the minuet's F sharp on its second system", () => {
    const systems = allSystems(run(minuet()));
    expect(systems.length).toBeGreaterThan(1);
    for (const sys of systems) {
      expect(glyphs(withRole(sys.primitives, "keysig"), "accidentalSharp")).toHaveLength(2);
    }
  });
});

describe("key changes", () => {
  function threeMeasures(from: { fifths: number }, to: { fifths: number }) {
    const score = makeScore({ measureCount: 3, keySig: { fifths: from.fifths, mode: "major" } });
    score.measures[1]!.keySig = { fifths: to.fifths, mode: "major" };
    for (let m = 0; m < 3; m++) {
      setStaff(score, m, 0, [note("C5", 4), note("D5", 4), note("E5", 4), note("F5", 4)]);
      setStaff(score, m, 1, [note("C3", 2), note("G2", 2)]);
    }
    return glyphs(withRole(system(run(score)).primitives, "keysig"));
  }

  const count = (gs: ReturnType<typeof glyphs>, glyph: string) =>
    gs.filter((g) => g.glyph === glyph).length;

  it("cancels the whole outgoing key when the new key is C major", () => {
    const gs = threeMeasures({ fifths: 2 }, { fifths: 0 });
    // Two sharps at the system start, then two naturals per staff at the change.
    expect(count(gs, "accidentalSharp")).toBe(4);
    expect(count(gs, "accidentalNatural")).toBe(4);
  });

  it("cancels only the accidentals that are dropped", () => {
    const gs = threeMeasures({ fifths: 2 }, { fifths: 1 });
    expect(count(gs, "accidentalNatural")).toBe(2); // one per staff
    expect(count(gs, "accidentalSharp")).toBe(4 + 2); // start (2 per staff) + change (1 per staff)
  });

  it("cancels everything when the key flips from sharps to flats", () => {
    const gs = threeMeasures({ fifths: 2 }, { fifths: -1 });
    expect(count(gs, "accidentalNatural")).toBe(4);
    expect(count(gs, "accidentalFlat")).toBe(2);
  });

  it("cancels nothing when the key gains accidentals of the same kind", () => {
    const gs = threeMeasures({ fifths: 1 }, { fifths: 3 });
    expect(count(gs, "accidentalNatural")).toBe(0);
    expect(count(gs, "accidentalSharp")).toBe(2 + 6);
  });

  it("draws the cancellation and the new key at a system start", () => {
    const score = makeScore({ measureCount: 4, keySig: { fifths: 2, mode: "major" } });
    score.measures[2]!.keySig = { fifths: 0, mode: "major" };
    score.layout.systemBreaks = [2];
    for (let m = 0; m < 4; m++) {
      setStaff(score, m, 0, [note("C5", 4), note("D5", 4), note("E5", 4), note("F5", 4)]);
      setStaff(score, m, 1, [note("C3", 2), note("G2", 2)]);
    }
    const systems = allSystems(run(score));
    expect(systems).toHaveLength(2);
    const second = glyphs(withRole(systems[1]!.primitives, "keysig"));
    expect(second.filter((g) => g.glyph === "accidentalNatural")).toHaveLength(4);
    expect(second.filter((g) => g.glyph === "accidentalSharp")).toHaveLength(0);
    // The naturals follow the clef.
    const clef = glyphs(withRole(systems[1]!.primitives, "clef"))[0]!;
    for (const n of second) expect(n.x).toBeGreaterThan(clef.x);
  });

  it("orders the cancellation naturals like the key they replace", () => {
    const naturals = keyCancellationLayout(
      { fifths: 3, mode: "major" },
      { fifths: 0, mode: "major" },
      "treble",
    );
    expect(naturals.map((a) => a.step)).toEqual(["F", "C", "G"]);
    expect(naturals.map((a) => a.staffStep)).toEqual([4, 1, 5]);
    expect(naturals.every((a) => a.glyph === "accidentalNatural")).toBe(true);
  });

  it("cancels nothing when there was no key to cancel", () => {
    expect(
      keyCancellationLayout({ fifths: 0, mode: "major" }, { fifths: -3, mode: "major" }, "bass"),
    ).toEqual([]);
  });
});

describe("time signatures", () => {
  it("stacks the numerator over the denominator in the upper and lower halves", () => {
    const score = makeScore({ measureCount: 1, timeSig: { numerator: 3, denominator: 4 } });
    const sys = system(run(score));
    const top = staffTop(sys, 0);
    const digits = glyphs(withRole(sys.primitives, "timesig")).filter((g) => g.y < staffTop(sys, 1) - 2);
    expect(digits.map((d) => d.glyph).sort()).toEqual(["timeSig3", "timeSig4"]);
    const num = digits.find((d) => d.glyph === "timeSig3")!;
    const den = digits.find((d) => d.glyph === "timeSig4")!;
    expect(num.y).toBeCloseTo(top + 1, 6); // 2nd line from the top
    expect(den.y).toBeCloseTo(top + 3, 6); // 4th line from the top
    // Centred on each other by advance width (timeSig3 is narrower than timeSig4).
    expect(num.x + glyphBox(FONT, "timeSig3").width / 2).toBeCloseTo(
      den.x + glyphBox(FONT, "timeSig4").width / 2,
      6,
    );
  });

  it("uses one glyph per digit for multi-digit numerators", () => {
    const score = makeScore({ measureCount: 1, timeSig: { numerator: 12, denominator: 8 } });
    const digits = glyphs(withRole(system(run(score)).primitives, "timesig"));
    expect(digits).toHaveLength(6); // (1,2 over 8) x 2 staves
  });

  it("draws the time signature only where it is declared", () => {
    const score = makeScore({ measureCount: 40 });
    for (let m = 0; m < 40; m++) {
      setStaff(score, m, 0, [note("C5", 4), note("D5", 4), note("E5", 4), note("F5", 4)]);
    }
    const systems = allSystems(run(score));
    expect(systems.length).toBeGreaterThan(1);
    const totals = systems.map((s) => withRole(s.primitives, "timesig").length);
    expect(totals[0]).toBeGreaterThan(0);
    for (const t of totals.slice(1)) expect(t).toBe(0);
  });

  it("draws a new time signature where it changes", () => {
    const score = makeScore({ measureCount: 3 });
    score.measures[1]!.timeSig = { numerator: 3, denominator: 4 };
    setStaff(score, 1, 0, [note("C5", 4), note("D5", 4), note("E5", 4)]);
    setStaff(score, 1, 1, [note("C3", 4), note("D3", 4), note("E3", 4)]);
    const digits = glyphs(withRole(system(run(score)).primitives, "timesig"));
    expect(digits.filter((d) => d.glyph === "timeSig3")).toHaveLength(2); // one per staff
  });
});

describe("system furniture", () => {
  it("draws a brace scaled to span both staves of the piano part", () => {
    const score = makeScore({ measureCount: 1 });
    const sys = system(run(score));
    const brace = glyphs(sys.primitives, "brace")[0]!;
    expect(brace.scale).toBeDefined();
    const bottom = staffTop(sys, 1) + 4;
    expect(brace.y).toBeCloseTo(bottom, 6);
    // Bravura's brace is ~4 sp tall, so spanning 16 sp needs about 4x.
    expect(brace.scale!).toBeCloseTo(bottom / 4.00244, 3);
    expect(brace.x).toBeLessThan(0); // left of the staff lines
  });

  it("joins the staves with a vertical line at the system start", () => {
    const score = makeScore({ measureCount: 1 });
    const sys = system(run(score));
    const start = lines(sys.primitives).filter((l) => l.x1 === 0 && l.x2 === 0);
    expect(start).toHaveLength(1);
    expect(start[0]!.y1).toBeCloseTo(staffTop(sys, 0), 6);
    expect(start[0]!.y2).toBeCloseTo(staffTop(sys, 1) + 4, 6);
  });

  it("draws five staff lines per staff across the system", () => {
    const score = makeScore({ measureCount: 1 });
    const sys = system(run(score));
    const staffLines = sys.primitives.filter((p) => p.type === "staffLines");
    expect(staffLines).toHaveLength(2);
    for (const sl of staffLines) {
      expect(sl.type === "staffLines" && sl.lineCount).toBe(5);
      expect(sl.type === "staffLines" && sl.width).toBeCloseTo(sys.width, 6);
    }
  });
});

describe("barlines", () => {
  it("draws a thin barline at the end of a plain measure", () => {
    const score = makeScore({ measureCount: 2 });
    score.measures[1]!.barline = "regular";
    const sys = system(run(score));
    const bars = lines(withRef(sys.primitives, score.measures[0]!.id, "barline"));
    // One per part, plus the system-start line which shares the first measure's id.
    expect(bars.filter((b) => b.x1 > 0)).toHaveLength(1);
  });

  it("draws thin + thick for a final barline", () => {
    const score = makeScore({ measureCount: 2 });
    const sys = system(run(score));
    const last = score.measures[1]!;
    expect(last.barline).toBe("final");
    const bars = lines(withRef(sys.primitives, last.id, "barline")).sort((a, b) => a.x1 - b.x1);
    expect(bars).toHaveLength(2);
    expect(bars[0]!.thickness).toBeCloseTo(0.16, 6); // thin
    expect(bars[1]!.thickness).toBeCloseTo(0.5, 6); // thick
    // Thick barline's right edge is the measure's right edge.
    const end = sys.measures[1]!.x + sys.measures[1]!.width;
    expect(bars[1]!.x1 + 0.25).toBeCloseTo(end, 6);
  });

  it("draws two thin lines for a double barline", () => {
    const score = makeScore({ measureCount: 2 });
    score.measures[0]!.barline = "double";
    const sys = system(run(score));
    const bars = lines(withRef(sys.primitives, score.measures[0]!.id, "barline")).filter((b) => b.x1 > 0);
    expect(bars).toHaveLength(2);
    for (const b of bars) expect(b.thickness).toBeCloseTo(0.16, 6);
  });

  it("draws nothing for an invisible barline", () => {
    const score = makeScore({ measureCount: 2 });
    score.measures[0]!.barline = "invisible";
    const sys = system(run(score));
    const bars = lines(withRef(sys.primitives, score.measures[0]!.id, "barline")).filter((b) => b.x1 > 0);
    expect(bars).toHaveLength(0);
  });
});

describe("rests", () => {
  it("hangs a whole rest from the 4th line from the bottom", () => {
    const score = makeScore({ measureCount: 1 });
    const sys = system(run(score));
    const whole = glyphs(withRole(sys.primitives, "rest"), "restWhole");
    expect(whole).toHaveLength(2); // the factory fills each staff with a measure rest
    expect(whole[0]!.y).toBeCloseTo(staffTop(sys, 0) + 1, 6);
  });

  it("centres a whole-measure rest in the measure", () => {
    const score = makeScore({ measureCount: 1 });
    const sys = system(run(score));
    const whole = glyphs(withRole(sys.primitives, "rest"), "restWhole")[0]!;
    const m = sys.measures[0]!;
    const centre = m.x + m.width / 2;
    expect(whole.x + 1.132 / 2).toBeCloseTo(centre, 2);
  });

  it("sits a half rest on the middle line and centres the others on it", () => {
    const score = makeScore({ measureCount: 1 });
    const half = rest(2);
    const quarter = rest(4);
    const eighth = rest(8);
    setStaff(score, 0, 0, [half, quarter, eighth, rest(8)]);
    const sys = system(run(score));
    const top = staffTop(sys, 0);
    const y = (id: string) => glyphs(withRef(sys.primitives, id, "rest"))[0]!.y;
    expect(y(half.id)).toBeCloseTo(top + 2, 6);
    expect(y(quarter.id)).toBeCloseTo(top + 2, 6);
    expect(y(eighth.id)).toBeCloseTo(top + 2, 6);
  });

  it("dots a rest in the space above its line", () => {
    const score = makeScore({ measureCount: 1 });
    const dottedRest = { ...rest(4), duration: { base: 4 as const, dots: 1 as const } };
    setStaff(score, 0, 0, [dottedRest, rest(8), rest(2)]);
    const sys = system(run(score));
    const top = staffTop(sys, 0);
    const dots = glyphs(withRef(sys.primitives, dottedRest.id, "dot"));
    expect(dots).toHaveLength(1);
    expect(dots[0]!.y).toBeCloseTo(top + 1.5, 6);
  });
});
