/**
 * Clef changes inside the music (docs/ARCHITECTURE.md "Clef changes"). `setClef` in
 * staves.ts changes a staff's opening clef for the whole piece; these commands add or
 * remove a change from one point on.
 */
import type { Draft } from "immer";
import {
  clefEnteringMeasure,
  cmp,
  parseClefChangeId,
  ZERO,
  type ClefKind,
  type Fraction,
  type Score,
  type StaffMeasure,
} from "@/model";
import type { Command } from "./types";

/** The clef in force just BEFORE `at` (ignoring any change exactly at `at`). */
export function clefBefore(
  score: Score,
  partIndex: number,
  staffIndex: number,
  measureIndex: number,
  at: Fraction,
): ClefKind {
  let clef = clefEnteringMeasure(score, partIndex, staffIndex, measureIndex);
  const sm = score.parts[partIndex]?.measures[measureIndex]?.staves[staffIndex];
  const earlier = (sm?.clefChanges ?? [])
    .filter((c) => cmp(c.at, at) < 0)
    .sort((a, b) => cmp(a.at, b.at));
  if (earlier.length > 0) clef = earlier[earlier.length - 1]!.clef;
  return clef;
}

function withoutChangeAt(sm: Draft<StaffMeasure>, at: Fraction): void {
  const kept = (sm.clefChanges ?? []).filter((c) => cmp(c.at, at) !== 0);
  if (kept.length > 0) sm.clefChanges = kept;
  else delete sm.clefChanges;
}

/**
 * Switches a staff to `clef` from `at` (a measure-relative offset; 0 = from the start of
 * the measure) on. Replaces a change already at that point; a change back to the clef
 * already in force there is simply removed, so the model never holds a no-op change. At
 * the very start of the piece it sets the staff's opening clef instead.
 */
export function setClefChange(
  partIndex: number,
  staffIndex: number,
  measureIndex: number,
  at: Fraction,
  clef: ClefKind,
): Command {
  return {
    label: "Set clef change",
    apply(draft) {
      const part = draft.parts[partIndex];
      const staff = part?.staves[staffIndex];
      const sm = part?.measures[measureIndex]?.staves[staffIndex];
      if (!staff || !sm)
        throw new Error(`setClefChange: no staff ${staffIndex} in measure ${measureIndex}`);
      if (measureIndex === 0 && cmp(at, ZERO) === 0) {
        staff.initialClef = clef;
        withoutChangeAt(sm, ZERO);
        return;
      }
      const before = clefBefore(draft as Score, partIndex, staffIndex, measureIndex, at);
      withoutChangeAt(sm, at);
      if (clef === before) return;
      sm.clefChanges = [...(sm.clefChanges ?? []), { at, clef }].sort((a, b) => cmp(a.at, b.at));
    },
  };
}

/** Removes the clef change a `clefChangeId` names; the clef before it continues. */
export function removeClefChange(id: string): Command {
  return {
    label: "Remove clef change",
    apply(draft) {
      const loc = parseClefChangeId(id);
      if (!loc) throw new Error(`removeClefChange: not a clef change id: ${id}`);
      const measureIndex = draft.measures.findIndex((m) => m.id === loc.measureId);
      const sm = draft.parts[loc.partIndex]?.measures[measureIndex]?.staves[loc.staffIndex];
      if (!sm || !(sm.clefChanges ?? []).some((c) => cmp(c.at, loc.at) === 0)) {
        throw new Error("removeClefChange: that clef change no longer exists");
      }
      withoutChangeAt(sm, loc.at);
    },
  };
}
