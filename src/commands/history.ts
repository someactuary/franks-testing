/**
 * Undo/redo for a Score. All edits go through `execute(Command)`; the stack
 * holds immutable score snapshots (immer gives structural sharing, so this
 * is cheap even though it looks naive).
 */
import { produce } from "immer";
import type { Score } from "@/model";
import type { Command } from "./types";

const MAX_HISTORY = 500;

export type HistoryListener = () => void;

export class History {
  private present: Score;
  private undoStack: Score[] = [];
  private redoStack: Score[] = [];
  private listeners = new Set<HistoryListener>();

  constructor(initial: Score) {
    this.present = initial;
  }

  get current(): Score {
    return this.present;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Applies `cmd` to the current score. Clears the redo branch, per standard undo/redo semantics. */
  execute(cmd: Command): void {
    const next = produce(this.present, (draft) => {
      cmd.apply(draft);
    });
    if (next === this.present) return; // command was a no-op; don't pollute history

    this.undoStack.push(this.present);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.present = next;
    this.notify();
  }

  /**
   * Applies several commands as ONE undo step (e.g. everything a single keystroke does).
   * Commands run in order on the same draft; a group that changes nothing is dropped.
   */
  executeGroup(cmds: readonly Command[]): void {
    if (cmds.length === 0) return;
    const next = produce(this.present, (draft) => {
      for (const cmd of cmds) cmd.apply(draft);
    });
    if (next === this.present) return;

    this.undoStack.push(this.present);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.present = next;
    this.notify();
  }

  /** Reverts to the previous snapshot. Returns false (no-op) if there is nothing to undo. */
  undo(): boolean {
    const prev = this.undoStack.pop();
    if (prev === undefined) return false;
    this.redoStack.push(this.present);
    this.present = prev;
    this.notify();
    return true;
  }

  /** Re-applies the most recently undone snapshot. Returns false (no-op) if there is nothing to redo. */
  redo(): boolean {
    const next = this.redoStack.pop();
    if (next === undefined) return false;
    this.undoStack.push(this.present);
    this.present = next;
    this.notify();
    return true;
  }

  /** Subscribes to score changes (execute/undo/redo). Returns an unsubscribe function. */
  subscribe(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
