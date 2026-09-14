import { describe, expect, it } from "vitest";
import { glyphBox, pathBounds } from "@/engraving/geometry";
import { resolveTies, tieSide } from "@/engraving/ties";
import type { Primitive } from "@/engraving/layout-types";
import { chord, note } from "@/model/factory";
import type { NoteEvent } from "@/model/score";
import {
  allSystems,
  FONT,
  makeScore,
  paths,
  run,
  setStaff,
  staffTop,
  system,
  withRef,
  withRole,
} from "./helpers";

/** Mark notes of an event as tie starts — all of them, or only the given indices. */
function tie(ev: NoteEvent, indices?: number[]): NoteEvent {
  return {
    ...ev,
    notes: ev.notes.map((n, i) =>
      indices === undefined || indices.includes(i) ? { ...n, tieStart: true } : n,
    ),
  };
}

/** Vertical span of every primitive that carries ink, including path bounds. */
function inkSpan(prims: Primitive[]): { minY: number; maxY: number } {
  let minY = Infinity;
  let maxY = -Infinity;
  const see = (y: number) => {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const p of prims) {
    switch (p.type) {
      case "glyph": {
        const box = glyphBox(FONT, p.glyph);
        const s = p.scale ?? 1;
        see(p.y - box.up * s);
        see(p.y + box.down * s);
        break;
      }
      case "line":
        see(Math.min(p.y1, p.y2));
        see(Math.max(p.y1, p.y2));
        break;
      case "polygon":
        for (const [, y] of p.points) see(y);
        break;
      case "path": {
        const b = pathBounds(p.d);
        if (b) {
          see(b.minY);
          see(b.maxY);
        }
        break;
      }
      case "staffLines":
        see(p.y);
        see(p.y + p.lineCount - 1);
        break;
      default:
        break;
    }
  }
  return { minY, maxY };
}

describe("tie pairing", () => {
  it("ties to the next note of identical pitch in the same voice", () => {
    const score = makeScore({ measureCount: 2 });
    const first = tie(note("C5", 4));
    const second = note("C5", 4);
    setStaff(score, 0, 0, [first, note("D5", 4), note("E5", 4), note("F5", 4)]);
    setStaff(score, 1, 0, [second, note("D5", 4), note("E5", 4), note("F5", 4)]);
    const { pairs, targets } = resolveTies(score);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.start.noteId).toBe(first.notes[0]!.id);
    expect(pairs[0]!.end.noteId).toBe(second.notes[0]!.id);
    expect(pairs[0]!.end.measureIndex).toBe(1);
    expect(targets.has(second.notes[0]!.id)).toBe(true);
  });

  it("ignores a differently spelled note of the same sounding pitch", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [tie(note("C#5", 4)), note("Db5", 4), note("E5", 4), note("F5", 4)]);
    expect(resolveTies(score).pairs).toHaveLength(0);
  });

  it("finds a partner past an intervening event of another pitch", () => {
    const score = makeScore({ measureCount: 1 });
    const start = tie(note("C5", 4));
    const end = note("C5", 4);
    setStaff(score, 0, 0, [start, note("D5", 4), end, note("F5", 4)]);
    const { pairs } = resolveTies(score);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.end.noteId).toBe(end.notes[0]!.id);
  });
});

describe("tie side", () => {
  it("puts a single note's tie opposite its stem", () => {
    expect(tieSide(0, 1, "up")).toBe("down");
    expect(tieSide(0, 1, "down")).toBe("up");
  });

  it("curves the outer notes of a chord outwards and alternates the inner ones", () => {
    expect(tieSide(0, 3, "up")).toBe("down");
    expect(tieSide(2, 3, "up")).toBe("up");
    expect(tieSide(1, 3, "up")).toBe("up");
    expect(tieSide(1, 4, "up")).toBe("up");
    expect(tieSide(2, 4, "up")).toBe("down");
  });
});

