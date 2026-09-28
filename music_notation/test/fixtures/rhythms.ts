import { measureRest, newPianoScore, note, rest } from "@/model";
import type { Score } from "@/model";

/**
 * 4/4, 4 measures exercising various rhythms:
 * whole, half, dotted quarter+eighth, quarter, quarter rest,
 * eighth pairs, four sixteenths, dotted half, eighth rest, dotted eighth+sixteenth,
 * and one measureRest (bass, last measure).
 */
export function rhythms(): Score {
  const score = newPianoScore({ measureCount: 4 });
  const part = score.parts[0]!;

  // Measure 0: whole note
  part.measures[0]!.staves[0]!.voices[0]!.items = [note("C4", 1)];
  part.measures[0]!.staves[1]!.voices[0]!.items = [note("C3", 1)];

  // Measure 1: half + dotted quarter + eighth (dotted quarter+eighth rhythm)
  part.measures[1]!.staves[0]!.voices[0]!.items = [
    note("D4", 2), // half
    note("E4", 4, 1), // dotted quarter
    note("F4", 8), // eighth
  ];
  part.measures[1]!.staves[1]!.voices[0]!.items = [note("D3", 1)];

  // Measure 2: quarter + quarter rest + eighth + eighth + four sixteenths
  part.measures[2]!.staves[0]!.voices[0]!.items = [
    note("G4", 4), // quarter
    rest(8), // eighth rest
    note("A4", 8), // eighth
    note("B4", 8), // eighth (pair starts)
    note("C5", 8), // eighth (pair ends)
    note("C5", 16), // sixteenth
    note("D5", 16), // sixteenth
    note("E5", 16), // sixteenth
    note("F5", 16), // sixteenth
  ];
  part.measures[2]!.staves[1]!.voices[0]!.items = [note("G3", 2), rest(4), note("G3", 4)];

  // Measure 3: dotted half + dotted eighth + sixteenth
  part.measures[3]!.staves[0]!.voices[0]!.items = [
    note("G4", 2, 1), // dotted half
    note("A4", 8, 1), // dotted eighth
    note("B4", 16), // sixteenth
  ];
  part.measures[3]!.staves[1]!.voices[0]!.items = [measureRest()];

  return score;
}
