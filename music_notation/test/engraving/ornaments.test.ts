import { describe, expect, it } from "vitest";
import { glyphBox } from "@/engraving/geometry";
import type { GlyphPrim, LinePrim } from "@/engraving/layout-types";
import { chord, note } from "@/model/factory";
import type { NoteEvent, Ornament } from "@/model/score";
import { ornaments } from "../fixtures/ornaments";
import {
  FONT,
  glyphs,
  lines,
  makeScore,
  run,
  setStaff,
  staffTop,
  system,
  withRef,
  withRole,
} from "./helpers";

/** One-measure piano score; the upper staff gets `upper`, the lower a whole rest. */
function oneMeasure(upper: NoteEvent[], lower?: NoteEvent[]) {
  const score = makeScore({ measureCount: 1 });
  setStaff(score, 0, 0, upper);
  if (lower) setStaff(score, 0, 1, lower);
  return system(run(score));
}

/** Vertical ink range of a glyph primitive, from its font box and scale. */
function inkY(p: GlyphPrim): { top: number; bottom: number } {
  const box = glyphBox(FONT, p.glyph);
  const s = p.scale ?? 1;
  return { top: p.y - box.up * s, bottom: p.y + box.down * s };
}

function inkX(p: GlyphPrim): { left: number; right: number } {
  const box = glyphBox(FONT, p.glyph);
  const s = p.scale ?? 1;
  return { left: p.x + box.left * s, right: p.x + Math.max(box.right, box.width) * s };
}

describe("ornaments", () => {
  const cases: [Ornament, string][] = [
    ["trill", "ornamentTrill"],
    ["mordent", "ornamentMordent"],
    ["invertedMordent", "ornamentShortTrill"],
    ["turn", "ornamentTurn"],
    ["invertedTurn", "ornamentTurnInverted"],
  ];
  for (const [ornament, glyph] of cases) {
    it(`draws ${ornament} as ${glyph} with role "ornament"`, () => {
      const ev: NoteEvent = { ...note("C5", 4), ornaments: [ornament] };
      const sys = oneMeasure([ev, note("D5", 4), note("E5", 4), note("F5", 4)]);
      const [prim] = withRef(sys.primitives, ev.id, "ornament") as GlyphPrim[];
      expect(prim?.glyph).toBe(glyph);
    });
  }

  it("sits above the staff and above the note's own ink, centred on the notehead", () => {
    // A down-stem note: the stem points away, so the notehead is the top ink.
    const high: NoteEvent = { ...note("A5", 4), ornaments: ["trill"] };
    // An up-stem note: the stem rises through the top line, which the trill must clear.
    const low: NoteEvent = { ...note("E4", 4), ornaments: ["trill"], stem: "up" };
    const sys = oneMeasure([high, low, note("E5", 4), note("F5", 4)]);
    const top = staffTop(sys, 0);

    for (const ev of [high, low]) {
      const [trill] = withRef(sys.primitives, ev.id, "ornament") as GlyphPrim[];
      const [head] = withRef(sys.primitives, ev.notes[0]!.id, "notehead") as GlyphPrim[];
      const stem = withRef(sys.primitives, ev.id, "stem")[0] as LinePrim;
      const { bottom } = inkY(trill!);
      expect(bottom).toBeLessThan(top);
      expect(bottom).toBeLessThan(inkY(head!).top);
      expect(bottom).toBeLessThan(Math.min(stem.y1, stem.y2));

      const headBox = glyphBox(FONT, head!.glyph);
      const trillBox = glyphBox(FONT, trill!.glyph);
      expect(trill!.x + trillBox.width / 2).toBeCloseTo(head!.x + headBox.width / 2, 6);
    }
  });

  it("stacks several ornaments outwards without overlapping", () => {
    const ev: NoteEvent = { ...note("C5", 4), ornaments: ["trill", "mordent"] };
    const sys = oneMeasure([ev, note("D5", 4), note("E5", 4), note("F5", 4)]);
    const [trill, mordent] = withRef(sys.primitives, ev.id, "ornament") as GlyphPrim[];
    expect(trill!.glyph).toBe("ornamentTrill");
    expect(mordent!.glyph).toBe("ornamentMordent");
    expect(inkY(mordent!).bottom).toBeLessThan(inkY(trill!).top);
  });
});

