/**
 * Mid-song key signature changes. `MeasureAttributes.keySig` already supports this at
 * the model level (the engraver draws the new key — with cancellation naturals — at
 * every system starting at or after the measure it's set on, per docs/ARCHITECTURE.md's
 * "M1 contracts" key-repeat rule); this file is the one command that edits it.
 */
import type { KeySignature } from "@/model";
import type { Command } from "./types";

/**
 * Sets (or, with `keySig: null`, removes) the key signature explicitly declared at
 * `measureIndex`. Removing it does not erase a key change — it means the key already
 * in effect one measure earlier simply continues (docs/ARCHITECTURE.md's
 * `keySignatureAt`: the most recent explicit `keySig` at or before a measure wins).
 * Key-aware note entry (`letterAlter` in step-entry.ts) reads the same measure
 * attribute, so typed pitches are spelled correctly on either side of the change
 * without any further action.
 */
export function setKeySignature(measureIndex: number, keySig: KeySignature | null): Command {
  return {
    label: keySig ? "Set key signature" : "Remove key signature",
    apply(draft) {
      const measure = draft.measures[measureIndex];
      if (!measure) throw new Error(`setKeySignature: no measure at index ${measureIndex}`);
      if (keySig) measure.keySig = keySig;
      else delete measure.keySig;
    },
  };
}
