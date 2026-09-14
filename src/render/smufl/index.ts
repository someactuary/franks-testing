/**
 * Small helpers over `SmuflFontData` for reading glyph metrics.
 *
 * All coordinates coming out of the generated font metadata are in staff
 * spaces (sp) with y UP (per SMuFL convention). Callers that combine these
 * values with layout coordinates (y DOWN) must flip y themselves — see
 * docs/ARCHITECTURE.md invariant 5. These helpers just expose the raw data.
 */
import type { GlyphData, SmuflFontData, Vec2 } from "./types";

export { BRAVURA } from "./generated/bravura";

/** Look up a glyph by SMuFL name, throwing if it isn't in the font. */
export function glyphData(font: SmuflFontData, name: string): GlyphData {
  const g = font.glyphs[name];
  if (!g) throw new Error(`Unknown SMuFL glyph: "${name}"`);
  return g;
}

/** The literal string containing the glyph's codepoint (for use in <text>/SVG). */
export function glyphChar(font: SmuflFontData, name: string): string {
  const g = glyphData(font, name);
  return String.fromCodePoint(g.cp);
}

/** Bounding box relative to the glyph origin, y UP, in staff spaces. */
export function glyphBBox(font: SmuflFontData, name: string): { ne: Vec2; sw: Vec2 } {
  const g = glyphData(font, name);
  if (!g.bbox) throw new Error(`Glyph "${name}" has no bbox in ${font.fontName}`);
  return g.bbox;
}

/** A named SMuFL anchor point (e.g. "stemUpSE"), y UP, in staff spaces. */
export function glyphAnchor(font: SmuflFontData, name: string, anchor: string): Vec2 {
  const g = glyphData(font, name);
  const a = g.anchors?.[anchor];
  if (!a) throw new Error(`Glyph "${name}" has no anchor "${anchor}" in ${font.fontName}`);
  return a;
}

/** Glyph width in staff spaces: bbox width if available, else advance width. */
export function glyphWidth(font: SmuflFontData, name: string): number {
  const g = glyphData(font, name);
  if (g.bbox) return g.bbox.ne[0] - g.bbox.sw[0];
  if (g.adv !== undefined) return g.adv;
  throw new Error(`Glyph "${name}" has neither bbox nor adv in ${font.fontName}`);
}
