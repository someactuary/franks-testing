import { chord, frac, newId, newPianoScore, note, notated, ZERO } from "@/model";
import type { Articulation, Attachment, NoteEvent, Score, Spanner } from "@/model";

/** Add articulations to an event. */
function artic(ev: NoteEvent, ...marks: Articulation[]): NoteEvent {
  return { ...ev, articulations: marks };
}

/** Fingering per note of the event, in ascending pitch order. */
function fing(ev: NoteEvent, ...fingers: string[]): NoteEvent {
  return {
    ...ev,
    notes: ev.notes.map((n, i) => (fingers[i] ? { ...n, fingering: fingers[i] } : n)),
  };
}

/**
 * Six measures in 3/4, C major, with a forced system break before measure index 3,
 * exercising every attachment and spanner the expressive passes draw.
 *
 * Treble:
 *   m0  a scale with staccato / tenuto / accent on down-stem notes, fingering 1-2-3
 *   m1  the start of a four-note slur and of a crescendo hairpin, fingering 4-5
 *   m2  the chord both of them end on (two fingerings), then a slur that runs over
 *       the system break
 *   m3  the note that slur lands on, a mf, and a diminuendo
 *   m4  the diminuendo's end
 *   m5  sfz, an 8va over the last two beats and a fermata on the final note
 * Bass:
 *   m0  staccato / accent on up-stem notes and a marcato on a down-stem one
 *   m0-m1 a pedal drawn with "Ped." and "*", m4-m5 the same pedal as a bracket line
 *
 * Text: "Andante ♩ = 76" over measure 0 and an italic "dolce" under the treble staff.
 */
export function expressive(): Score {
  const score = newPianoScore({
    measureCount: 6,
    timeSig: { numerator: 3, denominator: 4 },
    title: "Expressive",
  });
  const part = score.parts[0]!;

  const treble: NoteEvent[][] = [
    [
      fing(artic(note("C5", 4), "staccato"), "1"),
      fing(artic(note("D5", 4), "tenuto"), "2"),
      fing(artic(note("E5", 4), "accent"), "3"),
    ],
    [fing(note("F5", 4), "4"), fing(note("G5", 4), "5"), note("A5", 4)],
    [fing(chord(["C5", "E5"], 4), "1", "3"), note("B4", 4), note("C5", 4)],
    [note("D5", 4), note("E5", 4), note("F5", 4)],
    [note("E5", 4), note("F5", 4), note("G5", 4)],
    [note("A5", 4), note("B5", 4), note("C6", 4)],
  ];

  const bass: NoteEvent[][] = [
    [artic(note("C3", 4), "staccato"), artic(note("G2", 4), "accent"), artic(note("B3", 4), "marcato")],
    [note("C3", 2), note("G2", 4)],
    [note("C3", 2), note("E3", 4)],
    [note("G2", 2, 1)],
    [note("F2", 2, 1)],
    [note("C3", 2, 1)],
  ];

  for (let m = 0; m < 6; m++) {
    part.measures[m]!.staves[0]!.voices[0]!.items = treble[m]!;
    part.measures[m]!.staves[1]!.voices[0]!.items = bass[m]!;
  }

  const t = (m: number, i: number): string => treble[m]![i]!.id;
  const b = (m: number, i: number): string => bass[m]![i]!.id;
  const at = (id: string) => ({ kind: "event" as const, eventId: id });
  const upper = { partIndex: 0, staffIndex: 0 };
  const lower = { partIndex: 0, staffIndex: 1 };

  const attachments: Attachment[] = [
    {
      id: newId(),
      ...upper,
      kind: "tempo",
      text: "Andante",
      beatUnit: notated(4),
      bpm: 76,
      anchor: { kind: "measure", measureIndex: 0, offset: ZERO },
    },
    { id: newId(), ...upper, kind: "dynamic", text: "p", anchor: at(t(0, 0)) },
    {
      id: newId(),
      ...upper,
      kind: "text",
      text: "dolce",
      style: "expression",
      placement: "below",
      anchor: at(t(0, 1)),
    },
    { id: newId(), ...upper, kind: "dynamic", text: "ff", anchor: at(t(2, 0)) },
    { id: newId(), ...upper, kind: "dynamic", text: "mf", anchor: at(t(3, 0)) },
    { id: newId(), ...upper, kind: "dynamic", text: "sfz", anchor: at(t(5, 0)) },
    { id: newId(), ...upper, kind: "fermata", anchor: at(t(5, 2)) },
  ];

  const spanners: Spanner[] = [
    // Four notes under one slur, ending on the chord in m2.
    { id: newId(), ...upper, kind: "slur", start: at(t(1, 0)), end: at(t(2, 0)) },
    // ... and one that runs over the system break into m3.
    { id: newId(), ...upper, kind: "slur", start: at(t(2, 2)), end: at(t(3, 1)) },
    // Crescendo into the ff, then a diminuendo that ends on no dynamic at all.
    { id: newId(), ...upper, kind: "hairpin", shape: "cresc", start: at(t(1, 0)), end: at(t(2, 0)) },
    { id: newId(), ...upper, kind: "hairpin", shape: "dim", start: at(t(3, 1)), end: at(t(4, 2)) },
    // Pedal: "Ped. ... *" over the first two measures, a bracket over the last two.
    { id: newId(), ...lower, kind: "pedal", style: "text", start: at(b(0, 0)), end: at(b(1, 1)) },
    {
      id: newId(),
      ...lower,
      kind: "pedal",
      style: "line",
      start: at(b(4, 0)),
      end: { kind: "measure", measureIndex: 5, offset: frac(1, 2) },
    },
    // 8va over the last two beats.
    { id: newId(), ...upper, kind: "ottava", shift: 8, start: at(t(5, 1)), end: at(t(5, 2)) },
  ];

  score.attachments = attachments;
  score.spanners = spanners;
  score.layout.systemBreaks = [3];
  return score;
}
