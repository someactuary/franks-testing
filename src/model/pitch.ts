/** Scientific pitch notation. C4 is middle C (MIDI 60). */
export type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export const STEPS: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"];

/** Chromatic alteration in semitones: -2 double flat ... 2 double sharp. */
export type Alter = -2 | -1 | 0 | 1 | 2;

export interface Pitch {
  readonly step: Step;
  readonly alter: Alter;
  readonly octave: number;
}

export function pitch(step: Step, octave: number, alter: Alter = 0): Pitch {
  return { step, alter, octave };
}

const STEP_SEMITONES: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function toMidi(p: Pitch): number {
  return (p.octave + 1) * 12 + STEP_SEMITONES[p.step] + p.alter;
}

/**
 * Diatonic step number: C0 = 0, D0 = 1, ... C4 = 28. Ignores alteration.
 * Used for vertical staff positioning; adjacent integers are adjacent staff positions.
 */
export function diatonic(p: Pitch): number {
  return p.octave * 7 + STEPS.indexOf(p.step);
}

export function fromDiatonic(d: number, alter: Alter = 0): Pitch {
  const octave = Math.floor(d / 7);
  const step = STEPS[((d % 7) + 7) % 7]!;
  return { step, alter, octave };
}

export function pitchEquals(a: Pitch, b: Pitch): boolean {
  return a.step === b.step && a.alter === b.alter && a.octave === b.octave;
}

/** Compare by sounding pitch (MIDI), then by diatonic spelling for enharmonics. */
export function comparePitch(a: Pitch, b: Pitch): number {
  return toMidi(a) - toMidi(b) || diatonic(a) - diatonic(b);
}

export function pitchToString(p: Pitch): string {
  const acc = { "-2": "bb", "-1": "b", "0": "", "1": "#", "2": "x" }[String(p.alter)] ?? "";
  return `${p.step}${acc}${p.octave}`;
}

/** Parse "C4", "F#3", "Bb5", "Ebb2", "Gx4". */
export function parsePitch(s: string): Pitch {
  const m = /^([A-Ga-g])(bb|b|#|x|)(-?\d+)$/.exec(s.trim());
  if (!m) throw new Error(`bad pitch "${s}"`);
  const alter = ({ bb: -2, b: -1, "": 0, "#": 1, x: 2 } as const)[m[2] as "bb" | "b" | "#" | "x" | ""];
  return { step: m[1]!.toUpperCase() as Step, alter, octave: Number(m[3]) };
}

/** Key signature as number of sharps (positive) or flats (negative), -7..7, plus mode. */
export interface KeySignature {
  readonly fifths: number;
  readonly mode: "major" | "minor";
}

const SHARP_ORDER: readonly Step[] = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER: readonly Step[] = ["B", "E", "A", "D", "G", "C", "F"];

/** The alteration a key signature applies to a given step (0 if none). */
export function keyAlter(key: KeySignature, step: Step): Alter {
  if (key.fifths > 0) return SHARP_ORDER.slice(0, key.fifths).includes(step) ? 1 : 0;
  if (key.fifths < 0) return FLAT_ORDER.slice(0, -key.fifths).includes(step) ? -1 : 0;
  return 0;
}

/** Steps altered by the key signature, in the order the accidentals are drawn. */
export function keySignatureSteps(key: KeySignature): readonly Step[] {
  return key.fifths >= 0 ? SHARP_ORDER.slice(0, key.fifths) : FLAT_ORDER.slice(0, -key.fifths);
}