describe("arpeggio", () => {
  const arpeggiated = (dir: "up" | "down" | "straight"): NoteEvent => ({
    ...chord(["C4", "Eb4", "G4", "C5"], 2),
    arpeggio: dir,
  });

  it("spans the chord from its lowest to its highest notehead", () => {
    const ev = arpeggiated("straight");
    const sys = oneMeasure([ev, note("C5", 2)]);
    const wiggle = glyphs(sys.primitives, "arpeggiato")[0]!;
    expect(wiggle.ref?.id).toBe(ev.id);

    const heads = ev.notes.map(
      (n) => (withRef(sys.primitives, n.id, "notehead") as GlyphPrim[])[0]!,
    );
    const highest = Math.min(...heads.map((h) => inkY(h).top));
    const lowest = Math.max(...heads.map((h) => inkY(h).bottom));
    const { top, bottom } = inkY(wiggle);
    expect(top).toBeLessThanOrEqual(highest);
    expect(bottom).toBeGreaterThanOrEqual(lowest);
    // ... without running far past it.
    expect(highest - top).toBeLessThan(1);
    expect(bottom - lowest).toBeLessThan(1);
  });

  it("sits left of the chord's accidentals", () => {
    const ev = arpeggiated("up");
    const sys = oneMeasure([ev, note("C5", 2)]);
    const wiggle = glyphs(sys.primitives, "arpeggiatoUp")[0]!;
    const flat = glyphs(sys.primitives, "accidentalFlat")[0]!;
    expect(inkX(wiggle).right).toBeLessThan(inkX(flat).left);
  });

  it("uses the arrowed glyph for its direction", () => {
    const up = oneMeasure([arpeggiated("up"), note("C5", 2)]);
    const down = oneMeasure([arpeggiated("down"), note("C5", 2)]);
    expect(glyphs(up.primitives, "arpeggiatoUp")).toHaveLength(1);
    expect(glyphs(down.primitives, "arpeggiatoDown")).toHaveLength(1);
  });

  it("widens its column so the wiggle clears the previous note", () => {
    const plain = oneMeasure([note("C5", 2), chord(["C4", "E4", "G4"], 2)]);
    const arp = oneMeasure([note("C5", 2), { ...chord(["C4", "E4", "G4"], 2), arpeggio: "up" }]);
    const gap = (sys: typeof plain) => sys.measures[0]!.columns[1]!.x - sys.measures[0]!.columns[0]!.x;
    expect(gap(arp)).toBeGreaterThanOrEqual(gap(plain));

    const wiggle = glyphs(arp.primitives, "arpeggiatoUp")[0]!;
    const firstHead = glyphs(arp.primitives, "noteheadHalf")[0]!;
    const headRight = firstHead.x + glyphBox(FONT, "noteheadHalf").width;
    expect(inkX(wiggle).left).toBeGreaterThan(headRight);
  });
});

describe("tremolo", () => {
  for (const strokes of [1, 2, 3] as const) {
    it(`draws tremolo${strokes} centred on the stem of a quarter note`, () => {
      const ev: NoteEvent = { ...note("G4", 4), tremolo: strokes };
      const sys = oneMeasure([ev, note("A4", 4), note("B4", 4), note("C5", 4)]);
      const marks = glyphs(sys.primitives).filter((g) => g.glyph.startsWith("tremolo"));
      expect(marks.map((g) => g.glyph)).toEqual([`tremolo${strokes}`]);

      const stem = withRef(sys.primitives, ev.id, "stem")[0] as LinePrim;
      const mark = marks[0]!;
      expect(mark.x).toBeCloseTo(stem.x1, 6);
      const { top, bottom } = inkY(mark);
      expect(top).toBeGreaterThanOrEqual(Math.min(stem.y1, stem.y2) - 1e-6);
      expect(bottom).toBeLessThanOrEqual(Math.max(stem.y1, stem.y2) + 1e-6);

      // Clear of the notehead.
      const head = (withRef(sys.primitives, ev.notes[0]!.id, "notehead") as GlyphPrim[])[0]!;
      expect(bottom).toBeLessThan(inkY(head).top);
    });
  }

  it("sits beside a stemless whole note, on the side its stem would take", () => {
    const low: NoteEvent = { ...note("E4", 1), tremolo: 2 }; // would be stem up
    const high: NoteEvent = { ...note("C5", 1), tremolo: 3 }; // would be stem down
    for (const [ev, side] of [
      [low, "above"],
      [high, "below"],
    ] as const) {
      const sys = oneMeasure([ev]);
      expect(lines(withRef(sys.primitives, ev.id, "stem"))).toHaveLength(0);
      const mark = glyphs(sys.primitives).find((g) => g.glyph === `tremolo${ev.tremolo}`)!;
      const head = (withRef(sys.primitives, ev.notes[0]!.id, "notehead") as GlyphPrim[])[0]!;
      const headBox = glyphBox(FONT, head.glyph);
      expect(mark.x).toBeCloseTo(head.x + headBox.width / 2, 6);
      if (side === "above") expect(inkY(mark).bottom).toBeLessThan(inkY(head).top);
      else expect(inkY(mark).top).toBeGreaterThan(inkY(head).bottom);
    }
  });

  it("draws nothing for a note without a tremolo", () => {
    const sys = oneMeasure([note("G4", 4), note("A4", 4), note("B4", 4), note("C5", 4)]);
    expect(glyphs(sys.primitives).filter((g) => g.glyph.startsWith("tremolo"))).toHaveLength(0);
  });
});

describe("ornaments fixture", () => {
  it("engraves every specimen", () => {
    const sys = system(run(ornaments()));
    const names = glyphs(sys.primitives).map((g) => g.glyph);
    for (const g of [
      "ornamentTrill",
      "ornamentMordent",
      "ornamentShortTrill",
      "ornamentTurn",
      "ornamentTurnInverted",
      "arpeggiatoUp",
      "arpeggiatoDown",
      "arpeggiato",
      "tremolo1",
      "tremolo2",
      "tremolo3",
    ]) {
      expect(names, g).toContain(g);
    }
    expect(withRole(sys.primitives, "ornament")).toHaveLength(7);
    // Stroke counts per event, summed: 1+2+3 (m0) + 3+1 (m1) + 2 (m2) + 3 + 2 (m3).
    const strokes = names
      .filter((n) => n.startsWith("tremolo"))
      .reduce((a, n) => a + Number(n.slice("tremolo".length)), 0);
    expect(strokes).toBe(17);
  });
});
