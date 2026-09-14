/**
 * `engrave(score, { font }) => LayoutResult` — the M0 orchestration.
 *
 * Pipeline: semantic pass (semantic.ts) → horizontal spacing (spacing.ts) →
 * line breaking (breaking.ts) → vertical layout (vertical.ts) → primitives.
 *
 * M2 scope: several voices per staff, tuplets, staff groups and staff names.
 * Still missing: spanners, attachments, grace notes, cross-staff notes.
 */
import { fracToString, measureLength as timeSigLength, type Fraction, type TimeSignature } from "@/model/duration";
import type { Id } from "@/model/ids";
import type { KeySignature } from "@/model/pitch";
import type { BarlineStyle, ClefKind, Part, Score, StaffGroupSymbol, StaffMeasure } from "@/model/score";
import type { EngravingDefaults, SmuflFontData } from "@/render/smufl/types";
import { planSystems, type SystemPlan } from "./breaking";
import { ENGRAVING } from "./constants";
import { glyphBox, pathBounds, STAFF_HEIGHT } from "./geometry";
import type {
  LayoutResult,
  MeasureLayout,
  Page,
  Primitive,
  Ref,
  StaffLayout,
  System,
} from "./layout-types";
import {
  beamGeometry,
  layoutStaffMeasure,
  stemDirectionForSteps,
  type EventLayout,
  type StaffMeasureLayout,
} from "./semantic";
import {
  buildMeasureSpacing,
  justifySystem,
  layoutPrefix,
  type MeasurePrefix,
  type MeasureSpacing,
  type SpacingColumn,
} from "./spacing";
import { emitTuplets } from "./tuplets";
import {
  needsTieContinuationLead,
  resolveTies,
  tiePath,
  tieSide,
  type TieEndpoint,
  type TiePair,
} from "./ties";
import { pageMetrics, paginate, staffSlots, staffSpan, type StaffSlot } from "./vertical";

export interface EngraveOptionsInput {
  font: SmuflFontData;
}

// ---------------------------------------------------------------------------
// Per-measure preparation
// ---------------------------------------------------------------------------

interface PreparedMeasure {
  index: number;
  id: Id;
  number: number;
  barline: BarlineStyle;
  startBarline?: "repeat-start";
  staves: StaffMeasureLayout[];
  /** Spacing when the measure is not the first of its system. */
  mid: MeasureSpacing;
  /** Spacing when the measure starts a system (and therefore shows a clef). */
  start: MeasureSpacing;
}

function clefAtMeasureStart(sm: StaffMeasure | undefined, running: ClefKind): ClefKind {
  // M0 only honours clef changes at the very start of a measure.
  const change = sm?.clefChanges?.find((c) => c.at.num === 0);
  return change ? change.clef : running;
}

