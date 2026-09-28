/**
 * Score -> MusicXML 4.0 partwise.
 *
 * Layout decisions:
 *  - a single two-staff Part is written as ONE `<score-part>` with `<staves>2`;
 *    every other shape is written as one `<score-part>` per staff, wrapped in a
 *    `<part-group>` that carries the Part's name/abbreviation and bracket symbol.
 *  - `<divisions>` is the LCM of every sounding length's denominator (and 4),
 *    divided by 4 and capped, so every duration is an exact integer.
 *  - directions are emitted inside the first voice of their staff, with an
 *    `<offset>` when they do not fall on that voice's note boundaries.
 *  - model pitches are *written* pitches; MusicXML pitches sound, so notes under
 *    an ottava are transposed on the way out (and back on the way in).
 */
import {
  add,
  cmp,
  frac,
  keyAlter,
  measureLength,
  notatedToFraction,
  sub,
  ZERO,
  type Alter,
  type Fraction,
  type Id,
  type KeySignature,
  type TimeSignature,
} from "@/model";
import type {
  Anchor,
  ClefKind,
  Lyric,
  MeasureAttributes,
  Note,
  NoteEvent,
  Part,
  RestEvent,
  Score,
  StaffMeasure,
  TupletGroup,
  Voice,
  VoiceItem,
} from "@/model";
import {
  ARTICULATION_ELEMENTS,
  clefSpec,
  DYNAMIC_ELEMENTS,
  lcm,
  noteTypeName,
  ORNAMENT_ELEMENTS,
  toDivisions,
  XmlWriter,
} from "./common";

const MAX_DIVISIONS = 10080;

type Event = NoteEvent | RestEvent;
type Placement = "above" | "below";

// ---------------------------------------------------------------------------
// Flattening
// ---------------------------------------------------------------------------

interface FlatEvent {
  event: Event;
  offset: Fraction;
  length: Fraction;
  /** Cumulative tuplet ratio applying to this note, or undefined outside tuplets. */
  timeMod?: { actual: number; normal: number };
  /** Tuplets that open on this event, outermost first, with their nesting number. */
  starts: { group: TupletGroup; number: number }[];
  /** Tuplets that close on this event, innermost first. */
  stops: { group: TupletGroup; number: number }[];
}

/** Flatten a voice's items into events carrying offsets, cumulative tuplet ratios and bracket marks. */
function flattenVoice(voice: Voice): FlatEvent[] {
  const out: FlatEvent[] = [];
  const walk = (
    items: VoiceItem[],
    start: Fraction,
    scale: Fraction,
    mod: { actual: number; normal: number } | undefined,
    depth: number,
  ): Fraction => {
    let t = start;
    for (const item of items) {
      if (item.kind === "tuplet") {
        const inner = {
          actual: (mod?.actual ?? 1) * item.ratio.actual,
          normal: (mod?.normal ?? 1) * item.ratio.normal,
        };
        const childScale = frac(scale.num * item.ratio.normal, scale.den * item.ratio.actual);
        const before = out.length;
        t = walk(item.items, t, childScale, inner, depth + 1);
        if (out.length > before) {
          out[before]!.starts.push({ group: item, number: depth + 1 });
          out[out.length - 1]!.stops.unshift({ group: item, number: depth + 1 });
        }
        continue;
      }
      const plain = notatedToFraction(item.duration);
      const length = frac(plain.num * scale.num, plain.den * scale.den);
      out.push({ event: item, offset: t, length, ...(mod ? { timeMod: mod } : {}), starts: [], stops: [] });
      t = add(t, length);
    }
    return t;
  };
  walk(voice.items, ZERO, frac(1), undefined, 0);
  return out;
}

function isWholeMeasureRest(voice: Voice): boolean {
  const only = voice.items.length === 1 ? voice.items[0] : undefined;
  return !!only && only.kind === "rest" && only.measureRest === true;
}

// ---------------------------------------------------------------------------
// Score-wide indexes
// ---------------------------------------------------------------------------

interface EventLoc {
  partIndex: number;
  staffIndex: number;
  measureIndex: number;
  offset: Fraction;
  length: Fraction;
}

interface MeasureInfo {
  /** Sounding length of the measure (actualLength, else the time signature). */
  length: Fraction;
  timeSig: TimeSignature;
  keySig: KeySignature;
  /** Absolute start of the measure from the top of the score. */
  start: Fraction;
  number: number;
  implicit: boolean;
}

function buildMeasureInfo(score: Score): MeasureInfo[] {
  const out: MeasureInfo[] = [];
  let timeSig: TimeSignature = { numerator: 4, denominator: 4 };
  let keySig: KeySignature = { fifths: 0, mode: "major" };
  let abs: Fraction = ZERO;
  let number = 0;
  for (const [mi, ma] of score.measures.entries()) {
    if (ma.timeSig) timeSig = ma.timeSig;
    if (ma.keySig) keySig = ma.keySig;
    const nominal = measureLength(timeSig);
    const length = ma.actualLength ?? nominal;
    const implicit = ma.actualLength !== undefined && cmp(ma.actualLength, nominal) !== 0;
    if (implicit) {
      if (mi > 0 && number === 0) number = 1;
    } else {
      number += 1;
    }
    out.push({ length, timeSig, keySig, start: abs, number: ma.numberOverride ?? number, implicit });
    abs = add(abs, length);
  }
  return out;
}

