import { describe, expect, it } from "vitest";
import { frac, newPianoScore, note, rest, type Score, type VoiceItem } from "@/model";
import { History } from "@/commands/history";
import { defaultEditorState, handleKey } from "@/input/step-entry";
import type { ClipboardContent, Cursor, EditorState, EntryState, KeyResult, KeyStroke, Selection } from "@/input/types";

/** Narrows a VoiceItem to a RestEvent for assertions. */
function asRest(item: VoiceItem) {
  if (item.kind !== "rest") throw new Error("expected a rest event");
  return item;
}

/**
 * A tiny stand-in for the real store (src/ui): applies `KeyResult.commands` through
 * `History`, then adopts cursor/selection/entry, exactly as ARCHITECTURE.md describes.
 */
class Harness {
  history: History;
  cursor: Cursor;
  selection: Selection;
  entry: EntryState;
  clipboard: ClipboardContent | null;

  constructor(score: Score) {
    const initial = defaultEditorState(score);
    this.history = new History(score);
    this.cursor = initial.cursor;
    this.selection = initial.selection;
    this.entry = initial.entry;
    this.clipboard = initial.clipboard;
  }

  private state(): EditorState {
    return { score: this.history.current, cursor: this.cursor, selection: this.selection, entry: this.entry, clipboard: this.clipboard };
  }

  press(partial: Partial<KeyStroke> & { key: string }): KeyResult | null {
    const stroke: KeyStroke = { key: partial.key, shift: partial.shift ?? false, mod: partial.mod ?? false, alt: partial.alt ?? false };
    const result = handleKey(this.state(), stroke);
    if (result === null) return null;
    for (const cmd of result.commands) this.history.execute(cmd);
    if (result.history === "undo") this.history.undo();
    if (result.history === "redo") this.history.redo();
    if (result.cursor) this.cursor = result.cursor;
    if (result.selection) this.selection = result.selection;
    if (result.entry) this.entry = result.entry;
    if (result.clipboard !== undefined) this.clipboard = result.clipboard;
    return result;
  }

  voiceItems(measureIndex = 0, staffIndex = 0) {
    return this.history.current.parts[0]!.measures[measureIndex]!.staves[staffIndex]!.voices[0]!.items;
  }
}