export function engrave(score: Score, opts: EngraveOptionsInput): LayoutResult {
  const font = opts.font;
  const defaults = font.engravingDefaults;
  const settings = score.settings;
  const metrics = pageMetrics(settings);
  const slots = staffSlots(score.parts, settings);
  const span = staffSpan(slots);

  // --- 1. semantic pass + spacing, measure by measure ----------------------
  const clefs: ClefKind[][] = score.parts.map((p) => p.staves.map((s) => s.initialClef));
  let key: KeySignature = { fifths: 0, mode: "major" };
  let timeSig: TimeSignature = { numerator: 4, denominator: 4 };
  let measureNumber = 1;

  // Tie pairing is a model-only question, so it runs before the semantic pass and
  // seeds the accidental logic with the notes a tie ends on.
  const ties = resolveTies(score);

  const prepared: PreparedMeasure[] = [];
  for (const [mi, attrs] of score.measures.entries()) {
    const prevKey = key;
    if (attrs.keySig) key = attrs.keySig;
    const keyChanged = attrs.keySig !== undefined && attrs.keySig.fifths !== prevKey.fifths;
    if (attrs.timeSig) timeSig = attrs.timeSig;
    if (attrs.numberOverride !== undefined) measureNumber = attrs.numberOverride;
    const measureLen: Fraction = attrs.actualLength ?? timeSigLength(timeSig);

    for (const [pi, part] of score.parts.entries()) {
      const pm = part.measures[mi];
      for (const [si] of part.staves.entries()) {
        clefs[pi]![si] = clefAtMeasureStart(pm?.staves[si], clefs[pi]![si]!);
      }
    }
    const flatClefs = slots.map((s) => clefs[s.partIndex]![s.staffIndex]!);

    const staves: StaffMeasureLayout[] = slots.map((slot, i) => {
      const part = score.parts[slot.partIndex]!;
      const sm = part.measures[mi]?.staves[slot.staffIndex];
      return layoutStaffMeasure({
        font,
        partIndex: slot.partIndex,
        staffIndex: slot.staffIndex,
        clef: flatClefs[i]!,
        key,
        timeSig,
        measureLength: measureLen,
        voices: sm?.voices ?? [],
        tiedFrom: ties.targets,
      });
    });

    // The clef and the key signature in force are repeated at every system start;
    // mid-system they appear only where they change, the key with the naturals
    // that cancel the outgoing one. The time signature is drawn only where declared.
    const timeSpec = attrs.timeSig ? { timeSig: attrs.timeSig } : {};
    const mkPrefix = (systemStart: boolean): MeasurePrefix =>
      layoutPrefix(font, slots, {
        showClef: systemStart,
        clefs: flatClefs,
        ...(systemStart || keyChanged ? { key } : {}),
        ...(keyChanged ? { cancelKey: prevKey } : {}),
        ...timeSpec,
      });

    const barline: BarlineStyle = attrs.barline ?? "regular";
    const common = { measureIndex: mi, measureId: attrs.id, staves, barline, defaults };
    prepared.push({
      index: mi,
      id: attrs.id,
      number: measureNumber,
      barline,
      ...(attrs.startBarline ? { startBarline: attrs.startBarline } : {}),
      staves,
      mid: buildMeasureSpacing({ ...common, prefix: mkPrefix(false) }),
      start: buildMeasureSpacing({
        ...common,
        prefix: mkPrefix(true),
        // Room for the second piece of a tie broken across the system break.
        extraLead: needsTieContinuationLead(ties.pairs, mi) ? ENGRAVING.tieContinuationLeadSp : 0,
      }),
    });
    measureNumber++;
  }

  // --- 2. line breaking ----------------------------------------------------
  const braceIndent = systemIndent(score.parts, span, font);
  const availableWidth = metrics.contentWidth - braceIndent;

  const plans: SystemPlan[] = planSystems({
    measureCount: prepared.length,
    widthMid: prepared.map((m) => m.mid.naturalWidth),
    widthStart: prepared.map((m) => m.start.naturalWidth),
    availableWidth,
    systemBreaks: score.layout?.systemBreaks ?? [],
    pageBreaks: score.layout?.pageBreaks ?? [],
  });

  // --- 3. build every system ----------------------------------------------
  interface BuiltSystem {
    plan: SystemPlan;
    width: number;
    /** Justified spacing of each measure of this system, parallel to `plan.measures`. */
    spacings: MeasureSpacing[];
    primitives: Primitive[];
    measures: MeasureLayout[];
    above: number;
    below: number;
  }

  const built: BuiltSystem[] = plans.map((plan, systemIndex) => {
    const spacings = plan.measures.map((mi, i) =>
      i === 0 ? prepared[mi]!.start : prepared[mi]!.mid,
    );
    const natural = spacings.reduce((a, m) => a + m.naturalWidth, 0);
    const isLast = systemIndex === plans.length - 1;
    const target =
      isLast && natural < availableWidth * ENGRAVING.lastSystemJustifyThreshold
        ? natural
        : Math.max(natural, availableWidth);
    justifySystem(spacings, target);
    const width = spacings.reduce((a, m) => a + m.width, 0);

    const primitives: Primitive[] = [];
    emitSystemFrame(primitives, {
      parts: score.parts,
      slots,
      width,
      font,
      systemIndex,
      firstMeasureId: spacings[0]?.measureId ?? score.id,
    });
    for (const [i, m] of spacings.entries()) {
      const p = prepared[plan.measures[i]!]!;
      emitMeasure(primitives, {
        font,
        defaults,
        slots,
        spacing: m,
        prepared: p,
        showMeasureNumber: i === 0 && p.number > 1,
      });
    }

    return {
      plan,
      width,
      spacings,
      primitives,
      measures: spacings.map((m) => ({
        measureIndex: m.measureIndex,
        x: m.x,
        width: m.width,
        columns: m.columns.map((c) => ({ offset: c.offset, x: m.x + c.x })),
      })),
      above: 0,
      below: 0,
    };
  });

  // Ties can span systems, so they are drawn once every system's x positions are
  // final — and before the vertical extents, which must cover their arcs.
  emitTies(built, { defaults, slots, ties: ties.pairs });

  for (const b of built) {
    const ext = verticalExtent(b.primitives, font, span);
    b.above = ext.above;
    b.below = ext.below;
  }

  // --- 4. pagination -------------------------------------------------------
  const hasTitleBlock = Boolean(score.meta.title ?? score.meta.subtitle ?? score.meta.composer);
  const placements = paginate(
    built.map((b) => ({ above: b.above, below: b.below, startsPage: b.plan.startsPage })),
    metrics,
    settings,
    hasTitleBlock ? ENGRAVING.titleBlockSp : 0,
  );

  const pages: Page[] = [];
  const pageOf = (index: number): Page => {
    let p = pages[index];
    if (!p) {
      p = { index, widthSp: metrics.widthSp, heightSp: metrics.heightSp, systems: [], primitives: [] };
      pages[index] = p;
    }
    return p;
  };

  for (const [i, b] of built.entries()) {
    const place = placements[i]!;
    const page = pageOf(place.pageIndex);
    const system: System = {
      index: i,
      x: metrics.left + braceIndent,
      y: place.y,
      width: b.width,
      height: b.above + b.below,
      staves: slots.map<StaffLayout>((s) => ({
        partIndex: s.partIndex,
        staffIndex: s.staffIndex,
        y: s.y,
        lineCount: STAFF_HEIGHT + 1,
      })),
      measures: b.measures,
      primitives: b.primitives,
    };
    page.systems.push(system);
  }

  if (pages.length === 0) pageOf(0);
  const firstPage = pages[0]!;
  emitTitleBlock(firstPage.primitives, score, metrics);

  return { pages: [...pages], staffSpaceMm: settings.staffSpaceMm };
}

