/**
 * The native `.pscore` file format: a zod schema mirroring `src/model/score.ts`
 * exactly, plus (de)serialization.
 *
 * Every object schema is `.strict()` so an unrecognized key (a typo, or a
 * field from a future format version that this build doesn't know about) is
 * reported as a validation error instead of being silently dropped or
 * ignored. Every optional field uses `.exactOptional()` rather than
 * `.optional()` — see the note above the compile-time check at the bottom of
 * this file for why that matters.
 */
import { z } from "zod";
import { FORMAT_VERSION, type Score } from "@/model";
import { migrate } from "./migrations";
import { validateScore } from "./validate";

// ---------------------------------------------------------------------------
// Primitives (duration.ts, pitch.ts)
// ---------------------------------------------------------------------------

const IdSchema = z.string();

const FractionSchema = z
  .object({
    num: z.number(),
    den: z.number(),
  })
  .strict();

const NoteValueSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(4),
  z.literal(8),
  z.literal(16),
  z.literal(32),
  z.literal(64),
  z.literal(128),
  z.literal(256),
]);

const NotatedDurationSchema = z
  .object({
    base: NoteValueSchema,
    dots: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict();

const TimeSignatureSchema = z
  .object({
    numerator: z.number(),
    denominator: NoteValueSchema,
  })
  .strict();

const StepSchema = z.enum(["C", "D", "E", "F", "G", "A", "B"]);

const AlterSchema = z.union([z.literal(-2), z.literal(-1), z.literal(0), z.literal(1), z.literal(2)]);

const PitchSchema = z
  .object({
    step: StepSchema,
    alter: AlterSchema,
    octave: z.number(),
  })
  .strict();

const KeySignatureSchema = z
  .object({
    fifths: z.number(),
    mode: z.enum(["major", "minor"]),
  })
  .strict();

// ---------------------------------------------------------------------------
// Score-level containers
// ---------------------------------------------------------------------------

const ScoreMetaSchema = z
  .object({
    title: z.string().exactOptional(),
    subtitle: z.string().exactOptional(),
    composer: z.string().exactOptional(),
    lyricist: z.string().exactOptional(),
    copyright: z.string().exactOptional(),
  })
  .strict();

const EngravingSettingsSchema = z
  .object({
    staffSpaceMm: z.number(),
    page: z
      .object({
        widthMm: z.number(),
        heightMm: z.number(),
        marginMm: z
          .object({
            top: z.number(),
            bottom: z.number(),
            left: z.number(),
            right: z.number(),
          })
          .strict(),
      })
      .strict(),
    grandStaffGapSp: z.number(),
    systemGapSp: z.number(),
  })
  .strict();

const BarlineStyleSchema = z.enum([
  "regular",
  "double",
  "final",
  "repeat-start",
  "repeat-end",
  "repeat-both",
  "dashed",
  "invisible",
]);

const MeasureAttributesSchema = z
  .object({
    id: IdSchema,
    timeSig: TimeSignatureSchema.exactOptional(),
    keySig: KeySignatureSchema.exactOptional(),
    barline: BarlineStyleSchema.exactOptional(),
    startBarline: z.literal("repeat-start").exactOptional(),
    ending: z
      .object({
        numbers: z.array(z.number()),
        type: z.enum(["start", "stop", "discontinue"]),
      })
      .strict()
      .exactOptional(),
    rehearsalMark: z.string().exactOptional(),
    actualLength: FractionSchema.exactOptional(),
    numberOverride: z.number().exactOptional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Parts, staves, voices
// ---------------------------------------------------------------------------

const ClefKindSchema = z.enum([
  "treble",
  "bass",
  "alto",
  "tenor",
  "treble8vb",
  "treble8va",
  "bass8vb",
  "bass8va",
]);

const StaffDefSchema = z
  .object({
    id: IdSchema,
    lines: z.literal(5),
    initialClef: ClefKindSchema,
    name: z.string().exactOptional(),
    abbreviation: z.string().exactOptional(),
  })
  .strict();

const StemDirectionSchema = z.enum(["up", "down"]);

const ArticulationSchema = z.enum(["staccato", "staccatissimo", "tenuto", "accent", "marcato", "portato"]);

const OrnamentSchema = z.enum(["trill", "mordent", "invertedMordent", "turn", "invertedTurn"]);

const NoteSchema = z
  .object({
    id: IdSchema,
    pitch: PitchSchema,
    tieStart: z.boolean().exactOptional(),
    accidental: z.enum(["auto", "none", "force", "courtesy", "cautionary-parens"]).exactOptional(),
    fingering: z.string().exactOptional(),
    notehead: z.enum(["normal", "x", "diamond", "slash", "none"]).exactOptional(),
    staff: z.number().exactOptional(),
  })
  .strict();

// NoteEvent and GraceGroup are mutually recursive (a NoteEvent may carry a
// GraceGroup, whose events are themselves NoteEvents), so both are declared
// with z.lazy and an explicit z.ZodType<T> annotation.
const NoteEventSchema: z.ZodType<import("@/model").NoteEvent> = z.lazy(() =>
  z
    .object({
      id: IdSchema,
      kind: z.literal("note"),
      duration: NotatedDurationSchema,
      grace: GraceGroupSchema.exactOptional(),
      staff: z.number().exactOptional(),
      notes: z.array(NoteSchema),
    lyrics: z
      .array(
        z
          .object({
            verse: z.number().int().nonnegative(),
            text: z.string(),
            syllabic: z.enum(["single", "begin", "middle", "end"]),
            extend: z.boolean().exactOptional(),
          })
          .strict(),
      )
      .exactOptional(),
      stem: StemDirectionSchema.exactOptional(),
      beam: z.enum(["auto", "begin", "continue", "end", "none"]).exactOptional(),
      articulations: z.array(ArticulationSchema).exactOptional(),
      ornaments: z.array(OrnamentSchema).exactOptional(),
      arpeggio: z.enum(["up", "down", "straight"]).exactOptional(),
      tremolo: z.union([z.literal(1), z.literal(2), z.literal(3)]).exactOptional(),
    })
    .strict(),
);

const GraceGroupSchema: z.ZodType<import("@/model").GraceGroup> = z.lazy(() =>
  z
    .object({
      id: IdSchema,
      events: z.array(NoteEventSchema),
      slash: z.boolean(),
    })
    .strict(),
);

const RestEventSchema = z
  .object({
    id: IdSchema,
    kind: z.literal("rest"),
    duration: NotatedDurationSchema,
    grace: GraceGroupSchema.exactOptional(),
    staff: z.number().exactOptional(),
    measureRest: z.boolean().exactOptional(),
    invisible: z.boolean().exactOptional(),
    yOffsetSteps: z.number().exactOptional(),
  })
  .strict();

// VoiceItem and TupletGroup are mutually recursive (a TupletGroup holds
// VoiceItems, one of which may itself be a TupletGroup).
const TupletGroupSchema: z.ZodType<import("@/model").TupletGroup> = z.lazy(() =>
  z
    .object({
      kind: z.literal("tuplet"),
      id: IdSchema,
      ratio: z
        .object({
          actual: z.number(),
          normal: z.number(),
          unit: NoteValueSchema,
        })
        .strict(),
      items: z.array(VoiceItemSchema),
      bracket: z.enum(["auto", "show", "hide"]).exactOptional(),
      showNumber: z.enum(["auto", "actual", "ratio", "none"]).exactOptional(),
    })
    .strict(),
);

const VoiceItemSchema: z.ZodType<import("@/model").VoiceItem> = z.lazy(() =>
  z.union([NoteEventSchema, RestEventSchema, TupletGroupSchema]),
);

const VoiceSchema = z
  .object({
    id: IdSchema,
    index: z.number(),
    items: z.array(VoiceItemSchema),
  })
  .strict();

const StaffMeasureSchema = z
  .object({
    clefChanges: z
      .array(
        z
          .object({
            at: FractionSchema,
            clef: ClefKindSchema,
          })
          .strict(),
      )
      .exactOptional(),
    voices: z.array(VoiceSchema),
  })
  .strict();

const PartMeasureSchema = z
  .object({
    staves: z.array(StaffMeasureSchema),
  })
  .strict();

const PartSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    abbreviation: z.string().exactOptional(),
    bracket: z.enum(["brace", "bracket", "none"]).exactOptional(),
    staves: z.array(StaffDefSchema),
    measures: z.array(PartMeasureSchema),
    midiProgram: z.number().exactOptional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Spanners and attachments
// ---------------------------------------------------------------------------

const AnchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), eventId: IdSchema }).strict(),
  z.object({ kind: z.literal("measure"), measureIndex: z.number(), offset: FractionSchema }).strict(),
]);

