import { chord, newId, newPianoScore, note } from "@/model";
import type { Attachment, NoteEvent, Score, Spanner } from "@/model";

/**
 * A grand staff where the two hands meet between the staves.
 *
 * System 0 (m0-m2): after one ordinary measure, the treble chords drop five and
 * six ledger lines below the treble staff (down to G2) while the bass climbs
 * five and six ledger lines above the bass staff (up to F5) *in the same
 * columns*. A slur runs under the low treble chords (their stems are up, so it
 * goes below, between the staves), a p sits under the treble, and an 8va covers
 * the high bass notes (above the bass staff, between the staves again). The gap
 * between the staves must grow to hold all of it.
 *
 * System 1 (m3-m5, forced break): ordinary registers, where the default gap is
 * enough and must be kept.
 */
export function ledgerCrowd(): Score {
  const score = newPianoScore({ measureCount: 6, title: "Ledger Crowd" });
  const part = score.parts[0]!;

  const treble: NoteEvent[][] = [
    [chord(["E4", "G4", "C5"], 4), chord(["F4", "A4", "C5"], 4), chord(["G4", "B4", "D5"], 4), chord(["E4", "G4", "C5"], 4)],
    [chord(["B2", "D3", "G3"], 4), chord(["A2", "C3", "F3"], 4), chord(["G2", "B2", "E3"], 4), chord(["A2", "C3", "F3"], 4)],
    [chord(["B2", "D3", "G3"], 2), chord(["C3", "E3", "G3"], 2)],
    [note("C5", 4), note("D5", 4), note("E5", 4), note("C5", 4)],
    [note("E5", 2), note("D5", 2)],
    [chord(["C5", "E5", "G5"], 1)],
  ];
  const bass: NoteEvent[][] = [
    [note("C3", 2), note("G2", 2)],
    [note("D5", 4), note("E5", 4), note("F5", 4), note("E5", 4)],
    [chord(["B4", "D5"], 2), chord(["C5", "E5"], 2)],
    [note("C3", 4), note("G2", 4), note("C3", 4), note("G2", 4)],
    [note("F2", 2), note("G2", 2)],
    [note("C3", 1)],
  ];
  for (let m = 0; m < 6; m++) {
    part.measures[m]!.staves[0]!.voices[0]!.items = treble[m]!;
    part.measures[m]!.staves[1]!.voices[0]!.items = bass[m]!;
  }

  const at = (ev: NoteEvent) => ({ kind: "event" as const, eventId: ev.id });
  const upper = { partIndex: 0, staffIndex: 0 };
  const lower = { partIndex: 0, staffIndex: 1 };
  const attachments: Attachment[] = [
    { id: newId(), ...upper, kind: "dynamic", text: "p", anchor: at(treble[1]![0]!) },
  ];
  const spanners: Spanner[] = [
    { id: newId(), ...upper, kind: "slur", start: at(treble[1]![0]!), end: at(treble[2]![1]!) },
    { id: newId(), ...lower, kind: "ottava", shift: 8, start: at(bass[1]![0]!), end: at(bass[2]![1]!) },
  ];
  score.attachments = attachments;
  score.spanners = spanners;
  score.layout.systemBreaks = [3];
  return score;
}
