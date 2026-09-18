/**
 * Editing a score's title-block metadata (docs/ARCHITECTURE.md's "Score info"):
 * title, subtitle, composer, lyricist, copyright. One command for the whole group
 * (not one per field) since the UI (src/ui/ScoreInfoPanel.tsx) commits a single
 * field at a time on blur — a `Partial<ScoreMeta>` patch keeps that one field's
 * edit as one undo step without needing a separate command per field.
 */
import type { ScoreMeta } from "@/model";
import type { Command } from "./types";

/** Sets each field in `patch`; an empty string clears that field rather than storing it. */
export function setScoreMeta(patch: Partial<ScoreMeta>): Command {
  return {
    label: "Edit score info",
    apply(draft) {
      for (const [key, value] of Object.entries(patch) as [keyof ScoreMeta, string | undefined][]) {
        if (value) draft.meta[key] = value;
        else delete draft.meta[key];
      }
    },
  };
}
