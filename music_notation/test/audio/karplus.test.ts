import { describe, expect, it } from "vitest";
import { midiToFreq } from "@/audio/notes";
import { pluckSamples } from "@/audio/karplus";

const SR = 44100;

/** Fundamental frequency by autocorrelation with parabolic peak refinement. */
function estimateFreq(x: Float32Array, expected: number): number {
  const start = Math.round(SR * 0.05);
  const n = Math.round(SR * 0.4);
  const seg = x.subarray(start, start + n);
  const lo = Math.floor(SR / (expected * 1.2));
  const hi = Math.ceil(SR / (expected / 1.2));
  const ac = (lag: number): number => {
    let s = 0;
    for (let i = 0; i + lag < seg.length; i++) s += seg[i]! * seg[i + lag]!;
    return s;
  };
  let best = lo;
  let bestV = -Infinity;
  for (let lag = lo; lag <= hi; lag++) {
    const v = ac(lag);
    if (v > bestV) {
      bestV = v;
      best = lag;
    }
  }
  const a = ac(best - 1);
  const b = ac(best);
  const c = ac(best + 1);
  const shift = (a - c) / (2 * (a - 2 * b + c));
  return SR / (best + shift);
}

const rms = (x: Float32Array, from: number, to: number): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / (to - from));
};

describe("pluckSamples", () => {
  const opts = { decay: 0.998, brightness: 0.7, seconds: 3 };

  it.each([36, 48, 60, 72, 84, 93])("is in tune (within 6 cents) at MIDI %i", (midi) => {
    const f = midiToFreq(midi);
    const est = estimateFreq(pluckSamples(f, SR, opts), f);
    const cents = 1200 * Math.log2(est / f);
    expect(Math.abs(cents)).toBeLessThan(6);
  });

  it("decays over time and never clips", () => {
    const x = pluckSamples(midiToFreq(60), SR, opts);
    const n = x.length;
    expect(rms(x, n * 0.75, n)).toBeLessThan(rms(x, 0, n * 0.25) * 0.5);
    let peak = 0;
    for (const v of x) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(1.0001);
  });

  it("has no DC offset that would outlive the tone (audible as a thump at high pitches)", () => {
    for (const midi of [60, 84, 96]) {
      const x = pluckSamples(midiToFreq(midi), SR, opts);
      let mean = 0;
      for (let i = x.length / 2; i < x.length; i++) mean += x[i]!;
      mean /= x.length / 2;
      expect(Math.abs(mean)).toBeLessThan(0.0005);
    }
  });

  it("is deterministic for a given pitch", () => {
    const a = pluckSamples(midiToFreq(64), SR, opts);
    const b = pluckSamples(midiToFreq(64), SR, opts);
    expect(Array.from(a.subarray(0, 500))).toEqual(Array.from(b.subarray(0, 500)));
  });

  it("rings about as long up high as in the middle (the high notes don't fade to nothing)", () => {
    // Regression: the classic two-point averaging loop strangles a high note's fundamental.
    const level = (midi: number) => {
      const x = pluckSamples(midiToFreq(midi), SR, { decay: 0.9986, brightness: 0.55, seconds: 3 });
      return rms(x, Math.round(SR * 0.3), Math.round(SR * 1.3));
    };
    expect(level(84)).toBeGreaterThan(level(60) * 0.25);
  });

  it("rings longer when the loop gain is closer to 1", () => {
    const short = pluckSamples(midiToFreq(60), SR, { ...opts, decay: 0.99 });
    const long = pluckSamples(midiToFreq(60), SR, { ...opts, decay: 0.9995 });
    const tail = (x: Float32Array) => rms(x, x.length * 0.5, x.length);
    expect(tail(long)).toBeGreaterThan(tail(short) * 3);
  });
});
