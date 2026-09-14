import { describe, expect, it } from "vitest";
import { BRAVURA, glyphAnchor, glyphBBox, glyphChar, glyphWidth } from "@/render/smufl";
import { renderPageSvg, renderPages } from "@/render/svg";
import { FIXTURE_LAYOUT } from "./fixture-layout";

describe("smufl glyph helpers", () => {
  it("glyphChar returns the codepoint string", () => {
    expect(glyphChar(BRAVURA, "gClef")).toBe(String.fromCodePoint(0xe050));
    expect(glyphChar(BRAVURA, "noteheadBlack").codePointAt(0)).toBe(BRAVURA.glyphs["noteheadBlack"]!.cp);
  });

  it("glyphChar throws on an unknown glyph", () => {
    expect(() => glyphChar(BRAVURA, "notAGlyph")).toThrow(/Unknown SMuFL glyph/);
  });

  it("glyphBBox returns the ne/sw box", () => {
    expect(glyphBBox(BRAVURA, "noteheadBlack")).toEqual({ ne: [1.18, 0.5], sw: [0, -0.5] });
  });

  it("glyphAnchor returns a named anchor", () => {
    expect(glyphAnchor(BRAVURA, "noteheadBlack", "stemUpSE")).toEqual([1.18, 0.168]);
  });

  it("glyphAnchor throws on a missing anchor", () => {
    expect(() => glyphAnchor(BRAVURA, "noteheadBlack", "notAnAnchor")).toThrow(/has no anchor/);
  });

  it("glyphWidth prefers bbox width, falls back to adv", () => {
    expect(glyphWidth(BRAVURA, "noteheadBlack")).toBeCloseTo(1.18);
    // barlineSingle has both bbox and adv; bbox wins (0.16 either way here).
    expect(glyphWidth(BRAVURA, "barlineSingle")).toBeCloseTo(0.16);
  });
});

describe("renderPageSvg", () => {
  const opts = { font: BRAVURA, staffSpaceMm: FIXTURE_LAYOUT.staffSpaceMm };

  it("renders the fixture page deterministically", () => {
    const svg = renderPageSvg(FIXTURE_LAYOUT.pages[0]!, opts);
    expect(svg).toMatchSnapshot();
  });

  it("is deterministic across repeated renders", () => {
    const a = renderPageSvg(FIXTURE_LAYOUT.pages[0]!, opts);
    const b = renderPageSvg(FIXTURE_LAYOUT.pages[0]!, opts);
    expect(a).toBe(b);
  });

  it("sizes the page in mm from widthSp/heightSp * staffSpaceMm", () => {
    const svg = renderPageSvg(FIXTURE_LAYOUT.pages[0]!, opts);
    expect(svg).toContain(`width="${(120 * FIXTURE_LAYOUT.staffSpaceMm).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}mm"`);
    expect(svg).toContain('viewBox="0 0 120 170"');
  });

  it("supports px units", () => {
    const svg = renderPageSvg(FIXTURE_LAYOUT.pages[0]!, { ...opts, unit: "px" });
    expect(svg).toMatch(/width="[\d.]+px"/);
    expect(svg).toMatch(/height="[\d.]+px"/);
  });

  it("emits data-id/data-role only when idAttributes is set", () => {
    const without = renderPageSvg(FIXTURE_LAYOUT.pages[0]!, opts);
    expect(without).not.toContain("data-id");

    const withIds = renderPageSvg(FIXTURE_LAYOUT.pages[0]!, { ...opts, idAttributes: true });
    expect(withIds).toContain('data-id="note-1"');
    expect(withIds).toContain('data-role="notehead"');
    expect(withIds).toContain('data-id="beam-1"');
    expect(withIds).toContain('data-role="beam"');
  });

  it("translates systems by their (x, y)", () => {
    const svg = renderPageSvg(FIXTURE_LAYOUT.pages[0]!, opts);
    expect(svg).toContain('<g transform="translate(10,20)">');
  });

  it("renders dynamics purely made of p/f/m/s/z/r as Bravura glyphs", () => {
    const page = {
      ...FIXTURE_LAYOUT.pages[0]!,
      primitives: [
        ...FIXTURE_LAYOUT.pages[0]!.primitives,
        { type: "text" as const, text: "mf", x: 5, y: 5, size: 4, style: "dynamic" as const },
      ],
    };
    const svg = renderPageSvg(page, opts);
    expect(svg).toContain(glyphChar(BRAVURA, "dynamicMezzo"));
    expect(svg).toContain(glyphChar(BRAVURA, "dynamicForte"));
    expect(svg).not.toContain(">mf<");
  });

  it("renders non-glyph dynamics text as serif italic", () => {
    const page = {
      ...FIXTURE_LAYOUT.pages[0]!,
      primitives: [
        ...FIXTURE_LAYOUT.pages[0]!.primitives,
        { type: "text" as const, text: "dolce", x: 5, y: 5, size: 4, style: "dynamic" as const },
      ],
    };
    const svg = renderPageSvg(page, opts);
    expect(svg).toContain(">dolce<");
    expect(svg).toContain('font-style="italic"');
  });
});

describe("renderPages", () => {
  it("renders one string per page", () => {
    const svgs = renderPages(FIXTURE_LAYOUT, { font: BRAVURA, staffSpaceMm: FIXTURE_LAYOUT.staffSpaceMm });
    expect(svgs).toHaveLength(1);
    expect(svgs[0]).toContain("<svg");
  });
});
