/**
 * Locator helpers shared by the basic commands: find an event or note by id
 * inside a (draft) score and return enough context to replace or mutate it
 * in place. Commands call these instead of re-walking the tree themselves.
 */
import type { Note, NoteEvent, RestEvent, Score, TupletGroup, Voice, VoiceItem } from "@/model";

export type Event = NoteEvent | RestEvent;

export interface LocatedEvent {
  event: Event;
  /** The array that directly holds `event` — a voice's top-level items, or an enclosing TupletGroup's items. */
  items: VoiceItem[];
  /** `event`'s index within `items`. */
  index: number;
  voice: Voice;
  partIndex: number;
  measureIndex: number;
  staffIndex: number;
  voiceIndex: number;
  /** Enclosing tuplets, outermost first (empty if the event sits directly in the voice). */
  tuplets: TupletGroup[];
}

export interface LocatedNote {
  note: Note;
  /** The NoteEvent.notes array directly holding `note`. */
  notes: Note[];
  /** `note`'s index within `notes`. */
  index: number;
  /** The NoteEvent that directly owns `note` (may be a grace-note event). */
  event: NoteEvent;
}

interface ItemsHit {
  items: VoiceItem[];
  index: number;
  event: Event;
  tuplets: TupletGroup[];
}

function findEventInItems(items: VoiceItem[], eventId: string, tuplets: TupletGroup[]): ItemsHit | undefined {
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    if (item.kind === "tuplet") {
      const nested = findEventInItems(item.items, eventId, [...tuplets, item]);
      if (nested) return nested;
    } else if (item.id === eventId) {
      return { items, index, event: item, tuplets };
    }
  }
  return undefined;
}

/** Finds a NoteEvent or RestEvent by id within a single voice's item tree (including nested tuplets). */
export function findEventInVoice(voice: Voice, eventId: string): ItemsHit | undefined {
  return findEventInItems(voice.items, eventId, []);
}

/** Finds a NoteEvent or RestEvent by id anywhere in the score, including nested inside tuplets. */
export function locateEvent(score: Score, eventId: string): LocatedEvent | undefined {
  for (let partIndex = 0; partIndex < score.parts.length; partIndex++) {
    const part = score.parts[partIndex]!;
    for (let measureIndex = 0; measureIndex < part.measures.length; measureIndex++) {
      const pm = part.measures[measureIndex]!;
      for (let staffIndex = 0; staffIndex < pm.staves.length; staffIndex++) {
        const sm = pm.staves[staffIndex]!;
        for (let voiceIndex = 0; voiceIndex < sm.voices.length; voiceIndex++) {
          const voice = sm.voices[voiceIndex]!;
          const hit = findEventInItems(voice.items, eventId, []);
          if (hit) return { ...hit, voice, partIndex, measureIndex, staffIndex, voiceIndex };
        }
      }
    }
  }
  return undefined;
}

function findNoteInEvent(event: Event, noteId: string): LocatedNote | undefined {
  if (event.kind === "note") {
    const index = event.notes.findIndex((n) => n.id === noteId);
    if (index !== -1) return { note: event.notes[index]!, notes: event.notes, index, event };
  }
  if (event.grace) {
    for (const graceEvent of event.grace.events) {
      const hit = findNoteInEvent(graceEvent, noteId);
      if (hit) return hit;
    }
  }
  return undefined;
}

function findNoteInItems(items: VoiceItem[], noteId: string): LocatedNote | undefined {
  for (const item of items) {
    if (item.kind === "tuplet") {
      const nested = findNoteInItems(item.items, noteId);
      if (nested) return nested;
    } else {
      const hit = findNoteInEvent(item, noteId);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Finds a Note by id anywhere in the score: chords, tuplets, and grace groups. */
export function locateNote(score: Score, noteId: string): LocatedNote | undefined {
  for (const part of score.parts) {
    for (const pm of part.measures) {
      for (const sm of pm.staves) {
        for (const voice of sm.voices) {
          const hit = findNoteInItems(voice.items, noteId);
          if (hit) return hit;
        }
      }
    }
  }
  return undefined;
}
