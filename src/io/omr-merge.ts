/**
 * Joins OMR results that arrive one page at a time (homr reads a single image, so a
 * multi-page PDF comes back as one MusicXML file per page) into one score. Pure.
 * See docs/ARCHITECTURE.md "Second OMR engine: homr".
 *
 * Each page is imported on its own first (importMusicXml always yields a single part), then
 * the pages' measures are appended in order. A page can come back with fewer staves than
 * the others (homr skips staves it can't find, such as a small solo-line staff above the
 * piano), so each page's staves are lined up with the fullest page's staves by clef; the
 * staves a page lacks are filled with whole-measure rests and flagged for review.
 */
import {
  cmp,
  emptyVoice,
  ZERO,
  type Anchor,
  type ClefKind,
  type MeasureAttributes,
  type PartMeasure,
  type Score,
  type StaffMeasure,
  type VoiceItem,
} from "@/model";
import type { OmrReviewItem } from "./omr-cleanup";

export interface OmrMergeResult {
  score: Score;
  /** Pages whose staff count didn't match, in the same shape as cleanup's review items. */
  review: OmrReviewItem[];
}

/**
 * Picks where a page's `clefs` sit within the fuller page's `template` clefs: the
 * offset with the most matching clefs, the topmost on a tie.
 */
function bestStaffOffset(clefs: ClefKind[], template: ClefKind[]): number {
  let best = 0;
  let bestMatches = -1;
  for (let offset = 0; offset + clefs.length <= template.length; offset++) {
    const matches = clefs.filter((c, j) => c === template[offset + j]).length;
    if (matches > bestMatches) {
      best = offset;
      bestMatches = matches;
    }
  }
  return best;
}

function shiftStaff(items: VoiceItem[], offset: number): void {
  for (const item of items) {
    if (item.kind === "tuplet") {
      shiftStaff(item.items, offset);
      continue;
    }
    if (item.staff !== undefined) item.staff += offset;
    if (item.kind === "note")
      for (const g of item.grace?.events ?? []) if (g.staff !== undefined) g.staff += offset;
  }
}

function shiftAnchor(anchor: Anchor, measureOffset: number): Anchor {
  return anchor.kind === "measure"
    ? { ...anchor, measureIndex: anchor.measureIndex + measureOffset }
    : anchor;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function lastClef(measures: PartMeasure[], staffIndex: number, initial: ClefKind): ClefKind {
  for (let mi = measures.length - 1; mi >= 0; mi--) {
    const changes = measures[mi]!.staves[staffIndex]?.clefChanges;
    if (changes?.length) return changes[changes.length - 1]!.clef;
  }
  return initial;
}

export function mergeOmrPages(pages: Score[]): OmrMergeResult {
  if (pages.length === 0) throw new Error("mergeOmrPages needs at least one page");
  if (pages.length === 1) return { score: structuredClone(pages[0]!), review: [] };

  const copies = pages.map((p) => structuredClone(p));
  const template = copies.reduce((best, p) =>
    p.parts[0]!.staves.length > best.parts[0]!.staves.length ? p : best,
  );
  const templatePart = template.parts[0]!;
  const staffCount = templatePart.staves.length;
  const templateClefs = templatePart.staves.map((s) => s.initialClef);

  const first = copies[0]!;
  const merged: Score = {
    ...first,
    meta: Object.assign({}, ...copies.map((p) => p.meta).reverse()),
    measures: [],
    parts: [{ ...templatePart, staves: templatePart.staves.map((s) => ({ ...s })), measures: [] }],
    spanners: [],
    attachments: [],
    layout: { ...first.layout, systemBreaks: [], pageBreaks: [], nudges: {} },
  };
  const part = merged.parts[0]!;
  const review: OmrReviewItem[] = [];
  const staffSeen = new Array<boolean>(staffCount).fill(false);
  let runningTime: MeasureAttributes["timeSig"];
  let runningKey: MeasureAttributes["keySig"];

  for (const [pageIndex, page] of copies.entries()) {
    const pagePart = page.parts[0]!;
    const pageClefs = pagePart.staves.map((s) => s.initialClef);
    const staffOffset = bestStaffOffset(pageClefs, templateClefs);
    const measureOffset = merged.measures.length;

    if (pageClefs.length < staffCount) {
      review.push({
        measureIndex: measureOffset,
        staffIndex: staffOffset,
        reason: "page-mismatch",
        detail:
          `page ${pageIndex + 1} was recognized with ${pageClefs.length} of ${staffCount} staves; ` +
          `the missing staves were filled with rests. Check this page against the original`,
      });
    }

    // Clef each target staff is in when this page starts, before this page's measures are added.
    const clefAtPageStart = part.staves.map((staff, s) =>
      lastClef(part.measures, s, staff.initialClef),
    );

    for (const [mi, pm] of pagePart.measures.entries()) {
      const staves: StaffMeasure[] = [];
      for (let s = 0; s < staffCount; s++) {
        const j = s - staffOffset;
        const own = j >= 0 && j < pm.staves.length ? pm.staves[j]! : undefined;
        if (!own) {
          staves.push({ voices: [emptyVoice(0)] });
          continue;
        }
        for (const voice of own.voices) shiftStaff(voice.items, staffOffset);
        if (mi === 0) {
          const pageClef = pagePart.staves[j]!.initialClef;
          if (!staffSeen[s]) {
            // The first page that has this staff sets its opening clef.
            part.staves[s]!.initialClef = pageClef;
            staffSeen[s] = true;
          } else if (pageClef !== clefAtPageStart[s]) {
            const later = (own.clefChanges ?? []).filter((c) => cmp(c.at, ZERO) !== 0);
            own.clefChanges = [{ at: ZERO, clef: pageClef }, ...later];
          }
        }
        staves.push(own);
      }
      part.measures.push({ staves });

      // Each page restates its key and time signature; keep only real changes.
      const attrs = page.measures[mi]!;
      if (attrs.timeSig && sameJson(attrs.timeSig, runningTime) && measureOffset > 0 && mi === 0)
        delete attrs.timeSig;
      if (attrs.keySig && sameJson(attrs.keySig, runningKey) && measureOffset > 0 && mi === 0)
        delete attrs.keySig;
      if (attrs.timeSig) runningTime = attrs.timeSig;
      if (attrs.keySig) runningKey = attrs.keySig;
      merged.measures.push(attrs);
    }

    for (const sp of page.spanners) {
      merged.spanners.push({
        ...sp,
        staffIndex: sp.staffIndex + staffOffset,
        start: shiftAnchor(sp.start, measureOffset),
        end: shiftAnchor(sp.end, measureOffset),
      });
    }
    for (const at of page.attachments) {
      merged.attachments.push({
        ...at,
        staffIndex: at.staffIndex + staffOffset,
        anchor: shiftAnchor(at.anchor, measureOffset),
      });
    }

    merged.layout.systemBreaks.push(...page.layout.systemBreaks.map((m) => m + measureOffset));
    merged.layout.pageBreaks.push(...page.layout.pageBreaks.map((m) => m + measureOffset));
    // Every page after the first starts a new page, like the original.
    if (pageIndex > 0 && !merged.layout.pageBreaks.includes(measureOffset))
      merged.layout.pageBreaks.push(measureOffset);
    Object.assign(merged.layout.nudges, page.layout.nudges);
  }

  merged.layout.systemBreaks = [...new Set(merged.layout.systemBreaks)].sort((a, b) => a - b);
  merged.layout.pageBreaks = [...new Set(merged.layout.pageBreaks)].sort((a, b) => a - b);
  return { score: merged, review };
}
