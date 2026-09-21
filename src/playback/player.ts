/**
 * Plays a `Timeline` live by sending its notes and pedal to a MIDI sink with timestamps.
 * It knows nothing about browsers or devices: the sink (Web MIDI in the app), the clock and
 * the timer are injected, so the scheduling logic is tested with a fake clock.
 *
 * Scheduling is look-ahead: a short timer repeatedly hands the sink every message due
 * within the next `lookaheadMs`, each stamped with its exact time, and the sink's own
 * timing does the rest. That keeps musical timing independent of timer jitter. The price
 * is that a message already handed over can't be recalled (Web MIDI's `clear()` isn't
 * reliable across browsers), so stopping sends note-offs and a pedal lift *twice*: once now
 * to silence what's sounding, and once just after the last message already handed over, to
 * silence anything that was scheduled but hadn't yet fired.
 *
 * Only notes and the sustain pedal are sent — no program change, volume or pan — so a
 * digital piano keeps whatever sound and volume it is set to.
 */
import {
  CC_ALL_NOTES_OFF,
  CC_SUSTAIN,
  controlChange,
  noteOff,
  ORDER,
  timelineMessages,
  type ChannelMessage,
} from "./messages";
import { TempoClock } from "./tempo-clock";
import type { Timeline } from "./timeline";

export interface MidiSink {
  /** Sends `bytes` at time `atMs` on the same clock as `PlayerEnv.now()` (immediately if that's already past). */
  send(bytes: number[], atMs: number): void;
}

export interface PlayerEnv {
  /** Monotonic milliseconds — the clock the sink's timestamps use. */
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  /** How far ahead of now to hand messages to the sink. */
  lookaheadMs(): number;
}

export type PlayerStatus = "stopped" | "playing" | "paused";

export interface PlayOptions {
  /** Tick to start from; omitted resumes from where it was paused (or 0). */
  fromTick?: number;
  /** Tempo multiplier: 1 = as marked, 0.5 = half speed. */
  speed?: number;
  /** Called once when the piece finishes on its own (not when stopped or paused). */
  onEnd?: () => void;
}

/** Wait this long before the first message, so the first notes are scheduled, not late. */
const LEAD_IN_MS = 80;
/** After the last message, let the final notes and pedal release ring out this long. */
const TAIL_MS = 400;
const PUMP_INTERVAL_MS = 25;

export class Player {
  private timeline: Timeline | null = null;
  private clock: TempoClock | null = null;
  private messages: ChannelMessage[] = [];
  private state: PlayerStatus = "stopped";
  private timer: unknown = null;

  private next = 0;
  private startTick = 0;
  private startMs = 0;
  private speed = 1;
  private onEnd: (() => void) | undefined;
  private endMs = 0;
  private pausedTick = 0;
  private lastSentMs = 0;
  /** Notes handed to the sink and not yet ended (`channel/pitch`), so a stop can end them. */
  private readonly sounding = new Set<string>();
  private readonly channels = new Set<number>();
  private readonly listeners = new Set<(status: PlayerStatus) => void>();

  constructor(
    private readonly sink: MidiSink,
    private readonly env: PlayerEnv,
  ) {}

  get status(): PlayerStatus {
    return this.state;
  }

