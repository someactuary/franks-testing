import { describe, expect, it } from "vitest";
import { idealColumnWidth } from "@/engraving/spacing";
import { ENGRAVING } from "@/engraving/constants";
import { frac } from "@/model/duration";
import { chord, note, rest } from "@/model/factory";
import { allSystems, glyphs, makeScore, run, setStaff, system, texts, withRef, withRole } from "./helpers";

function fillWithQuarters(score: ReturnType<typeof makeScore>, pitches = ["C5", "D5", "E5", "F5"]) {
  for (let m = 0; m < score.measures.length; m++) {
    setStaff(
      score,
      m,
      0,
      pitches.map((p) => note(p, 4)),
    );
    setStaff(score, m, 1, [note("C3", 2), note("G2", 2)]);
  }
}

describe("duration-proportional column widths", () => {
  it("grows logarithmically with duration", () => {
    const quarter = idealColumnWidth(frac(1, 4));
    expect(quarter).toBeCloseTo(ENGRAVING.quarterColumnSp, 6);
    expect(idealColumnWidth(frac(1, 2))).toBeCloseTo(quarter + ENGRAVING.logStepSp, 6);
    expect(idealColumnWidth(frac(1, 8))).toBeCloseTo(quarter - ENGRAVING.logStepSp, 6);
    expect(idealColumnWidth(frac(1, 1))).toBeCloseTo(quarter + 2 * ENGRAVING.logStepSp, 6);
  });

  it("never goes below the floor", () => {
    expect(idealColumnWidth(frac(1, 128))).toBeCloseTo(ENGRAVING.minIdealColumnSp, 6);
  });

  it("gives a half note more room than a quarter in the same measure", () => {
    const score = makeScore({ measureCount: 1 });
    const half = note("C5", 2);
    const q1 = note("D5", 4);
    const q2 = note("E5", 4);
    setStaff(score, 0, 0, [half, q1, q2]);
    const prims = system(run(score)).primitives;
    const x = (id: string) => glyphs(withRef(prims, id, "notehead"))[0]!.x;
    expect(x(q1.notes[0]!.id) - x(half.notes[0]!.id)).toBeGreaterThan(
      x(q2.notes[0]!.id) - x(q1.notes[0]!.id),
    );
  });

  it("never packs columns tighter than the glyphs allow", () => {
    const score = makeScore({ measureCount: 1 });
    const a = chord(["C#5", "E5"], 16);
    const b = chord(["D#5", "F5"], 16);
    setStaff(score, 0, 0, [a, b, rest(8), rest(4), rest(2)]);
    const prims = system(run(score)).primitives;
    const headA = glyphs(withRef(prims, a.notes[0]!.id, "notehead"))[0]!;
    const accB = glyphs(withRef(prims, b.notes[0]!.id, "accidental"))[0]!;
    // B's accidental must clear A's noteheads.
    expect(accB.x).toBeGreaterThan(headA.x + 1.18);
  });
});

describe("onset alignment across staves", () => {
  it("puts simultaneous notes on both staves at the same x", () => {
    const score = makeScore({ measureCount: 1 });
    const top = [note("C5", 4), note("D5", 4), note("E5", 4), note("F5", 4)];
    const bottom = [note("C3", 4), note("D3", 4), note("E3", 4), note("F3", 4)];
    setStaff(score, 0, 0, top);
    setStaff(score, 0, 1, bottom);
    const prims = system(run(score)).primitives;
    for (let i = 0; i < 4; i++) {
      const a = glyphs(withRef(prims, top[i]!.notes[0]!.id, "notehead"))[0]!;
      const b = glyphs(withRef(prims, bottom[i]!.notes[0]!.id, "notehead"))[0]!;
      expect(a.x).toBeCloseTo(b.x, 6);
    }
  });

  it("creates a column for every distinct onset across staves", () => {
    const score = makeScore({ measureCount: 1 });
    const top = [note("C5", 2), note("E5", 2)];
    const bottom = [note("C3", 4), note("D3", 4), note("E3", 4), note("F3", 4)];
    setStaff(score, 0, 0, top);
    setStaff(score, 0, 1, bottom);
    const prims = system(run(score)).primitives;
    const xs = bottom.map((e) => glyphs(withRef(prims, e.notes[0]!.id, "notehead"))[0]!.x);
    const topXs = top.map((e) => glyphs(withRef(prims, e.notes[0]!.id, "notehead"))[0]!.x);
    expect(topXs[0]).toBeCloseTo(xs[0]!, 6);
    expect(topXs[1]).toBeCloseTo(xs[2]!, 6);
    // Strictly increasing.
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
  });
});

describe("justification", () => {
  it("makes a system's measures sum exactly to the system width", () => {
    const score = makeScore({ measureCount: 30 });
    fillWithQuarters(score);
    const systems = allSystems(run(score));
    expect(systems.length).toBeGreaterThan(1);
    for (const sys of systems.slice(0, -1)) {
      const sum = sys.measures.reduce((a, m) => a + m.width, 0);
      expect(sum).toBeCloseTo(sys.width, 6);
    }
  });

  it("lays measures out end to end with no gaps", () => {
    const score = makeScore({ measureCount: 30 });
    fillWithQuarters(score);
    for (const sys of allSystems(run(score))) {
      let x = 0;
      for (const m of sys.measures) {
        expect(m.x).toBeCloseTo(x, 6);
        x += m.width;
      }
    }
  });

  it("stretches full systems to the available width", () => {
    const score = makeScore({ measureCount: 30 });
    fillWithQuarters(score);
    const systems = allSystems(run(score));
    const widths = systems.slice(0, -1).map((s) => s.width);
    for (const w of widths) expect(w).toBeCloseTo(widths[0]!, 6);
  });

  it("leaves a nearly empty last system unstretched", () => {
    const score = makeScore({ measureCount: 1 });
    setStaff(score, 0, 0, [note("C5", 4), note("D5", 4), note("E5", 4), note("F5", 4)]);
    const sys = system(run(score));
    expect(sys.width).toBeLessThan(40);
  });
});

