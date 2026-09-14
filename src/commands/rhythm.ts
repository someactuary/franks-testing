/**
 * Pure rhythm helpers used by the editing commands (src/commands/edit.ts).
 * No draft mutation here; these only compute values / build fresh model nodes.
 */
import { rest } from "@/model";
import {
  eq,
  fracToString,
  lt,
  NOTE_VALUES,
  notatedToFraction,
  sub,
  ZERO,
  type Fraction,
  type NotatedDuration,
} from "@/model/duration";
import type { RestEvent } from "@/model/score";

/**
 * Greedy decomposition of `len` into plain (dots: 0) notated values, largest first.
 * Works because every note value is an exact negative power of two of a whole note,
 * so any fraction whose reduced denominator is itself a power of two (<= 256, the
 * smallest supported note value) decomposes exactly, the same way its binary
 * expansion would. Throws if `len` cannot be represented at all (e.g. 1/3).
 */
function decomposePlain(len: Fraction): NotatedDuration[] {
  let remaining = len;
  const out: NotatedDuration[] = [];
  for (const base of NOTE_VALUES) {
    const value = notatedToFraction({ base, dots: 0 });
    while (!eq(remaining, ZERO) && !lt(remaining, value)) {
      out.push({ base, dots: 0 });
      remaining = sub(remaining, value);
    }
    if (eq(remaining, ZERO)) break;
  }
  if (!eq(remaining, ZERO)) {
    throw new Error(`decomposeDuration: ${fracToString(len)} is not representable in available note values`);
  }
  return out;
}

/** Is there a single base whose dotted (one dot) value equals `len` exactly? */
function singleDotted(len: Fraction): NotatedDuration | undefined {
  for (const base of NOTE_VALUES) {
    const candidate: NotatedDuration = { base, dots: 1 };
    if (eq(notatedToFraction(candidate), len)) return candidate;
  }
  return undefined;
}

/**
 * Expresses a positive fraction of a whole note as a list of notated values, largest
 * first. Uses plain (undotted) values except a single dot is allowed when it collapses
 * the whole thing into exactly one value (e.g. 3/8 -> a single dotted quarter, rather
 * than a quarter + an eighth). Throws if `len` is not representable at all (e.g. 1/3).
 */
export function decomposeDuration(len: Fraction): NotatedDuration[] {
  if (eq(len, ZERO) || len.num < 0) {
    throw new Error(`decomposeDuration: length must be positive, got ${fracToString(len)}`);
  }
  const plain = decomposePlain(len);
  if (plain.length > 1) {
    const dotted = singleDotted(len);
    if (dotted) return [dotted];
  }
  return plain;
}

/** Rest events covering exactly `len` (a whole note fraction), via decomposeDuration. */
export function restsFor(len: Fraction): RestEvent[] {
  return decomposeDuration(len).map((d) => rest(d.base, d.dots));
}
