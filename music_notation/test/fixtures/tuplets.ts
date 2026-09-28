import { newId, newPianoScore, note } from "@/model";
import type { NoteValue, Score, TupletGroup, VoiceItem } from "@/model";

function tuplet(
  actual: number,
  normal: number,
  unit: NoteValue,
  items: VoiceItem[],
  opts: { bracket?: TupletGroup["bracket"]; showNumber?: TupletGroup["showNumber"] } = {},
): TupletGroup {
  return {
    kind: "tuplet",
    id: newId(),
    ratio: { actual, normal, unit },
    items,
    ...(opts.bracket ? { bracket: opts.bracket } : {}),
    ...(opts.showNumber ? { showNumber: opts.showNumber } : {}),
  };
}

/**
 * Four measures of tuplets.
 *
 *   m0  two triplets of eighths. The first takes the default `bracket: "auto"`,
 *       so — being exactly one beam group — it shows the number alone; the second
 *       forces `bracket: "show"`. Then a half note.
 *   m1  a quarter-note triplet: nothing to beam, so it always draws its bracket.
 *   m2  a nested tuplet (a triplet of eighths whose middle eighth is itself a
 *       triplet of sixteenths), a quintuplet of sixteenths labelled "5:4", and a
 *       half note.
 *   m3  6/8: a duplet (two eighths in the time of three) with `bracket: "hide"`,
 *       then three beamed eighths.
 */
export function tuplets(): Score {
  const score = newPianoScore({ measureCount: 4, title: "Tuplets" });
  const part = score.parts[0]!;
  score.measures[3]!.timeSig = { numerator: 6, denominator: 8 };

  const m0: VoiceItem[] = [
    tuplet(3, 2, 8, [note("C5", 8), note("D5", 8), note("E5", 8)]),
    tuplet(3, 2, 8, [note("F5", 8), note("E5", 8), note("D5", 8)], { bracket: "show" }),
    note("C5", 2),
  ];

  const m1: VoiceItem[] = [
    tuplet(3, 2, 4, [note("E5", 4), note("D5", 4), note("C5", 4)]),
    note("G4", 2),
  ];

  const m2: VoiceItem[] = [
    tuplet(3, 2, 8, [
      note("C5", 8),
      tuplet(3, 2, 16, [note("D5", 16), note("E5", 16), note("F5", 16)]),
      note("G5", 8),
    ]),
    tuplet(
      5,
      4,
      16,
      [note("A4", 16), note("B4", 16), note("C5", 16), note("D5", 16), note("E5", 16)],
      {
        showNumber: "ratio",
      },
    ),
    note("C5", 2),
  ];

  const m3: VoiceItem[] = [
    tuplet(2, 3, 8, [note("G4", 8), note("A4", 8)], { bracket: "hide" }),
    note("B4", 8),
    note("C5", 8),
    note("D5", 8),
  ];

  const treble = [m0, m1, m2, m3];
  const bass: VoiceItem[][] = [
    [note("C3", 1)],
    [note("G2", 1)],
    [note("C3", 1)],
    [note("G2", 2, 1)], // 6/8 = a dotted half
  ];

  for (let m = 0; m < 4; m++) {
    part.measures[m]!.staves[0]!.voices[0]!.items = treble[m]!;
    part.measures[m]!.staves[1]!.voices[0]!.items = bass[m]!;
  }

  return score;
}
