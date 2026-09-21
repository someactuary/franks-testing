/**
 * Where a tick sits in the *score*: which measure (by its score index, so a repeated
 * measure maps to the same place on the page both times) and how far into it. This is
 * what a playhead needs; going the other way turns the editing cursor into a start tick.
 */
import { frac, type Fraction } from "@/model/duration";
import type { Timeline } from "./timeline";

export interface PlayPosition {
  measureIndex: number;
  /** Offset into the measure, in whole notes. */
  offset: Fraction;
}

/** Ticks in a whole note. */
const wholeTicks = (tl: Pick<Timeline, "ppq">): number => tl.ppq * 4;

export function positionAt(timeline: Pick<Timeline, "ppq" | "playedMeasures">, tick: number): PlayPosition | undefined {
  const ms = timeline.playedMeasures;
  if (ms.length === 0) return undefined;
  let lo = 0;
  let hi = ms.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ms[mid]!.startTick <= tick) lo = mid;
    else hi = mid - 1;
  }
  const m = ms[lo]!;
  const into = Math.max(0, Math.min(tick, m.endTick) - m.startTick);
  return { measureIndex: m.measureIndex, offset: frac(Math.round(into), wholeTicks(timeline)) };
}

/**
 * The tick at which the first played pass through `measureIndex` reaches `offset`
 * (0 if that measure is never played — e.g. it is skipped by an ending).
 */
export function tickAt(
  timeline: Pick<Timeline, "ppq" | "playedMeasures">,
  measureIndex: number,
  offset: Fraction,
): number {
  const m = timeline.playedMeasures.find((p) => p.measureIndex === measureIndex);
  if (!m) return 0;
  return Math.min(m.endTick, m.startTick + Math.round((offset.num * wholeTicks(timeline)) / offset.den));
}
