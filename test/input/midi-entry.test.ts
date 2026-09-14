import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { newPianoScore, pitchToString, type Score } from "@/model";
import type { KeySignature } from "@/model/pitch";
import { defaultEditorState } from "@/input/step-entry";
import { handleMidiNote, spellMidi } from "@/input/midi-entry";
import type { EditorState, EntryState, KeyResult, MidiNoteOn } from "@/input/types";

describe("spellMidi", () => {
  const dMajor: KeySignature = { fifths: 2, mode: "major" };
  const fMajor: KeySignature = { fifths: -1, mode: "major" };
  const cMajor: KeySignature = { fifths: 0, mode: "major" };
  const ebMajor: KeySignature = { fifths: -3, mode: "major" };

  it("in D major, 61 spells C#4 (the key signature's own sharp)", () => {
    expect(pitchToString(spellMidi(61, dMajor))).toBe("C#4");
  });

  it("in F major, 70 spells Bb4 (the key signature's own flat)", () => {
    expect(pitchToString(spellMidi(70, fMajor))).toBe("Bb4");
  });

  it("in C major, 61 spells C#4 (no natural spelling exists; sharp tie-break for C major)", () => {
    expect(pitchToString(spellMidi(61, cMajor))).toBe("C#4");
  });

  it("in Eb major, 68 spells Ab4 (the key signature's own flat)", () => {
    expect(pitchToString(spellMidi(68, ebMajor))).toBe("Ab4");
  });

  it("60 spells C4 in any key (a natural pitch class)", () => {
    const keys: KeySignature[] = [
      dMajor,
      fMajor,
      cMajor,
      ebMajor,
      { fifths: 4, mode: "major" },
      { fifths: -5, mode: "minor" },
      { fifths: 6, mode: "major" },
    ];
    for (const key of keys) expect(pitchToString(spellMidi(60, key))).toBe("C4");
  });

  it("falls back to a flat spelling for a black key in a flat key signature with no matching accidental", () => {
    // F major only flats B; a C#/Db (pc 1) matches neither the key signature nor a
    // natural step, so the flat-key tie-break applies (not "sharp in C major").
    expect(pitchToString(spellMidi(61, fMajor))).toBe("Db4");
  });
});

/** Minimal store stand-in driving `handleMidiNote`, mirroring the harnesses in the other input tests. */
class Harness {
  score: Score;
  cursor: EditorState["cursor"];
  selection: EditorState["selection"];
  entry: EntryState;

  constructor(score: Score) {
    const initial = defaultEditorState(score);
    this.score = initial.score;
    this.cursor = initial.cursor;
    this.selection = initial.selection;
    this.entry = initial.entry;
  }

  private state(): EditorState {
    return { score: this.score, cursor: this.cursor, selection: this.selection, entry: this.entry, clipboard: null };
  }

  playNote(note: number, held: number[] = []): KeyResult | null {
    const ev: MidiNoteOn = { note, velocity: 100, held };
    const result = handleMidiNote(this.state(), ev);
    if (result === null) return null;
    if (result.commands.length > 0) {
      this.score = produce(this.score, (draft) => {
        for (const cmd of result.commands) cmd.apply(draft);
      });
    }
    if (result.cursor) this.cursor = result.cursor;
    if (result.selection) this.selection = result.selection;
    if (result.entry) this.entry = result.entry;
    return result;
  }

  voiceItems(measureIndex = 0, staffIndex = 0) {
    return this.score.parts[0]!.measures[measureIndex]!.staves[staffIndex]!.voices[0]!.items;
  }
}

describe("handleMidiNote", () => {
  it("returns null when note entry is not active", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    expect(h.playNote(60)).toBeNull();
  });

  it("writes a NoteEvent of the current entry duration and advances the cursor, like a typed letter", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.entry = { ...h.entry, active: true, base: 4 };
    const cursorBefore = h.cursor;

    h.playNote(60);

    expect(h.cursor).not.toEqual(cursorBefore);
    const item = h.voiceItems(0)[0]!;
    if (item.kind !== "note") throw new Error("expected a note event");
    expect(pitchToString(item.notes[0]!.pitch)).toBe("C4");
  });

  it("three notes played sequentially (never held) become three separate NoteEvents", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.entry = { ...h.entry, active: true, base: 4 };

    h.playNote(60); // C4, held: []
    h.playNote(62); // D4, held: []
    h.playNote(64); // E4, held: []

    const items = h.voiceItems(0);
    expect(items.slice(0, 3).map((i) => i.kind)).toEqual(["note", "note", "note"]);
    const spelled = items.slice(0, 3).map((i) => {
      if (i.kind !== "note") throw new Error("expected a note event");
      return pitchToString(i.notes[0]!.pitch);
    });
    expect(spelled).toEqual(["C4", "D4", "E4"]);
  });

  it("a C-E-G chord played with holds becomes one chord event", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.entry = { ...h.entry, active: true, base: 4 };

    h.playNote(60, []); // C: nothing held yet, writes+advances
    const cursorAfterFirst = h.cursor;
    h.playNote(64, [60]); // E: C is held -> added to the chord, cursor doesn't move
    h.playNote(67, [60, 64]); // G: C+E held -> added to the chord

    expect(h.cursor).toEqual(cursorAfterFirst);
    const item = h.voiceItems(0)[0]!;
    if (item.kind !== "note") throw new Error("expected a note event");
    expect(item.notes.map((n) => pitchToString(n.pitch))).toEqual(["C4", "E4", "G4"]);
    // only one event was written (the rest of the measure stays rests)
    expect(h.voiceItems(0)[1]!.kind).toBe("rest");
  });

  it("adding to a chord with nothing before the cursor reports a message instead of throwing", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.entry = { ...h.entry, active: true, base: 4 };

    const result = h.playNote(64, [60]); // held, but nothing has been written yet

    expect(result?.commands).toEqual([]);
    expect(result?.message).toMatch(/no chord/i);
  });

  it("spells notes using the key signature in effect at the cursor's measure", () => {
    const score = newPianoScore({ measureCount: 1, keySig: { fifths: 2, mode: "major" } }); // D major
    const h = new Harness(score);
    h.entry = { ...h.entry, active: true, base: 4 };

    h.playNote(61); // C#4 in D major

    const item = h.voiceItems(0)[0]!;
    if (item.kind !== "note") throw new Error("expected a note event");
    expect(pitchToString(item.notes[0]!.pitch)).toBe("C#4");
  });
});
