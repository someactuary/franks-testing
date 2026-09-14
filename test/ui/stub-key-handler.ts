/**
 * Test-only navigation-only `KeyHandler` for developing/testing the UI shell
 * before the real step-entry handler (src/input/step-entry.ts) lands from a
 * parallel work stream. Deliberately minimal:
 *
 *  - ArrowLeft / ArrowRight: move the cursor to the previous/next event onset
 *    in the same part/staff/voice (crossing measure boundaries).
 *  - mod+z / mod+shift+z: undo / redo (handled by the store, not commands).
 *  - "n": toggle note-entry mode (`entry.active`).
 *  - everything else: unhandled (null) — the browser/App does whatever it
 *    would otherwise do with the key.
 *
 * Never writes to the score (`commands` is always empty), and never imports
 * from src/input — it only depends on the shared contract types.
 */
import { cmp, eq, type Fraction } from "@/model/duration";
import { allEvents } from "@/model/traverse";
import type { Cursor, KeyHandler } from "@/input/types";

interface Onset {
  measureIndex: number;
  offset: Fraction;
}

function compareOnset(a: Onset, b: Onset): number {
  return a.measureIndex - b.measureIndex || cmp(a.offset, b.offset);
}

function onsetsFor(score: Parameters<KeyHandler>[0]["score"], cursor: Cursor): Onset[] {
  const points: Onset[] = [];
  for (const e of allEvents(score)) {
    if (
      e.partIndex === cursor.partIndex &&
      e.staffIndex === cursor.staffIndex &&
      e.voice.index === cursor.voiceIndex
    ) {
      points.push({ measureIndex: e.measureIndex, offset: e.positioned.offset });
    }
  }
  points.sort(compareOnset);
  return points;
}

export const stubKeyHandler: KeyHandler = (state, key) => {
  if (key.mod && !key.alt && key.key.toLowerCase() === "z") {
    return { commands: [], history: key.shift ? "redo" : "undo" };
  }

  if (!key.mod && !key.alt && !key.shift && key.key.toLowerCase() === "n") {
    return { commands: [], entry: { ...state.entry, active: !state.entry.active } };
  }

  if (key.key === "ArrowLeft" || key.key === "ArrowRight") {
    const dir = key.key === "ArrowLeft" ? -1 : 1;
    const cursor = state.cursor;
    const points = onsetsFor(state.score, cursor);
    if (points.length === 0) return null;

    const here: Onset = { measureIndex: cursor.measureIndex, offset: cursor.offset };
    const exactIndex = points.findIndex((p) => p.measureIndex === here.measureIndex && eq(p.offset, here.offset));

    let targetIndex: number;
    if (exactIndex !== -1) {
      targetIndex = exactIndex + dir;
    } else {
      // Not sitting exactly on an onset (e.g. after the last event in a
      // measure): find where `here` would sort in, then step from there.
      let insertAt = points.findIndex((p) => compareOnset(p, here) > 0);
      if (insertAt === -1) insertAt = points.length;
      targetIndex = dir === 1 ? insertAt : insertAt - 1;
    }

    if (targetIndex < 0 || targetIndex >= points.length) return null;
    const target = points[targetIndex]!;
    const newCursor: Cursor = { ...cursor, measureIndex: target.measureIndex, offset: target.offset };
    return { commands: [], cursor: newCursor };
  }

  return null;
};
