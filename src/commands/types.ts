import type { Draft } from "immer";
import type { Score } from "@/model";

/**
 * All edits go through commands so undo/redo is uniform.
 * `apply` mutates an immer draft; the history keeps immutable score snapshots.
 */
export interface Command {
  label: string;
  apply(draft: Draft<Score>): void;
}
