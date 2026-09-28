import { describe, expect, it } from "vitest";
import { dynamicBox } from "@/engraving/attachments";
import { ENGRAVING } from "@/engraving/constants";
import { STAFF_HEIGHT } from "@/engraving/geometry";
import type { LayoutResult, LinePrim, Primitive, Ref, System } from "@/engraving/layout-types";
import { LYRICS } from "@/engraving/lyrics";
import { inkBox } from "@/engraving/skyline";
import { pageMetrics, staffSlots } from "@/engraving/vertical";
import { chord, note } from "@/model";
import type { Score } from "@/model";
import { allEvents, type Event } from "@/model/traverse";
import { staffY } from "@/ui/layout-utils";
import { FIXTURES } from "../fixtures";
import { hymnVerses } from "../fixtures/hymn-verses";
import { ledgerCrowd } from "../fixtures/ledger-crowd";
import { FONT, allSystems, makeScore, run, setStaff } from "./helpers";

const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Slot index of a part/staff inside a system. */
function slotOf(sys: System, partIndex: number, staffIndex: number): number {
  return sys.staves.findIndex((s) => s.partIndex === partIndex && s.staffIndex === staffIndex);
}

/** The last slot of a part: where pedal marks are drawn. */
function bottomSlot(sys: System, partIndex: number): number {
  let found = -1;
  for (const [i, s] of sys.staves.entries()) if (s.partIndex === partIndex) found = i;
  return found;
}

/**
 * Which staff slot every model id is drawn for: events and their notes (grace
 * notes included) on their own staff, attachments and spanners on the staff they
 * declare — except pedal marks (bottom staff of the part) and tempo marks (top
 * staff), which the engraver deliberately moves.
 */
function owners(score: Score, sys: System): Map<string, number> {
  const map = new Map<string, number>();
  const visit = (ev: Event, slot: number): void => {
    map.set(ev.id, slot);
    if (ev.kind === "note") for (const n of ev.notes) map.set(n.id, slot);
    for (const g of ev.grace?.events ?? []) visit(g, slot);
  };
  for (const e of allEvents(score)) visit(e.positioned.event, slotOf(sys, e.partIndex, e.staffIndex));
  for (const a of score.attachments) {
    const slot =
      a.kind === "pedalMark"
        ? bottomSlot(sys, a.partIndex)
        : a.kind === "tempo"
          ? 0
          : slotOf(sys, a.partIndex, a.staffIndex);
    map.set(a.id, slot);
  }
  for (const s of score.spanners) {
    map.set(s.id, s.kind === "pedal" ? bottomSlot(sys, s.partIndex) : slotOf(sys, s.partIndex, s.staffIndex));
  }
  return map;
}

/** Vertical ink range of a primitive (dynamics measured from their glyphs). */
function inkY(p: Primitive): { minY: number; maxY: number } | undefined {
  if (p.type === "text" && p.style === "dynamic") {
    const box = dynamicBox(FONT, p.text, p.size);
    return { minY: p.y - box.up, maxY: p.y + box.down };
  }
  return inkBox(p, FONT);
}

function refOf(p: Primitive): Ref | undefined {
  return "ref" in p ? p.ref : undefined;
}

/** Distance between the facing lines of staff k and staff k+1. */
function gapAfter(sys: System, k: number): number {
  return sys.staves[k + 1]!.y - (sys.staves[k]!.y + STAFF_HEIGHT);
}

/** Ink range of everything in a system, in page coordinates. */
function pageInk(sys: System): { top: number; bottom: number } {
  let top = Infinity;
  let bottom = -Infinity;
  for (const p of sys.primitives) {
    const ink = p.type === "staffLines" ? { minY: p.y, maxY: p.y + p.lineCount - 1 } : inkY(p);
    if (!ink) continue;
    top = Math.min(top, ink.minY);
    bottom = Math.max(bottom, ink.maxY);
  }
  return { top: sys.y + top, bottom: sys.y + bottom };
}

/** A long piano score in which every measure crowds the space between the staves. */
function crowdedScore(measureCount: number): Score {
  const score = makeScore({ measureCount });
  for (let m = 0; m < measureCount; m++) {
    setStaff(score, m, 0, [
      chord(["B2", "D3", "G3"], 4),
      chord(["A2", "C3", "F3"], 4),
      chord(["G2", "B2", "E3"], 4),
      chord(["A2", "C3", "F3"], 4),
    ]);
    setStaff(score, m, 1, [note("D5", 4), note("E5", 4), note("F5", 4), note("E5", 4)]);
  }
  return score;
}

const cases: [string, Score, LayoutResult][] = Object.entries(FIXTURES).map(([name, make]) => {
  const score = make();
  return [name, score, run(score)];
});

// ---------------------------------------------------------------------------
// Staff slots
// ---------------------------------------------------------------------------

