/**
 * Semantic validation for a `Score` that has already passed schema
 * validation: structural invariants the zod schema can't express, like
 * "every part has the same number of measures as the score" or "voices add
 * up to the measure length."
 */
import { eq, fracToString, measureLength, type Fraction, type Id, type TimeSignature } from "@/model";
import { voiceLength } from "@/model";
import type { Anchor, GraceGroup, NoteEvent, RestEvent, Score, Voice, VoiceItem } from "@/model";

export interface ValidationIssue {
  path: string;
  message: string;
}

type IdKind = "score" | "part" | "staff" | "measureAttrs" | "voice" | "event" | "note" | "tuplet" | "grace" | "spanner" | "attachment";

interface IdEntry {
  id: Id;
  kind: IdKind;
  path: string;
}

function collectEventGroupIds(item: NoteEvent | RestEvent, path: string, out: IdEntry[]): void {
  out.push({ id: item.id, kind: "event", path });
  if (item.grace) collectGraceGroupIds(item.grace, `${path}.grace`, out);
  if (item.kind === "note") {
    for (const [ni, n] of item.notes.entries()) {
      out.push({ id: n.id, kind: "note", path: `${path}.notes[${ni}]` });
    }
  }
}

function collectGraceGroupIds(grace: GraceGroup, path: string, out: IdEntry[]): void {
  out.push({ id: grace.id, kind: "grace", path });
  for (const [ei, ev] of grace.events.entries()) {
    collectEventGroupIds(ev, `${path}.events[${ei}]`, out);
  }
}

function collectVoiceItemIds(item: VoiceItem, path: string, out: IdEntry[]): void {
  if (item.kind === "tuplet") {
    out.push({ id: item.id, kind: "tuplet", path });
    for (const [ci, child] of item.items.entries()) {
      collectVoiceItemIds(child, `${path}.items[${ci}]`, out);
    }
    return;
  }
  collectEventGroupIds(item, path, out);
}

/** Walks the whole score collecting every addressable id, tagged by kind and the path it was found at. */
function collectIds(score: Score): IdEntry[] {
  const out: IdEntry[] = [];
  out.push({ id: score.id, kind: "score", path: "id" });

  for (const [mi, ma] of score.measures.entries()) {
    out.push({ id: ma.id, kind: "measureAttrs", path: `measures[${mi}]` });
  }

  for (const [pi, part] of score.parts.entries()) {
    out.push({ id: part.id, kind: "part", path: `parts[${pi}]` });
    for (const [si, staff] of part.staves.entries()) {
      out.push({ id: staff.id, kind: "staff", path: `parts[${pi}].staves[${si}]` });
    }
    for (const [mi, pm] of part.measures.entries()) {
      for (const [si, sm] of pm.staves.entries()) {
        for (const [vi, voice] of sm.voices.entries()) {
          const voicePath = `parts[${pi}].measures[${mi}].staves[${si}].voices[${vi}]`;
          out.push({ id: voice.id, kind: "voice", path: voicePath });
          for (const [ii, item] of voice.items.entries()) {
            collectVoiceItemIds(item, `${voicePath}.items[${ii}]`, out);
          }
        }
      }
    }
  }

  for (const [i, spanner] of score.spanners.entries()) {
    out.push({ id: spanner.id, kind: "spanner", path: `spanners[${i}]` });
  }
  for (const [i, attachment] of score.attachments.entries()) {
    out.push({ id: attachment.id, kind: "attachment", path: `attachments[${i}]` });
  }

  return out;
}

function isWholeMeasureRest(voice: Voice): boolean {
  return voice.items.length === 1 && voice.items[0]!.kind === "rest" && voice.items[0]!.measureRest === true;
}

function checkStructure(score: Score, issues: ValidationIssue[]): void {
  for (const [pi, part] of score.parts.entries()) {
    if (part.measures.length !== score.measures.length) {
      issues.push({
        path: `parts[${pi}].measures`,
        message: `expected ${score.measures.length} measures (score.measures.length) but part has ${part.measures.length}`,
      });
    }
    for (const [mi, pm] of part.measures.entries()) {
      if (pm.staves.length !== part.staves.length) {
        issues.push({
          path: `parts[${pi}].measures[${mi}].staves`,
          message: `expected ${part.staves.length} staves (part.staves.length) but measure has ${pm.staves.length}`,
        });
      }
    }
  }
}

function checkVoiceLengths(score: Score, issues: ValidationIssue[]): void {
  let currentTimeSig: TimeSignature | undefined;
  for (const [mi, ma] of score.measures.entries()) {
    if (ma.timeSig) currentTimeSig = ma.timeSig;
    const expected: Fraction | undefined = ma.actualLength ?? (currentTimeSig ? measureLength(currentTimeSig) : undefined);

    for (const [pi, part] of score.parts.entries()) {
      const pm = part.measures[mi];
      if (!pm) continue; // already reported by checkStructure

      for (const [si, sm] of pm.staves.entries()) {
        for (const [vi, voice] of sm.voices.entries()) {
          if (isWholeMeasureRest(voice)) continue;

          const path = `parts[${pi}].measures[${mi}].staves[${si}].voices[${vi}]`;
          if (!expected) {
            issues.push({ path, message: "no time signature is in effect to validate this voice's length against" });
            continue;
          }
          const actual = voiceLength(voice);
          if (!eq(actual, expected)) {
            issues.push({
              path,
              message: `voice length ${fracToString(actual)} does not match measure length ${fracToString(expected)}`,
            });
          }
        }
      }
    }
  }
}

function checkUniqueIds(entries: IdEntry[], issues: ValidationIssue[]): void {
  const byId = new Map<Id, IdEntry[]>();
  for (const entry of entries) {
    const bucket = byId.get(entry.id);
    if (bucket) bucket.push(entry);
    else byId.set(entry.id, [entry]);
  }
  for (const [id, bucket] of byId) {
    if (bucket.length <= 1) continue;
    const [first, ...rest] = bucket;
    issues.push({
      path: first!.path,
      message: `duplicate id "${id}" is also used at ${rest.map((e) => e.path).join(", ")}`,
    });
  }
}

function checkAnchors(score: Score, entries: IdEntry[], issues: ValidationIssue[]): void {
  const eventIds = new Set(entries.filter((e) => e.kind === "event").map((e) => e.id));
  const checkOne = (anchor: Anchor, path: string) => {
    if (anchor.kind === "event" && !eventIds.has(anchor.eventId)) {
      issues.push({ path, message: `anchor references unknown event id "${anchor.eventId}"` });
    }
  };
  for (const [i, spanner] of score.spanners.entries()) {
    checkOne(spanner.start, `spanners[${i}].start`);
    checkOne(spanner.end, `spanners[${i}].end`);
  }
  for (const [i, attachment] of score.attachments.entries()) {
    checkOne(attachment.anchor, `attachments[${i}].anchor`);
  }
}

/** Validates cross-cutting invariants of an already schema-valid Score. Returns an empty array if none are found. */
export function validateScore(score: Score): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  checkStructure(score, issues);
  checkVoiceLengths(score, issues);

  const entries = collectIds(score);
  checkUniqueIds(entries, issues);
  checkAnchors(score, entries, issues);

  return issues;
}
