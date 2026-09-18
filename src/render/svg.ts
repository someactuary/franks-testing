/**
 * LayoutResult -> SVG. Pure: no DOM, no globals (see docs/ARCHITECTURE.md invariant 4).
 *
 * Coordinate system: the SVG viewBox is set directly in staff-space (sp) units
 * (`0 0 page.widthSp page.heightSp`), matching the sp coordinates that fill every
 * Primitive and System. Physical page size (mm or px) is carried only by the
 * `width`/`height` attributes, which the browser/print engine uses to scale the
 * viewBox to a physical size — 1 viewBox unit = 1 sp = `staffSpaceMm` mm.
 *
 * Glyph sizing: SMuFL fonts are designed so that font-size == 4 staff spaces
 * makes 1 em == 4 sp (i.e. the font's em square equals a 5-line staff's height).
 * Since our coordinate system already treats 1 user unit == 1 sp, setting
 * `font-size="4"` on a Bravura <text> draws the glyph at its natural sp size.
 * Each glyph is wrapped in its own `<g transform="translate(x,y) scale(s)">` so
 * that positioning (x,y, in sp) and the primitive's own `scale` (grace/cue notes)
 * are handled once, uniformly, by the transform — the nested <text> always uses
 * the fixed font-size of 4.
 */
import type {
  GlyphPrim,
  LayoutResult,
  LinePrim,
  Page,
  PathPrim,
  PolygonPrim,
  Primitive,
  Ref,
  StaffLinesPrim,
  TextPrim,
} from "@/engraving/layout-types";
import type { SmuflFontData } from "./smufl/types";
import { glyphChar } from "./smufl";

export interface RenderOptions {
  font: SmuflFontData;
  /** Staff space in mm; used to size the physical page (width/height attrs). */
  staffSpaceMm: number;
  /** Emit data-id/data-role attributes from each primitive's `ref`. Default false. */
  idAttributes?: boolean;
  /** Physical unit for the SVG width/height attributes. Default "mm". */
  unit?: "mm" | "px";
}

const PX_PER_MM = 96 / 25.4;

/** SMuFL: 1 em == 4 staff spaces. See module doc comment. */
const GLYPH_FONT_SIZE_SP = 4;

/** Fixed-precision, trimmed number formatting for deterministic SVG output. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const v = Object.is(n, -0) ? 0 : n;
  let s = v.toFixed(3);
  if (s.includes(".")) {
    s = s.replace(/0+$/, "").replace(/\.$/, "");
  }
  if (s === "-0") s = "0";
  return s;
}

function fmtPoints(points: [number, number][]): string {
  return points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function refAttrs(ref: Ref | undefined, idAttributes: boolean | undefined): string {
  if (!idAttributes || !ref) return "";
  return ` data-id="${esc(ref.id)}" data-role="${esc(ref.role)}"`;
}

function renderGlyph(p: GlyphPrim, opts: RenderOptions): string {
  const char = glyphChar(opts.font, p.glyph);
  const scale = p.scale ?? 1;
  const transform =
    scale === 1
      ? `translate(${fmt(p.x)},${fmt(p.y)})`
      : `translate(${fmt(p.x)},${fmt(p.y)}) scale(${fmt(scale)})`;
  return (
    `<g transform="${transform}"${refAttrs(p.ref, opts.idAttributes)}>` +
    `<text x="0" y="0" font-family="Bravura" font-size="${GLYPH_FONT_SIZE_SP}">${esc(char)}</text>` +
    `</g>`
  );
}

function renderLine(p: LinePrim, opts: RenderOptions): string {
  const dash = p.dash && p.dash.length > 0 ? ` stroke-dasharray="${p.dash.map(fmt).join(",")}"` : "";
  return (
    `<line x1="${fmt(p.x1)}" y1="${fmt(p.y1)}" x2="${fmt(p.x2)}" y2="${fmt(p.y2)}" ` +
    `stroke="#000" stroke-width="${fmt(p.thickness)}"${dash}${refAttrs(p.ref, opts.idAttributes)} />`
  );
}

function renderPolygon(p: PolygonPrim, opts: RenderOptions): string {
  return `<polygon points="${fmtPoints(p.points)}" fill="#000"${refAttrs(p.ref, opts.idAttributes)} />`;
}

function renderPath(p: PathPrim, opts: RenderOptions): string {
  const fillAttr = p.fill ? ` fill="#000"` : ` fill="none"`;
  const strokeAttr = p.stroke !== undefined ? ` stroke="#000" stroke-width="${fmt(p.stroke)}"` : "";
  return `<path d="${esc(p.d)}"${fillAttr}${strokeAttr}${refAttrs(p.ref, opts.idAttributes)} />`;
}

function renderStaffLines(p: StaffLinesPrim): string {
  const lines: string[] = [];
  for (let i = 0; i < p.lineCount; i++) {
    const y = p.y + i;
    lines.push(
      `<line x1="${fmt(p.x)}" y1="${fmt(y)}" x2="${fmt(p.x + p.width)}" y2="${fmt(y)}" ` +
        `stroke="#000" stroke-width="${fmt(p.thickness)}" />`,
    );
  }
  return lines.join("");
}

interface TextStyleSpec {
  family: string;
  weight?: "bold";
  italic?: boolean;
}

const TEXT_STYLES: Record<TextPrim["style"], TextStyleSpec> = {
  title: { family: "serif", weight: "bold" },
  subtitle: { family: "serif" },
  composer: { family: "serif", italic: true },
  lyricist: { family: "serif", italic: true },
  dynamic: { family: "serif", italic: true },
  tempo: { family: "serif", weight: "bold" },
  expression: { family: "serif", italic: true },
  plain: { family: "sans-serif" },
  fingering: { family: "sans-serif" },
  measureNumber: { family: "sans-serif" },
  pageNumber: { family: "sans-serif" },
  lyric: { family: "serif" },
  staffName: { family: "serif" },
};

/** Maps the individual dynamics letters (p f m s z r) to their SMuFL glyph names. */
const DYNAMIC_LETTER_GLYPHS: Record<string, string> = {
  p: "dynamicPiano",
  f: "dynamicForte",
  m: "dynamicMezzo",
  s: "dynamicSforzando",
  z: "dynamicZ",
  r: "dynamicRinforzando",
};

