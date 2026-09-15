// TEMPORARY: replaced by cleanupOmrScore from @/io/omr-cleanup at merge
/**
 * Minimal stand-in for src/io/omr-cleanup.ts (implemented by another agent in
 * parallel). Same name/signature so the swap at merge is a one-line import
 * change in App.tsx. This stub does none of the real cleanup (dropping generic
 * names, building the review list) — it only honours `keepLayout`, matching the
 * one behaviour the Import PDF flow's UI depends on today (the "Keep the
 * original page and system breaks" checkbox).
 */
import type { Score } from "@/model";
import type { OmrCleanupOptions, OmrCleanupResult } from "@/io/omr-cleanup";

export function cleanupOmrScore(score: Score, opts: OmrCleanupOptions): OmrCleanupResult {
  if (opts.keepLayout) return { score, review: [] };
  const cloned = structuredClone(score);
  cloned.layout.systemBreaks = [];
  cloned.layout.pageBreaks = [];
  return { score: cloned, review: [] };
}
