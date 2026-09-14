import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { frac, newPianoScore, note, rest, type Score } from "@/model";
import { DEFAULT_ENTRY_STATE, type Cursor, type EditorState } from "@/input/types";
import { copySelection, pasteAt } from "@/input/clipboard";

function cursorAt(measureIndex: number, staffIndex = 0, offset = frac(0)): Cursor {
  return { partIndex: 0, measureIndex, staffIndex, voiceIndex: 0, offset };
}

function stateOf(score: Score, opts: Partial<EditorState> = {}): EditorState {
  return {
    score,
    cursor: cursorAt(0),
    selection: { ids: [] },
    entry: { ...DEFAULT_ENTRY_STATE },
    clipboard: null,
    ...opts,
  };
}

function voiceOf(score: Score, measureIndex: number, staffIndex = 0) {
  return score.parts[0]!.measures[measureIndex]!.staves[staffIndex]!.voices[0]!;
}

function apply(score: Score, commands: ReturnType<typeof pasteAt>["commands"]): Score {
  return produce(score, (d) => {
    for (const cmd of commands) cmd.apply(d);
  });
}

describe("copySelection", () => {
  it("returns null when nothing is selected", () => {
    const state = stateOf(newPianoScore({ measureCount: 1 }));
    expect(copySelection(state)).toBeNull();
  });

  it("copies two quarters into one staff, offsets relative to the first note", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    const c = note("C4", 4);
    const d = note("D4", 4);
    voice.items = [c, d, rest(2)]; // 1/4 + 1/4 + 1/2

    const state = stateOf(score, { selection: { ids: [c.notes[0]!.id, d.notes[0]!.id] } });
    const clipboard = copySelection(state);

    expect(clipboard).not.toBeNull();
    expect(clipboard!.staves).toHaveLength(1);
    expect(clipboard!.staves[0]!.staffOffset).toBe(0);
    expect(clipboard!.staves[0]!.items.map((i) => i.offset)).toEqual([frac(0), frac(1, 4)]);
    expect(clipboard!.length).toEqual(frac(1, 2));
  });

  it("returns null when a selected event lives inside a tuplet", () => {
    const score = newPianoScore({ measureCount: 1 });
    const voice = voiceOf(score, 0);
    const n1 = note("C4", 8);
    voice.items = [
      { kind: "tuplet", id: "tup", ratio: { actual: 3, normal: 2, unit: 8 }, items: [n1, note("D4", 8), note("E4", 8)] },
      rest(2),
      rest(4),
    ];

    const state = stateOf(score, { selection: { ids: [n1.notes[0]!.id] } });
    expect(copySelection(state)).toBeNull();
  });
});