function isDynamicGlyphText(text: string): boolean {
  if (text.length === 0) return false;
  for (const ch of text.toLowerCase()) {
    if (!(ch in DYNAMIC_LETTER_GLYPHS)) return false;
  }
  return true;
}

function renderDynamicGlyphs(p: TextPrim, opts: RenderOptions): string {
  const chars = [...p.text.toLowerCase()]
    .map((ch) => glyphChar(opts.font, DYNAMIC_LETTER_GLYPHS[ch]!))
    .join("");
  const anchor = p.anchor ?? "start";
  const scale = p.size / GLYPH_FONT_SIZE_SP;
  return (
    `<g transform="translate(${fmt(p.x)},${fmt(p.y)}) scale(${fmt(scale)})"${refAttrs(p.ref, opts.idAttributes)}>` +
    `<text x="0" y="0" font-family="Bravura" font-size="${GLYPH_FONT_SIZE_SP}" text-anchor="${anchor}">${esc(chars)}</text>` +
    `</g>`
  );
}

function renderText(p: TextPrim, opts: RenderOptions): string {
  if (p.style === "dynamic" && isDynamicGlyphText(p.text)) {
    return renderDynamicGlyphs(p, opts);
  }
  const spec = TEXT_STYLES[p.style];
  const anchor = p.anchor ?? "start";
  const weightAttr = spec.weight ? ` font-weight="${spec.weight}"` : "";
  const styleAttr = spec.italic ? ` font-style="italic"` : "";
  return (
    `<text x="${fmt(p.x)}" y="${fmt(p.y)}" font-family="${spec.family}" font-size="${fmt(p.size)}" ` +
    `text-anchor="${anchor}"${weightAttr}${styleAttr}${refAttrs(p.ref, opts.idAttributes)}>${esc(p.text)}</text>`
  );
}

function renderPrimitive(p: Primitive, opts: RenderOptions): string {
  switch (p.type) {
    case "glyph":
      return renderGlyph(p, opts);
    case "line":
      return renderLine(p, opts);
    case "polygon":
      return renderPolygon(p, opts);
    case "path":
      return renderPath(p, opts);
    case "text":
      return renderText(p, opts);
    case "staffLines":
      return renderStaffLines(p);
    /* istanbul ignore next -- exhaustiveness guard */
    default: {
      const _exhaustive: never = p;
      throw new Error(`Unknown primitive type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Render one page of a LayoutResult to a standalone SVG string. */
export function renderPageSvg(page: Page, opts: RenderOptions): string {
  const unit = opts.unit ?? "mm";
  const widthMm = page.widthSp * opts.staffSpaceMm;
  const heightMm = page.heightSp * opts.staffSpaceMm;
  const widthAttr = unit === "px" ? `${fmt(widthMm * PX_PER_MM)}px` : `${fmt(widthMm)}mm`;
  const heightAttr = unit === "px" ? `${fmt(heightMm * PX_PER_MM)}px` : `${fmt(heightMm)}mm`;

  const body: string[] = [
    `<rect x="0" y="0" width="${fmt(page.widthSp)}" height="${fmt(page.heightSp)}" fill="#fff" />`,
  ];
  for (const system of page.systems) {
    const inner = system.primitives.map((p) => renderPrimitive(p, opts)).join("");
    body.push(`<g transform="translate(${fmt(system.x)},${fmt(system.y)})">${inner}</g>`);
  }
  for (const p of page.primitives) {
    body.push(renderPrimitive(p, opts));
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthAttr}" height="${heightAttr}" ` +
    `viewBox="0 0 ${fmt(page.widthSp)} ${fmt(page.heightSp)}" data-page-index="${page.index}">` +
    body.join("") +
    `</svg>`
  );
}

/** Render every page of a LayoutResult. `opts.staffSpaceMm` is normally `layout.staffSpaceMm`. */
export function renderPages(layout: LayoutResult, opts: RenderOptions): string[] {
  return layout.pages.map((page) => renderPageSvg(page, opts));
}
