/**
 * MusicXML (partwise) -> Score.
 *
 * The whole document is parsed into a raw, MusicXML-shaped intermediate first
 * (`RawPart`/`RawMeasure`), then assembled into a Score. Two phases are needed
 * because anchors, ottava transposition and measure lengths all depend on
 * information that only exists once every measure of every part has been read.
 *
 * Shape decisions:
 *  - several MusicXML parts become ONE model Part with one staff per MusicXML
 *    staff; a `<part-group>` supplies the Part's name and bracket symbol.
 *  - MusicXML voice numbers are renumbered densely from 0 per staff, in order of
 *    first appearance.
 *  - gaps left by `<backup>`/`<forward>` are filled with invisible rests.
 *  - unknown elements are ignored, never fatal.
 */
import { unzipSync, strFromU8 } from "fflate";
import {
  add,
  cmp,
  DEFAULT_SETTINGS,
  EMPTY_LAYOUT_HINTS,
  eq,
  FORMAT_VERSION,
  frac,
  lt,
  measureLength,
  newId,
  notated,
  notatedToFraction,
  sub,
  ZERO,
  type Alter,
  type Fraction,
  type Id,
  type KeySignature,
  type NotatedDuration,
  type NoteValue,
  type Pitch,
  type Step,
  type TimeSignature,
} from "@/model";
import type {
  Anchor,
  Articulation,
  Attachment,
  BarlineStyle,
  ClefKind,
  GraceGroup,
  Lyric,
  MeasureAttributes,
  Note,
  NoteEvent,
  Ornament,
  Part,
  PartMeasure,
  RestEvent,
  Score,
  Spanner,
  StaffDef,
  StaffGroupSymbol,
  StaffMeasure,
  StemDirection,
  TupletGroup,
  Voice,
  VoiceItem,
} from "@/model";
import { decomposeDuration } from "@/commands/rhythm";
import {
  ARTICULATION_BY_ELEMENT,
  clefKindFrom,
  fromDivisions,
  gcd,
  MusicXmlError,
  noteValueFromType,
  notatedFromFraction,
  NOTEHEADS,
  ORNAMENT_BY_ELEMENT,
  type NoteheadKind,
} from "./common";

type Placement = "above" | "below";

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function kids(el: Element, name: string): Element[] {
  const out: Element[] = [];
  for (const child of Array.from(el.children)) if (child.tagName === name) out.push(child);
  return out;
}

function kid(el: Element, name: string): Element | undefined {
  for (const child of Array.from(el.children)) if (child.tagName === name) return child;
  return undefined;
}

function text(el: Element | undefined): string {
  return el?.textContent?.trim() ?? "";
}

function childText(el: Element, name: string): string {
  return text(kid(el, name));
}

