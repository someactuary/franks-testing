import { produce } from "immer";
import { describe, expect, it } from "vitest";
import {
  chord,
  frac,
  newPianoScore,
  notated,
  notatedToFraction,
  note,
  pitchToString,
  rest,
  type Pitch,
  type Score,
  type VoiceItem,
} from "@/model";
import type { Cursor } from "@/input/types";
import {
  addNoteToEvent,
  appendMeasure,
  canWrite,
  eraseEvent,
  removeNoteFromEvent,
  setNoteAlter,
  transposeNotes,
  writeEvent,
  WriteRefused,
} from "@/commands/edit";
import { decomposeDuration, restsFor } from "@/commands/rhythm";
import { transposeSemitone } from "@/commands/transpose";

function cursorAt(measureIndex: number, offset = frac(0)): Cursor {
  return { partIndex: 0, measureIndex, staffIndex: 0, voiceIndex: 0, offset };
}

/** Narrows a VoiceItem to a NoteEvent/RestEvent for assertions; fails loudly on a tuplet. */
function asEvent(item: VoiceItem) {
  if (item.kind === "tuplet") throw new Error("expected a note/rest event, got a tuplet");
  return item;
}

/** Narrows a VoiceItem to a RestEvent for assertions. */
function asRest(item: VoiceItem) {
  if (item.kind !== "rest") throw new Error("expected a rest event");
  return item;
}

function voiceOf(score: Score, measureIndex: number, staffIndex = 0) {
  return score.parts[0]!.measures[measureIndex]!.staves[staffIndex]!.voices[0]!;
}

describe("decomposeDuration", () => {
  it("1/4 -> a single plain quarter", () => {
    expect(decomposeDuration(frac(1, 4))).toEqual([{ base: 4, dots: 0 }]);
  });

  it("3/8 -> a single dotted quarter (collapses two plain values into one dotted one)", () => {
    expect(decomposeDuration(frac(3, 8))).toEqual([{ base: 4, dots: 1 }]);
  });

  it("5/16 -> quarter + sixteenth (no single dotted value equals 5/16)", () => {
    expect(decomposeDuration(frac(5, 16))).toEqual([
      { base: 4, dots: 0 },
      { base: 16, dots: 0 },
    ]);
  });

  it("7/8 -> half + quarter + eighth (dotted-half + eighth would still be two values, so plain wins)", () => {
    expect(decomposeDuration(frac(7, 8))).toEqual([
      { base: 2, dots: 0 },
      { base: 4, dots: 0 },
      { base: 8, dots: 0 },
    ]);
  });

  it("1/1 -> a single whole note", () => {
    expect(decomposeDuration(frac(1, 1))).toEqual([{ base: 1, dots: 0 }]);
  });

  it("1/32 -> a single 32nd", () => {
    expect(decomposeDuration(frac(1, 32))).toEqual([{ base: 32, dots: 0 }]);
  });

  it("1/3 is not representable in any note values and throws", () => {
    expect(() => decomposeDuration(frac(1, 3))).toThrow();
  });
});

describe("restsFor", () => {
  it("builds one RestEvent per decomposed piece, each with a fresh id", () => {
    const rests = restsFor(frac(7, 8));
    expect(rests.map((r) => r.duration)).toEqual([
      { base: 2, dots: 0 },
      { base: 4, dots: 0 },
      { base: 8, dots: 0 },
    ]);
    expect(rests.every((r) => r.kind === "rest")).toBe(true);
    expect(new Set(rests.map((r) => r.id)).size).toBe(3);
  });

  it("a dotted-collapsible length produces a single dotted rest", () => {
    const rests = restsFor(frac(3, 8));
    expect(rests).toHaveLength(1);
    expect(rests[0]!.duration).toEqual({ base: 4, dots: 1 });
  });
});

