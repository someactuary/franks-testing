/**
 * Pure pitch-spelling helper for semitone transposition. No draft mutation;
 * src/commands/edit.ts's `transposeNotes` command uses this to move notes.
 */
import type { Alter, Pitch, Step } from "@/model/pitch";

const STEP_SEMITONES: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

interface Spelling {
  step: Step;
  alter: Alter;
}

/**
 * Fixed spelling of each chromatic class (0 = C .. 11 = B) used when moving up (all
 * sharps) or down (all flats). Looking a pitch's *current* spelling up in neither
 * table; only the destination class is looked up, which is what gives the simple,
 * MuseScore-like behavior of always sharpening on the way up and flattening on the
 * way down, while landing on the natural letter for the two semitones that have no
 * black key between them (B-C and E-F).
 */
const UP_SPELLING: readonly Spelling[] = [
  { step: "C", alter: 0 },
  { step: "C", alter: 1 },
  { step: "D", alter: 0 },
  { step: "D", alter: 1 },
  { step: "E", alter: 0 },
  { step: "F", alter: 0 },
  { step: "F", alter: 1 },
  { step: "G", alter: 0 },
  { step: "G", alter: 1 },
  { step: "A", alter: 0 },
  { step: "A", alter: 1 },
  { step: "B", alter: 0 },
];

const DOWN_SPELLING: readonly Spelling[] = [
  { step: "C", alter: 0 },
  { step: "D", alter: -1 },
  { step: "D", alter: 0 },
  { step: "E", alter: -1 },
  { step: "E", alter: 0 },
  { step: "F", alter: 0 },
  { step: "G", alter: -1 },
  { step: "G", alter: 0 },
  { step: "A", alter: -1 },
  { step: "A", alter: 0 },
  { step: "B", alter: -1 },
  { step: "B", alter: 0 },
];

/**
 * Moves `p` by one semitone (dir 1 = up, -1 = down), re-spelling with simple
 * MuseScore-like rules: up prefers sharps and drops to the next natural letter
 * when the semitone is a natural one (E->F, B->C); down mirrors with flats
 * (C->B, F->E). Never produces an alter beyond +-1. The octave (scientific
 * pitch notation) only changes when the letter crosses the B/C boundary.
 */
export function transposeSemitone(p: Pitch, dir: 1 | -1): Pitch {
  const chromaClass = (((STEP_SEMITONES[p.step] + p.alter) % 12) + 12) % 12;
  const table = dir === 1 ? UP_SPELLING : DOWN_SPELLING;
  const nextClass = ((chromaClass + dir) % 12 + 12) % 12;
  const spelled = table[nextClass]!;

  let octave = p.octave;
  if (p.step === "B" && spelled.step === "C") octave += 1;
  else if (p.step === "C" && spelled.step === "B") octave -= 1;

  return { step: spelled.step, alter: spelled.alter, octave };
}
