/**
 * Note-entry editing commands: span-replace writes (`writeEvent`), erasing to rests,
 * chord editing, transposition, and appending measures. See docs/ARCHITECTURE.md's
 * "Editor contracts (M1)" section for the exact span-replace semantics implemented
 * here by `writeEvent`.
 */
import type { Draft } from "immer";
import { newId } from "@/model";
import {
  add,
  eq,
  fracToString,
  lt,
  measureLength as timeSigMeasureLength,
  notatedToFraction,
  sub,
  ZERO,
  type Fraction,
  type NotatedDuration,
  type TimeSignature,
} from "@/model/duration";
import { itemLength, positionedEvents } from "@/model/traverse";
import { comparePitch, pitchEquals, type Alter, type Pitch } from "@/model/pitch";
import type {
  Note,
  NoteEvent,
  RestEvent,
  Score,
  VoiceItem,
} from "@/model/score";
import { addMeasures } from "./basic";
import { locateEvent, locateNote, type Event } from "./locate";
import { decomposeDuration, restsFor } from "./rhythm";
import { transposeSemitone } from "./transpose";
import type { Command } from "./types";
import type { Cursor } from "@/input/types";

/** Thrown by `writeEvent` when the write can't be performed. Prefer `canWrite` to check first. */
export class WriteRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteRefused";
  }
}

/**
 * The notated length of the measure at `measureIndex`, from the time signature in
 * effect (the most recent `MeasureAttributes.timeSig` at or before this measure) or
 * this measure's own `actualLength` pickup override.
 */
export function measureLengthAt(score: Score, measureIndex: number): Fraction {
  let ts: TimeSignature | undefined;
  for (let i = 0; i <= measureIndex; i++) {
    const ma = score.measures[i];
    if (!ma) break;
    if (ma.timeSig) ts = ma.timeSig;
  }
  const actual = score.measures[measureIndex]?.actualLength;
  if (actual) return actual;
  if (!ts) throw new Error(`measureLengthAt: no time signature in effect at measure ${measureIndex}`);
  return timeSigMeasureLength(ts);
}

/** Voice items positioned at the top level only (tuplets are opaque blocks, not descended into). */
function topLevelPositions(items: readonly VoiceItem[]): { item: VoiceItem; offset: Fraction; length: Fraction }[] {
  const out: { item: VoiceItem; offset: Fraction; length: Fraction }[] = [];
  let t = ZERO;
  for (const item of items) {
    const length = itemLength(item);
    out.push({ item, offset: t, length });
    t = add(t, length);
  }
  return out;
}

function isSoleMeasureRest(voice: { items: readonly VoiceItem[] }): boolean {
  const only = voice.items.length === 1 ? voice.items[0] : undefined;
  return !!only && only.kind === "rest" && only.measureRest === true;
}

/**
 * Returns a refusal message if writing an event of length `len` at `cursor` isn't
 * allowed, or `null` if it's fine. Pure; never throws for the conditions it checks
 * (missing cursor targets are still reported as a message, not an exception).
 */
export function canWrite(score: Score, cursor: Cursor, len: Fraction): string | null {
  const part = score.parts[cursor.partIndex];
  if (!part) return `No part at index ${cursor.partIndex}`;
  const pm = part.measures[cursor.measureIndex];
  if (!pm) return `No measure at index ${cursor.measureIndex}`;
  const sm = pm.staves[cursor.staffIndex];
  if (!sm) return `No staff at index ${cursor.staffIndex}`;
  const voice = sm.voices[cursor.voiceIndex];
  if (!voice) return `No voice at index ${cursor.voiceIndex}`;

  let measureLen: Fraction;
  try {
    measureLen = measureLengthAt(score, cursor.measureIndex);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }

  const spanEnd = add(cursor.offset, len);
  if (lt(measureLen, spanEnd)) {
    return `Does not fit in the measure: ${fracToString(cursor.offset)} + ${fracToString(len)} exceeds ${fracToString(measureLen)}`;
  }

  if (!isSoleMeasureRest(voice)) {
    for (const pe of positionedEvents(voice)) {
      if (pe.tuplets.length === 0) continue;
      const evEnd = add(pe.offset, pe.length);
      if (lt(pe.offset, spanEnd) && lt(cursor.offset, evEnd)) {
        return "Cannot write into a tuplet yet";
      }
    }
  }

  return null;
}

