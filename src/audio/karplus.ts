/**
 * Plucked-string synthesis (Karplus-Strong) rendered to a plain sample array, which the
 * engine turns into an AudioBuffer. Done in JS rather than with a feedback delay in the
 * audio graph because Web Audio's delay loops can't be shorter than one 128-sample block —
 * that would cap the pitch at about 344 Hz. A fractional-delay allpass keeps the tuning
 * accurate up the keyboard.
 */

export interface PluckOptions {
  /** Loop gain at middle C, just under 1: closer to 1 rings longer (other pitches are scaled to ring alike). */
  decay: number;
  /** 0 = dull (heavily filtered pluck), 1 = bright (raw noise burst). */
  brightness: number;
  seconds: number;
}

/** Small deterministic PRNG so a given pitch always renders the identical pluck. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pluckSamples(
  freq: number,
  sampleRate: number,
  opts: PluckOptions,
): Float32Array<ArrayBuffer> {
  const total = Math.max(1, Math.round(opts.seconds * sampleRate));
  const out = new Float32Array(total);
  const seedLen = Math.ceil(sampleRate / freq) + 2;

  const rand = mulberry32(Math.round(freq * 1000));
  // One-pole lowpass on the noise burst: brightness sets its cutoff.
  const a = 1 - Math.min(0.98, Math.max(0, 1 - opts.brightness));
  let lp = 0;
  let peak = 1e-9;
  for (let i = 0; i < seedLen && i < total; i++) {
    lp += a * (rand() * 2 - 1 - lp);
    out[i] = lp;
    peak = Math.max(peak, Math.abs(lp));
  }
  // A lowpassed noise burst has a small DC offset, and the averaging loop passes DC almost
  // untouched — so at high pitches, where the real tone dies quickly, it would be all that
  // is left. Remove it, then normalise.
  let mean = 0;
  const seeded = Math.min(seedLen, total);
  for (let i = 0; i < seeded; i++) mean += out[i]!;
  mean /= seeded;
  peak = 1e-9;
  for (let i = 0; i < seeded; i++) {
    out[i] = out[i]! - mean;
    peak = Math.max(peak, Math.abs(out[i]!));
  }
  for (let i = 0; i < seeded; i++) out[i]! /= peak;

  // The loop's damping filter is (1-s) x[n] + s x[n-1]: s = 0.5 is the classic two-point
  // average, the strongest damping. Its loss at the *fundamental* per trip round the loop
  // grows with pitch (there are more trips per second and each one loses more), which would
  // strangle a high note's ring, so s is cut back up the keyboard — the upper harmonics still
  // die fast, the fundamental keeps ringing. Below ~500 Hz it stays at the classic 0.5.
  const s = Math.min(0.5, Math.max(0.01, 0.5 * (500 / freq) ** 3));
  // Total delay round the loop is sampleRate/freq: a whole number of samples, plus the damping
  // filter's own delay (s), plus a fractional remainder r in [0.5, 1.5) made up by a first-order
  // allpass — which, unlike interpolating between samples, doesn't itself lose high frequencies.
  const loopDelay = sampleRate / freq - s;
  const whole = Math.max(1, Math.floor(loopDelay - 0.5));
  const r = loopDelay - whole;
  const c = (1 - r) / (1 + r);
  // `decay` is the loop gain at middle C; a higher note goes round the loop more often per
  // second, so its gain is eased toward 1 to keep the ring time comparable up the keyboard.
  const gain = Math.min(0.99995, opts.decay ** (261.63 / freq));
  let prevW = 0;
  let prevY = 0;
  for (let n = seedLen; n < total; n++) {
    const w = (1 - s) * out[n - whole]! + s * out[n - whole - 1]!;
    const y = c * w + prevW - c * prevY;
    prevW = w;
    prevY = y;
    out[n] = gain * y;
  }
  // Whatever DC the loop still carries (the seed's mean is only approximately zero over the
  // loop's true window) is removed by a ~7 Hz high-pass, so it can't outlive the tone.
  let prevIn = 0;
  let prevOut = 0;
  for (let n = 0; n < total; n++) {
    const x = out[n]!;
    prevOut = x - prevIn + 0.999 * prevOut;
    prevIn = x;
    out[n] = prevOut;
  }
  // The high-pass can overshoot the burst's peak slightly; keep the buffer within +-1.
  let top = 0;
  for (let n = 0; n < total; n++) top = Math.max(top, Math.abs(out[n]!));
  if (top > 1) for (let n = 0; n < total; n++) out[n]! /= top;
  return out;
}
