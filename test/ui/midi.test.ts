import { describe, expect, it } from "vitest";
import { MidiInputs } from "@/ui/midi";
import type { MidiNoteOn } from "@/input/types";

function bytes(...vals: number[]): Uint8Array {
  return new Uint8Array(vals);
}

function collectNoteOns(midi: MidiInputs): MidiNoteOn[] {
  const events: MidiNoteOn[] = [];
  midi.onNoteOn((ev) => events.push(ev));
  return events;
}

describe("MidiInputs: environment guards (node test env has no navigator)", () => {
  it("isSupported() is false without navigator.requestMIDIAccess", () => {
    expect(new MidiInputs().isSupported()).toBe(false);
  });

  it("inputs() is empty before request() ever resolves", () => {
    expect(new MidiInputs().inputs()).toEqual([]);
  });

  it("request() rejects with the Web MIDI unsupported message", async () => {
    await expect(new MidiInputs().request()).rejects.toThrow(/Web MIDI not available in this browser/);
  });

  it("select() on an unsupported instance is a harmless no-op", () => {
    expect(() => new MidiInputs().select("anything")).not.toThrow();
  });
});

describe("MidiInputs.handleMessage: note on/off parsing", () => {
  it("emits a note-on for status 0x90 with velocity > 0", () => {
    const midi = new MidiInputs();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0x90, 60, 100));
    expect(events).toEqual([{ note: 60, velocity: 100, held: [] }]);
  });

  it("treats status 0x90 with velocity 0 as a note-off, not a note-on", () => {
    const midi = new MidiInputs();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0x90, 60, 100));
    midi.handleMessage(bytes(0x90, 60, 0));
    expect(events).toHaveLength(1);
  });

  it("treats status 0x80 as a note-off", () => {
    const midi = new MidiInputs();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0x90, 60, 100));
    midi.handleMessage(bytes(0x80, 60, 64));
    midi.handleMessage(bytes(0x90, 62, 100));
    expect(events).toHaveLength(2);
    expect(events[1]!.held).toEqual([]); // 60 was released before 62 arrived
  });

  it("ignores the channel nibble (0x91..0x9f are all note-on)", () => {
    const midi = new MidiInputs();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0x93, 60, 100));
    expect(events).toEqual([{ note: 60, velocity: 100, held: [] }]);
  });

  it("ignores messages shorter than 2 bytes", () => {
    const midi = new MidiInputs();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0x90));
    midi.handleMessage(bytes());
    expect(events).toHaveLength(0);
  });

  it("ignores unrelated status bytes (e.g. control change 0xb0)", () => {
    const midi = new MidiInputs();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0xb0, 7, 127));
    expect(events).toHaveLength(0);
  });
});

describe("MidiInputs.handleMessage: held-note tracking for chords", () => {
  it("passes held = [] for the first note in a chord", () => {
    const midi = new MidiInputs();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0x90, 60, 100));
    expect(events[0]!.held).toEqual([]);
  });

  it("passes the notes held BEFORE this note-on, in press order", () => {
    const midi = new MidiInputs();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0x90, 60, 100)); // C4 down alone
    midi.handleMessage(bytes(0x90, 64, 100)); // E4 down while C4 held
    midi.handleMessage(bytes(0x90, 67, 100)); // G4 down while C4+E4 held
    expect(events.map((e) => e.held)).toEqual([[], [60], [60, 64]]);
  });

  it("a released note is no longer reported as held for the next note-on", () => {
    const midi = new MidiInputs();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0x90, 60, 100));
    midi.handleMessage(bytes(0x90, 64, 100));
    midi.handleMessage(bytes(0x80, 60, 0)); // release C4
    midi.handleMessage(bytes(0x90, 67, 100)); // only E4 still held
    expect(events[2]!.held).toEqual([64]);
  });

  it("select() resets held-note state (e.g. switching input devices)", () => {
    const midi = new MidiInputs();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0x90, 60, 100));
    midi.select(null);
    midi.handleMessage(bytes(0x90, 64, 100));
    expect(events[1]!.held).toEqual([]);
  });
});
