/**
 * The score document model. This is the single source of musical truth.
 *
 * Design rules (see docs/ARCHITECTURE.md):
 *  - Musical content and presentation overrides are separate (`layout` holds hints/nudges).
 *  - Every addressable element has a stable `id`; spanners/attachments reference ids.
 *  - Durations are notated (base + dots); tuplet scaling is on the enclosing TupletGroup.
 *  - Piano = one Part with two staves. Voices belong to a staff; individual notes/events
 *    may be displayed on the other staff via `staff` overrides (cross-staff).
 */
import type { Id } from "./ids";
import type { Fraction, NotatedDuration, NoteValue, TimeSignature } from "./duration";
import type { KeySignature, Pitch } from "./pitch";

export const FORMAT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

export interface Score {
  formatVersion: typeof FORMAT_VERSION;
  id: Id;
  meta: ScoreMeta;
  settings: EngravingSettings;
  /** Global per-measure attributes, index-aligned with every Part's `measures`. */
  measures: MeasureAttributes[];
  parts: Part[];
  spanners: Spanner[];
  attachments: Attachment[];
  layout: LayoutHints;
}

export interface ScoreMeta {
  title?: string;
  subtitle?: string;
  composer?: string;
  lyricist?: string;
  copyright?: string;
}

export interface EngravingSettings {
  /** Millimetres per staff space. 1.75 mm (7 mm staff) is a typical piano rastral size. */
  staffSpaceMm: number;
  page: { widthMm: number; heightMm: number; marginMm: { top: number; bottom: number; left: number; right: number } };
  /** Gap between the two staves of a grand staff, in staff spaces (distance between the bottom line of the upper staff and the top line of the lower staff). */
  grandStaffGapSp: number;
  /** Minimum gap between systems in staff spaces. */
  systemGapSp: number;
}

export const DEFAULT_SETTINGS: EngravingSettings = {
  staffSpaceMm: 1.75,
  page: { widthMm: 210, heightMm: 297, marginMm: { top: 15, bottom: 15, left: 12, right: 12 } },
  grandStaffGapSp: 8,
  systemGapSp: 10,
};

// ---------------------------------------------------------------------------
// Measures (global attributes)
// ---------------------------------------------------------------------------

export type BarlineStyle =
  | "regular"
  | "double"
  | "final"
  | "repeat-start"
  | "repeat-end"
  | "repeat-both"
  | "dashed"
  | "invisible";

export interface MeasureAttributes {
  id: Id;
  /** Set only on measures where the time signature changes (or measure 0). */
  timeSig?: TimeSignature;
  /** Set only on measures where the key changes (or measure 0). */
  keySig?: KeySignature;
  /** Barline at the END of this measure. Defaults to "regular". */
  barline?: BarlineStyle;
  /** Barline at the START of this measure, only for repeat-start. */
  startBarline?: "repeat-start";
  /** Volta bracket number(s) for endings, e.g. [1] or [2]. */
  ending?: { numbers: number[]; type: "start" | "stop" | "discontinue" };
  rehearsalMark?: string;
  /** Pickup/anacrusis: actual length differs from time signature. */
  actualLength?: Fraction;
  /** Measure number override (e.g. pickup = 0). */
  numberOverride?: number;
}

// ---------------------------------------------------------------------------
// Parts, staves, voices
// ---------------------------------------------------------------------------

export type StaffGroupSymbol = "brace" | "bracket" | "none";

export interface Part {
  id: Id;
  name: string;
  abbreviation?: string;
  /** Symbol joining the part's staves at each system start. Default: "brace" when 2+ staves. */
  bracket?: StaffGroupSymbol;
  staves: StaffDef[];
  /** Index-aligned with Score.measures. */
  measures: PartMeasure[];
  /** MIDI program for playback (0 = acoustic grand). */
  midiProgram?: number;
}

export type ClefKind = "treble" | "bass" | "alto" | "tenor" | "treble8vb" | "treble8va" | "bass8vb" | "bass8va";

export interface StaffDef {
  id: Id;
  lines: 5;
  initialClef: ClefKind;
  /** Optional label drawn left of the staff on the first system (e.g. "Soprano"). */
  name?: string;
  /** Short label for later systems (e.g. "S."). */
  abbreviation?: string;
}

export interface PartMeasure {
  /** One entry per StaffDef, same order. */
  staves: StaffMeasure[];
}

export interface StaffMeasure {
  /** Clef changes within the measure; `at` is the offset from measure start. `at` = 0 means at the start of the measure. */
  clefChanges?: { at: Fraction; clef: ClefKind }[];
  voices: Voice[];
}

export interface Voice {
  id: Id;
  /** 0-based voice number within the staff. Affects default stem direction and rest placement when >1 voice. */
  index: number;
  items: VoiceItem[];
}

export type VoiceItem = NoteEvent | RestEvent | TupletGroup;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface EventBase {
  id: Id;
  duration: NotatedDuration;
  /** Grace notes attached before this event. */
  grace?: GraceGroup;
  /** Cross-staff: display this event on another staff of the part (index into Part.staves). */
  staff?: number;
}