  /** Calls `listener` whenever the status changes (including the piece finishing on its own). Returns an unsubscribe. */
  subscribe(listener: (status: PlayerStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(next: PlayerStatus): void {
    this.state = next;
    for (const l of this.listeners) l(next);
  }

  /** Replaces the timeline (and stops whatever was playing). */
  load(timeline: Timeline): void {
    this.stop();
    this.timeline = timeline;
    this.clock = new TempoClock(timeline);
    this.messages = timelineMessages(timeline);
    this.channels.clear();
    for (const t of timeline.tracks) this.channels.add(t.channel);
    this.pausedTick = 0;
  }

  /** Where playback is, in ticks: live while playing, frozen while paused, 0 when stopped. */
  get tick(): number {
    if (this.state === "paused") return this.pausedTick;
    if (this.state !== "playing" || !this.timeline || !this.clock) return 0;
    const elapsed = Math.max(0, this.env.now() - this.startMs) / 1000;
    const seconds = this.clock.tickToSeconds(this.startTick) + elapsed * this.speed;
    return Math.min(this.timeline.totalTicks, Math.max(this.startTick, this.clock.secondsToTick(seconds)));
  }

  play(opts: PlayOptions = {}): void {
    if (!this.timeline || !this.clock) return;
    if (this.state === "playing") this.silence();
    const from = opts.fromTick ?? (this.state === "paused" ? this.pausedTick : 0);
    this.speed = Math.max(0.1, opts.speed ?? this.speed);
    this.onEnd = opts.onEnd;
    this.startTick = Math.max(0, Math.min(from, this.timeline.totalTicks));
    this.startMs = this.env.now() + LEAD_IN_MS;
    this.lastSentMs = this.env.now();
    this.next = this.messages.findIndex((m) => m.tick >= this.startTick);
    if (this.next < 0) this.next = this.messages.length;

    const last = this.messages[this.messages.length - 1];
    this.endMs = this.msOf(Math.max(last ? last.tick : 0, this.timeline.totalTicks)) + TAIL_MS;

    // Starting mid-piece: pick the sustain pedal up where the music already had it.
    for (const track of this.timeline.tracks) {
      let down = false;
      for (const c of track.controllers) {
        if (c.tick >= this.startTick) break;
        if (c.controller === CC_SUSTAIN) down = c.value > 0;
      }
      if (down) this.sink.send(controlChange(track.channel, CC_SUSTAIN, 127), this.startMs);
    }

    if (this.timer !== null) this.env.clearInterval(this.timer);
    this.timer = this.env.setInterval(() => this.pump(), PUMP_INTERVAL_MS);
    this.setState("playing");
    this.pump();
  }

  pause(): void {
    if (this.state !== "playing") return;
    this.pausedTick = this.tick;
    this.halt();
    this.setState("paused");
  }

  stop(): void {
    if (this.state === "stopped") return;
    this.halt();
    this.pausedTick = 0;
    this.setState("stopped");
  }

  /** Changes the speed, carrying on from the current position. */
  setSpeed(speed: number): void {
    const wasPlaying = this.state === "playing";
    const at = this.tick;
    const onEnd = this.onEnd;
    this.speed = Math.max(0.1, speed);
    if (!wasPlaying) return;
    this.halt();
    this.state = "paused"; // transient: play() below immediately announces "playing"
    this.pausedTick = at;
    this.play({ fromTick: at, speed: this.speed, ...(onEnd ? { onEnd } : {}) });
  }

  // -------------------------------------------------------------------------

  private msOf(tick: number): number {
    const seconds = this.clock!.tickToSeconds(tick) - this.clock!.tickToSeconds(this.startTick);
    return this.startMs + (seconds * 1000) / this.speed;
  }

  private pump(): void {
    if (this.state !== "playing") return;
    const horizon = this.env.now() + this.env.lookaheadMs();
    while (this.next < this.messages.length) {
      const m = this.messages[this.next]!;
      const at = this.msOf(m.tick);
      if (at > horizon) break;
      this.sink.send(m.bytes, at);
      this.lastSentMs = Math.max(this.lastSentMs, at);
      this.track(m);
      this.next++;
    }
    if (this.next >= this.messages.length && this.env.now() >= this.endMs) {
      const done = this.onEnd;
      this.halt();
      this.pausedTick = 0;
      this.setState("stopped");
      done?.();
    }
  }

  private track(m: ChannelMessage): void {
    const key = `${m.bytes[0]! & 0x0f}/${m.bytes[1]}`;
    if (m.order === ORDER.noteOn) this.sounding.add(key);
    else if (m.order === ORDER.noteOff) this.sounding.delete(key);
  }

  private halt(): void {
    if (this.timer !== null) this.env.clearInterval(this.timer);
    this.timer = null;
    this.silence();
  }

  /** Ends every note and the pedal now, and again after whatever was already scheduled has fired. */
  private silence(): void {
    const now = this.env.now();
    const later = Math.max(now, this.lastSentMs) + 10;
    for (const at of [now, later]) {
      for (const key of this.sounding) {
        const [ch, pitch] = key.split("/").map(Number) as [number, number];
        this.sink.send(noteOff(ch, pitch), at);
      }
      for (const ch of this.channels) {
        this.sink.send(controlChange(ch, CC_SUSTAIN, 0), at);
        this.sink.send(controlChange(ch, CC_ALL_NOTES_OFF, 0), at);
      }
    }
    this.sounding.clear();
  }
}
