/**
 * The built-in sounds. Each factory returns a `VoiceSpawner`: given a pitch, velocity and
 * start time it builds a small Web Audio graph for one note and hands back a `Voice` that
 * can be released or cut. Everything is synthesised except the grand piano (samples), so
 * there is nothing to download for the other eight.
 *
 * Envelopes deliberately use `setTargetAtTime` (an exponential approach) plus
 * `cancelAndHoldAtTime` on release, so a release that arrives partway through a decay
 * carries on from the level the note had actually reached instead of jumping.
 */
import { midiToFreq, nearestPianoSample, velocityGain } from "./notes";
import type { Voice, VoiceSpawner } from "./voices";

export interface InstrumentEnv {
  ctx: BaseAudioContext;
  /** Where a voice connects its output. */
  out: AudioNode;
  /** A pre-rendered plucked string at this pitch (cached by the engine). */
  pluck(midi: number, kind: "harp" | "harpsichord"): AudioBuffer;
  /** The decoded piano samples by MIDI note; null until loaded. */
  pianoSamples: ReadonlyMap<number, AudioBuffer> | null;
}

export type InstrumentFactory = (env: InstrumentEnv) => VoiceSpawner;

// ---------------------------------------------------------------------------
// Shared voice plumbing
// ---------------------------------------------------------------------------

function hold(param: AudioParam, t: number): void {
  if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(t);
  else param.cancelScheduledValues(t);
}

/** A note built from a few sources feeding one amplitude gain; frees its nodes when every source has ended. */
class GraphVoice implements Voice {
  private ended = 0;
  private disposed = false;

  constructor(
    private readonly amp: GainNode,
    private readonly sources: readonly AudioScheduledSourceNode[],
    private readonly nodes: readonly AudioNode[],
    private readonly releaseTau: number,
    private readonly onFinished: () => void,
  ) {
    for (const s of sources) {
      s.onended = () => {
        if (++this.ended === this.sources.length) this.dispose();
      };
    }
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const n of this.nodes) n.disconnect();
    this.onFinished();
  }

  release(t: number): void {
    hold(this.amp.gain, t);
    this.amp.gain.setTargetAtTime(0, t, this.releaseTau);
    for (const s of this.sources) s.stop(t + this.releaseTau * 8);
  }

  kill(t: number): void {
    hold(this.amp.gain, t);
    this.amp.gain.setTargetAtTime(0, t, 0.008);
    for (const s of this.sources) s.stop(t + 0.07);
  }
}

/** A voice for a note that can't be played (samples not loaded): finishes at once, silently. */
const silentVoice = (onFinished: () => void): Voice => {
  onFinished();
  return { release() {}, kill() {} };
};

function osc(
  ctx: BaseAudioContext,
  type: OscillatorType,
  freq: number,
  detuneCents = 0,
): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detuneCents;
  return o;
}

