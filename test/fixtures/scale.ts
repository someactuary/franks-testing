import { newPianoScore, note } from "@/model";
import type { Score } from "@/model";

/**
 * C major scale up and down in quarter notes, treble staff.
 * Bass plays whole-note roots.
 * 4/4, 4 measures.
 */
export function scale(): Score {
  const score = newPianoScore({ measureCount: 4 });

  // Clear all default measures and populate with scale content
  const part = score.parts[0]!;

  // Measure 0: C D E F (treble), C whole (bass)
  part.measures[0]!.staves[0]!.voices[0]!.items = [
    note("C4", 4),
    note("D4", 4),
    note("E4", 4),
    note("F4", 4),
  ];
  part.measures[0]!.staves[1]!.voices[0]!.items = [note("C3", 1)];

  // Measure 1: G A B C5 (treble), G whole (bass)
  part.measures[1]!.staves[0]!.voices[0]!.items = [
    note("G4", 4),
    note("A4", 4),
    note("B4", 4),
    note("C5", 4),
  ];
  part.measures[1]!.staves[1]!.voices[0]!.items = [note("G3", 1)];

  // Measure 2: C5 B A G (treble), C whole (bass)
  part.measures[2]!.staves[0]!.voices[0]!.items = [
    note("C5", 4),
    note("B4", 4),
    note("A4", 4),
    note("G4", 4),
  ];
  part.measures[2]!.staves[1]!.voices[0]!.items = [note("C3", 1)];

  // Measure 3: F E D C (treble), C whole (bass)
  part.measures[3]!.staves[0]!.voices[0]!.items = [
    note("F4", 4),
    note("E4", 4),
    note("D4", 4),
    note("C4", 4),
  ];
  part.measures[3]!.staves[1]!.voices[0]!.items = [note("C3", 1)];

  return score;
}
