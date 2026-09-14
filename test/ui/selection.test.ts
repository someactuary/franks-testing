import { describe, expect, it } from "vitest";
import { engrave } from "@/engraving";
import { BRAVURA } from "@/render/smufl";
import { newPianoScore, note, rest } from "@/model";
import type { Score } from "@/model";
import type { GlyphPrim, LayoutResult, Page, System } from "@/engraving/layout-types";
import { findSystemForMeasure, idsInRect, selectionBoxes } from "@/ui/layout-utils";
import { scale } from "../fixtures/scale";

/** One measure: a quarter note, a quarter rest, then a half note (treble); bass untouched (measure rest). */
function makeNoteAndRestScore(): Score {
  const score = newPianoScore({ measureCount: 1 });
  const part = score.parts[0]!;
  part.measures[0]!.staves[0]!.voices[0]!.items = [note("E4", 4), rest(4), note("G4", 2)];
  return score;
}

interface FoundGlyph {
  page: Page;
  system: System;
  prim: GlyphPrim;
}

/** Locates the glyph primitive carrying `ref.id === id` anywhere in the layout. */
function findGlyphByRefId(layout: LayoutResult, id: string): FoundGlyph | null {
  for (const page of layout.pages) {
    for (const system of page.systems) {
      for (const prim of system.primitives) {
        if (prim.type === "glyph" && prim.ref?.id === id) {
          return { page, system, prim };
        }
      }
    }
  }
  return null;
}

function pageOrigin(found: FoundGlyph): { x: number; y: number } {
  return { x: found.system.x + found.prim.x, y: found.system.y + found.prim.y };
}

/** Some SMuFL glyphs (e.g. restQuarter) have a hairline non-zero left bearing in their bbox,
 * so the nominal origin can sit a whisker outside the ink bbox. Tolerate that. */
const EPS = 0.01;

describe("selectionBoxes", () => {
  it("returns one box around a note's notehead, on the right page, containing the glyph origin", () => {
    const score = makeNoteAndRestScore();
    const layout = engrave(score, { font: BRAVURA });
    const event = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    expect(event.kind).toBe("note");
    const noteId = event.kind === "note" ? event.notes[0]!.id : "";

    const found = findGlyphByRefId(layout, noteId);
    expect(found).not.toBeNull();
    const origin = pageOrigin(found!);

    const boxes = selectionBoxes(layout, BRAVURA, [noteId]);
    expect(boxes).toHaveLength(1);
    const box = boxes[0]!;
    expect(box.pageIndex).toBe(found!.page.index);
    // The glyph's own origin (x, and the notehead y the layout placed it at) sits inside its box.
    expect(origin.x).toBeGreaterThanOrEqual(box.x - EPS);
    expect(origin.x).toBeLessThanOrEqual(box.x + box.w + EPS);
    expect(origin.y).toBeGreaterThanOrEqual(box.y - EPS);
    expect(origin.y).toBeLessThanOrEqual(box.y + box.h + EPS);
  });

  it("returns one box around a rest's glyph, on the right page, containing the glyph origin", () => {
    const score = makeNoteAndRestScore();
    const layout = engrave(score, { font: BRAVURA });
    const event = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[1]!;
    expect(event.kind).toBe("rest");
    const restId = event.id;

    const found = findGlyphByRefId(layout, restId);
    expect(found).not.toBeNull();
    const origin = pageOrigin(found!);

    const boxes = selectionBoxes(layout, BRAVURA, [restId]);
    expect(boxes).toHaveLength(1);
    const box = boxes[0]!;
    expect(box.pageIndex).toBe(found!.page.index);
    expect(origin.x).toBeGreaterThanOrEqual(box.x - EPS);
    expect(origin.x).toBeLessThanOrEqual(box.x + box.w + EPS);
    expect(origin.y).toBeGreaterThanOrEqual(box.y - EPS);
    expect(origin.y).toBeLessThanOrEqual(box.y + box.h + EPS);
  });

  it("returns [] for an id with no notehead/rest primitive", () => {
    const layout = engrave(scale(), { font: BRAVURA });
    expect(selectionBoxes(layout, BRAVURA, ["does-not-exist"])).toEqual([]);
  });

  it("returns [] when given no ids", () => {
    const layout = engrave(scale(), { font: BRAVURA });
    expect(selectionBoxes(layout, BRAVURA, [])).toEqual([]);
  });
});

describe("idsInRect", () => {
  it("finds exactly the first measure's note ids (treble quarters + bass whole note)", () => {
    const score = scale();
    const layout = engrave(score, { font: BRAVURA });
    const { page, system, measure } = findSystemForMeasure(layout, 0)!;

    const trebleIds = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items.flatMap((e) =>
      e.kind === "note" ? e.notes.map((n) => n.id) : [],
    );
    const bassIds = score.parts[0]!.measures[0]!.staves[1]!.voices[0]!.items.flatMap((e) =>
      e.kind === "note" ? e.notes.map((n) => n.id) : [],
    );
    const expectedIds = new Set([...trebleIds, ...bassIds]);
    expect(expectedIds.size).toBe(5); // 4 treble quarters + 1 bass whole note

    // Generous rect over the first measure's full column, spanning both staves.
    const rect = {
      x: system.x + measure.x - 0.5,
      y: system.y - 0.5,
      w: measure.width + 1,
      h: system.height + 1,
    };
    const ids = idsInRect(layout, BRAVURA, page.index, rect);
    expect(new Set(ids)).toEqual(expectedIds);
  });

  it("returns [] for a rect that covers nothing", () => {
    const layout = engrave(scale(), { font: BRAVURA });
    const ids = idsInRect(layout, BRAVURA, 0, { x: -1000, y: -1000, w: 1, h: 1 });
    expect(ids).toEqual([]);
  });

  it("returns [] for a page index that doesn't exist", () => {
    const layout = engrave(scale(), { font: BRAVURA });
    const ids = idsInRect(layout, BRAVURA, 99, { x: 0, y: 0, w: 1000, h: 1000 });
    expect(ids).toEqual([]);
  });
});