const PlacementSchema = z.enum(["above", "below"]);

const SpannerBaseFields = {
  id: IdSchema,
  partIndex: z.number(),
  staffIndex: z.number(),
  start: AnchorSchema,
  end: AnchorSchema,
  placement: PlacementSchema.exactOptional(),
};

const SpannerSchema = z.discriminatedUnion("kind", [
  z.object({ ...SpannerBaseFields, kind: z.literal("slur") }).strict(),
  z.object({ ...SpannerBaseFields, kind: z.literal("hairpin"), shape: z.enum(["cresc", "dim"]) }).strict(),
  z.object({ ...SpannerBaseFields, kind: z.literal("pedal"), style: z.enum(["line", "text"]) }).strict(),
  z
    .object({
      ...SpannerBaseFields,
      kind: z.literal("ottava"),
      shift: z.union([z.literal(8), z.literal(15), z.literal(-8), z.literal(-15)]),
    })
    .strict(),
  z.object({ ...SpannerBaseFields, kind: z.literal("trillLine") }).strict(),
  z.object({ ...SpannerBaseFields, kind: z.literal("glissando") }).strict(),
]);

const AttachmentBaseFields = {
  id: IdSchema,
  partIndex: z.number(),
  staffIndex: z.number(),
  anchor: AnchorSchema,
  placement: PlacementSchema.exactOptional(),
};