// ---------------------------------------------------------------------------
// System furniture
// ---------------------------------------------------------------------------

const BRACE_NATURAL_HEIGHT = 4.0;

/** The symbol joining a part's staves: an explicit choice, else a brace for 2+ staves. */
function groupSymbolOf(part: Part): StaffGroupSymbol {
  return part.bracket ?? (part.staves.length > 1 ? "brace" : "none");
}

/** Width the group symbol of a part takes left of the system, its gap included. */
function groupSymbolWidth(part: Part, span: number, font: SmuflFontData): number {
  switch (groupSymbolOf(part)) {
    case "brace": {
      const box = glyphBox(font, "brace");
      const natural = box.up > 0 ? box.up : BRACE_NATURAL_HEIGHT;
      return box.width * (span / natural) + ENGRAVING.braceGapSp;
    }
    case "bracket":
      return glyphBox(font, "bracketTop").width + ENGRAVING.braceGapSp;
    default:
      return 0;
  }
}

/**
 * Estimated width of a text run. The engraver has no metrics for the text fonts,
 * so staff labels — the only text the layout has to reserve room for — use an
 * average advance. Over-estimating only widens the indent a little.
 */
function textWidth(text: string, size: number): number {
  return text.length * size * ENGRAVING.textWidthRatio;
}

