import { describe, expect, it } from "vitest";
import { newId, newPianoScore, note, type Score } from "@/model";
import { positionAt, tickAt } from "@/playback/position";
import { Player, type PlayerEnv } from "@/playback/player";
import { TempoClock } from "@/playback/tempo-clock";
import { buildTimeline, PPQ } from "@/playback/timeline";

// 120 bpm: a quarter note is 500 ms and 960 ticks, so 1920 ticks per second.
const TICKS_PER_SECOND = 1920;

function quarters(n = 4): Score {
  const score = newPianoScore({ measureCount: 1 });
  const pitches = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"];
  score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = pitches.slice(0, n).map((p) => note(p, 4));
  return score;
}

class Rig {
  time = 1000;
  readonly sent: { bytes: number[]; at: number }[] = [];
  private fn: (() => void) | null = null;
  readonly env: PlayerEnv = {
    now: () => this.time,
    setInterval: (fn) => {
      this.fn = fn;
      return 1;
    },
    clearInterval: () => {
      this.fn = null;
    },
    lookaheadMs: () => 200,
  };
  readonly sink = { send: (bytes: number[], at: number) => this.sent.push({ bytes, at }) };

  advance(ms: number): void {
    for (let elapsed = 0; elapsed < ms; elapsed += 25) {
      this.time += 25;
      this.fn?.();
    }
  }
  noteOns(): { pitch: number; at: number }[] {
    return this.sent.filter((s) => (s.bytes[0]! & 0xf0) === 0x90).map((s) => ({ pitch: s.bytes[1]!, at: s.at }));
  }
}

const literal = { interpretation: "literal" as const };

describe("Player", () => {
  it("hands over messages with exact timestamps, only as they come within the look-ahead", () => {
    const rig = new Rig();
    const player = new Player(rig.sink, rig.env);
    player.load(buildTimeline(quarters(), literal));
    player.play();
    // Lead-in is 80 ms; look-ahead 200 ms: only the first note is due so far.
    expect(rig.noteOns()).toEqual([{ pitch: 60, at: 1080 }]);
    rig.advance(3000);
    expect(rig.noteOns().map((n) => [n.pitch, n.at])).toEqual([
      [60, 1080],
      [62, 1580],
      [64, 2080],
      [65, 2580],
    ]);
  });

  it("plays at the requested speed", () => {
    const rig = new Rig();
    const player = new Player(rig.sink, rig.env);
    player.load(buildTimeline(quarters(), literal));
    player.play({ speed: 0.5 });
    rig.advance(4000);
    expect(rig.noteOns().map((n) => n.at)).toEqual([1080, 2080, 3080, 4080]);
  });

  it("reports its position from the clock, clamped to the piece", () => {
    const rig = new Rig();
    const player = new Player(rig.sink, rig.env);
    const tl = buildTimeline(quarters(), literal);
    player.load(tl);
    expect(player.tick).toBe(0);
    player.play();
    rig.advance(600);
    // 80 ms lead-in, then the rest is music time.
    expect(player.tick).toBeCloseTo((rig.time - 1080) * (TICKS_PER_SECOND / 1000), 0);
    rig.advance(10_000);
    expect(player.tick).toBeLessThanOrEqual(tl.totalTicks);
  });

  it("finishes on its own after the tail and reports it", () => {
    const rig = new Rig();
    const player = new Player(rig.sink, rig.env);
    let ended = 0;
    player.load(buildTimeline(quarters(), literal));
    player.play({ onEnd: () => ended++ });
    rig.advance(1000);
    expect(player.status).toBe("playing");
    rig.advance(3000);
    expect(player.status).toBe("stopped");
    expect(ended).toBe(1);
  });

  it("silences everything on stop, again after whatever was already scheduled", () => {
    const rig = new Rig();
    const player = new Player(rig.sink, rig.env);
    player.load(buildTimeline(quarters(), literal));
    player.play();
    rig.advance(600); // second note has sounded
    const before = rig.sent.length;
    const stopTime = rig.time;
    player.stop();
    expect(player.status).toBe("stopped");
    const after = rig.sent.slice(before);
    // Immediately: the sounding note is ended, the pedal lifted, all-notes-off sent.
    const now = after.filter((s) => s.at === stopTime);
    expect(now.some((s) => s.bytes[0] === 0x80)).toBe(true);
    expect(now.some((s) => s.bytes[1] === 64 && s.bytes[2] === 0)).toBe(true);
    expect(now.some((s) => s.bytes[1] === 123)).toBe(true);
    // And again, later than every message that was already handed to the sink.
    const lastScheduled = Math.max(...rig.sent.slice(0, before).map((s) => s.at));
    const later = after.filter((s) => s.at > stopTime);
    expect(later.length).toBeGreaterThan(0);
    for (const s of later) expect(s.at).toBeGreaterThan(lastScheduled);
    // Nothing more is sent afterwards.
    const total = rig.sent.length;
    rig.advance(2000);
    expect(rig.sent.length).toBe(total);
  });

  it("pauses without re-striking held notes, and resumes where it left off", () => {
    const rig = new Rig();
    const player = new Player(rig.sink, rig.env);
    player.load(buildTimeline(quarters(), literal));
    player.play();
    rig.advance(700); // 620 ms of music: partway through the second note
    player.pause();
    expect(player.status).toBe("paused");
    const pausedAt = player.tick;
    expect(pausedAt).toBeCloseTo(620 * (TICKS_PER_SECOND / 1000), 0);
    rig.advance(5000);
    expect(player.tick).toBe(pausedAt); // frozen

    const mark = rig.sent.length;
    player.play();
    rig.advance(3000);
    const resumed = rig.sent.slice(mark);
    const strikes = resumed.filter((s) => (s.bytes[0]! & 0xf0) === 0x90).map((s) => s.bytes[1]);
    expect(strikes).toEqual([64, 65]); // the notes still to come; the second is not struck again
  });

  it("starts mid-piece with the sustain pedal already down if the music has it down there", () => {
    const rig = new Rig();
    const score = quarters();
    const [a, , , d] = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items;
    score.spanners.push({
      id: newId(),
      kind: "pedal",
      style: "line",
      partIndex: 0,
      staffIndex: 0,
      start: { kind: "event", eventId: a!.id },
      end: { kind: "event", eventId: d!.id },
    });
    const player = new Player(rig.sink, rig.env);
    player.load(buildTimeline(score, literal));
    player.play({ fromTick: PPQ * 2 });
    const first = rig.sent[0]!;
    expect(first.bytes).toEqual([0xb0, 64, 127]);
    expect(first.at).toBe(1080);
    expect(rig.noteOns()[0]).toEqual({ pitch: 64, at: 1080 });
  });

  it("carries on from the same place when the speed changes", () => {
    const rig = new Rig();
    const player = new Player(rig.sink, rig.env);
    player.load(buildTimeline(quarters(), literal));
    player.play();
    rig.advance(580); // 500 ms of music: at the second note
    const at = player.tick;
    player.setSpeed(0.5);
    expect(player.status).toBe("playing");
    rig.advance(200);
    // Half speed: the position advances at half the rate from where it was.
    expect(player.tick).toBeGreaterThanOrEqual(at);
    expect(player.tick).toBeLessThan(at + 200 * (TICKS_PER_SECOND / 1000));
  });

  it("does nothing without a timeline, and reload stops playback", () => {
    const rig = new Rig();
    const player = new Player(rig.sink, rig.env);
    player.play();
    expect(player.status).toBe("stopped");
    player.load(buildTimeline(quarters(), literal));
    player.play();
    expect(player.status).toBe("playing");
    player.load(buildTimeline(quarters(2), literal));
    expect(player.status).toBe("stopped");
  });
});

