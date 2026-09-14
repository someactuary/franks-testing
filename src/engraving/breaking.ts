/**
 * Line breaking: which measures go on which system.
 *
 * M0 uses first-fit greedy breaking (fill the system, then justify). A measure
 * is wider when it starts a system because it carries a clef prefix, so the
 * caller supplies both widths.
 */

export interface BreakInput {
  measureCount: number;
  /** Natural width of measure m when it is not the first of a system. */
  widthMid: number[];
  /** Natural width of measure m when it is the first of a system (clef prefix). */
  widthStart: number[];
  availableWidth: number;
  /** Measure indices that must begin a new system. */
  systemBreaks: readonly number[];
  /** Measure indices that must begin a new page (and therefore a new system). */
  pageBreaks: readonly number[];
}

export interface SystemPlan {
  /** Measure indices on this system, contiguous and ascending. */
  measures: number[];
  /** True when a forced page break starts this system. */
  startsPage: boolean;
}

export function planSystems(input: BreakInput): SystemPlan[] {
  const forcedSystem = new Set(input.systemBreaks);
  const forcedPage = new Set(input.pageBreaks);
  const systems: SystemPlan[] = [];

  let current: number[] = [];
  let used = 0;
  let startsPage = false;

  const flush = () => {
    if (current.length > 0) systems.push({ measures: current, startsPage });
    current = [];
    used = 0;
    startsPage = false;
  };

  for (let m = 0; m < input.measureCount; m++) {
    const forced = current.length > 0 && (forcedSystem.has(m) || forcedPage.has(m));
    if (forced) {
      const page = forcedPage.has(m);
      flush();
      startsPage = page;
    } else if (current.length === 0 && forcedPage.has(m)) {
      startsPage = true;
    }

    const w = current.length === 0 ? input.widthStart[m]! : input.widthMid[m]!;
    if (current.length > 0 && used + w > input.availableWidth) {
      flush();
      if (forcedPage.has(m)) startsPage = true;
      current.push(m);
      used = input.widthStart[m]!;
      continue;
    }
    current.push(m);
    used += w;
  }
  flush();
  return systems;
}
