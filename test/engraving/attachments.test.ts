import { describe, expect, it } from "vitest";
import { EXPRESSIVE } from "@/engraving/attachments";
import { glyphBox, STAFF_HEIGHT } from "@/engraving/geometry";
import { buildSkyline, clearanceAbove, clearanceBelow } from "@/engraving/skyline";
import type { GlyphPrim, Primitive } from "@/engraving/layout-types";
import { notated, ZERO } from "@/model/duration";
import { chord, note } from "@/model/factory";
import { newId } from "@/model/ids";
import type { Articulation, Attachment, NoteEvent, Score } from "@/model/score";
import { FONT, glyphs, makeScore, run, setStaff, staffTop, system, texts } from "./helpers";

function artic(ev: NoteEvent, ...marks: Articulation[]): NoteEvent {
  return { ...ev, articulations: marks };
}

function fing(ev: NoteEvent, ...fingers: string[]): NoteEvent {
  return {
    ...ev,
    notes: ev.notes.map((n, i) => (fingers[i] ? { ...n, fingering: fingers[i] } : n)),
  };
}

/** `Omit` over a union keeps only the common keys, so distribute it by hand. */
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

function attach(score: Score, a: WithoutId<Attachment>): Attachment {
  const full = { id: newId(), ...a } as Attachment;
  score.attachments.push(full);
  return full;
}

/** Vertical centre of a glyph primitive. */
function centreY(p: GlyphPrim): number {
  const box = glyphBox(FONT, p.glyph);
  return p.y + (box.down - box.up) / 2;
}

function articulations(prims: Primitive[]): GlyphPrim[] {
  return glyphs(prims).filter((p) => p.ref?.role === "articulation");
}

describe("articulations", () => {
  it("sits above the notehead when the stem points down", () => {
    const score = makeScore({ measureCount: 1 });
    // C5 is above the middle line, so its stem points down.
    setStaff(score, 0, 0, [artic(note("C5", 4), "staccato"), note("C5", 4), note("C5", 4), note("C5", 4)]);
    const sys = system(run(score));
    const head = glyphs(sys.primitives, "noteheadBlack")[0]!;
    const marks = articulations(sys.primitives);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.glyph).toBe("articStaccatoAbove");
    expect(marks[0]!.y).toBeLessThan(head.y);
  });

  it("sits below the notehead when the stem points up", () => {
    const score = makeScore({ measureCount: 1 });
    // D4 is below the middle line, so its stem points up.
    setStaff(score, 0, 0, [artic(note("D4", 4), "tenuto"), note("D4", 4), note("D4", 4), note("D4", 4)]);
    const sys = system(run(score));
    const head = glyphs(sys.primitives, "noteheadBlack")[0]!;
    const marks = articulations(sys.primitives);
    expect(marks[0]!.glyph).toBe("articTenutoBelow");
    expect(marks[0]!.y).toBeGreaterThan(head.y);
  });

  it("puts marcato above even when the stem points up", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [
      artic(note("D4", 4), "staccato", "marcato"),
      note("D4", 4),
      note("D4", 4),
      note("D4", 4),
    ]);
    const sys = system(run(score));
    const head = glyphs(sys.primitives, "noteheadBlack")[0]!;
    const marks = articulations(sys.primitives);
    const names = marks.map((m) => m.glyph);
    expect(names).toContain("articMarcatoAbove");
    expect(names).toContain("articStaccatoBelow");
    expect(marks.find((m) => m.glyph === "articMarcatoAbove")!.y).toBeLessThan(head.y);
  });

  it("never leaves an articulation centred on a staff line", () => {
    const score = makeScore({ measureCount: 1 });
    // B4 sits on the middle line, where the naive position lands on a line too.
    setStaff(score, 0, 0, [artic(note("B4", 4), "staccato"), note("B4", 4), note("B4", 4), note("B4", 4)]);
    const sys = system(run(score));
    const top = staffTop(sys, 0);
    const mark = articulations(sys.primitives)[0]!;
    const p = centreY(mark) - top;
    expect(p).toBeGreaterThan(-0.4);
    expect(p).toBeLessThan(STAFF_HEIGHT + 0.4);
    expect(Math.abs(p - Math.round(p))).toBeGreaterThanOrEqual(EXPRESSIVE.articLineAvoidSp);
  });

  it("stacks two articulations on the same side", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [
      artic(note("C5", 4), "staccato", "tenuto"),
      note("C5", 4),
      note("C5", 4),
      note("C5", 4),
    ]);
    const sys = system(run(score));
    const marks = articulations(sys.primitives);
    expect(marks).toHaveLength(2);
    // The second one is further from the notehead (smaller y = higher up).
    expect(marks[1]!.y).toBeLessThan(marks[0]!.y);
  });
});

