import { newId } from "./ids";
import { notated, type NoteValue, type TimeSignature } from "./duration";
import { parsePitch, type KeySignature, type Pitch } from "./pitch";
import {
  DEFAULT_SETTINGS,
  EMPTY_LAYOUT_HINTS,
  FORMAT_VERSION,
  type Note,
  type NoteEvent,
  type Part,
  type RestEvent,
  type Score,
  type Voice,
} from "./score";

/** A new piano score with `measureCount` empty measures (each voice 0 holds one whole-measure rest). */
export function newPianoScore(opts: {
  measureCount?: number;
  timeSig?: TimeSignature;
  keySig?: KeySignature;
  title?: string;
  composer?: string;
} = {}): Score {
  const measureCount = opts.measureCount ?? 4;
  const timeSig = opts.timeSig ?? { numerator: 4, denominator: 4 };
  const keySig = opts.keySig ?? { fifths: 0, mode: "major" };
  const part: Part = {
    id: newId(),
    name: "Piano",
    abbreviation: "Pno.",
    staves: [
      { id: newId(), lines: 5, initialClef: "treble" },
      { id: newId(), lines: 5, initialClef: "bass" },
    ],
    measures: Array.from({ length: measureCount }, () => ({
      staves: [{ voices: [emptyVoice(0)] }, { voices: [emptyVoice(0)] }],
    })),
    midiProgram: 0,
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

export function emptyVoice(index: number): Voice {
  return { id: newId(), index, items: [measureRest()] };
}

export function measureRest(): RestEvent {
  return { kind: "rest", id: newId(), duration: notated(1), measureRest: true };
}

export function rest(base: NoteValue, dots: 0 | 1 | 2 | 3 = 0): RestEvent {
  return { kind: "rest", id: newId(), duration: notated(base, dots) };
}

export function note(p: Pitch | string, base: NoteValue, dots: 0 | 1 | 2 | 3 = 0): NoteEvent {
  return chord([p], base, dots);
}

export function chord(ps: (Pitch | string)[], base: NoteValue, dots: 0 | 1 | 2 | 3 = 0): NoteEvent {
  const notes: Note[] = ps.map((p) => ({ id: newId(), pitch: typeof p === "string" ? parsePitch(p) : p }));
  return { kind: "note", id: newId(), duration: notated(base, dots), notes };
}
