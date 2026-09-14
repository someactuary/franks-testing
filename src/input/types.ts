/**
 * Editor-state contracts shared by src/input (pure key handling) and src/ui (React).
 * Everything here is plain data; the UI owns the store, src/input owns the rules.
 */
import type { Fraction, NoteValue } from "@/model/duration";
import type { Alter } from "@/model/pitch";
import type { Id, NoteEvent, RestEvent, Score } from "@/model";
import type { Command } from "@/commands/types";

/** Where the next entered note goes. `offset` is measure-relative, in whole notes. */
export interface Cursor {
  partIndex: number;
  measureIndex: number;
  staffIndex: number;
  voiceIndex: number;
  offset: Fraction;
}

/** What the user has selected. Element ids are note ids or event ids (rests). */
export interface Selection {
  ids: Id[];
}

/** Pending note-entry settings, MuseScore-style: choose duration, then type pitches. */
export interface EntryState {
  base: NoteValue;
  dots: 0 | 1 | 2 | 3;
  /** Accidental to apply to the next entered note; cleared after use. */
  alter: Alter | null;
  /** Octave of the last entered/selected pitch; new letters pick the nearest octave to this. */
  referenceOctave: number;
  /** Diatonic reference step (0-6, C=0) of the last entered pitch for nearest-octave logic. */
  referenceStepIndex: number;
  /** When true, typed letters are added to the chord at the cursor instead of advancing. */
  chordMode: boolean;
  /** True while note-entry mode is active (N toggles). Off = navigation/selection only. */
  active: boolean;
}

/** Internal clipboard: events per staff, with offsets relative to the copied span's start. */
export interface ClipboardItem {
  offset: Fraction;
  /** A deep copy; ids are regenerated on paste. */
  event: NoteEvent | RestEvent;
}
export interface ClipboardStaff {
  /** Staff index relative to the topmost copied staff (0 = same staff as the paste cursor). */
  staffOffset: number;
  items: ClipboardItem[];
}
export interface ClipboardContent {
  staves: ClipboardStaff[];
  /** Total span from the first onset to the end of the last event (max over staves). */
  length: Fraction;
}

export interface EditorState {
  score: Score;
  cursor: Cursor;
  selection: Selection;
  entry: EntryState;
  clipboard: ClipboardContent | null;
}

/** Normalized keyboard event, independent of the DOM. */
export interface KeyStroke {
  /** KeyboardEvent.key: "a", "A", "ArrowUp", "Backspace", "Delete", "Enter", "Escape", "Tab", " ", "+", "-", ".", "0"-"9" ... */
  key: string;
  shift: boolean;
  /** Cmd on macOS, Ctrl elsewhere. */
  mod: boolean;
  alt: boolean;
}

/** Result of handling a keystroke. `null` = key not handled (let the browser have it). */
export interface KeyResult {
  /** Commands to run through History, in order. May be empty for pure navigation. */
  commands: Command[];
  /** New cursor after the commands have been applied. Omit to keep. */
  cursor?: Cursor;
  selection?: Selection;
  entry?: EntryState;
  /** "undo" / "redo" are handled by the store, not by commands. */
  history?: "undo" | "redo";
  /** Replace the internal clipboard (copy/cut). */
  clipboard?: ClipboardContent | null;
  /** Optional user-facing note for the status bar, e.g. "Note does not fit in measure". */
  message?: string;
}

/**
 * Pure keystroke handler. Reads state, never mutates it. The store applies `commands`,
 * then the cursor/selection/entry updates. Implemented in src/input/step-entry.ts.
 */
export type KeyHandler = (state: EditorState, key: KeyStroke) => KeyResult | null;

export const DEFAULT_ENTRY_STATE: EntryState = {
  base: 4,
  dots: 0,
  alter: null,
  referenceOctave: 4,
  referenceStepIndex: 0,
  chordMode: false,
  active: false,
};
