import { newId, newPianoScore, note, rest } from "@/model";
import type { RestEvent, Score, Voice, VoiceItem } from "@/model";

function voice(index: number, items: VoiceItem[]): Voice {
  return { id: newId(), index, items };
}

function invisible(ev: RestEvent): RestEvent {
  return { ...ev, invisible: true };
}

/**
 * Two voices on each staff of a grand staff, 4/4, two measures.
 *
 * Treble: soprano (voice 0, stems up) against alto (voice 1, stems down).
 *   m0  four quarters rising against four quarters falling — contrary motion.
 *   m1  four eighths in each voice, which must beam as two separate groups. Both
 *       voices hit D5 on the fourth eighth: a unison collision, so the alto's
 *       notehead is nudged right. The alto then rests — a voice-1 rest, so it
 *       sits a space low.
 *
 * Bass: tenor (voice 0) over a sustained bass (voice 1).
 *   m0  four quarters over a whole note.
 *   m1  an INVISIBLE quarter rest — it draws nothing but still owns its column —
 *       then a quarter, a plain voice-0 rest (which sits a space high) and a
 *       quarter, all over another whole note.
 */
export function voices(): Score {
  const score = newPianoScore({ measureCount: 2, title: "Voices" });
  const part = score.parts[0]!;

  const soprano: VoiceItem[][] = [
    [note("C5", 4), note("D5", 4), note("E5", 4), note("F5", 4)],
    [note("G5", 8), note("F5", 8), note("E5", 8), note("D5", 8), note("C5", 2)],
  ];
  const alto: VoiceItem[][] = [
    [note("A4", 4), note("G4", 4), note("F4", 4), note("E4", 4)],
    [note("A4", 8), note("B4", 8), note("C5", 8), note("D5", 8), note("G4", 4), rest(4)],
  ];
  const tenor: VoiceItem[][] = [
    [note("C3", 4), note("D3", 4), note("E3", 4), note("F3", 4)],
    [invisible(rest(4)), note("E3", 4), rest(4), note("G3", 4)],
  ];
  const bass: VoiceItem[][] = [[note("C2", 1)], [note("C2", 1)]];

  for (let m = 0; m < 2; m++) {
    part.measures[m]!.staves[0]!.voices = [voice(0, soprano[m]!), voice(1, alto[m]!)];
    part.measures[m]!.staves[1]!.voices = [voice(0, tenor[m]!), voice(1, bass[m]!)];
  }

  return score;
}