/** Widest staff label of a part (names and abbreviations both, so the indent is stable). */
function staffLabelWidth(part: Part): number {
  let w = 0;
  for (const staff of part.staves) {
    for (const label of [staff.name, staff.abbreviation]) {
      if (label) w = Math.max(w, textWidth(label, ENGRAVING.staffNameSizeSp));
    }
  }
  return w;
}

/**
 * Space reserved left of every system: the widest staff label, a gap, and the
 * part's group symbol. One indent is used for all systems so that measures break
 * the same way whether a system shows names or abbreviations.
 */
function systemIndent(parts: Part[], span: number, font: SmuflFontData): number {
  let indent = 0;
  for (const part of parts) {
    const label = staffLabelWidth(part);
    const symbol = groupSymbolWidth(part, span, font);
    indent = Math.max(indent, symbol + (label > 0 ? label + ENGRAVING.staffNameGapSp : 0));
  }
  return indent;
}

interface SystemFrameInput {
  parts: Part[];
  slots: StaffSlot[];
  width: number;
  font: SmuflFontData;
  /** Staff names are drawn on system 0, abbreviations after it. */
  systemIndex: number;
  firstMeasureId: Id;
}

function emitSystemFrame(out: Primitive[], input: SystemFrameInput): void {
  const { parts, slots, width, font, systemIndex } = input;
  const defaults = font.engravingDefaults;
  const span = staffSpan(slots);
  for (const slot of slots) {
    out.push({
      type: "staffLines",
      x: 0,
      y: slot.y,
      width,
      lineCount: STAFF_HEIGHT + 1,
      thickness: defaults.staffLineThickness,
    });
  }

  for (const [pi, part] of parts.entries()) {
    const mine = slots.filter((s) => s.partIndex === pi);
    if (mine.length === 0) continue;
    const top = mine[0]!.y;
    const bottom = mine[mine.length - 1]!.y + STAFF_HEIGHT;
    const partRef: Ref = { id: part.id, role: "other" };
    const symbol = groupSymbolOf(part);

    if (symbol === "brace") {
      const box = glyphBox(font, "brace");
      const natural = box.up > 0 ? box.up : BRACE_NATURAL_HEIGHT;
      const scale = (bottom - top) / natural;
      out.push({
        type: "glyph",
        glyph: "brace",
        x: -(ENGRAVING.braceGapSp + box.width * scale),
        y: bottom,
        scale,
        ref: partRef,
      });
    } else if (symbol === "bracket") {
      // A thick vertical line the height of the group, capped by the two SMuFL
      // bracket tips, which curl rightwards from their origin.
      const box = glyphBox(font, "bracketTop");
      const x = -(ENGRAVING.braceGapSp + box.width);
      const thickness = defaults.bracketThickness;
      out.push({
        type: "line",
        x1: x + thickness / 2,
        y1: top,
        x2: x + thickness / 2,
        y2: bottom,
        thickness,
        ref: partRef,
      });
      out.push({ type: "glyph", glyph: "bracketTop", x, y: top, ref: partRef });
      out.push({ type: "glyph", glyph: "bracketBottom", x, y: bottom, ref: partRef });
    }

    // The vertical line that joins the staves of the part at the system start.
    if (part.staves.length > 1) {
      out.push({
        type: "line",
        x1: 0,
        y1: top,
        x2: 0,
        y2: bottom,
        thickness: defaults.thinBarlineThickness,
        ref: { id: input.firstMeasureId, role: "barline" },
      });
    }

    // Staff labels: right-aligned a gap left of the group symbol, vertically
    // centred on their staff. Names on the first system, abbreviations after.
    const labelRight = -(groupSymbolWidth(part, span, font) + ENGRAVING.staffNameGapSp);
    for (const slot of mine) {
      const def = part.staves[slot.staffIndex];
      const label = systemIndex === 0 ? def?.name : def?.abbreviation;
      if (!def || !label) continue;
      out.push({
        type: "text",
        text: label,
        x: labelRight,
        y: slot.y + STAFF_HEIGHT / 2 + ENGRAVING.staffNameSizeSp * 0.35,
        size: ENGRAVING.staffNameSizeSp,
        // The renderer's plain serif face; there is no dedicated staff-name style.
        style: "subtitle",
        anchor: "end",
        ref: { id: def.id, role: "text" },
      });
    }
  }
}

