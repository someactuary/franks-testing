/**
 * Post-processing of a score imported from OMR output (Audiveris MusicXML). Pure.
 * See docs/ARCHITECTURE.md "M4 contracts".
 */
import {
  add,
  cmp,
  frac,
  fracToString,
  mul,
  notatedToFraction,
  ZERO,
  type Anchor,
  type Attachment,
  type Fraction,
  type GraceGroup,
  type Score,
  type Spanner,
  type VoiceItem,
} from "@/model";
import { validateScore } from "./validate";

export interface OmrCleanupOptions {
  /**
   * "essentials": keep staves, clefs, key/time signatures, notes, rests, ties, tuplets,
   * barlines/repeats; drop every attachment and spanner except ties (slurs, dynamics,
   * hairpins, text, tempo, pedal, ottava, fermatas), articulations, ornaments, fingering
   * and lyrics. "all": keep everything recognized.
   */
  keep: "essentials" | "all";
  /** Keep the source's system/page breaks (so pages line up with the PDF). */
  keepLayout: boolean;
}

export interface OmrReviewItem {
  measureIndex: number;
  staffIndex: number;
  reason: "padded-voice" | "overfull-voice" | "validation" | "suspicious-duration";
  detail: string;
}

export interface OmrCleanupResult {
  score: Score;
  /** Measures a human should check against the original, in score order. */
  review: OmrReviewItem[];
}

// ---------------------------------------------------------------------------
// Generic part/staff names
// ---------------------------------------------------------------------------

/**
 * Names Audiveris (or any generic MusicXML producer) writes when it has no real
 * instrument name: "Voice", "Piano", "P1".."P99", "Part 1", "Staff 1", "MusicXML
 * Part", "Instrument". Part/staff numbers are generalized beyond the literal "1"
 * example in the architecture doc, since Audiveris numbers additional
 * undetected parts/staves sequentially (Part 2, Staff 2, P2, ...).
 */
const GENERIC_NAME_RE =
  /^(?:voice(?:\s*\d+)?|piano|p(?:[1-9]|[1-9]\d)|part\s*\d+|staff\s*\d+|musicxml\s*part|instrument(?:\s*\d+)?)$/i;

function isGenericLabel(label: string | undefined): boolean {
  if (label === undefined) return false;
  return GENERIC_NAME_RE.test(label.trim());
}

function stripGenericNames(score: Score): void {
  for (const part of score.parts) {
    // Part.name is required; "removing" it means blanking it (falsy, so nothing renders
    // or exports in its place) rather than deleting a mandatory field.
    if (isGenericLabel(part.name)) part.name = "";
    if (isGenericLabel(part.abbreviation)) delete part.abbreviation;
    for (const staff of part.staves) {
      if (isGenericLabel(staff.name)) delete staff.name;
      if (isGenericLabel(staff.abbreviation)) delete staff.abbreviation;
    }
  }
}

// ---------------------------------------------------------------------------
// Essentials stripping
// ---------------------------------------------------------------------------

function stripEssentialsFromGrace(grace: GraceGroup): void {
  for (const ev of grace.events) stripEssentialsFromItem(ev);
}

function stripEssentialsFromItem(item: VoiceItem): void {
  if (item.kind === "tuplet") {
    for (const child of item.items) stripEssentialsFromItem(child);
    return;
  }
  if (item.grace) stripEssentialsFromGrace(item.grace);
  if (item.kind === "note") {
    delete item.lyrics;
    delete item.articulations;
    delete item.ornaments;
    for (const note of item.notes) delete note.fingering;
  }
}

