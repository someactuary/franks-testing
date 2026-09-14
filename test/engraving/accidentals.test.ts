import { describe, expect, it } from "vitest";
import { chord, note, rest } from "@/model/factory";
import type { NoteEvent } from "@/model/score";
import { glyphs, makeScore, run, setStaff, system, withRef, withRole } from "./helpers";

function withAccidental(ev: NoteEvent, mode: NonNullable<NoteEvent["notes"][number]["accidental"]>): NoteEvent {
  return { ...ev, notes: ev.notes.map((n) => ({ ...n, accidental: mode })) };
}

describe("automatic accidentals", () => {
  it("shows an accidental once and remembers it for the rest of the measure", () => {
    const score = makeScore({ measureCount: 1 });
    const a = note("F#4", 4);
    const b = note("F#4", 4);
    const c = note("F4", 4);
    const d = note("F#4", 4);
    setStaff(score, 0, 0, [a, b, c, d]);
    const prims = system(run(score)).primitives;

    expect(glyphs(withRef(prims, a.notes[0]!.id, "accidental")).map((g) => g.glyph)).toEqual([
      "accidentalSharp",
    ]);
    expect(withRef(prims, b.notes[0]!.id, "accidental")).toHaveLength(0);
    expect(glyphs(withRef(prims, c.notes[0]!.id, "accidental")).map((g) => g.glyph)).toEqual([
      "accidentalNatural",
    ]);
    expect(glyphs(withRef(prims, d.notes[0]!.id, "accidental")).map((g) => g.glyph)).toEqual([
      "accidentalSharp",
    ]);
  });

  it("keeps measure memory per octave", () => {
    const score = makeScore({ measureCount: 1 });
    const low = note("F#4", 4);
    const high = note("F4", 4); // F5 in the next octave is unaffected by F#4
    const other = note("F5", 4);
    setStaff(score, 0, 0, [low, high, other, rest(4)]);
    const prims = system(run(score)).primitives;
    expect(glyphs(withRef(prims, low.notes[0]!.id, "accidental"))).toHaveLength(1);
    expect(glyphs(withRef(prims, high.notes[0]!.id, "accidental"))).toHaveLength(1); // natural
    expect(glyphs(withRef(prims, other.notes[0]!.id, "accidental"))).toHaveLength(0);
  });

  it("resets memory at the barline", () => {
    const score = makeScore({ measureCount: 2 });
    const first = note("F#4", 1);
    const second = note("F#4", 1);
    setStaff(score, 0, 0, [first]);
    setStaff(score, 1, 0, [second]);
    const prims = system(run(score)).primitives;
    expect(glyphs(withRef(prims, first.notes[0]!.id, "accidental"))).toHaveLength(1);
    expect(glyphs(withRef(prims, second.notes[0]!.id, "accidental"))).toHaveLength(1);
  });

  it("hides accidentals that the key signature already supplies", () => {
    const score = makeScore({ measureCount: 1, keySig: { fifths: 1, mode: "major" } });
    const inKey = note("F#5", 4);
    const outOfKey = note("F5", 4);
    setStaff(score, 0, 0, [inKey, outOfKey, rest(2)]);
    const prims = system(run(score)).primitives;
    expect(glyphs(withRef(prims, inKey.notes[0]!.id, "accidental"))).toHaveLength(0);
    expect(glyphs(withRef(prims, outOfKey.notes[0]!.id, "accidental")).map((g) => g.glyph)).toEqual([
      "accidentalNatural",
    ]);
  });

  it("places the accidental left of its notehead", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = note("F#4", 1);
    setStaff(score, 0, 0, [ev]);
    const prims = system(run(score)).primitives;
    const acc = glyphs(withRef(prims, ev.notes[0]!.id, "accidental"))[0]!;
    const head = glyphs(withRef(prims, ev.notes[0]!.id, "notehead"))[0]!;
    expect(acc.x).toBeLessThan(head.x);
    expect(acc.y).toBeCloseTo(head.y, 6);
    // ~0.25 sp gap between the accidental's right edge and the notehead.
    expect(head.x - (acc.x + 0.996)).toBeCloseTo(0.25, 6);
  });
});

describe("explicit accidental modes", () => {
  it('"none" suppresses an accidental that would otherwise show', () => {
    const score = makeScore({ measureCount: 1 });
    const ev = withAccidental(note("F#4", 1), "none");
    setStaff(score, 0, 0, [ev]);
    const prims = system(run(score)).primitives;
    expect(withRef(prims, ev.notes[0]!.id, "accidental")).toHaveLength(0);
  });

  it('"force" shows an accidental that would otherwise be hidden', () => {
    const score = makeScore({ measureCount: 1 });
    const ev = withAccidental(note("F4", 1), "force");
    setStaff(score, 0, 0, [ev]);
    const prims = system(run(score)).primitives;
    expect(glyphs(withRef(prims, ev.notes[0]!.id, "accidental")).map((g) => g.glyph)).toEqual([
      "accidentalNatural",
    ]);
  });

  it('"courtesy" shows an accidental', () => {
    const score = makeScore({ measureCount: 1 });
    const ev = withAccidental(note("C5", 1), "courtesy");
    setStaff(score, 0, 0, [ev]);
    const prims = system(run(score)).primitives;
    expect(glyphs(withRef(prims, ev.notes[0]!.id, "accidental"))).toHaveLength(1);
  });

  it('"cautionary-parens" wraps the accidental in parentheses', () => {
    const score = makeScore({ measureCount: 1 });
    const ev = withAccidental(note("C#5", 1), "cautionary-parens");
    setStaff(score, 0, 0, [ev]);
    const prims = system(run(score)).primitives;
    const parts = glyphs(withRef(prims, ev.notes[0]!.id, "accidental"));
    expect(parts.map((g) => g.glyph)).toEqual([
      "accidentalParensLeft",
      "accidentalSharp",
      "accidentalParensRight",
    ]);
    expect(parts[0]!.x).toBeLessThan(parts[1]!.x);
    expect(parts[1]!.x).toBeLessThan(parts[2]!.x);
  });
});

describe("accidental stacking in chords", () => {
  it("puts non-overlapping accidentals in one column", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = chord(["C#4", "A#5"], 1); // far apart vertically
    setStaff(score, 0, 0, [ev]);
    const prims = system(run(score)).primitives;
    const xs = glyphs(withRole(prims, "accidental")).map((g) => Number(g.x.toFixed(6)));
    expect(new Set(xs).size).toBe(1);
  });

  it("splits colliding accidentals into separate columns", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = chord(["C#4", "E4", "G#4"], 1); // C# and G# are close enough to collide
    setStaff(score, 0, 0, [ev]);
    const prims = system(run(score)).primitives;
    const accs = glyphs(withRole(prims, "accidental"));
    expect(accs).toHaveLength(2);
    const xs = [...new Set(accs.map((g) => Number(g.x.toFixed(6))))];
    expect(xs.length).toBe(2);
    // Both columns sit left of every notehead.
    const leftmostHead = Math.min(...glyphs(withRole(prims, "notehead")).map((g) => g.x));
    for (const a of accs) expect(a.x).toBeLessThan(leftmostHead);
  });
});