describe("staffSlots", () => {
  const score = makeScore();

  it("keeps the default gap when the content fits", () => {
    const slots = staffSlots(score.parts, score.settings, [
      { above: 3, below: 2 },
      { above: 2, below: 3 },
    ]);
    expect(slots[1]!.y).toBe(STAFF_HEIGHT + score.settings.grandStaffGapSp);
  });

  it("grows the gap to below(k) + above(k+1) + the clearance", () => {
    const slots = staffSlots(score.parts, score.settings, [
      { above: 0, below: 6 },
      { above: 5, below: 0 },
    ]);
    expect(slots[1]!.y).toBeCloseTo(STAFF_HEIGHT + 6 + 5 + ENGRAVING.interStaffClearanceSp, 9);
  });

  it("puts the skyline boundary in the middle of the clear space", () => {
    const slots = staffSlots(score.parts, score.settings, [
      { above: 0, below: 5 },
      { above: 1, below: 0 },
    ]);
    // gap 8: staff 0's ink ends 5 below its bottom line, staff 1's starts 1 above its top.
    const clearTop = STAFF_HEIGHT + 5;
    const clearBottom = slots[1]!.y - 1;
    expect(slots[0]!.zoneBottom).toBeCloseTo((clearTop + clearBottom) / 2, 9);
    expect(slots[1]!.zoneTop).toBe(slots[0]!.zoneBottom);
  });
});

// ---------------------------------------------------------------------------
// Every fixture
// ---------------------------------------------------------------------------

