/**
 * The MIDI channel messages a timeline's notes and pedal turn into, and the order
 * events on the same tick must go out in. Shared by the file writer (src/io/midi) and the
 * live player (./player.ts), so a saved file and a live performance can never disagree
 * about, say, whether a note-off comes before the next strike of the same key.
 */
import type { Timeline, TimelineTrack } from "./timeline";

/** Tie-break order for events sharing a tick (lower first). */
export const ORDER = {
  meta: 0,
  setup: 1,
  /** A note must end before the same key is struck again... */
  noteOff: 2,
  /** ...and it rings on until a pedal lift on the same tick... */
  pedalUp: 3,
  /** ...which comes before a re-press (a pedal *change*), ... */
  pedalDown: 4,
  lyric: 5,
  /** ...and everything is settled before that tick's new notes sound. */
  noteOn: 6,
} as const;

export interface ChannelMessage {
  tick: number;
  order: number;
  bytes: number[];
}

export const CC_SUSTAIN = 64;
export const CC_ALL_SOUND_OFF = 120;
export const CC_ALL_NOTES_OFF = 123;

export const noteOn = (channel: number, pitch: number, velocity: number): number[] => [0x90 | channel, pitch, velocity];
export const noteOff = (channel: number, pitch: number): number[] => [0x80 | channel, pitch, 0];
export const controlChange = (channel: number, controller: number, value: number): number[] => [
  0xb0 | channel,
  controller,
  value,
];
export const programChange = (channel: number, program: number): number[] => [0xc0 | channel, program];

/** One track's notes and sustain pedal as channel messages, in no particular order. */
export function trackMessages(track: TimelineTrack): ChannelMessage[] {
  const ch = track.channel;
  const out: ChannelMessage[] = [];
  for (const n of track.notes) {
    out.push({ tick: n.onTick, order: ORDER.noteOn, bytes: noteOn(ch, n.pitch, n.velocity) });
    out.push({ tick: n.offTick, order: ORDER.noteOff, bytes: noteOff(ch, n.pitch) });
  }
  for (const c of track.controllers) {
    out.push({
      tick: c.tick,
      order: c.controller === CC_SUSTAIN && c.value === 0 ? ORDER.pedalUp : ORDER.pedalDown,
      bytes: controlChange(ch, c.controller, c.value),
    });
  }
  return out;
}

/** Every track's notes and pedal, merged and sorted into playing order. */
export function timelineMessages(timeline: Timeline): ChannelMessage[] {
  const all = timeline.tracks.flatMap(trackMessages);
  return all
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.tick - b.m.tick || a.m.order - b.m.order || a.i - b.i)
    .map(({ m }) => m);
}
