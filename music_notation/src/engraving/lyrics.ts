/**
 * Lyrics: one lane of syllables per verse under a staff.
 *
 * Runs after attachments.ts (see docs/ARCHITECTURE.md, "M3 contracts: Lyrics"),
 * once every x position and every articulation/dynamic is final, so the lane can
 * start below whatever ink the staff already carries.
 *
 * Three rules shape the result:
 *
 *  - **One lane per verse, flat across the system.** The lane is measured from
 *    the staff's *whole* bottom skyline rather than column by column, so every
 *    syllable of a verse shares one baseline — the thing a singer's eye follows.
 *    Verse 0 sits nearest the staff and each further verse is one `versePitchSp`
 *    lower.
 *  - **Syllables are centred on their notehead**, never left-aligned; a hyphen
 *    joins a `begin`/`middle` syllable to the one after it and repeats over long
 *    gaps, and an `extend` syllable trails an extender line to the last note of
 *    its melisma.
 *  - **Lyrics widen columns, they never overlap.** The width a syllable needs is
 *    fed back into spacing.ts (`lyricColumnWidth`), which runs long before this
 *    pass; here we only draw what that spacing already made room for.
 *
 * Lyric ink deliberately does *not* join the skyline (skyline.ts ignores the
 * "lyric" role): the lane is the outermost thing under a vocal staff, and a slur
 * or hairpin should tuck between the notes and the words rather than be pushed
 * below them.
 */
import { fracToString } from "@/model/duration";
import type { Lyric } from "@/model/score";
import type { EmitContext, EmitSystem, SystemExtent } from "./attachments";
import { STAFF_HEIGHT } from "./geometry";
import type { LinePrim, Primitive, Ref, TextPrim } from "./layout-types";
import type { EventLayout } from "./semantic";
import { buildSkyline, clearanceBelow, type StaffSkyline } from "./skyline";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

export const LYRICS = {
  /** Font size of a syllable. */
  sizeSp: 1.7,
  /** Baseline-to-baseline distance between two verses. */
  versePitchSp: 1.9,
  /** Smallest distance from the bottom staff line to the top of verse 0's lane. */
  laneMinSp: 2.0,
  /** Clearance between the ink under the staff (or `laneMinSp`) and the lane. */
  laneGapSp: 1.0,
  /**
   * Average glyph advance of the lyric font as a fraction of its size. The
   * engraver has no metrics for the text fonts; this is the same estimate
   * skyline.ts uses for text ink.
   */
  widthRatio: 0.55,
  /** Padding added to a syllable's estimated width when it constrains a column. */
  padSp: 0.6,
  /**
   * Extra room a begin/middle syllable claims so the hyphen after it fits between
   * the two syllables (two `gapSp` gaps plus the hyphen, less the padding already
   * there). Split evenly round the column like the rest of the width.
   */
  hyphenAllowanceSp: 1.2,
  /** Ascent and descent of the lyric font, as fractions of its size. */
  ascentRatio: 0.8,
  descentRatio: 0.25,
  /** Gap between a syllable and the hyphen (or extender) beside it. */
  gapSp: 0.35,
  /**
   * Hyphens repeat at least this often over a long gap. Published vocal scores only
   * repeat a hyphen over a genuinely long gap; a smaller pitch put two hyphens round
   * an ordinary barline ("bless - | - ings").
   */
  hyphenPitchSp: 12.0,
  /** Extender line. */
  extenderThicknessSp: 0.12,
  extenderMinSp: 0.6,
  /** Distance from the baseline down to the extender line. */
  extenderDropSp: 0.25,
} as const;

// ---------------------------------------------------------------------------
// Widths (shared with spacing.ts)
// ---------------------------------------------------------------------------

/** Estimated ink width of a syllable at the lyric size. */
export function lyricWidth(text: string, size: number = LYRICS.sizeSp): number {
  return text.length * size * LYRICS.widthRatio;
}

/**
 * Horizontal room one syllable needs, centred on its notehead: its own width
 * plus the padding that keeps it clear of the neighbouring syllable. spacing.ts
 * turns the widest value at an onset into a minimum column width.
 */
export function lyricColumnWidth(text: string): number {
  return lyricWidth(text) + LYRICS.padSp;
}

