/**
 * A minimal Standard MIDI File (format 1) writer: byte-level encoding only, no notion of
 * scores. Callers hand it tracks of already-timed raw events.
 */

/** One encoded event at an absolute tick. `order` (see playback/messages.ts) breaks ties between events at the same tick, lower first. */
export interface RawEvent {
  tick: number;
  order: number;
  bytes: number[];
}

/** MIDI variable-length quantity. */
export function varLen(value: number): number[] {
  let v = Math.max(0, Math.floor(value));
  const out = [v & 0x7f];
  while ((v >>= 7) > 0) out.unshift((v & 0x7f) | 0x80);
  return out;
}

const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number): number[] => [(n >>> 8) & 0xff, n & 0xff];

const encoder = new TextEncoder();

export function metaEvent(type: number, data: readonly number[]): number[] {
  return [0xff, type, ...varLen(data.length), ...data];
}

export function textEvent(type: number, text: string): number[] {
  return metaEvent(type, Array.from(encoder.encode(text)));
}

export const META = {
  text: 0x01,
  copyright: 0x02,
  trackName: 0x03,
  lyric: 0x05,
  marker: 0x06,
  endOfTrack: 0x2f,
  tempo: 0x51,
  timeSignature: 0x58,
  keySignature: 0x59,
} as const;

export function tempoEvent(usPerQuarter: number): number[] {
  const us = Math.max(1, Math.min(0xffffff, Math.round(usPerQuarter)));
  return metaEvent(META.tempo, [(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]);
}

/** Time signature meta event. `denominator` must be a power of two. */
export function timeSignatureEvent(numerator: number, denominator: number): number[] {
  const exponent = Math.round(Math.log2(denominator));
  // Metronome click: once per beat — a dotted quarter in compound meters (6/8, 9/8, 12/8).
  const compound = denominator >= 8 && numerator % 3 === 0 && numerator > 3;
  const clocksPerClick = Math.round((96 / denominator) * (compound ? 3 : 1));
  return metaEvent(META.timeSignature, [numerator & 0xff, exponent, clocksPerClick, 8]);
}

export function keySignatureEvent(fifths: number, mode: "major" | "minor"): number[] {
  return metaEvent(META.keySignature, [fifths & 0xff, mode === "minor" ? 1 : 0]);
}

function encodeTrack(events: readonly RawEvent[], endTick: number): number[] {
  const sorted = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.tick - b.e.tick || a.e.order - b.e.order || a.i - b.i);
  const body: number[] = [];
  let last = 0;
  for (const { e } of sorted) {
    body.push(...varLen(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  body.push(...varLen(Math.max(0, endTick - last)), ...metaEvent(META.endOfTrack, []));
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body]; // "MTrk"
}

/** Serialises tracks as a format-1 SMF with `ppq` ticks per quarter note; every track ends at `endTick`. */
export function writeSmf(
  tracks: readonly (readonly RawEvent[])[],
  ppq: number,
  endTick: number,
): Uint8Array<ArrayBuffer> {
  const out: number[] = [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    ...u32(6),
    ...u16(1), // format 1: simultaneous tracks
    ...u16(tracks.length),
    ...u16(ppq),
  ];
  for (const track of tracks) out.push(...encodeTrack(track, endTick));
  return Uint8Array.from(out);
}
