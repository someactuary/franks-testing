import { describe, expect, it } from "vitest";
import { fracToString, frac } from "@/model/duration";
import { note, rest } from "@/model/factory";
import type { RestEvent } from "@/model/score";
import { glyphBox } from "@/engraving/geometry";
import {
  FONT,
  makeScore,
  polygons,
  run,
  setStaff,
  setVoices,
  staffTop,
  stemDirection,
  system,
  withRef,
  withRole,
} from "./helpers";

/** y of the rest glyph drawn for `id`, relative to the treble staff's top line. */
function restY(score: Parameters<typeof run>[0], id: string): number {
  const sys = system(run(score));
  const g = withRef(sys.primitives, id, "rest")[0];
  if (!g || g.type !== "glyph") throw new Error(`no rest glyph for ${id}`);
  return g.y - staffTop(sys, 0);
}

describe("stem direction with several voices", () => {
  it("keeps the pitch rule when a staff-measure has one voice", () => {
    const score = makeScore({ measureCount: 1 });
    const low = note("C4", 4);
    const high = note("A5", 4);
    setStaff(score, 0, 0, [low, high, rest(2)]);
    const prims = system(run(score)).primitives;
    expect(stemDirection(prims, low.id)).toBe("up");
    expect(stemDirection(prims, high.id)).toBe("down");
  });

  it("points voice 0 up and voice 1 down whatever the pitches say", () => {
    const score = makeScore({ measureCount: 1 });
    // Voice 0 is high (the pitch rule would point it down), voice 1 is low.
    const upper = note("A5", 4);
    const lower = note("C4", 4);
    setVoices(score, 0, 0, [
      [upper, rest(4), rest(2)],
      [lower, rest(4), rest(2)],
    ]);
    const prims = system(run(score)).primitives;
    expect(stemDirection(prims, upper.id)).toBe("up");
    expect(stemDirection(prims, lower.id)).toBe("down");
  });

  it("points voice 2 up and voice 3 down as well", () => {
    const score = makeScore({ measureCount: 1 });
    const v2 = note("A5", 4);
    const v3 = note("C4", 4);
    setVoices(score, 0, 0, [[rest(1)], [rest(1)], [v2, rest(4), rest(2)], [v3, rest(4), rest(2)]]);
    const prims = system(run(score)).primitives;
    expect(stemDirection(prims, v2.id)).toBe("up");
    expect(stemDirection(prims, v3.id)).toBe("down");
  });

  it("still honours an explicit stem override in a multi-voice measure", () => {
    const score = makeScore({ measureCount: 1 });
    const forced = { ...note("A5", 4), stem: "down" as const };
    setVoices(score, 0, 0, [
      [forced, rest(4), rest(2)],
      [note("C4", 4), rest(4), rest(2)],
    ]);
    expect(stemDirection(system(run(score)).primitives, forced.id)).toBe("down");
  });
});

describe("rest placement with several voices", () => {
  it("lifts voice 0 and drops voice 1 by a staff space", () => {
    const single = makeScore({ measureCount: 1 });
    const solo = rest(4);
    setStaff(single, 0, 0, [solo, note("C5", 4), rest(2)]);
    const soloY = restY(single, solo.id);

    const double = makeScore({ measureCount: 1 });
    const upper = rest(4);
    const lower = rest(4);
    setVoices(double, 0, 0, [
      [upper, note("C5", 4), rest(2)],
      [lower, note("E4", 4), rest(2)],
    ]);
    expect(restY(double, upper.id)).toBeCloseTo(soloY - 1, 6);
    expect(restY(double, lower.id)).toBeCloseTo(soloY + 1, 6);
  });

  it("honours yOffsetSteps on top of the voice shift", () => {
    const plain = makeScore({ measureCount: 1 });
    const flat = rest(4);
    setStaff(plain, 0, 0, [flat, note("C5", 4), rest(2)]);
    const plainY = restY(plain, flat.id);

    const nudged = makeScore({ measureCount: 1 });
    const moved: RestEvent = { ...rest(4), yOffsetSteps: 2 };
    setStaff(nudged, 0, 0, [moved, note("C5", 4), rest(2)]);
    // Two steps up = one staff space up = one less in y.
    expect(restY(nudged, moved.id)).toBeCloseTo(plainY - 1, 6);
  });

  it("draws nothing for an invisible rest but keeps its column", () => {
    const score = makeScore({ measureCount: 1 });
    const hidden: RestEvent = { ...rest(4), invisible: true };
    const shown = rest(4);
    setStaff(score, 0, 0, [hidden, shown, note("C5", 2)]);
    const sys = system(run(score));
    expect(withRef(sys.primitives, hidden.id, "rest")).toHaveLength(0);
    expect(withRef(sys.primitives, shown.id, "rest")).toHaveLength(1);

    const offsets = sys.measures[0]!.columns.map((c) => fracToString(c.offset));
    expect(offsets).toContain(fracToString(frac(0, 1)));
    expect(offsets).toContain(fracToString(frac(1, 4)));
  });
});

