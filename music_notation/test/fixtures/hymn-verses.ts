import { newId, newPianoScore, note } from "@/model";
import type { Attachment, Lyric, NoteEvent, Score } from "@/model";

/** Pitch + note value for one event, written as "G4:4" (a G4 quarter). */
type Spec = string;

function parse(spec: Spec): NoteEvent {
  const [pitch, value] = spec.split(":");
  return note(pitch!, Number(value) as 1 | 2 | 4);
}

/** Every phrase is two measures, four quarters then two quarters and a half: seven syllables. */
const SOPRANO: Spec[][] = [
  ["G4:4", "E4:4", "F4:4", "G4:4"],
  ["A4:4", "G4:4", "E4:2"],
  ["F4:4", "D4:4", "E4:4", "F4:4"],
  ["G4:4", "F4:4", "D4:2"],
  ["C5:4", "B4:4", "A4:4", "G4:4"],
  ["A4:4", "F4:4", "G4:2"],
  ["E4:4", "F4:4", "D4:4", "E4:4"],
  ["D4:4", "D4:4", "E4:2"],
];
const ALTO: Spec[][] = [
  ["E4:4", "C4:4", "D4:4", "E4:4"],
  ["F4:4", "E4:4", "C4:2"],
  ["D4:4", "B3:4", "C4:4", "D4:4"],
  ["E4:4", "D4:4", "B3:2"],
  ["E4:4", "G4:4", "F4:4", "E4:4"],
  ["F4:4", "D4:4", "E4:2"],
  ["C4:4", "D4:4", "B3:4", "C4:4"],
  ["B3:4", "B3:4", "C4:2"],
];
const TENOR: Spec[][] = [
  ["C4:4", "G3:4", "A3:4", "C4:4"],
  ["C4:4", "C4:4", "G3:2"],
  ["A3:4", "G3:4", "G3:4", "A3:4"],
  ["B3:4", "A3:4", "G3:2"],
  ["G3:4", "D4:4", "C4:4", "C4:4"],
  ["C4:4", "A3:4", "C4:2"],
  ["G3:4", "A3:4", "G3:4", "G3:4"],
  ["G3:4", "G3:4", "G3:2"],
];
const BASS: Spec[][] = [
  ["C3:4", "C3:4", "D3:4", "C3:4"],
  ["F2:4", "C3:4", "C3:2"],
  ["D3:4", "G2:4", "C3:4", "D3:4"],
  ["G2:4", "D3:4", "G2:2"],
  ["C3:4", "G2:4", "A2:4", "C3:4"],
  ["F2:4", "D3:4", "C3:2"],
  ["C3:4", "F2:4", "G2:4", "C3:4"],
  ["G2:4", "G2:4", "C3:2"],
];

/**
 * Four verses of invented words, one syllable per soprano note (28 each). A
 * trailing "-" joins a syllable to the next one with a hyphen.
 */
const VERSES: string[][] = [
  [
    "Now", "the", "morn-", "ing", "wakes", "the", "hills,",
    "gold-", "en", "light", "on", "qui-", "et", "streams;",
    "all", "the", "fields", "are", "bright", "and", "still,",
    "sing", "we", "now", "of", "sum-", "mer", "dreams.",
  ],
  [
    "Rain", "has", "washed", "the", "val-", "ley", "clean,",
    "riv-", "ers", "run", "to", "meet", "the", "sea;",
    "ev-", "ery", "branch", "is", "dressed", "in", "green,",
    "wind", "is", "sing-", "ing", "through", "the", "tree.",
  ],
  [
    "When", "the", "eve-", "ning", "shad-", "ows", "fall,",
    "lamps", "are", "lit", "in", "ev-", "ery", "door;",
    "friends", "are", "gath-", "ered,", "one", "and", "all,",
    "home", "is", "warm", "for", "rich", "and", "poor.",
  ],
  [
    "La", "la", "lo,", "the", "day", "is", "done;",
    "ah,", "the", "stars", "are", "shin-", "ing", "bright;",
    "rest", "now,", "ev-", "ery", "wear-", "y", "one,",
    "sleep", "in", "peace", "un-", "til", "the", "light.",
  ],
];

function verse(index: number, words: string[]): Lyric[] {
  let hyphenated = false;
  return words.map((word) => {
    const continues = word.endsWith("-");
    const text = continues ? word.slice(0, -1) : word;
    const syllabic: Lyric["syllabic"] = continues
      ? hyphenated
        ? "middle"
        : "begin"
      : hyphenated
        ? "end"
        : "single";
    hyphenated = continues;
    return { verse: index, text, syllabic };
  });
}

/**
 * A hymn on a grand staff: one part, two staves joined by a brace, SATB as two
 * voices per staff (soprano/alto in the treble, tenor/bass in the bass; voice 0
 * stems up, voice 1 stems down), eight measures of 4/4 in C major, with
 * `verseCount` verses of words (four by default) under the treble staff.
 *
 * This is the page that used to collide: four lyric lanes hang far below the
 * treble staff, so the gap to the bass staff has to grow to hold them. The mf
 * goes above the treble (the words own the space below it); the p under the bass
 * staff sits in the ordinary dynamics lane. A forced break after m4 gives two
 * systems.
 */
export function hymnVerses(verseCount = 4): Score {
  const score = newPianoScore({ measureCount: 8, title: "Hymn Verses" });
  const part = score.parts[0]!;

  const build = (lines: Spec[][]) => lines.map((m) => m.map(parse));
  const soprano = build(SOPRANO);
  const alto = build(ALTO);
  const tenor = build(TENOR);
  const bass = build(BASS);
  for (let m = 0; m < 8; m++) {
    part.measures[m]!.staves[0]!.voices = [
      { id: newId(), index: 0, items: soprano[m]! },
      { id: newId(), index: 1, items: alto[m]! },
    ];
    part.measures[m]!.staves[1]!.voices = [
      { id: newId(), index: 0, items: tenor[m]! },
      { id: newId(), index: 1, items: bass[m]! },
    ];
  }

  const melody = soprano.flat();
  const verses = VERSES.slice(0, Math.max(0, Math.min(VERSES.length, verseCount))).map((words, i) =>
    verse(i, words),
  );
  for (const [i, ev] of melody.entries()) {
    const lyrics = verses.map((v) => v[i]).filter((l) => l !== undefined);
    if (lyrics.length > 0) ev.lyrics = lyrics;
  }

  const at = (ev: NoteEvent) => ({ kind: "event" as const, eventId: ev.id });
  const attachments: Attachment[] = [
    { id: newId(), partIndex: 0, staffIndex: 0, kind: "dynamic", text: "mf", anchor: at(melody[0]!) },
    { id: newId(), partIndex: 0, staffIndex: 1, kind: "dynamic", text: "p", anchor: at(bass[4]![0]!) },
  ];
  score.attachments = attachments;
  score.layout.systemBreaks = [4];
  return score;
}