describe("tie primitives", () => {
  it("draws one filled path tagged with the starting note", () => {
    const score = makeScore({ measureCount: 1 });
    const start = tie(note("C5", 4));
    const end = note("C5", 4);
    setStaff(score, 0, 0, [start, end, note("E5", 4), note("F5", 4)]);
    const sys = system(run(score));
    const ties = paths(withRole(sys.primitives, "tie"));
    expect(ties).toHaveLength(1);
    expect(ties[0]!.fill).toBe(true);
    expect(ties[0]!.ref!.id).toBe(start.notes[0]!.id);
    expect(withRef(sys.primitives, start.notes[0]!.id, "tie")).toHaveLength(1);
    expect(end.notes[0]!.id).not.toBe(start.notes[0]!.id);
  });

  it("runs from just right of the first notehead to just left of the second", () => {
    const score = makeScore({ measureCount: 1 });
    const start = tie(note("C5", 4));
    const end = note("C5", 4);
    setStaff(score, 0, 0, [start, end, note("E5", 4), note("F5", 4)]);
    const sys = system(run(score));
    const bounds = pathBounds(paths(withRole(sys.primitives, "tie"))[0]!.d)!;
    const heads = sys.primitives.filter(
      (p): p is Extract<Primitive, { type: "glyph" }> =>
        p.type === "glyph" && p.glyph === "noteheadBlack",
    );
    const headWidth = glyphBox(FONT, "noteheadBlack").width;
    const first = heads[0]!;
    const second = heads[1]!;
    expect(bounds.minX).toBeGreaterThan(first.x + headWidth);
    expect(bounds.maxX).toBeLessThan(second.x);
  });

  it("draws a tie that crosses a barline", () => {
    const score = makeScore({ measureCount: 2 });
    const start = tie(note("F5", 4));
    setStaff(score, 0, 0, [note("C5", 4), note("D5", 4), note("E5", 4), start]);
    setStaff(score, 1, 0, [note("F5", 4), note("E5", 4), note("D5", 4), note("C5", 4)]);
    const sys = system(run(score));
    const ties = paths(withRef(sys.primitives, start.notes[0]!.id, "tie"));
    expect(ties).toHaveLength(1);
    const bounds = pathBounds(ties[0]!.d)!;
    const barline = sys.measures[0]!.x + sys.measures[0]!.width;
    expect(bounds.minX).toBeLessThan(barline);
    expect(bounds.maxX).toBeGreaterThan(barline);
  });

  it("draws nothing when a tie has no partner", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [note("C5", 4), note("D5", 4), note("E5", 4), tie(note("F5", 4))]);
    const sys = system(run(score));
    expect(withRole(sys.primitives, "tie")).toHaveLength(0);
  });

  it("curves a chord's outer ties away from the chord", () => {
    const score = makeScore({ measureCount: 1 });
    const start = tie(chord(["C5", "E5", "G5"], 2));
    setStaff(score, 0, 0, [start, chord(["C5", "E5", "G5"], 2)]);
    const sys = system(run(score));
    const top = staffTop(sys, 0);
    const ties = withRole(sys.primitives, "tie");
    expect(ties).toHaveLength(3);

    const boundsOf = (noteIndex: number) =>
      pathBounds(paths(withRef(sys.primitives, start.notes[noteIndex]!.id, "tie"))[0]!.d)!;
    // G5 sits a half space above the top line, C5 a half space below the middle line.
    const g5 = top - 0.5;
    const c5 = top + 1.5;
    expect(boundsOf(2).minY).toBeLessThan(g5);
    expect(boundsOf(2).maxY).toBeLessThanOrEqual(g5);
    expect(boundsOf(0).maxY).toBeGreaterThan(c5);
    expect(boundsOf(0).minY).toBeGreaterThanOrEqual(c5);
  });

  it("splits a tie that crosses a system break into two pieces", () => {
    const score = makeScore({ measureCount: 3 });
    score.layout.systemBreaks = [2];
    const start = tie(note("F5", 4));
    for (const m of [0, 1, 2]) {
      setStaff(score, m, 0, [note("C5", 4), note("D5", 4), note("E5", 4), note("F5", 4)]);
      setStaff(score, m, 1, [note("C3", 2), note("G2", 2)]);
    }
    setStaff(score, 1, 0, [note("C5", 4), note("D5", 4), note("E5", 4), start]);
    setStaff(score, 2, 0, [note("F5", 4), note("E5", 4), note("D5", 4), note("C5", 4)]);

    const systems = allSystems(run(score));
    expect(systems).toHaveLength(2);
    const first = paths(withRef(systems[0]!.primitives, start.notes[0]!.id, "tie"));
    const second = paths(withRef(systems[1]!.primitives, start.notes[0]!.id, "tie"));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);

    // The first piece runs to the right edge of its system, the second starts
    // after the next system's clef/key prefix and ends at the tied-to notehead.
    const a = pathBounds(first[0]!.d)!;
    const b = pathBounds(second[0]!.d)!;
    expect(a.maxX).toBeCloseTo(systems[0]!.width, 3); // path coordinates are rounded
    expect(b.minX).toBeGreaterThan(0);
    expect(b.minX).toBeLessThan(systems[1]!.measures[0]!.columns[0]!.x);
    expect(b.maxX).toBeLessThan(systems[1]!.measures[0]!.columns[0]!.x);
    // Both pieces sit on the same side of the staff.
    expect(Math.sign(a.minY)).toBe(Math.sign(b.minY));
  });

  it("keeps ties inside the system's vertical extent", () => {
    const score = makeScore({ measureCount: 2 });
    const low = tie(note("E2", 1));
    setStaff(score, 0, 1, [low]);
    setStaff(score, 1, 1, [note("E2", 1)]);
    const sys = system(run(score));
    expect(withRole(sys.primitives, "tie")).toHaveLength(1);
    const span = inkSpan(sys.primitives);
    // The tie is the lowest ink on the system, so it is what the extent must cover.
    const tieBounds = pathBounds(paths(withRole(sys.primitives, "tie"))[0]!.d)!;
    expect(tieBounds.maxY).toBeCloseTo(span.maxY, 6);
    expect(sys.height).toBeGreaterThanOrEqual(span.maxY - span.minY - 1e-9);
  });
});

