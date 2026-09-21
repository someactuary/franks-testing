/**
 * Score -> Standard MIDI File. All musical interpretation lives in the playback
 * timeline (src/playback/timeline.ts); this only lays that timeline out as SMF tracks:
 * a conductor track (title, tempo map, time/key signatures, rehearsal marks) followed by
 * one track per staff, all of a part's staves sharing one channel so its pedal is one pedal.
 */
import { buildTimeline, type PlaybackOptions, type Timeline } from "@/playback/timeline";
import type { Score } from "@/model/score";
import {
  controlChange,
  keySignatureEvent,
  META,
  noteOff,
  noteOn,
  ORDER,
  programChange,
  tempoEvent,
  textEvent,
  timeSignatureEvent,
  writeSmf,
  type RawEvent,
} from "./smf";

const CC_VOLUME = 7;
const CC_PAN = 10;

export function timelineToMidi(tl: Timeline): Uint8Array<ArrayBuffer> {
  const conductor: RawEvent[] = [
    { tick: 0, order: ORDER.meta, bytes: textEvent(META.trackName, tl.title ?? "Score") },
  ];
  if (tl.composer) conductor.push({ tick: 0, order: ORDER.meta, bytes: textEvent(META.text, `Composer: ${tl.composer}`) });
  if (tl.copyright) conductor.push({ tick: 0, order: ORDER.meta, bytes: textEvent(META.copyright, tl.copyright) });
  for (const t of tl.tempos) conductor.push({ tick: t.tick, order: ORDER.meta, bytes: tempoEvent(t.usPerQuarter) });
  for (const t of tl.timeSignatures) {
    conductor.push({ tick: t.tick, order: ORDER.meta, bytes: timeSignatureEvent(t.numerator, t.denominator) });
  }
  for (const k of tl.keySignatures) {
    conductor.push({ tick: k.tick, order: ORDER.meta, bytes: keySignatureEvent(k.fifths, k.mode) });
  }
  for (const m of tl.markers) conductor.push({ tick: m.tick, order: ORDER.meta, bytes: textEvent(META.marker, m.text) });

  const tracks: RawEvent[][] = [conductor];
  for (const track of tl.tracks) {
    const ch = track.channel;
    const events: RawEvent[] = [
      { tick: 0, order: ORDER.meta, bytes: textEvent(META.trackName, track.name) },
      { tick: 0, order: ORDER.setup, bytes: programChange(ch, track.program) },
      { tick: 0, order: ORDER.setup, bytes: controlChange(ch, CC_VOLUME, 100) },
      { tick: 0, order: ORDER.setup, bytes: controlChange(ch, CC_PAN, 64) },
    ];
    for (const n of track.notes) {
      events.push({ tick: n.onTick, order: ORDER.noteOn, bytes: noteOn(ch, n.pitch, n.velocity) });
      events.push({ tick: n.offTick, order: ORDER.noteOff, bytes: noteOff(ch, n.pitch) });
    }
    for (const c of track.controllers) {
      events.push({
        tick: c.tick,
        order: c.controller === 64 && c.value === 0 ? ORDER.pedalUp : ORDER.pedalDown,
        bytes: controlChange(ch, c.controller, c.value),
      });
    }
    for (const l of track.lyrics) events.push({ tick: l.tick, order: ORDER.lyric, bytes: textEvent(META.lyric, l.text) });
    tracks.push(events);
  }
  return writeSmf(tracks, tl.ppq, tl.totalTicks);
}

/** The score as a Standard MIDI File (format 1). See `PlaybackOptions` for how it is interpreted. */
export function exportMidi(score: Score, opts: PlaybackOptions = {}): Uint8Array<ArrayBuffer> {
  return timelineToMidi(buildTimeline(score, opts));
}