describe("handleKey: note entry", () => {
  it('"n 5 c d e f" fills a 4/4 measure with quarters and advances into the next measure', () => {
    const h = new Harness(newPianoScore({ measureCount: 2 }));
    h.press({ key: "n" });
    expect(h.entry.active).toBe(true);
    h.press({ key: "5" }); // quarter
    h.press({ key: "c" });
    h.press({ key: "d" });
    h.press({ key: "e" });
    h.press({ key: "f" });

    expect(h.cursor).toEqual({ partIndex: 0, measureIndex: 1, staffIndex: 0, voiceIndex: 0, offset: frac(0) });

    const items = h.voiceItems(0);
    expect(items).toHaveLength(4);
    const spelled = items.map((it) => {
      if (it.kind !== "note") throw new Error("expected a note event");
      return `${it.notes[0]!.pitch.step}${it.notes[0]!.pitch.octave}`;
    });
    expect(spelled).toEqual(["C4", "D4", "E4", "F4"]);
  });

  it('"n 4 c", "6 d", "6 e" refuses the third write (doesn\'t fit the measure) with a message, leaving the score untouched', () => {
    const h = new Harness(newPianoScore({ measureCount: 1 })); // 4/4
    h.press({ key: "n" });
    h.press({ key: "4" }); // eighth
    h.press({ key: "c" }); // 1/8 used; writing into the sole measureRest immediately re-expresses
    // the remaining 7/8 as rests (half + quarter + eighth: 7/8 has no single-dot form)
    h.press({ key: "6" }); // half
    h.press({ key: "d" }); // overwrites the half-rest piece exactly: 1/8 + 1/2 = 5/8 used
    h.press({ key: "6" }); // half again
    const result = h.press({ key: "e" }); // would bring it to 9/8: refused

    expect(result?.commands).toEqual([]);
    expect(result?.message).toMatch(/does not fit/i);
    // eighth C4, half D4, and the untouched quarter-rest + eighth-rest tail from the first write
    expect(h.voiceItems(0).map((it) => it.kind)).toEqual(["note", "note", "rest", "rest"]);
  });

  it("nearest-octave rule: from a C4 reference, typing g lands on G3 (distance 3 beats G4's distance 4)", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.press({ key: "n" });
    h.press({ key: "5" });
    h.press({ key: "c" }); // reference is now C4
    h.press({ key: "g" });

    const ev = h.voiceItems(0)[1]!;
    if (ev.kind !== "note") throw new Error("expected a note event");
    // MuseScore-users might expect G4 (a 5th up); the specified diatonic-distance rule
    // strictly prefers G3 (|25-28|=3) over G4 (|32-28|=4), so that's what we assert.
    expect(ev.notes[0]!.pitch).toEqual({ step: "G", alter: 0, octave: 3 });
  });

  it("nearest-octave rule: from a C4 reference, typing b lands on B3", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.press({ key: "n" });
    h.press({ key: "5" });
    h.press({ key: "c" });
    h.press({ key: "b" });

    const ev = h.voiceItems(0)[1]!;
    if (ev.kind !== "note") throw new Error("expected a note event");
    expect(ev.notes[0]!.pitch).toEqual({ step: "B", alter: 0, octave: 3 });
  });

  it("Shift+letter adds a note to the chord before the cursor without moving the cursor", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.press({ key: "n" });
    h.press({ key: "5" });
    h.press({ key: "c" });
    const cursorBefore = h.cursor;

    h.press({ key: "e", shift: true });

    expect(h.cursor).toEqual(cursorBefore);
    const ev = h.voiceItems(0)[0]!;
    if (ev.kind !== "note") throw new Error("expected a note event");
    expect(ev.notes.map((n) => `${n.pitch.step}${n.pitch.octave}`)).toEqual(["C4", "E4"]);
  });

  it("Shift+letter with a rest (or nothing) before the cursor does nothing but report a message", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.press({ key: "n" });
    const result = h.press({ key: "c", shift: true }); // cursor is at the very start; nothing before it

    expect(result?.commands).toEqual([]);
    expect(result?.message).toBeTruthy();
    expect(h.voiceItems(0)).toHaveLength(1);
    expect(h.voiceItems(0)[0]!.kind).toBe("rest");
  });

  it('"0" enters a rest of the current duration and advances the cursor', () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.press({ key: "n" });
    h.press({ key: "5" }); // quarter
    h.press({ key: "c" }); // quarter C4 at offset 0; cursor -> 1/4
    h.press({ key: "0" }); // quarter rest at offset 1/4; cursor -> 1/2

    expect(h.cursor.offset).toEqual(frac(1, 2));
    const items = h.voiceItems(0);
    expect(items[0]!.kind).toBe("note");
    expect(items[1]!.kind).toBe("rest");
    expect(asRest(items[1]!).duration).toEqual({ base: 4, dots: 0 });
    expect(asRest(items[1]!).measureRest).toBeUndefined();
  });

  it('"0" in an otherwise-empty measure still normalizes back to a single measureRest (an all-rest voice always collapses)', () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.press({ key: "n" });
    h.press({ key: "5" });
    h.press({ key: "0" }); // quarter rest at offset 0; the other 3/4 is also rests

    expect(h.cursor.offset).toEqual(frac(1, 4));
    const items = h.voiceItems(0);
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("rest");
    expect(asRest(items[0]!).measureRest).toBe(true);
  });

  it("integration: writing through step-entry follows the writeEvent span-replace rules", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    voice.items = [note("C4", 2), note("D4", 2)]; // two half notes filling 4/4
    const h = new Harness(score);
    h.entry = { ...h.entry, active: true, base: 4 }; // quarter, entry mode on, cursor at offset 0

    h.press({ key: "e" }); // overwrites the first half of the first half note

    const items = h.voiceItems(0);
    expect(items).toHaveLength(3);
    expect(items[0]!.kind).toBe("note");
    expect(items[1]!.kind).toBe("rest");
    expect(asRest(items[1]!).duration).toEqual({ base: 4, dots: 0 }); // remainder of the overwritten half note
    expect(items[2]!.kind).toBe("note"); // untouched D4 half note
  });

  it("key-signature-aware letter entry: in D major, typing f enters F#", () => {
    const score = newPianoScore({ measureCount: 1, keySig: { fifths: 2, mode: "major" } }); // D major: F#, C#
    const h = new Harness(score);
    h.press({ key: "n" });
    h.press({ key: "5" });
    h.press({ key: "f" });

    const ev = h.voiceItems(0)[0]!;
    if (ev.kind !== "note") throw new Error("expected a note event");
    expect(ev.notes[0]!.pitch).toEqual({ step: "F", alter: 1, octave: 4 });
  });

  it('"+" sets a pending sharp for the next letter and is cleared after use; with a note selected it applies immediately', () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.press({ key: "n" });
    h.press({ key: "5" });
    h.press({ key: "+" });
    expect(h.entry.alter).toBe(1);

    h.press({ key: "c" });
    let ev = h.voiceItems(0)[0]!;
    if (ev.kind !== "note") throw new Error("expected a note event");
    expect(ev.notes[0]!.pitch).toEqual({ step: "C", alter: 1, octave: 4 });
    expect(h.entry.alter).toBeNull();

    // the just-entered C# is selected: "-" should apply immediately instead of setting a pending alter
    h.press({ key: "-" });
    ev = h.voiceItems(0)[0]!;
    if (ev.kind !== "note") throw new Error("expected a note event");
    expect(ev.notes[0]!.pitch.alter).toBe(-1);
    expect(h.entry.alter).toBeNull();
  });
});