/** The prefix of `event` before the write span starts, re-expressed to fit `prefixLen`. */
function prefixPieces(event: Event, prefixLen: Fraction): VoiceItem[] {
  if (event.kind === "rest") return restsFor(prefixLen);
  try {
    const decomposed = decomposeDuration(prefixLen);
    if (decomposed.length === 1) {
      const shortened: NoteEvent = { ...event, duration: decomposed[0]! };
      return [shortened];
    }
  } catch {
    // not representable as a single notated value (or at all) -> fall back to rests
  }
  return restsFor(prefixLen);
}

/**
 * Collapses a voice to a single `measureRest` if every item in it is a rest.
 * No-op if it's already that shape. Never touches a voice containing a tuplet.
 */
export function normalizeVoice(voice: { items: VoiceItem[] }): void {
  if (!voice.items.every((i) => i.kind === "rest")) return;
  if (isSoleMeasureRest(voice)) return;
  voice.items = [{ kind: "rest", id: newId(), duration: { base: 1, dots: 0 }, measureRest: true }];
}

/**
 * Writes `event` at `cursor`, implementing the span-replace semantics from
 * docs/ARCHITECTURE.md: in the addressed voice, the span [offset, offset+len) is
 * replaced. Events wholly inside the span are dropped; an event straddling the
 * start is shortened to its prefix (kept as the same note if the shortened prefix
 * is a single notated value, otherwise re-expressed as rests); an event straddling
 * the end has its remainder re-expressed as rests. Throws `WriteRefused` if the
 * write doesn't fit the measure or would touch a tuplet.
 */
export function writeEvent(cursor: Cursor, event: NoteEvent | RestEvent): Command {
  return {
    label: event.kind === "rest" ? "Write rest" : "Write note",
    apply(draft) {
      const len = notatedToFraction(event.duration);
      const refusal = canWrite(draft, cursor, len);
      if (refusal) throw new WriteRefused(refusal);
      writeSpan(draft, cursor, len, [{ ...event }]);
    },
  };
}

/**
 * Core span-replace: in the voice addressed by `cursor`, replaces [cursor.offset,
 * cursor.offset + spanLen) with `newItems`. Shared by `writeEvent` (single item) and
 * `writeSequence` (one call per measure-bounded chunk of a split event). Callers are
 * responsible for checking `canWrite` first (this never refuses).
 */
function writeSpan(draft: Draft<Score>, cursor: Cursor, spanLen: Fraction, newItems: VoiceItem[]): void {
  const part = draft.parts[cursor.partIndex]!;
  const pm = part.measures[cursor.measureIndex]!;
  const sm = pm.staves[cursor.staffIndex]!;
  const voice = sm.voices[cursor.voiceIndex]!;

  const spanStart = cursor.offset;
  const spanEnd = add(spanStart, spanLen);

  const positions = isSoleMeasureRest(voice)
    ? [{ item: voice.items[0]!, offset: ZERO, length: measureLengthAt(draft, cursor.measureIndex) }]
    : topLevelPositions(voice.items);

  const out: VoiceItem[] = [];
  let insertedNew = false;
  for (const { item, offset, length } of positions) {
    const end = add(offset, length);
    const overlaps = lt(offset, spanEnd) && lt(spanStart, end);
    if (!overlaps) {
      out.push(item);
      continue;
    }
    // Guarded by canWrite (called by every caller before writeSpan): an overlapping
    // item here is never a tuplet.
    const ev = item as Event;
    if (lt(offset, spanStart)) {
      out.push(...prefixPieces(ev, sub(spanStart, offset)));
    }
    if (!insertedNew) {
      out.push(...newItems);
      insertedNew = true;
    }
    if (lt(spanEnd, end)) {
      out.push(...restsFor(sub(end, spanEnd)));
    }
  }
  if (!insertedNew) out.push(...newItems);

  voice.items = out;
  normalizeVoice(voice);
}

/** Ensures the score has at least `measureIndex + 1` measures, appending empty ones (same logic as `addMeasures`, so the final barline follows) as needed. */
function ensureMeasureExists(draft: Draft<Score>, measureIndex: number): void {
  while (draft.measures.length <= measureIndex) {
    addMeasures(1).apply(draft);
  }
}

/** One piece of a (possibly split) note or rest: which measure/offset it lands at, and its notated length. */
interface WriteSlot {
  measureIndex: number;
  offset: Fraction;
  duration: NotatedDuration;
}

/** A copy of `base` (a rest) re-expressed with `duration`, given a fresh id unless `keepId`. Never a measure-rest. */
function pieceForRest(base: RestEvent, duration: NotatedDuration, keepId: boolean): RestEvent {
  const piece: RestEvent = { ...base, id: keepId ? base.id : newId(), duration };
  delete piece.measureRest;
  if (!keepId) delete piece.grace;
  return piece;
}

