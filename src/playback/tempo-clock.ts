/**
 * Converts between MIDI ticks and seconds through a tempo map, in both directions
 * (a player needs both: tick -> when to send a message, and elapsed time -> where the
 * playhead is). Precomputes each tempo segment's start time so lookups are a binary
 * search rather than a walk.
 */
import type { Timeline } from "./timeline";

export class TempoClock {
  private readonly ticks: number[] = [];
  private readonly seconds: number[] = [];
  /** Seconds per tick within each segment. */
  private readonly secondsPerTick: number[] = [];

  constructor(timeline: Pick<Timeline, "ppq" | "tempos">) {
    const tempos = timeline.tempos.length > 0 ? timeline.tempos : [{ tick: 0, usPerQuarter: 500000 }];
    let elapsed = 0;
    for (const [i, t] of tempos.entries()) {
      const prev = i > 0 ? i - 1 : undefined;
      if (prev !== undefined) elapsed += (t.tick - this.ticks[prev]!) * this.secondsPerTick[prev]!;
      this.ticks.push(t.tick);
      this.seconds.push(elapsed);
      this.secondsPerTick.push(t.usPerQuarter / timeline.ppq / 1e6);
    }
  }

  private segmentOf(values: readonly number[], x: number): number {
    let lo = 0;
    let hi = values.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (values[mid]! <= x) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  tickToSeconds(tick: number): number {
    const i = this.segmentOf(this.ticks, tick);
    return this.seconds[i]! + (tick - this.ticks[i]!) * this.secondsPerTick[i]!;
  }

  secondsToTick(seconds: number): number {
    const i = this.segmentOf(this.seconds, seconds);
    return this.ticks[i]! + (seconds - this.seconds[i]!) / this.secondsPerTick[i]!;
  }
}