const AttachmentSchema = z.discriminatedUnion("kind", [
  z.object({ ...AttachmentBaseFields, kind: z.literal("dynamic"), text: z.string() }).strict(),
  z
    .object({
      ...AttachmentBaseFields,
      kind: z.literal("tempo"),
      text: z.string().exactOptional(),
      beatUnit: NotatedDurationSchema.exactOptional(),
      bpm: z.number().exactOptional(),
    })
    .strict(),
  z
    .object({
      ...AttachmentBaseFields,
      kind: z.literal("text"),
      text: z.string(),
      style: z.enum(["expression", "technique", "plain"]).exactOptional(),
    })
    .strict(),
  z.object({ ...AttachmentBaseFields, kind: z.literal("fermata") }).strict(),
  z.object({ ...AttachmentBaseFields, kind: z.literal("pedalMark"), mark: z.enum(["ped", "star"]) }).strict(),
]);

// ---------------------------------------------------------------------------
// Layout hints
// ---------------------------------------------------------------------------

const LayoutHintsSchema = z
  .object({
    systemBreaks: z.array(z.number()),
    pageBreaks: z.array(z.number()),
    nudges: z.record(IdSchema, z.object({ dx: z.number(), dy: z.number() }).strict()),
  })
  .strict();

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

export const ScoreSchema = z
  .object({
    formatVersion: z.literal(FORMAT_VERSION),
    id: IdSchema,
    meta: ScoreMetaSchema,
    settings: EngravingSettingsSchema,
    measures: z.array(MeasureAttributesSchema),
    parts: z.array(PartSchema),
    spanners: z.array(SpannerSchema),
    attachments: z.array(AttachmentSchema),
    layout: LayoutHintsSchema,
  })
  .strict();

export type ScoreFile = z.infer<typeof ScoreSchema>;

/**
 * Compile-time proof that the zod schema above mirrors `Score` exactly in
 * both directions. If this file fails to typecheck here, the schema has
 * drifted from `src/model/score.ts` — fix the schema, not this check.
 *
 * Every optional field is declared with `.exactOptional()` rather than
 * `.optional()`. Plain `.optional()` infers `T | undefined` for the
 * property's value type (in addition to making the key itself optional),
 * which fails this bidirectional check under this project's
 * `exactOptionalPropertyTypes: true`: a type with `foo?: string | undefined`
 * is not assignable to one with `foo?: string`. `.exactOptional()` (added in
 * zod 4) infers a plain `T` for present values and additionally rejects an
 * explicit `undefined` at parse time, which is also the right behavior for a
 * JSON file format — JSON has no `undefined`, so a key is either present
 * with a real value or absent entirely. With that in place, no other
 * mismatches were needed anywhere in the schema.
 */
const _scoreFileIsAssignableToScore: Score = {} as ScoreFile;
const _scoreIsAssignableToScoreFile: ScoreFile = {} as Score;
void _scoreFileIsAssignableToScore;
void _scoreIsAssignableToScoreFile;

// ---------------------------------------------------------------------------
// (De)serialization
// ---------------------------------------------------------------------------

export class ScoreParseError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ScoreParseError";
  }
}

/** Pretty-prints a Score as JSON. Key order is whatever object construction produced; not guaranteed stable. */
export function serializeScore(score: Score): string {
  return JSON.stringify(score, null, 2);
}

/**
 * Parses `.pscore` file contents into a `Score`. Runs, in order: JSON parse,
 * format-version migration (see `src/io/migrations.ts`), zod schema
 * validation, and semantic validation (see `src/io/validate.ts`). Throws
 * `ScoreParseError` with a readable message on any failure.
 */
export function parseScore(text: string): Score {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new ScoreParseError(`Invalid .pscore file: not valid JSON (${(e as Error).message})`, e);
  }

  let migrated: unknown;
  try {
    migrated = migrate(json);
  } catch (e) {
    throw new ScoreParseError(`Invalid .pscore file: ${(e as Error).message}`, e);
  }

  const result = ScoreSchema.safeParse(migrated);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.length ? issue.path.join(".") : "<root>"}: ${issue.message}`)
      .join("; ");
    throw new ScoreParseError(`Invalid .pscore file: ${detail}`, result.error);
  }

  const score = result.data;

  const issues = validateScore(score);
  if (issues.length) {
    const detail = issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new ScoreParseError(`Invalid score: ${detail}`, issues);
  }

  return score;
}
