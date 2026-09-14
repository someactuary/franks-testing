import { emptyVoice, newId, newPianoScore, note } from "@/model";
import type { PartMeasure, Score, StaffDef, VoiceItem } from "@/model";

const STAVES: { name: string; abbreviation: string; clef: StaffDef["initialClef"] }[] = [
  { name: "Soprano", abbreviation: "S.", clef: "treble" },
  { name: "Alto", abbreviation: "A.", clef: "treble" },
  { name: "Tenor", abbreviation: "T.", clef: "treble8vb" },
  { name: "Bass", abbreviation: "B.", clef: "bass" },
];

/**
 * One part of four named staves joined by a bracket — the staff-group case that
 * the piano fixtures never exercise. Four measures of a plain chorale, one voice
 * per staff, with a system break after m1 so the second system shows the
 * abbreviations instead of the full names.
 */
export function satb(): Score {
  const score = newPianoScore({ measureCount: 4, title: "SATB" });
  const part = score.parts[0]!;
  part.name = "Chorale";
  part.abbreviation = "Chor.";
  part.bracket = "bracket";
  part.staves = STAVES.map((s) => ({
    id: newId(),
    lines: 5,
    initialClef: s.clef,
    name: s.name,
    abbreviation: s.abbreviation,
  }));
  part.measures = Array.from<unknown, PartMeasure>({ length: 4 }, () => ({
    staves: STAVES.map(() => ({ voices: [emptyVoice(0)] })),
  }));

  const lines: string[][][] = [
    // Soprano
    [["G4", "G4", "A4", "B4"], ["C5", "B4", "A4", "G4"], ["A4", "B4", "C5", "B4"], ["C5"]],
    // Alto
    [["E4", "E4", "F4", "G4"], ["G4", "G4", "F4", "E4"], ["F4", "G4", "G4", "G4"], ["E4"]],
    // Tenor (written in treble 8vb)
    [["C4", "C4", "C4", "D4"], ["E4", "D4", "C4", "C4"], ["C4", "D4", "E4", "D4"], ["G3"]],
    // Bass
    [["C3", "C3", "F2", "G2"], ["C3", "G2", "F2", "C3"], ["F2", "G2", "C3", "G2"], ["C3"]],
  ];

  for (const [si, staffLine] of lines.entries()) {
    for (const [mi, pitches] of staffLine.entries()) {
      const items: VoiceItem[] = pitches.map((p) => note(p, pitches.length === 1 ? 1 : 4));
      part.measures[mi]!.staves[si]!.voices[0]!.items = items;
    }
  }

  score.layout.systemBreaks = [2];
  return score;
}