export type StemDirection = "up" | "down";

/** One syllable of one verse under a NoteEvent. */
export interface Lyric {
  /** 0-based verse number; verse 0 is the top line. */
  verse: number;
  text: string;
  /** Hyphenation: "begin"/"middle" draw a hyphen to the next syllable; "end"/"single" do not. */
  syllabic: "single" | "begin" | "middle" | "end";
  /** Melisma: draw an extender line to the next lyric-bearing note. */
  extend?: boolean;
}

export interface NoteEvent extends EventBase {
  kind: "note";
  /** One note = single note; many = chord. Keep sorted ascending by pitch. */
  notes: Note[];
  lyrics?: Lyric[];
  stem?: StemDirection;
  /** Override automatic beaming. "begin"/"continue"/"end" force a group; "none" forces flags. */
  beam?: "auto" | "begin" | "continue" | "end" | "none";
  articulations?: Articulation[];
  ornaments?: Ornament[];
  arpeggio?: "up" | "down" | "straight";
  tremolo?: 1 | 2 | 3;
}

export interface RestEvent extends EventBase {
  kind: "rest";
  /** Whole-measure rest regardless of time signature. */
  measureRest?: boolean;
  invisible?: boolean;
  /** Vertical position override in staff steps from the middle line (positive = up). */
  yOffsetSteps?: number;
}

export interface Note {
  id: Id;
  pitch: Pitch;
  /** Ties to the next note of the same pitch. "stop" is derived and not stored. */
  tieStart?: boolean;
  /** Accidental display. undefined = automatic based on key and measure context. */
  accidental?: "auto" | "none" | "force" | "courtesy" | "cautionary-parens";
  fingering?: string;
  notehead?: "normal" | "x" | "diamond" | "slash" | "none";
  /** Cross-staff for an individual note within a chord. */
  staff?: number;
}

export type Articulation =
  | "staccato"
  | "staccatissimo"
  | "tenuto"
  | "accent"
  | "marcato"
  | "portato";

export type Ornament = "trill" | "mordent" | "invertedMordent" | "turn" | "invertedTurn";

export interface TupletGroup {
  kind: "tuplet";
  id: Id;
  /** `actual` notes of `unit` in the time of `normal`, e.g. 3:2 eighths. */
  ratio: { actual: number; normal: number; unit: NoteValue };
  items: VoiceItem[];
  bracket?: "auto" | "show" | "hide";
  showNumber?: "auto" | "actual" | "ratio" | "none";
}

export interface GraceGroup {
  id: Id;
  events: NoteEvent[];
  slash: boolean;
}

// ---------------------------------------------------------------------------
// Spanners and attachments
// ---------------------------------------------------------------------------

/** Where a spanner or attachment lives in time. */
export type Anchor =
  | { kind: "event"; eventId: Id }
  | { kind: "measure"; measureIndex: number; offset: Fraction };

export type Placement = "above" | "below";

export interface SpannerBase {
  id: Id;
  partIndex: number;
  staffIndex: number;
  start: Anchor;
  end: Anchor;
  placement?: Placement;
}

export type Spanner =
  | (SpannerBase & { kind: "slur" })
  | (SpannerBase & { kind: "hairpin"; shape: "cresc" | "dim" })
  | (SpannerBase & { kind: "pedal"; style: "line" | "text" })
  | (SpannerBase & { kind: "ottava"; shift: 8 | 15 | -8 | -15 })
  | (SpannerBase & { kind: "trillLine" })
  | (SpannerBase & { kind: "glissando" });

export interface AttachmentBase {
  id: Id;
  partIndex: number;
  staffIndex: number;
  anchor: Anchor;
  placement?: Placement;
}

export type Attachment =
  | (AttachmentBase & { kind: "dynamic"; text: string })
  | (AttachmentBase & { kind: "tempo"; text?: string; beatUnit?: NotatedDuration; bpm?: number })
  | (AttachmentBase & { kind: "text"; text: string; style?: "expression" | "technique" | "plain" })
  | (AttachmentBase & { kind: "fermata" })
  | (AttachmentBase & { kind: "pedalMark"; mark: "ped" | "star" });

// ---------------------------------------------------------------------------
// Layout hints (presentation only; deleting this object must never lose music)
// ---------------------------------------------------------------------------

export interface LayoutHints {
  /** Measure indices that must start a new system. */
  systemBreaks: number[];
  /** Measure indices that must start a new page. */
  pageBreaks: number[];
  /** Manual offsets in staff spaces keyed by element id. */
  nudges: Record<Id, { dx: number; dy: number }>;
  /**
   * Target maximum measures per system. A system still breaks earlier than this when
   * the measures don't fit the page width, or when a forced system/page break falls
   * first; it never breaks *later* just because more would fit. undefined = automatic
   * (fill each system to the available width, the M0 behaviour).
   */
  measuresPerSystem?: number;
  /** Target maximum systems per page, with the same fit-first, cap-second rule. */
  systemsPerPage?: number;
}

export const EMPTY_LAYOUT_HINTS: LayoutHints = { systemBreaks: [], pageBreaks: [], nudges: {} };