function gainNode(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

function lowpass(ctx: BaseAudioContext, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

// ---------------------------------------------------------------------------
// Grand piano — sampled
// ---------------------------------------------------------------------------

const grandPiano: InstrumentFactory = (env) => ({
  start(pitch, velocity, t, onFinished) {
    const { note, rate } = nearestPianoSample(pitch);
    const buffer = env.pianoSamples?.get(note);
    if (!buffer) return silentVoice(onFinished);
    const { ctx } = env;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    // Harder playing is brighter as well as louder.
    const tone = lowpass(ctx, 1800 + velocity * 95, 0.4);
    // A real piano's treble dies away quickly, so it reads quiet next to the bass; lift it a little.
    const trebleLift = 1 + Math.max(0, pitch - 72) * 0.035;
    const amp = gainNode(ctx, 5.4 * trebleLift * velocityGain(velocity, 1.5));
    src.connect(tone).connect(amp).connect(env.out);
    src.start(t);
    return new GraphVoice(amp, [src], [src, tone, amp], 0.14, onFinished);
  },
});

// ---------------------------------------------------------------------------
// Electric piano — two-operator FM with a bark that fades into a mellow tone
// ---------------------------------------------------------------------------

const electricPiano: InstrumentFactory = ({ ctx, out }) => ({
  start(pitch, velocity, t, onFinished) {
    const f = midiToFreq(pitch);
    const v = velocityGain(velocity, 1.3);
    const carrier = osc(ctx, "sine", f);
    const mod = osc(ctx, "sine", f);
    const modAmount = gainNode(ctx, 0);
    mod.connect(modAmount).connect(carrier.frequency);
    // Modulation index: bright on the attack, settling to a soft tone.
    modAmount.gain.setValueAtTime(f * (1 + 2.6 * v), t);
    modAmount.gain.setTargetAtTime(f * 0.35, t, 0.32);

    const bark = osc(ctx, "sine", f * 2);
    const barkGain = gainNode(ctx, 0);
    barkGain.gain.setValueAtTime(0.25 * v, t);
    barkGain.gain.setTargetAtTime(0, t, 0.09);
    bark.connect(barkGain);

    const amp = gainNode(ctx, 0);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.5 * v, t + 0.004);
    amp.gain.setTargetAtTime(0.04 * v, t + 0.004, 1.6);
    carrier.connect(amp);
    barkGain.connect(amp);
    amp.connect(out);
    for (const s of [carrier, mod, bark]) s.start(t);
    return new GraphVoice(
      amp,
      [carrier, mod, bark],
      [carrier, mod, bark, modAmount, barkGain, amp],
      0.2,
      onFinished,
    );
  },
});

// ---------------------------------------------------------------------------
// Organ — additive drawbars
// ---------------------------------------------------------------------------

const DRAWBARS: readonly (readonly [ratio: number, level: number])[] = [
  [0.5, 0.5],
  [1, 1],
  [2, 0.7],
  [3, 0.35],
  [4, 0.4],
  [6, 0.15],
  [8, 0.1],
];
const DRAWBAR_TOTAL = DRAWBARS.reduce((s, [, l]) => s + l, 0);

const organ: InstrumentFactory = ({ ctx, out }) => ({
  start(pitch, velocity, t, onFinished) {
    const f = midiToFreq(pitch);
    const level = 0.46 * (0.55 + 0.45 * velocityGain(velocity, 1));
    const amp = gainNode(ctx, 0);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(level, t + 0.012);
    const sources: OscillatorNode[] = [];
    const nodes: AudioNode[] = [amp];
    for (const [ratio, l] of DRAWBARS) {
      if (f * ratio > 12000) continue;
      const o = osc(ctx, "sine", f * ratio);
      const g = gainNode(ctx, l / DRAWBAR_TOTAL);
      o.connect(g).connect(amp);
      o.start(t);
      sources.push(o);
      nodes.push(o, g);
    }
    amp.connect(out);
    return new GraphVoice(amp, sources, nodes, 0.045, onFinished);
  },
});

// ---------------------------------------------------------------------------
// Harpsichord and harp — plucked strings
// ---------------------------------------------------------------------------

const harpsichord: InstrumentFactory = (env) => ({
  start(pitch, velocity, t, onFinished) {
    const { ctx, out } = env;
    const main = ctx.createBufferSource();
    main.buffer = env.pluck(pitch, "harpsichord");
    const sources: AudioBufferSourceNode[] = [main];
    const mix = gainNode(ctx, 1);
    main.connect(mix);
    const nodes: AudioNode[] = [main, mix];
    // Second register an octave up, as on a two-manual instrument.
    if (pitch + 12 <= 96) {
      const upper = ctx.createBufferSource();
      upper.buffer = env.pluck(pitch + 12, "harpsichord");
      const g = gainNode(ctx, 0.42);
      upper.connect(g).connect(mix);
      sources.push(upper);
      nodes.push(upper, g);
    }
    const bright = ctx.createBiquadFilter();
    bright.type = "peaking";
    bright.frequency.value = 2400;
    bright.gain.value = 4;
    const amp = gainNode(ctx, 1.1 * (0.6 + 0.4 * velocityGain(velocity, 1)));
    mix.connect(bright).connect(amp).connect(out);
    for (const s of sources) s.start(t);
    return new GraphVoice(amp, sources, [...nodes, bright, amp], 0.05, onFinished);
  },
});

const harp: InstrumentFactory = (env) => ({
  start(pitch, velocity, t, onFinished) {
    const { ctx, out } = env;
    const src = ctx.createBufferSource();
    src.buffer = env.pluck(pitch, "harp");
    const amp = gainNode(ctx, 1.05 * (0.5 + 0.5 * velocityGain(velocity, 1.2)));
    src.connect(amp).connect(out);
    src.start(t);
    return new GraphVoice(amp, [src], [src, amp], 0.25, onFinished);
  },
});

// ---------------------------------------------------------------------------
// Strings and pad — detuned sawtooth ensembles
// ---------------------------------------------------------------------------

const strings: InstrumentFactory = ({ ctx, out }) => ({
  start(pitch, velocity, t, onFinished) {
    const f = midiToFreq(pitch);
    const v = velocityGain(velocity, 1.1);
    const tone = lowpass(ctx, 900 + 3600 * v, 0.3);
    const amp = gainNode(ctx, 0);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.2 * (0.45 + 0.55 * v), t + 0.14);
    tone.connect(amp).connect(out);

    // A slow vibrato that fades in after the note has spoken.
    const lfo = osc(ctx, "sine", 5.3);
    const depth = gainNode(ctx, 0);
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(7, t + 0.7);
    lfo.connect(depth);

    const sources: OscillatorNode[] = [lfo];
    const nodes: AudioNode[] = [lfo, depth, tone, amp];
    for (const cents of [-9, 0, 9]) {
      const o = osc(ctx, "sawtooth", f, cents);
      depth.connect(o.detune);
      o.connect(tone);
      o.start(t);
      sources.push(o);
      nodes.push(o);
    }
    lfo.start(t);
    return new GraphVoice(amp, sources, nodes, 0.22, onFinished);
  },
});

