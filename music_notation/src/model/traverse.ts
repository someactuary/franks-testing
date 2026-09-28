import { add, frac, mul, notatedToFraction, ZERO, type Fraction } from "./duration";
import type { NoteEvent, RestEvent, Score, TupletGroup, Voice, VoiceItem } from "./score";

export type Event = NoteEvent | RestEvent;

export interface PositionedEvent {
  event: Event;
  /** Offset from the start of the measure. */
  offset: Fraction;
  /** Actual sounding length after tuplet scaling. */
  length: Fraction;
  /** Enclosing tuplets, outermost first. */
  tuplets: TupletGroup[];
}

/** Sounding length of a voice item, applying tuplet ratios. */
export function itemLength(item: VoiceItem, tupletScale: Fraction = frac(1)): Fraction {
  if (item.kind === "tuplet") {
    const scale = mul(tupletScale, frac(item.ratio.normal, item.ratio.actual));
    let acc = ZERO;
    for (const child of item.items) acc = add(acc, itemLength(child, scale));
    return acc;
  }
  return mul(notatedToFraction(item.duration), tupletScale);
}

/** Flatten a voice into events with measure-relative offsets. */
export function positionedEvents(voice: Voice): PositionedEvent[] {
  const out: PositionedEvent[] = [];
  const walk = (items: VoiceItem[], start: Fraction, scale: Fraction, tuplets: TupletGroup[]): Fraction => {
    let t = start;
    for (const item of items) {
      if (item.kind === "tuplet") {
        const s = mul(scale, frac(item.ratio.normal, item.ratio.actual));
        t = walk(item.items, t, s, [...tuplets, item]);
      } else {
        const length = mul(notatedToFraction(item.duration), scale);
        out.push({ event: item, offset: t, length, tuplets });
        t = add(t, length);
      }
    }
    return t;
  };
  walk(voice.items, ZERO, frac(1), []);
  return out;
}

export function voiceLength(voice: Voice): Fraction {
  let acc = ZERO;
  for (const item of voice.items) acc = add(acc, itemLength(item));
  return acc;
}

/** Iterate every event in the score with its location. */
export function* allEvents(score: Score): Generator<{
  partIndex: number;
  measureIndex: number;
  staffIndex: number;
  voice: Voice;
  positioned: PositionedEvent;
}> {
  for (const [partIndex, part] of score.parts.entries()) {
    for (const [measureIndex, pm] of part.measures.entries()) {
      for (const [staffIndex, sm] of pm.staves.entries()) {
        for (const voice of sm.voices) {
          for (const positioned of positionedEvents(voice)) {
            yield { partIndex, measureIndex, staffIndex, voice, positioned };
          }
        }
      }
    }
  }
}

/** Find an event by id anywhere in the score. */
export function findEvent(score: Score, id: string): Event | undefined {
  for (const e of allEvents(score)) if (e.positioned.event.id === id) return e.positioned.event;
  return undefined;
}
