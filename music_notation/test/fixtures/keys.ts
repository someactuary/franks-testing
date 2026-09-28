import { newPianoScore, note } from "@/model";
import type { Score } from "@/model";

/**
 * 3 measures in 3/4 in D major (fifths 2) with F#/C# from the key,
 * one explicit G# (alter 1) that recurs later in the same measure
 * and once in the next measure, and a natural cancellation
 * (F with alter 0 in the same measure after the key-signature F#).
 * D major key signature has 2 sharps: F# and C#.
 */
export function keys(): Score {
  const score = newPianoScore({
    measureCount: 3,
    timeSig: { numerator: 3, denominator: 4 },
    keySig: { fifths: 2, mode: "major" }, // D major: F#, C#
  });
  const part = score.parts[0]!;

  // Measure 0: F# (from key), F natural (cancel), G# (explicit), G# (recurs), C# (from key)
  part.measures[0]!.staves[0]!.voices[0]!.items = [
    note("F#4", 8), // F# from key
    note("F4", 8), // F natural to cancel key F#
    note("G#4", 8), // explicit G#
    note("G#4", 8), // G# recurs in same measure
    note("C#5", 4), // C# from key
  ];
  part.measures[0]!.staves[1]!.voices[0]!.items = [note("D3", 2, 1)]; // dotted half

  // Measure 1: includes G# from next occurrence
  part.measures[1]!.staves[0]!.voices[0]!.items = [
    note("D5", 4),
    note("E5", 4),
    note("G#5", 4), // G# once in next measure
  ];
  part.measures[1]!.staves[1]!.voices[0]!.items = [note("B3", 2, 1)]; // dotted half

  // Measure 2: other notes
  part.measures[2]!.staves[0]!.voices[0]!.items = [
    note("A4", 4),
    note("B4", 4),
    note("E5", 4),
  ];
  part.measures[2]!.staves[1]!.voices[0]!.items = [note("G3", 2, 1)]; // dotted half

  return score;
}
