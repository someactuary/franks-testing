/**
 * The editor's React store: `History` (score undo/redo, src/commands/history.ts)
 * plus cursor/selection/entry state (src/input/types.ts), driven by a pure
 * `KeyHandler`. This file owns *applying* KeyHandler results — the handler
 * itself never mutates anything (see docs/ARCHITECTURE.md "Editor contracts").
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import { History } from "@/commands/history";
import { newPianoScore } from "@/model/factory";
import type { Score } from "@/model";
import { parseScore, serializeScore } from "@/io/pscore";
import { DEFAULT_ENTRY_STATE } from "@/input/types";
import type {
  ActionHandler,
  ClipboardContent,
  Cursor,
  EditorState,
  EntryState,
  KeyHandler,
  KeyResult,
  KeyStroke,
  PaletteAction,
  Selection,
} from "@/input/types";

/** Default `actionHandler`: nothing is wired up, so every action is "not handled" (like an unbound key). */
const NOOP_ACTION_HANDLER: ActionHandler = () => null;

const AUTOSAVE_KEY = "pmn.autosave";
const MAX_VOICES = 4;
const AUTOSAVE_DEBOUNCE_MS = 400;

export type NewScoreOptions = NonNullable<Parameters<typeof newPianoScore>[0]>;

function defaultCursor(): Cursor {
  return { partIndex: 0, measureIndex: 0, staffIndex: 0, voiceIndex: 0, offset: { num: 0, den: 1 } };
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (index < 0) return 0;
  if (index > length - 1) return length - 1;
  return index;
}

/** Clamps a cursor's indices to a score that may have changed shape underneath it (undo, load, edits). */
function clampCursor(score: Score, cursor: Cursor): Cursor {
  const partIndex = clampIndex(cursor.partIndex, score.parts.length);
  const part = score.parts[partIndex];
  const measureIndex = clampIndex(cursor.measureIndex, part?.measures.length ?? 0);
  const pm = part?.measures[measureIndex];
  const staffIndex = clampIndex(cursor.staffIndex, pm?.staves.length ?? 0);
  // Voices are created on demand when the cursor writes into them, so only clamp to the
  // model's maximum (4 voices), not to the voices that currently exist in this measure.
  const voiceIndex = clampIndex(cursor.voiceIndex, MAX_VOICES);

  if (
    partIndex === cursor.partIndex &&
    measureIndex === cursor.measureIndex &&
    staffIndex === cursor.staffIndex &&
    voiceIndex === cursor.voiceIndex
  ) {
    return cursor;
  }
  return { ...cursor, partIndex, measureIndex, staffIndex, voiceIndex };
}

/** Best-effort restore of the last autosaved score. Any failure (missing storage, bad JSON, invalid score) is ignored. */
function loadAutosave(): Score | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const text = localStorage.getItem(AUTOSAVE_KEY);
    if (!text) return null;
    return parseScore(text);
  } catch {
    return null;
  }
}

/** Clears a timer handle without keeping the process/test runner alive on it. */
function unrefTimer(handle: ReturnType<typeof setTimeout>): void {
  const maybeUnref = (handle as unknown as { unref?: () => void }).unref;
  if (typeof maybeUnref === "function") maybeUnref.call(handle);
}

export interface EditorSnapshot {
  score: Score;
  cursor: Cursor;
  selection: Selection;
  entry: EntryState;
  message: string | null;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Owns the score's undo history plus editor-only state, and is the sole place
 * that applies a `KeyResult` (see src/input/types.ts). Framework-agnostic;
 * `useEditorStore` below wires it into React via `useSyncExternalStore`.
 */
export class EditorStore {
  private history: History;
  private readonly keyHandler: KeyHandler;
  private readonly actionHandler: ActionHandler;
  private cursor: Cursor;
  private selection: Selection;
  private entry: EntryState;
  private clipboard: ClipboardContent | null = null;
  private message: string | null = null;
  private readonly listeners = new Set<() => void>();
  private snapshot: EditorSnapshot;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(initialScore: Score, keyHandler: KeyHandler, actionHandler: ActionHandler = NOOP_ACTION_HANDLER) {
    this.keyHandler = keyHandler;
    this.actionHandler = actionHandler;
    const restored = loadAutosave();
    this.history = new History(restored ?? initialScore);
    this.cursor = clampCursor(this.history.current, defaultCursor());
    this.selection = { ids: [] };
    this.entry = DEFAULT_ENTRY_STATE;
    this.snapshot = this.computeSnapshot();
  }