/** A copy of `base` (a note/chord) re-expressed with `duration`, same pitches, given fresh ids unless `keepId`. `forceTie` sets tieStart on every note regardless of the original (used for every piece but the last of a split). */
function pieceForNote(base: NoteEvent, duration: NotatedDuration, keepId: boolean, forceTie: boolean): NoteEvent {
  const notes: Note[] = base.notes.map((n) => {
    const note: Note = { ...n, id: keepId ? n.id : newId() };
    if (forceTie) note.tieStart = true;
    return note;
  });
  const piece: NoteEvent = { ...base, id: keepId ? base.id : newId(), duration, notes };
  if (!keepId) delete piece.grace;
  return piece;
}

/**
 * Writes `events` back to back starting at `cursor`, splitting any event that doesn't
 * fit in the remaining part of its measure: the fitting part is written and the
 * remainder continues into the next measure (and the next, as many times as needed).
 * A split note is re-expressed as several notated pieces (via `decomposeDuration`),
 * tied together (`tieStart` on every piece but the last; same pitches; fresh ids on
 * every piece but the first). A split rest is just split into plain rests. Measures
 * are appended as needed (see `ensureMeasureExists`), so this never refuses on
 * overflow — only (like `writeEvent`) if the span would touch an existing tuplet.
 */
export function writeSequence(cursor: Cursor, events: readonly (NoteEvent | RestEvent)[]): Command {
  return {
    label: "Write sequence",
    apply(draft) {
      let measureIndex = cursor.measureIndex;
      let offset = cursor.offset;

      for (const event of events) {
        let remaining = notatedToFraction(event.duration);
        const chunks: { measureIndex: number; offset: Fraction; len: Fraction }[] = [];

        while (!eq(remaining, ZERO)) {
          ensureMeasureExists(draft, measureIndex);
          const measureLen = measureLengthAt(draft, measureIndex);
          const available = sub(measureLen, offset);
          const chunkLen = lt(available, remaining) ? available : remaining;
          chunks.push({ measureIndex, offset, len: chunkLen });
          remaining = sub(remaining, chunkLen);
          offset = add(offset, chunkLen);
          if (eq(offset, measureLen)) {
            measureIndex += 1;
            offset = ZERO;
          }
        }

        const slots: WriteSlot[] = [];
        for (const chunk of chunks) {
          let pieceOffset = chunk.offset;
          for (const duration of decomposeDuration(chunk.len)) {
            slots.push({ measureIndex: chunk.measureIndex, offset: pieceOffset, duration });
            pieceOffset = add(pieceOffset, notatedToFraction(duration));
          }
        }

        slots.forEach((slot, i) => {
          const isFirst = i === 0;
          const isLast = i === slots.length - 1;
          const piece: NoteEvent | RestEvent =
            event.kind === "rest"
              ? pieceForRest(event, slot.duration, isFirst)
              : pieceForNote(event, slot.duration, isFirst, !isLast);

          const slotCursor: Cursor = { ...cursor, measureIndex: slot.measureIndex, offset: slot.offset };
          const slotLen = notatedToFraction(slot.duration);
          const refusal = canWrite(draft, slotCursor, slotLen);
          if (refusal) throw new WriteRefused(refusal);
          writeSpan(draft, slotCursor, slotLen, [piece]);
        });
      }
    },
  };
}

/** Total length of writing `events` back to back. Pure. */
export function sequenceLength(events: readonly (NoteEvent | RestEvent)[]): Fraction {
  return events.reduce((acc, e) => add(acc, notatedToFraction(e.duration)), ZERO);
}

/**
 * True if `writeSequence(cursor, events)` would not need to touch any existing tuplet
 * along the way (measures it would still need to append never contain tuplets, so
 * those always "fit"). Pure; does not check whether measures would need appending.
 */
export function sequenceFits(score: Score, cursor: Cursor, events: readonly (NoteEvent | RestEvent)[]): boolean {
  let measureIndex = cursor.measureIndex;
  let offset = cursor.offset;
  let remaining = sequenceLength(events);

  while (!eq(remaining, ZERO)) {
    const measureCount = score.parts[cursor.partIndex]?.measures.length ?? 0;
    if (measureIndex >= measureCount) return true; // beyond existing measures: would be appended, never a tuplet
    let measureLen: Fraction;
    try {
      measureLen = measureLengthAt(score, measureIndex);
    } catch {
      return true;
    }
    const available = sub(measureLen, offset);
    const chunkLen = lt(available, remaining) ? available : remaining;
    if (canWrite(score, { ...cursor, measureIndex, offset }, chunkLen)) return false;
    remaining = sub(remaining, chunkLen);
    offset = add(offset, chunkLen);
    if (eq(offset, measureLen)) {
      measureIndex += 1;
      offset = ZERO;
    }
  }
  return true;
}

