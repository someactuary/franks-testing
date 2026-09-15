/**
 * Post-processing of a score imported from OMR output (Audiveris MusicXML). Pure.
 * Contract only; implemented in M4. See docs/ARCHITECTURE.md "M4 contracts".
 */
import type { Score } from "@/model";

export interface OmrCleanupOptions {
  /**
   * "essentials": keep staves, clefs, key/time signatures, notes, rests, ties, tuplets,
   * barlines/repeats; drop every attachment and spanner except ties (slurs, dynamics,
   * hairpins, text, tempo, pedal, ottava, fermatas), articulations, ornaments, fingering
   * and lyrics. "all": keep everything recognized.
   */
  keep: "essentials" | "all";
  /** Keep the source's system/page breaks (so pages line up with the PDF). */
  keepLayout: boolean;
}

export interface OmrReviewItem {
  measureIndex: number;
  staffIndex: number;
  reason: "padded-voice" | "overfull-voice" | "validation" | "suspicious-duration";
  detail: string;
}

export interface OmrCleanupResult {
  score: Score;
  /** Measures a human should check against the original, in score order. */
  review: OmrReviewItem[];
}

export function cleanupOmrScore(_score: Score, _opts: OmrCleanupOptions): OmrCleanupResult {
  throw new Error("cleanupOmrScore not implemented yet");
}