describe("writeEvent", () => {
  it("writing into a fresh (measureRest) voice fills the remainder of the measure with rests", () => {
    const score = newPianoScore({ measureCount: 1 }); // 4/4
    const cmd = writeEvent(cursorAt(0), note("C4", 4));

    const next = produce(score, (d) => cmd.apply(d));

    const items = voiceOf(next, 0).items;
    expect(items).toHaveLength(2);
    expect(items[0]!.kind).toBe("note");
    expect(asEvent(items[0]!).duration).toEqual({ base: 4, dots: 0 });
    // remainder is 3/4, which decomposeDuration collapses to a single dotted-half rest
    expect(items[1]!.kind).toBe("rest");
    expect(asEvent(items[1]!).duration).toEqual({ base: 2, dots: 1 });
  });

  it("a quarter written over the first half of a half note leaves a quarter rest for its remainder", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    voice.items = [note("C4", 2), note("D4", 2)]; // 1/2 + 1/2 = 4/4

    const next = produce(score, (d) => writeEvent(cursorAt(0), note("E4", 4)).apply(d));

    const items = voiceOf(next, 0).items;
    expect(items).toHaveLength(3);
    expect(items[0]!.kind).toBe("note");
    expect(asEvent(items[0]!).duration).toEqual({ base: 4, dots: 0 });
    if (items[0]!.kind !== "note") throw new Error("expected a note");
    expect(items[0]!.notes[0]!.pitch.step).toBe("E");
    expect(items[1]!.kind).toBe("rest");
    expect(asEvent(items[1]!).duration).toEqual({ base: 4, dots: 0 }); // remainder of the overwritten half note
    if (items[2]!.kind !== "note") throw new Error("expected the untouched D4 half note");
    expect(items[2]!.notes[0]!.pitch.step).toBe("D"); // untouched, after the span
  });

  it("an eighth written mid-rest splits it into a prefix rest and a suffix rest around the new eighth", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    voice.items = [rest(4), rest(4), rest(2)]; // 1/4 + 1/4 + 1/2 = 1

    const next = produce(score, (d) => writeEvent(cursorAt(0, frac(1, 8)), note("C4", 8)).apply(d));

    const items = voiceOf(next, 0).items.map((i) => ({ kind: i.kind, duration: asEvent(i).duration }));
    expect(items).toEqual([
      { kind: "rest", duration: { base: 8, dots: 0 } }, // prefix of the first quarter rest
      { kind: "note", duration: { base: 8, dots: 0 } }, // the written eighth
      { kind: "rest", duration: { base: 4, dots: 0 } }, // untouched
      { kind: "rest", duration: { base: 2, dots: 0 } }, // untouched
    ]);
  });

  it("writing into the tail of a note keeps its prefix as the same shortened note when the prefix is a single value", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    const quarterNote = note("C4", 4);
    voice.items = [quarterNote, rest(4), rest(2)];

    const next = produce(score, (d) => writeEvent(cursorAt(0, frac(1, 8)), note("D4", 8)).apply(d));

    const items = voiceOf(next, 0).items;
    expect(items[0]!.kind).toBe("note");
    expect(items[0]!.id).toBe(quarterNote.id); // same note identity, just shortened
    expect(asEvent(items[0]!).duration).toEqual({ base: 8, dots: 0 });
    if (items[0]!.kind !== "note" || items[1]!.kind !== "note") throw new Error("expected notes");
    expect(items[0]!.notes[0]!.pitch.step).toBe("C");
    expect(items[1]!.notes[0]!.pitch.step).toBe("D");
  });

  it("refuses (canWrite reports, writeEvent throws WriteRefused) a write that would cross the barline", () => {
    const score = newPianoScore({ measureCount: 1 }); // 4/4
    const voice = voiceOf(score, 0);
    voice.items = [note("C4", 4), note("D4", 2), rest(4)]; // 1/4 + 1/2 + 1/4 = 1

    const cursor = cursorAt(0, frac(3, 4));
    const halfLen = notatedToFraction(notated(2));
    expect(canWrite(score, cursor, halfLen)).toMatch(/does not fit/i);
    expect(() => produce(score, (d) => writeEvent(cursor, note("E4", 2)).apply(d))).toThrow(WriteRefused);
  });

  it("refuses to write into a span that intersects a tuplet", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    const n1 = note("C4", 8);
    const n2 = note("D4", 8);
    const n3 = note("E4", 8);
    voice.items = [
      { kind: "tuplet", id: "tup", ratio: { actual: 3, normal: 2, unit: 8 }, items: [n1, n2, n3] }, // sounds 1/4
      rest(2), // 1/2
      rest(4), // 1/4
    ];

    const cursor = cursorAt(0, frac(0));
    const len = notatedToFraction(notated(8));
    expect(canWrite(score, cursor, len)).toMatch(/tuplet/i);
    expect(() => produce(score, (d) => writeEvent(cursor, note("F4", 8)).apply(d))).toThrow(WriteRefused);
  });
});

describe("eraseEvent", () => {
  it("replaces the event with rests and normalizes an all-rest voice to a single measureRest", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    const c = note("C4", 4);
    voice.items = [c, rest(4), rest(2)];

    const next = produce(score, (d) => eraseEvent(c.id).apply(d));

    const items = voiceOf(next, 0).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("rest");
    expect(asRest(items[0]!).measureRest).toBe(true);
  });

  it("does not normalize when the voice still holds a note", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    const c = note("C4", 4);
    const d = note("D4", 4);
    voice.items = [c, d, rest(2)];

    const next = produce(score, (draft) => eraseEvent(c.id).apply(draft));

    const items = voiceOf(next, 0).items;
    expect(items).toHaveLength(3);
    expect(items[0]!.kind).toBe("rest");
    expect(asRest(items[0]!).measureRest).toBeUndefined();
  });
});