describe("copy + paste", () => {
  it("pastes two copied quarters at another measure with the same pitches", () => {
    const score = newPianoScore({ measureCount: 3 });
    const voice = voiceOf(score, 0);
    const c = note("C4", 4);
    const d = note("D4", 4);
    voice.items = [c, d, rest(2)];

    const copyState = stateOf(score, { selection: { ids: [c.notes[0]!.id, d.notes[0]!.id] } });
    const clipboard = copySelection(copyState);
    expect(clipboard).not.toBeNull();

    const pasteState = stateOf(score, { cursor: cursorAt(2), clipboard });
    const { commands, cursorAfter } = pasteAt(pasteState);
    const next = apply(score, commands);

    const items = voiceOf(next, 2).items;
    const spelled = items.slice(0, 2).map((i) => {
      if (i.kind !== "note") throw new Error("expected a note");
      return i.notes[0]!.pitch.step;
    });
    expect(spelled).toEqual(["C", "D"]);
    // fresh ids, not the originals
    if (items[0]!.kind !== "note") throw new Error("expected a note");
    expect(items[0]!.notes[0]!.id).not.toBe(c.notes[0]!.id);
    expect(cursorAfter).toEqual({ ...cursorAt(2), offset: frac(1, 2) });
  });

  it("copying across both staves pastes to both", () => {
    const score = newPianoScore({ measureCount: 2 });
    const treble = voiceOf(score, 0, 0);
    const bass = voiceOf(score, 0, 1);
    const highNote = note("C5", 4);
    const lowNote = note("C3", 4);
    treble.items = [highNote, rest(4), rest(2)];
    bass.items = [lowNote, rest(4), rest(2)];

    const copyState = stateOf(score, { selection: { ids: [highNote.notes[0]!.id, lowNote.notes[0]!.id] } });
    const clipboard = copySelection(copyState);
    expect(clipboard).not.toBeNull();
    expect(clipboard!.staves.map((s) => s.staffOffset).sort()).toEqual([0, 1]);

    const pasteState = stateOf(score, { cursor: cursorAt(1, 0), clipboard });
    const { commands } = pasteAt(pasteState);
    const next = apply(score, commands);

    const trebleOut = voiceOf(next, 1, 0).items[0]!;
    const bassOut = voiceOf(next, 1, 1).items[0]!;
    if (trebleOut.kind !== "note" || bassOut.kind !== "note") throw new Error("expected notes");
    expect(trebleOut.notes[0]!.pitch).toEqual({ step: "C", alter: 0, octave: 5 });
    expect(bassOut.notes[0]!.pitch).toEqual({ step: "C", alter: 0, octave: 3 });
  });

  it("pasting across a barline splits the pasted note with a tie, like writeSequence", () => {
    const score = newPianoScore({ measureCount: 1 }); // 4/4, only one measure
    const voice = voiceOf(score, 0);
    const whole = note("C4", 1);
    voice.items = [whole];

    const copyState = stateOf(score, { selection: { ids: [whole.notes[0]!.id] } });
    const clipboard = copySelection(copyState);
    expect(clipboard).not.toBeNull();
    expect(clipboard!.length).toEqual(frac(1));

    const pasteState = stateOf(score, { cursor: cursorAt(0, 0, frac(1, 2)), clipboard });
    const { commands, cursorAfter } = pasteAt(pasteState);
    const next = apply(score, commands);

    expect(next.parts[0]!.measures).toHaveLength(2); // appended to fit the rest of the whole note

    const m0 = voiceOf(next, 0).items;
    const lastOfM0 = m0[m0.length - 1]!;
    if (lastOfM0.kind !== "note") throw new Error("expected a note");
    expect(lastOfM0.duration).toEqual({ base: 2, dots: 0 });
    expect(lastOfM0.notes[0]!.tieStart).toBe(true);

    const m1 = voiceOf(next, 1).items;
    const firstOfM1 = m1[0]!;
    if (firstOfM1.kind !== "note") throw new Error("expected a note");
    expect(firstOfM1.duration).toEqual({ base: 2, dots: 0 });
    expect(firstOfM1.notes[0]!.tieStart).toBeUndefined();

    expect(cursorAfter).toEqual({ ...cursorAt(1), offset: frac(1, 2) });
  });

  it("pasteAt with no clipboard reports 'Nothing to paste' and doesn't move the cursor", () => {
    const score = newPianoScore({ measureCount: 1 });
    const state = stateOf(score, { cursor: cursorAt(0, 0, frac(1, 4)) });
    const result = pasteAt(state);
    expect(result.commands).toEqual([]);
    expect(result.message).toMatch(/nothing to paste/i);
    expect(result.cursorAfter).toEqual(state.cursor);
  });

  it("skips a staff that doesn't exist and reports it, but still pastes the staves that do", () => {
    const score = newPianoScore({ measureCount: 2 });
    const voice = voiceOf(score, 0, 0);
    const c = note("C4", 4);
    voice.items = [c, rest(4), rest(2)];

    const copyState = stateOf(score, { selection: { ids: [c.notes[0]!.id] } });
    const clipboard = copySelection(copyState);
    // Fake a clipboard staff offset that goes out of range (no staff 5 on a piano part).
    const bogus = { staves: [...clipboard!.staves, { staffOffset: 5, items: clipboard!.staves[0]!.items }], length: clipboard!.length };

    const pasteState = stateOf(score, { cursor: cursorAt(1, 0), clipboard: bogus });
    const result = pasteAt(pasteState);
    expect(result.message).toBeTruthy();
    const next = apply(score, result.commands);
    expect(voiceOf(next, 1, 0).items[0]!.kind).toBe("note");
  });
});
