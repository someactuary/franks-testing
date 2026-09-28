import { emptyVoice, newId, newPianoScore, note } from "@/model";
import type {
  Attachment,
  Lyric,
  NoteEvent,
  PartMeasure,
  Score,
  Spanner,
  StaffDef,
} from "@/model";

const STAVES: { name: string; abbreviation: string; clef: StaffDef["initialClef"] }[] = [
  { name: "Soprano", abbreviation: "S.", clef: "treble" },
  { name: "Alto", abbreviation: "A.", clef: "treble" },
  { name: "Tenor", abbreviation: "T.", clef: "treble8vb" },
  { name: "Bass", abbreviation: "B.", clef: "bass" },
];

/** Pitch + note value for one event, written as "G4:4" (a G4 quarter). */
type Spec = string;

function parse(spec: Spec): NoteEvent {
  const [pitch, value] = spec.split(":");
  return note(pitch!, Number(value) as 1 | 2 | 4);
}

/**
 * One verse's syllables, one entry per event of the soprano line. `""` means the
 * note carries no syllable (it belongs to the melisma before it). A trailing
 * "-" marks a hyphenated syllable that continues into the next one, and a
 * trailing "_" asks for an extender line over the melisma that follows.
 */
function verse(index: number, words: string[]): (Lyric | undefined)[] {
  let hyphenated = false;
  return words.map((word) => {
    if (word === "") {
      hyphenated = false;
      return undefined;
    }
    const extend = word.endsWith("_");
    const bare = extend ? word.slice(0, -1) : word;
    const continues = bare.endsWith("-");
    const text = continues ? bare.slice(0, -1) : bare;
    const syllabic: Lyric["syllabic"] = continues
      ? hyphenated
        ? "middle"
        : "begin"
      : hyphenated
        ? "end"
        : "single";
    hyphenated = continues;
    return { verse: index, text, syllabic, ...(extend ? { extend: true } : {}) };
  });
}

/**
 * An SATB hymn: one part of four named staves joined by a bracket, eight measures
 * in 4/4, C major, one voice per staff.
 *
 * The soprano carries two verses of words, which is what this fixture exists for:
 *
 *  - hyphenated words ("bless-ings", "crea-tures", "a-bove" and, in verse 2, a
 *    different syllabification of the same notes);
 *  - a melisma on "flow_" / "Ghost_" — an extender line over the next note, which
 *    carries no syllable of its own;
 *  - the deliberately long single syllable "strength", which is far wider than
 *    the quarter note under it and so has to push the column after it right;
 *  - two dynamics and a crescendo, which the vocal convention moves *above* the
 *    staff because the words own everything below it.
 *
 * The bass sings for one measure (m3) so the lane logic is exercised on a second
 * staff, and a forced break after m3 puts the abbreviations on the later system.
 */
