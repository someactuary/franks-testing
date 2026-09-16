/**
 * Manual layout control (docs/ARCHITECTURE.md, "Manual layout control"): forced
 * system/page breaks and the two global caps (`measuresPerSystem`, `systemsPerPage`)
 * that src/engraving/breaking.ts and vertical.ts honour, subject to what actually
 * fits the page (a cap only ever shortens a line/page, never overflows one).
 *
 * Also `setNudge`/`clearNudge`: small positional offsets for individually movable
 * markings (docs/ARCHITECTURE.md, "Selectable markings"), keyed by the marking's own
 * id (a Spanner or Attachment id — see `MOVABLE_ROLES` in src/ui/layout-utils.ts) and
 * applied by the engraver as one last translation of that id's primitives
 * (src/engraving/engrave.ts's `applyNudges`).
 */
import type { Command } from "./types";

/** Inserts `m` into a sorted, deduplicated ascending array of measure indices. */
function withInserted(list: number[], m: number): number[] {
  const set = new Set(list);
  set.add(m);
  return [...set].sort((a, b) => a - b);
}

function withRemoved(list: number[], m: number): number[] {
  return list.filter((x) => x !== m);
}

/**
 * Toggles a forced system break before `measureIndex`. A no-op at measure 0 (there is
 * nothing before the first measure to break from).
 */
export function toggleSystemBreak(measureIndex: number): Command {
  return {
    label: "Toggle system break",
    apply(draft) {
      if (measureIndex <= 0) return;
      const breaks = draft.layout.systemBreaks;
      draft.layout.systemBreaks = breaks.includes(measureIndex) ? withRemoved(breaks, measureIndex) : withInserted(breaks, measureIndex);
    },
  };
}

/** Toggles a forced page break before `measureIndex` (which also always starts a new system). */
export function togglePageBreak(measureIndex: number): Command {
  return {
    label: "Toggle page break",
    apply(draft) {
      if (measureIndex <= 0) return;
      const breaks = draft.layout.pageBreaks;
      draft.layout.pageBreaks = breaks.includes(measureIndex) ? withRemoved(breaks, measureIndex) : withInserted(breaks, measureIndex);
    },
  };
}

/** Sets the target maximum measures per system, or `null` to go back to automatic (fill to width). */
export function setMeasuresPerSystem(value: number | null): Command {
  return {
    label: "Set measures per system",
    apply(draft) {
      if (value === null) delete draft.layout.measuresPerSystem;
      else draft.layout.measuresPerSystem = value;
    },
  };
}

/** Sets the target maximum systems per page, or `null` to go back to automatic (fill to height). */
export function setSystemsPerPage(value: number | null): Command {
  return {
    label: "Set systems per page",
    apply(draft) {
      if (value === null) delete draft.layout.systemsPerPage;
      else draft.layout.systemsPerPage = value;
    },
  };
}

/**
 * Clears every forced system/page break, returning the whole score to automatic
 * breaking. The one-click fix for a score whose forced breaks (typically imported
 * from a PDF's original pagination, see "M4 contracts: PDF import") no longer make
 * sense after edits — e.g. a page left with only a few measures once earlier ones
 * were removed. Does not touch `measuresPerSystem`/`systemsPerPage`.
 */
export function clearForcedBreaks(): Command {
  return {
    label: "Clear forced breaks",
    apply(draft) {
      draft.layout.systemBreaks = [];
      draft.layout.pageBreaks = [];
    },
  };
}

/**
 * Sets a marking's positional offset (page-space sp, `dx` right, `dy` down) — an
 * absolute value, replacing any previous nudge for that id, not a delta. A live drag
 * (src/ui/ScoreView.tsx) computes the new absolute offset itself (previous nudge plus
 * the drag's own delta) so one drag gesture is one command, one undo step.
 */
export function setNudge(id: string, dx: number, dy: number): Command {
  return {
    label: "Move marking",
    apply(draft) {
      draft.layout.nudges[id] = { dx, dy };
    },
  };
}

/** Removes a marking's positional offset, snapping it back to its computed position. */
export function clearNudge(id: string): Command {
  return {
    label: "Reset marking position",
    apply(draft) {
      delete draft.layout.nudges[id];
    },
  };
}
