import { describe, expect, it } from "vitest";
import { clefChangeId, frac, newPianoScore, note, ZERO, type Score } from "@/model";
import { defaultEditorState, handleKey } from "@/input/step-entry";
import { handleAction } from "@/input/actions";
import type { Command } from "@/commands/types";
import { produce } from "immer";
import type { Cursor, EditorState, KeyResult } from "@/input/types";

function state(score: Score, patch: Partial<EditorState> = {}): EditorState {
  return { ...defaultEditorState(score), ...patch };
}

function applyAll(score: Score, result: KeyResult | null): Score {
  return (result?.commands ?? []).reduce<Score>(
    (s, cmd: Command) => produce(s, (d) => cmd.apply(d)),
    score,
  );
}

/** Two measures; the lower staff has four quarter notes in measure 1. */
function pianoScore() {
  const score = newPianoScore({ measureCount: 2 });
  const lh = [note("C3", 4), note("E3", 4), note("G4", 4), note("A4", 4)];
  score.parts[0]!.measures[0]!.staves[1]!.voices[0]!.items = lh;
  return { score, lh };
}

const lowerStaffCursor = (measureIndex: number, offset = ZERO): Cursor => ({
  partIndex: 0,
  measureIndex,
  staffIndex: 1,
  voiceIndex: 0,
  offset,
});

describe("clef change palette action", () => {
  it("adds the change right before the earliest selected note", () => {
    const { score, lh } = pianoScore();
    const result = handleAction(state(score, { selection: { ids: [lh[3]!.id, lh[2]!.id] } }), {
      kind: "clefChange",
      clef: "treble",
    });
    const next = applyAll(score, result);
    expect(next.parts[0]!.measures[0]!.staves[1]!.clefChanges).toEqual([
      { at: frac(1, 2), clef: "treble" },
    ]);
  });

  it("with nothing selected, adds it at the cursor (offset 0 = from the start of that measure)", () => {
    const { score } = pianoScore();
    const result = handleAction(state(score, { cursor: lowerStaffCursor(1) }), {
      kind: "clefChange",
      clef: "treble",
    });
    const next = applyAll(score, result);
    expect(next.parts[0]!.measures[1]!.staves[1]!.clefChanges).toEqual([
      { at: ZERO, clef: "treble" },
    ]);
  });

  it("says so, and changes nothing, when the staff is already in that clef there", () => {
    const { score } = pianoScore();
    const result = handleAction(state(score, { cursor: lowerStaffCursor(1) }), {
      kind: "clefChange",
      clef: "bass",
    });
    expect(result?.commands).toEqual([]);
    expect(result?.message).toMatch(/Already in bass clef/);
  });

  it("choosing the old clef again at the same point removes the change", () => {
    const { score, lh } = pianoScore();
    const selection = { ids: [lh[2]!.id] };
    const withChange = applyAll(
      score,
      handleAction(state(score, { selection }), { kind: "clefChange", clef: "treble" }),
    );
    const back = applyAll(
      withChange,
      handleAction(state(withChange, { selection }), { kind: "clefChange", clef: "bass" }),
    );
    expect(back.parts[0]!.measures[0]!.staves[1]!.clefChanges).toBeUndefined();
  });
});

describe("deleting a selected clef change", () => {
  it("Delete removes it and leaves the notes alone", () => {
    const { score, lh } = pianoScore();
    score.parts[0]!.measures[0]!.staves[1]!.clefChanges = [{ at: frac(1, 2), clef: "treble" }];
    const id = clefChangeId({
      measureId: score.measures[0]!.id,
      partIndex: 0,
      staffIndex: 1,
      at: frac(1, 2),
    });
    const result = handleKey(state(score, { selection: { ids: [id] } }), {
      key: "Delete",
      shift: false,
      mod: false,
      alt: false,
    });
    const next = applyAll(score, result);
    expect(next.parts[0]!.measures[0]!.staves[1]!.clefChanges).toBeUndefined();
    expect(next.parts[0]!.measures[0]!.staves[1]!.voices[0]!.items.map((i) => i.id)).toEqual(
      lh.map((n) => n.id),
    );
  });
});
