/**
 * Pure cursor/voice navigation helpers shared by src/input/step-entry.ts and (eventually)
 * the UI. No commands, no mutation: these only read a `Score` and a `Cursor`.
 */
import { add, eq, lt, positionedEvents, ZERO, type Fraction } from "@/model";
import type { KeySignature, Score } from "@/model";
import { locateEvent, locateNote, type Event } from "@/commands/locate";
import { measureLengthAt } from "@/commands/edit";
import type { Cursor, Selection } from "./types";

export { measureLengthAt as measureLength };

/** One event in a voice, positioned at a measure-relative offset. */
export interface PositionedVoiceEvent {
  event: Event;
  offset: Fraction;
  length: Fraction;
}

function isSoleMeasureRest(voice: { items: readonly { kind: string; measureRest?: boolean }[] }): boolean {
  const only = voice.items.length === 1 ? voice.items[0] : undefined;
  return !!only && only.kind === "rest" && only.measureRest === true;
}

/**
 * The voice addressed by `cursor`, or undefined if the cursor addresses a part/measure/
 * staff/voice that doesn't exist. Looked up by `Voice.index` (not array position):
 * voices are kept sorted by index, but the array may be sparse (e.g. voice 2 exists
 * without voice 1), so position and index only coincide for voice 0.
 */
function voiceAt(score: Score, cursor: Cursor) {
  const part = score.parts[cursor.partIndex];
  const pm = part?.measures[cursor.measureIndex];
  const sm = pm?.staves[cursor.staffIndex];
  return sm?.voices.find((v) => v.index === cursor.voiceIndex);
}

/**
 * The events of the voice addressed by `cursor`, positioned within the measure. A lone
 * `measureRest` is reported as a single event spanning the whole measure (using the time
 * signature in effect), matching the span-replace semantics `writeEvent` uses, rather than
 * its stored (always-whole-note) notated duration.
 */
export function eventsInVoice(score: Score, cursor: Cursor): PositionedVoiceEvent[] {
  const voice = voiceAt(score, cursor);
  if (!voice) return [];
  if (isSoleMeasureRest(voice)) {
    return [{ event: voice.items[0] as Event, offset: ZERO, length: measureLengthAt(score, cursor.measureIndex) }];
  }
  return positionedEvents(voice).map((pe) => ({ event: pe.event, offset: pe.offset, length: pe.length }));
}

/** The offset of the event immediately after `cursor.offset` in its voice, or null if there is none. */
export function nextOffset(score: Score, cursor: Cursor): Fraction | null {
  let best: Fraction | null = null;
  for (const pe of eventsInVoice(score, cursor)) {
    if (lt(cursor.offset, pe.offset) && (best === null || lt(pe.offset, best))) best = pe.offset;
  }
  return best;
}

/** The offset of the event immediately before `cursor.offset` in its voice, or null if there is none. */
export function prevOffset(score: Score, cursor: Cursor): Fraction | null {
  let best: Fraction | null = null;
  for (const pe of eventsInVoice(score, cursor)) {
    if (lt(pe.offset, cursor.offset) && (best === null || lt(best, pe.offset))) best = pe.offset;
  }
  return best;
}

/** The event whose span contains `cursor.offset`, if any. */
export function eventAtCursor(score: Score, cursor: Cursor): PositionedVoiceEvent | undefined {
  return eventsInVoice(score, cursor).find(
    (pe) => !lt(cursor.offset, pe.offset) && lt(cursor.offset, add(pe.offset, pe.length)),
  );
}

/**
 * The event immediately before the cursor: the one ending exactly at `cursor.offset`
 * (the usual case, right after entering it), or failing that the closest one starting
 * before it.
 */
export function eventBeforeCursor(score: Score, cursor: Cursor): PositionedVoiceEvent | undefined {
  const events = eventsInVoice(score, cursor);
  const atEnd = events.find((pe) => eq(add(pe.offset, pe.length), cursor.offset));
  if (atEnd) return atEnd;
  let best: PositionedVoiceEvent | undefined;
  for (const pe of events) {
    if (lt(pe.offset, cursor.offset) && (!best || lt(best.offset, pe.offset))) best = pe;
  }
  return best;
}

