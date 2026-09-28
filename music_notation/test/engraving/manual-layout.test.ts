import { describe, expect, it } from "vitest";
import { paginate, type PageMetrics, type SystemExtent } from "@/engraving/vertical";
import { planSystems, type BreakInput } from "@/engraving/breaking";
import { allSystems, makeScore, run } from "./helpers";

/**
 * Manual layout control (docs/ARCHITECTURE.md): `measuresPerSystem`/`systemsPerPage`
 * are upper bounds only — they can make a line/page *shorter* than it would
 * otherwise be, never force it past what actually fits.
 */

describe("planSystems: measuresPerSystem", () => {
  const baseInput: BreakInput = {
    measureCount: 6,
    widthMid: [10, 10, 10, 10, 10, 10],
    widthStart: [12, 10, 10, 10, 10, 10],
    availableWidth: 100, // generous: all 6 measures fit on one system by width alone
    systemBreaks: [],
    pageBreaks: [],
  };

  it("does nothing when unset: everything fits on one system", () => {
    const plans = planSystems(baseInput);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.measures).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("caps a system even though more measures would fit the width", () => {
    const plans = planSystems({ ...baseInput, measuresPerSystem: 2 });
    expect(plans.map((p) => p.measures)).toEqual([[0, 1], [2, 3], [4, 5]]);
  });

  it("never exceeds the cap even on the last, partial system", () => {
    const plans = planSystems({ ...baseInput, measureCount: 5, measuresPerSystem: 2 });
    expect(plans.map((p) => p.measures)).toEqual([[0, 1], [2, 3], [4]]);
  });

  it("a set cap larger than what fits by width still breaks by width (the cap never forces overflow)", () => {
    const plans = planSystems({ ...baseInput, availableWidth: 25, measuresPerSystem: 100 });
    // widthStart[0]=12, +10+10 = 32 > 25, so only 2 measures fit the first system regardless of the cap.
    expect(plans[0]!.measures).toEqual([0, 1]);
  });

  it("a forced system break resets the count for the next system", () => {
    const plans = planSystems({ ...baseInput, measuresPerSystem: 3, systemBreaks: [2] });
    // Forced break before measure 2 cuts the first system short; the cap then applies
    // fresh to what follows, not "2 used, 1 left".
    expect(plans.map((p) => p.measures)).toEqual([[0, 1], [2, 3, 4], [5]]);
  });
});

describe("paginate: systemsPerPage", () => {
  const metrics: PageMetrics = {
    widthSp: 200,
    heightSp: 200,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    contentWidth: 200,
    contentHeight: 200, // generous: every system fits vertically on one page
  };
  const settings = { systemGapSp: 2 } as Parameters<typeof paginate>[2];
  const extents: SystemExtent[] = Array.from({ length: 6 }, () => ({ above: 1, below: 1, startsPage: false }));

  it("does nothing when unset: everything fits on one page", () => {
    const placements = paginate(extents, metrics, settings, 0);
    expect(new Set(placements.map((p) => p.pageIndex)).size).toBe(1);
  });

  it("caps a page even though more systems would fit vertically", () => {
    const placements = paginate(extents, metrics, settings, 0, 2);
    expect(placements.map((p) => p.pageIndex)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it("a cap larger than what fits vertically still breaks by height", () => {
    const tallExtents: SystemExtent[] = Array.from({ length: 4 }, () => ({ above: 60, below: 60, startsPage: false }));
    const placements = paginate(tallExtents, metrics, settings, 0, 100);
    // Each system is 120sp tall in a 200sp page: only one fits per page regardless of the cap.
    expect(placements.map((p) => p.pageIndex)).toEqual([0, 1, 2, 3]);
  });

  it("a forced page break resets the count for the next page", () => {
    const withForced = extents.map((e, i) => (i === 3 ? { ...e, startsPage: true } : e));
    const placements = paginate(withForced, metrics, settings, 0, 3);
    // Forced break before system 3 cuts page 0 short at 3 systems; the cap then
    // applies fresh to what follows (systems 3,4,5 — only 3, so all stay together).
    expect(placements.map((p) => p.pageIndex)).toEqual([0, 0, 0, 1, 1, 1]);
  });
});

describe("engrave(): measuresPerSystem end to end", () => {
  it("produces more, shorter systems than the automatic default for the same score", () => {
    const score = makeScore({ measureCount: 12 });
    const auto = allSystems(run(score));
    expect(auto.length).toBeGreaterThan(0);
    const baselineFirstSystemSize = auto[0]!.measures.length;
    expect(baselineFirstSystemSize).toBeGreaterThan(1); // sanity: these narrow (rest-only) measures pack several per line

    score.layout.measuresPerSystem = 1;
    const capped = allSystems(run(score));

    expect(capped).toHaveLength(12); // one system per measure
    for (const sys of capped) expect(sys.measures).toHaveLength(1);
  });

  it("does not change anything when the cap is larger than what already fits", () => {
    const score = makeScore({ measureCount: 12 });
    const auto = allSystems(run(score));

    score.layout.measuresPerSystem = 1000;
    const capped = allSystems(run(score));

    expect(capped.map((s) => s.measures)).toEqual(auto.map((s) => s.measures));
  });
});

describe("engrave(): systemsPerPage end to end", () => {
  it("produces more, shorter pages than the automatic default for the same score", () => {
    const score = makeScore({ measureCount: 30 });
    score.layout.measuresPerSystem = 2; // force many short systems so several fit per page by height
    const auto = run(score);
    const baselineSystemsOnPage0 = auto.pages[0]!.systems.length;
    expect(baselineSystemsOnPage0).toBeGreaterThan(1); // sanity: more than one system fits a page by default

    score.layout.systemsPerPage = 1;
    const capped = run(score);

    for (const page of capped.pages) expect(page.systems).toHaveLength(1);
    expect(capped.pages.length).toBeGreaterThan(auto.pages.length);
  });
});
