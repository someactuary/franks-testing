/**
 * The basic edit commands. Each is a small factory returning a `Command`
 * (see src/commands/types.ts): construct it with whatever it needs to know,
 * and `apply(draft)` performs the edit against an immer draft.
 */
import { emptyVoice, newId } from "@/model";
import type { Anchor, MeasureAttributes, NotatedDuration, PartMeasure, Pitch, RestEvent, ScoreMeta } from "@/model";
import { findEventInVoice, locateEvent, locateNote, type Event } from "./locate";
import type { Command } from "./types";

/** Merges `patch` into `score.meta`. */
export function setMeta(patch: Partial<ScoreMeta>): Command {
  return {
    label: "Set score meta",
    apply(draft) {
      Object.assign(draft.meta, patch);
    },
  };
}

/** Convenience wrapper over setMeta for the common case of just changing the title. */
export function setTitle(text: string): Command {
  return {
    label: "Set title",
    apply(draft) {
      draft.meta.title = text;
    },
  };
}

export interface InsertEventAfterOptions {
  partIndex: number;
  measureIndex: number;
  staffIndex: number;
  voiceIndex: number;
  /** Id of the event to insert after, or `null` to insert at the start of the voice. */
  afterEventId: string | null;
  event: Event;
}

/** Inserts `event` into a specific voice, either at the start (`afterEventId: null`) or right after an existing event (searched inside tuplets too). */
export function insertEventAfter(opts: InsertEventAfterOptions): Command {
  return {
    label: "Insert event",
    apply(draft) {
      const part = draft.parts[opts.partIndex];
      if (!part) throw new Error(`insertEventAfter: no part at index ${opts.partIndex}`);
      const pm = part.measures[opts.measureIndex];
      if (!pm) throw new Error(`insertEventAfter: no measure at index ${opts.measureIndex}`);
      const sm = pm.staves[opts.staffIndex];
      if (!sm) throw new Error(`insertEventAfter: no staff at index ${opts.staffIndex}`);
      const voice = sm.voices[opts.voiceIndex];
      if (!voice) throw new Error(`insertEventAfter: no voice at index ${opts.voiceIndex}`);

      if (opts.afterEventId === null) {
        voice.items.unshift(opts.event);
        return;
      }

      const hit = findEventInVoice(voice, opts.afterEventId);
      if (!hit) {
        throw new Error(`insertEventAfter: no event with id "${opts.afterEventId}" in the target voice`);
      }
      hit.items.splice(hit.index + 1, 0, opts.event);
    },
  };
}

/** Replaces the event with id `eventId` with `event`, keeping the original id. */
export function replaceEvent(eventId: string, event: Event): Command {
  return {
    label: "Replace event",
    apply(draft) {
      const hit = locateEvent(draft, eventId);
      if (!hit) throw new Error(`replaceEvent: no event with id "${eventId}"`);
      hit.items[hit.index] = { ...event, id: eventId };
    },
  };
}

/** Deletes the event with id `eventId`, replacing it with a rest of the same notated duration so the voice's length is unchanged. */
export function deleteEvent(eventId: string): Command {
  return {
    label: "Delete event",
    apply(draft) {
      const hit = locateEvent(draft, eventId);
      if (!hit) throw new Error(`deleteEvent: no event with id "${eventId}"`);
      const replacement: RestEvent = { kind: "rest", id: newId(), duration: hit.event.duration };
      hit.items[hit.index] = replacement;
    },
  };
}

/** Changes the pitch of the note with id `noteId`. */
export function setNotePitch(noteId: string, pitch: Pitch): Command {
  return {
    label: "Set note pitch",
    apply(draft) {
      const hit = locateNote(draft, noteId);
      if (!hit) throw new Error(`setNotePitch: no note with id "${noteId}"`);
      hit.note.pitch = pitch;
    },
  };
}

/** Changes the notated duration of the event with id `eventId`. Does not re-flow any following events. */
export function setEventDuration(eventId: string, duration: NotatedDuration): Command {
  return {
    label: "Set event duration",
    apply(draft) {
      const hit = locateEvent(draft, eventId);
      if (!hit) throw new Error(`setEventDuration: no event with id "${eventId}"`);
      hit.event.duration = duration;
    },
  };
}

/** Toggles whether the note with id `noteId` starts a tie to the next note of the same pitch. */
export function toggleTie(noteId: string): Command {
  return {
    label: "Toggle tie",
    apply(draft) {
      const hit = locateNote(draft, noteId);
      if (!hit) throw new Error(`toggleTie: no note with id "${noteId}"`);
      hit.note.tieStart = !hit.note.tieStart;
    },
  };
}

/** Inserts `count` empty measures (a measure-rest in every staff's voice 0, for every part) at `atIndex` (defaults to the end). */
export function addMeasures(count: number, atIndex?: number): Command {
  return {
    label: "Add measures",
    apply(draft) {
      const insertAt = atIndex ?? draft.measures.length;

      const newMeasureAttrs: MeasureAttributes[] = Array.from({ length: count }, () => ({ id: newId() }));
      draft.measures.splice(insertAt, 0, ...newMeasureAttrs);

      for (const part of draft.parts) {
        const newPartMeasures: PartMeasure[] = Array.from({ length: count }, () => ({
          staves: part.staves.map(() => ({ voices: [emptyVoice(0)] })),
        }));
        part.measures.splice(insertAt, 0, ...newPartMeasures);
      }
    },
  };
}

function isAnchoredAtMeasure(anchor: Anchor, measureIndex: number): boolean {
  return anchor.kind === "measure" && anchor.measureIndex === measureIndex;
}

/** Removes the measure at `index` from every part, and drops any spanner/attachment anchored directly to that measure. */
export function removeMeasure(index: number): Command {
  return {
    label: "Remove measure",
    apply(draft) {
      if (index < 0 || index >= draft.measures.length) {
        throw new Error(`removeMeasure: index ${index} out of range`);
      }

      draft.measures.splice(index, 1);
      for (const part of draft.parts) {
        part.measures.splice(index, 1);
      }

      draft.spanners = draft.spanners.filter(
        (s) => !(isAnchoredAtMeasure(s.start, index) || isAnchoredAtMeasure(s.end, index)),
      );
      draft.attachments = draft.attachments.filter((a) => !isAnchoredAtMeasure(a.anchor, index));
    },
  };
}
