/**
 * Score presets that don't fit the single "Piano" shape `newPianoScore`
 * builds (src/model/factory.ts). Built directly from the model types rather
 * than as an `addStaff`/`setClef`/... sequence of actions: a preset is a
 * single, known-good document, not a sequence of edits, so there's no undo
 * history to construct and no dependency on the (concurrently developed)
 * action handler.
 */
import { newId } from "@/model/ids";
import { DEFAULT_SETTINGS, EMPTY_LAYOUT_HINTS, FORMAT_VERSION } from "@/model/score";
import type { KeySignature, TimeSignature } from "@/model";
import type { Part, Score, StaffDef } from "@/model/score";
import { emptyVoice } from "@/model/factory";

export interface SatbScoreOptions {
  measureCount?: number;
  timeSig?: TimeSignature;
  keySig?: KeySignature;
  title?: string;
  composer?: string;
}

/** Soprano/Alto/Tenor/Bass on their own staves (treble, treble, treble-8vb, bass), joined by a bracket. */
export function newSatbScore(opts: SatbScoreOptions = {}): Score {
  const measureCount = opts.measureCount ?? 4;
  const timeSig = opts.timeSig ?? { numerator: 4, denominator: 4 };
  const keySig = opts.keySig ?? { fifths: 0, mode: "major" };

  const staves: StaffDef[] = [
    { id: newId(), lines: 5, initialClef: "treble", name: "Soprano", abbreviation: "S." },
    { id: newId(), lines: 5, initialClef: "treble", name: "Alto", abbreviation: "A." },
    { id: newId(), lines: 5, initialClef: "treble8vb", name: "Tenor", abbreviation: "T." },
    { id: newId(), lines: 5, initialClef: "bass", name: "Bass", abbreviation: "B." },
  ];

  const part: Part = {
    id: newId(),
    name: "Choir",
    abbreviation: "Ch.",
    bracket: "bracket",
    staves,
    measures: Array.from({ length: measureCount }, () => ({
      staves: staves.map(() => ({ voices: [emptyVoice(0)] })),
    })),
  };

  return {
    formatVersion: FORMAT_VERSION,
    id: newId(),
    meta: { ...(opts.title ? { title: opts.title } : {}), ...(opts.composer ? { composer: opts.composer } : {}) },
    settings: structuredClone(DEFAULT_SETTINGS),
    measures: Array.from({ length: measureCount }, (_, i) => ({
      id: newId(),
      ...(i === 0 ? { timeSig, keySig } : {}),
      ...(i === measureCount - 1 ? { barline: "final" as const } : {}),
    })),
    parts: [part],
    spanners: [],
    attachments: [],
    layout: structuredClone(EMPTY_LAYOUT_HINTS),
  };
}
