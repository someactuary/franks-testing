/**
 * Ties: which note ties to which, and the shape that joins them.
 *
 * Pairing is a purely *model* question (it needs no layout), so `resolveTies`
 * runs before the semantic pass — the set of tie targets it returns seeds the
 * accidental logic. The *geometry* needs final x positions and therefore runs
 * after spacing and line breaking; `tiePath` builds the shape from two points.
 */
import { cmp, type Fraction } from "@/model/duration";
import type { Id } from "@/model/ids";
import { pitchEquals } from "@/model/pitch";
import type { NoteEvent, Score } from "@/model/score";
import { positionedEvents } from "@/model/traverse";
import type { EngravingDefaults } from "@/render/smufl/types";
import { ENGRAVING } from "./constants";

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

export interface TieEndpoint {
  partIndex: number;
  staffIndex: number;
  voiceIndex: number;
  measureIndex: number;
  /** Offset of the event within its measure. */
  offset: Fraction;
  eventId: Id;
  noteId: Id;
}

export interface TiePair {
  start: TieEndpoint;
  end: TieEndpoint;
}

export interface TieResolution {
  pairs: TiePair[];
  /** Ids of the notes a tie ends on. */
  targets: ReadonlySet<Id>;
}

interface VoiceEntry {
  measureIndex: number;
  offset: Fraction;
  voiceIndex: number;
  event: NoteEvent;
}

/**
 * Match every `tieStart` note with the next note of identical pitch (step, alter
 * and octave) in the same voice, however many barlines away. A tie whose partner
 * never appears is dropped silently.
 */
export function resolveTies(score: Score): TieResolution {
  const pairs: TiePair[] = [];
  const targets = new Set<Id>();

  for (const [partIndex, part] of score.parts.entries()) {
    for (const [staffIndex] of part.staves.entries()) {
      const byVoice = new Map<number, VoiceEntry[]>();
      for (const [measureIndex, pm] of part.measures.entries()) {
        for (const voice of pm.staves[staffIndex]?.voices ?? []) {
          for (const pe of positionedEvents(voice)) {
            if (pe.event.kind !== "note") continue;
            const list = byVoice.get(voice.index) ?? [];
            list.push({
              measureIndex,
              offset: pe.offset,
              voiceIndex: voice.index,
              event: pe.event,
            });
            byVoice.set(voice.index, list);
          }
        }
      }

      for (const list of byVoice.values()) {
        list.sort((a, b) => a.measureIndex - b.measureIndex || cmp(a.offset, b.offset));
        for (const [i, entry] of list.entries()) {
          for (const note of entry.event.notes) {
            if (!note.tieStart) continue;
            for (let j = i + 1; j < list.length; j++) {
              const partner = list[j]!;
              const match = partner.event.notes.find((o) => pitchEquals(o.pitch, note.pitch));
              if (!match) continue;
              pairs.push({
                start: {
                  partIndex,
                  staffIndex,
                  voiceIndex: entry.voiceIndex,
                  measureIndex: entry.measureIndex,
                  offset: entry.offset,
                  eventId: entry.event.id,
                  noteId: note.id,
                },
                end: {
                  partIndex,
                  staffIndex,
                  voiceIndex: partner.voiceIndex,
                  measureIndex: partner.measureIndex,
                  offset: partner.offset,
                  eventId: partner.event.id,
                  noteId: match.id,
                },
              });
              targets.add(match.id);
              break;
            }
          }
        }
      }
    }
  }

  return { pairs, targets };
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/**
 * True when a tie ends on the very first onset of `measureIndex` having started
 * in an earlier measure — such a measure needs extra lead when it starts a
 * system, so the tie's continuation piece has room after the prefix.
 */
export function needsTieContinuationLead(pairs: TiePair[], measureIndex: number): boolean {
  return pairs.some(
    (p) =>
      p.end.measureIndex === measureIndex &&
      p.start.measureIndex < measureIndex &&
      p.end.offset.num === 0,
  );
}

export type TieSide = "up" | "down";

/**
 * Which side of the noteheads a tie sits on.
 *
 * A single note ties away from its stem. In a chord the outer notes curve
 * outwards (top note up, bottom note down) and the inner ones alternate.
 * `stem` is the event's stem direction, or undefined for a whole note, in which
 * case the caller passes the direction the note *would* have had.
 */
export function tieSide(noteIndex: number, noteCount: number, stem: "up" | "down"): TieSide {
  if (noteCount <= 1) return stem === "up" ? "down" : "up";
  if (noteIndex === noteCount - 1) return "up";
  if (noteIndex === 0) return "down";
  return noteIndex % 2 === 1 ? "up" : "down";
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * A filled tie between two points, as two cubic curves: the outer edge out and
 * the inner edge back. The shape is `tieEndpointThickness` thick at the ends and
 * `tieMidpointThickness` in the middle, and bulges towards `side`.
 *
 * `y1` / `y2` are the tie's *centre line* at each end (the caller has already
 * offset them away from the notehead centre).
 */
export function tiePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  side: TieSide,
  defaults: EngravingDefaults,
): string {
  const dir = side === "up" ? -1 : 1;
  const len = Math.max(x2 - x1, ENGRAVING.tieMinLengthSp);
  const h = Math.min(
    ENGRAVING.tieMaxHeightSp,
    Math.max(ENGRAVING.tieMinHeightSp, len * ENGRAVING.tieHeightRatio),
  );
  const sx = Math.min(len * ENGRAVING.tieShoulderRatio, len / 2);
  const end = defaults.tieEndpointThickness / 2;
  const mid = defaults.tieMidpointThickness / 2;

  const outer = dir * (h + mid);
  const inner = dir * (h - mid);
  const n = (v: number) => String(round(v));

  return [
    `M ${n(x1)} ${n(y1 + dir * end)}`,
    `C ${n(x1 + sx)} ${n(y1 + outer)} ${n(x2 - sx)} ${n(y2 + outer)} ${n(x2)} ${n(y2 + dir * end)}`,
    `L ${n(x2)} ${n(y2 - dir * end)}`,
    `C ${n(x2 - sx)} ${n(y2 + inner)} ${n(x1 + sx)} ${n(y1 + inner)} ${n(x1)} ${n(y1 - dir * end)}`,
    "Z",
  ].join(" ");
}