describe("line and page breaking", () => {
  it("breaks a long score onto several systems and pages", () => {
    const score = makeScore({ measureCount: 80 });
    fillWithQuarters(score);
    const result = run(score);
    expect(result.pages.length).toBeGreaterThan(1);
    expect(allSystems(result).length).toBeGreaterThan(4);
    // Every measure appears exactly once, in order.
    const seen = allSystems(result).flatMap((s) => s.measures.map((m) => m.measureIndex));
    expect(seen).toEqual([...Array(80).keys()]);
  });

  it("keeps systems inside the page's bottom margin", () => {
    const score = makeScore({ measureCount: 80 });
    fillWithQuarters(score);
    const result = run(score);
    const settings = score.settings;
    const bottomLimit = (settings.page.heightMm - settings.page.marginMm.bottom) / settings.staffSpaceMm;
    for (const page of result.pages) {
      for (const sys of page.systems) expect(sys.y + sys.height).toBeLessThanOrEqual(bottomLimit + 1e-6);
    }
  });

  it("honours a forced system break", () => {
    const score = makeScore({ measureCount: 8 });
    fillWithQuarters(score);
    score.layout.systemBreaks = [2, 5];
    const systems = allSystems(run(score));
    expect(systems.map((s) => s.measures[0]!.measureIndex)).toEqual([0, 2, 5]);
  });

  it("honours a forced page break", () => {
    const score = makeScore({ measureCount: 8 });
    fillWithQuarters(score);
    score.layout.pageBreaks = [4];
    const result = run(score);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[1]!.systems[0]!.measures[0]!.measureIndex).toBe(4);
  });

  it("puts at least one measure on a system even when it is too wide", () => {
    const score = makeScore({ measureCount: 2, timeSig: { numerator: 16, denominator: 16 } });
    for (let m = 0; m < 2; m++) {
      setStaff(
        score,
        m,
        0,
        Array.from({ length: 16 }, (_, i) => note(["C5", "D5", "E5", "F5"][i % 4]!, 16)),
      );
    }
    const systems = allSystems(run(score));
    for (const sys of systems) expect(sys.measures.length).toBeGreaterThanOrEqual(1);
  });
});

describe("page furniture", () => {
  it("puts the title and composer on page 1 only", () => {
    const score = makeScore({ measureCount: 80, title: "Sonatina", composer: "F. Chang" });
    fillWithQuarters(score);
    const result = run(score);
    const first = texts(result.pages[0]!.primitives);
    expect(first.find((t) => t.style === "title")?.text).toBe("Sonatina");
    expect(first.find((t) => t.style === "composer")?.text).toBe("F. Chang");
    for (const page of result.pages.slice(1)) expect(texts(page.primitives)).toHaveLength(0);
  });

  it("centres the title and right-aligns the composer", () => {
    const score = makeScore({ measureCount: 2, title: "Sonatina", composer: "F. Chang" });
    const page = run(score).pages[0]!;
    const title = texts(page.primitives).find((t) => t.style === "title")!;
    const composer = texts(page.primitives).find((t) => t.style === "composer")!;
    expect(title.anchor).toBe("middle");
    expect(title.x).toBeCloseTo(page.widthSp / 2, 6);
    expect(composer.anchor).toBe("end");
  });

  it("reports the page size in staff spaces", () => {
    const score = makeScore({ measureCount: 1 });
    const result = run(score);
    expect(result.staffSpaceMm).toBe(score.settings.staffSpaceMm);
    expect(result.pages[0]!.widthSp).toBeCloseTo(210 / 1.75, 6);
    expect(result.pages[0]!.heightSp).toBeCloseTo(297 / 1.75, 6);
  });
});

describe("measure numbers", () => {
  it("numbers the first measure of every system except the first", () => {
    const score = makeScore({ measureCount: 30 });
    fillWithQuarters(score);
    const systems = allSystems(run(score));
    expect(systems.length).toBeGreaterThan(1);
    expect(texts(withRole(systems[0]!.primitives, "measure"))).toHaveLength(0);
    for (const sys of systems.slice(1)) {
      const nums = texts(withRole(sys.primitives, "measure"));
      expect(nums).toHaveLength(1);
      expect(nums[0]!.style).toBe("measureNumber");
      expect(Number(nums[0]!.text)).toBe(sys.measures[0]!.measureIndex + 1);
      expect(nums[0]!.y).toBeLessThan(0); // above the top staff line
    }
  });

  it("honours a measure number override", () => {
    const score = makeScore({ measureCount: 8 });
    fillWithQuarters(score);
    score.measures[0]!.numberOverride = 0;
    score.layout.systemBreaks = [4];
    const systems = allSystems(run(score));
    expect(texts(withRole(systems[1]!.primitives, "measure"))[0]!.text).toBe("4");
  });
});

describe("determinism and purity", () => {
  it("produces identical output for identical input", () => {
    const score = makeScore({ measureCount: 6, title: "T" });
    fillWithQuarters(score);
    expect(JSON.stringify(run(score))).toBe(JSON.stringify(run(score)));
  });

  it("does not mutate the score", () => {
    const score = makeScore({ measureCount: 6 });
    fillWithQuarters(score);
    const before = JSON.stringify(score);
    run(score);
    expect(JSON.stringify(score)).toBe(before);
  });
});
