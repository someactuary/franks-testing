/**
 * Hand-written LayoutResult fixture for renderer tests and the app shell.
 *
 * The real engraver (src/engraving) is being written in parallel; this fixture
 * exists so the renderer can be built and tested against the LayoutResult
 * contract (src/engraving/layout-types.ts) without depending on it.
 *
 * Coordinates follow docs/ARCHITECTURE.md's "Coordinate conventions for
 * engraving": sp units, y down, system-local; staff top line at `staff.y`,
 * middle line at `staff.y + 2`; note on staff step `s` at
 * `y = staff.y + 2 - s * 0.5`; stems attach at the notehead's
 * stemUpSE/stemDownNW anchor (SMuFL data is y UP, so its anchor y is negated
 * when combined with a y-DOWN layout coordinate).
 */
import type { LayoutResult, MeasureLayout, Page, Primitive, StaffLayout, System } from "@/engraving/layout-types";
import { BRAVURA, glyphAnchor } from "@/render/smufl";

const STAFF_SPACE_MM = 1.75;

const defaults = BRAVURA.engravingDefaults;

// Two staves of a grand staff, 8 sp apart (treble top line at 0, bass top line at 8).
const trebleY = 0;
const bassY = 8;

const trebleStaff: StaffLayout = { partIndex: 0, staffIndex: 0, y: trebleY, lineCount: 5 };
const bassStaff: StaffLayout = { partIndex: 0, staffIndex: 1, y: bassY, lineCount: 5 };

const measure: MeasureLayout = { measureIndex: 0, x: 0, width: 100 };

// Two beamed eighth notes on the treble staff (B4 middle line, D5 one step above).
const note1X = 20;
const note1Y = trebleY + 2 - 0 * 0.5; // staff step 0 (B4, middle line)
const note2X = 24;
const note2Y = trebleY + 2 - 2 * 0.5; // staff step 2 (D5)

const stemUpAnchor = glyphAnchor(BRAVURA, "noteheadBlack", "stemUpSE");
const beamY = -1.668; // flat beam above both notes

const stem1X = note1X + stemUpAnchor[0];
const stem1TopY = beamY;
const stem1BottomY = note1Y - stemUpAnchor[1];

const stem2X = note2X + stemUpAnchor[0];
const stem2TopY = beamY;
const stem2BottomY = note2Y - stemUpAnchor[1];

const beamThickness = defaults["beamThickness"] ?? 0.5;

const systemPrimitives: Primitive[] = [
  { type: "staffLines", x: 0, y: trebleY, width: 100, lineCount: 5, thickness: defaults["staffLineThickness"] ?? 0.13 },
  { type: "staffLines", x: 0, y: bassY, width: 100, lineCount: 5, thickness: defaults["staffLineThickness"] ?? 0.13 },

  {
    type: "glyph",
    glyph: "gClef",
    x: 1,
    y: trebleY + 4, // origin on the bottom line, per Bravura's gClef bbox
    ref: { id: "clef-treble", role: "clef" },
  },
  {
    type: "glyph",
    glyph: "fClef",
    x: 1,
    y: bassY + 1, // origin on the F line (2nd line from top), per Bravura's fClef bbox
    ref: { id: "clef-bass", role: "clef" },
  },

  {
    type: "glyph",
    glyph: "noteheadBlack",
    x: note1X,
    y: note1Y,
    ref: { id: "note-1", role: "notehead" },
  },
  {
    type: "glyph",
    glyph: "noteheadBlack",
    x: note2X,
    y: note2Y,
    ref: { id: "note-2", role: "notehead" },
  },
  {
    type: "line",
    x1: stem1X,
    y1: stem1BottomY,
    x2: stem1X,
    y2: stem1TopY,
    thickness: defaults["stemThickness"] ?? 0.12,
    ref: { id: "stem-1", role: "stem" },
  },
  {
    type: "line",
    x1: stem2X,
    y1: stem2BottomY,
    x2: stem2X,
    y2: stem2TopY,
    thickness: defaults["stemThickness"] ?? 0.12,
    ref: { id: "stem-2", role: "stem" },
  },
  {
    type: "polygon",
    points: [
      [stem1X, stem1TopY],
      [stem2X, stem2TopY],
      [stem2X, stem2TopY + beamThickness],
      [stem1X, stem1TopY + beamThickness],
    ],
    ref: { id: "beam-1", role: "beam" },
  },

  {
    type: "glyph",
    glyph: "restWhole",
    x: 20,
    y: bassY + 1, // whole rests hang below the 2nd line from top
    ref: { id: "rest-1", role: "rest" },
  },

  {
    // Barline connecting both staves of the grand staff, drawn as a single
    // stroke rather than per-staff barlineSingle glyphs.
    type: "line",
    x1: 98,
    y1: trebleY,
    x2: 98,
    y2: bassY + 4,
    thickness: defaults["thinBarlineThickness"] ?? 0.16,
    ref: { id: "barline-1", role: "barline" },
  },
];

const system: System = {
  index: 0,
  x: 10,
  y: 20,
  width: 100,
  height: 14,
  staves: [trebleStaff, bassStaff],
  measures: [measure],
  primitives: systemPrimitives,
};

const pagePrimitives: Primitive[] = [
  {
    type: "text",
    text: "Test Fixture Score",
    x: 60,
    y: 10,
    size: 3,
    style: "title",
    anchor: "middle",
    ref: { id: "title-1", role: "text" },
  },
];

const page: Page = {
  index: 0,
  widthSp: 120,
  heightSp: 170,
  systems: [system],
  primitives: pagePrimitives,
};

export const FIXTURE_LAYOUT: LayoutResult = {
  pages: [page],
  staffSpaceMm: STAFF_SPACE_MM,
};
