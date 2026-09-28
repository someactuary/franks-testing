/**
 * The tempo map: explicit metronome marks, tempo words, and gradual changes
 * ("rit.", "accel.", "a tempo"), turned into a list of (time, quarter-note bpm)
 * steps. Fermata holds are layered on top by the timeline, not here.
 */
import { add, cmp, div, eq, frac, mul, sub, toNumber, ZERO, type Fraction } from "@/model/duration";

export type TempoDirective =
  | { t: Fraction; kind: "set"; bpm: number }
  | { t: Fraction; kind: "rit" | "accel"; factor: number }
  | { t: Fraction; kind: "atempo" };

/** From time `t` (whole notes) on, the music moves at `bpm` quarter notes per minute. */
export interface TempoPoint {
  t: Fraction;
  bpm: number;
}

export interface TempoContext {
  defaultBpm: number;
  /** Where the music ends, in whole notes. */
  total: Fraction;
  /** Length of the measure sounding at time `t`, in whole notes. */
  measureLengthAt: (t: Fraction) => Fraction;
}

const MIN_BPM = 20;
const MAX_BPM = 400;
const clampBpm = (bpm: number): number => Math.max(MIN_BPM, Math.min(MAX_BPM, bpm));

/** A gradual change takes at most this many measures. */
const RAMP_MEASURES = 2;
/** ...and is approximated by steps no finer than a sixteenth of a whole note. */
const RAMP_STEPS_PER_WHOLE = 16;
const RAMP_MAX_STEPS = 48;

export function buildTempoPoints(directives: readonly TempoDirective[], ctx: TempoContext): TempoPoint[] {
  const sorted = [...directives].sort((a, b) => cmp(a.t, b.t));
  const sets = sorted.filter((d): d is Extract<TempoDirective, { kind: "set" }> => d.kind === "set");
  // Music before its first tempo mark plays at that mark's tempo when the mark is at
  // (or within a couple of measures of) the start — a pickup or intro before the mark is
  // still that tempo. A first mark deep in the piece says nothing about how it began.
  const first = sets[0];
  const nearStart = first && cmp(first.t, mul(ctx.measureLengthAt(ZERO), frac(2))) <= 0;
  const initial = clampBpm(nearStart ? first.bpm : ctx.defaultBpm);

  const points: TempoPoint[] = [{ t: ZERO, bpm: initial }];
  const push = (t: Fraction, bpm: number): void => {
    const last = points[points.length - 1]!;
    if (eq(last.t, t)) last.bpm = bpm;
    else if (last.bpm !== bpm) points.push({ t, bpm });
  };

  let current = initial;
  let explicit = initial;
  for (const [i, d] of sorted.entries()) {
    if (d.kind === "set") {
      explicit = current = clampBpm(d.bpm);
      push(d.t, current);
    } else if (d.kind === "atempo") {
      current = explicit;
      push(d.t, current);
    } else {
      const target = clampBpm(current * d.factor);
      const next = sorted.slice(i + 1).find((x) => cmp(x.t, d.t) > 0);
      const available = sub(next ? next.t : ctx.total, d.t);
      const cap = mul(ctx.measureLengthAt(d.t), frac(RAMP_MEASURES));
      const span = cmp(available, cap) < 0 ? available : cap;
      if (cmp(span, ZERO) <= 0) continue;
      const steps = Math.max(1, Math.min(RAMP_MAX_STEPS, Math.ceil(toNumber(span) * RAMP_STEPS_PER_WHOLE)));
      const stepLen = div(span, frac(steps));
      for (let j = 1; j <= steps; j++) {
        push(add(d.t, mul(stepLen, frac(j))), current + ((target - current) * j) / steps);
      }
      current = target;
    }
  }
  return points;
}
