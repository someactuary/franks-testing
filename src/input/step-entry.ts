/**
 * Pure keyboard step-entry handler. See docs/ARCHITECTURE.md's "Editor contracts (M1)"
 * for the contracts this implements (`KeyHandler`, `EditorState`, etc. live in
 * src/input/types.ts and are not modified here). The store (src/ui) applies the
 * returned commands through History, then adopts the returned cursor/selection/entry.
 */
import { add, lt, newId, notated, notatedToFraction, ZERO, type NoteValue, type Score } from "@/model";
import { keyAlter, STEPS, type Alter, type Pitch, type Step } from "@/model/pitch";
import { locateNote } from "@/commands/locate";
import { toggleTie } from "@/commands/basic";
import { addNoteToEvent, appendMeasure, canWrite, eraseEvent, setNoteAlter, transposeNotes, writeEvent } from "@/commands/edit";
import type { Command } from "@/commands/types";
import {
  eventAtCursor,
  eventBeforeCursor,
  eventsInVoice,
  keySignatureAt,
  measureLength,
  nextOffset,
  prevOffset,
  type PositionedVoiceEvent,
} from "./navigation";
import {
  DEFAULT_ENTRY_STATE,
  type Cursor,
  type EditorState,
  type EntryState,
  type KeyHandler,
  type KeyResult,
  type Selection,
} from "./types";

/** A fresh editor state for `score`: cursor at the very start, nothing selected, entry off. */
export function defaultEditorState(score: Score): EditorState {
  return {
    score,
    cursor: { partIndex: 0, measureIndex: 0, staffIndex: 0, voiceIndex: 0, offset: ZERO },
    selection: { ids: [] },
    entry: { ...DEFAULT_ENTRY_STATE },
  };
}

/** Digit -> notated base value, per the M1 key bindings (1 = 64th ... 7 = whole). */
const DURATION_DIGITS: Record<string, NoteValue> = { "1": 64, "2": 32, "3": 16, "4": 8, "5": 4, "6": 2, "7": 1 };

/**
 * Among referenceOctave-1/+0/+1, the octave that puts `step` diatonically closest to
 * (referenceOctave, referenceStepIndex). Ties can't occur (candidates are 7 apart).
 */