export function hymn(): Score {
  const score = newPianoScore({ measureCount: 8, title: "Hymn" });
  const part = score.parts[0]!;
  part.name = "Hymn";
  part.abbreviation = "Hy.";
  part.bracket = "bracket";
  part.staves = STAVES.map((s) => ({
    id: newId(),
    lines: 5,
    initialClef: s.clef,
    name: s.name,
    abbreviation: s.abbreviation,
  }));
  part.measures = Array.from<unknown, PartMeasure>({ length: 8 }, () => ({
    staves: STAVES.map(() => ({ voices: [emptyVoice(0)] })),
  }));

  const lines: Spec[][][] = [
    // Soprano — 23 events, the melody the words are sung to.
    [
      ["G4:4", "G4:4", "A4:2"],
      ["B4:4", "C5:4", "B4:2"],
      ["A4:4", "G4:4", "A4:4", "B4:4"],
      ["C5:2", "B4:2"],
      ["A4:4", "B4:4", "C5:2"],
      ["D5:4", "C5:4", "B4:2"],
      ["A4:4", "G4:4", "F4:4", "E4:4"],
      ["G4:1"],
    ],
    // Alto
    [
      ["E4:4", "E4:4", "F4:2"],
      ["G4:4", "G4:4", "G4:2"],
      ["F4:4", "E4:4", "F4:4", "G4:4"],
      ["G4:2", "G4:2"],
      ["F4:4", "G4:4", "G4:2"],
      ["F4:4", "E4:4", "D4:2"],
      ["F4:4", "E4:4", "D4:4", "C4:4"],
      ["D4:1"],
    ],
    // Tenor (written in treble 8vb)
    [
      ["C4:4", "C4:4", "C4:2"],
      ["D4:4", "E4:4", "D4:2"],
      ["C4:4", "C4:4", "C4:4", "D4:4"],
      ["E4:2", "D4:2"],
      ["C4:4", "D4:4", "E4:2"],
      ["A3:4", "A3:4", "G3:2"],
      ["C4:4", "C4:4", "A3:4", "G3:4"],
      ["B3:1"],
    ],
    // Bass
    [
      ["C3:4", "C3:4", "F2:2"],
      ["G2:4", "C3:4", "G2:2"],
      ["F2:4", "C3:4", "F2:4", "G2:4"],
      ["C3:2", "G2:2"],
      ["F2:4", "G2:4", "C3:2"],
      ["D3:4", "A2:4", "G2:2"],
      ["F2:4", "C3:4", "D3:4", "C3:4"],
      ["G2:1"],
    ],
  ];

  const events: NoteEvent[][][] = lines.map((staffLine) => staffLine.map((m) => m.map(parse)));
  for (const [si, staffLine] of events.entries()) {
    for (const [mi, items] of staffLine.entries()) {
      part.measures[mi]!.staves[si]!.voices[0]!.items = items;
    }
  }

  // --- words ---------------------------------------------------------------
  const soprano = events[0]!.flat();
  const verse1 = verse(0, [
    "Praise", "God", "from",
    "whom", "all", "bless-",
    "ings", "flow_", "", "Praise",
    "Him", "all",
    "crea-", "tures", "here",
    "be-", "low", "Praise",
    "Him", "a-", "bove", "strength",
    "host",
  ]);
  const verse2 = verse(1, [
    "To", "Fa-", "ther",
    "Son", "and", "Ho-",
    "ly", "Ghost_", "", "Praise",
    "God", "the",
    "foun-", "tain", "of",
    "all", "grace", "Praise",
    "Him", "for-", "ev-", "ermore",
    "Amen",
  ]);
  for (const [i, ev] of soprano.entries()) {
    const lyrics = [verse1[i], verse2[i]].filter((l) => l !== undefined);
    if (lyrics.length > 0) ev.lyrics = lyrics;
  }

  // The bass sings one measure of its own.
  const bassM3 = events[3]![3]!;
  bassM3[0]!.lyrics = [{ verse: 0, text: "Sing", syllabic: "single" }];
  bassM3[1]!.lyrics = [{ verse: 0, text: "praise", syllabic: "single" }];

  // --- dynamics (above, because the soprano staff carries words) -----------
  const at = (ev: NoteEvent) => ({ kind: "event" as const, eventId: ev.id });
  const upper = { partIndex: 0, staffIndex: 0 };
  const attachments: Attachment[] = [
    { id: newId(), ...upper, kind: "dynamic", text: "mf", anchor: at(soprano[0]!) },
    { id: newId(), ...upper, kind: "dynamic", text: "f", anchor: at(soprano[17]!) },
  ];
  const spanners: Spanner[] = [
    {
      id: newId(),
      ...upper,
      kind: "hairpin",
      shape: "cresc",
      start: at(soprano[15]!),
      end: at(soprano[17]!),
    },
  ];

  score.attachments = attachments;
  score.spanners = spanners;
  score.layout.systemBreaks = [4];
  return score;
}
