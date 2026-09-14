/**
 * Pure cursor/voice navigation helpers shared by src/input/step-entry.ts and (eventually)
 * the UI. No commands, no mutation: these only read a `Score` and a `Cursor`.
 */
import { add, eq, lt, positionedEvents, ZERO, type Fraction } from "@/model";
import type { KeySignature, Score } from "@/model";
import type { Event } from "@/commands/locate";
import { measureLengthAt } from "@/commands/edit";
import type { Cursor } from "./types";

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
 * staff/voice that doesn't exist.
 */
function voiceAt(score: Score, cursor: Cursor) {
  const part = score.parts[cursor.partIndex];
  const pm = part?.measures[cursor.measureIndex];
  const sm = pm?.staves[cursor.staffIndex];
  return sm?.voices[cursor.voiceIndex];
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
