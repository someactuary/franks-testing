/**
 * The order measures are actually played in, once repeat barlines and volta
 * ("1st/2nd ending") brackets are followed. Returns score measure indices; a repeated
 * measure appears once per time it's played. D.C./D.S./coda have no model
 * representation (they'd be plain text), so they aren't followed.
 */
import type { Score } from "@/model/score";

interface Volta {
  last: number;
  numbers: number[];
}

export function unfoldMeasures(score: Score): number[] {
  const m = score.measures;
  const n = m.length;

  const startsRepeat = (i: number): boolean =>
    m[i]!.startBarline === "repeat-start" ||
    (i > 0 && (m[i - 1]!.barline === "repeat-start" || m[i - 1]!.barline === "repeat-both"));
  const endsRepeat = (i: number): boolean => m[i]!.barline === "repeat-end" || m[i]!.barline === "repeat-both";

  // Volta brackets: a group opens at ending.type "start" and runs through the measure
  // marked "stop"/"discontinue" (or a repeat sign, or the next bracket, if it never closes).
  const voltaOf: (Volta | undefined)[] = new Array<Volta | undefined>(n).fill(undefined);
  let open: Volta | undefined;
  for (let i = 0; i < n; i++) {
    const e = m[i]!.ending;
    if (e && (e.type === "start" || !open)) open = { last: i, numbers: e.numbers };
    if (open) {
      voltaOf[i] = open;
      open.last = i;
      // A first ending always closes at its repeat sign, even when only marked "start".
      if ((e && e.type !== "start") || endsRepeat(i)) open = undefined;
    }
  }

  const order: number[] = [];
  let i = 0;
  let pass = 1;
  let sectionStart = 0;
  // Every jump moves forward or replays a bounded section; the guard only protects
  // against a malformed score looping forever.
  for (let guard = 0; i < n && guard < n * 8 + 32; guard++) {
    if (startsRepeat(i) && i !== sectionStart) {
      sectionStart = i;
      pass = 1;
    }
    const volta = voltaOf[i];
    if (volta && !volta.numbers.includes(pass)) {
      i = volta.last + 1;
      continue;
    }
    order.push(i);
    if (endsRepeat(i)) {
      if (pass < 2) {
        pass++;
        i = sectionStart;
      } else {
        pass = 1;
        sectionStart = i + 1;
        i++;
      }
      continue;
    }
    // Last measure of a volta group with no repeat sign: that was the final ending.
    if (volta && i === volta.last) {
      pass = 1;
      sectionStart = i + 1;
    }
    i++;
  }
  return order;
}
