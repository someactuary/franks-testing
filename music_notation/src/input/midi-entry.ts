/**
 * Pure MIDI step-entry handler (docs/ARCHITECTURE.md's "MIDI input" M3 contract).
 * `MidiNoteOn`/`MidiHandler` are defined in src/input/types.ts (a contract file, not
 * modified here). `handleMidiNote` reuses `enterPitch` (factored out of
 * src/input/step-entry.ts) for the same write/advance code path a typed letter uses.
 */
import { keyAlter, STEPS, toMidi, type Alter, type KeySignature, type Pitch, type Step } from "@/model/pitch";
import { addNoteToEvent } from "@/commands/edit";
import { chordTarget, keySignatureAt } from "./navigation";
import { enterPitch } from "./step-entry";
import type { MidiHandler } from "./types";

/** The semitone (0-11) of `step` with no alteration, derived from `toMidi` rather than duplicating pitch.ts's private table. */
function naturalSemitone(step: Step): number {
  return toMidi({ step, alter: 0, octave: 0 }) - 12;
}

/** `((n % 12) + 12) % 12`, i.e. a pitch class in [0, 11] for any integer (including negative results of subtracting an alteration). */
function pitchClass(n: number): number {
  return ((n % 12) + 12) % 12;
}

/** The Pitch spelling `step`/`alter` for MIDI number `note` (assumes `naturalSemitone(step) + alter` is a MIDI-consistent semitone for `note`, i.e. congruent to it mod 12). */
function pitchForMidi(note: number, step: Step, alter: Alter): Pitch {
  const semitone = naturalSemitone(step) + alter;
  const octave = (note - semitone) / 12 - 1;
  return { step, alter, octave };
}

/**
 * Spells `note` (a MIDI number, 60 = middle C) in the context of `key`, per
 * docs/ARCHITECTURE.md's MIDI input contract: prefer the spelling the key
 * signature's own sharps/flats produce (one of the 7 diatonic steps, altered
 * exactly as `key` alters it); else a plain natural step; else — no natural or
 * key-consistent spelling exists for this pitch class — a sharp for a sharp key
 * (or C major), a flat for a flat key.
 */
export function spellMidi(note: number, key: KeySignature): Pitch {
  const pc = pitchClass(note);

  for (const step of STEPS) {
    const alter = keyAlter(key, step);
    if (pitchClass(naturalSemitone(step) + alter) === pc) return pitchForMidi(note, step, alter);
  }
  for (const step of STEPS) {
    if (naturalSemitone(step) === pc) return pitchForMidi(note, step, 0);
  }
  const alter: Alter = key.fifths >= 0 ? 1 : -1;
  for (const step of STEPS) {
    if (pitchClass(naturalSemitone(step) + alter) === pc) return pitchForMidi(note, step, alter);
  }
  /* istanbul ignore next -- every pitch class is a semitone away from some natural step, so one of the three loops above always matches. */
  throw new Error(`spellMidi: could not spell MIDI note ${note}`);
}

/**
 * Handles one MIDI note-on. Entry must be active (null otherwise). With nothing else
 * held, writes a NoteEvent of the current entry duration at the cursor (spelled per
 * the key signature) and advances — the same code path `enterPitch` gives a typed
 * letter; `entry.chordMode` is ignored (the cursor always advances). With other notes
 * currently held, adds the spelled pitch to the chord of the event before the cursor
 * instead of writing/advancing.
 */
export const handleMidiNote: MidiHandler = (state, ev) => {
  if (!state.entry.active) return null;

  const key = keySignatureAt(state.score, state.cursor.measureIndex);
  const pitch = spellMidi(ev.note, key);

  if (ev.held.length > 0) {
    const before = chordTarget(state.score, state.cursor);
    if (!before || before.event.kind !== "note") {
      return { commands: [], message: "No chord to add a note to" };
    }
    return { commands: [addNoteToEvent(before.event.id, pitch)] };
  }

  return enterPitch(state, pitch);
};
