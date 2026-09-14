import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { frac, newPianoScore, note, rest, type Score } from "@/model";
import { defaultEditorState, handleKey } from "@/input/step-entry";
import type { Cursor, EditorState, EntryState, KeyResult, KeyStroke, Selection } from "@/input/types";

/**
 * Minimal store stand-in (like test/input/step-entry.test.ts's Harness, but applying
 * commands directly with immer instead of through History — undo/redo isn't exercised
 * by these tests).
 */
class Harness {
  score: Score;
  cursor: Cursor;
  selection: Selection;
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

  press(partial: Partial<KeyStroke> & { key: string }): KeyResult | null {
    const stroke: KeyStroke = { key: partial.key, shift: partial.shift ?? false, mod: partial.mod ?? false, alt: partial.alt ?? false };
    const result = handleKey(this.state(), stroke);
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

/** A harness with three quarter notes (C4 D4 E4) filling measure 0's treble voice. */
function threeNoteHarness(measureCount = 1) {
  const score = newPianoScore({ measureCount });
  const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
  const c = note("C4", 4);
  const d = note("D4", 4);
  const e = note("E4", 4);
  voice.items = [c, d, e, rest(4)];
  return { h: new Harness(score), c, d, e };
}

describe("lyric entry: entering the mode", () => {
  it('"l" enters lyric mode on the selected NoteEvent, verse 0, and selection follows it', () => {
    const { h, c } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };

    const result = h.press({ key: "l" });

    expect(result).not.toBeNull();
    expect(h.entry.lyric).toEqual({ eventId: c.id, verse: 0 });
    expect(h.selection.ids).toEqual([c.notes[0]!.id]);
  });

  it('"l" with nothing selected uses the event before the cursor', () => {
    const { h, c } = threeNoteHarness();
    h.cursor = { ...h.cursor, offset: frac(1, 4) }; // right after C4
    h.selection = { ids: [] };

    h.press({ key: "l" });

    expect(h.entry.lyric).toEqual({ eventId: c.id, verse: 0 });
  });

  it('"l" with no selection and no event before the cursor is unhandled', () => {
    const { h } = threeNoteHarness();
    h.selection = { ids: [] };
    // cursor stays at offset 0: nothing before it

    expect(h.press({ key: "l" })).toBeNull();
  });

  it("mod+L does the same as plain l", () => {
    const { h, c } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };

    h.press({ key: "l", mod: true });

    expect(h.entry.lyric).toEqual({ eventId: c.id, verse: 0 });
  });

  it("mod+shift+L enters verse 1 when not already in lyric mode", () => {
    const { h, c } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };

    h.press({ key: "l", mod: true, shift: true });

    expect(h.entry.lyric).toEqual({ eventId: c.id, verse: 1 });
  });

  it("mod+shift+L while already in lyric mode moves to verse+1 on the same event", () => {
    const { h, c } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" }); // verse 0
    h.press({ key: "a" });
    h.press({ key: "h" });

    h.press({ key: "l", mod: true, shift: true });

    expect(h.entry.lyric).toEqual({ eventId: c.id, verse: 1 });
    // verse 0's lyric is untouched
    const item = h.voiceItems(0)[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics!.find((ly) => ly.verse === 0)!.text).toBe("ah");
  });
});

