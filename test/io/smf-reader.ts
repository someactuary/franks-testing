/**
 * A small independent Standard MIDI File reader for tests: it parses the bytes the
 * exporter wrote back into events, so tests check the *file*, not the exporter's own
 * intermediate data. Handles running status and the meta/channel events we care about.
 */

export type MidiEvent =
  | { tick: number; type: "noteOn"; channel: number; pitch: number; velocity: number }
  | { tick: number; type: "noteOff"; channel: number; pitch: number }
  | { tick: number; type: "cc"; channel: number; controller: number; value: number }
  | { tick: number; type: "program"; channel: number; program: number }
  | { tick: number; type: "tempo"; usPerQuarter: number }
  | { tick: number; type: "timeSignature"; numerator: number; denominator: number }
  | { tick: number; type: "keySignature"; fifths: number; minor: boolean }
  | { tick: number; type: "text"; metaType: number; text: string }
  | { tick: number; type: "endOfTrack" };

export interface ParsedMidi {
  format: number;
  ppq: number;
  tracks: MidiEvent[][];
}

export interface ParsedNote {
  channel: number;
  pitch: number;
  velocity: number;
  onTick: number;
  offTick: number;
}

export function parseMidi(bytes: Uint8Array): ParsedMidi {
  let pos = 0;
  const u8 = (): number => {
    if (pos >= bytes.length) throw new Error("unexpected end of MIDI data");
    return bytes[pos++]!;
  };
  const u16 = (): number => (u8() << 8) | u8();
  const u32 = (): number => ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0;
  const varLen = (): number => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new Error("bad variable-length quantity");
  };
  const tag = (): string => String.fromCharCode(u8(), u8(), u8(), u8());

  if (tag() !== "MThd") throw new Error("missing MThd");
  if (u32() !== 6) throw new Error("bad header length");
  const format = u16();
  const trackCount = u16();
  const ppq = u16();

  const tracks: MidiEvent[][] = [];
  for (let t = 0; t < trackCount; t++) {
    if (tag() !== "MTrk") throw new Error("missing MTrk");
    const length = u32();
    const end = pos + length;
    const events: MidiEvent[] = [];
    let tick = 0;
    let status = 0;
    while (pos < end) {
      tick += varLen();
      const first = u8();
      if (first === 0xff) {
        const type = u8();
        const len = varLen();
        const data = Array.from(bytes.subarray(pos, pos + len));
        pos += len;
        if (type === 0x2f) events.push({ tick, type: "endOfTrack" });
        else if (type === 0x51) events.push({ tick, type: "tempo", usPerQuarter: (data[0]! << 16) | (data[1]! << 8) | data[2]! });
        else if (type === 0x58) events.push({ tick, type: "timeSignature", numerator: data[0]!, denominator: 2 ** data[1]! });
        else if (type === 0x59) {
          events.push({ tick, type: "keySignature", fifths: (data[0]! << 24) >> 24, minor: data[1] === 1 });
        } else {
          events.push({ tick, type: "text", metaType: type, text: new TextDecoder().decode(Uint8Array.from(data)) });
        }
        continue;
      }
      if (first === 0xf0 || first === 0xf7) {
        pos += varLen();
        continue;
      }
      if (first & 0x80) status = first;
      else pos--; // running status: `first` was actually the first data byte
      const channel = status & 0x0f;
      const kind = status & 0xf0;
      if (kind === 0x90) {
        const pitch = u8();
        const velocity = u8();
        events.push(velocity === 0 ? { tick, type: "noteOff", channel, pitch } : { tick, type: "noteOn", channel, pitch, velocity });
      } else if (kind === 0x80) {
        const pitch = u8();
        u8();
        events.push({ tick, type: "noteOff", channel, pitch });
      } else if (kind === 0xb0) {
        events.push({ tick, type: "cc", channel, controller: u8(), value: u8() });
      } else if (kind === 0xc0) {
        events.push({ tick, type: "program", channel, program: u8() });
      } else if (kind === 0xa0 || kind === 0xe0) {
        u8();
        u8();
      } else if (kind === 0xd0) {
        u8();
      } else {
        throw new Error(`unsupported status ${status.toString(16)}`);
      }
    }
    tracks.push(events);
  }
  return { format, ppq, tracks };
}

/** Pairs each note-on with its note-off (same channel and pitch, in order) to get whole notes. */
export function notesOf(track: MidiEvent[]): ParsedNote[] {
  const open = new Map<string, { velocity: number; onTick: number }[]>();
  const out: ParsedNote[] = [];
  for (const e of track) {
    if (e.type === "noteOn") {
      const key = `${e.channel}/${e.pitch}`;
      const list = open.get(key) ?? [];
      list.push({ velocity: e.velocity, onTick: e.tick });
      open.set(key, list);
    } else if (e.type === "noteOff") {
      const list = open.get(`${e.channel}/${e.pitch}`);
      const on = list?.shift();
      if (on) out.push({ channel: e.channel, pitch: e.pitch, velocity: on.velocity, onTick: on.onTick, offTick: e.tick });
    }
  }
  return out.sort((a, b) => a.onTick - b.onTick || a.pitch - b.pitch);
}