function nearestOctave(step: Step, referenceOctave: number, referenceStepIndex: number): number {
  const stepIndex = STEPS.indexOf(step);
  const referenceDiatonic = referenceOctave * 7 + referenceStepIndex;
  let best = referenceOctave;
  let bestDistance = Infinity;
  for (const candidate of [referenceOctave - 1, referenceOctave, referenceOctave + 1]) {
    const distance = Math.abs(candidate * 7 + stepIndex - referenceDiatonic);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/** The alteration to apply to a freshly typed letter: the pending accidental, else the key signature's. */
function letterAlter(state: EditorState, step: Step): Alter {
  return state.entry.alter ?? keyAlter(keySignatureAt(state.score, state.cursor.measureIndex), step);
}

/** Selection ids that actually resolve to notes in the current score (rest ids are dropped). */
function selectedNoteIds(state: EditorState): string[] {
  return state.selection.ids.filter((id) => locateNote(state.score, id) !== undefined);
}

function beforeCursorNoteIds(state: EditorState): string[] {
  const before = eventBeforeCursor(state.score, state.cursor);
  if (!before || before.event.kind !== "note") return [];
  return before.event.notes.map((n) => n.id);
}

/** selection if it has notes, else (only while note entry is active) the event before the cursor. */
function transposeTargets(state: EditorState): string[] {
  const selected = selectedNoteIds(state);
  if (selected.length > 0) return selected;
  if (!state.entry.active) return [];
  return beforeCursorNoteIds(state);
}

/** selection if it has notes, else the event before the cursor (works whether or not entry is active). */
function tieTargets(state: EditorState): string[] {
  const selected = selectedNoteIds(state);
  if (selected.length > 0) return selected;
  return beforeCursorNoteIds(state);
}

function selectionOf(pe: PositionedVoiceEvent | undefined): Selection {
  if (!pe) return { ids: [] };
  return { ids: [pe.event.kind === "note" ? pe.event.notes[0]!.id : pe.event.id] };
}

/** Cursor + event-boundary navigation shared by ArrowLeft/ArrowRight. Crosses measures; stops at score ends. */
function moveToEvent(state: EditorState, dir: 1 | -1): KeyResult {
  const { score, cursor } = state;
  if (dir === 1) {
    const off = nextOffset(score, cursor);
    if (off !== null) {
      const newCursor: Cursor = { ...cursor, offset: off };
      return { commands: [], cursor: newCursor, selection: selectionOf(eventAtCursor(score, newCursor)) };
    }
    const measureCount = score.parts[cursor.partIndex]?.measures.length ?? 0;
    if (cursor.measureIndex + 1 < measureCount) {
      const newCursor: Cursor = { ...cursor, measureIndex: cursor.measureIndex + 1, offset: ZERO };
      return { commands: [], cursor: newCursor, selection: selectionOf(eventAtCursor(score, newCursor)) };
    }
    return { commands: [], cursor, selection: selectionOf(eventAtCursor(score, cursor)) }; // already at score end
  }
  const off = prevOffset(score, cursor);
  if (off !== null) {
    const newCursor: Cursor = { ...cursor, offset: off };
    return { commands: [], cursor: newCursor, selection: selectionOf(eventAtCursor(score, newCursor)) };
  }
  if (cursor.measureIndex > 0) {
    const prevMeasureIndex = cursor.measureIndex - 1;
    const events = eventsInVoice(score, { ...cursor, measureIndex: prevMeasureIndex });
    const lastOffset = events.length > 0 ? events[events.length - 1]!.offset : ZERO;
    const newCursor: Cursor = { ...cursor, measureIndex: prevMeasureIndex, offset: lastOffset };
    return { commands: [], cursor: newCursor, selection: selectionOf(eventAtCursor(score, newCursor)) };
  }
  return { commands: [], cursor, selection: selectionOf(eventAtCursor(score, cursor)) }; // already at score start
}

/** Writes a note or rest of the current entry duration at the cursor, advancing the cursor past it. */
function enter(state: EditorState, event: { kind: "note"; pitch: Pitch } | { kind: "rest" }): KeyResult {
  const { score, cursor, entry } = state;
  const duration = notated(entry.base, entry.dots);
  const len = notatedToFraction(duration);
  const refusal = canWrite(score, cursor, len);
  if (refusal) return { commands: [], message: refusal };

  const noteEvent =
    event.kind === "note"
      ? { kind: "note" as const, id: newId(), duration, notes: [{ id: newId(), pitch: event.pitch }] }
      : { kind: "rest" as const, id: newId(), duration };

  const commands: Command[] = [writeEvent(cursor, noteEvent)];
  let measureIndex = cursor.measureIndex;
  let offset = add(cursor.offset, len);

  const measureLen = measureLength(score, cursor.measureIndex);
  if (!lt(offset, measureLen)) {
    // The write reached the end of the measure (canWrite already guarantees it didn't overshoot).
    measureIndex += 1;
    offset = ZERO;
    const measureCount = score.parts[cursor.partIndex]?.measures.length ?? 0;
    if (measureIndex >= measureCount) commands.push(appendMeasure());
  }

  const newCursor: Cursor = { ...cursor, measureIndex, offset };
  const newEntry: EntryState =
    event.kind === "note"
      ? { ...entry, alter: null, referenceOctave: event.pitch.octave, referenceStepIndex: STEPS.indexOf(event.pitch.step) }
      : { ...entry, alter: null };
  const selectedId = noteEvent.kind === "note" ? noteEvent.notes[0]!.id : noteEvent.id;
  return { commands, cursor: newCursor, selection: { ids: [selectedId] }, entry: newEntry };
}

export const handleKey: KeyHandler = (state, key) => {
  const { score, cursor, entry } = state;
  const lower = key.key.length === 1 ? key.key.toLowerCase() : key.key;

  // Undo / redo
  if (key.mod && lower === "z") {
    return { commands: [], history: key.shift ? "redo" : "undo" };
  }

  // mod+ArrowLeft/Right: previous/next measure at offset 0. Stops (doesn't wrap) at score ends.
  if (key.mod && (key.key === "ArrowLeft" || key.key === "ArrowRight")) {
    const measureCount = score.parts[cursor.partIndex]?.measures.length ?? 0;
    const dir = key.key === "ArrowRight" ? 1 : -1;
    const measureIndex = Math.min(Math.max(cursor.measureIndex + dir, 0), Math.max(measureCount - 1, 0));
    return { commands: [], cursor: { ...cursor, measureIndex, offset: ZERO } };
  }

  if (lower === "n") {
    return { commands: [], entry: { ...entry, active: !entry.active } };
  }
  if (key.key === "Escape") {
    return { commands: [], entry: { ...entry, active: false }, selection: { ids: [] } };
  }

  if (entry.active && key.key in DURATION_DIGITS) {
    return { commands: [], entry: { ...entry, base: DURATION_DIGITS[key.key]! } };
  }
  if (entry.active && key.key === ".") {
    const dots: EntryState["dots"] = key.alt ? (entry.dots === 2 ? 0 : 2) : entry.dots === 1 ? 0 : 1;
    return { commands: [], entry: { ...entry, dots } };
  }
  if (entry.active && key.key === "0") {
    return enter(state, { kind: "rest" });
  }
  if (entry.active && /^[a-g]$/.test(lower)) {
    const step = lower.toUpperCase() as Step;
    const octave = nearestOctave(step, entry.referenceOctave, entry.referenceStepIndex);
    const alter = letterAlter(state, step);
    if (key.shift) {
      const before = eventBeforeCursor(score, cursor);
      if (!before || before.event.kind !== "note") {
        return { commands: [], message: "No chord to add a note to" };
      }
      return {
        commands: [addNoteToEvent(before.event.id, { step, alter, octave })],
        entry: { ...entry, alter: null },
      };
    }
    return enter(state, { kind: "note", pitch: { step, alter, octave } });
  }
  if (entry.active && key.key === "Backspace") {
    const before = eventBeforeCursor(score, cursor);
    if (!before) return { commands: [], message: "Nothing to erase" };
    return { commands: [eraseEvent(before.event.id)], cursor: { ...cursor, offset: before.offset } };
  }
  if (entry.active && key.key === "Delete") {
    const at = eventAtCursor(score, cursor);
    if (!at) return { commands: [], message: "Nothing to erase" };
    return { commands: [eraseEvent(at.event.id)] };
  }

  if (key.key === "+" || key.key === "=" || key.key === "-") {
    const alter: Alter = key.key === "-" ? -1 : 1;
    const targets = selectedNoteIds(state);
    if (targets.length > 0) {
      return { commands: targets.map((id) => setNoteAlter(id, alter)) };
    }
    return { commands: [], entry: { ...entry, alter } };
  }

  if (key.key === "ArrowUp" || key.key === "ArrowDown") {
    const targets = transposeTargets(state);
    if (targets.length === 0) return null;
    const dir: 1 | -1 = key.key === "ArrowUp" ? 1 : -1;
    const by = key.shift ? { octaves: dir } : { semitones: dir };
    return { commands: [transposeNotes(targets, by)] };
  }

  if (lower === "t") {
    const targets = tieTargets(state);
    if (targets.length === 0) return null;
    return { commands: targets.map((id) => toggleTie(id)) };
  }

  if (key.key === "ArrowLeft" || key.key === "ArrowRight") {
    return moveToEvent(state, key.key === "ArrowRight" ? 1 : -1);
  }

  if (key.key === "Tab") {
    return { commands: [], cursor: { ...cursor, staffIndex: cursor.staffIndex === 0 ? 1 : 0 } };
  }

  if (key.key === "Home") {
    return { commands: [], cursor: { ...cursor, offset: ZERO } };
  }
  if (key.key === "End") {
    const events = eventsInVoice(score, cursor);
    const lastOffset = events.length > 0 ? events[events.length - 1]!.offset : ZERO;
    return { commands: [], cursor: { ...cursor, offset: lastOffset } };
  }

  return null;
};