function emitTitleBlock(out: Primitive[], score: Score, metrics: ReturnType<typeof pageMetrics>): void {
  const { title, subtitle, composer } = score.meta;
  const ref: Ref = { id: score.id, role: "text" };
  let y = metrics.top + ENGRAVING.titleSizeSp;
  if (title) {
    out.push({
      type: "text",
      text: title,
      x: metrics.widthSp / 2,
      y,
      size: ENGRAVING.titleSizeSp,
      style: "title",
      anchor: "middle",
      ref,
    });
    y += ENGRAVING.subtitleSizeSp + 0.8;
  }
  if (subtitle) {
    out.push({
      type: "text",
      text: subtitle,
      x: metrics.widthSp / 2,
      y,
      size: ENGRAVING.subtitleSizeSp,
      style: "subtitle",
      anchor: "middle",
      ref,
    });
    y += ENGRAVING.composerSizeSp + 0.8;
  }
  if (composer) {
    out.push({
      type: "text",
      text: composer,
      x: metrics.widthSp - metrics.right,
      y: Math.max(y, metrics.top + ENGRAVING.titleBlockSp - 1.5),
      size: ENGRAVING.composerSizeSp,
      style: "composer",
      anchor: "end",
      ref,
    });
  }
}

// ---------------------------------------------------------------------------
// Measure primitives
// ---------------------------------------------------------------------------

interface MeasureEmitInput {
  font: SmuflFontData;
  defaults: EngravingDefaults;
  slots: StaffSlot[];
  spacing: MeasureSpacing;
  prepared: PreparedMeasure;
  showMeasureNumber: boolean;
}

function emitMeasure(out: Primitive[], input: MeasureEmitInput): void {
  const { font, defaults, slots, spacing, prepared } = input;
  const mx = spacing.x;
  const staffYof = (partIndex: number, staffIndex: number): number =>
    slots.find((s) => s.partIndex === partIndex && s.staffIndex === staffIndex)?.y ?? 0;

  if (input.showMeasureNumber) {
    out.push({
      type: "text",
      text: String(prepared.number),
      x: mx,
      y: (slots[0]?.y ?? 0) - ENGRAVING.measureNumberOffsetSp,
      size: ENGRAVING.measureNumberSizeSp,
      style: "measureNumber",
      anchor: "start",
      ref: { id: prepared.id, role: "measure" },
    });
  }

  // Prefix: clef, key signature, time signature.
  for (const sp of spacing.prefix.staves) {
    const sy = staffYof(sp.partIndex, sp.staffIndex);
    for (const g of sp.glyphs) {
      out.push({
        type: "glyph",
        glyph: g.glyph,
        x: mx + g.x,
        y: sy + g.y,
        ref: { id: prepared.id, role: g.role },
      });
    }
  }

  const columnByOffset = new Map<string, SpacingColumn>();
  for (const c of spacing.columns) columnByOffset.set(fracToString(c.offset), c);
  const columnX = (ev: EventLayout): number =>
    mx + (columnByOffset.get(fracToString(ev.offset))?.x ?? 0);

  for (const staff of spacing.staves) {
    const sy = staffYof(staff.partIndex, staff.staffIndex);

    // Beams first: they decide the final stem tips.
    const stemTips = new Map<number, number>();
    for (const group of staff.beams) {
      const geo = beamGeometry(group, staff.events, (i) => columnX(staff.events[i]!), defaults);
      for (const [i, y] of geo.stemTips) stemTips.set(i, y);
      const ref: Ref = { id: staff.events[group.members[0]!]!.event.id, role: "beam" };
      for (const seg of geo.segments) {
        const t = group.dir === "up" ? seg.thickness : -seg.thickness;
        out.push({
          type: "polygon",
          points: [
            [seg.x1, sy + seg.y1],
            [seg.x2, sy + seg.y2],
            [seg.x2, sy + seg.y2 + t],
            [seg.x1, sy + seg.y1 + t],
          ],
          ref,
        });
      }
    }

    for (const [ei, ev] of staff.events.entries()) {
      emitEvent(out, {
        font,
        defaults,
        ev,
        x: columnX(ev),
        staffY: sy,
        measureX: mx,
        measureWidth: spacing.width,
        stemTip: stemTips.get(ei),
      });
    }

    // Tuplet brackets and numbers need the final stem tips, so they come last.
    emitTuplets(out, {
      font,
      defaults,
      staff,
      staffY: sy,
      xOf: (i) => columnX(staff.events[i]!),
      stemTips,
    });
  }

  emitBarlines(out, { defaults, slots, spacing, prepared });
}

