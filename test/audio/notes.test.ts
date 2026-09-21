import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INSTRUMENT_FACTORIES } from "@/audio/instruments";
import {
  midiToFreq,
  nearestPianoSample,
  pianoSampleName,
  pianoSampleNotes,
  velocityGain,
} from "@/audio/notes";
import { DEFAULT_PRESET_ID, presetById, SOUND_PRESETS } from "@/audio/presets";

describe("midiToFreq", () => {
  it("is concert pitch: A4 = 440 Hz, an octave doubles", () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 9);
    expect(midiToFreq(81)).toBeCloseTo(880, 9);
    expect(midiToFreq(60)).toBeCloseTo(261.6256, 3);
  });
});

describe("velocityGain", () => {
  it("rises with velocity and stays within 0..1", () => {
    let last = 0;
    for (let v = 1; v <= 127; v += 7) {
      const g = velocityGain(v);
      expect(g).toBeGreaterThan(last);
      expect(g).toBeLessThanOrEqual(1);
      last = g;
    }
    expect(velocityGain(127)).toBe(1);
  });
});

describe("piano samples", () => {
  it("names samples by note, with s for sharp", () => {
    expect(pianoSampleName(21)).toBe("A0");
    expect(pianoSampleName(27)).toBe("Ds1");
    expect(pianoSampleName(60)).toBe("C4");
    expect(pianoSampleName(108)).toBe("C8");
  });

  it("covers the keyboard every three semitones", () => {
    const notes = pianoSampleNotes();
    expect(notes).toHaveLength(30);
    expect(notes[0]).toBe(21);
    expect(notes[notes.length - 1]).toBe(108);
  });

  it("has a file on disk for every sample the engine will ask for", () => {
    const dir = "public/samples/salamander";
    expect(existsSync(dir)).toBe(true);
    const files = new Set(readdirSync(dir));
    for (const n of pianoSampleNotes()) expect(files.has(`${pianoSampleName(n)}.mp3`)).toBe(true);
  });

  it("picks the nearest sample and the rate that retunes it", () => {
    expect(nearestPianoSample(60)).toEqual({ note: 60, rate: 1 });
    const up = nearestPianoSample(61);
    expect(up.note).toBe(60);
    expect(up.rate).toBeCloseTo(2 ** (1 / 12), 9);
    const down = nearestPianoSample(62);
    expect(down.note).toBe(63);
    expect(down.rate).toBeCloseTo(2 ** (-1 / 12), 9);
  });

  it("never stretches a sample by more than a semitone anywhere in range", () => {
    for (let p = 21; p <= 108; p++) {
      const { rate } = nearestPianoSample(p);
      expect(Math.abs(Math.log2(rate) * 12)).toBeLessThanOrEqual(1.0001);
    }
  });

  it("clamps notes outside the piano's range to its ends", () => {
    expect(nearestPianoSample(15).note).toBe(21);
    expect(nearestPianoSample(120).note).toBe(108);
  });
});

describe("presets", () => {
  it("has a unique id and an implementation for every preset", () => {
    const ids = SOUND_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(INSTRUMENT_FACTORIES[id]).toBeTypeOf("function");
    expect(Object.keys(INSTRUMENT_FACTORIES).sort()).toEqual([...ids].sort());
  });

  it("falls back to the default for an unknown id", () => {
    expect(presetById("nope").id).toBe(DEFAULT_PRESET_ID);
    expect(presetById(DEFAULT_PRESET_ID).name).toBe("Grand Piano");
  });
});
