import { describe, expect, it } from "vitest";
import { engrave } from "@/engraving";
import { BRAVURA } from "@/render/smufl";
import { newPianoScore, note, rest } from "@/model";
import type { Score } from "@/model";
import type { GlyphPrim, LayoutResult, Page, System } from "@/engraving/layout-types";
import { findSystemForMeasure, hitTestElement, idsInRect, selectionBoxes } from "@/ui/layout-utils";
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

describe("selectionBoxes: markings", () => {
  it("merges every primitive of a compound attachment (tempo: note-glyph + text runs) into one box", async () => {
    const { expressive } = await import("../fixtures/expressive");
    const score = expressive();
    const tempo = score.attachments.find((a) => a.kind === "tempo");
    expect(tempo).toBeDefined();
    const layout = engrave(score, { font: BRAVURA });

    const boxes = selectionBoxes(layout, BRAVURA, [tempo!.id]);
    expect(boxes).toHaveLength(1); // one merged box, not one per primitive
    expect(boxes[0]!.w).toBeGreaterThan(0);
    expect(boxes[0]!.h).toBeGreaterThan(0);
  });

  it("returns a box for a slur (a path primitive, not a glyph)", async () => {
    const { expressive } = await import("../fixtures/expressive");
    const score = expressive();
    const slur = score.spanners.find((s) => s.kind === "slur");
    expect(slur).toBeDefined();
    const layout = engrave(score, { font: BRAVURA });

    const boxes = selectionBoxes(layout, BRAVURA, [slur!.id]);
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) {
      expect(b.w).toBeGreaterThan(0);
      expect(b.h).toBeGreaterThan(0);
    }
  });

  it("returns a box for a hairpin (two line primitives merged into one)", async () => {
    const { expressive } = await import("../fixtures/expressive");
    const score = expressive();
    const hairpin = score.spanners.find((s) => s.kind === "hairpin");
    expect(hairpin).toBeDefined();
    const layout = engrave(score, { font: BRAVURA });

    const boxes = selectionBoxes(layout, BRAVURA, [hairpin!.id]);
    expect(boxes).toHaveLength(1);
  });

  it("returns a box for a fermata attachment", async () => {
    const { expressive } = await import("../fixtures/expressive");
    const score = expressive();
    const fermata = score.attachments.find((a) => a.kind === "fermata");
    expect(fermata).toBeDefined();
    const layout = engrave(score, { font: BRAVURA });

    expect(selectionBoxes(layout, BRAVURA, [fermata!.id])).toHaveLength(1);
  });
});

describe("idsInRect: markings", () => {
  it("a rubber band over a dynamic mark picks up its attachment id", async () => {
    const { expressive } = await import("../fixtures/expressive");
    const score = expressive();
    const dynamic = score.attachments.find((a) => a.kind === "dynamic");
    expect(dynamic).toBeDefined();
    const layout = engrave(score, { font: BRAVURA });
    const box = selectionBoxes(layout, BRAVURA, [dynamic!.id])[0]!;

    const ids = idsInRect(layout, BRAVURA, 0, { x: box.x - 0.2, y: box.y - 0.2, w: box.w + 0.4, h: box.h + 0.4 });
    expect(ids).toContain(dynamic!.id);
  });
});

describe("hitTestElement", () => {
  it("returns null for empty space and for a page index that doesn't exist", () => {
    const layout = engrave(scale(), { font: BRAVURA });
    expect(hitTestElement(layout, BRAVURA, 0, -1000, -1000)).toBeNull();
    expect(hitTestElement(layout, BRAVURA, 99, 0, 0)).toBeNull();
  });

  it("clicking a notehead's own box centre returns that note's id", () => {
    const score = makeNoteAndRestScore();
    const layout = engrave(score, { font: BRAVURA });
    const event = score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items[0]!;
    const noteId = event.kind === "note" ? event.notes[0]!.id : "";
    const box = selectionBoxes(layout, BRAVURA, [noteId])[0]!;

    const hit = hitTestElement(layout, BRAVURA, 0, box.x + box.w / 2, box.y + box.h / 2);
    expect(hit).toEqual({ id: noteId, role: "notehead" });
  });

  it(
    "regression: two voices on one staff — clicking each note's own tight box centre finds " +
      "that note, not the other voice's (the bug: DOM hit-testing used each glyph's full " +
      "4-staff-space font em-box, not its ink, so two voices' notes within about a staff's " +
      "height of each other had overlapping hit regions and the later-painted voice always won)",
    () => {
      const score = newPianoScore({ measureCount: 1 });
      const part = score.parts[0]!;
      // Voice 0 (stems up, forced by the multi-voice rule) and voice 1 (stems down) a
      // third-or-so apart at every beat — exactly the spacing that overlapped under the
      // old full-em-box DOM hit-testing, per the live repro this test is drawn from.
      const v0 = [note("C4", 4), note("D4", 4), note("E4", 4), note("F4", 4)];
      const v1 = [note("G4", 4), note("A4", 4), note("B4", 4), note("C5", 4)];
      part.measures[0]!.staves[0]!.voices = [
        { id: "v0", index: 0, items: v0 },
        { id: "v1", index: 1, items: v1 },
      ];

      const layout = engrave(score, { font: BRAVURA });
      const allNoteIds = [...v0, ...v1].map((ev) => ev.notes[0]!.id);
      const expectedVoice = new Map(v0.map((ev) => [ev.notes[0]!.id, 0]));
      for (const ev of v1) expectedVoice.set(ev.notes[0]!.id, 1);

      for (const id of allNoteIds) {
        const box = selectionBoxes(layout, BRAVURA, [id])[0]!;
        const hit = hitTestElement(layout, BRAVURA, 0, box.x + box.w / 2, box.y + box.h / 2);
        expect(hit?.id).toBe(id);
      }
    },
  );

});