function childNum(el: Element, name: string): number | undefined {
  const t = childText(el, name);
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function attrNum(el: Element, name: string): number | undefined {
  const t = el.getAttribute(name);
  if (t === null || t.trim() === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------------------------
// Input decoding
// ---------------------------------------------------------------------------

function decodeInput(input: string | ArrayBuffer): string {
  if (typeof input === "string") return input;
  const bytes = new Uint8Array(input);
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return unzipMxl(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

function unzipMxl(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (e) {
    throw new MusicXmlError(`not a readable .mxl archive: ${(e as Error).message}`);
  }
  const container = files["META-INF/container.xml"];
  let path: string | undefined;
  if (container) {
    const doc = parseXml(strFromU8(container));
    const rootfile = doc.getElementsByTagName("rootfile")[0];
    path = rootfile?.getAttribute("full-path") ?? undefined;
  }
  if (!path || !files[path]) {
    path = Object.keys(files).find((f) => !f.startsWith("META-INF/") && /\.(musicxml|xml)$/i.test(f));
  }
  const entry = path ? files[path] : undefined;
  if (!entry) throw new MusicXmlError("the .mxl archive contains no MusicXML root file");
  return strFromU8(entry);
}

function parseXml(xml: string): Document {
  if (typeof DOMParser === "undefined") {
    throw new MusicXmlError("no DOMParser available; MusicXML parsing needs a browser or jsdom environment");
  }
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const error = doc.getElementsByTagName("parsererror")[0];
  if (error) throw new MusicXmlError(`XML parse error: ${(error.textContent ?? "unknown").trim()}`);
  return doc;
}

// ---------------------------------------------------------------------------
// Raw (MusicXML-shaped) intermediate
// ---------------------------------------------------------------------------

interface RawNote {
  pitch: Pitch;
  tieStart: boolean;
  accidental?: "force" | "courtesy" | "cautionary-parens";
  fingering?: string;
  notehead?: NoteheadKind;
}

interface TupletStart {
  number: number;
  actual?: number;
  normal?: number;
  unit?: NoteValue;
  bracket?: "show" | "hide";
  showNumber?: "actual" | "ratio" | "none";
}

interface RawEvent {
  id: Id;
  kind: "note" | "rest";
  offset: Fraction;
  length: Fraction;
  duration: NotatedDuration;
  notes: RawNote[];
  measureRest: boolean;
  invisible: boolean;
  lyrics: Lyric[];
  articulations: Articulation[];
  ornaments: Ornament[];
  stem?: StemDirection;
  arpeggio?: "up" | "down" | "straight";
  tremolo?: 1 | 2 | 3;
  fermata?: { placement?: Placement };
  dynamics?: string;
  grace?: GraceGroup;
  timeMod?: { actual: number; normal: number };
  tupletStarts: TupletStart[];
  tupletStops: number[];
  slurs: { type: "start" | "stop"; number: number; placement?: Placement }[];
  /** Staff index within the MusicXML part (0-based). */
  staff: number;
  voice: string;
}

interface RawDirection {
  staff: number;
  pos: Fraction;
  placement?: Placement;
  words: string[];
  metronome?: { beatUnit: NotatedDuration; bpm: number };
  dynamics?: string;
  wedge?: { type: "crescendo" | "diminuendo" | "stop"; number: number };
  pedal?: { type: string; line: boolean };
  octaveShift?: { type: "up" | "down" | "stop"; size: number; number: number };
  rehearsal?: string;
}

interface RawMeasure {
  number?: number;
  implicit: boolean;
  timeSig?: TimeSignature;
  keySig?: KeySignature;
  /** Clefs seen in this measure, by staff index within the part. */
  clefs: { staff: number; at: Fraction; clef: ClefKind }[];
  events: RawEvent[];
  directions: RawDirection[];
  barline?: BarlineStyle;
  startBarline?: "repeat-start";
  ending?: { numbers: number[]; type: "start" | "stop" | "discontinue" };
  newSystem: boolean;
  newPage: boolean;
}

interface RawPart {
  id: string;
  name: string;
  abbreviation?: string;
  midiProgram?: number;
  staffCount: number;
  measures: RawMeasure[];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parsePitch(el: Element): Pitch {
  const step = (childText(el, "step").toUpperCase() || "C") as Step;
  const rawAlter = childNum(el, "alter") ?? 0;
  const alter = Math.max(-2, Math.min(2, Math.round(rawAlter))) as Alter;
  const octave = childNum(el, "octave") ?? 4;
  return { step, alter, octave };
}

function parseLyric(el: Element): Lyric | undefined {
  const number = el.getAttribute("number") ?? "1";
  const digits = /\d+/.exec(number);
  const verse = Math.max(0, (digits ? Number(digits[0]) : 1) - 1);
  const texts = kids(el, "text").map((t) => text(t));
  if (texts.length === 0) return undefined;
  const elisions = kids(el, "elision").map((e) => text(e) || " ");
  let joined = texts[0] ?? "";
  for (let i = 1; i < texts.length; i++) joined += `${elisions[i - 1] ?? " "}${texts[i]}`;
  const syllabicText = childText(el, "syllabic");
  const syllabic: Lyric["syllabic"] =
    syllabicText === "begin" || syllabicText === "middle" || syllabicText === "end" ? syllabicText : "single";
  const extend = kid(el, "extend") !== undefined;
  return { verse, text: joined, syllabic, ...(extend ? { extend: true } : {}) };
}

function parseNotations(ev: RawEvent, note: Element): void {
  for (const notations of kids(note, "notations")) {
    for (const slur of kids(notations, "slur")) {
      const type = slur.getAttribute("type");
      if (type !== "start" && type !== "stop") continue;
      const placement = slur.getAttribute("placement");
      ev.slurs.push({
        type,
        number: attrNum(slur, "number") ?? 1,
        ...(placement === "above" || placement === "below" ? { placement } : {}),
      });
    }
    for (const tuplet of kids(notations, "tuplet")) {
      const type = tuplet.getAttribute("type");
      const number = attrNum(tuplet, "number") ?? 1;
      if (type === "stop") {
        ev.tupletStops.push(number);
        continue;
      }
      if (type !== "start") continue;
      const actualEl = kid(tuplet, "tuplet-actual");
      const normalEl = kid(tuplet, "tuplet-normal");
      const bracket = tuplet.getAttribute("bracket");
      const showNumber = tuplet.getAttribute("show-number");
      const start: TupletStart = { number };
      const actual = actualEl ? childNum(actualEl, "tuplet-number") : undefined;
      const normal = normalEl ? childNum(normalEl, "tuplet-number") : undefined;
      const unit = actualEl ? noteValueFromType(childText(actualEl, "tuplet-type")) : undefined;
      if (actual !== undefined && actual > 0) start.actual = actual;
      if (normal !== undefined && normal > 0) start.normal = normal;
      if (unit !== undefined) start.unit = unit;
      if (bracket === "yes") start.bracket = "show";
      else if (bracket === "no") start.bracket = "hide";
      if (showNumber === "none") start.showNumber = "none";
      else if (showNumber === "actual") start.showNumber = "actual";
      else if (showNumber === "both") start.showNumber = "ratio";
      ev.tupletStarts.push(start);
    }
    for (const articulations of kids(notations, "articulations")) {
      for (const child of Array.from(articulations.children)) {
        const art = ARTICULATION_BY_ELEMENT[child.tagName];
        if (art && !ev.articulations.includes(art)) ev.articulations.push(art);
      }
    }
    for (const ornaments of kids(notations, "ornaments")) {
      for (const child of Array.from(ornaments.children)) {
        const orn = ORNAMENT_BY_ELEMENT[child.tagName];
        if (orn && !ev.ornaments.includes(orn)) ev.ornaments.push(orn);
        if (child.tagName === "tremolo") {
          const marks = Number(text(child));
          if (marks === 1 || marks === 2 || marks === 3) ev.tremolo = marks;
        }
      }
    }
    const fermata = kid(notations, "fermata");
    if (fermata) {
      const placement = fermata.getAttribute("placement");
      ev.fermata = placement === "above" || placement === "below" ? { placement } : {};
    }
    const arpeggiate = kid(notations, "arpeggiate");
    if (arpeggiate) {
      const dir = arpeggiate.getAttribute("direction");
      ev.arpeggio = dir === "up" ? "up" : dir === "down" ? "down" : "straight";
    }
    const dynamics = kid(notations, "dynamics");
    if (dynamics) {
      const first = dynamics.children[0];
      if (first) ev.dynamics = first.tagName === "other-dynamics" ? text(first) : first.tagName;
    }
  }
}

function parseNoteHead(value: string): NoteheadKind | undefined {
  return (NOTEHEADS as readonly string[]).includes(value) ? (value as NoteheadKind) : undefined;
}

function parseTechnical(note: Element): string | undefined {
  for (const notations of kids(note, "notations")) {
    for (const technical of kids(notations, "technical")) {
      const f = kid(technical, "fingering");
      if (f) return text(f);
    }
  }
  return undefined;
}

interface PartParseState {
  divisions: number;
  staffCount: number;
}

function parseMeasureElement(el: Element, state: PartParseState): RawMeasure {
  const numberAttr = el.getAttribute("number");
  const parsedNumber = numberAttr !== null && /^-?\d+$/.test(numberAttr.trim()) ? Number(numberAttr) : undefined;
  const m: RawMeasure = {
    ...(parsedNumber !== undefined ? { number: parsedNumber } : {}),
    implicit: el.getAttribute("implicit") === "yes",
    clefs: [],
    events: [],
    directions: [],
    newSystem: false,
    newPage: false,
  };

  let cur: Fraction = ZERO;
  /** The last non-grace event appended, per staff+voice, so `<chord/>` can join it. */
  const lastEvent = new Map<string, RawEvent>();
  let pendingGrace: { events: NoteEvent[]; slash: boolean } | undefined;

  for (const child of Array.from(el.children)) {
    switch (child.tagName) {
      case "print": {
        if (child.getAttribute("new-system") === "yes") m.newSystem = true;
        if (child.getAttribute("new-page") === "yes") m.newPage = true;
        break;
      }
      case "attributes": {
        const div = childNum(child, "divisions");
        if (div && div > 0) state.divisions = div;
        const staves = childNum(child, "staves");
        if (staves && staves > state.staffCount) state.staffCount = staves;
        const keyEl = kid(child, "key");
        if (keyEl) {
          const fifths = childNum(keyEl, "fifths") ?? 0;
          const mode = childText(keyEl, "mode");
          m.keySig = { fifths, mode: mode === "minor" ? "minor" : "major" };
        }
        const timeEl = kid(child, "time");
        if (timeEl) {
          const beats = childNum(timeEl, "beats");
          const beatType = childNum(timeEl, "beat-type");
          if (beats && beatType && [1, 2, 4, 8, 16, 32, 64, 128, 256].includes(beatType)) {
            m.timeSig = { numerator: beats, denominator: beatType as NoteValue };
          }
        }
        for (const clefEl of kids(child, "clef")) {
          const staff = (attrNum(clefEl, "number") ?? 1) - 1;
          const clef = clefKindFrom(childText(clefEl, "sign"), childNum(clefEl, "line"), childNum(clefEl, "clef-octave-change") ?? 0);
          if (clef) m.clefs.push({ staff: Math.max(0, staff), at: cur, clef });
          if (staff + 1 > state.staffCount) state.staffCount = staff + 1;
        }
        break;
      }
      case "backup": {
        const d = childNum(child, "duration") ?? 0;
        cur = sub(cur, fromDivisions(d, state.divisions));
        if (lt(cur, ZERO)) cur = ZERO;
        break;
      }
      case "forward": {
        const d = childNum(child, "duration") ?? 0;
        cur = add(cur, fromDivisions(d, state.divisions));
        break;
      }
      case "direction": {
        const dir = parseDirection(child, cur, state.divisions);
        if (dir) m.directions.push(dir);
        break;
      }
      case "barline": {
        applyBarline(m, child);
        break;
      }
      case "note": {
        const staff = Math.max(0, (childNum(child, "staff") ?? 1) - 1);
        if (staff + 1 > state.staffCount) state.staffCount = staff + 1;
        const voice = childText(child, "voice") || "1";
        const isGrace = kid(child, "grace") !== undefined;
        const isChord = kid(child, "chord") !== undefined;
        const restEl = kid(child, "rest");
        const key = `${staff}/${voice}`;

        if (isGrace) {
          const graceEvent = buildGraceNote(child);
          if (!graceEvent) break;
          const slash = kid(child, "grace")?.getAttribute("slash") === "yes";
          if (isChord && pendingGrace && pendingGrace.events.length > 0) {
            const last = pendingGrace.events[pendingGrace.events.length - 1]!;
            last.notes = [...last.notes, ...graceEvent.notes].sort(comparePitchNote);
          } else {
            pendingGrace ??= { events: [], slash };
            pendingGrace.slash = pendingGrace.slash || slash;
            pendingGrace.events.push(graceEvent);
          }
          break;
        }

        const durationDiv = childNum(child, "duration") ?? 0;
        const length = fromDivisions(durationDiv, state.divisions);

        if (isChord) {
          const prev = lastEvent.get(key);
          if (prev && prev.kind === "note") {
            const parsed = parseNoteBody(child);
            if (parsed) prev.notes.push(parsed);
            parseNotations(prev, child);
            const lyric = kids(child, "lyric").map(parseLyric);
            for (const l of lyric) if (l) prev.lyrics.push(l);
          }
          break;
        }

        const typeValue = noteValueFromType(childText(child, "type"));
        const timeModEl = kid(child, "time-modification");
        const timeMod = timeModEl
          ? {
              actual: childNum(timeModEl, "actual-notes") ?? 1,
              normal: childNum(timeModEl, "normal-notes") ?? 1,
            }
          : undefined;
        const dots = Math.min(3, kids(child, "dot").length) as 0 | 1 | 2 | 3;
        const notatedLen = timeMod
          ? frac(length.num * timeMod.actual, length.den * timeMod.normal)
          : length;
        const duration: NotatedDuration = typeValue
          ? { base: typeValue, dots }
          : eq(notatedLen, ZERO)
            ? notated(4)
            : notatedFromFraction(notatedLen);

        const stemText = childText(child, "stem");
        const noteheadText = childText(child, "notehead");
        const ev: RawEvent = {
          id: newId(),
          kind: restEl ? "rest" : "note",
          offset: cur,
          length,
          duration,
          notes: [],
          measureRest: restEl?.getAttribute("measure") === "yes",
          invisible: child.getAttribute("print-object") === "no",
          lyrics: [],
          articulations: [],
          ornaments: [],
          ...(stemText === "up" || stemText === "down" ? { stem: stemText as StemDirection } : {}),
          ...(timeMod && (timeMod.actual !== 1 || timeMod.normal !== 1) ? { timeMod } : {}),
          tupletStarts: [],
          tupletStops: [],
          slurs: [],
          staff,
          voice,
        };
        if (!restEl) {
          const parsed = parseNoteBody(child);
          if (parsed) {
            if (noteheadText) {
              const nh = parseNoteHead(noteheadText);
              if (nh && nh !== "normal") parsed.notehead = nh;
            }
            ev.notes.push(parsed);
          }
        }
        parseNotations(ev, child);
        for (const l of kids(child, "lyric").map(parseLyric)) if (l) ev.lyrics.push(l);
        if (pendingGrace && pendingGrace.events.length > 0 && ev.kind === "note") {
          ev.grace = { id: newId(), events: pendingGrace.events, slash: pendingGrace.slash };
        }
        pendingGrace = undefined;

        m.events.push(ev);
        lastEvent.set(key, ev);
        cur = add(cur, length);
        break;
      }
      default:
        break; // harmony, figured-bass, sound, bookmark, ...: ignored
    }
  }
  return m;
}

function comparePitchNote(a: Note, b: Note): number {
  const midi = (p: Pitch) => (p.octave + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[p.step] + p.alter;
  return midi(a.pitch) - midi(b.pitch);
}

function parseNoteBody(note: Element): RawNote | undefined {
  const pitchEl = kid(note, "pitch") ?? kid(note, "unpitched");
  const pitch: Pitch = pitchEl
    ? pitchEl.tagName === "pitch"
      ? parsePitch(pitchEl)
      : {
          step: (childText(pitchEl, "display-step").toUpperCase() || "C") as Step,
          alter: 0,
          octave: childNum(pitchEl, "display-octave") ?? 4,
        }
    : { step: "C", alter: 0, octave: 4 };
  const tieStart = kids(note, "tie").some((t) => t.getAttribute("type") === "start");
  const accEl = kid(note, "accidental");
  let accidental: RawNote["accidental"];
  if (accEl) {
    const parens = accEl.getAttribute("parentheses") === "yes" || accEl.getAttribute("bracket") === "yes";
    const cautionary = accEl.getAttribute("cautionary") === "yes";
    accidental = parens ? "cautionary-parens" : cautionary ? "courtesy" : "force";
  }
  const fingering = parseTechnical(note);
  const noteheadText = childText(note, "notehead");
  const notehead = noteheadText ? parseNoteHead(noteheadText) : undefined;
  return {
    pitch,
    tieStart,
    ...(accidental ? { accidental } : {}),
    ...(fingering !== undefined && fingering !== "" ? { fingering } : {}),
    ...(notehead && notehead !== "normal" ? { notehead } : {}),
  };
}

function buildGraceNote(note: Element): NoteEvent | undefined {
  const parsed = parseNoteBody(note);
  if (!parsed) return undefined;
  const base = noteValueFromType(childText(note, "type")) ?? 8;
  const dots = Math.min(3, kids(note, "dot").length) as 0 | 1 | 2 | 3;
  return {
    kind: "note",
    id: newId(),
    duration: { base, dots },
    notes: [toModelNote(parsed)],
  };
}

function toModelNote(raw: RawNote): Note {
  return {
    id: newId(),
    pitch: raw.pitch,
    ...(raw.tieStart ? { tieStart: true } : {}),
    ...(raw.accidental ? { accidental: raw.accidental } : {}),
    ...(raw.fingering !== undefined ? { fingering: raw.fingering } : {}),
    ...(raw.notehead ? { notehead: raw.notehead } : {}),
  };
}

function parseDirection(el: Element, cur: Fraction, divisions: number): RawDirection | undefined {
  const placementAttr = el.getAttribute("placement");
  const offsetDiv = childNum(el, "offset") ?? 0;
  const staff = Math.max(0, (childNum(el, "staff") ?? 1) - 1);
  const dir: RawDirection = {
    staff,
    pos: add(cur, fromDivisions(offsetDiv, divisions)),
    ...(placementAttr === "above" || placementAttr === "below" ? { placement: placementAttr } : {}),
    words: [],
  };
  let any = false;
  for (const dt of kids(el, "direction-type")) {
    for (const child of Array.from(dt.children)) {
      switch (child.tagName) {
        case "words":
          dir.words.push(text(child));
          any = true;
          break;
        case "rehearsal":
          dir.rehearsal = text(child);
          any = true;
          break;
        case "metronome": {
          const unit = noteValueFromType(childText(child, "beat-unit"));
          const perMinute = childNum(child, "per-minute");
          if (unit && perMinute !== undefined) {
            const dots = Math.min(3, kids(child, "beat-unit-dot").length) as 0 | 1 | 2 | 3;
            dir.metronome = { beatUnit: { base: unit, dots }, bpm: perMinute };
            any = true;
          }
          break;
        }
        case "dynamics": {
          const first = child.children[0];
          if (first) {
            dir.dynamics = first.tagName === "other-dynamics" ? text(first) : first.tagName;
            any = true;
          }
          break;
        }
        case "wedge": {
          const type = child.getAttribute("type");
          if (type === "crescendo" || type === "diminuendo" || type === "stop") {
            dir.wedge = { type, number: attrNum(child, "number") ?? 1 };
            any = true;
          }
          break;
        }
        case "pedal": {
          const type = child.getAttribute("type") ?? "";
          dir.pedal = { type, line: child.getAttribute("line") === "yes" };
          any = true;
          break;
        }
        case "octave-shift": {
          const type = child.getAttribute("type");
          if (type === "up" || type === "down" || type === "stop") {
            dir.octaveShift = { type, size: attrNum(child, "size") ?? 8, number: attrNum(child, "number") ?? 1 };
            any = true;
          }
          break;
        }
        default:
          break;
      }
    }
  }
  return any ? dir : undefined;
}

function applyBarline(m: RawMeasure, el: Element): void {
  const location = el.getAttribute("location") ?? "right";
  const style = childText(el, "bar-style");
  const repeat = kid(el, "repeat");
  const direction = repeat?.getAttribute("direction");
  const ending = kid(el, "ending");

  if (location === "left") {
    if (direction === "forward") m.startBarline = "repeat-start";
  } else {
    if (direction === "backward") m.barline = "repeat-end";
    else if (style === "light-heavy") m.barline = "final";
    else if (style === "light-light") m.barline = "double";
    else if (style === "dashed" || style === "short" || style === "tick") m.barline = "dashed";
    else if (style === "none") m.barline = "invisible";
  }

  if (ending) {
    const type = ending.getAttribute("type");
    const numbers = (ending.getAttribute("number") ?? "")
      .split(/[,\s]+/)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (type === "start") {
      m.ending = { numbers: numbers.length ? numbers : [1], type: "start" };
    } else if ((type === "stop" || type === "discontinue") && m.ending === undefined) {
      m.ending = { numbers: numbers.length ? numbers : [1], type: type === "stop" ? "stop" : "discontinue" };
    }
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

interface StaffRef {
  partIndex: number; // index into RawPart[]
  staff: number; // staff index within that MusicXML part
}

interface BuiltEvent {
  id: Id;
  offset: Fraction;
  length: Fraction;
}

export function importMusicXml(input: string | ArrayBuffer): Score {
  const doc = parseXml(decodeInput(input));
  const root = doc.documentElement;
  if (!root) throw new MusicXmlError("empty MusicXML document");
  if (root.tagName === "score-timewise") {
    throw new MusicXmlError("timewise MusicXML is not supported; convert to score-partwise first");
  }
  if (root.tagName !== "score-partwise") {
    throw new MusicXmlError(`expected a <score-partwise> root element, found <${root.tagName}>`);
  }

  // --- header ---
  const workTitle = text(kid(kid(root, "work") ?? root, "work-title"));
  const movementTitle = childText(root, "movement-title");
  const title = workTitle || movementTitle;
  const identification = kid(root, "identification");
  let composer = "";
  let lyricist = "";
  let copyright = "";
  if (identification) {
    for (const creator of kids(identification, "creator")) {
      const type = creator.getAttribute("type");
      if (type === "composer" && !composer) composer = text(creator);
      if ((type === "lyricist" || type === "poet") && !lyricist) lyricist = text(creator);
    }
    copyright = childText(identification, "rights");
  }

  // --- part list ---
  const partList = kid(root, "part-list");
  const partInfo = new Map<string, { name: string; abbreviation?: string; midiProgram?: number }>();
  let groupName: string | undefined;
  let groupAbbrev: string | undefined;
  let groupSymbol: StaffGroupSymbol | undefined;
  if (partList) {
    for (const child of Array.from(partList.children)) {
      if (child.tagName === "score-part") {
        const id = child.getAttribute("id") ?? "";
        const name = childText(child, "part-name");
        const abbreviation = childText(child, "part-abbreviation");
        // MusicXML numbers programs 1-128; the model uses 0-127.
        const midiInstrument = kid(child, "midi-instrument");
        const program = midiInstrument ? childNum(midiInstrument, "midi-program") : undefined;
        const midiProgram = program !== undefined && program >= 1 && program <= 128 ? program - 1 : undefined;
        partInfo.set(id, {
          name,
          ...(abbreviation ? { abbreviation } : {}),
          ...(midiProgram !== undefined ? { midiProgram } : {}),
        });
      } else if (child.tagName === "part-group" && child.getAttribute("type") === "start") {
        const symbol = childText(child, "group-symbol");
        if (groupSymbol === undefined) {
          groupSymbol = symbol === "brace" ? "brace" : symbol === "none" ? "none" : "bracket";
          const gn = childText(child, "group-name");
          const ga = childText(child, "group-abbreviation");
          if (gn) groupName = gn;
          if (ga) groupAbbrev = ga;
        }
      }
    }
  }

  // --- parts ---
  const rawParts: RawPart[] = [];
  for (const partEl of kids(root, "part")) {
    const id = partEl.getAttribute("id") ?? `P${rawParts.length + 1}`;
    const info = partInfo.get(id);
    const state: PartParseState = { divisions: 1, staffCount: 1 };
    const measures = kids(partEl, "measure").map((m) => parseMeasureElement(m, state));
    rawParts.push({
      id,
      name: info?.name ?? id,
      ...(info?.abbreviation ? { abbreviation: info.abbreviation } : {}),
      ...(info?.midiProgram !== undefined ? { midiProgram: info.midiProgram } : {}),
      staffCount: state.staffCount,
      measures,
    });
  }
  if (rawParts.length === 0) throw new MusicXmlError("the score has no <part> elements");

  // --- staff plan ---
  const staffRefs: StaffRef[] = [];
  for (const [partIndex, rp] of rawParts.entries()) {
    for (let s = 0; s < rp.staffCount; s++) staffRefs.push({ partIndex, staff: s });
  }
  const staffIndexOf = (partIndex: number, staff: number): number =>
    staffRefs.findIndex((r) => r.partIndex === partIndex && r.staff === Math.min(staff, rawParts[partIndex]!.staffCount - 1));

  const measureCount = Math.max(...rawParts.map((p) => p.measures.length));

  // --- global measure attributes ---
  const measures: MeasureAttributes[] = [];
  let timeSig: TimeSignature = { numerator: 4, denominator: 4 };
  let keySig: KeySignature = { fifths: 0, mode: "major" };
  const measureLengths: Fraction[] = [];
  const measureStarts: Fraction[] = [];
  const systemBreaks: number[] = [];
  const pageBreaks: number[] = [];
  let abs: Fraction = ZERO;
  let runningNumber = 0;

  for (let mi = 0; mi < measureCount; mi++) {
    const sources = rawParts.map((p) => p.measures[mi]).filter((m): m is RawMeasure => m !== undefined);
    const first = sources[0];
    const newTime = sources.find((s) => s.timeSig)?.timeSig;
    const newKey = sources.find((s) => s.keySig)?.keySig;
    const changedTime = newTime && (mi === 0 || newTime.numerator !== timeSig.numerator || newTime.denominator !== timeSig.denominator);
    const changedKey = newKey && (mi === 0 || newKey.fifths !== keySig.fifths || newKey.mode !== keySig.mode);
    if (newTime) timeSig = newTime;
    if (newKey) keySig = newKey;

    const implicit = sources.some((s) => s.implicit);
    const content = maxContentLength(rawParts, mi);
    const nominal = measureLength(timeSig);
    const length = (implicit || (content && cmp(content, nominal) !== 0)) && content && cmp(content, ZERO) > 0 ? content : nominal;

    if (implicit) {
      if (mi > 0 && runningNumber === 0) runningNumber = 1;
    } else {
      runningNumber += 1;
    }
    const declared = first?.number;
    const numberOverride = declared !== undefined && declared !== runningNumber ? declared : undefined;

    const barline = sources.find((s) => s.barline)?.barline;
    const startBarline = sources.find((s) => s.startBarline)?.startBarline;
    const ending = sources.find((s) => s.ending)?.ending;
    const rehearsal = sources.flatMap((s) => s.directions).find((d) => d.rehearsal !== undefined)?.rehearsal;

    measures.push({
      id: newId(),
      ...(changedTime || mi === 0 ? { timeSig } : {}),
      ...(changedKey || mi === 0 ? { keySig } : {}),
      ...(barline ? { barline } : {}),
      ...(startBarline ? { startBarline } : {}),
      ...(ending ? { ending } : {}),
      ...(rehearsal ? { rehearsalMark: rehearsal } : {}),
      ...(cmp(length, nominal) !== 0 ? { actualLength: length } : {}),
      ...(numberOverride !== undefined ? { numberOverride } : {}),
    });
    measureLengths.push(length);
    measureStarts.push(abs);
    abs = add(abs, length);
    if (mi > 0 && sources.some((s) => s.newSystem)) systemBreaks.push(mi);
    if (mi > 0 && sources.some((s) => s.newPage)) pageBreaks.push(mi);
  }

  // --- ottava spans (needed before notes are built: model pitches are written pitches) ---
  const ottavaSpans = collectOttavaSpans(rawParts, staffIndexOf, measureStarts);
  const writtenShift = (staffIndex: number, mi: number, offset: Fraction): number => {
    const at = add(measureStarts[mi] ?? ZERO, offset);
    for (const span of ottavaSpans) {
      if (span.staffIndex !== staffIndex) continue;
      if (cmp(at, span.from) >= 0 && cmp(at, span.to) < 0) return -span.octaves;
    }
    return 0;
  };

  // --- voice numbering, per staff, in order of first appearance ---
  const voiceOrder = new Map<number, string[]>();
  for (const [partIndex, rp] of rawParts.entries()) {
    for (const rm of rp.measures) {
      for (const ev of rm.events) {
        const si = staffIndexOf(partIndex, ev.staff);
        const list = voiceOrder.get(si) ?? [];
        if (!list.includes(ev.voice)) {
          list.push(ev.voice);
          voiceOrder.set(si, list);
        }
      }
    }
  }

  // --- staves ---
  const initialClefs = new Map<number, ClefKind>();
  for (const [partIndex, rp] of rawParts.entries()) {
    const firstMeasure = rp.measures[0];
    for (const c of firstMeasure?.clefs ?? []) {
      const si = staffIndexOf(partIndex, c.staff);
      if (cmp(c.at, ZERO) === 0 && !initialClefs.has(si)) initialClefs.set(si, c.clef);
    }
  }
  const multiPart = rawParts.length > 1;
  const staves: StaffDef[] = staffRefs.map((ref, si) => {
    const rp = rawParts[ref.partIndex]!;
    const named = multiPart && rp.staffCount === 1;
    return {
      id: newId(),
      lines: 5,
      initialClef: initialClefs.get(si) ?? (si > 0 ? "bass" : "treble"),
      ...(named && rp.name ? { name: rp.name } : {}),
      ...(named && rp.abbreviation ? { abbreviation: rp.abbreviation } : {}),
    };
  });

  // --- measure content ---
  const builtEvents = new Map<string, BuiltEvent[]>(); // `${staffIndex}/${measureIndex}`
  const partMeasures: PartMeasure[] = [];
  for (let mi = 0; mi < measureCount; mi++) {
    const target = measureLengths[mi] ?? measureLength(timeSig);
    const staffMeasures: StaffMeasure[] = staffRefs.map((ref, si) => {
      const rm = rawParts[ref.partIndex]!.measures[mi];
      const events = (rm?.events ?? []).filter(
        (e) => staffIndexOf(ref.partIndex, e.staff) === si,
      );
      const clefChanges = (rm?.clefs ?? [])
        .filter((c) => staffIndexOf(ref.partIndex, c.staff) === si)
        .filter((c) => !(mi === 0 && cmp(c.at, ZERO) === 0))
        .map((c) => ({ at: c.at, clef: c.clef }));
      const order = voiceOrder.get(si) ?? [];
      const voiceKeys = order.filter((v) => events.some((e) => e.voice === v));
      const usedKeys = voiceKeys.length > 0 ? voiceKeys : [order[0] ?? "1"];
      const voices: Voice[] = usedKeys.map((key, vi) => {
        const own = events.filter((e) => e.voice === key).sort((a, b) => cmp(a.offset, b.offset));
        const items = buildVoiceItems(own, target, si, mi, writtenShift);
        const positions: BuiltEvent[] = [];
        collectPositions(items, ZERO, frac(1), positions);
        const bucket = builtEvents.get(`${si}/${mi}`) ?? [];
        bucket.push(...positions);
        builtEvents.set(`${si}/${mi}`, bucket);
        return { id: newId(), index: vi, items };
      });
      return { ...(clefChanges.length ? { clefChanges } : {}), voices };
    });
    partMeasures.push({ staves: staffMeasures });
  }

  // --- spanners and attachments ---
  const anchorAt = (staffIndex: number, mi: number, pos: Fraction, which: "start" | "end"): Anchor => {
    const bucket = builtEvents.get(`${staffIndex}/${mi}`) ?? [];
    for (const e of bucket) {
      const at = which === "start" ? e.offset : add(e.offset, e.length);
      if (cmp(at, pos) === 0) return { kind: "event", eventId: e.id };
    }
    return { kind: "measure", measureIndex: mi, offset: pos };
  };

  const spanners: Spanner[] = [];
  const attachments: Attachment[] = [];
  buildSlurs(rawParts, staffIndexOf, spanners);
  buildNoteAttachments(rawParts, staffIndexOf, attachments);
  buildDirections(rawParts, staffIndexOf, anchorAt, spanners, attachments);

  const part: Part = {
    id: newId(),
    name: multiPart ? (groupName ?? "Score") : (rawParts[0]!.name || "Part"),
    ...(multiPart
      ? groupAbbrev
        ? { abbreviation: groupAbbrev }
        : {}
      : rawParts[0]!.abbreviation
        ? { abbreviation: rawParts[0]!.abbreviation }
        : {}),
    ...(staves.length >= 2 ? { bracket: groupSymbol ?? "brace" } : {}),
    staves,
    measures: partMeasures,
    // Parts are merged into one, so the first part that names a program sets it.
    midiProgram: rawParts.find((rp) => rp.midiProgram !== undefined)?.midiProgram ?? 0,
  };

  return {
    formatVersion: FORMAT_VERSION,
    id: newId(),
    meta: {
      ...(title ? { title } : {}),
      ...(composer ? { composer } : {}),
      ...(lyricist ? { lyricist } : {}),
      ...(copyright ? { copyright } : {}),
    },
    settings: readSettings(root),
    measures,
    parts: [part],
    spanners,
    attachments,
    layout: { ...structuredClone(EMPTY_LAYOUT_HINTS), systemBreaks, pageBreaks },
  };
}

function readSettings(root: Element): Score["settings"] {
  const settings = structuredClone(DEFAULT_SETTINGS);
  const defaults = kid(root, "defaults");
  if (!defaults) return settings;
  const scaling = kid(defaults, "scaling");
  const mm = scaling ? childNum(scaling, "millimeters") : undefined;
  const tenths = scaling ? childNum(scaling, "tenths") : undefined;
  let mmPerTenth: number | undefined;
  if (mm !== undefined && tenths !== undefined && tenths > 0 && mm > 0) {
    mmPerTenth = mm / tenths;
    settings.staffSpaceMm = Math.round((mmPerTenth * 10) * 100000) / 100000;
  }
  const page = kid(defaults, "page-layout");
  if (page && mmPerTenth !== undefined) {
    const h = childNum(page, "page-height");
    const wd = childNum(page, "page-width");
    const round = (n: number) => Math.round(n * 100000) / 100000;
    if (h !== undefined && h > 0) settings.page.heightMm = round(h * mmPerTenth);
    if (wd !== undefined && wd > 0) settings.page.widthMm = round(wd * mmPerTenth);
    const margins = kids(page, "page-margins")[0];
    if (margins) {
      const get = (name: string) => {
        const v = childNum(margins, name);
        return v === undefined ? undefined : round(v * mmPerTenth);
      };
      settings.page.marginMm = {
        left: get("left-margin") ?? settings.page.marginMm.left,
        right: get("right-margin") ?? settings.page.marginMm.right,
        top: get("top-margin") ?? settings.page.marginMm.top,
        bottom: get("bottom-margin") ?? settings.page.marginMm.bottom,
      };
    }
  }
  return settings;
}

/** Longest voice content in a measure across every part, ignoring whole-measure rests. */
function maxContentLength(rawParts: RawPart[], mi: number): Fraction | undefined {
  let best: Fraction | undefined;
  for (const rp of rawParts) {
    const rm = rp.measures[mi];
    if (!rm) continue;
    const byVoice = new Map<string, Fraction>();
    for (const ev of rm.events) {
      if (ev.measureRest) continue;
      const key = `${ev.staff}/${ev.voice}`;
      const end = add(ev.offset, ev.length);
      const prev = byVoice.get(key);
      if (!prev || cmp(end, prev) > 0) byVoice.set(key, end);
    }
    for (const end of byVoice.values()) if (!best || cmp(end, best) > 0) best = end;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Voice building
// ---------------------------------------------------------------------------

type ShiftLookup = (staffIndex: number, mi: number, offset: Fraction) => number;

function buildVoiceItems(
  events: RawEvent[],
  target: Fraction,
  staffIndex: number,
  measureIndex: number,
  shift: ShiftLookup,
): VoiceItem[] {
  if (events.length === 0) return [measureRestItem()];
  if (events.length === 1 && events[0]!.measureRest) {
    return [measureRestItem(events[0]!.id, events[0]!.invisible)];
  }

  synthesizeTupletGroups(events);

  const root: VoiceItem[] = [];
  const rootStarts: Fraction[] = [];
  const stack: { number: number; group: TupletGroup }[] = [];
  const container = (): VoiceItem[] => (stack.length ? stack[stack.length - 1]!.group.items : root);

  for (const ev of events) {
    for (const start of ev.tupletStarts) {
      const outer = stack.reduce(
        (acc, s) => ({ actual: acc.actual * s.group.ratio.actual, normal: acc.normal * s.group.ratio.normal }),
        { actual: 1, normal: 1 },
      );
      const group = makeTupletGroup(start, ev, outer);
      if (stack.length === 0) {
        rootStarts.push(ev.offset);
        root.push(group);
      } else {
        container().push(group);
      }
      stack.push({ number: start.number, group });
    }

    const item = makeEvent(ev, staffIndex, measureIndex, shift);
    if (stack.length === 0) {
      rootStarts.push(ev.offset);
      root.push(item);
    } else {
      container().push(item);
    }

    for (const stop of ev.tupletStops) {
      const at = stack.map((s) => s.number).lastIndexOf(stop);
      if (at >= 0) stack.length = at;
      else stack.pop();
    }
  }
  // Any tuplet left open simply ends here.
  stack.length = 0;

  // Drop tuplets that ended up empty (their notes were malformed).
  for (let i = root.length - 1; i >= 0; i--) {
    const item = root[i]!;
    if (item.kind === "tuplet" && item.items.length === 0) {
      root.splice(i, 1);
      rootStarts.splice(i, 1);
    }
  }

  fillGaps(root, rootStarts, events, target);

  if (canCollapseToMeasureRest(root, events)) return [measureRestItem()];
  return root;
}

function measureRestItem(id?: Id, invisible = false): RestEvent {
  return {
    kind: "rest",
    id: id ?? newId(),
    duration: notated(1),
    measureRest: true,
    ...(invisible ? { invisible: true } : {}),
  };
}

/** True when every item is a plain rest carrying nothing that a collapse would lose. */
function canCollapseToMeasureRest(items: VoiceItem[], events: RawEvent[]): boolean {
  if (items.length === 0) return true;
  if (!items.every((i) => i.kind === "rest")) return false;
  return !events.some((e) => e.kind === "note" || e.fermata || e.dynamics || e.slurs.length > 0);
}

function makeTupletGroup(
  start: TupletStart,
  ev: RawEvent,
  outer: { actual: number; normal: number },
): TupletGroup {
  let actual = start.actual;
  let normal = start.normal;
  if (actual === undefined || normal === undefined) {
    const cum = ev.timeMod ?? { actual: 1, normal: 1 };
    const a = cum.actual * outer.normal;
    const n = cum.normal * outer.actual;
    const g = gcd(a, n) || 1;
    actual = Math.max(1, Math.round(a / g));
    normal = Math.max(1, Math.round(n / g));
  }
  const unit = start.unit ?? ev.duration.base;
  return {
    kind: "tuplet",
    id: newId(),
    ratio: { actual, normal, unit },
    items: [],
    ...(start.bracket ? { bracket: start.bracket } : {}),
    ...(start.showNumber ? { showNumber: start.showNumber } : {}),
  };
}

/** When a run of notes carries a time-modification but no `<tuplet>` notations, group it. */
function synthesizeTupletGroups(events: RawEvent[]): void {
  const anyExplicit = events.some((e) => e.tupletStarts.length > 0 || e.tupletStops.length > 0);
  if (anyExplicit) return;
  let runStart = -1;
  const closeRun = (endIndex: number) => {
    if (runStart < 0) return;
    const first = events[runStart]!;
    const mod = first.timeMod!;
    first.tupletStarts.push({ number: 1, actual: mod.actual, normal: mod.normal, unit: first.duration.base });
    events[endIndex]!.tupletStops.push(1);
    runStart = -1;
  };
  for (const [i, ev] of events.entries()) {
    const mod = ev.timeMod;
    if (!mod) {
      closeRun(i - 1);
      continue;
    }
    if (runStart < 0) {
      runStart = i;
      continue;
    }
    const prev = events[runStart]!.timeMod!;
    if (prev.actual !== mod.actual || prev.normal !== mod.normal) {
      closeRun(i - 1);
      runStart = i;
    }
  }
  closeRun(events.length - 1);
}

function makeEvent(ev: RawEvent, staffIndex: number, measureIndex: number, shift: ShiftLookup): NoteEvent | RestEvent {
  if (ev.kind === "rest") {
    return {
      kind: "rest",
      id: ev.id,
      duration: ev.duration,
      ...(ev.measureRest ? { measureRest: true } : {}),
      ...(ev.invisible ? { invisible: true } : {}),
    };
  }
  const octaves = shift(staffIndex, measureIndex, ev.offset);
  const notes: Note[] = ev.notes
    .map((n) => toModelNote(octaves === 0 ? n : { ...n, pitch: { ...n.pitch, octave: n.pitch.octave + octaves } }))
    .sort(comparePitchNote);
  return {
    kind: "note",
    id: ev.id,
    duration: ev.duration,
    notes,
    ...(ev.grace ? { grace: ev.grace } : {}),
    ...(ev.lyrics.length ? { lyrics: ev.lyrics } : {}),
    ...(ev.stem ? { stem: ev.stem } : {}),
    ...(ev.articulations.length ? { articulations: ev.articulations } : {}),
    ...(ev.ornaments.length ? { ornaments: ev.ornaments } : {}),
    ...(ev.arpeggio ? { arpeggio: ev.arpeggio } : {}),
    ...(ev.tremolo ? { tremolo: ev.tremolo } : {}),
  };
}

/** Insert invisible rests wherever backup/forward left the voice empty, and pad the tail. */
function fillGaps(root: VoiceItem[], rootStarts: Fraction[], events: RawEvent[], target: Fraction): void {
  const gaps: { at: Fraction; length: Fraction }[] = [];
  let prev: Fraction = ZERO;
  for (const ev of events) {
    if (cmp(ev.offset, prev) > 0) gaps.push({ at: prev, length: sub(ev.offset, prev) });
    const end = add(ev.offset, ev.length);
    if (cmp(end, prev) > 0) prev = end;
  }
  if (cmp(prev, target) < 0) gaps.push({ at: prev, length: sub(target, prev) });

  for (let i = gaps.length - 1; i >= 0; i--) {
    const gap = gaps[i]!;
    const rests = restsForGap(gap.length);
    if (rests.length === 0) continue;
    let insertAt = rootStarts.findIndex((s) => cmp(s, gap.at) >= 0);
    if (insertAt < 0) insertAt = root.length;
    root.splice(insertAt, 0, ...rests);
    rootStarts.splice(insertAt, 0, ...rests.map(() => gap.at));
  }
}

function restsForGap(len: Fraction): RestEvent[] {
  if (cmp(len, ZERO) <= 0) return [];
  try {
    return decomposeDuration(len).map((d) => ({
      kind: "rest" as const,
      id: newId(),
      duration: d,
      invisible: true,
    }));
  } catch {
    // Not representable in plain note values (a tuplet-sized gap, say): one best-fit rest.
    return [{ kind: "rest", id: newId(), duration: notatedFromFraction(len), invisible: true }];
  }
}

function collectPositions(items: VoiceItem[], start: Fraction, scale: Fraction, out: BuiltEvent[]): Fraction {
  let t = start;
  for (const item of items) {
    if (item.kind === "tuplet") {
      const s = frac(scale.num * item.ratio.normal, scale.den * item.ratio.actual);
      t = collectPositions(item.items, t, s, out);
      continue;
    }
    const plain = notatedToFraction(item.duration);
    const length = frac(plain.num * scale.num, plain.den * scale.den);
    out.push({ id: item.id, offset: t, length });
    t = add(t, length);
  }
  return t;
}

// ---------------------------------------------------------------------------
// Spanners and attachments
// ---------------------------------------------------------------------------

type StaffLookup = (partIndex: number, staff: number) => number;

function buildSlurs(rawParts: RawPart[], staffIndexOf: StaffLookup, out: Spanner[]): void {
  const open = new Map<string, { id: Id; placement?: Placement }>();
  for (const [partIndex, rp] of rawParts.entries()) {
    for (const rm of rp.measures) {
      for (const ev of rm.events) {
        const si = staffIndexOf(partIndex, ev.staff);
        for (const slur of ev.slurs) {
          const key = `${si}/${slur.number}`;
          if (slur.type === "start") {
            open.set(key, { id: ev.id, ...(slur.placement ? { placement: slur.placement } : {}) });
          } else {
            const started = open.get(key) ?? [...open.entries()].find(([k]) => k.startsWith(`${si}/`))?.[1];
            if (!started) continue;
            open.delete(key);
            out.push({
              id: newId(),
              kind: "slur",
              partIndex: 0,
              staffIndex: si,
              start: { kind: "event", eventId: started.id },
              end: { kind: "event", eventId: ev.id },
              ...(started.placement ? { placement: started.placement } : {}),
            });
          }
        }
      }
    }
  }
}

function buildNoteAttachments(rawParts: RawPart[], staffIndexOf: StaffLookup, out: Attachment[]): void {
  for (const [partIndex, rp] of rawParts.entries()) {
    for (const rm of rp.measures) {
      for (const ev of rm.events) {
        const si = staffIndexOf(partIndex, ev.staff);
        if (ev.fermata) {
          out.push({
            id: newId(),
            kind: "fermata",
            partIndex: 0,
            staffIndex: si,
            anchor: { kind: "event", eventId: ev.id },
            ...(ev.fermata.placement ? { placement: ev.fermata.placement } : {}),
          });
        }
        if (ev.dynamics) {
          out.push({
            id: newId(),
            kind: "dynamic",
            text: ev.dynamics,
            partIndex: 0,
            staffIndex: si,
            anchor: { kind: "event", eventId: ev.id },
          });
        }
      }
    }
  }
}

interface OttavaSpan {
  staffIndex: number;
  from: Fraction;
  to: Fraction;
  octaves: number;
}

function collectOttavaSpans(
  rawParts: RawPart[],
  staffIndexOf: StaffLookup,
  measureStarts: Fraction[],
): OttavaSpan[] {
  const out: OttavaSpan[] = [];
  const open = new Map<string, { from: Fraction; octaves: number }>();
  for (const [partIndex, rp] of rawParts.entries()) {
    for (const [mi, rm] of rp.measures.entries()) {
      for (const dir of [...rm.directions].sort((a, b) => cmp(a.pos, b.pos))) {
        const shift = dir.octaveShift;
        if (!shift) continue;
        const si = staffIndexOf(partIndex, dir.staff);
        const at = add(measureStarts[mi] ?? ZERO, dir.pos);
        const key = `${si}/${shift.number}`;
        if (shift.type === "stop") {
          const started = open.get(key);
          if (!started) continue;
          open.delete(key);
          out.push({ staffIndex: si, from: started.from, to: at, octaves: started.octaves });
        } else {
          const size = shift.size === 15 ? 2 : 1;
          open.set(key, { from: at, octaves: shift.type === "down" ? size : -size });
        }
      }
    }
  }
  return out;
}

function buildDirections(
  rawParts: RawPart[],
  staffIndexOf: StaffLookup,
  anchorAt: (staffIndex: number, mi: number, pos: Fraction, which: "start" | "end") => Anchor,
  spanners: Spanner[],
  attachments: Attachment[],
): void {
  const openWedge = new Map<string, { anchor: Anchor; shape: "cresc" | "dim"; placement?: Placement }>();
  const openPedal = new Map<string, { anchor: Anchor; style: "line" | "text"; placement?: Placement }>();
  const openOttava = new Map<string, { anchor: Anchor; shift: 8 | 15 | -8 | -15; placement?: Placement }>();

  for (const [partIndex, rp] of rawParts.entries()) {
    for (const [mi, rm] of rp.measures.entries()) {
      for (const dir of [...rm.directions].sort((a, b) => cmp(a.pos, b.pos))) {
        const si = staffIndexOf(partIndex, dir.staff);
        const base = { id: "", partIndex: 0, staffIndex: si };
        const startAnchor = () => anchorAt(si, mi, dir.pos, "start");
        const endAnchor = () => anchorAt(si, mi, dir.pos, "end");

        if (dir.metronome) {
          attachments.push({
            ...base,
            id: newId(),
            kind: "tempo",
            ...(dir.words.length ? { text: dir.words.join(" ") } : {}),
            beatUnit: dir.metronome.beatUnit,
            bpm: dir.metronome.bpm,
            anchor: startAnchor(),
            ...(dir.placement ? { placement: dir.placement } : {}),
          });
        } else if (dir.words.length > 0 && dir.rehearsal === undefined) {
          attachments.push({
            ...base,
            id: newId(),
            kind: "text",
            text: dir.words.join(" "),
            style: "expression",
            anchor: startAnchor(),
            ...(dir.placement ? { placement: dir.placement } : {}),
          });
        }

        if (dir.dynamics) {
          attachments.push({
            ...base,
            id: newId(),
            kind: "dynamic",
            text: dir.dynamics,
            anchor: startAnchor(),
            ...(dir.placement ? { placement: dir.placement } : {}),
          });
        }

        if (dir.wedge) {
          const key = `${si}/${dir.wedge.number}`;
          if (dir.wedge.type === "stop") {
            const open = openWedge.get(key) ?? openWedge.values().next().value;
            if (open) {
              openWedge.delete(key);
              spanners.push({
                ...base,
                id: newId(),
                kind: "hairpin",
                shape: open.shape,
                start: open.anchor,
                end: endAnchor(),
                ...(open.placement ? { placement: open.placement } : {}),
              });
            }
          } else {
            openWedge.set(key, {
              anchor: startAnchor(),
              shape: dir.wedge.type === "crescendo" ? "cresc" : "dim",
              ...(dir.placement ? { placement: dir.placement } : {}),
            });
          }
        }

        if (dir.pedal) {
          const key = `${si}`;
          const style = dir.pedal.line ? "line" : "text";
          const closePedal = () => {
            const open = openPedal.get(key);
            if (!open) return;
            openPedal.delete(key);
            spanners.push({
              ...base,
              id: newId(),
              kind: "pedal",
              style: open.style,
              start: open.anchor,
              end: endAnchor(),
              ...(open.placement ? { placement: open.placement } : {}),
            });
          };
          if (dir.pedal.type === "stop") closePedal();
          else if (dir.pedal.type === "change") {
            closePedal();
            openPedal.set(key, { anchor: startAnchor(), style, ...(dir.placement ? { placement: dir.placement } : {}) });
          } else if (dir.pedal.type === "start" || dir.pedal.type === "sostenuto") {
            openPedal.set(key, { anchor: startAnchor(), style, ...(dir.placement ? { placement: dir.placement } : {}) });
          }
        }

        if (dir.octaveShift) {
          const key = `${si}/${dir.octaveShift.number}`;
          if (dir.octaveShift.type === "stop") {
            const open = openOttava.get(key);
            if (open) {
              openOttava.delete(key);
              spanners.push({
                ...base,
                id: newId(),
                kind: "ottava",
                shift: open.shift,
                start: open.anchor,
                end: endAnchor(),
                ...(open.placement ? { placement: open.placement } : {}),
              });
            }
          } else {
            const size = dir.octaveShift.size === 15 ? 15 : 8;
            const shift: 8 | 15 | -8 | -15 = dir.octaveShift.type === "down" ? size : ((-size) as -8 | -15);
            openOttava.set(key, {
              anchor: startAnchor(),
              shift,
              ...(dir.placement ? { placement: dir.placement } : {}),
            });
          }
        }
      }
    }
  }
}
