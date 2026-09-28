import { afterEach, describe, expect, it, vi } from "vitest";
import { MidiPorts } from "@/ui/midi";
import type { MidiNoteOn } from "@/input/types";

function bytes(...vals: number[]): Uint8Array {
  return new Uint8Array(vals);
}

function collectNoteOns(midi: MidiPorts): MidiNoteOn[] {
  const events: MidiNoteOn[] = [];
  midi.onNoteOn((ev) => events.push(ev));
  return events;
}

describe("MidiPorts: environment guards (node test env has no navigator)", () => {
  it("isSupported() is false without navigator.requestMIDIAccess", () => {
    expect(new MidiPorts().isSupported()).toBe(false);
  });

  it("inputs() is empty before request() ever resolves", () => {
    expect(new MidiPorts().inputs()).toEqual([]);
  });

  it("request() rejects with the Web MIDI unsupported message", async () => {
    await expect(new MidiPorts().request()).rejects.toThrow(/Web MIDI not available in this browser/);
  });

  it("select() on an unsupported instance is a harmless no-op", () => {
    expect(() => new MidiPorts().select("anything")).not.toThrow();
  });
});

describe("MidiPorts.handleMessage: note on/off parsing", () => {
  it("emits a note-on for status 0x90 with velocity > 0", () => {
    const midi = new MidiPorts();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0x90, 60, 100));
    expect(events).toEqual([{ note: 60, velocity: 100, held: [] }]);
  });

  it("treats status 0x90 with velocity 0 as a note-off, not a note-on", () => {
    const midi = new MidiPorts();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0x90, 60, 100));
    midi.handleMessage(bytes(0x90, 60, 0));
    expect(events).toHaveLength(1);
  });

  it("treats status 0x80 as a note-off", () => {
    const midi = new MidiPorts();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0x90, 60, 100));
    midi.handleMessage(bytes(0x80, 60, 64));
    midi.handleMessage(bytes(0x90, 62, 100));
    expect(events).toHaveLength(2);
    expect(events[1]!.held).toEqual([]); // 60 was released before 62 arrived
  });

  it("ignores the channel nibble (0x91..0x9f are all note-on)", () => {
    const midi = new MidiPorts();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0x93, 60, 100));
    expect(events).toEqual([{ note: 60, velocity: 100, held: [] }]);
  });

  it("ignores messages shorter than 2 bytes", () => {
    const midi = new MidiPorts();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0x90));
    midi.handleMessage(bytes());
    expect(events).toHaveLength(0);
  });

  it("ignores unrelated status bytes (e.g. control change 0xb0)", () => {
    const midi = new MidiPorts();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0xb0, 7, 127));
    expect(events).toHaveLength(0);
  });
});

describe("MidiPorts.handleMessage: held-note tracking for chords", () => {
  it("passes held = [] for the first note in a chord", () => {
    const midi = new MidiPorts();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0x90, 60, 100));
    expect(events[0]!.held).toEqual([]);
  });

  it("passes the notes held BEFORE this note-on, in press order", () => {
    const midi = new MidiPorts();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0x90, 60, 100)); // C4 down alone
    midi.handleMessage(bytes(0x90, 64, 100)); // E4 down while C4 held
    midi.handleMessage(bytes(0x90, 67, 100)); // G4 down while C4+E4 held
    expect(events.map((e) => e.held)).toEqual([[], [60], [60, 64]]);
  });

  it("a released note is no longer reported as held for the next note-on", () => {
    const midi = new MidiPorts();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0x90, 60, 100));
    midi.handleMessage(bytes(0x90, 64, 100));
    midi.handleMessage(bytes(0x80, 60, 0)); // release C4
    midi.handleMessage(bytes(0x90, 67, 100)); // only E4 still held
    expect(events[2]!.held).toEqual([64]);
  });

  it("select() resets held-note state (e.g. switching input devices)", () => {
    const midi = new MidiPorts();
    const events = collectNoteOns(midi);
    midi.handleMessage(bytes(0x90, 60, 100));
    midi.select(null);
    midi.handleMessage(bytes(0x90, 64, 100));
    expect(events[1]!.held).toEqual([]);
  });
});

describe("MidiPorts: outputs (playback)", () => {
  interface FakeOutput {
    id: string;
    name: string;
    state: "connected" | "disconnected";
    sent: { bytes: number[]; at: number }[];
    send: (bytes: number[], at: number) => void;
  }
  const output = (id: string, name: string): FakeOutput => {
    const o: FakeOutput = {
      id,
      name,
      state: "connected",
      sent: [],
      send: (bytes, at) => o.sent.push({ bytes, at }),
    };
    return o;
  };
  const stubAccess = (outs: FakeOutput[]) => {
    vi.stubGlobal("navigator", {
      requestMIDIAccess: async () => ({
        inputs: new Map(),
        outputs: new Map(outs.map((o) => [o.id, o])),
        onstatechange: null,
      }),
    });
  };

  afterEach(() => vi.unstubAllGlobals());

  it("lists the visible outputs after access is granted", async () => {
    stubAccess([output("a", "Piano"), output("b", "IAC Driver Bus 1")]);
    const midi = new MidiPorts();
    expect(midi.outputs()).toEqual([]);
    await midi.request();
    expect(midi.outputs()).toEqual([
      { id: "a", name: "Piano" },
      { id: "b", name: "IAC Driver Bus 1" },
    ]);
  });

  it("sends bytes with their timestamp to the selected output only", async () => {
    const a = output("a", "Piano");
    const b = output("b", "Other");
    stubAccess([a, b]);
    const midi = new MidiPorts();
    await midi.request();
    midi.selectOutput("b");
    expect(midi.hasOutput()).toBe(true);
    midi.send([0x90, 60, 100], 1234.5);
    expect(b.sent).toEqual([{ bytes: [0x90, 60, 100], at: 1234.5 }]);
    expect(a.sent).toEqual([]);
  });

  it("does nothing, without throwing, when no output is selected or it has been unplugged", async () => {
    const a = output("a", "Piano");
    stubAccess([a]);
    const midi = new MidiPorts();
    await midi.request();
    expect(() => midi.send([0x90, 60, 100], 0)).not.toThrow();
    expect(midi.hasOutput()).toBe(false);
    midi.selectOutput("a");
    a.state = "disconnected";
    expect(midi.hasOutput()).toBe(false);
    midi.send([0x90, 60, 100], 0);
    expect(a.sent).toEqual([]);
  });

  it("swallows an error thrown by a port that vanished mid-send", async () => {
    const a = output("a", "Piano");
    a.send = () => {
      throw new Error("InvalidStateError");
    };
    stubAccess([a]);
    const midi = new MidiPorts();
    await midi.request();
    midi.selectOutput("a");
    expect(() => midi.send([0x80, 60, 0], 0)).not.toThrow();
  });

  it("selecting an unknown id or null clears the output", async () => {
    stubAccess([output("a", "Piano")]);
    const midi = new MidiPorts();
    await midi.request();
    midi.selectOutput("a");
    midi.selectOutput("nope");
    expect(midi.hasOutput()).toBe(false);
    midi.selectOutput("a");
    midi.selectOutput(null);
    expect(midi.hasOutput()).toBe(false);
  });
});