/** Replaces the event with id `eventId` with rests of the same length, then normalizes the voice. */
export function eraseEvent(eventId: string): Command {
  return {
    label: "Erase event",
    apply(draft) {
      const hit = locateEvent(draft, eventId);
      if (!hit) throw new Error(`eraseEvent: no event with id "${eventId}"`);
      const rests = restsFor(notatedToFraction(hit.event.duration));
      hit.items.splice(hit.index, 1, ...rests);
      normalizeVoice(hit.voice);
    },
  };
}

/** Adds `pitch` to the chord at `eventId`, keeping notes sorted ascending by pitch. No-op if the pitch is already present. */
export function addNoteToEvent(eventId: string, pitch: Pitch): Command {
  return {
    label: "Add note",
    apply(draft) {
      const hit = locateEvent(draft, eventId);
      if (!hit) throw new Error(`addNoteToEvent: no event with id "${eventId}"`);
      if (hit.event.kind !== "note") throw new Error(`addNoteToEvent: event "${eventId}" is not a note event`);
      if (hit.event.notes.some((n) => pitchEquals(n.pitch, pitch))) return;
      const newNote: Note = { id: newId(), pitch };
      hit.event.notes.push(newNote);
      hit.event.notes.sort((a, b) => comparePitch(a.pitch, b.pitch));
    },
  };
}

/** Removes note `noteId` from event `eventId`. If it was the last note in the chord, the event is erased to rests. */
export function removeNoteFromEvent(eventId: string, noteId: string): Command {
  return {
    label: "Remove note",
    apply(draft) {
      const hit = locateEvent(draft, eventId);
      if (!hit) throw new Error(`removeNoteFromEvent: no event with id "${eventId}"`);
      if (hit.event.kind !== "note") throw new Error(`removeNoteFromEvent: event "${eventId}" is not a note event`);
      const idx = hit.event.notes.findIndex((n) => n.id === noteId);
      if (idx === -1) throw new Error(`removeNoteFromEvent: no note with id "${noteId}" on event "${eventId}"`);
      if (hit.event.notes.length === 1) {
        eraseEvent(eventId).apply(draft);
        return;
      }
      hit.event.notes.splice(idx, 1);
    },
  };
}

/** Changes the alteration of note `noteId`, keeping its chord sorted (alter affects sounding pitch order). */
export function setNoteAlter(noteId: string, alter: Alter): Command {
  return {
    label: "Set note alter",
    apply(draft) {
      const hit = locateNote(draft, noteId);
      if (!hit) throw new Error(`setNoteAlter: no note with id "${noteId}"`);
      hit.note.pitch = { ...hit.note.pitch, alter };
      hit.notes.sort((a, b) => comparePitch(a.pitch, b.pitch));
    },
  };
}

/** Transposes the given notes by a fixed number of semitones or octaves. */
export function transposeNotes(noteIds: readonly string[], by: { semitones: number } | { octaves: number }): Command {
  return {
    label: "Transpose notes",
    apply(draft) {
      const touchedEventIds = new Set<string>();
      for (const noteId of noteIds) {
        const hit = locateNote(draft, noteId);
        if (!hit) continue;
        touchedEventIds.add(hit.event.id);
        if ("octaves" in by) {
          hit.note.pitch = { ...hit.note.pitch, octave: hit.note.pitch.octave + by.octaves };
          continue;
        }
        const dir: 1 | -1 = by.semitones >= 0 ? 1 : -1;
        let pitch = hit.note.pitch;
        for (let i = 0; i < Math.abs(by.semitones); i++) pitch = transposeSemitone(pitch, dir);
        hit.note.pitch = pitch;
      }
      // Re-sort every touched chord: alter/octave changes can change sounding order.
      for (const eventId of touchedEventIds) {
        const hit = locateEvent(draft, eventId);
        if (hit && hit.event.kind === "note") hit.event.notes.sort((a, b) => comparePitch(a.pitch, b.pitch));
      }
    },
  };
}

/** Appends one empty measure to the end of the score. */
export function appendMeasure(): Command {
  return addMeasures(1);
}