/**
 * The event a chord tone (Shift+letter, or a MIDI key played while others are held)
 * should join: the event just before the cursor, or, when the cursor sits at the start
 * of a measure because the previous note filled the last one, that previous measure's
 * final event in the same voice. Deliberately separate from `eventBeforeCursor`, whose
 * callers (Backspace) rely on it never crossing a barline.
 */
export function chordTarget(score: Score, cursor: Cursor): PositionedVoiceEvent | undefined {
  const here = eventBeforeCursor(score, cursor);
  if (here) return here;
  if (cursor.offset.num !== 0 || cursor.measureIndex === 0) return undefined;
  const prev = eventsInVoice(score, { ...cursor, measureIndex: cursor.measureIndex - 1 });
  let last: PositionedVoiceEvent | undefined;
  for (const pe of prev) if (!last || lt(last.offset, pe.offset)) last = pe;
  return last;
}

/** The key signature in effect at `measureIndex` (the most recent `MeasureAttributes.keySig` at or before it). */
export function keySignatureAt(score: Score, measureIndex: number): KeySignature {
  let key: KeySignature = { fifths: 0, mode: "major" };
  for (let i = 0; i <= measureIndex; i++) {
    const ma = score.measures[i];
    if (!ma) break;
    if (ma.keySig) key = ma.keySig;
  }
  return key;
}

/** Absolute time (sum of every prior measure's length, plus `offset`) at `(measureIndex, offset)`. */
export function absoluteOffset(score: Score, measureIndex: number, offset: Fraction): Fraction {
  let t = ZERO;
  for (let i = 0; i < measureIndex; i++) t = add(t, measureLengthAt(score, i));
  return add(t, offset);
}

/** Selection ids for one event: the note ids for a NoteEvent (so highlighting is per notehead), the event id for a rest. */
export function idsForEvent(event: Event): string[] {
  return event.kind === "note" ? event.notes.map((n) => n.id) : [event.id];
}

/** One selected event, resolved from a selection id, with enough location info to erase/copy/sort it. */
export interface SelectedEvent {
  event: Event;
  partIndex: number;
  measureIndex: number;
  staffIndex: number;
  voiceIndex: number;
  /** Measure-relative offset. */
  offset: Fraction;
  /** True if the event lives inside a tuplet (top-level `writeEvent`/`writeSequence` can't touch it). */
  inTuplet: boolean;
}

/**
 * Resolves `selection.ids` (note ids or rest/event ids) to their owning events,
 * deduplicated by event id (a chord's several note ids collapse to one entry). Stale
 * ids that no longer resolve to anything in `score` are silently dropped. Pure.
 */
export function resolveSelection(score: Score, selection: Selection): SelectedEvent[] {
  const seen = new Set<string>();
  const out: SelectedEvent[] = [];
  for (const id of selection.ids) {
    const noteHit = locateNote(score, id);
    const located = locateEvent(score, noteHit ? noteHit.event.id : id);
    if (!located || seen.has(located.event.id)) continue;
    seen.add(located.event.id);

    const voiceCursor: Cursor = {
      partIndex: located.partIndex,
      measureIndex: located.measureIndex,
      staffIndex: located.staffIndex,
      voiceIndex: located.voiceIndex,
      offset: ZERO,
    };
    const positioned = eventsInVoice(score, voiceCursor).find((pe) => pe.event.id === located.event.id);
    out.push({
      event: located.event,
      partIndex: located.partIndex,
      measureIndex: located.measureIndex,
      staffIndex: located.staffIndex,
      voiceIndex: located.voiceIndex,
      offset: positioned?.offset ?? ZERO,
      inTuplet: located.tuplets.length > 0,
    });
  }
  return out;
}