function buildEventIndex(score: Score): Map<Id, EventLoc> {
  const index = new Map<Id, EventLoc>();
  for (const [partIndex, part] of score.parts.entries()) {
    for (const [measureIndex, pm] of part.measures.entries()) {
      for (const [staffIndex, sm] of pm.staves.entries()) {
        for (const voice of sm.voices) {
          for (const fe of flattenVoice(voice)) {
            index.set(fe.event.id, { partIndex, staffIndex, measureIndex, offset: fe.offset, length: fe.length });
          }
        }
      }
    }
  }
  return index;
}

interface TimePoint {
  measureIndex: number;
  offset: Fraction;
}

/** Where an endpoint sits in time. `end` endpoints land *after* the anchored event. */
function resolveAnchor(anchor: Anchor, index: Map<Id, EventLoc>, which: "start" | "end"): TimePoint | undefined {
  if (anchor.kind === "measure") return { measureIndex: anchor.measureIndex, offset: anchor.offset };
  const loc = index.get(anchor.eventId);
  if (!loc) return undefined;
  return {
    measureIndex: loc.measureIndex,
    offset: which === "start" ? loc.offset : add(loc.offset, loc.length),
  };
}

// ---------------------------------------------------------------------------
// Directions
// ---------------------------------------------------------------------------

interface DirectionItem {
  staffIndex: number;
  measureIndex: number;
  pos: Fraction;
  /** Lower ranks are written first at the same position (stops before starts). */
  rank: number;
  write: (w: XmlWriter, staffNumber: number, offsetDiv: number) => void;
}

function direction(
  w: XmlWriter,
  staffNumber: number,
  offsetDiv: number,
  placement: Placement | undefined,
  body: () => void,
  sound?: () => void,
): void {
  w.open("direction", placement ? { placement } : undefined);
  body();
  if (offsetDiv !== 0) w.leaf("offset", offsetDiv);
  w.leaf("staff", staffNumber);
  sound?.();
  w.close("direction");
}

function wrap(w: XmlWriter, body: () => void): void {
  w.open("direction-type");
  body();
  w.close("direction-type");
}

// ---------------------------------------------------------------------------
// Part planning
// ---------------------------------------------------------------------------

interface XmlPart {
  id: string;
  /** Indices into `score.parts` / `part.staves` for each staff of this MusicXML part. */
  staves: { partIndex: number; staffIndex: number }[];
  name: string;
  abbreviation?: string;
}

function planParts(score: Score): XmlPart[] {
  const only = score.parts.length === 1 ? score.parts[0] : undefined;
  if (only && only.staves.length === 2) {
    return [
      {
        id: "P1",
        staves: [
          { partIndex: 0, staffIndex: 0 },
          { partIndex: 0, staffIndex: 1 },
        ],
        name: only.name,
        ...(only.abbreviation ? { abbreviation: only.abbreviation } : {}),
      },
    ];
  }
  const parts: XmlPart[] = [];
  for (const [partIndex, part] of score.parts.entries()) {
    for (const [staffIndex, staff] of part.staves.entries()) {
      const name = staff.name ?? (part.staves.length === 1 ? part.name : `${part.name} ${staffIndex + 1}`);
      const abbreviation = staff.abbreviation ?? (part.staves.length === 1 ? part.abbreviation : undefined);
      parts.push({
        id: `P${parts.length + 1}`,
        staves: [{ partIndex, staffIndex }],
        name,
        ...(abbreviation ? { abbreviation } : {}),
      });
    }
  }
  return parts;
}

function bracketSymbol(part: Part): string {
  const b = part.bracket ?? (part.staves.length >= 2 ? "brace" : "none");
  return b === "brace" ? "brace" : b === "bracket" ? "bracket" : "none";
}

