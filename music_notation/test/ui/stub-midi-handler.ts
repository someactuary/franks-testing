// Test-only stub (the app uses @/input/midi-entry)
/**
 * Minimal `MidiHandler` stub so the MIDI toolbar and `store.applyMidi` pipeline
 * (src/ui/midi.ts) can be built and exercised before the real `handleMidiNote`
 * (src/input/midi-entry.ts, landing from a parallel work stream) exists.
 *
 * Deliberately dumb: every note-on writes a fixed C4 quarter note at the cursor,
 * regardless of the incoming MIDI pitch, velocity, or `entry.base`/`dots` —
 * enough to see MIDI events reach the score through History, nothing more.
 * Held notes (chord building) and crossing a measure boundary are NOT
 * implemented here; a note-on that doesn't fit in the current measure is
 * refused with a status-bar message instead of throwing, matching how
 * src/input/step-entry.ts's `enter()` reports refusals.
 */
import { canWrite, writeEvent } from "@/commands/edit";
import { add, QUARTER } from "@/model/duration";
import { note } from "@/model/factory";
import type { Cursor, MidiHandler } from "@/input/types";

export const stubMidiHandler: MidiHandler = (state, _ev) => {
  if (!state.entry.active) return null;

  const { score, cursor } = state;
  const refusal = canWrite(score, cursor, QUARTER);
  if (refusal) return { commands: [], message: refusal };

  const event = note("C4", 4);
  const newCursor: Cursor = { ...cursor, offset: add(cursor.offset, QUARTER) };
  return {
    commands: [writeEvent(cursor, event)],
    cursor: newCursor,
    selection: { ids: [event.notes[0]!.id] },
  };
};
