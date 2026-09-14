import { describe, expect, it } from "vitest";
import { glyphBox, pathBounds, STAFF_HEIGHT } from "@/engraving/geometry";
import type { LinePrim, PathPrim, Primitive } from "@/engraving/layout-types";
import { frac, ZERO } from "@/model/duration";
import { note } from "@/model/factory";
import { newId } from "@/model/ids";
import type { NoteEvent, Score, Spanner } from "@/model/score";
import {
  allSystems,
  FONT,
  glyphs,
  lines,
  makeScore,
  paths,
  run,
  setStaff,
  staffTop,
  system,
  texts,
} from "./helpers";

/** `Omit` over a union keeps only the common keys, so distribute it by hand. */
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

function span(score: Score, s: WithoutId<Spanner>): Spanner {
  const full = { id: newId(), ...s } as Spanner;
  score.spanners.push(full);
  return full;
}

const at = (ev: NoteEvent) => ({ kind: "event" as const, eventId: ev.id });

function withRole(prims: Primitive[], role: string): Primitive[] {
  return prims.filter((p) => "ref" in p && p.ref?.role === role);
}

function slurs(prims: Primitive[]): PathPrim[] {
  return paths(prims).filter((p) => p.ref?.role === "slur");
}

function hairpins(prims: Primitive[]): LinePrim[] {
  return lines(prims).filter((p) => p.ref?.role === "hairpin");
}

/**
 * y of the middle of a slur's outer edge. The path is `M p0 C c1 c2 p3 L ...`,
 * so the first eight numbers are the outer cubic; evaluate it at t = 0.5.
 */
function arcMidY(d: string): number {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const [, y0, , y1, , y2, , y3] = n;
  return 0.125 * y0! + 0.375 * y1! + 0.375 * y2! + 0.125 * y3!;
}

/** Four quarters on the treble staff of measure `m`, returned for anchoring. */
function fill(score: Score, m: number, pitches: string[]): NoteEvent[] {
  const events = pitches.map((p) => note(p, 4));
  setStaff(score, m, 0, events);
  return events;
}

describe("slurs", () => {
  it("arcs above the noteheads when the stems point down", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = fill(score, 0, ["C5", "D5", "E5", "F5"]);
    span(score, { partIndex: 0, staffIndex: 0, kind: "slur", start: at(ev[0]!), end: at(ev[3]!) });
    const sys = system(run(score));
    const [slur] = slurs(sys.primitives);
    expect(slur).toBeDefined();
    const heads = glyphs(sys.primitives, "noteheadBlack");
    const highest = Math.min(...heads.map((h) => h.y));
    expect(arcMidY(slur!.d)).toBeLessThan(highest);
    expect(pathBounds(slur!.d)!.minY).toBeLessThan(highest);
    expect(slur!.fill).toBe(true);
  });

  it("arcs below the noteheads when the stems point up", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = fill(score, 0, ["D4", "E4", "F4", "G4"]);
    span(score, { partIndex: 0, staffIndex: 0, kind: "slur", start: at(ev[0]!), end: at(ev[3]!) });
    const sys = system(run(score));
    const slur = slurs(sys.primitives)[0]!;
    const heads = glyphs(sys.primitives, "noteheadBlack");
    const lowest = Math.max(...heads.map((h) => h.y));
    expect(arcMidY(slur.d)).toBeGreaterThan(lowest);
    expect(pathBounds(slur.d)!.maxY).toBeGreaterThan(lowest);
  });

  it("clears a high note under its arc", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = fill(score, 0, ["C5", "C6", "C6", "C5"]);
    span(score, { partIndex: 0, staffIndex: 0, kind: "slur", start: at(ev[0]!), end: at(ev[3]!) });
    const sys = system(run(score));
    const slur = slurs(sys.primitives)[0]!;
    const heads = glyphs(sys.primitives, "noteheadBlack");
    const box = glyphBox(FONT, "noteheadBlack");
    const highestInk = Math.min(...heads.map((h) => h.y - box.up));
    // The arc passes above the top of the highest notehead it spans.
    expect(arcMidY(slur.d)).toBeLessThan(highestInk);
  });

  it("splits into one piece per system at a break", () => {
    const score = makeScore({ measureCount: 4 });
    const a = fill(score, 0, ["C5", "D5", "E5", "F5"]);
    fill(score, 1, ["C5", "D5", "E5", "F5"]);
    const c = fill(score, 2, ["C5", "D5", "E5", "F5"]);
    fill(score, 3, ["C5", "D5", "E5", "F5"]);
    score.layout.systemBreaks = [2];
    span(score, { partIndex: 0, staffIndex: 0, kind: "slur", start: at(a[3]!), end: at(c[0]!) });
    const systems = allSystems(run(score));
    expect(systems).toHaveLength(2);
    const first = slurs(systems[0]!.primitives);
    const second = slurs(systems[1]!.primitives);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    // The first piece runs to the right edge, the second starts after the prefix.
    const b1 = pathBounds(first[0]!.d)!;
    const b2 = pathBounds(second[0]!.d)!;
    expect(b1.maxX).toBeGreaterThan(systems[0]!.width - 2);
    expect(b2.minX).toBeGreaterThan(0);
    expect(b2.minX).toBeLessThan(b2.maxX);
  });
});