/** The room the lyrics of one event need, or 0 when it carries none. */
export function eventLyricWidth(ev: EventLayout): number {
  const event = ev.event;
  if (event.kind !== "note") return 0;
  let w = 0;
  for (const l of event.lyrics ?? []) {
    if (l.text.length === 0) continue;
    const hyphen = l.syllabic === "begin" || l.syllabic === "middle";
    w = Math.max(w, lyricColumnWidth(l.text) + (hyphen ? LYRICS.hyphenAllowanceSp : 0));
  }
  return w;
}

// ---------------------------------------------------------------------------
// Which staves sing
// ---------------------------------------------------------------------------

/**
 * True when any event of this staff slot carries a lyric somewhere in the
 * system. The vocal convention follows from it: dynamics and hairpins on a staff
 * with words go *above* the staff, because the words own everything below it.
 */
export function staffHasLyrics(sys: EmitSystem, slotIndex: number): boolean {
  for (const spacing of sys.spacings) {
    const staff = spacing.staves[slotIndex];
    if (!staff) continue;
    for (const ev of staff.events) {
      const event = ev.event;
      if (event.kind === "note" && (event.lyrics?.length ?? 0) > 0) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

/** One laid-out event of a staff, with its final system-coordinate column x. */
interface Site {
  x: number;
  ev: EventLayout;
}

/** One syllable to draw, already resolved to a position. */
interface Syllable {
  site: Site;
  lyric: Lyric;
  /** Centre of the notehead cluster. */
  centre: number;
  halfWidth: number;
  /** Index of `site` in the staff's event list, for melisma lookups. */
  siteIndex: number;
}

function record(ext: SystemExtent, minY: number, maxY: number): void {
  if (-minY > ext.above) ext.above = -minY;
  if (maxY > ext.below) ext.below = maxY;
}

/**
 * Draw every verse of every staff. Returns, per system, how far the new ink
 * reaches above and below the system origin, exactly like the other passes.
 */
export function emitLyrics(systems: EmitSystem[], ctx: EmitContext): SystemExtent[] {
  const extents: SystemExtent[] = systems.map(() => ({ above: 0, below: 0 }));

  for (const [systemIndex, sys] of systems.entries()) {
    const skylines = buildSkyline(sys.primitives, sys.slots, ctx.font);
    for (const [slotIndex] of ctx.slots.entries()) {
      const sk = skylines[slotIndex];
      if (!sk) continue;
      const sites = collectSites(sys, slotIndex);
      if (sites.length === 0) continue;
      emitStaffLyrics(sys, sites, sk, extents[systemIndex]!);
    }
  }

  return extents;
}

/** Every laid-out event of one staff slot across the system, left to right. */
function collectSites(sys: EmitSystem, slotIndex: number): Site[] {
  const sites: Site[] = [];
  for (const spacing of sys.spacings) {
    const staff = spacing.staves[slotIndex];
    if (!staff) continue;
    const columnX = new Map<string, number>();
    for (const c of spacing.columns) columnX.set(fracToString(c.offset), spacing.x + c.x);
    for (const ev of staff.events) {
      sites.push({ x: columnX.get(fracToString(ev.offset)) ?? spacing.x + spacing.head, ev });
    }
  }
  sites.sort((a, b) => a.x - b.x);
  return sites;
}

/** Centre of an event's notehead cluster, or its column origin for a rest. */
function noteheadCentre(site: Site): number {
  const notes = site.ev.notes;
  if (notes.length === 0) return site.x;
  let left = Infinity;
  let right = -Infinity;
  for (const n of notes) {
    left = Math.min(left, n.x);
    right = Math.max(right, n.x + n.width);
  }
  return site.x + (left + right) / 2;
}

function emitStaffLyrics(
  sys: EmitSystem,
  sites: Site[],
  sk: StaffSkyline,
  ext: SystemExtent,
): void {
  // Group the syllables by verse, keeping each verse in left-to-right order.
  const verses = new Map<number, Syllable[]>();
  for (const [siteIndex, site] of sites.entries()) {
    const event = site.ev.event;
    if (event.kind !== "note") continue;
    for (const lyric of event.lyrics ?? []) {
      if (lyric.text.length === 0) continue;
      const list = verses.get(lyric.verse);
      const syllable: Syllable = {
        site,
        lyric,
        centre: noteheadCentre(site),
        halfWidth: lyricWidth(lyric.text) / 2,
        siteIndex,
      };
      if (list) list.push(syllable);
      else verses.set(lyric.verse, [syllable]);
    }
  }
  if (verses.size === 0) return;

  // One flat lane per verse, measured from the staff's whole bottom profile so
  // the baselines of a verse line up across the system.
  const laneTop =
    Math.max(sk.staffY + STAFF_HEIGHT + LYRICS.laneMinSp, clearanceBelow(sk, 0, sys.width)) +
    LYRICS.laneGapSp;
  const firstBaseline = laneTop + LYRICS.sizeSp * LYRICS.ascentRatio;

  for (const [verse, syllables] of [...verses.entries()].sort((a, b) => a[0] - b[0])) {
    const baseline = firstBaseline + verse * LYRICS.versePitchSp;
    emitVerse(sys, sites, syllables, baseline, ext);
  }
}

function emitVerse(
  sys: EmitSystem,
  sites: Site[],
  syllables: Syllable[],
  baseline: number,
  ext: SystemExtent,
): void {
  const top = baseline - LYRICS.sizeSp * LYRICS.ascentRatio;
  const bottom = baseline + LYRICS.sizeSp * LYRICS.descentRatio;

  for (const [i, syl] of syllables.entries()) {
    const ref: Ref = { id: syl.site.ev.event.id, role: "lyric" };
    push(sys, {
      type: "text",
      text: syl.lyric.text,
      x: syl.centre,
      y: baseline,
      size: LYRICS.sizeSp,
      style: "lyric",
      anchor: "middle",
      ref,
    } satisfies TextPrim);
    record(ext, top, bottom);

    const next = syllables[i + 1];
    if (syl.lyric.syllabic === "begin" || syl.lyric.syllabic === "middle") {
      emitHyphens(sys, syl, next, baseline, ref, ext);
    }
    if (syl.lyric.extend) {
      emitExtender(sys, sites, syl, next, baseline, ref, ext);
    }
  }
}

/**
 * Hyphens between a begin/middle syllable and the one that follows it: one in
 * the middle of a short gap, and evenly spaced repeats no further than
 * `hyphenPitchSp` apart over a long one. A cramped gap still gets its one
 * hyphen — a missing hyphen misreads the word, a tight one does not.
 */
function emitHyphens(
  sys: EmitSystem,
  syl: Syllable,
  next: Syllable | undefined,
  baseline: number,
  ref: Ref,
  ext: SystemExtent,
): void {
  if (!next) return;
  const from = syl.centre + syl.halfWidth + LYRICS.gapSp;
  const to = next.centre - next.halfWidth - LYRICS.gapSp;
  const span = Math.max(0, to - from);
  const count = Math.max(1, Math.ceil(span / LYRICS.hyphenPitchSp));
  // Over a cramped gap `to` may sit left of `from`; the midpoint of the two
  // syllables' facing edges is then the least bad place.
  const start = to >= from ? from : (from + to) / 2;
  for (let k = 0; k < count; k++) {
    push(sys, {
      type: "text",
      text: "-",
      x: start + (span * (k + 0.5)) / count,
      y: baseline,
      size: LYRICS.sizeSp,
      style: "lyric",
      anchor: "middle",
      ref,
    } satisfies TextPrim);
  }
  record(ext, baseline - LYRICS.sizeSp * LYRICS.ascentRatio, baseline);
}

/**
 * The extender line of a melisma: from the end of the syllable to the right edge
 * of the last note it is sung over — the note just before the next syllable of
 * the verse, or the staff's last note when the melisma runs to the system end.
 */
function emitExtender(
  sys: EmitSystem,
  sites: Site[],
  syl: Syllable,
  next: Syllable | undefined,
  baseline: number,
  ref: Ref,
  ext: SystemExtent,
): void {
  const lastIndex = (next ? next.siteIndex : sites.length) - 1;
  const last = sites[lastIndex];
  if (!last || lastIndex <= syl.siteIndex) return;
  const from = syl.centre + syl.halfWidth + LYRICS.gapSp;
  const to = last.x + last.ev.right;
  if (to - from < LYRICS.extenderMinSp) return;
  const y = baseline + LYRICS.extenderDropSp;
  push(sys, {
    type: "line",
    x1: from,
    y1: y,
    x2: to,
    y2: y,
    thickness: LYRICS.extenderThicknessSp,
    ref,
  } satisfies LinePrim);
  record(ext, y, y + LYRICS.extenderThicknessSp / 2);
}

function push(sys: EmitSystem, prim: Primitive): void {
  sys.primitives.push(prim);
}
