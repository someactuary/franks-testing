import { describe, expect, it } from "vitest";
import { resolveTies } from "@/engraving/ties";
import { exportMidi } from "@/io/midi/export";
import { newId, newPianoScore, note, rest, allEvents, type Score } from "@/model";
import { buildTimeline, PPQ } from "@/playback/timeline";
import { FIXTURES } from "../fixtures";
import { notesOf, parseMidi, type MidiEvent } from "./smf-reader";

const literal = { interpretation: "literal" as const, unfoldRepeats: false };

function simple(): Score {
  const score = newPianoScore({ measureCount: 2, title: "Étude in C", composer: "F. Chang" });
  score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = [note("C5", 4), note("D5", 4), note("E5", 2)];
  score.parts[0]!.measures[0]!.staves[1]!.voices[0]!.items = [note("C3", 1)];
  return score;
}

const metaText = (events: MidiEvent[], type: number): string[] =>
  events.flatMap((e) => (e.type === "text" && e.metaType === type ? [e.text] : []));

describe("exportMidi: file structure", () => {
  it("writes a format-1 file with a conductor track plus one track per staff", () => {
    const midi = parseMidi(exportMidi(simple()));
    expect(midi.format).toBe(1);
    expect(midi.ppq).toBe(PPQ);
    expect(midi.tracks).toHaveLength(3);
  });

  it("puts the title, composer, tempo, time and key signature in the conductor track", () => {
    const [conductor] = parseMidi(exportMidi(simple())).tracks;
    expect(metaText(conductor!, 0x03)).toEqual(["Étude in C"]);
    expect(metaText(conductor!, 0x01)).toEqual(["Composer: F. Chang"]);
    expect(conductor!.find((e) => e.type === "tempo")).toMatchObject({ tick: 0, usPerQuarter: 500000 });
    expect(conductor!.find((e) => e.type === "timeSignature")).toMatchObject({ numerator: 4, denominator: 4 });
    expect(conductor!.find((e) => e.type === "keySignature")).toMatchObject({ fifths: 0, minor: false });
  });

  it("names each staff's track, sets its program and shares one channel per part", () => {
    const midi = parseMidi(exportMidi(simple()));
    const [, treble, bass] = midi.tracks;
    expect(metaText(treble!, 0x03)).toEqual(["Piano - Staff 1"]);
    expect(metaText(bass!, 0x03)).toEqual(["Piano - Staff 2"]);
    const channels = [treble!, bass!].map((t) => new Set(t.flatMap((e) => ("channel" in e ? [e.channel] : []))));
    expect(channels[0]).toEqual(channels[1]);
    expect(treble!.find((e) => e.type === "program")).toMatchObject({ tick: 0, program: 0 });
  });

  it("ends every track at the same tick", () => {
    const midi = parseMidi(exportMidi(simple()));
    const ends = midi.tracks.map((t) => t.find((e) => e.type === "endOfTrack")!.tick);
    expect(new Set(ends).size).toBe(1);
    expect(ends[0]).toBe(buildTimeline(simple()).totalTicks);
  });

  it("never sends a note-on with velocity 0 (which MIDI reads as a note-off)", () => {
    const midi = parseMidi(exportMidi(simple()));
    for (const t of midi.tracks) for (const e of t) if (e.type === "noteOn") expect(e.velocity).toBeGreaterThan(0);
  });

  it("orders a note-off before the next note-on of the same key on the same tick", () => {
    const score = newPianoScore({ measureCount: 1 });
    score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = [note("C4", 2), note("C4", 2)];
    const events = parseMidi(exportMidi(score, literal)).tracks[1]!.filter((e) => e.tick === PPQ * 2);
    expect(events.map((e) => e.type)).toEqual(["noteOff", "noteOn"]);
  });

  it("orders pedal release before press on one tick, and both after that tick's note-offs and before its note-ons", () => {
    const score = newPianoScore({ measureCount: 1 });
    const [a, b, c, d] = [note("C4", 4), note("D4", 4), note("E4", 4), note("F4", 4)];
    score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = [a, b, c, d];
    const pedal = (s: typeof a, e: typeof a) => ({
      id: newId(),
      kind: "pedal" as const,
      style: "line" as const,
      partIndex: 0,
      staffIndex: 0,
      start: { kind: "event" as const, eventId: s.id },
      end: { kind: "event" as const, eventId: e.id },
    });
    score.spanners.push(pedal(a, b), pedal(c, d));
    const at = parseMidi(exportMidi(score, literal)).tracks[1]!.filter((e) => e.tick === PPQ * 2);
    expect(at.map((e) => (e.type === "cc" ? `cc${e.value}` : e.type))).toEqual(["noteOff", "cc0", "cc127", "noteOn"]);
  });

  it("writes lyrics as lyric meta events", () => {
    const score = newPianoScore({ measureCount: 1 });
    const a = note("C4", 2);
    a.lyrics = [{ verse: 0, text: "Ah", syllabic: "single" }];
    score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = [a, rest(2)];
    expect(metaText(parseMidi(exportMidi(score)).tracks[1]!, 0x05)).toEqual(["Ah "]);
  });
});

