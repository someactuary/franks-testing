/**
 * Tunable engraving constants. Everything is in staff spaces (sp).
 *
 * Anything that comes from the font (line thickness, beam thickness, leger line
 * extension, barline separation) is NOT here — it is read from
 * `font.engravingDefaults` at use time. This file holds only the numbers SMuFL
 * does not specify.
 */
export const ENGRAVING = {
  // --- horizontal spacing -------------------------------------------------
  /** Ideal width of a column whose shortest note is a quarter. */
  quarterColumnSp: 3.5,
  /** Added (subtracted) per doubling (halving) of the column duration: width = quarterColumnSp + logStepSp * log2(d / quarter). */
  logStepSp: 1.0,
  /** Floor for the duration-derived ideal width. */
  minIdealColumnSp: 1.2,
  /** Minimum ink-free gap between the right edge of one column and the left edge of the next. */
  minColumnGapSp: 0.6,
  /** Padding at the very start of a measure's prefix (after the preceding barline). */
  prefixLeadSp: 0.4,
  /** Gap after the clef. */
  clefGapSp: 0.9,
  /** Gap between successive key-signature accidentals. */
  keyAccidentalGapSp: 0.12,
  /** Gap between the cancellation naturals and the incoming key signature. */
  keyCancelGapSp: 0.35,
  /** Gap after the key signature. */
  keyGapSp: 0.9,
  /** Gap after the time signature. */
  timeGapSp: 1.0,
  /** Gap between the end of the prefix (or the opening barline) and the first note column. */
  measureLeadSp: 0.9,
  /** Gap between the last glyph of a measure and its closing barline. */
  barlineLeadSp: 0.9,

  // --- notes --------------------------------------------------------------
  /** Gap between an accidental and the notehead (or the next accidental column) it belongs to. */
  accidentalGapSp: 0.25,
  /** Gap between two accidental columns. */
  accidentalColumnGapSp: 0.12,
  /** Vertical clearance required between two accidentals in the same column. */
  accidentalClearanceSp: 0.1,
  /** Gap between the rightmost notehead of a chord and its first augmentation dot. */
  dotGapSp: 0.35,
  /** Gap between successive augmentation dots. */
  dotSpacingSp: 0.14,

  // --- stems and beams ----------------------------------------------------
  /** Standard stem length measured from the outer notehead centre. */
  stemLengthSp: 3.5,
  /** Minimum stem length for a note under a beam. */
  minBeamStemSp: 2.5,
  /** Maximum rise/fall of a beam over the whole group. */
  maxBeamSlopeSp: 1.0,
  /** Length of a fractional (partial) beam. */
  partialBeamSp: 1.0,

  // --- ties ---------------------------------------------------------------
  /** Horizontal gap between a notehead's edge and the tie endpoint. */
  tieGapSp: 0.22,
  /** Vertical offset of the tie endpoints from the notehead centre, towards the tie side. */
  tieEndOffsetSp: 0.5,
  /** Control-point height of a tie as a fraction of its horizontal length. */
  tieHeightRatio: 0.16,
  /** Floor and ceiling for the tie control-point height. */
  tieMinHeightSp: 0.5,
  tieMaxHeightSp: 1.2,
  /** Horizontal inset of the tie control points, as a fraction of its length. */
  tieShoulderRatio: 0.28,
  /** A tie shorter than this is not worth drawing. */
  tieMinLengthSp: 0.2,
  /** Gap between the start of a broken tie's second piece and the end of the system prefix. */
  tieAfterPrefixSp: 0.3,
  /** Extra lead in a system-starting measure whose first onset receives a tie from the previous system. */
  tieContinuationLeadSp: 1.6,

  // --- vertical / page ----------------------------------------------------
  /** Horizontal gap between the brace and the system's left edge. */
  braceGapSp: 0.6,
  /** Extra allowance above/below each staff when stacking systems. */
  staffOverhangSp: 2.0,
  /** Distance from the top staff line up to the measure-number baseline. */
  measureNumberOffsetSp: 1.8,
  /** Font size (sp) of measure numbers. */
  measureNumberSizeSp: 1.4,
  /** Title / composer block. */
  titleSizeSp: 3.4,
  subtitleSizeSp: 2.0,
  composerSizeSp: 1.8,
  /** Vertical space the title block occupies above the first system on page 1. */
  titleBlockSp: 9.0,
  /**
   * A final system shorter than this fraction of the available width is left at
   * its natural width instead of being stretched across the page.
   */
  lastSystemJustifyThreshold: 0.65,
} as const;

export type EngravingConstants = typeof ENGRAVING;
