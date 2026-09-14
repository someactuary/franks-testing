import { describe, expect, it } from "vitest";
import { History } from "@/commands/history";
import { newPianoScore, type Score } from "@/model";
import { defaultEditorState, handleKey } from "@/input/step-entry";
import { handleMidiNote } from "@/input/midi-entry";
import type { EditorState, KeyResult, KeyStroke } from "@/input/types";

/**
 * Regression: a chord tone entered right after a note that filled the measure (so the
 * cursor already moved to the next measure) must join that note, for both Shift+letter
 * and a MIDI key played while others are held. Found by driving the editor in a browser.
 */

function apply(h: History, st: EditorState, r: KeyResult | null): EditorState {
  expect(r).not.toBeNull();
  h.executeGroup(r!.commands);
  return {
    ...st,
    score: h.current,
    cursor: r!.cursor ?? st.cursor,
    selection: r!.selection ?? st.selection,
    entry: r!.entry ?? st.entry,
  };
}

const key = (k: string, shift = false): KeyStroke => ({ key: k, shift, mod: false, alt: false });

function lastEventPitches(score: Score, measureIndex: number): string[] {
  const voice = score.parts[0]!.measures[measureIndex]!.staves[0]!.voices.find((v) => v.index === 0)!;
  const last = voice.items[voice.items.length - 1]!;
  if (last.kind !== "note") return [];
  return last.notes.map((n) => `${n.pitch.step}${n.pitch.octave}`);
}

function start(): { h: History; st: EditorState } {
  const score = newPianoScore({ measureCount: 2 });
  const h = new History(score);
  let st = defaultEditorState(score);
  st = apply(h, st, handleKey(st, key("n")));
  st = apply(h, st, handleKey(st, key("4")));
  return { h, st };
}

describe("chord tones after a note that fills the measure", () => {
  it("MIDI: G then B and D held over it form one chord at the end of measure 1", () => {
    const { h, st: initial } = start();
    let st = initial;
    for (const note of [60, 62, 64, 67]) st = apply(h, st, handleMidiNote(st, { note, velocity: 80, held: [] }));
    expect(st.cursor.measureIndex).toBe(1);
    st = apply(h, st, handleMidiNote(st, { note: 71, velocity: 80, held: [67] }));
    st = apply(h, st, handleMidiNote(st, { note: 74, velocity: 80, held: [67, 71] }));
    expect(lastEventPitches(st.score, 0)).toEqual(["G4", "B4", "D5"]);
  });

  it("Shift+letter: C D E G then Shift+B Shift+D build the chord on the G", () => {
    const { h, st: initial } = start();
    let st = initial;
    for (const k of ["c", "d", "e", "g"]) st = apply(h, st, handleKey(st, key(k)));
    expect(st.cursor.measureIndex).toBe(1);
    st = apply(h, st, handleKey(st, key("B", true)));
    st = apply(h, st, handleKey(st, key("D", true)));
    expect(lastEventPitches(st.score, 0)).toEqual(["G4", "B4", "D5"]);
  });
});