/** LCM of every denominator the score needs to express exactly, divided by 4. */
function chooseDivisions(score: Score, infos: MeasureInfo[]): number {
  let den = 4;
  const bump = (f: Fraction) => {
    den = lcm(den, f.den);
  };
  for (const info of infos) bump(info.length);
  for (const part of score.parts) {
    for (const pm of part.measures) {
      for (const sm of pm.staves) {
        for (const change of sm.clefChanges ?? []) bump(change.at);
        for (const voice of sm.voices) {
          for (const fe of flattenVoice(voice)) {
            bump(fe.length);
            bump(fe.offset);
          }
        }
      }
    }
  }
  for (const sp of score.spanners) {
    if (sp.start.kind === "measure") bump(sp.start.offset);
    if (sp.end.kind === "measure") bump(sp.end.offset);
  }
  for (const at of score.attachments) if (at.anchor.kind === "measure") bump(at.anchor.offset);
  return Math.max(1, Math.min(MAX_DIVISIONS, den / 4));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

interface SlurMark {
  type: "start" | "stop";
  number: number;
  placement?: Placement;
}

export function exportMusicXml(score: Score): string {
  const infos = buildMeasureInfo(score);
  const eventIndex = buildEventIndex(score);
  const divisions = chooseDivisions(score, infos);
  const xmlParts = planParts(score);

  const abs = (measureIndex: number, offset: Fraction): Fraction => add(infos[measureIndex]?.start ?? ZERO, offset);

  const ottavas: { partIndex: number; staffIndex: number; from: Fraction; to: Fraction; octaves: number }[] = [];
  for (const sp of score.spanners) {
    if (sp.kind !== "ottava") continue;
    const s = resolveAnchor(sp.start, eventIndex, "start");
    const e = resolveAnchor(sp.end, eventIndex, "end");
    if (!s || !e) continue;
    ottavas.push({
      partIndex: sp.partIndex,
      staffIndex: sp.staffIndex,
      from: abs(s.measureIndex, s.offset),
      to: abs(e.measureIndex, e.offset),
      octaves: sp.shift > 0 ? sp.shift / 8 : -(-sp.shift / 8),
    });
  }
  const octaveShiftAt = (partIndex: number, staffIndex: number, at: Fraction): number => {
    for (const o of ottavas) {
      if (o.partIndex !== partIndex || o.staffIndex !== staffIndex) continue;
      if (cmp(at, o.from) >= 0 && cmp(at, o.to) < 0) return o.octaves;
    }
    return 0;
  };

  const slurMarks = new Map<Id, SlurMark[]>();
  assignSlurNumbers(score, eventIndex, slurMarks);
  const fermatas = new Map<Id, Placement | undefined>();
  for (const at of score.attachments) {
    if (at.kind === "fermata" && at.anchor.kind === "event") fermatas.set(at.anchor.eventId, at.placement);
  }

  const directions: DirectionItem[] = [];
  collectDirections(score, eventIndex, directions);

  const w = new XmlWriter();
  w.raw('<?xml version="1.0" encoding="UTF-8"?>');
  w.raw(
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
  );
  w.open("score-partwise", { version: "4.0" });

  if (score.meta.title) {
    w.open("work");
    w.leaf("work-title", score.meta.title);
    w.close("work");
  }
  if (score.meta.composer || score.meta.lyricist || score.meta.copyright) {
    w.open("identification");
    if (score.meta.composer) w.leaf("creator", score.meta.composer, { type: "composer" });
    if (score.meta.lyricist) w.leaf("creator", score.meta.lyricist, { type: "lyricist" });
    if (score.meta.copyright) w.leaf("rights", score.meta.copyright);
    w.open("encoding");
    w.leaf("software", "personal_music_notation");
    w.close("encoding");
    w.close("identification");
  }
  writeDefaults(w, score);
  writePartList(w, score, xmlParts);

  for (const [xpi, xp] of xmlParts.entries()) {
    w.open("part", { id: xp.id });
    for (const [mi, info] of infos.entries()) {
      writeMeasure(w, {
        score,
        xmlPart: xp,
        xmlPartIndex: xpi,
        measureIndex: mi,
        info,
        divisions,
        directions,
        slurMarks,
        fermatas,
        octaveShiftAt,
        abs,
      });
    }
    w.close("part");
  }

  w.close("score-partwise");
  return `${w.toString()}\n`;
}

function writeDefaults(w: XmlWriter, score: Score): void {
  const s = score.settings;
  const mmPerTenth = s.staffSpaceMm / 10;
  const tenths = (mm: number) => Math.round((mm / mmPerTenth) * 100) / 100;
  w.open("defaults");
  w.open("scaling");
  w.leaf("millimeters", Math.round(s.staffSpaceMm * 4 * 10000) / 10000);
  w.leaf("tenths", 40);
  w.close("scaling");
  w.open("page-layout");
  w.leaf("page-height", tenths(s.page.heightMm));
  w.leaf("page-width", tenths(s.page.widthMm));
  w.open("page-margins", { type: "both" });
  w.leaf("left-margin", tenths(s.page.marginMm.left));
  w.leaf("right-margin", tenths(s.page.marginMm.right));
  w.leaf("top-margin", tenths(s.page.marginMm.top));
  w.leaf("bottom-margin", tenths(s.page.marginMm.bottom));
  w.close("page-margins");
  w.close("page-layout");
  w.close("defaults");
}

function writePartList(w: XmlWriter, score: Score, xmlParts: XmlPart[]): void {
  w.open("part-list");
  let groupNumber = 0;
  let cursor = 0;
  for (const part of score.parts) {
    const count = xmlParts.filter((xp) => xp.staves.some((s) => score.parts[s.partIndex] === part)).length;
    const grouped = xmlParts.length > 1 && count > 1;
    if (grouped) {
      groupNumber += 1;
      w.open("part-group", { number: String(groupNumber), type: "start" });
      w.leaf("group-name", part.name);
      if (part.abbreviation) w.leaf("group-abbreviation", part.abbreviation);
      w.leaf("group-symbol", bracketSymbol(part));
      w.leaf("group-barline", "yes");
      w.close("part-group");
    }
    for (let i = 0; i < count; i++) {
      const xp = xmlParts[cursor + i];
      if (!xp) continue;
      w.open("score-part", { id: xp.id });
      w.leaf("part-name", xp.name);
      if (xp.abbreviation) w.leaf("part-abbreviation", xp.abbreviation);
      w.open("score-instrument", { id: `${xp.id}-I1` });
      w.leaf("instrument-name", xp.name);
      w.close("score-instrument");
      w.open("midi-instrument", { id: `${xp.id}-I1` });
      w.leaf("midi-channel", 1);
      w.leaf("midi-program", (part.midiProgram ?? 0) + 1);
      w.close("midi-instrument");
      w.close("score-part");
    }
    if (grouped) w.leaf("part-group", undefined, { number: String(groupNumber), type: "stop" });
    cursor += count;
  }
  w.close("part-list");
}

// ---------------------------------------------------------------------------
// Slur numbering
// ---------------------------------------------------------------------------

function assignSlurNumbers(score: Score, index: Map<Id, EventLoc>, out: Map<Id, SlurMark[]>): void {
  interface Pending {
    start: Id;
    end: Id;
    startOrder: number;
    endOrder: number;
    placement?: Placement;
  }
  const order = (loc: EventLoc) => loc.measureIndex * 1024 + loc.offset.num / loc.offset.den;
  const byStaff = new Map<string, Pending[]>();
  for (const sp of score.spanners) {
    if (sp.kind !== "slur" || sp.start.kind !== "event" || sp.end.kind !== "event") continue;
    const s = index.get(sp.start.eventId);
    const e = index.get(sp.end.eventId);
    if (!s || !e) continue;
    const key = `${sp.partIndex}/${sp.staffIndex}`;
    const list = byStaff.get(key) ?? [];
    list.push({
      start: sp.start.eventId,
      end: sp.end.eventId,
      startOrder: order(s),
      endOrder: order(e),
      ...(sp.placement ? { placement: sp.placement } : {}),
    });
    byStaff.set(key, list);
  }
  for (const list of byStaff.values()) {
    list.sort((a, b) => a.startOrder - b.startOrder);
    const active: (Pending | undefined)[] = [];
    for (const slur of list) {
      for (const [i, a] of active.entries()) if (a && a.endOrder <= slur.startOrder) active[i] = undefined;
      let n = active.findIndex((a) => a === undefined);
      if (n < 0) n = active.length;
      active[n] = slur;
      const number = n + 1;
      push(out, slur.start, { type: "start", number, ...(slur.placement ? { placement: slur.placement } : {}) });
      push(out, slur.end, { type: "stop", number });
    }
  }
}

function push<T>(map: Map<Id, T[]>, key: Id, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// ---------------------------------------------------------------------------
// Direction collection
// ---------------------------------------------------------------------------

function collectDirections(score: Score, index: Map<Id, EventLoc>, out: DirectionItem[]): void {
  for (const a of score.attachments) {
    if (a.kind === "fermata") continue; // written in the note's notations
    const pos = resolveAnchor(a.anchor, index, "start");
    if (!pos) continue;
    const base = { staffIndex: a.staffIndex, measureIndex: pos.measureIndex, pos: pos.offset, rank: 1 };
    switch (a.kind) {
      case "dynamic":
        out.push({
          ...base,
          write: (w, staff, off) =>
            direction(w, staff, off, a.placement, () =>
              wrap(w, () => {
                w.open("dynamics");
                if (DYNAMIC_ELEMENTS.has(a.text)) w.leaf(a.text);
                else w.leaf("other-dynamics", a.text);
                w.close("dynamics");
              }),
            ),
        });
        break;
      case "text":
        out.push({
          ...base,
          write: (w, staff, off) =>
            direction(w, staff, off, a.placement, () =>
              wrap(w, () =>
                w.leaf("words", a.text, a.style === "expression" ? { "font-style": "italic" } : undefined),
              ),
            ),
        });
        break;
      case "tempo":
        out.push({
          ...base,
          rank: 0,
          write: (w, staff, off) =>
            direction(
              w,
              staff,
              off,
              a.placement,
              () => {
                if (a.text !== undefined) {
                  wrap(w, () => w.leaf("words", a.text!, { "font-weight": "bold" }));
                }
                if (a.beatUnit && a.bpm !== undefined) {
                  wrap(w, () => {
                    w.open("metronome");
                    w.leaf("beat-unit", noteTypeName(a.beatUnit!.base));
                    for (let i = 0; i < a.beatUnit!.dots; i++) w.leaf("beat-unit-dot");
                    w.leaf("per-minute", a.bpm!);
                    w.close("metronome");
                  });
                }
              },
              a.bpm === undefined ? undefined : () => w.leaf("sound", undefined, { tempo: a.bpm }),
            ),
        });
        break;
      case "pedalMark":
        out.push({
          ...base,
          write: (w, staff, off) =>
            direction(w, staff, off, a.placement, () =>
              wrap(w, () => w.leaf("pedal", undefined, { type: a.mark === "ped" ? "start" : "stop", line: "no" })),
            ),
        });
        break;
    }
  }

  for (const sp of score.spanners) {
    if (sp.kind === "slur") continue; // written in the note's notations
    const s = resolveAnchor(sp.start, index, "start");
    const e = resolveAnchor(sp.end, index, "end");
    if (!s || !e) continue;
    const mk = (
      pos: TimePoint,
      rank: number,
      body: (w: XmlWriter) => void,
      placement?: Placement,
    ): DirectionItem => ({
      staffIndex: sp.staffIndex,
      measureIndex: pos.measureIndex,
      pos: pos.offset,
      rank,
      write: (w, staff, off) => direction(w, staff, off, placement, () => wrap(w, () => body(w))),
    });

    switch (sp.kind) {
      case "hairpin":
        out.push(
          mk(
            s,
            1,
            (w) => w.leaf("wedge", undefined, { type: sp.shape === "cresc" ? "crescendo" : "diminuendo", number: 1 }),
            sp.placement,
          ),
        );
        out.push(mk(e, 0, (w) => w.leaf("wedge", undefined, { type: "stop", number: 1 })));
        break;
      case "pedal": {
        const line = sp.style === "line" ? "yes" : "no";
        const sign = sp.style === "line" ? "no" : "yes";
        out.push(mk(s, 1, (w) => w.leaf("pedal", undefined, { type: "start", line, sign }), sp.placement));
        out.push(mk(e, 0, (w) => w.leaf("pedal", undefined, { type: "stop", line, sign })));
        break;
      }
      case "ottava": {
        // "down" moves the printed notes down relative to the sounding pitch, i.e. 8va.
        const size = Math.abs(sp.shift);
        out.push(
          mk(
            s,
            1,
            (w) => w.leaf("octave-shift", undefined, { type: sp.shift > 0 ? "down" : "up", size, number: 1 }),
            sp.placement,
          ),
        );
        out.push(mk(e, 0, (w) => w.leaf("octave-shift", undefined, { type: "stop", size, number: 1 })));
        break;
      }
      default:
        break; // trillLine / glissando have no direction form we emit
    }
  }
}

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------

interface MeasureCtx {
  score: Score;
  xmlPart: XmlPart;
  xmlPartIndex: number;
  measureIndex: number;
  info: MeasureInfo;
  divisions: number;
  directions: DirectionItem[];
  slurMarks: Map<Id, SlurMark[]>;
  fermatas: Map<Id, Placement | undefined>;
  octaveShiftAt: (partIndex: number, staffIndex: number, at: Fraction) => number;
  abs: (measureIndex: number, offset: Fraction) => Fraction;
}

function writeMeasure(w: XmlWriter, ctx: MeasureCtx): void {
  const { score, xmlPart, measureIndex, info } = ctx;
  const ma: MeasureAttributes | undefined = score.measures[measureIndex];
  w.open("measure", { number: String(info.number), ...(info.implicit ? { implicit: "yes" } : {}) });

  if (measureIndex > 0 && ctx.xmlPartIndex === 0) {
    const newPage = score.layout.pageBreaks.includes(measureIndex);
    const newSystem = !newPage && score.layout.systemBreaks.includes(measureIndex);
    if (newPage || newSystem) {
      w.leaf("print", undefined, newPage ? { "new-page": "yes" } : { "new-system": "yes" });
    }
  }

  writeAttributes(w, ctx);
  writeLeftBarline(w, ma);
  if (ma?.rehearsalMark && ctx.xmlPartIndex === 0) {
    w.open("direction", { placement: "above" });
    wrap(w, () => w.leaf("rehearsal", ma.rehearsalMark!));
    w.leaf("staff", 1);
    w.close("direction");
  }

  let firstStream = true;
  for (const [localStaff, ref] of xmlPart.staves.entries()) {
    const part = score.parts[ref.partIndex];
    const sm: StaffMeasure | undefined = part?.measures[measureIndex]?.staves[ref.staffIndex];
    if (!part || !sm) continue;
    const staffNumber = localStaff + 1;
    const pending = ctx.directions
      .filter((d) => d.measureIndex === measureIndex && d.staffIndex === ref.staffIndex)
      .sort((a, b) => cmp(a.pos, b.pos) || a.rank - b.rank);
    const midClefs = (sm.clefChanges ?? []).filter((c) => cmp(c.at, ZERO) !== 0).sort((a, b) => cmp(a.at, b.at));

    for (const [vi, voice] of sm.voices.entries()) {
      writeVoice(w, ctx, {
        partIndex: ref.partIndex,
        staffIndex: ref.staffIndex,
        staffNumber,
        voice,
        firstStream,
        directions: vi === 0 ? pending : [],
        midClefs: vi === 0 ? midClefs : [],
      });
      firstStream = false;
    }
  }

  writeRightBarline(w, ma);
  w.close("measure");
}

function writeLeftBarline(w: XmlWriter, ma: MeasureAttributes | undefined): void {
  if (!ma) return;
  const repeatStart = ma.startBarline === "repeat-start";
  const endingStart = ma.ending?.type === "start";
  if (!repeatStart && !endingStart) return;
  w.open("barline", { location: "left" });
  if (repeatStart) w.leaf("bar-style", "heavy-light");
  if (endingStart && ma.ending) {
    w.leaf("ending", undefined, { number: ma.ending.numbers.join(", "), type: "start" });
  }
  if (repeatStart) w.leaf("repeat", undefined, { direction: "forward" });
  w.close("barline");
}

function writeRightBarline(w: XmlWriter, ma: MeasureAttributes | undefined): void {
  const style = ma?.barline;
  const ending = ma?.ending;
  const endsEnding = ending !== undefined && ending.type !== "start";
  const repeatEnd = style === "repeat-end" || style === "repeat-both";
  // A volta that starts here and ends on a repeat or a final barline gets its stop
  // written here too, so the bracket closes for readers that need an explicit stop.
  const impliedStop = ending?.type === "start" && (repeatEnd || style === "final");
  if (!style && !endsEnding && !impliedStop) return;
  const barStyle =
    style === "final" || repeatEnd
      ? "light-heavy"
      : style === "double"
        ? "light-light"
        : style === "dashed"
          ? "dashed"
          : style === "invisible"
            ? "none"
            : style === "repeat-start"
              ? "heavy-light"
              : undefined;
  w.open("barline", { location: "right" });
  if (barStyle) w.leaf("bar-style", barStyle);
  if (ending && (endsEnding || impliedStop)) {
    w.leaf("ending", undefined, {
      number: ending.numbers.join(", "),
      type: ending.type === "discontinue" ? "discontinue" : "stop",
    });
  }
  if (repeatEnd) w.leaf("repeat", undefined, { direction: "backward" });
  else if (style === "repeat-start") w.leaf("repeat", undefined, { direction: "forward" });
  w.close("barline");
}

function writeAttributes(w: XmlWriter, ctx: MeasureCtx): void {
  const { score, xmlPart, measureIndex, divisions } = ctx;
  const ma = score.measures[measureIndex];
  const first = measureIndex === 0;
  const multiStaff = xmlPart.staves.length > 1;
  const clefs: { number: number; clef: ClefKind }[] = [];
  for (const [localStaff, ref] of xmlPart.staves.entries()) {
    const part = score.parts[ref.partIndex];
    const staff = part?.staves[ref.staffIndex];
    const sm = part?.measures[measureIndex]?.staves[ref.staffIndex];
    const atZero = (sm?.clefChanges ?? []).find((c) => cmp(c.at, ZERO) === 0);
    if (atZero) clefs.push({ number: localStaff + 1, clef: atZero.clef });
    else if (first && staff) clefs.push({ number: localStaff + 1, clef: staff.initialClef });
  }
  const key = first ? (ma?.keySig ?? { fifths: 0, mode: "major" as const }) : ma?.keySig;
  const time = first ? (ma?.timeSig ?? { numerator: 4, denominator: 4 as const }) : ma?.timeSig;
  if (!first && !key && !time && clefs.length === 0) return;

  w.open("attributes");
  if (first) w.leaf("divisions", divisions);
  if (key) {
    w.open("key");
    w.leaf("fifths", key.fifths);
    w.leaf("mode", key.mode);
    w.close("key");
  }
  if (time) {
    w.open("time");
    w.leaf("beats", time.numerator);
    w.leaf("beat-type", time.denominator);
    w.close("time");
  }
  if (first && multiStaff) {
    w.leaf("staves", xmlPart.staves.length);
    const part = score.parts[xmlPart.staves[0]!.partIndex];
    if (part) w.leaf("part-symbol", bracketSymbol(part));
  }
  for (const c of clefs) writeClef(w, c.clef, multiStaff ? c.number : undefined);
  w.close("attributes");
}

function writeClef(w: XmlWriter, clef: ClefKind, number: number | undefined): void {
  const spec = clefSpec(clef);
  w.open("clef", number === undefined ? undefined : { number });
  w.leaf("sign", spec.sign);
  w.leaf("line", spec.line);
  if (spec.octaveChange !== undefined) w.leaf("clef-octave-change", spec.octaveChange);
  w.close("clef");
}

// ---------------------------------------------------------------------------
// Voices and notes
// ---------------------------------------------------------------------------

interface VoiceCtx {
  partIndex: number;
  staffIndex: number;
  staffNumber: number;
  voice: Voice;
  firstStream: boolean;
  directions: DirectionItem[];
  midClefs: { at: Fraction; clef: ClefKind }[];
}

function writeVoice(w: XmlWriter, ctx: MeasureCtx, v: VoiceCtx): void {
  const { divisions, info } = ctx;
  const multiStaff = ctx.xmlPart.staves.length > 1;
  const voiceNumber = (v.staffNumber - 1) * 4 + v.voice.index + 1;
  const wholeRest = isWholeMeasureRest(v.voice);

  if (!v.firstStream) {
    w.open("backup");
    w.leaf("duration", toDivisions(info.length, divisions));
    w.close("backup");
  }

  const pendingDirections = [...v.directions];
  const pendingClefs = [...v.midClefs];
  const flush = (limit: Fraction | undefined, cur: Fraction) => {
    while (pendingClefs.length && (limit === undefined || cmp(pendingClefs[0]!.at, limit) < 0)) {
      const c = pendingClefs.shift()!;
      w.open("attributes");
      writeClef(w, c.clef, multiStaff ? v.staffNumber : undefined);
      w.close("attributes");
    }
    while (pendingDirections.length && (limit === undefined || cmp(pendingDirections[0]!.pos, limit) < 0)) {
      const d = pendingDirections.shift()!;
      d.write(w, v.staffNumber, toDivisions(sub(d.pos, cur), divisions));
    }
  };

  let cur: Fraction = ZERO;
  if (wholeRest) {
    flush(info.length, ZERO);
    const only = v.voice.items[0] as RestEvent;
    w.open("note", only.invisible ? { "print-object": "no" } : undefined);
    w.leaf("rest", undefined, { measure: "yes" });
    w.leaf("duration", Math.max(1, toDivisions(info.length, divisions)));
    w.leaf("voice", voiceNumber);
    if (multiStaff) w.leaf("staff", v.staffNumber);
    w.close("note");
    cur = info.length;
  } else {
    for (const fe of flattenVoice(v.voice)) {
      flush(add(fe.offset, fe.length), fe.offset);
      writeEvent(w, ctx, v, fe, voiceNumber);
      cur = add(fe.offset, fe.length);
    }
  }
  flush(undefined, cur);
}

function writeEvent(w: XmlWriter, ctx: MeasureCtx, v: VoiceCtx, fe: FlatEvent, voiceNumber: number): void {
  const ev = fe.event;
  const durationDiv = Math.max(1, toDivisions(fe.length, ctx.divisions));
  const multiStaff = ctx.xmlPart.staves.length > 1;

  if (ev.kind === "note" && ev.grace) {
    for (const g of ev.grace.events) {
      for (const [ni, n] of g.notes.entries()) {
        writeNoteElement(w, ctx, v, {
          event: g,
          note: n,
          isChord: ni > 0,
          grace: { slash: ev.grace.slash },
          durationDiv: 0,
          voiceNumber,
          fe: undefined,
          isFirst: ni === 0,
        });
      }
    }
  }

  if (ev.kind === "rest") {
    w.open("note", ev.invisible ? { "print-object": "no" } : undefined);
    w.leaf("rest", undefined, ev.measureRest ? { measure: "yes" } : undefined);
    w.leaf("duration", durationDiv);
    w.leaf("voice", voiceNumber);
    w.leaf("type", noteTypeName(ev.duration.base));
    for (let i = 0; i < ev.duration.dots; i++) w.leaf("dot");
    writeTimeModification(w, fe);
    if (multiStaff) w.leaf("staff", v.staffNumber);
    if (fe.starts.length || fe.stops.length) {
      w.open("notations");
      writeTupletNotations(w, fe);
      w.close("notations");
    }
    w.close("note");
    return;
  }

  for (const [ni, n] of ev.notes.entries()) {
    writeNoteElement(w, ctx, v, {
      event: ev,
      note: n,
      isChord: ni > 0,
      durationDiv,
      voiceNumber,
      fe,
      isFirst: ni === 0,
    });
  }
}

interface NoteArgs {
  event: NoteEvent;
  note: Note;
  isChord: boolean;
  grace?: { slash: boolean };
  durationDiv: number;
  voiceNumber: number;
  fe: FlatEvent | undefined;
  isFirst: boolean;
}

function writeNoteElement(w: XmlWriter, ctx: MeasureCtx, v: VoiceCtx, a: NoteArgs): void {
  const { event: ev, note } = a;
  const multiStaff = ctx.xmlPart.staves.length > 1;
  const key = ctx.info.keySig;
  const shift = a.fe ? ctx.octaveShiftAt(v.partIndex, v.staffIndex, ctx.abs(ctx.measureIndex, a.fe.offset)) : 0;

  const slurs = a.isFirst && !a.grace ? (ctx.slurMarks.get(ev.id) ?? []) : [];
  const fermata = a.isFirst && !a.grace && ctx.fermatas.has(ev.id);
  const tuplets = a.isFirst && a.fe ? a.fe.starts.length + a.fe.stops.length > 0 : false;
  const eventNotations =
    a.isFirst &&
    ((ev.articulations?.length ?? 0) > 0 || (ev.ornaments?.length ?? 0) > 0 || !!ev.arpeggio || !!ev.tremolo);
  const hasNotations =
    !!note.tieStart || slurs.length > 0 || fermata || tuplets || eventNotations || note.fingering !== undefined;

  w.open("note");
  if (a.grace) w.leaf("grace", undefined, a.grace.slash ? { slash: "yes" } : undefined);
  if (a.isChord) w.leaf("chord");
  w.open("pitch");
  w.leaf("step", note.pitch.step);
  if (note.pitch.alter !== 0) w.leaf("alter", note.pitch.alter);
  w.leaf("octave", note.pitch.octave + shift);
  w.close("pitch");
  if (!a.grace) w.leaf("duration", a.durationDiv);
  if (note.tieStart) w.leaf("tie", undefined, { type: "start" });
  w.leaf("voice", a.voiceNumber);
  w.leaf("type", noteTypeName(ev.duration.base));
  for (let i = 0; i < ev.duration.dots; i++) w.leaf("dot");
  const acc = accidentalFor(note, key);
  if (acc) w.leaf("accidental", acc.name, acc.attrs);
  if (a.fe) writeTimeModification(w, a.fe);
  if (ev.stem) w.leaf("stem", ev.stem);
  if (note.notehead && note.notehead !== "normal") w.leaf("notehead", note.notehead);
  if (multiStaff) w.leaf("staff", v.staffNumber);

  if (hasNotations) {
    w.open("notations");
    if (note.tieStart) w.leaf("tied", undefined, { type: "start" });
    for (const s of slurs) {
      w.leaf("slur", undefined, {
        type: s.type,
        number: s.number,
        ...(s.placement ? { placement: s.placement } : {}),
      });
    }
    if (tuplets && a.fe) writeTupletNotations(w, a.fe);
    if (a.isFirst && ((ev.ornaments?.length ?? 0) > 0 || ev.tremolo)) {
      w.open("ornaments");
      for (const o of ev.ornaments ?? []) w.leaf(ORNAMENT_ELEMENTS[o]);
      if (ev.tremolo) w.leaf("tremolo", ev.tremolo, { type: "single" });
      w.close("ornaments");
    }
    if (note.fingering !== undefined) {
      w.open("technical");
      w.leaf("fingering", note.fingering);
      w.close("technical");
    }
    if (a.isFirst && (ev.articulations?.length ?? 0) > 0) {
      w.open("articulations");
      for (const art of ev.articulations ?? []) w.leaf(ARTICULATION_ELEMENTS[art]);
      w.close("articulations");
    }
    if (fermata) {
      const placement = ctx.fermatas.get(ev.id);
      w.leaf("fermata", undefined, placement ? { placement } : undefined);
    }
    if (a.isFirst && ev.arpeggio) {
      w.leaf("arpeggiate", undefined, ev.arpeggio === "straight" ? undefined : { direction: ev.arpeggio });
    }
    w.close("notations");
  }

  if (a.isFirst && !a.grace) for (const lyric of ev.lyrics ?? []) writeLyric(w, lyric);
  w.close("note");
}

const ACCIDENTAL_NAMES: Record<string, string> = {
  "-2": "flat-flat",
  "-1": "flat",
  "0": "natural",
  "1": "sharp",
  "2": "double-sharp",
};

function accidentalFor(note: Note, key: KeySignature): { name: string; attrs?: Record<string, string> } | undefined {
  const name = ACCIDENTAL_NAMES[String(note.pitch.alter)];
  if (!name) return undefined;
  if (note.accidental === "none") return undefined;
  if (note.accidental === "cautionary-parens") return { name, attrs: { cautionary: "yes", parentheses: "yes" } };
  if (note.accidental === "courtesy") return { name, attrs: { cautionary: "yes" } };
  const keyed: Alter = keyAlter(key, note.pitch.step);
  if (note.accidental === "force" || note.pitch.alter !== keyed) return { name };
  return undefined;
}

function writeTimeModification(w: XmlWriter, fe: FlatEvent): void {
  if (!fe.timeMod) return;
  w.open("time-modification");
  w.leaf("actual-notes", fe.timeMod.actual);
  w.leaf("normal-notes", fe.timeMod.normal);
  w.close("time-modification");
}

function writeTupletNotations(w: XmlWriter, fe: FlatEvent): void {
  for (const stop of fe.stops) w.leaf("tuplet", undefined, { type: "stop", number: stop.number });
  for (const start of fe.starts) {
    const g = start.group;
    const attrs: Record<string, string | number> = { type: "start", number: start.number };
    if (g.bracket === "show") attrs["bracket"] = "yes";
    if (g.bracket === "hide") attrs["bracket"] = "no";
    if (g.showNumber === "none") attrs["show-number"] = "none";
    else if (g.showNumber === "actual") attrs["show-number"] = "actual";
    else if (g.showNumber === "ratio") attrs["show-number"] = "both";
    w.open("tuplet", attrs);
    w.open("tuplet-actual");
    w.leaf("tuplet-number", g.ratio.actual);
    w.leaf("tuplet-type", noteTypeName(g.ratio.unit));
    w.close("tuplet-actual");
    w.open("tuplet-normal");
    w.leaf("tuplet-number", g.ratio.normal);
    w.leaf("tuplet-type", noteTypeName(g.ratio.unit));
    w.close("tuplet-normal");
    w.close("tuplet");
  }
}

function writeLyric(w: XmlWriter, lyric: Lyric): void {
  w.open("lyric", { number: lyric.verse + 1 });
  w.leaf("syllabic", lyric.syllabic);
  w.leaf("text", lyric.text);
  if (lyric.extend) w.leaf("extend");
  w.close("lyric");
}