describe("fingering", () => {
  it("is centred above the notehead on the upper staff", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [fing(note("C5", 4), "3"), note("C5", 4), note("C5", 4), note("C5", 4)]);
    const sys = system(run(score));
    const head = glyphs(sys.primitives, "noteheadBlack")[0]!;
    const headBox = glyphBox(FONT, head.glyph);
    const digits = texts(sys.primitives).filter((t) => t.style === "fingering");
    expect(digits).toHaveLength(1);
    expect(digits[0]!.text).toBe("3");
    expect(digits[0]!.size).toBeCloseTo(1.3);
    expect(digits[0]!.anchor).toBe("middle");
    expect(digits[0]!.x).toBeCloseTo(head.x + headBox.width / 2, 5);
    expect(digits[0]!.y).toBeLessThan(head.y);
  });

  it("stacks a chord's fingerings, the lowest note nearest the staff", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [
      fing(chord(["C5", "E5"], 4), "1", "3"),
      note("C5", 4),
      note("C5", 4),
      note("C5", 4),
    ]);
    const sys = system(run(score));
    const digits = texts(sys.primitives).filter((t) => t.style === "fingering");
    expect(digits.map((d) => d.text)).toEqual(["1", "3"]);
    // "1" belongs to the lower note and stays closer to the staff (larger y).
    expect(digits[0]!.y).toBeGreaterThan(digits[1]!.y);
    expect(digits[0]!.y - digits[1]!.y).toBeGreaterThan(digits[0]!.size * 0.8);
  });

  it("hangs below the bottom staff of the part", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 1, [fing(note("C3", 4), "5"), note("C3", 4), note("C3", 4), note("C3", 4)]);
    const sys = system(run(score));
    const digits = texts(sys.primitives).filter((t) => t.style === "fingering");
    expect(digits).toHaveLength(1);
    expect(digits[0]!.y).toBeGreaterThan(staffTop(sys, 1) + STAFF_HEIGHT);
  });
});