  private computeSnapshot(): EditorSnapshot {
    return {
      score: this.history.current,
      cursor: this.cursor,
      selection: this.selection,
      entry: this.entry,
      message: this.message,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    };
  }

  getSnapshot = (): EditorSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    this.snapshot = this.computeSnapshot();
    for (const listener of this.listeners) listener();
    this.scheduleAutosave();
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      try {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem(AUTOSAVE_KEY, serializeScore(this.history.current));
      } catch {
        // Storage disabled/full/private-mode: autosave is best-effort only.
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    unrefTimer(this.autosaveTimer);
  }

  private currentState(): EditorState {
    return {
      score: this.history.current,
      cursor: this.cursor,
      selection: this.selection,
      entry: this.entry,
      clipboard: this.clipboard,
    };
  }

  /**
   * Applies a `KeyResult`: `history` undo/redo, then `commands` in order
   * through History (grouped as one undo step), then cursor/selection/
   * entry/message. Shared by `applyKey` and `applyAction` — both handlers
   * return the same contract (src/input/types.ts).
   */
  private applyResult(result: KeyResult): void {
    if (result.history === "undo") this.history.undo();
    else if (result.history === "redo") this.history.redo();
    this.history.executeGroup(result.commands);

    let nextCursor = result.cursor ?? this.cursor;
    nextCursor = clampCursor(this.history.current, nextCursor);
    this.cursor = nextCursor;
    if (result.selection) this.selection = result.selection;
    if (result.entry) this.entry = result.entry;
    if (result.clipboard !== undefined) this.clipboard = result.clipboard;
    if (result.message !== undefined) this.message = result.message;

    this.emit();
  }

  /**
   * Runs `stroke` through the KeyHandler against the current state and
   * applies the result. Returns whether the key was handled (the caller
   * should `preventDefault` when true).
   */
  applyKey = (stroke: KeyStroke): boolean => {
    const result = this.keyHandler(this.currentState(), stroke);
    if (result === null) return false;
    this.applyResult(result);
    return true;
  };

  /**
   * Runs `action` through the ActionHandler (palettes, staves panel, mouse
   * drags) against the current state and applies the result exactly like
   * `applyKey`. Returns whether the action was handled.
   */
  applyAction = (action: PaletteAction): boolean => {
    const result = this.actionHandler(this.currentState(), action);
    if (result === null) return false;
    this.applyResult(result);
    return true;
  };

  setCursor = (cursor: Cursor): void => {
    this.cursor = clampCursor(this.history.current, cursor);
    this.emit();
  };

  setSelection = (selection: Selection): void => {
    this.selection = selection;
    this.emit();
  };

  undo = (): void => {
    if (!this.history.undo()) return;
    this.cursor = clampCursor(this.history.current, this.cursor);
    this.emit();
  };

  redo = (): void => {
    if (!this.history.redo()) return;
    this.cursor = clampCursor(this.history.current, this.cursor);
    this.emit();
  };

  newScore = (opts: NewScoreOptions = {}): void => {
    const score = newPianoScore(opts);
    this.history = new History(score);
    this.cursor = defaultCursor();
    this.selection = { ids: [] };
    this.entry = DEFAULT_ENTRY_STATE;
    this.message = null;
    this.emit();
  };

  loadScore = (score: Score): void => {
    this.history = new History(score);
    this.cursor = clampCursor(score, defaultCursor());
    this.selection = { ids: [] };
    this.entry = DEFAULT_ENTRY_STATE;
    this.message = null;
    this.emit();
  };
}

export interface EditorStoreApi extends EditorSnapshot {
  applyKey: (stroke: KeyStroke) => boolean;
  applyAction: (action: PaletteAction) => boolean;
  setCursor: (cursor: Cursor) => void;
  setSelection: (selection: Selection) => void;
  undo: () => void;
  redo: () => void;
  newScore: (opts?: NewScoreOptions) => void;
  loadScore: (score: Score) => void;
}

/** One `EditorStore` for the lifetime of the component, wired into React via `useSyncExternalStore`. */
export function useEditorStore(
  initialScore: Score,
  keyHandler: KeyHandler,
  actionHandler: ActionHandler = NOOP_ACTION_HANDLER,
): EditorStoreApi {
  const [store] = useState(() => new EditorStore(initialScore, keyHandler, actionHandler));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  return useMemo(
    () => ({
      ...snapshot,
      applyKey: store.applyKey,
      applyAction: store.applyAction,
      setCursor: store.setCursor,
      setSelection: store.setSelection,
      undo: store.undo,
      redo: store.redo,
      newScore: store.newScore,
      loadScore: store.loadScore,
    }),
    [snapshot, store],
  );
}