interface EventEmitInput {
  font: SmuflFontData;
  defaults: EngravingDefaults;
  ev: EventLayout;
  x: number;
  staffY: number;
  measureX: number;
  measureWidth: number;
  stemTip?: number | undefined;
}

function emitEvent(out: Primitive[], input: EventEmitInput): void {
  const { ev, staffY, defaults } = input;
  const eventRef = (role: Ref["role"]): Ref => ({ id: ev.event.id, role });

  if (ev.rest) {
    // An invisible rest still owns its column; it simply draws no ink.
    if (ev.rest.invisible) return;
    const x = ev.rest.centred
      ? input.measureX + input.measureWidth / 2 - ev.rest.width / 2
      : input.x;
    out.push({
      type: "glyph",
      glyph: ev.rest.glyph,
      x,
      y: staffY + ev.rest.y,
      ref: eventRef("rest"),
    });
    for (const d of ev.dots) {
      out.push({ type: "glyph", glyph: "augmentationDot", x: x + d.x, y: staffY + d.y, ref: eventRef("dot") });
    }
    return;
  }

  const x = input.x;

  for (const l of ev.ledgers) {
    out.push({
      type: "line",
      x1: x + l.x1,
      y1: staffY + l.y,
      x2: x + l.x2,
      y2: staffY + l.y,
      thickness: defaults.legerLineThickness,
      ref: eventRef("ledger"),
    });
  }

  for (const n of ev.notes) {
    if (n.accidental) {
      for (const part of n.accidental.parts) {
        out.push({
          type: "glyph",
          glyph: part.glyph,
          x: x + part.x,
          y: staffY + n.accidental.y,
          ref: { id: n.note.id, role: "accidental" },
        });
      }
    }
    out.push({
      type: "glyph",
      glyph: n.glyph,
      x: x + n.x,
      y: staffY + n.y,
      ref: { id: n.note.id, role: "notehead" },
    });
  }

  if (ev.stem) {
    const tip = input.stemTip ?? ev.stem.yTip;
    out.push({
      type: "line",
      x1: x + ev.stem.x,
      y1: staffY + ev.stem.yAttach,
      x2: x + ev.stem.x,
      y2: staffY + tip,
      thickness: ev.stem.thickness,
      ref: eventRef("stem"),
    });
  }

  if (ev.flag) {
    out.push({
      type: "glyph",
      glyph: ev.flag.glyph,
      x: x + ev.flag.x,
      y: staffY + ev.flag.y,
      ref: eventRef("flag"),
    });
  }

  for (const d of ev.dots) {
    out.push({ type: "glyph", glyph: "augmentationDot", x: x + d.x, y: staffY + d.y, ref: eventRef("dot") });
  }
}

