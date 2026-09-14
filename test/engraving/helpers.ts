import { engrave } from "@/engraving/engrave";
import type { GlyphPrim, LayoutResult, LinePrim, PathPrim, PolygonPrim, Primitive, Ref, TextPrim } from "@/engraving/layout-types";
import { notated, type NoteValue } from "@/model/duration";
import { newPianoScore } from "@/model/factory";
import { newId } from "@/model/ids";
import type { KeySignature } from "@/model/pitch";
import type { NoteEvent, Score, VoiceItem } from "@/model/score";
import type { TimeSignature } from "@/model/duration";
import { BRAVURA } from "@/render/smufl/generated/bravura";

export function makeScore(opts: {
  measureCount?: number;
  timeSig?: TimeSignature;
  keySig?: KeySignature;
  title?: string;
  composer?: string;
} = {}): Score {
  return newPianoScore(opts);
}

/** Replace the single voice of one staff of one measure. */
export function setStaff(score: Score, measureIndex: number, staffIndex: number, items: VoiceItem[]): void {
  const sm = score.parts[0]!.measures[measureIndex]!.staves[staffIndex]!;
  sm.voices = [{ id: newId(), index: 0, items }];
}

/** Add dots to a note or rest event. */
export function withDots<T extends VoiceItem & { duration: { base: NoteValue } }>(ev: T, dots: 1 | 2 | 3): T {
  return { ...ev, duration: notated(ev.duration.base, dots) };
}

export function withStem(ev: NoteEvent, stem: "up" | "down"): NoteEvent {
  return { ...ev, stem };
}

export function run(score: Score): LayoutResult {
  return engrave(score, { font: BRAVURA });
}

export function system(result: LayoutResult, pageIndex = 0, systemIndex = 0) {
  const page = result.pages[pageIndex];
  if (!page) throw new Error(`no page ${pageIndex}`);
  const sys = page.systems[systemIndex];
  if (!sys) throw new Error(`no system ${systemIndex} on page ${pageIndex}`);
  return sys;
}

export function allSystems(result: LayoutResult) {
  return result.pages.flatMap((p) => p.systems);
}

export function glyphs(prims: Primitive[], name?: string): GlyphPrim[] {
  return prims.filter((p): p is GlyphPrim => p.type === "glyph" && (name === undefined || p.glyph === name));
}

export function lines(prims: Primitive[]): LinePrim[] {
  return prims.filter((p): p is LinePrim => p.type === "line");
}

export function polygons(prims: Primitive[]): PolygonPrim[] {
  return prims.filter((p): p is PolygonPrim => p.type === "polygon");
}

export function paths(prims: Primitive[]): PathPrim[] {
  return prims.filter((p): p is PathPrim => p.type === "path");
}

export function texts(prims: Primitive[]): TextPrim[] {
  return prims.filter((p): p is TextPrim => p.type === "text");
}

export function withRole(prims: Primitive[], role: Ref["role"]): Primitive[] {
  return prims.filter((p) => "ref" in p && p.ref?.role === role);
}

export function withRef(prims: Primitive[], id: string, role?: Ref["role"]): Primitive[] {
  return prims.filter((p) => "ref" in p && p.ref?.id === id && (role === undefined || p.ref.role === role));
}

/** y of the top staff line of a staff in system coordinates. */
export function staffTop(sys: ReturnType<typeof system>, staffIndex: number): number {
  const s = sys.staves.find((st) => st.staffIndex === staffIndex);
  if (!s) throw new Error(`no staff ${staffIndex}`);
  return s.y;
}

export const FONT = BRAVURA;