describe("handleKey: erase", () => {
  it("Backspace erases the note before the cursor to a rest, and normalizes an all-rest measure to a measureRest", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.press({ key: "n" });
    h.press({ key: "5" });
    h.press({ key: "c" });
    expect(h.cursor.offset).toEqual(frac(1, 4));

    h.press({ key: "Backspace" });

    expect(h.cursor.offset).toEqual(frac(0));
    const items = h.voiceItems(0);
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("rest");
    expect(asRest(items[0]!).measureRest).toBe(true);
  });

  it("Delete erases the event at the cursor without moving the cursor", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    voice.items = [note("C4", 4), rest(4), rest(2)];
    const h = new Harness(score);
    h.entry = { ...h.entry, active: true };
    const cursorBefore = h.cursor;

    h.press({ key: "Delete" });

    expect(h.cursor).toEqual(cursorBefore);
    expect(h.voiceItems(0)[0]!.kind).toBe("rest");
  });
});

describe("handleKey: ties and transposition", () => {
  it('"t" toggles a tie on the note before the cursor', () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.press({ key: "n" });
    h.press({ key: "5" });
    h.press({ key: "c" });

    h.press({ key: "t" });
    let ev = h.voiceItems(0)[0]!;
    if (ev.kind !== "note") throw new Error("expected a note event");
    expect(ev.notes[0]!.tieStart).toBe(true);

    h.press({ key: "t" });
    ev = h.voiceItems(0)[0]!;
    if (ev.kind !== "note") throw new Error("expected a note event");
    expect(ev.notes[0]!.tieStart).toBe(false);
  });

  it("ArrowUp/ArrowDown transpose the note before the cursor by a semitone, Shift by an octave", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.press({ key: "n" });
    h.press({ key: "5" });
    h.press({ key: "c" });

    h.press({ key: "ArrowUp" });
    let ev = h.voiceItems(0)[0]!;
    if (ev.kind !== "note") throw new Error("expected a note event");
    expect(ev.notes[0]!.pitch).toEqual({ step: "C", alter: 1, octave: 4 });

    h.press({ key: "ArrowDown", shift: true });
    ev = h.voiceItems(0)[0]!;
    if (ev.kind !== "note") throw new Error("expected a note event");
    expect(ev.notes[0]!.pitch).toEqual({ step: "C", alter: 1, octave: 3 });
  });
});