describe("lyric entry: typing", () => {
  it("printable characters append to the syllable via setLyric, defaulting syllabic to single", () => {
    const { h, c } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" });

    h.press({ key: "H" });
    h.press({ key: "i" });
    h.press({ key: "!" });

    const item = h.voiceItems(0)[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics).toEqual([{ verse: 0, text: "Hi!", syllabic: "single" }]);
  });

  it("digits and accented-style characters (single-char keys) are appended too", () => {
    const { h, c } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" });

    h.press({ key: "é" });
    h.press({ key: "5" });

    const item = h.voiceItems(0)[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics![0]!.text).toBe("é5");
  });

  it("an accented character reported with alt still held (Mac dead-key composition) is appended, not swallowed as a shortcut", () => {
    const { h, c } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" });

    h.press({ key: "ñ", alt: true });

    const item = h.voiceItems(0)[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics![0]!.text).toBe("ñ");
  });

  it("Backspace removes the last character, and removes the lyric entirely once empty", () => {
    const { h, c } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" });
    h.press({ key: "H" });
    h.press({ key: "i" });

    h.press({ key: "Backspace" });
    let item = h.voiceItems(0)[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics![0]!.text).toBe("H");

    h.press({ key: "Backspace" });
    item = h.voiceItems(0)[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics).toBeUndefined();
  });

  it("Backspace with no lyric yet is a harmless no-op", () => {
    const { h, c } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" });

    const result = h.press({ key: "Backspace" });

    expect(result?.commands).toEqual([]);
    const item = h.voiceItems(0)[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics).toBeUndefined();
  });
});

describe("lyric entry: Space commits and advances", () => {
  it("Space moves to the next NoteEvent in the voice and updates the selection", () => {
    const { h, c, d } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" });
    h.press({ key: "H" });
    h.press({ key: "i" });

    h.press({ key: " " });

    expect(h.entry.lyric).toEqual({ eventId: d.id, verse: 0 });
    expect(h.selection.ids).toEqual([d.notes[0]!.id]);
  });

  it("Space skips rests in the voice", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const c = note("C4", 4);
    const e = note("E4", 4);
    voice.items = [c, rest(4), e, rest(4)];
    const h = new Harness(score);
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" });

    h.press({ key: " " });

    expect(h.entry.lyric).toEqual({ eventId: e.id, verse: 0 });
  });

  it("Space crosses into the next measure", () => {
    const score = newPianoScore({ measureCount: 2 });
    const v0 = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!;
    const v1 = score.parts[0]!.measures[1]!.staves[0]!.voices[0]!;
    const c = note("C4", 1); // whole note fills measure 0
    const d = note("D4", 1);
    v0.items = [c];
    v1.items = [d];
    const h = new Harness(score);
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" });

    h.press({ key: " " });

    expect(h.entry.lyric).toEqual({ eventId: d.id, verse: 0 });
  });

  it("Space at the last NoteEvent of the score stays put", () => {
    const { h, e } = threeNoteHarness();
    h.selection = { ids: [e.notes[0]!.id] };
    h.press({ key: "l" });

    const result = h.press({ key: " " });

    expect(result).not.toBeNull();
    expect(h.entry.lyric).toEqual({ eventId: e.id, verse: 0 });
    expect(h.selection.ids).toEqual([e.notes[0]!.id]);
  });
});

describe("lyric entry: hyphenation with \"-\"", () => {
  it("spreads a hyphenated word over three notes: begin / middle / end", () => {
    const { h, c, d, e } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" });
    h.press({ key: "b" });
    h.press({ key: "e" });
    h.press({ key: "a" });
    h.press({ key: "u" });
    h.press({ key: "-" }); // commits "beau" as begin, moves to D4

    expect(h.entry.lyric).toEqual({ eventId: d.id, verse: 0 });
    let item = h.voiceItems(0)[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics![0]!).toEqual({ verse: 0, text: "beau", syllabic: "begin" });

    h.press({ key: "t" });
    h.press({ key: "i" });
    // mid-typing, the tentative syllabic is already "end" (chained from a begin/middle predecessor)
    item = h.voiceItems(0)[1]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics![0]!).toEqual({ verse: 0, text: "ti", syllabic: "end" });

    h.press({ key: "-" }); // continuing the chain: "ti" becomes "middle", moves to E4
    expect(h.entry.lyric).toEqual({ eventId: e.id, verse: 0 });
    item = h.voiceItems(0)[1]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics![0]!.syllabic).toBe("middle");

    h.press({ key: "f" });
    h.press({ key: "u" });
    h.press({ key: "l" });
    item = h.voiceItems(0)[2]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics![0]!).toEqual({ verse: 0, text: "ful", syllabic: "end" });
  });

  it('"-" with nothing typed yet just moves on, like Space', () => {
    const { h, c, d } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" });

    h.press({ key: "-" });

    expect(h.entry.lyric).toEqual({ eventId: d.id, verse: 0 });
    const item = h.voiceItems(0)[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics).toBeUndefined();
  });
});