function stripEssentials(score: Score): void {
  // Every spanner and attachment kind (slurs, dynamics, hairpins, text, tempo, pedal,
  // ottava, fermatas, ...) is dropped. Ties are not spanners (they live on
  // Note.tieStart) so they are untouched.
  score.spanners = [];
  score.attachments = [];
  for (const part of score.parts) {
    for (const pm of part.measures) {
      for (const sm of pm.staves) {
        for (const voice of sm.voices) {
          for (const item of voice.items) stripEssentialsFromItem(item);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function clearLayoutBreaks(score: Score): void {
  score.layout.systemBreaks = [];
  score.layout.pageBreaks = [];
}

// ---------------------------------------------------------------------------
// Review: padding the importer inserted
// ---------------------------------------------------------------------------

/** Total sounding duration of invisible rests in a voice's items, tuplets included. */
function invisibleRestDuration(items: VoiceItem[], scale: Fraction): Fraction {
  let total = ZERO;
  for (const item of items) {
    if (item.kind === "tuplet") {
      const inner = mul(scale, frac(item.ratio.normal, item.ratio.actual));
      total = add(total, invisibleRestDuration(item.items, inner));
    } else if (item.kind === "rest" && item.invisible) {
      total = add(total, mul(notatedToFraction(item.duration), scale));
    }
  }
  return total;
}

function collectPaddedVoiceReviews(score: Score): OmrReviewItem[] {
  const out: OmrReviewItem[] = [];
  for (const part of score.parts) {
    for (const [measureIndex, pm] of part.measures.entries()) {
      for (const [staffIndex, sm] of pm.staves.entries()) {
        let total = ZERO;
        let voicesPadded = 0;
        for (const voice of sm.voices) {
          const padded = invisibleRestDuration(voice.items, frac(1));
          if (cmp(padded, ZERO) > 0) {
            total = add(total, padded);
            voicesPadded++;
          }
        }
        if (cmp(total, ZERO) > 0) {
          out.push({
            measureIndex,
            staffIndex,
            reason: "padded-voice",
            detail: `${describeLength(total)} of time was missing${voicesPadded > 1 ? ` in ${voicesPadded} voices` : ""} and has been filled with hidden rests; check this measure against the PDF`,
          });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Review: validation issues
// ---------------------------------------------------------------------------

function anchorOf(obj: Spanner | Attachment): Anchor {
  return "start" in obj ? obj.start : obj.anchor;
}

/** Best-effort mapping of a validateScore path back to a (measure, staff): -1 when not locatable. */
function locateIssue(score: Score, path: string): { measureIndex: number; staffIndex: number } {
  let measureIndex = -1;
  let staffIndex = -1;

  const measureMatch = /measures\[(\d+)\]/.exec(path);
  if (measureMatch) measureIndex = Number(measureMatch[1]);
  const staffMatch = /staves\[(\d+)\]/.exec(path);
  if (staffMatch) staffIndex = Number(staffMatch[1]);

  if (measureIndex === -1 || staffIndex === -1) {
    const spannerMatch = /^spanners\[(\d+)\]/.exec(path);
    const attachmentMatch = /^attachments\[(\d+)\]/.exec(path);
    const obj: Spanner | Attachment | undefined = spannerMatch
      ? score.spanners[Number(spannerMatch[1])]
      : attachmentMatch
        ? score.attachments[Number(attachmentMatch[1])]
        : undefined;
    if (obj) {
      if (staffIndex === -1) staffIndex = obj.staffIndex;
      if (measureIndex === -1) {
        const anchor = anchorOf(obj);
        if (anchor.kind === "measure") measureIndex = anchor.measureIndex;
      }
    }
  }

  return { measureIndex, staffIndex };
}

function collectValidationReviews(score: Score): OmrReviewItem[] {
  return validateScore(score).map((issue) => {
    const { measureIndex, staffIndex } = locateIssue(score, issue.path);
    return { measureIndex, staffIndex, reason: "validation", detail: `${issue.path}: ${issue.message}` };
  });
}

// ---------------------------------------------------------------------------

/** A length of musical time in words a musician reads at a glance: "an eighth note", "a dotted quarter note". */
function describeLength(f: Fraction): string {
  const names: Record<string, string> = {
    "1/1": "a whole note",
    "3/4": "a dotted half note",
    "1/2": "a half note",
    "3/8": "a dotted quarter note",
    "1/4": "a quarter note",
    "3/16": "a dotted eighth note",
    "1/8": "an eighth note",
    "3/32": "a dotted sixteenth note",
    "1/16": "a sixteenth note",
    "1/32": "a thirty-second note",
    "1/64": "a sixty-fourth note",
  };
  return names[fracToString(f)] ?? `${fracToString(f)} of a whole note`;
}

export function cleanupOmrScore(score: Score, opts: OmrCleanupOptions): OmrCleanupResult {
  const clone = structuredClone(score);

  stripGenericNames(clone);
  if (opts.keep === "essentials") stripEssentials(clone);
  if (!opts.keepLayout) clearLayoutBreaks(clone);

  const review = [...collectPaddedVoiceReviews(clone), ...collectValidationReviews(clone)];
  review.sort((a, b) => a.measureIndex - b.measureIndex);

  return { score: clone, review };
}
