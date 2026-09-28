/**
 * Pure copy/paste helpers. `copySelection` reads the current selection into a
 * `ClipboardContent` (see src/input/types.ts); `pasteAt` turns one back into commands
 * that write it at the cursor via `writeSequence`. Neither mutates `state`.
 */
import { add, cmp, eq, lt, sub, ZERO, type Fraction, type Score } from "@/model";
import { itemLength } from "@/model/traverse";
import { newId } from "@/model/ids";
import type { NoteEvent, RestEvent } from "@/model/score";
import { measureLength as timeSigMeasureLength, type TimeSignature } from "@/model/duration";
import { measureLengthAt, writeSequence } from "@/commands/edit";
import { restsFor } from "@/commands/rhythm";
import type { Command } from "@/commands/types";
import { absoluteOffset, resolveSelection } from "./navigation";
import type { ClipboardContent, ClipboardItem, ClipboardStaff, Cursor, EditorState } from "./types";

/**
 * Copies the current selection into a `ClipboardContent`, or `null` if there is
 * nothing to copy (empty selection, only stale ids, or a selected event lives inside
 * a tuplet — the caller should show "Cannot copy tuplets yet" in that case). Events
 * are grouped by staff (voice 0 only, for now), each staff sorted by time, with every
 * item's offset made relative to the earliest onset across all copied staves. Events
 * are deep-copied; gaps between copied events on a staff are not filled (paste fills
 * them with rests).
 */
export function copySelection(state: EditorState): ClipboardContent | null {
  const { score, selection } = state;
  if (selection.ids.length === 0) return null;

  const resolved = resolveSelection(score, selection);
  if (resolved.length === 0) return null;
  if (resolved.some((r) => r.inTuplet)) return null;

  const withAbsolute = resolved.map((r) => ({ ...r, absolute: absoluteOffset(score, r.measureIndex, r.offset) }));
  const earliestOnset = withAbsolute.reduce(
    (min, r) => (lt(r.absolute, min) ? r.absolute : min),
    withAbsolute[0]!.absolute,
  );

  const staffIndices = [...new Set(withAbsolute.map((r) => r.staffIndex))].sort((a, b) => a - b);
  const topStaff = staffIndices[0]!;

  const staves: ClipboardStaff[] = staffIndices.map((staffIndex) => {
    const items: ClipboardItem[] = withAbsolute
      .filter((r) => r.staffIndex === staffIndex)
      .sort((a, b) => cmp(a.absolute, b.absolute))
      .map((r) => ({ offset: sub(r.absolute, earliestOnset), event: structuredClone(r.event) }));
    return { staffOffset: staffIndex - topStaff, items };
  });

  const length = staves.reduce((max, staff) => {
    for (const item of staff.items) {
      const end = add(item.offset, itemLength(item.event));
      if (lt(max, end)) max = end;
    }
    return max;
  }, ZERO);

  return { staves, length };
}

/** A copy of `event` with fresh ids on the event itself and (for a note) every note in the chord. */
function regenerateIds(event: NoteEvent | RestEvent): NoteEvent | RestEvent {
  if (event.kind === "rest") return { ...event, id: newId() };
  return { ...event, id: newId(), notes: event.notes.map((n) => ({ ...n, id: newId() })) };
}

/** The prevailing time signature's measure length, used for measure indices beyond the current score (appended measures always inherit it, like `addMeasures`/`writeSequence`). */
function projectedMeasureLength(score: Score, measureIndex: number): Fraction {
  if (measureIndex < score.measures.length) return measureLengthAt(score, measureIndex);
  let ts: TimeSignature | undefined;
  for (const ma of score.measures) if (ma.timeSig) ts = ma.timeSig;
  if (!ts) throw new Error(`projectedMeasureLength: no time signature found in ${score.measures.length} measures`);
  return timeSigMeasureLength(ts);
}

/** Cursor after moving forward `distance` from `start`, using (and, past the current score, projecting) measure lengths. Never reads the post-write score. */
function advanceCursor(score: Score, start: Cursor, distance: Fraction): Cursor {
  let measureIndex = start.measureIndex;
  let offset = start.offset;
  let remaining = distance;
  while (!eq(remaining, ZERO)) {
    const measureLen = projectedMeasureLength(score, measureIndex);
    const available = sub(measureLen, offset);
    const step = lt(available, remaining) ? available : remaining;
    offset = add(offset, step);
    remaining = sub(remaining, step);
    if (cmp(offset, measureLen) === 0) {
      measureIndex += 1;
      offset = ZERO;
    }
  }
  return { ...start, measureIndex, offset };
}

/**
 * Writes `state.clipboard` at `state.cursor`, one `writeSequence` command per copied
 * staff (target staff = `cursor.staffIndex + staffOffset`; staves that don't exist are
 * skipped, reported in `message`). Each staff's contiguous [0, length) span is rebuilt
 * with the copied events at their offsets and rests filling the gaps, then every event
 * and note id is regenerated (tieStart flags are kept exactly as copied). On success
 * (no staff skipped), `message` reports how many notes were pasted (the count of
 * originally-copied items, not counting the gap-filling rests paste adds); a skipped
 * staff is reported instead, taking priority over the count.
 */
export function pasteAt(state: EditorState): { commands: Command[]; cursorAfter: Cursor; message?: string } {
  const { score, cursor, clipboard } = state;
  if (!clipboard) return { commands: [], cursorAfter: cursor, message: "Nothing to paste" };

  const part = score.parts[cursor.partIndex];
  const commands: Command[] = [];
  let skippedAny = false;
  let pastedCount = 0;

  for (const staff of clipboard.staves) {
    const targetStaffIndex = cursor.staffIndex + staff.staffOffset;
    if (!part || targetStaffIndex < 0 || targetStaffIndex >= part.staves.length) {
      skippedAny = true;
      continue;
    }

    const sorted = [...staff.items].sort((a, b) => cmp(a.offset, b.offset));
    const sequence: (NoteEvent | RestEvent)[] = [];
    let t = ZERO;
    for (const item of sorted) {
      if (lt(t, item.offset)) sequence.push(...restsFor(sub(item.offset, t)));
      sequence.push(item.event);
      t = add(item.offset, itemLength(item.event));
    }
    if (lt(t, clipboard.length)) sequence.push(...restsFor(sub(clipboard.length, t)));

    const regenerated = sequence.map(regenerateIds);
    const targetCursor: Cursor = { ...cursor, staffIndex: targetStaffIndex, voiceIndex: 0 };
    commands.push(writeSequence(targetCursor, regenerated));
    pastedCount += staff.items.length;
  }

  const cursorAfter = advanceCursor(score, cursor, clipboard.length);
  if (skippedAny) {
    return { commands, cursorAfter, message: "Pasted, but a staff was out of range and was skipped" };
  }
  return { commands, cursorAfter, message: `Pasted ${pastedCount} notes` };
}