describe("TempoClock", () => {
  const clock = new TempoClock({
    ppq: 960,
    tempos: [
      { tick: 0, usPerQuarter: 500000 }, // 120 bpm
      { tick: 1920, usPerQuarter: 1000000 }, // 60 bpm from the third beat
    ],
  });

  it("converts ticks to seconds across tempo changes", () => {
    expect(clock.tickToSeconds(960)).toBeCloseTo(0.5, 9);
    expect(clock.tickToSeconds(1920)).toBeCloseTo(1, 9);
    expect(clock.tickToSeconds(2880)).toBeCloseTo(2, 9); // a quarter at 60 bpm is a second
  });

  it("is the inverse in both directions", () => {
    for (const tick of [0, 100, 1919, 1920, 5000]) {
      expect(clock.secondsToTick(clock.tickToSeconds(tick))).toBeCloseTo(tick, 6);
    }
  });
});

describe("position", () => {
  const tl = buildTimeline(
    (() => {
      const s = newPianoScore({ measureCount: 3 });
      s.measures[1]!.barline = "repeat-end";
      return s;
    })(),
    literal,
  );

  it("maps a tick to its score measure and offset, following repeats", () => {
    // played order: 0, 1, 0, 1, 2 — a whole note (3840 ticks) each
    expect(positionAt(tl, 0)).toEqual({ measureIndex: 0, offset: { num: 0, den: 1 } });
    expect(positionAt(tl, 3840 + 960)).toEqual({ measureIndex: 1, offset: { num: 1, den: 4 } });
    expect(positionAt(tl, 3840 * 2 + 1920)).toEqual({ measureIndex: 0, offset: { num: 1, den: 2 } }); // second pass
    expect(positionAt(tl, 3840 * 4 + 100)?.measureIndex).toBe(2);
  });

  it("finds the tick of a score position on its first pass", () => {
    expect(tickAt(tl, 1, { num: 1, den: 2 })).toBe(3840 + 1920);
    expect(tickAt(tl, 0, { num: 0, den: 1 })).toBe(0);
  });
});
