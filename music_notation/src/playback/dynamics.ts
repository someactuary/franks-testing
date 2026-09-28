/**
 * Loudness over time for one part: persistent dynamic levels ("mf"), per-note accents
 * ("sfz"), and hairpin ramps between levels. MIDI note-on velocity is the only loudness
 * control a piano responds to, so this is evaluated once per note at its attack.
 */
import { toNumber, type Fraction } from "@/model/duration";
import { HAIRPIN_DEFAULT_DELTA } from "./interpret";

export interface DynamicsInput {
  /** Persistent level changes: from time `t` (whole notes) on, notes play at `velocity`. */
  sets: { t: Fraction; velocity: number }[];
  /** Accents that apply only to notes starting exactly at `t`. */
  accents: { t: Fraction; bump: number }[];
  hairpins: { from: Fraction; to: Fraction; shape: "cresc" | "dim" }[];
}

interface Point {
  t: number;
  v: number;
}
interface Ramp {
  from: number;
  to: number;
  v0: number;
  v1: number;
}

const clampVelocity = (v: number): number => Math.max(1, Math.min(127, v));

/** How close after a hairpin's end a dynamic marking may sit and still count as its target. */
const TARGET_WINDOW = 0.25;

export class DynamicsCurve {
  private readonly points: Point[];
  private readonly ramps: Ramp[] = [];
  private readonly accents = new Map<number, number>();

  constructor(input: DynamicsInput, private readonly defaultVelocity: number) {
    // Stable sort: two marks at the same time resolve to the later one.
    const explicit = input.sets.map((s) => ({ t: toNumber(s.t), v: clampVelocity(s.velocity) }));
    explicit.sort((a, b) => a.t - b.t);
    this.points = [...explicit];

    for (const a of input.accents) {
      const t = toNumber(a.t);
      this.accents.set(t, (this.accents.get(t) ?? 0) + a.bump);
    }

    const hairpins = input.hairpins
      .map((h) => ({ from: toNumber(h.from), to: toNumber(h.to), shape: h.shape }))
      .filter((h) => h.to > h.from)
      .sort((a, b) => a.from - b.from);

    for (const h of hairpins) {
      const v0 = this.levelAt(h.from);
      const sign = h.shape === "cresc" ? 1 : -1;
      // The ramp aims at the dynamic marking written at (or just after) its end, if it
      // points the right way; otherwise it moves a fixed distance from where it started.
      const target = explicit.find((p) => p.t >= h.to - 1e-9 && p.t <= h.to + TARGET_WINDOW);
      const v1 = target && (target.v - v0) * sign > 0 ? target.v : clampVelocity(v0 + sign * HAIRPIN_DEFAULT_DELTA);
      this.ramps.push({ from: h.from, to: h.to, v0, v1 });
      // Whatever the ramp reached carries on as the new level until the next marking.
      if (!explicit.some((p) => Math.abs(p.t - h.to) < 1e-9)) this.insert({ t: h.to, v: v1 });
    }
  }

  private insert(p: Point): void {
    let i = this.points.length;
    while (i > 0 && this.points[i - 1]!.t > p.t) i--;
    this.points.splice(i, 0, p);
  }

  /** The prevailing level at time `t` (whole notes), ignoring hairpin ramps. */
  private levelAt(t: number): number {
    let lo = 0;
    let hi = this.points.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.points[mid]!.t <= t + 1e-9) lo = mid + 1;
      else hi = mid;
    }
    return lo === 0 ? this.defaultVelocity : this.points[lo - 1]!.v;
  }

  /** Velocity of a plain note attacked at `t`, following any hairpin in progress. */
  velocityAt(t: Fraction): number {
    const x = toNumber(t);
    for (const r of this.ramps) {
      if (x >= r.from - 1e-9 && x < r.to - 1e-9) {
        return clampVelocity(Math.round(r.v0 + ((r.v1 - r.v0) * (x - r.from)) / (r.to - r.from)));
      }
    }
    return this.levelAt(x);
  }

  /** Extra velocity for a sforzando-type mark on notes starting exactly at `t`. */
  accentAt(t: Fraction): number {
    return this.accents.get(toNumber(t)) ?? 0;
  }
}