describe("content-aware staff spacing, every fixture", () => {
  for (const [name, score, result] of cases) {
    describe(name, () => {
      it("draws no notehead, ledger line or lyric of one staff inside another staff's lines", () => {
        for (const sys of allSystems(result)) {
          const own = owners(score, sys);
          for (const p of sys.primitives) {
            const role = refOf(p)?.role;
            if (role !== "notehead" && role !== "ledger" && role !== "lyric") continue;
            const k = own.get(refOf(p)!.id);
            const ink = inkY(p);
            if (k === undefined || !ink) continue;
            for (const [j, staff] of sys.staves.entries()) {
              if (j === k) continue;
              const overlaps = ink.maxY > staff.y + EPS && ink.minY < staff.y + STAFF_HEIGHT - EPS;
              expect(overlaps, `${role} of staff ${k} inside staff ${j}`).toBe(false);
            }
          }
        }
      });

      it("keeps the ink of adjacent staves at least the clearance apart when the gap grew", () => {
        for (const sys of allSystems(result)) {
          const own = owners(score, sys);
          const lowest = sys.staves.map(() => -Infinity);
          const highest = sys.staves.map(() => Infinity);
          for (const p of sys.primitives) {
            const ref = refOf(p);
            const k = ref ? own.get(ref.id) : undefined;
            const ink = inkY(p);
            if (k === undefined || k < 0 || !ink) continue;
            lowest[k] = Math.max(lowest[k]!, ink.maxY);
            highest[k] = Math.min(highest[k]!, ink.minY);
          }
          for (let k = 0; k + 1 < sys.staves.length; k++) {
            const gap = gapAfter(sys, k);
            const fallback =
              sys.staves[k + 1]!.partIndex === sys.staves[k]!.partIndex
                ? score.settings.grandStaffGapSp
                : score.settings.systemGapSp;
            expect(gap).toBeGreaterThanOrEqual(fallback - EPS);
            if (gap > fallback + EPS) {
              // A grown gap is exactly what the two staves' ink needs.
              expect(highest[k + 1]! - lowest[k]!).toBeGreaterThanOrEqual(
                ENGRAVING.interStaffClearanceSp - EPS,
              );
            }
          }
        }
      });

      it("reports StaffLayout.y exactly where the staff lines are drawn", () => {
        for (const sys of allSystems(result)) {
          const drawn = sys.primitives.filter((p) => p.type === "staffLines").map((p) => p.y);
          expect(drawn).toEqual(sys.staves.map((s) => s.y));
        }
      });

      it("runs every barline from the part's top line to its bottom line exactly", () => {
        for (const sys of allSystems(result)) {
          const barlines = sys.primitives.filter(
            (p): p is LinePrim => p.type === "line" && p.ref?.role === "barline" && p.x1 === p.x2,
          );
          expect(barlines.length).toBeGreaterThan(0);
          for (const b of barlines) {
            const part = score.parts.findIndex((_, pi) => {
              const staves = sys.staves.filter((s) => s.partIndex === pi);
              return staves[0]!.y === b.y1;
            });
            expect(part, "barline starts on a part's top line").toBeGreaterThanOrEqual(0);
            const staves = sys.staves.filter((s) => s.partIndex === part);
            expect(b.y1).toBe(staves[0]!.y);
            expect(b.y2).toBe(staves[staves.length - 1]!.y + STAFF_HEIGHT);
          }
        }
      });

      it("makes every system tall enough for its staves and its ink", () => {
        for (const sys of allSystems(result)) {
          const last = sys.staves[sys.staves.length - 1]!;
          expect(sys.height).toBeGreaterThanOrEqual(last.y + STAFF_HEIGHT);
          const ink = pageInk(sys);
          // Text ink is estimated slightly differently by the two measurements.
          expect(sys.height).toBeGreaterThanOrEqual(ink.bottom - ink.top - 0.2);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Default gaps
// ---------------------------------------------------------------------------

describe("default gap", () => {
  it.each(["minuet", "scale"])("is kept when the content of %s fits", (name) => {
    const score = FIXTURES[name]!();
    for (const sys of allSystems(run(score))) {
      expect(sys.staves[1]!.y).toBe(STAFF_HEIGHT + score.settings.grandStaffGapSp);
    }
  });

  it("is kept on the plain system of the ledger fixture and grown on the crowded one", () => {
    const score = ledgerCrowd();
    const [crowded, plain] = allSystems(run(score));
    expect(plain!.staves[1]!.y).toBe(STAFF_HEIGHT + score.settings.grandStaffGapSp);
    expect(gapAfter(crowded!, 0)).toBeGreaterThan(score.settings.grandStaffGapSp + 5);
    // ... and the grown system is correspondingly taller.
    expect(crowded!.height - plain!.height).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// Lyrics
// ---------------------------------------------------------------------------

describe("verses between the staves", () => {
  const gaps = [0, 1, 2, 3, 4].map((n) => gapAfter(allSystems(run(hymnVerses(n)))[0]!, 0));

  it("grow the gap monotonically with the verse count", () => {
    for (let n = 0; n + 1 < gaps.length; n++) expect(gaps[n + 1]!).toBeGreaterThanOrEqual(gaps[n]! - EPS);
    expect(gaps[4]!).toBeGreaterThan(gaps[1]!);
  });

  it("grow it by one verse pitch per verse once the words are what reaches furthest", () => {
    for (let n = 1; n < 4; n++) expect(gaps[n + 1]! - gaps[n]!).toBeCloseTo(LYRICS.versePitchSp, 6);
  });

  it("stay clear of the bass staff's own notes", () => {
    const score = hymnVerses(4);
    for (const sys of allSystems(run(score))) {
      const own = owners(score, sys);
      const lyricBottom = Math.max(
        ...sys.primitives
          .filter((p) => refOf(p)?.role === "lyric")
          .map((p) => inkY(p)!.maxY),
      );
      const bassTop = Math.min(
        ...sys.primitives
          .filter((p) => {
            const ref = refOf(p);
            return ref !== undefined && own.get(ref.id) === 1;
          })
          .map((p) => inkY(p)?.minY ?? Infinity),
      );
      expect(bassTop - lyricBottom).toBeGreaterThanOrEqual(ENGRAVING.interStaffClearanceSp - EPS);
    }
  });
});

// ---------------------------------------------------------------------------
// Coordinates the editor relies on
// ---------------------------------------------------------------------------

describe("editor geometry on a grown system", () => {
  it("places noteheads relative to StaffLayout.y, as the cursor code assumes", () => {
    const score = ledgerCrowd();
    const sys = allSystems(run(score))[0]!;
    const bassTop = staffY(sys, 0, 1);
    expect(bassTop).toBeGreaterThan(STAFF_HEIGHT + score.settings.grandStaffGapSp);
    // m1 of the bass starts on D5: staff step 14 above the middle line (D3).
    const d5 = score.parts[0]!.measures[1]!.staves[1]!.voices[0]!.items[0]!;
    const head = sys.primitives.find(
      (p) => p.type === "glyph" && p.ref?.role === "notehead" && d5.kind === "note" && p.ref.id === d5.notes[0]!.id,
    );
    expect(head && head.type === "glyph" ? head.y : NaN).toBeCloseTo(bassTop + 2 - 14 * 0.5, 9);
  });

  it("leaves the measure columns alone", () => {
    const score = ledgerCrowd();
    const sys = allSystems(run(score))[0]!;
    for (const m of sys.measures) {
      for (let i = 1; i < m.columns.length; i++) expect(m.columns[i]!.x).toBeGreaterThan(m.columns[i - 1]!.x);
      for (const c of m.columns) {
        expect(c.x).toBeGreaterThanOrEqual(m.x);
        expect(c.x).toBeLessThan(m.x + m.width);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

describe("page stacking with grown systems", () => {
  const score = crowdedScore(40);
  const result = run(score);
  const metrics = pageMetrics(score.settings);
  const bottomLimit = metrics.heightSp - metrics.bottom;

  it("needs more than one page, and every system grew", () => {
    expect(result.pages.length).toBeGreaterThan(1);
    for (const sys of allSystems(result)) expect(gapAfter(sys, 0)).toBeGreaterThan(score.settings.grandStaffGapSp);
  });

  it("keeps every system's ink inside the page margins", () => {
    for (const page of result.pages) {
      for (const sys of page.systems) {
        const ink = pageInk(sys);
        expect(ink.top).toBeGreaterThanOrEqual(metrics.top - 0.2);
        if (page.systems.length > 1) expect(ink.bottom).toBeLessThanOrEqual(bottomLimit + 0.2);
      }
    }
  });

  it("stacks systems a system gap apart without overlapping", () => {
    for (const page of result.pages) {
      for (let i = 1; i < page.systems.length; i++) {
        const prev = pageInk(page.systems[i - 1]!);
        const next = pageInk(page.systems[i]!);
        expect(next.top - prev.bottom).toBeGreaterThanOrEqual(score.settings.systemGapSp - 0.2);
      }
    }
  });
});