describe("accidentals and ties", () => {
  it("does not re-state an accidental on the tied-to note, but does on an untied repeat", () => {
    const score = makeScore({ measureCount: 2 });
    const start = tie(note("F#5", 4));
    const tiedTo = note("F#5", 4);
    const untied = note("F#5", 4);
    setStaff(score, 0, 0, [note("C5", 4), note("D5", 4), note("E5", 4), start]);
    setStaff(score, 1, 0, [tiedTo, note("G5", 4), untied, note("A5", 4)]);
    const sys = system(run(score));

    expect(withRef(sys.primitives, start.notes[0]!.id, "accidental")).toHaveLength(1);
    expect(withRef(sys.primitives, tiedTo.notes[0]!.id, "accidental")).toHaveLength(0);
    expect(withRef(sys.primitives, untied.notes[0]!.id, "accidental")).toHaveLength(1);
  });

  it("still honours an explicit accidental on a tied-to note", () => {
    const score = makeScore({ measureCount: 2 });
    const start = tie(note("F#5", 4));
    const tiedTo = note("F#5", 4);
    tiedTo.notes[0]!.accidental = "force";
    setStaff(score, 0, 0, [note("C5", 4), note("D5", 4), note("E5", 4), start]);
    setStaff(score, 1, 0, [tiedTo, note("G5", 4), note("A5", 4), note("B5", 4)]);
    const sys = system(run(score));
    expect(withRef(sys.primitives, tiedTo.notes[0]!.id, "accidental")).toHaveLength(1);
  });
});