describe('lyric entry: "_" sets extend', () => {
  it("sets extend on the current lyric and moves to the next note", () => {
    const { h, c, d } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" });
    h.press({ key: "a" });
    h.press({ key: "h" });

    h.press({ key: "_" });

    expect(h.entry.lyric).toEqual({ eventId: d.id, verse: 0 });
    const item = h.voiceItems(0)[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics![0]!).toEqual({ verse: 0, text: "ah", syllabic: "single", extend: true });
  });

  it('"_" with nothing typed yet just moves on', () => {
    const { h, c, d } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" });

    h.press({ key: "_" });

    expect(h.entry.lyric).toEqual({ eventId: d.id, verse: 0 });
  });
});

describe("lyric entry: arrows navigate without editing", () => {
  it("ArrowRight/ArrowLeft move between notes without changing text or issuing commands", () => {
    const { h, c, d } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" });
    h.press({ key: "H" });
    h.press({ key: "i" });

    const right = h.press({ key: "ArrowRight" });
    expect(right?.commands).toEqual([]);
    expect(h.entry.lyric).toEqual({ eventId: d.id, verse: 0 });
    expect(h.selection.ids).toEqual([d.notes[0]!.id]);

    const left = h.press({ key: "ArrowLeft" });
    expect(left?.commands).toEqual([]);
    expect(h.entry.lyric).toEqual({ eventId: c.id, verse: 0 });

    // text is untouched by navigation
    const item = h.voiceItems(0)[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics![0]!.text).toBe("Hi");
  });

  it("ArrowLeft at the first note stays put", () => {
    const { h, c } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" });

    const result = h.press({ key: "ArrowLeft" });

    expect(result).not.toBeNull();
    expect(h.entry.lyric).toEqual({ eventId: c.id, verse: 0 });
  });
});

describe("lyric entry: leaving the mode", () => {
  it("Enter leaves lyric mode", () => {
    const { h, c } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" });
    h.press({ key: "H" });

    h.press({ key: "Enter" });

    expect(h.entry.lyric).toBeNull();
  });

  it("Escape leaves lyric mode and keeps the typed text", () => {
    const { h, c } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" });
    h.press({ key: "H" });
    h.press({ key: "i" });

    h.press({ key: "Escape" });

    expect(h.entry.lyric).toBeNull();
    const item = h.voiceItems(0)[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics![0]!.text).toBe("Hi");
  });
});

describe("lyric entry: all other keys are swallowed", () => {
  it("non-printable / modifier keys (ArrowUp, Tab, mod+z, mod+c) return null while in lyric mode", () => {
    const { h, c } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" });

    expect(h.press({ key: "ArrowUp" })).toBeNull();
    expect(h.press({ key: "Tab" })).toBeNull();
    expect(h.press({ key: "z", mod: true })).toBeNull();
    expect(h.press({ key: "c", mod: true })).toBeNull();
    expect(h.entry.lyric).toEqual({ eventId: c.id, verse: 0 }); // still in lyric mode, untouched
  });

  it('a plain "n" or a duration digit is treated as literal lyric text, not the note-entry shortcut', () => {
    const { h, c } = threeNoteHarness();
    h.selection = { ids: [c.notes[0]!.id] };
    h.press({ key: "l" });

    h.press({ key: "n" });
    h.press({ key: "4" });

    expect(h.entry.active).toBe(false); // note entry was never toggled on
    const item = h.voiceItems(0)[0]!;
    if (item.kind !== "note") throw new Error("expected note");
    expect(item.lyrics![0]!.text).toBe("n4");
  });
});