describe("chord editing", () => {
  it("addNoteToEvent keeps notes sorted ascending and ignores an exact-duplicate pitch", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    const ev = note("E4", 4);
    voice.items = [ev, rest(4), rest(2)];

    const withG = produce(score, (d) => addNoteToEvent(ev.id, { step: "G", alter: 0, octave: 4 }).apply(d));
    const withC = produce(withG, (d) => addNoteToEvent(ev.id, { step: "C", alter: 0, octave: 4 }).apply(d));
    const chordEvent = voiceOf(withC, 0).items[0]!;
    if (chordEvent.kind !== "note") throw new Error("expected a note event");
    expect(chordEvent.notes.map((n) => `${n.pitch.step}${n.pitch.octave}`)).toEqual(["C4", "E4", "G4"]);

    const dup = produce(withC, (d) => addNoteToEvent(ev.id, { step: "C", alter: 0, octave: 4 }).apply(d));
    const dupEvent = voiceOf(dup, 0).items[0]!;
    if (dupEvent.kind !== "note") throw new Error("expected a note event");
    expect(dupEvent.notes).toHaveLength(3); // duplicate pitch ignored
  });

  it("removeNoteFromEvent erases the event to rests once the last note is removed", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    const ev = note("C4", 4);
    voice.items = [ev, rest(4), rest(2)];
    const noteId = ev.notes[0]!.id;

    const next = produce(score, (d) => removeNoteFromEvent(ev.id, noteId).apply(d));

    expect(voiceOf(next, 0).items[0]!.kind).toBe("rest");
  });

  it("removeNoteFromEvent just drops the note when others remain in the chord", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    const ev = chord(["C4", "E4"], 4);
    voice.items = [ev, rest(4), rest(2)];
    const cId = ev.notes[0]!.id;

    const next = produce(score, (d) => removeNoteFromEvent(ev.id, cId).apply(d));

    const updated = voiceOf(next, 0).items[0]!;
    if (updated.kind !== "note") throw new Error("expected a note event");
    expect(updated.notes.map((n) => n.pitch.step)).toEqual(["E"]);
  });

  it("setNoteAlter changes a note's alteration and re-sorts the chord if that changes sounding order", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    const ev = chord(["C4", "Db4"], 4); // Db4 (midi 61) sounds above C4 (midi 60)
    voice.items = [ev, rest(4), rest(2)];
    const cId = ev.notes[0]!.id; // C4

    const next = produce(score, (d) => setNoteAlter(cId, 2).apply(d)); // C4 -> Cx4 (midi 62), now above Db4

    const notes = voiceOf(next, 0).items[0]!;
    if (notes.kind !== "note") throw new Error("expected a note event");
    expect(notes.notes.map((n) => n.pitch)).toEqual([
      { step: "D", alter: -1, octave: 4 },
      { step: "C", alter: 2, octave: 4 },
    ]);
  });
});

describe("transposeSemitone", () => {
  it("walks up the chromatic scale MuseScore-style (sharps, naturals at E-F and B-C)", () => {
    let p: Pitch = { step: "C", alter: 0, octave: 4 };
    const seq: string[] = [];
    for (let i = 0; i < 7; i++) {
      p = transposeSemitone(p, 1);
      seq.push(pitchToString(p));
    }
    expect(seq).toEqual(["C#4", "D4", "D#4", "E4", "F4", "F#4", "G4"]);
  });

  it("walks back down with flats (mirrors the up sequence, naturals at B-C and E-F), crossing an octave at C->B", () => {
    let p: Pitch = { step: "G", alter: 0, octave: 4 };
    const seq: string[] = [];
    for (let i = 0; i < 8; i++) {
      p = transposeSemitone(p, -1);
      seq.push(pitchToString(p));
    }
    expect(seq).toEqual(["Gb4", "F4", "E4", "Eb4", "D4", "Db4", "C4", "B3"]);
  });
});

describe("transposeNotes", () => {
  it("moves the given notes by semitones or by octaves", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    const ev = note("C4", 4);
    voice.items = [ev, rest(4), rest(2)];
    const noteId = ev.notes[0]!.id;

    const up = produce(score, (d) => transposeNotes([noteId], { semitones: 1 }).apply(d));
    const upEv = voiceOf(up, 0).items[0]!;
    if (upEv.kind !== "note") throw new Error("expected a note event");
    expect(upEv.notes[0]!.pitch).toEqual({ step: "C", alter: 1, octave: 4 });

    const upOctave = produce(score, (d) => transposeNotes([noteId], { octaves: 1 }).apply(d));
    const upOctEv = voiceOf(upOctave, 0).items[0]!;
    if (upOctEv.kind !== "note") throw new Error("expected a note event");
    expect(upOctEv.notes[0]!.pitch).toEqual({ step: "C", alter: 0, octave: 5 });
  });
});

describe("appendMeasure", () => {
  it("adds a single empty measure at the end", () => {
    const score = newPianoScore({ measureCount: 2 });

    const next = produce(score, (d) => appendMeasure().apply(d));

    expect(next.measures).toHaveLength(3);
    expect(next.parts[0]!.measures).toHaveLength(3);
  });
});
