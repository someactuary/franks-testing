/**
 * The built-in sound engine: an `AudioContext`, a small mixing chain (reverb, compressor,
 * volume), the nine instruments, and a `send(bytes, atMs)` that speaks the same language as
 * a Web MIDI output — so the playback `Player` drives it exactly as it drives a real piano.
 * Messages are scheduled ahead of time on the audio clock; `clear()` cuts everything,
 * including notes that were scheduled but have not started, which a real MIDI port cannot
 * do reliably.
 *
 * The context is created lazily and only from `ensureReady()`, which the Play button calls:
 * browsers refuse to start audio until the user has interacted with the page.
 */
import type { MidiSink } from "@/playback/player";
import { INSTRUMENT_FACTORIES, type InstrumentEnv } from "./instruments";
import { pluckSamples } from "./karplus";
import { midiToFreq, pianoSampleName, pianoSampleNotes } from "./notes";
import { DEFAULT_PRESET_ID, presetById } from "./presets";
import { VoiceManager } from "./voices";

export interface EngineStatus {
  state: "idle" | "loading" | "ready" | "error";
  message?: string;
}

export interface EngineOptions {
  /** Use this context instead of creating an `AudioContext` (an `OfflineAudioContext`, for rendering to a file or testing). */
  context?: BaseAudioContext;
  /** URL prefix the sample files are served under. */
  sampleBase?: string;
}

const PLUCKS = {
  harp: { decay: 0.9986, brightness: 0.55, seconds: 6 },
  harpsichord: { decay: 0.9962, brightness: 0.9, seconds: 3.5 },
} as const;

export class AudioEngine implements MidiSink {
  private ctx: BaseAudioContext | null = null;
  private bus: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private volumeNode: GainNode | null = null;
  private manager: VoiceManager | null = null;
  private instrumentId = DEFAULT_PRESET_ID;
  private volume = 0.8;
  private piano: Map<number, AudioBuffer> | null = null;
  private pianoLoading: Promise<void> | null = null;
  private readonly plucks = new Map<string, AudioBuffer>();
  private state: EngineStatus = { state: "idle" };
  private readonly listeners = new Set<(s: EngineStatus) => void>();
  /** Notes started so far — cheap visibility into whether the engine is actually sounding. */
  notesStarted = 0;

  constructor(private readonly opts: EngineOptions = {}) {}

  get status(): EngineStatus {
    return this.state;
  }

  subscribe(listener: (status: EngineStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(next: EngineStatus): void {
    this.state = next;
    for (const l of this.listeners) l(next);
  }

  /** The clock `send`'s timestamps are on (the same one Web MIDI uses). */
  now(): number {
    return performance.now();
  }

  // -- setup ----------------------------------------------------------------

  /** Starts (or resumes) audio and loads whatever the current sound needs. Call from a user gesture. */
  async ensureReady(): Promise<void> {
    const ctx = this.ensureContext();
    if ("resume" in ctx && ctx instanceof AudioContext && ctx.state === "suspended")
      await ctx.resume();
    await this.prepareInstrument();
    if (this.state.state !== "error") this.setStatus({ state: "ready" });
  }

  async setInstrument(id: string): Promise<void> {
    if (id === this.instrumentId && this.manager) return;
    this.manager?.clear(this.ctx?.currentTime ?? 0);
    this.instrumentId = presetById(id).id;
    this.manager = null;
    if (this.ctx) {
      await this.prepareInstrument();
      if (this.state.state !== "error") this.setStatus({ state: "ready" });
    }
  }

  get instrument(): string {
    return this.instrumentId;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.volumeNode && this.ctx)
      this.volumeNode.gain.setTargetAtTime(this.volume ** 2, this.ctx.currentTime, 0.02);
  }

  private ensureContext(): BaseAudioContext {
    if (this.ctx) return this.ctx;
    const ctx = this.opts.context ?? new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;

    // Voices -> bus -> (dry | reverb) -> compressor -> volume -> speakers.
    const bus = ctx.createGain();
    const mix = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.25;
    const volume = ctx.createGain();
    volume.gain.value = this.volume ** 2;

    const convolver = ctx.createConvolver();
    convolver.buffer = this.impulseResponse(ctx, 2.2);
    const send = ctx.createGain();
    send.gain.value = 0.2;
    const wet = ctx.createGain();
    wet.gain.value = 0.9;

    // A last soft limiter: transparent up to 0.6, then curving smoothly toward a ceiling of 0.9,
    // so a loud chord of sharp-attacked notes saturates gently instead of clipping the output.
    const softClip = ctx.createWaveShaper();
    const curve = new Float32Array(4096);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      const a = Math.abs(x);
      curve[i] = Math.sign(x) * (a <= 0.6 ? a : 0.6 + 0.4 * Math.tanh((a - 0.6) / 0.4));
    }
    softClip.curve = curve;
    softClip.oversample = "2x";
    // Make-up gain before the limiter, so the mix is comfortably loud at the default volume.
    const makeup = ctx.createGain();
    makeup.gain.value = 1.6;

    bus.connect(mix);
    bus.connect(send).connect(convolver).connect(wet).connect(mix);
    mix
      .connect(compressor)
      .connect(makeup)
      .connect(volume)
      .connect(softClip)
      .connect(ctx.destination);
    this.bus = bus;
    this.reverbSend = send;
    this.volumeNode = volume;
    return ctx;
  }