interface BarlineEmitInput {
  defaults: EngravingDefaults;
  slots: StaffSlot[];
  spacing: MeasureSpacing;
  prepared: PreparedMeasure;
}

function emitBarlines(out: Primitive[], input: BarlineEmitInput): void {
  const { defaults, slots, spacing, prepared } = input;
  const end = spacing.x + spacing.width;
  const ref: Ref = { id: prepared.id, role: "barline" };

  const groups = new Map<number, StaffSlot[]>();
  for (const s of slots) {
    const list = groups.get(s.partIndex);
    if (list) list.push(s);
    else groups.set(s.partIndex, [s]);
  }

  const vertical = (x: number, thickness: number, dash?: number[]) => {
    for (const g of groups.values()) {
      const top = g[0]!.y;
      const bottom = g[g.length - 1]!.y + STAFF_HEIGHT;
      out.push({
        type: "line",
        x1: x,
        y1: top,
        x2: x,
        y2: bottom,
        thickness,
        ...(dash ? { dash } : {}),
        ref,
      });
    }
  };

  const thin = defaults.thinBarlineThickness;
  const thick = defaults.thickBarlineThickness;
  const sep = defaults.barlineSeparation;

  switch (prepared.barline) {
    case "invisible":
      break;
    case "dashed":
      vertical(end - thin / 2, thin, [defaults.dashedBarlineDashLength ?? 0.5, defaults.dashedBarlineGapLength ?? 0.25]);
      break;
    case "final":
      vertical(end - thick / 2, thick);
      vertical(end - thick - sep - thin / 2, thin);
      break;
    case "double":
    case "repeat-end":
    case "repeat-both":
    case "repeat-start":
      // M0: repeat barlines fall back to a double barline.
      vertical(end - thin / 2, thin);
      vertical(end - thin - sep - thin / 2, thin);
      break;
    default:
      vertical(end - thin / 2, thin);
      break;
  }

  if (prepared.startBarline === "repeat-start") {
    vertical(spacing.x + thin / 2, thin);
    vertical(spacing.x + thin + sep + thin / 2, thin);
  }
}

// ---------------------------------------------------------------------------
// Ties
// ---------------------------------------------------------------------------

interface TieSystem {
  plan: SystemPlan;
  width: number;
  spacings: MeasureSpacing[];
  primitives: Primitive[];
}

interface TieSite {
  systemIndex: number;
  staffY: number;
  ev: EventLayout;
  noteIndex: number;
  /** System-coordinate x of the event's column origin. */
  columnX: number;
}

/**
 * Draw every resolved tie. A tie that crosses a system break becomes two pieces:
 * one running from the start notehead to the right edge of its system, one from
 * just after the next system's prefix to the end notehead. A tie whose partner
 * could not be laid out (a missing measure, an event filtered out) draws nothing.
 */