const warmPad: InstrumentFactory = ({ ctx, out }) => ({
  start(pitch, velocity, t, onFinished) {
    const f = midiToFreq(pitch);
    const v = velocityGain(velocity, 1);
    const tone = lowpass(ctx, 600 + 1800 * v, 0.6);
    const sweep = osc(ctx, "sine", 0.23);
    const sweepDepth = gainNode(ctx, 350);
    sweep.connect(sweepDepth).connect(tone.frequency);
    const amp = gainNode(ctx, 0);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.2 * (0.5 + 0.5 * v), t + 0.55);
    tone.connect(amp).connect(out);

    const sources: OscillatorNode[] = [sweep];
    const nodes: AudioNode[] = [sweep, sweepDepth, tone, amp];
    const layers: [OscillatorType, number, number][] = [
      ["sawtooth", f, -12],
      ["sawtooth", f, 12],
      ["triangle", f / 2, 0],
    ];
    for (const [type, freq, cents] of layers) {
      const o = osc(ctx, type, freq, cents);
      o.connect(tone);
      o.start(t);
      sources.push(o);
      nodes.push(o);
    }
    sweep.start(t);
    return new GraphVoice(amp, sources, nodes, 0.55, onFinished);
  },
});

// ---------------------------------------------------------------------------
// Vibraphone and music box — a few decaying bar/tine partials
// ---------------------------------------------------------------------------

/** Struck-bar partials: [frequency ratio, level, decay time constant at middle C]. */
type Partial3 = readonly [ratio: number, level: number, tau: number];

function barVoice(
  ctx: BaseAudioContext,
  out: AudioNode,
  partials: readonly Partial3[],
  pitch: number,
  velocity: number,
  t: number,
  onFinished: () => void,
  opts: { tremolo: boolean; level: number; releaseTau: number },
): Voice {
  const f = midiToFreq(pitch);
  const v = velocityGain(velocity, 1.2);
  // Higher notes ring for less time, as on a real instrument.
  const shorten = Math.max(0.4, Math.min(1.6, 2 ** ((60 - pitch) / 30)));
  const amp = gainNode(ctx, opts.level * (0.35 + 0.65 * v));
  const sources: OscillatorNode[] = [];
  const nodes: AudioNode[] = [amp];

  let tail: AudioNode = amp;
  if (opts.tremolo) {
    // The vibraphone's motor: a gentle amplitude wobble.
    const trem = gainNode(ctx, 0.85);
    const lfo = osc(ctx, "sine", 4.6);
    const lfoDepth = gainNode(ctx, 0.15);
    lfo.connect(lfoDepth).connect(trem.gain);
    lfo.start(t);
    sources.push(lfo);
    nodes.push(trem, lfo, lfoDepth);
    amp.connect(trem);
    tail = trem;
  }
  tail.connect(out);

  for (const [ratio, level, tau] of partials) {
    if (f * ratio > 14000) continue;
    const o = osc(ctx, "sine", f * ratio);
    const g = gainNode(ctx, 0);
    g.gain.setValueAtTime(level * (ratio === 1 ? 1 : 0.5 + 0.5 * v), t);
    g.gain.setTargetAtTime(0, t, tau * shorten);
    o.connect(g).connect(amp);
    o.start(t);
    sources.push(o);
    nodes.push(o, g);
  }
  return new GraphVoice(amp, sources, nodes, opts.releaseTau, onFinished);
}

const vibraphone: InstrumentFactory = ({ ctx, out }) => ({
  start: (pitch, velocity, t, onFinished) =>
    barVoice(
      ctx,
      out,
      [
        [1, 1, 2.4],
        [4, 0.4, 0.7],
        [10, 0.1, 0.25],
      ],
      pitch,
      velocity,
      t,
      onFinished,
      { tremolo: true, level: 0.4, releaseTau: 0.4 },
    ),
});

const musicBox: InstrumentFactory = ({ ctx, out }) => ({
  start: (pitch, velocity, t, onFinished) =>
    barVoice(
      ctx,
      out,
      [
        [1, 1, 1.5],
        [6.27, 0.32, 0.3],
        [17.5, 0.1, 0.1],
      ],
      pitch,
      velocity,
      t,
      onFinished,
      { tremolo: false, level: 0.44, releaseTau: 0.3 },
    ),
});

export const INSTRUMENT_FACTORIES: Readonly<Record<string, InstrumentFactory>> = {
  "grand-piano": grandPiano,
  "electric-piano": electricPiano,
  organ,
  harpsichord,
  strings,
  "warm-pad": warmPad,
  harp,
  vibraphone,
  "music-box": musicBox,
};
