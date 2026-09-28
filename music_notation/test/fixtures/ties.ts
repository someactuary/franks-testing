import { chord, newPianoScore, note } from "@/model";
import type { NoteEvent, Score } from "@/model";

/** Mark notes of an event as tie starts — all of them, or only the given indices. */
function tie(ev: NoteEvent, indices?: number[]): NoteEvent {
  return {
    ...ev,
    notes: ev.notes.map((n, i) =>
      indices === undefined || indices.includes(i) ? { ...n, tieStart: true } : n,
    ),
  };
}

/**
 * Six measures in 4/4, C major, with a forced system break at measure 3.
 *
 * Treble:
 *   m0  two quarters tied inside the measure, then a quarter tied over the barline
 *   m1  the receiving F5, then a plain descent
 *   m2  a three-note chord whose outer notes are tied, twice — the second pair
 *       ties across the system break into m3
 *   m3  receives that tie, and ends on an F#5 tied over the barline
 *   m4  the tied-to F#5 (no accidental of its own), then the same pitch untied,
 *       which does get one
 *   m5  a plain close
 *
 * Bass: whole notes tied across the barline, both inside a system (m3 → m4) and
 * over the system break (m2 has no tie, so the m0 → m1 tie stays mid-system).
 */
export function ties(): Score {
  const score = newPianoScore({ measureCount: 6, title: "Ties" });
  const part = score.parts[0]!;

  const treble: NoteEvent[][] = [
    [tie(note("C5", 4)), note("C5", 4), note("E5", 4), tie(note("F5", 4))],
    [note("F5", 4), note("E5", 4), note("D5", 4), note("C5", 4)],
    [
      tie(chord(["C5", "E5", "G5"], 2), [0, 2]),
      tie(chord(["C5", "E5", "G5"], 2), [0, 2]),
    ],
    [chord(["C5", "G5"], 4), note("D5", 4), note("E5", 4), tie(note("F#5", 4))],
    [note("F#5", 4), note("G5", 4), note("F#5", 4), note("A5", 4)],
    [note("G5", 2), note("C5", 2)],
  ];

  const bass: NoteEvent[][] = [
    [tie(note("C3", 1))],
    [note("C3", 1)],
    [note("C3", 2), note("G2", 2)],
    [tie(note("C3", 1))],
    [note("C3", 1)],
    [note("C3", 1)],
  ];

  for (let m = 0; m < 6; m++) {
    part.measures[m]!.staves[0]!.voices[0]!.items = treble[m]!;
    part.measures[m]!.staves[1]!.voices[0]!.items = bass[m]!;
  }

  score.layout.systemBreaks = [3];
  return score;
}