describe("dynamics, text and tempo", () => {
  function scoreWithNotes(): { score: Score; first: NoteEvent } {
    const score = makeScore({ measureCount: 1 });
    const events = [note("C5", 4), note("D5", 4), note("E5", 4), note("F5", 4)];
    setStaff(score, 0, 0, events);
    setStaff(score, 0, 1, [note("C3", 1)]);
    return { score, first: events[0]! };
  }

  it("puts a dynamic below the anchored staff, left-aligned on the note", () => {
    const { score, first } = scoreWithNotes();
    attach(score, {
      partIndex: 0,
      staffIndex: 0,
      kind: "dynamic",
      text: "mf",
      anchor: { kind: "event", eventId: first.id },
    });
    const sys = system(run(score));
    const dyn = texts(sys.primitives).find((t) => t.style === "dynamic")!;
    expect(dyn.text).toBe("mf");
    const head = glyphs(sys.primitives, "noteheadBlack")[0]!;
    expect(dyn.x).toBeCloseTo(head.x, 5);
    expect(dyn.y).toBeGreaterThan(staffTop(sys, 0) + STAFF_HEIGHT + EXPRESSIVE.dynamicsLaneSp);
    // ... and stays above the lower staff of the grand staff.
    expect(dyn.y).toBeLessThan(staffTop(sys, 1));
  });

  it("puts expression text below when the placement says so", () => {
    const { score, first } = scoreWithNotes();
    attach(score, {
      partIndex: 0,
      staffIndex: 0,
      kind: "text",
      text: "dolce",
      style: "expression",
      placement: "below",
      anchor: { kind: "event", eventId: first.id },
    });
    const sys = system(run(score));
    const txt = texts(sys.primitives).find((t) => t.style === "expression")!;
    expect(txt.text).toBe("dolce");
    expect(txt.y).toBeGreaterThan(staffTop(sys, 0) + STAFF_HEIGHT);
  });

  it("puts the tempo mark above the top staff with its metronome glyph", () => {
    const { score } = scoreWithNotes();
    attach(score, {
      partIndex: 0,
      staffIndex: 0,
      kind: "tempo",
      text: "Andante",
      beatUnit: notated(4),
      bpm: 76,
      anchor: { kind: "measure", measureIndex: 0, offset: ZERO },
    });
    const sys = system(run(score));
    const tempo = texts(sys.primitives).filter((t) => t.style === "tempo");
    expect(tempo.map((t) => t.text)).toEqual(["Andante", "= 76"]);
    for (const t of tempo) expect(t.y).toBeLessThan(staffTop(sys, 0));
    const met = glyphs(sys.primitives, "metNoteQuarterUp");
    expect(met).toHaveLength(1);
    expect(met[0]!.y).toBeLessThan(staffTop(sys, 0));
    // The text comes first, then the note, then the bpm.
    expect(tempo[0]!.x).toBeLessThan(met[0]!.x);
    expect(met[0]!.x).toBeLessThan(tempo[1]!.x);
  });

  it("draws a dotted metronome unit with an augmentation dot", () => {
    const { score } = scoreWithNotes();
    attach(score, {
      partIndex: 0,
      staffIndex: 0,
      kind: "tempo",
      beatUnit: notated(2, 1),
      bpm: 60,
      anchor: { kind: "measure", measureIndex: 0, offset: ZERO },
    });
    const sys = system(run(score));
    expect(glyphs(sys.primitives, "metNoteHalfUp")).toHaveLength(1);
    expect(glyphs(sys.primitives, "metAugmentationDot")).toHaveLength(1);
  });

  it("puts a fermata above the staff and a pedal mark below the bottom one", () => {
    const { score, first } = scoreWithNotes();
    attach(score, {
      partIndex: 0,
      staffIndex: 0,
      kind: "fermata",
      anchor: { kind: "event", eventId: first.id },
    });
    attach(score, {
      partIndex: 0,
      staffIndex: 1,
      kind: "pedalMark",
      mark: "ped",
      anchor: { kind: "event", eventId: first.id },
    });
    const sys = system(run(score));
    const fermata = glyphs(sys.primitives, "fermataAbove")[0]!;
    expect(fermata.y - glyphBox(FONT, "fermataAbove").up).toBeLessThan(staffTop(sys, 0));
    expect(fermata.ref?.role).toBe("fermata"); // its own role, distinct from real per-note articulations — see docs/ARCHITECTURE.md's "Selectable markings": a fermata has its own attachment id and is independently movable, unlike staccato/tenuto/accent, which share an id with their host note.
    const ped = glyphs(sys.primitives, "keyboardPedalPed")[0]!;
    expect(ped.y - glyphBox(FONT, "keyboardPedalPed").up).toBeGreaterThan(
      staffTop(sys, 1) + STAFF_HEIGHT,
    );
  });
});

describe("skyline", () => {
  it("falls back to the staff lines where there is no ink", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [note("C5", 4), note("C5", 4), note("C5", 4), note("C5", 4)]);
    const sys = system(run(score));
    const sk = buildSkyline(sys.primitives, sys.staves, FONT)[0]!;
    expect(clearanceAbove(sk, -100, -50)).toBe(sk.staffY);
    expect(clearanceBelow(sk, -100, -50)).toBe(sk.staffY + STAFF_HEIGHT);
  });

  it("reports the ink of a high note above the staff", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [note("C7", 4), note("C5", 4), note("C5", 4), note("C5", 4)]);
    const sys = system(run(score));
    const sk = buildSkyline(sys.primitives, sys.staves, FONT)[0]!;
    const head = glyphs(sys.primitives, "noteheadBlack")[0]!;
    expect(clearanceAbove(sk, head.x, head.x + 1)).toBeLessThan(head.y);
    expect(clearanceAbove(sk, head.x, head.x + 1)).toBeLessThan(sk.staffY);
  });
});
