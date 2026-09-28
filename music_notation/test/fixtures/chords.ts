import { chord, newPianoScore } from "@/model";
import type { Score } from "@/model";

/**
 * 4/4, 2 measures of triads, one chord containing an adjacent second (e.g. C4 D4 G4),
 * plus a dotted chord. Bass has octaves.
 */
export function chords(): Score {
  const score = newPianoScore({ measureCount: 2 });
  const part = score.parts[0]!;

  // Measure 0: four triads
  part.measures[0]!.staves[0]!.voices[0]!.items = [
    chord(["C4", "E4", "G4"], 4), // C major triad
    chord(["D4", "F4", "A4"], 4), // D minor triad
    chord(["E4", "G4", "B4"], 4), // E minor triad
    chord(["F4", "A4", "C5"], 4), // F major triad
  ];
  part.measures[0]!.staves[1]!.voices[0]!.items = [
    chord(["C2", "C3"], 4), // C octave
    chord(["D2", "D3"], 4), // D octave
    chord(["E2", "E3"], 4), // E octave
    chord(["F2", "F3"], 4), // F octave
  ];

  // Measure 1: triads, adjacent second chord, dotted chord
  part.measures[1]!.staves[0]!.voices[0]!.items = [
    chord(["G4", "B4", "D5"], 4), // G major triad
    chord(["C4", "D4", "G4"], 4), // chord with adjacent second (C-D-G)
    chord(["F4", "A4", "C5"], 4, 1), // dotted quarter chord
    chord(["A4", "C5", "E5"], 8), // eighth chord to fill measure
  ];
  part.measures[1]!.staves[1]!.voices[0]!.items = [
    chord(["G2", "G3"], 4), // G octave
    chord(["C2", "C3"], 4), // C octave
    chord(["F2", "F3"], 4), // F octave
    chord(["A2", "A3"], 4), // A octave
  ];

  return score;
}