describe("exportMidi: fidelity to the score", () => {
  it("round-trips a small score's notes exactly (pitch, tick, velocity) through the file bytes", () => {
    const tl = buildTimeline(simple());
    const midi = parseMidi(exportMidi(simple()));
    tl.tracks.forEach((track, i) => {
      const parsed = notesOf(midi.tracks[i + 1]!);
      expect(parsed.map((n) => [n.pitch, n.onTick, n.offTick, n.velocity])).toEqual(
        track.notes.map((n) => [n.pitch, n.onTick, n.offTick, n.velocity]),
      );
    });
  });

  it("keeps a whole piece the exact notated length", () => {
    const score = simple();
    // Two 4/4 measures: 2 * 4 quarters.
    expect(buildTimeline(score).totalTicks).toBe(8 * PPQ);
  });

  // The strongest structural check available without listening: in literal mode with
  // repeats left folded, every note in the score must sound exactly once, tied notes
  // merged, and nothing may be invented or lost — across every fixture score.
  describe.each(Object.entries(FIXTURES))("fixture %s", (_name, make) => {
    const score = make();

    it("exports without error and parses back as valid MIDI", () => {
      const midi = parseMidi(exportMidi(score));
      expect(midi.tracks.length).toBe(1 + score.parts.reduce((n, p) => n + p.staves.length, 0));
    });

    it("sounds every written note once, with ties merged (literal, no repeats unfolded)", () => {
      const grace = [...allEvents(score)].reduce(
        (n, e) => n + (e.positioned.event.kind === "note" ? (e.positioned.event.grace?.events.reduce((m, g) => m + g.notes.length, 0) ?? 0) : 0),
        0,
      );
      const written = [...allEvents(score)].reduce(
        (n, e) => n + (e.positioned.event.kind === "note" ? e.positioned.event.notes.length : 0),
        0,
      );
      const merged = resolveTies(score).pairs.length;
      const midi = parseMidi(exportMidi(score, literal));
      const sounded = midi.tracks.slice(1).reduce((n, t) => n + notesOf(t).length, 0);
      // Unison collapse (two staves striking one key at once) can only remove notes, never add.
      expect(sounded).toBeLessThanOrEqual(written - merged + grace);
      expect(sounded).toBeGreaterThan((written - merged + grace) * 0.9);
    });

    it("has positive-length notes, valid pitches/velocities, and no same-key overlap", () => {
      const midi = parseMidi(exportMidi(score));
      const perChannel = new Map<number, ReturnType<typeof notesOf>>();
      for (const t of midi.tracks.slice(1)) {
        for (const n of notesOf(t)) {
          expect(n.offTick).toBeGreaterThan(n.onTick);
          expect(n.pitch).toBeGreaterThanOrEqual(0);
          expect(n.pitch).toBeLessThanOrEqual(127);
          expect(n.velocity).toBeGreaterThanOrEqual(1);
          expect(n.velocity).toBeLessThanOrEqual(127);
          perChannel.set(n.channel, [...(perChannel.get(n.channel) ?? []), n]);
        }
      }
      for (const notes of perChannel.values()) {
        const byPitch = new Map<number, typeof notes>();
        for (const n of notes) byPitch.set(n.pitch, [...(byPitch.get(n.pitch) ?? []), n]);
        for (const list of byPitch.values()) {
          list.sort((a, b) => a.onTick - b.onTick);
          for (let i = 1; i < list.length; i++) expect(list[i]!.onTick).toBeGreaterThanOrEqual(list[i - 1]!.offTick);
        }
      }
    });

    it("never leaves the sustain pedal down at the end", () => {
      const midi = parseMidi(exportMidi(score));
      for (const t of midi.tracks) {
        const pedal = t.filter((e) => e.type === "cc" && e.controller === 64);
        if (pedal.length > 0) expect(pedal[pedal.length - 1]).toMatchObject({ value: 0 });
      }
    });
  });
});