describe("hairpins", () => {
  it("draws two lines opening to the right for a crescendo", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = fill(score, 0, ["C5", "D5", "E5", "F5"]);
    span(score, {
      partIndex: 0,
      staffIndex: 0,
      kind: "hairpin",
      shape: "cresc",
      start: at(ev[0]!),
      end: at(ev[3]!),
    });
    const sys = system(run(score));
    const hp = hairpins(sys.primitives);
    expect(hp).toHaveLength(2);
    // Closed at the left, 1.2 sp open at the right.
    expect(hp[0]!.y1).toBeCloseTo(hp[1]!.y1, 5);
    expect(Math.abs(hp[0]!.y2 - hp[1]!.y2)).toBeCloseTo(1.2, 5);
    // On the dynamics lane, below the staff.
    for (const l of hp) expect(l.y1).toBeGreaterThan(staffTop(sys, 0) + STAFF_HEIGHT);
  });

  it("opens to the left for a diminuendo", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = fill(score, 0, ["C5", "D5", "E5", "F5"]);
    span(score, {
      partIndex: 0,
      staffIndex: 0,
      kind: "hairpin",
      shape: "dim",
      start: at(ev[0]!),
      end: at(ev[3]!),
    });
    const sys = system(run(score));
    const hp = hairpins(sys.primitives);
    expect(Math.abs(hp[0]!.y1 - hp[1]!.y1)).toBeCloseTo(1.2, 5);
    expect(hp[0]!.y2).toBeCloseTo(hp[1]!.y2, 5);
  });

  it("stops short of a dynamic at its end", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = fill(score, 0, ["C5", "D5", "E5", "F5"]);
    span(score, {
      partIndex: 0,
      staffIndex: 0,
      kind: "hairpin",
      shape: "cresc",
      start: at(ev[0]!),
      end: at(ev[3]!),
    });
    score.attachments.push({
      id: newId(),
      partIndex: 0,
      staffIndex: 0,
      kind: "dynamic",
      text: "ff",
      anchor: at(ev[3]!),
    });
    const sys = system(run(score));
    const dyn = texts(sys.primitives).find((t) => t.style === "dynamic")!;
    const end = Math.max(...hairpins(sys.primitives).map((l) => l.x2));
    expect(end).toBeLessThanOrEqual(dyn.x - 0.5 + 1e-9);
    expect(end).toBeGreaterThan(dyn.x - 1.5);
  });
});

describe("pedal", () => {
  it("draws Ped. and * below the bottom staff for the text style", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = [note("C3", 4), note("D3", 4), note("E3", 4), note("F3", 4)];
    setStaff(score, 0, 1, ev);
    span(score, {
      partIndex: 0,
      staffIndex: 1,
      kind: "pedal",
      style: "text",
      start: at(ev[0]!),
      end: at(ev[3]!),
    });
    const sys = system(run(score));
    const ped = glyphs(sys.primitives, "keyboardPedalPed")[0]!;
    const up = glyphs(sys.primitives, "keyboardPedalUp")[0]!;
    const bottom = staffTop(sys, 1) + STAFF_HEIGHT;
    expect(ped.y - glyphBox(FONT, ped.glyph).up).toBeGreaterThan(bottom);
    expect(up.y - glyphBox(FONT, up.glyph).up).toBeGreaterThan(bottom);
    expect(up.x).toBeGreaterThan(ped.x);
  });

  it("draws a bracket with upward hooks below the bottom staff for the line style", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = [note("C3", 4), note("D3", 4), note("E3", 4), note("F3", 4)];
    setStaff(score, 0, 1, ev);
    span(score, {
      partIndex: 0,
      staffIndex: 1,
      kind: "pedal",
      style: "line",
      start: at(ev[0]!),
      end: at(ev[3]!),
    });
    const sys = system(run(score));
    const pedal = lines(sys.primitives).filter((l) => l.ref?.role === "pedal");
    expect(pedal).toHaveLength(3);
    const bottom = staffTop(sys, 1) + STAFF_HEIGHT;
    const horizontal = pedal.find((l) => l.y1 === l.y2)!;
    expect(horizontal.y1).toBeGreaterThan(bottom);
    const hooks = pedal.filter((l) => l.x1 === l.x2);
    expect(hooks).toHaveLength(2);
    // The hooks point up, back towards the staff.
    for (const h of hooks) expect(h.y2).toBeLessThan(h.y1);
    expect(horizontal.thickness).toBeCloseTo(FONT.engravingDefaults.pedalLineThickness, 5);
  });

  it("is drawn on both systems when it crosses a break", () => {
    const score = makeScore({ measureCount: 3 });
    const a = [note("C3", 4), note("D3", 4), note("E3", 4), note("F3", 4)];
    const c = [note("C3", 4), note("D3", 4), note("E3", 4), note("F3", 4)];
    setStaff(score, 0, 1, a);
    setStaff(score, 2, 1, c);
    score.layout.systemBreaks = [2];
    span(score, {
      partIndex: 0,
      staffIndex: 1,
      kind: "pedal",
      style: "line",
      start: at(a[0]!),
      end: at(c[3]!),
    });
    const systems = allSystems(run(score));
    expect(systems).toHaveLength(2);
    for (const sys of systems) {
      expect(withRole(sys.primitives, "pedal").length).toBeGreaterThan(0);
    }
  });
});

