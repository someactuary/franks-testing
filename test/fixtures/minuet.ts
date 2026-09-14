import { newPianoScore, note } from "@/model";
import type { Score } from "@/model";

/**
 * A 16-measure simple minuet-like piece in G major, 3/4,
 * single voice per staff, with a final barline.
 * Title "Minuet in G", composer "Test".
 */
export function minuet(): Score {
  const score = newPianoScore({
    measureCount: 16,
    timeSig: { numerator: 3, denominator: 4 },
    keySig: { fifths: 1, mode: "major" }, // G major: F#
    title: "Minuet in G",
    composer: "Test",
  });
  const part = score.parts[0]!;

  // A section (measures 0-7) - main theme
  const aSection = [
    [note("G4", 4), note("A4", 4), note("B4", 4)], // m0
    [note("C5", 4), note("B4", 4), note("A4", 4)], // m1
    [note("B4", 2), note("G4", 4)], // m2
    [note("D4", 4), note("E4", 4), note("F#4", 4)], // m3
    [note("G4", 2), note("G4", 4)], // m4
    [note("A4", 4), note("B4", 4), note("C5", 4)], // m5
    [note("D5", 4), note("C5", 4), note("B4", 4)], // m6
    [note("A4", 2), note("G4", 4)], // m7
  ];

  // B section (measures 8-15) - contrasting section
  const bSection = [
    [note("B4", 4), note("C5", 4), note("D5", 4)], // m8
    [note("E5", 4), note("D5", 4), note("C5", 4)], // m9
    [note("B4", 2), note("B4", 4)], // m10
    [note("G4", 4), note("A4", 4), note("B4", 4)], // m11
    [note("C5", 2), note("B4", 4)], // m12
    [note("A4", 4), note("B4", 4), note("C5", 4)], // m13
    [note("B4", 2), note("A4", 4)], // m14
    [note("G4", 2), note("G4", 4)], // m15 (final measure)
  ];

  const allSections = [...aSection, ...bSection];

  // Fill treble staff with melody
  for (let i = 0; i < 16; i++) {
    part.measures[i]!.staves[0]!.voices[0]!.items = allSections[i]!;
  }

  // Fill bass staff with whole notes (or half + quarter patterns)
  const bassNotes = [
    "G3", "G3", "G3", "D3", "G3", "G3", "D3", "G3",
    "G3", "G3", "G3", "E3", "A3", "D3", "E3", "G3",
  ];

  for (let i = 0; i < 16; i++) {
    part.measures[i]!.staves[1]!.voices[0]!.items = [note(bassNotes[i]!, 2), note(bassNotes[i]!, 4)];
  }

  // Ensure final barline
  if (score.measures[15]) {
    score.measures[15].barline = "final";
  }

  return score;
}
