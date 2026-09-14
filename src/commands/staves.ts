/**
 * Staff management commands (docs/ARCHITECTURE.md's "Staves" M2 contract):
 * addStaff/removeStaff/setClef/setStaffName/setBracket, operating on the score's
 * (single, piano) Part. Adding or removing a staff keeps every PartMeasure's
 * `staves` array index-aligned with `Part.staves`, and keeps spanner/attachment
 * `staffIndex` and event/note `staff` cross-staff overrides in sync: shifted when a
 * staff before them is added/removed, dropped (spanners/attachments) or cleared
 * (overrides) when they pointed at a staff that's gone.
 */
import { emptyVoice, newId } from "@/model";
import type {
  ClefKind,
  GraceGroup,
  Note,
  NoteEvent,
  RestEvent,
  StaffDef,
  StaffGroupSymbol,
  VoiceItem,
} from "@/model";
import type { Command } from "./types";

type StaffRemap = (staffIndex: number) => number | undefined;

function remapNoteStaff(note: Note, remap: StaffRemap): void {
  if (note.staff === undefined) return;
  const next = remap(note.staff);
  if (next === undefined) delete note.staff;
  else note.staff = next;
}

function remapEventStaff(event: NoteEvent | RestEvent, remap: StaffRemap): void {
  if (event.staff !== undefined) {
    const next = remap(event.staff);
    if (next === undefined) delete event.staff;
    else event.staff = next;
  }
  if (event.kind === "note") {
    for (const n of event.notes) remapNoteStaff(n, remap);
  }
  if (event.grace) remapGraceStaff(event.grace, remap);
}

function remapGraceStaff(grace: GraceGroup, remap: StaffRemap): void {
  for (const g of grace.events) remapEventStaff(g, remap);
}

/** Applies `remap` to every `staff` override on events/notes/grace-notes within `items`, descending into tuplets. */
function remapItemsStaff(items: VoiceItem[], remap: StaffRemap): void {
  for (const item of items) {
    if (item.kind === "tuplet") remapItemsStaff(item.items, remap);
    else remapEventStaff(item, remap);
  }
}

/** A staffIndex at or after `atIndex` shifts up by one (inserting a staff at `atIndex`). */
function shiftUpFrom(atIndex: number): StaffRemap {
  return (staffIndex) => (staffIndex >= atIndex ? staffIndex + 1 : staffIndex);
}

/** A staffIndex pointing at `index` is cleared (that staff is gone); one after it shifts down by one. */
function shiftDownAndClear(index: number): StaffRemap {
  return (staffIndex) => (staffIndex === index ? undefined : staffIndex > index ? staffIndex - 1 : staffIndex);
}

/**
 * Adds a `StaffDef` at `atIndex` to the score's (first) part, with a matching
 * measure-rest-filled `StaffMeasure` inserted into every `PartMeasure` at the same
 * index. `atIndex` is clamped to `[0, staves.length]`. Shifts `staffIndex` on
 * spanners/attachments, and `staff` cross-staff overrides on events/notes, that are
 * at or after `atIndex`.
 */
export function addStaff(atIndex: number, clef: ClefKind, name?: string): Command {
  return {
    label: "Add staff",
    apply(draft) {
      const part = draft.parts[0];
      if (!part) throw new Error("addStaff: score has no part");
      const insertAt = Math.max(0, Math.min(atIndex, part.staves.length));

      const staffDef: StaffDef = { id: newId(), lines: 5, initialClef: clef, ...(name ? { name } : {}) };
      part.staves.splice(insertAt, 0, staffDef);
      for (const pm of part.measures) {
        pm.staves.splice(insertAt, 0, { voices: [emptyVoice(0)] });
      }

      const remap = shiftUpFrom(insertAt);
      for (const s of draft.spanners) if (s.partIndex === 0) s.staffIndex = remap(s.staffIndex)!;
      for (const a of draft.attachments) if (a.partIndex === 0) a.staffIndex = remap(a.staffIndex)!;
      for (const pm of part.measures) {
        for (const sm of pm.staves) {
          for (const voice of sm.voices) remapItemsStaff(voice.items, remap);
        }
      }
    },
  };
}

/**
 * Removes the staff at `index` from the score's (first) part, along with its
 * `StaffMeasure` in every `PartMeasure`. Throws if it is the part's last staff.
 * Drops spanners/attachments anchored to that staff and shifts later ones down by
 * one; clears (rather than leaving dangling) `staff` overrides on events/notes that
 * pointed at it, and shifts later ones down by one.
 */
export function removeStaff(index: number): Command {
  return {
    label: "Remove staff",
    apply(draft) {
      const part = draft.parts[0];
      if (!part) throw new Error("removeStaff: score has no part");
      if (part.staves.length <= 1) throw new Error("removeStaff: cannot remove the last staff");
      if (index < 0 || index >= part.staves.length) throw new Error(`removeStaff: index ${index} out of range`);

      part.staves.splice(index, 1);
      for (const pm of part.measures) pm.staves.splice(index, 1);

      draft.spanners = draft.spanners.filter((s) => !(s.partIndex === 0 && s.staffIndex === index));
      draft.attachments = draft.attachments.filter((a) => !(a.partIndex === 0 && a.staffIndex === index));
      for (const s of draft.spanners) if (s.partIndex === 0 && s.staffIndex > index) s.staffIndex -= 1;
      for (const a of draft.attachments) if (a.partIndex === 0 && a.staffIndex > index) a.staffIndex -= 1;

      const remap = shiftDownAndClear(index);
      for (const pm of part.measures) {
        for (const sm of pm.staves) {
          for (const voice of sm.voices) remapItemsStaff(voice.items, remap);
        }
      }
    },
  };
}

/** Sets the initial clef of the staff at `index`. */
export function setClef(index: number, clef: ClefKind): Command {
  return {
    label: "Set clef",
    apply(draft) {
      const staff = draft.parts[0]?.staves[index];
      if (!staff) throw new Error(`setClef: no staff at index ${index}`);
      staff.initialClef = clef;
    },
  };
}

/** Sets the (first-system) name and, if given, the (later-system) abbreviation of the staff at `index`. Omitting `abbreviation` leaves the existing one untouched. */
export function setStaffName(index: number, name: string, abbreviation?: string): Command {
  return {
    label: "Set staff name",
    apply(draft) {
      const staff = draft.parts[0]?.staves[index];
      if (!staff) throw new Error(`setStaffName: no staff at index ${index}`);
      staff.name = name;
      if (abbreviation !== undefined) staff.abbreviation = abbreviation;
    },
  };
}

/** Sets the symbol joining the part's staves at each system start ("brace" / "bracket" / "none"). */
export function setBracket(bracket: StaffGroupSymbol): Command {
  return {
    label: "Set bracket",
    apply(draft) {
      const part = draft.parts[0];
      if (!part) throw new Error("setBracket: score has no part");
      part.bracket = bracket;
    },
  };
}