describe("collisions between voices", () => {
  const headWidth = glyphBox(FONT, "noteheadBlack").width;

  /** x of the single notehead drawn for an event. */
  function headX(prims: Parameters<typeof polygons>[0], id: string): number {
    const head = withRef(prims, id, "notehead")[0];
    if (!head || head.type !== "glyph") throw new Error("no notehead");
    return head.x;
  }

  it("nudges the voice-1 chord right on a unison", () => {
    const score = makeScore({ measureCount: 1 });
    const upper = note("C5", 4);
    const lower = note("C5", 4);
    setVoices(score, 0, 0, [
      [upper, rest(4), rest(2)],
      [lower, rest(4), rest(2)],
    ]);
    const prims = system(run(score)).primitives;
    expect(headX(prims, lower.notes[0]!.id) - headX(prims, upper.notes[0]!.id)).toBeCloseTo(
      headWidth,
      6,
    );
  });

  it("nudges the voice-1 chord right on a second", () => {
    const score = makeScore({ measureCount: 1 });
    const upper = note("C5", 4);
    const lower = note("B4", 4);
    setVoices(score, 0, 0, [
      [upper, rest(4), rest(2)],
      [lower, rest(4), rest(2)],
    ]);
    const prims = system(run(score)).primitives;
    expect(headX(prims, lower.notes[0]!.id) - headX(prims, upper.notes[0]!.id)).toBeCloseTo(
      headWidth,
      6,
    );
  });

  it("leaves voices that are a third apart alone", () => {
    const score = makeScore({ measureCount: 1 });
    const upper = note("C5", 4);
    const lower = note("A4", 4);
    setVoices(score, 0, 0, [
      [upper, rest(4), rest(2)],
      [lower, rest(4), rest(2)],
    ]);
    const prims = system(run(score)).primitives;
    expect(headX(prims, lower.notes[0]!.id)).toBeCloseTo(headX(prims, upper.notes[0]!.id), 6);
  });
});

describe("beams, columns and accidentals across voices", () => {
  it("beams each voice separately", () => {
    const score = makeScore({ measureCount: 1 });
    setVoices(score, 0, 0, [
      [...["C5", "D5", "E5", "F5"].map((p) => note(p, 8)), rest(2)],
      [...["A4", "G4", "F4", "E4"].map((p) => note(p, 8)), rest(2)],
    ]);
    // One group per voice, never one merged group across both.
    expect(polygons(withRole(system(run(score)).primitives, "beam"))).toHaveLength(2);
  });

  it("merges the onsets of every voice into one set of columns", () => {
    const score = makeScore({ measureCount: 1 });
    setVoices(score, 0, 0, [
      [note("C5", 4), note("D5", 4), note("E5", 2)],
      [...["A4", "G4", "F4", "E4"].map((p) => note(p, 8)), rest(2)],
    ]);
    const columns = system(run(score)).measures[0]!.columns;
    // Four eighth onsets, then the half note at 1/2: five distinct columns.
    expect(columns.map((c) => fracToString(c.offset))).toEqual(["0/1", "1/8", "1/4", "3/8", "1/2"]);
  });

  it("shares accidental memory between the voices of one staff", () => {
    const score = makeScore({ measureCount: 1 });
    const first = note("F#5", 4);
    const second = note("F#5", 4);
    setVoices(score, 0, 0, [
      [first, rest(4), rest(2)],
      [rest(4), second, rest(2)],
    ]);
    const prims = system(run(score)).primitives;
    expect(withRef(prims, first.notes[0]!.id, "accidental")).toHaveLength(1);
    expect(withRef(prims, second.notes[0]!.id, "accidental")).toHaveLength(0);
  });
});