describe("handleKey: cursor navigation", () => {
  it("ArrowRight/ArrowLeft move across events and measures; Home/End jump within a measure; mod+Arrow jumps measures", () => {
    const score = newPianoScore({ measureCount: 2 });
    const voice0 = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    voice0.items = [note("C4", 4), note("D4", 4), rest(2)]; // 1/4 + 1/4 + 1/2
    const h = new Harness(score);

    h.press({ key: "ArrowRight" });
    expect(h.cursor).toMatchObject({ measureIndex: 0, offset: frac(1, 4) });
    h.press({ key: "ArrowRight" });
    expect(h.cursor).toMatchObject({ measureIndex: 0, offset: frac(1, 2) });
    h.press({ key: "ArrowRight" }); // no more events in measure 0: crosses into measure 1
    expect(h.cursor).toMatchObject({ measureIndex: 1, offset: frac(0) });

    h.press({ key: "ArrowLeft" }); // back to measure 0's last event
    expect(h.cursor).toMatchObject({ measureIndex: 0, offset: frac(1, 2) });

    h.press({ key: "Home" });
    expect(h.cursor.offset).toEqual(frac(0));
    h.press({ key: "End" });
    expect(h.cursor.offset).toEqual(frac(1, 2));

    h.press({ key: "ArrowRight", mod: true });
    expect(h.cursor).toMatchObject({ measureIndex: 1, offset: frac(0) });
    h.press({ key: "ArrowLeft", mod: true });
    expect(h.cursor).toMatchObject({ measureIndex: 0, offset: frac(0) });
    // stops (doesn't wrap) at the score's start
    h.press({ key: "ArrowLeft", mod: true });
    expect(h.cursor).toMatchObject({ measureIndex: 0, offset: frac(0) });
  });

  it("Tab toggles staffIndex between 0 and 1, keeping measure/offset", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.press({ key: "Tab" });
    expect(h.cursor).toMatchObject({ staffIndex: 1, measureIndex: 0, offset: frac(0) });
    h.press({ key: "Tab" });
    expect(h.cursor.staffIndex).toBe(0);
  });

  it("Escape turns off entry mode and clears the selection", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.press({ key: "n" });
    h.press({ key: "5" });
    h.press({ key: "c" });
    expect(h.selection.ids).toHaveLength(1);

    h.press({ key: "Escape" });

    expect(h.entry.active).toBe(false);
    expect(h.selection.ids).toEqual([]);
  });
});

describe("handleKey: undo/redo", () => {
  it("mod+z undoes and mod+shift+Z redoes the last write", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    h.press({ key: "n" });
    h.press({ key: "5" });
    h.press({ key: "c" });
    expect(h.voiceItems(0)[0]!.kind).toBe("note");

    h.press({ key: "z", mod: true });
    expect(h.voiceItems(0)).toHaveLength(1);
    expect(h.voiceItems(0)[0]!.kind).toBe("rest");
    expect(asRest(h.voiceItems(0)[0]!).measureRest).toBe(true);

    h.press({ key: "Z", mod: true, shift: true });
    expect(h.voiceItems(0)[0]!.kind).toBe("note");
  });
});

describe("handleKey: unhandled keys", () => {
  it("returns null for a letter outside a-g, and for keys with no effect when entry is inactive", () => {
    const h = new Harness(newPianoScore({ measureCount: 1 }));
    expect(h.press({ key: "z" })).toBeNull(); // no mod: not undo, not in a-g
    expect(h.press({ key: "5" })).toBeNull(); // entry not active: digit is unhandled
    expect(h.press({ key: "c" })).toBeNull(); // entry not active: letter is unhandled
  });
});
