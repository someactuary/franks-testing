/**
 * Attachment and spanner commands (docs/ARCHITECTURE.md's "Attachments and spanners"
 * M2 contract): adding/removing them, toggling an articulation across a set of
 * events, setting a note's fingering, and helpers to build an `Anchor` (plus the
 * part/staff it lives on) from an event id — used by src/input/actions.ts to turn a
 * selection into a notation object without re-walking the score itself.
 */
import type { Anchor, Articulation, Attachment, Id, Score, Spanner } from "@/model";
import { locateEvent, locateNote } from "./locate";
import type { Command } from "./types";

/** An `{kind:"event"}` anchor for `eventId`. Does not check that the event exists. */
export function eventAnchor(eventId: Id): Anchor {
  return { kind: "event", eventId };
}

export interface EventLocation {
  anchor: Anchor;
  partIndex: number;
  /** The staff the anchor should render on: the event's `staff` cross-staff override if set, else the staff it's actually stored on. */
  staffIndex: number;
}

/** Locates `eventId` in `score` and returns an event anchor for it plus its part/staff index, or `undefined` if the event doesn't exist. */
export function locateEventAnchor(score: Score, eventId: Id): EventLocation | undefined {
  const hit = locateEvent(score, eventId);
  if (!hit) return undefined;
  return { anchor: eventAnchor(eventId), partIndex: hit.partIndex, staffIndex: hit.event.staff ?? hit.staffIndex };
}

/** Adds `att` to the score. Callers are responsible for giving it a fresh id. */
export function addAttachment(att: Attachment): Command {
  return {
    label: "Add attachment",
    apply(draft) {
      draft.attachments.push(att);
    },
  };
}

/** Removes the attachment with id `id`, if any (no-op otherwise). */
export function removeAttachment(id: Id): Command {
  return {
    label: "Remove attachment",
    apply(draft) {
      draft.attachments = draft.attachments.filter((a) => a.id !== id);
    },
  };
}

/** Adds `sp` to the score. Callers are responsible for giving it a fresh id. */
export function addSpanner(sp: Spanner): Command {
  return {
    label: "Add spanner",
    apply(draft) {
      draft.spanners.push(sp);
    },
  };
}

/** Removes the spanner with id `id`, if any (no-op otherwise). */
export function removeSpanner(id: Id): Command {
  return {
    label: "Remove spanner",
    apply(draft) {
      draft.spanners = draft.spanners.filter((s) => s.id !== id);
    },
  };
}

/**
 * Toggles `articulation` on every id in `eventIds` that resolves to a `NoteEvent`
 * (ids that resolve to a rest, or don't resolve at all, are ignored): adds it to
 * every one that lacks it if ANY of them lacks it, otherwise (all already have it)
 * removes it from all of them.
 */
export function toggleArticulation(eventIds: readonly Id[], articulation: Articulation): Command {
  return {
    label: "Toggle articulation",
    apply(draft) {
      const hits = eventIds
        .map((id) => locateEvent(draft, id))
        .filter((h) => h !== undefined && h.event.kind === "note");
      if (hits.length === 0) return;
      const allHave = hits.every((h) => h!.event.kind === "note" && (h!.event.articulations ?? []).includes(articulation));
      for (const h of hits) {
        if (h!.event.kind !== "note") continue;
        const current = h!.event.articulations ?? [];
        h!.event.articulations = allHave
          ? current.filter((a) => a !== articulation)
          : current.includes(articulation)
            ? current
            : [...current, articulation];
      }
    },
  };
}

/** Sets the fingering digit on note `noteId`, or clears it when `text` is `null`. */
export function setFingering(noteId: Id, text: string | null): Command {
  return {
    label: "Set fingering",
    apply(draft) {
      const hit = locateNote(draft, noteId);
      if (!hit) throw new Error(`setFingering: no note with id "${noteId}"`);
      if (text === null) delete hit.note.fingering;
      else hit.note.fingering = text;
    },
  };
}
