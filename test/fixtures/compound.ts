import { newPianoScore, note } from "@/model";
import type { Score } from "@/model";

/**
 * 6/8, 2 measures of eighths in groups of three and a dotted quarter.
 * Bass plays whole notes.
 */
export function compound(): Score {
  const score = newPianoScore({
    measureCount: 2,
    timeSig: { numerator: 6, denominator: 8 },
  });
  const part = score.parts[0]!;

  // Measure 0: dotted quarter + three eighths
  part.measures[0]!.staves[0]!.voices[0]!.items = [
    note("C4", 4, 1), // dotted quarter
    note("D4", 8), // eighth
    note("E4", 8), // eighth
    note("F4", 8), // eighth
  ];
  part.measures[0]!.staves[1]!.voices[0]!.items = [note("C3", 2, 1)]; // dotted half (6/8 = 3/4)

  // Measure 1: two groups of three eighths
  part.measures[1]!.staves[0]!.voices[0]!.items = [
    note("G4", 8),
    note("A4", 8),
    note("B4", 8),
    note("C5", 8),
    note("D5", 8),
    note("E5", 8),
  ];
  part.measures[1]!.staves[1]!.voices[0]!.items = [note("G3", 2, 1)]; // dotted half

  return score;
}
