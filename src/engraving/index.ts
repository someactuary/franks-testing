import type { Score } from "@/model";
import type { SmuflFontData } from "@/render/smufl/types";
import type { LayoutResult } from "./layout-types";

export * from "./layout-types";

export interface EngraveOptions {
  font: SmuflFontData;
}

/**
 * Engrave a score into pages of positioned primitives.
 * Pure: same score + font => same result. Never mutates the score.
 * Implemented in ./engrave.ts (M0: single staff, single voice, one system per page row).
 */
export type Engrave = (score: Score, opts: EngraveOptions) => LayoutResult;