function emitTies(
  systems: TieSystem[],
  input: { defaults: EngravingDefaults; slots: StaffSlot[]; ties: TiePair[] },
): void {
  if (input.ties.length === 0) return;

  const located = new Map<number, { systemIndex: number; spacing: MeasureSpacing }>();
  for (const [si, sys] of systems.entries()) {
    for (const [i, mi] of sys.plan.measures.entries()) {
      const spacing = sys.spacings[i];
      if (spacing) located.set(mi, { systemIndex: si, spacing });
    }
  }

  const site = (ep: TieEndpoint): TieSite | undefined => {
    const loc = located.get(ep.measureIndex);
    if (!loc) return undefined;
    const slotIndex = input.slots.findIndex(
      (s) => s.partIndex === ep.partIndex && s.staffIndex === ep.staffIndex,
    );
    const slot = input.slots[slotIndex];
    const staff = slotIndex < 0 ? undefined : loc.spacing.staves[slotIndex];
    if (!slot || !staff) return undefined;
    const ev = staff.events.find((e) => e.event.id === ep.eventId);
    if (!ev) return undefined;
    const noteIndex = ev.notes.findIndex((n) => n.note.id === ep.noteId);
    if (noteIndex < 0) return undefined;
    const key = fracToString(ev.offset);
    const column = loc.spacing.columns.find((c) => fracToString(c.offset) === key);
    return {
      systemIndex: loc.systemIndex,
      staffY: slot.y,
      ev,
      noteIndex,
      columnX: loc.spacing.x + (column?.x ?? 0),
    };
  };

  const piece = (
    sys: TieSystem,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    side: "up" | "down",
    ref: Ref,
  ): void => {
    if (x2 - x1 < ENGRAVING.tieMinLengthSp) return;
    sys.primitives.push({
      type: "path",
      d: tiePath(x1, y1, x2, y2, side, input.defaults),
      fill: true,
      ref,
    });
  };

  for (const pair of input.ties) {
    const from = site(pair.start);
    const to = site(pair.end);
    if (!from || !to) continue;

    const startNote = from.ev.notes[from.noteIndex]!;
    const endNote = to.ev.notes[to.noteIndex]!;
    // A whole note has no stem; use the direction it would have had.
    const stem = from.ev.stem?.dir ?? stemDirectionForSteps([startNote.step]);
    const side = tieSide(from.noteIndex, from.ev.notes.length, stem);
    const dy = side === "up" ? -ENGRAVING.tieEndOffsetSp : ENGRAVING.tieEndOffsetSp;

    const x1 = from.columnX + startNote.x + startNote.width + ENGRAVING.tieGapSp;
    const y1 = from.staffY + startNote.y + dy;
    const x2 = to.columnX + endNote.x - ENGRAVING.tieGapSp;
    const y2 = to.staffY + endNote.y + dy;
    const ref: Ref = { id: startNote.note.id, role: "tie" };

    const startSystem = systems[from.systemIndex]!;
    if (from.systemIndex === to.systemIndex) {
      piece(startSystem, x1, y1, x2, y2, side, ref);
      continue;
    }

    const endSystem = systems[to.systemIndex]!;
    piece(startSystem, x1, y1, startSystem.width, y1, side, ref);
    const first = endSystem.spacings[0];
    const resume = (first ? first.x + first.prefix.width : 0) + ENGRAVING.tieAfterPrefixSp;
    piece(endSystem, resume, y2, x2, y2, side, ref);
  }
}

// ---------------------------------------------------------------------------
// Vertical extent of a system's ink
// ---------------------------------------------------------------------------

function verticalExtent(
  primitives: Primitive[],
  font: SmuflFontData,
  span: number,
): { above: number; below: number } {
  let minY = 0;
  let maxY = span;
  const see = (y: number) => {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const p of primitives) {
    switch (p.type) {
      case "glyph": {
        const box = glyphBox(font, p.glyph);
        const s = p.scale ?? 1;
        see(p.y - box.up * s);
        see(p.y + box.down * s);
        break;
      }
      case "line":
        see(Math.min(p.y1, p.y2) - p.thickness / 2);
        see(Math.max(p.y1, p.y2) + p.thickness / 2);
        break;
      case "polygon":
        for (const [, y] of p.points) see(y);
        break;
      case "text":
        see(p.y - p.size);
        see(p.y);
        break;
      case "path": {
        // Ties and slurs: the control-point hull bounds the curve.
        const b = pathBounds(p.d);
        if (b) {
          see(b.minY);
          see(b.maxY);
        }
        break;
      }
      case "staffLines":
        see(p.y);
        see(p.y + p.lineCount - 1);
        break;
      default:
        break;
    }
  }
  return { above: -minY, below: maxY };
}
