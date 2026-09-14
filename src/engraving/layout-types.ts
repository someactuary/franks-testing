/**
 * Output of the engraver, input of the renderer. Pure data.
 *
 * Units: staff spaces (sp) everywhere. The renderer multiplies by settings.staffSpaceMm.
 * Coordinates: x right, y DOWN (SVG convention). Each system has its own origin at the
 * top-left of its first staff's top line; pages position systems.
 *
 * Every primitive may carry `ref` for hit-testing back to model ids.
 */
import type { Id } from "@/model/ids";
import type { Fraction } from "@/model/duration";

export interface LayoutResult {
  pages: Page[];
  /** Staff space in mm, copied from settings so the renderer needs nothing else. */
  staffSpaceMm: number;
}

export interface Page {
  index: number;
  widthSp: number;
  heightSp: number;
  systems: System[];
  /** Page-level text such as title, composer, page number. */
  primitives: Primitive[];
}

export interface System {
  index: number;
  /** Position of the system origin on the page. */
  x: number;
  y: number;
  width: number;
  /** Total height from the top line of the first staff to the bottom line of the last, plus overhang used for collision. */
  height: number;
  staves: StaffLayout[];
  measures: MeasureLayout[];
  /** Everything drawn in this system, in system coordinates. */
  primitives: Primitive[];
}

export interface StaffLayout {
  partIndex: number;
  staffIndex: number;
  /** y of the top staff line in system coordinates. */
  y: number;
  lineCount: number;
}

export interface MeasureLayout {
  measureIndex: number;
  x: number;
  width: number;
  /**
   * Every distinct onset in this measure (across all staves), with its x in SYSTEM coordinates.
   * Sorted by offset. Used by the editor to place the cursor and to hit-test empty space.
   * An offset that is not a column (e.g. the cursor after the last event) should be
   * interpolated between neighbours, or placed before the barline at `x + width`.
   */
  columns: { offset: Fraction; x: number }[];
}

export interface Ref {
  id: Id;
  /** What the primitive represents; lets the UI decide selection behaviour. */
  role:
    | "notehead"
    | "stem"
    | "flag"
    | "beam"
    | "rest"
    | "accidental"
    | "dot"
    | "clef"
    | "keysig"
    | "timesig"
    | "barline"
    | "slur"
    | "tie"
    | "hairpin"
    | "pedal"
    | "ottava"
    | "dynamic"
    | "tempo"
    | "text"
    | "articulation"
    | "fingering"
    | "tuplet"
    | "ledger"
    | "measure"
    | "lyric"
    | "ornament"
    | "other";
}

export type Primitive = GlyphPrim | LinePrim | PolygonPrim | PathPrim | TextPrim | StaffLinesPrim;

/** A SMuFL glyph placed with its origin (baseline, left side bearing) at (x, y). */
export interface GlyphPrim {
  type: "glyph";
  glyph: string;
  x: number;
  y: number;
  /** Scale factor (grace notes, cue notes). Default 1. */
  scale?: number;
  ref?: Ref;
}

export interface LinePrim {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
  dash?: number[];
  ref?: Ref;
}

/** Filled polygon; used for beams and tuplet brackets. */
export interface PolygonPrim {
  type: "polygon";
  points: [number, number][];
  ref?: Ref;
}

/** SVG path data in system coordinates; used for slurs, ties, hairpins. */
export interface PathPrim {
  type: "path";
  d: string;
  fill?: boolean;
  stroke?: number;
  ref?: Ref;
}

export interface TextPrim {
  type: "text";
  text: string;
  x: number;
  y: number;
  /** Font size in staff spaces. */
  size: number;
  style:
    | "title"
    | "subtitle"
    | "composer"
    | "dynamic"
    | "tempo"
    | "expression"
    | "plain"
    | "fingering"
    | "measureNumber"
    | "pageNumber"
    | "lyric"
    | "staffName";
  anchor?: "start" | "middle" | "end";
  ref?: Ref;
}

export interface StaffLinesPrim {
  type: "staffLines";
  x: number;
  y: number;
  width: number;
  lineCount: number;
  thickness: number;
}