  /** A synthetic room: decaying stereo noise. */
  private impulseResponse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
    const length = Math.round(ctx.sampleRate * seconds);
    const ir = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.6;
    }
    return ir;
  }

  private async prepareInstrument(): Promise<void> {
    const ctx = this.ctx!;
    // A failure loading one sound (the piano) says nothing about the next one picked.
    if (this.state.state === "error") this.setStatus({ state: "idle" });
    if (this.instrumentId === "grand-piano") await this.loadPiano();
    const preset = presetById(this.instrumentId);
    const factory = INSTRUMENT_FACTORIES[preset.id]!;
    this.reverbSend!.gain.setTargetAtTime(preset.reverb, ctx.currentTime, 0.02);
    const env: InstrumentEnv = {
      ctx,
      out: this.bus!,
      pluck: (midi, kind) => this.pluck(midi, kind),
      pianoSamples: this.piano,
    };
    this.manager = new VoiceManager(factory(env));
  }

  private async loadPiano(): Promise<void> {
    if (this.piano) return;
    if (!this.pianoLoading) {
      const ctx = this.ctx!;
      this.setStatus({ state: "loading", message: "Loading piano samples…" });
      const base = this.opts.sampleBase ?? import.meta.env.BASE_URL ?? "/";
      this.pianoLoading = (async () => {
        const samples = new Map<number, AudioBuffer>();
        await Promise.all(
          pianoSampleNotes().map(async (note) => {
            const res = await fetch(`${base}samples/salamander/${pianoSampleName(note)}.mp3`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            samples.set(note, await ctx.decodeAudioData(await res.arrayBuffer()));
          }),
        );
        this.piano = samples;
      })();
    }
    try {
      await this.pianoLoading;
    } catch (err) {
      this.pianoLoading = null;
      this.setStatus({
        state: "error",
        message: `Couldn't load the piano samples (${err instanceof Error ? err.message : String(err)}). Pick another sound.`,
      });
    }
  }

  private pluck(midi: number, kind: "harp" | "harpsichord"): AudioBuffer {
    const key = `${kind}/${midi}`;
    let buf = this.plucks.get(key);
    if (!buf) {
      const ctx = this.ctx!;
      const samples = pluckSamples(midiToFreq(midi), ctx.sampleRate, PLUCKS[kind]);
      buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buf.copyToChannel(samples, 0);
      this.plucks.set(key, buf);
    }
    return buf;
  }

  // -- playing --------------------------------------------------------------

  /** `atMs` (on the `now()` clock) as a time on the audio clock; never in the past. */
  private audioTime(atMs: number): number {
    const ctx = this.ctx!;
    const stamp = ctx instanceof AudioContext ? ctx.getOutputTimestamp() : undefined;
    const t =
      stamp && stamp.performanceTime && stamp.contextTime !== undefined
        ? stamp.contextTime + (atMs - stamp.performanceTime) / 1000
        : ctx.currentTime + (atMs - performance.now()) / 1000;
    return Math.max(t, ctx.currentTime);
  }

  /** Handles one raw MIDI message (note on/off, sustain pedal, all-notes-off), to sound at `atMs`. */
  send(bytes: number[], atMs: number): void {
    if (!this.ctx || !this.manager) return;
    const kind = bytes[0]! & 0xf0;
    const d1 = bytes[1] ?? 0;
    const d2 = bytes[2] ?? 0;
    const t = this.audioTime(atMs);
    if (kind === 0x90 && d2 > 0) this.noteOnAt(d1, d2, t);
    else if (kind === 0x80 || kind === 0x90) this.noteOffAt(d1, t);
    else if (kind === 0xb0) {
      if (d1 === 64) this.pedalAt(d2 >= 64, t);
      else if (d1 === 123) this.manager.allNotesOff(t);
      else if (d1 === 120) this.manager.clear(t);
    }
  }

  noteOnAt(pitch: number, velocity: number, t: number): void {
    this.notesStarted++;
    this.manager?.noteOn(pitch, velocity, t);
  }
  noteOffAt(pitch: number, t: number): void {
    this.manager?.noteOff(pitch, t);
  }
  pedalAt(down: boolean, t: number): void {
    this.manager?.pedal(down, t);
  }

  /** Sounds a short rising arpeggio in the current instrument, so a sound can be tried without a score. */
  preview(): void {
    const ctx = this.ctx;
    if (!ctx || !this.manager) return;
    this.manager.clear(ctx.currentTime);
    const start = ctx.currentTime + 0.05;
    [60, 64, 67, 72].forEach((pitch, i) => {
      this.noteOnAt(pitch, 86, start + i * 0.11);
      this.noteOffAt(pitch, start + 0.9 + i * 0.11);
    });
  }

  /** Silences everything now, including notes handed over ahead of time that haven't started. */
  clear(): void {
    if (this.ctx) this.manager?.clear(this.ctx.currentTime);
  }
}