describe("ottava", () => {
  it("draws the 8va glyph, a dashed line and a hook above the staff", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = fill(score, 0, ["C5", "D5", "E5", "F5"]);
    span(score, {
      partIndex: 0,
      staffIndex: 0,
      kind: "ottava",
      shift: 8,
      start: at(ev[0]!),
      end: at(ev[3]!),
    });
    const sys = system(run(score));
    const glyph = glyphs(sys.primitives, "ottavaAlta")[0]!;
    expect(glyph.ref?.role).toBe("ottava");
    expect(glyph.y - glyphBox(FONT, "ottavaAlta").up).toBeLessThan(staffTop(sys, 0));
    const ott = lines(sys.primitives).filter((l) => l.ref?.role === "ottava");
    const dashed = ott.find((l) => l.dash !== undefined)!;
    expect(dashed.y1).toBeCloseTo(dashed.y2, 5);
    expect(dashed.x2).toBeGreaterThan(dashed.x1);
    expect(dashed.y1).toBeLessThan(staffTop(sys, 0));
    // The hook turns back down towards the staff at the very end.
    const hook = ott.find((l) => l.x1 === l.x2)!;
    expect(hook.y2).toBeGreaterThan(hook.y1);
    expect(hook.x1).toBeCloseTo(dashed.x2, 5);
  });

  it("draws 8vb below the staff", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = fill(score, 0, ["C5", "D5", "E5", "F5"]);
    span(score, {
      partIndex: 0,
      staffIndex: 0,
      kind: "ottava",
      shift: -8,
      start: at(ev[0]!),
      end: at(ev[3]!),
    });
    const sys = system(run(score));
    const glyph = glyphs(sys.primitives, "ottavaBassa")[0]!;
    expect(glyph.y).toBeGreaterThan(staffTop(sys, 0) + STAFF_HEIGHT);
    const hook = lines(sys.primitives).find((l) => l.ref?.role === "ottava" && l.x1 === l.x2)!;
    expect(hook.y2).toBeLessThan(hook.y1);
  });
});

describe("trill lines and glissandi", () => {
  it("repeats the trill wiggle after the trill glyph", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = fill(score, 0, ["C5", "D5", "E5", "F5"]);
    span(score, {
      partIndex: 0,
      staffIndex: 0,
      kind: "trillLine",
      start: at(ev[0]!),
      end: at(ev[3]!),
    });
    const sys = system(run(score));
    expect(glyphs(sys.primitives, "ornamentTrill")).toHaveLength(1);
    const wiggles = glyphs(sys.primitives, "wiggleTrill");
    expect(wiggles.length).toBeGreaterThan(2);
    for (const w of wiggles) expect(w.y).toBeLessThan(staffTop(sys, 0));
    // Evenly spaced by the glyph's repeatOffset.
    const step = wiggles[1]!.x - wiggles[0]!.x;
    for (let i = 2; i < wiggles.length; i++) {
      expect(wiggles[i]!.x - wiggles[i - 1]!.x).toBeCloseTo(step, 5);
    }
  });

  it("joins two noteheads with a straight glissando line", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = fill(score, 0, ["C5", "D5", "E5", "G5"]);
    span(score, {
      partIndex: 0,
      staffIndex: 0,
      kind: "glissando",
      start: at(ev[0]!),
      end: at(ev[3]!),
    });
    const sys = system(run(score));
    const gliss = lines(sys.primitives).filter((l) => l.ref?.role === "other");
    expect(gliss).toHaveLength(1);
    const heads = glyphs(sys.primitives, "noteheadBlack");
    expect(gliss[0]!.y1).toBeCloseTo(heads[0]!.y, 5);
    expect(gliss[0]!.y2).toBeCloseTo(heads[3]!.y, 5);
    expect(gliss[0]!.x2).toBeGreaterThan(gliss[0]!.x1);
  });
});

describe("measure anchors", () => {
  it("resolves a measure anchor to the column at that offset", () => {
    const score = makeScore({ measureCount: 1 });
    const ev = fill(score, 0, ["C5", "D5", "E5", "F5"]);
    span(score, {
      partIndex: 0,
      staffIndex: 0,
      kind: "hairpin",
      shape: "cresc",
      start: { kind: "measure", measureIndex: 0, offset: ZERO },
      end: { kind: "measure", measureIndex: 0, offset: frac(1, 2) },
    });
    const sys = system(run(score));
    const hp = hairpins(sys.primitives);
    const columns = sys.measures[0]!.columns;
    expect(hp[0]!.x1).toBeCloseTo(columns[0]!.x, 5);
    expect(hp[0]!.x2).toBeCloseTo(columns[2]!.x, 5);
    expect(ev).toHaveLength(4);
  });
});
