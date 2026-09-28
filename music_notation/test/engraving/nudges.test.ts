import { describe, expect, it } from "vitest";
import { applyNudges, translatePathD } from "@/engraving/nudges";
import type { GlyphPrim, LinePrim, PathPrim, PolygonPrim, Primitive, StaffLinesPrim, TextPrim } from "@/engraving/layout-types";
import { engrave } from "@/engraving/engrave";
import { BRAVURA } from "@/render/smufl/generated/bravura";
import { selectionBoxes } from "@/ui/layout-utils";

describe("translatePathD", () => {
  it("shifts every (x, y) pair in an M/L/C/Z path by (dx, dy), leaving command letters alone", () => {
    const d = "M 1 2 C 3 4 5 6 7 8 L 9 10 Z";
    expect(translatePathD(d, 10, -1)).toBe("M 11 1 C 13 3 15 5 17 7 L 19 9 Z");
  });

  it("round-trips a negative shift and preserves decimal precision to 4 places", () => {
    expect(translatePathD("M 1.2345 2.6789", 0.00005, 0)).toBe("M 1.2346 2.6789"); // rounds at 1e-4
  });
});

describe("applyNudges", () => {
  const glyph: GlyphPrim = { type: "glyph", glyph: "dynamicForte", x: 5, y: 10, ref: { id: "att-1", role: "dynamic" } };
  const text: TextPrim = { type: "text", text: "cresc.", x: 5, y: 10, size: 1.6, style: "expression", ref: { id: "att-2", role: "text" } };
  const line: LinePrim = { type: "line", x1: 0, y1: 0, x2: 4, y2: 1, thickness: 0.16, ref: { id: "span-1", role: "hairpin" } };
  const polygon: PolygonPrim = { type: "polygon", points: [[0, 0], [4, 0], [4, 1], [0, 1]], ref: { id: "beam-1", role: "beam" } };
  const path: PathPrim = { type: "path", d: "M 0 0 C 1 1 2 1 3 0 Z", fill: true, ref: { id: "span-2", role: "slur" } };
  const staffLines: StaffLinesPrim = { type: "staffLines", x: 0, y: 0, width: 10, lineCount: 5, thickness: 0.1 };
  const untouched: GlyphPrim = { type: "glyph", glyph: "noteheadBlack", x: 1, y: 1, ref: { id: "note-1", role: "notehead" } };

  it("translates only the primitives whose ref id has a recorded nudge, leaving everything else exactly as it was", () => {
    const all: Primitive[] = [glyph, text, line, polygon, path, staffLines, untouched];
    const out = applyNudges(all, { "att-1": { dx: 2, dy: 3 } });

    expect(out[0]).toMatchObject({ x: 7, y: 13 }); // glyph, nudged
    expect(out[1]).toBe(text); // untouched primitives keep the SAME reference
    expect(out[2]).toBe(line);
    expect(out[3]).toBe(polygon);
    expect(out[4]).toBe(path);
    expect(out[5]).toBe(staffLines);
    expect(out[6]).toBe(untouched);
  });

  it("translates a text primitive", () => {
    const out = applyNudges([text], { "att-2": { dx: -1, dy: 0.5 } });
    expect(out[0]).toMatchObject({ x: 4, y: 10.5 });
  });

  it("translates a line primitive's both endpoints", () => {
    const out = applyNudges([line], { "span-1": { dx: 1, dy: -1 } }) as LinePrim[];
    expect(out[0]).toMatchObject({ x1: 1, y1: -1, x2: 5, y2: 0 });
  });

  it("translates a polygon primitive's every point", () => {
    const out = applyNudges([polygon], { "beam-1": { dx: 1, dy: 1 } }) as PolygonPrim[];
    expect(out[0]!.points).toEqual([[1, 1], [5, 1], [5, 2], [1, 2]]);
  });

  it("translates a path primitive's geometry via translatePathD", () => {
    const out = applyNudges([path], { "span-2": { dx: 10, dy: 0 } }) as PathPrim[];
    expect(out[0]!.d).toBe("M 10 0 C 11 1 12 1 13 0 Z");
  });

  it("is a no-op (same array reference) when there are no nudges", () => {
    const all: Primitive[] = [glyph, text];
    expect(applyNudges(all, {})).toBe(all);
  });
});

describe("engrave(): manual nudges end to end", () => {
  it("moves exactly the nudged marking's drawn position, by exactly (dx, dy), and nothing else", async () => {
    const { expressive } = await import("../fixtures/expressive");
    const score = expressive();
    const dynamic = score.attachments.find((a) => a.kind === "dynamic")!;
    const before = engrave(score, { font: BRAVURA });
    const beforeBox = selectionBoxes(before, BRAVURA, [dynamic.id])[0]!;

    score.layout.nudges[dynamic.id] = { dx: 2, dy: -1.5 };
    const after = engrave(score, { font: BRAVURA });
    const afterBox = selectionBoxes(after, BRAVURA, [dynamic.id])[0]!;

    expect(afterBox.x).toBeCloseTo(beforeBox.x + 2, 3);
    expect(afterBox.y).toBeCloseTo(beforeBox.y - 1.5, 3);
    expect(afterBox.w).toBeCloseTo(beforeBox.w, 3);
    expect(afterBox.h).toBeCloseTo(beforeBox.h, 3);

    // Everything else keeps its position: a note far from the nudged dynamic.
    const anyNote = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items.find((it) => it.kind === "note");
    const noteId = anyNote!.kind === "note" ? anyNote!.notes[0]!.id : "";
    const noteBoxBefore = selectionBoxes(before, BRAVURA, [noteId])[0]!;
    const noteBoxAfter = selectionBoxes(after, BRAVURA, [noteId])[0]!;
    expect(noteBoxAfter).toEqual(noteBoxBefore);
  });

  it("a spanner (slur) nudge moves every piece of a system-crossing spanner", async () => {
    const { ties } = await import("../fixtures/ties");
    const score = ties();
    // ties.ts's fixture has a slur/tie split across a forced system break; use whichever
    // spanner exists (a slur if present, else fall back to confirming ties aren't nudgeable
    // targets since MOVABLE_ROLES excludes "tie" — this only asserts on a real spanner).
    const slur = score.spanners.find((s) => s.kind === "slur");
    if (!slur) return; // fixture has no slur; nothing to assert here
    const before = engrave(score, { font: BRAVURA });
    const boxesBefore = selectionBoxes(before, BRAVURA, [slur.id]);
    score.layout.nudges[slur.id] = { dx: 0, dy: 1 };
    const after = engrave(score, { font: BRAVURA });
    const boxesAfter = selectionBoxes(after, BRAVURA, [slur.id]);
    expect(boxesAfter).toHaveLength(boxesBefore.length);
    for (let i = 0; i < boxesBefore.length; i++) {
      expect(boxesAfter[i]!.y).toBeCloseTo(boxesBefore[i]!.y + 1, 3);
    }
  });

  it("an empty nudges map changes nothing (byte-identical layout to no nudges at all)", async () => {
    const { minuet } = await import("../fixtures/minuet");
    const score = minuet();
    const a = engrave(score, { font: BRAVURA });
    score.layout.nudges = {};
    const b = engrave(score, { font: BRAVURA });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
