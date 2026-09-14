import { chord, newPianoScore, note } from "@/model";
import type { NoteEvent, Ornament, Score } from "@/model";

/** Attach ornaments to an event. */
function orn(ev: NoteEvent, ...marks: Ornament[]): NoteEvent {
  return { ...ev, ornaments: marks };
}

/** Mark an event as arpeggiated. */
function arp(ev: NoteEvent, direction: "up" | "down" | "straight"): NoteEvent {
  return { ...ev, arpeggio: direction };
}

/** Put `strokes` tremolo beams on an event. */
function trem(ev: NoteEvent, strokes: 1 | 2 | 3): NoteEvent {
  return { ...ev, tremolo: strokes };
}

/**
 * Four measures in 4/4, C major, covering every note decoration the M3 pass
 * draws. Nothing here is music; each measure is a row of specimens.
 *
 * Treble:
 *   m0  trill, mordent, inverted mordent, turn — one per quarter
 *   m1  inverted turn, a note carrying a trill *and* a mordent (they stack), and
 *       an arpeggiated chord upwards whose accidental the wiggle must clear
 *   m2  the same chord arpeggiated downwards, then a plain (straight) arpeggio
 *   m3  a whole note with three tremolo strokes — the stemless case, where the
 *       strokes sit beside the notehead on the side the stem would have been
 * Bass:
 *   m0  tremolo 1 / 2 / 3 on up-stem quarters, then a plain note
 *   m1  a down-stem half with three strokes, and an up-stem half with one
 *   m2  a two-stroke half, then a plain half
 *   m3  a whole note with two tremolo strokes (stem down side)
 */
export function ornaments(): Score {
  const score = newPianoScore({ measureCount: 4, title: "Ornaments" });
  const part = score.parts[0]!;

  const treble: NoteEvent[][] = [
    [
      orn(note("C5", 4), "trill"),
      orn(note("D5", 4), "mordent"),
      orn(note("E5", 4), "invertedMordent"),
      orn(note("F5", 4), "turn"),
    ],
    [
      orn(note("G5", 4), "invertedTurn"),
      orn(note("A5", 4), "trill", "mordent"),
      arp(chord(["C5", "Eb5", "G5"], 2), "up"),
    ],
    [arp(chord(["C5", "E5", "G5"], 2), "down"), arp(chord(["D5", "F5", "A5"], 2), "straight")],
    [trem(note("C5", 1), 3)],
  ];

  const bass: NoteEvent[][] = [
    [trem(note("C3", 4), 1), trem(note("D3", 4), 2), trem(note("E3", 4), 3), note("F3", 4)],
    [trem(note("G3", 2), 3), trem(note("C3", 2), 1)],
    [trem(note("C3", 2), 2), note("G2", 2)],
    [trem(note("C3", 1), 2)],
  ];

  for (let m = 0; m < 4; m++) {
    part.measures[m]!.staves[0]!.voices[0]!.items = treble[m]!;
    part.measures[m]!.staves[1]!.voices[0]!.items = bass[m]!;
  }
  return score;
}
