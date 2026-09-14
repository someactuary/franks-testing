/**
 * Lyric commands (docs/ARCHITECTURE.md's "Lyrics" M3 contract): `NoteEvent.lyrics` is
 * a `Lyric[]` keyed by verse. Rests never carry lyrics, so every command here throws
 * if `eventId` doesn't resolve to a `NoteEvent` (same convention as `setFingering` /
 * `setNoteAlter` in commands/notation.ts and commands/edit.ts).
 */
import type { Draft } from "immer";
import type { Lyric, NoteEvent, Score } from "@/model/score";
import { locateEvent } from "./locate";
import type { Command } from "./types";

/** The NoteEvent at `eventId`, or throws `${opName}: ...` if it doesn't exist or isn't a note. */
function requireNoteEvent(draft: Draft<Score>, eventId: string, opName: string): Draft<NoteEvent> {
  const hit = locateEvent(draft, eventId);
  if (!hit) throw new Error(`${opName}: no event with id "${eventId}"`);
  if (hit.event.kind !== "note") throw new Error(`${opName}: event "${eventId}" is not a note event`);
  return hit.event as Draft<NoteEvent>;
}

/** The lyric for `verse` on `event.lyrics`, or undefined. */
function findLyric(event: Draft<NoteEvent>, verse: number): Draft<Lyric> | undefined {
  return event.lyrics?.find((l) => l.verse === verse);
}

/**
 * Creates or replaces the lyric at `verse` on `eventId` with `lyric` (unspecified
 * fields default: `syllabic` "single", `extend` absent) — this replaces the whole
 * syllable, it does not merge onto whatever was there before. An empty `text`
 * removes the verse's lyric instead (same as `removeLyric`).
 */
export function setLyric(eventId: string, verse: number, lyric: Partial<Lyric> & { text: string }): Command {
  return {
    label: "Set lyric",
    apply(draft) {
      const event = requireNoteEvent(draft, eventId, "setLyric");
      if (lyric.text.length === 0) {
        removeLyricFrom(event, verse);
        return;
      }
      const next: Lyric = {
        verse,
        text: lyric.text,
        syllabic: lyric.syllabic ?? "single",
        ...(lyric.extend !== undefined ? { extend: lyric.extend } : {}),
      };
      const lyrics = event.lyrics ?? [];
      const idx = lyrics.findIndex((l) => l.verse === verse);
      if (idx === -1) {
        event.lyrics = [...lyrics, next].sort((a, b) => a.verse - b.verse);
      } else {
        lyrics[idx] = next;
        event.lyrics = lyrics;
      }
    },
  };
}

function removeLyricFrom(event: Draft<NoteEvent>, verse: number): void {
  if (!event.lyrics) return;
  const remaining = event.lyrics.filter((l) => l.verse !== verse);
  if (remaining.length === 0) delete event.lyrics;
  else event.lyrics = remaining;
}

/** Removes the lyric at `verse` on `eventId`, if any (no-op otherwise). */
export function removeLyric(eventId: string, verse: number): Command {
  return {
    label: "Remove lyric",
    apply(draft) {
      const event = requireNoteEvent(draft, eventId, "removeLyric");
      removeLyricFrom(event, verse);
    },
  };
}

/** Sets the hyphenation of the lyric at `verse` on `eventId`. Throws if that verse has no lyric yet. */
export function setLyricSyllabic(eventId: string, verse: number, syllabic: Lyric["syllabic"]): Command {
  return {
    label: "Set lyric syllabic",
    apply(draft) {
      const event = requireNoteEvent(draft, eventId, "setLyricSyllabic");
      const lyric = findLyric(event, verse);
      if (!lyric) throw new Error(`setLyricSyllabic: no verse ${verse} lyric on event "${eventId}"`);
      lyric.syllabic = syllabic;
    },
  };
}

/** Sets (or clears) the melisma extender of the lyric at `verse` on `eventId`. Throws if that verse has no lyric yet. */
export function setLyricExtend(eventId: string, verse: number, extend: boolean): Command {
  return {
    label: "Set lyric extend",
    apply(draft) {
      const event = requireNoteEvent(draft, eventId, "setLyricExtend");
      const lyric = findLyric(event, verse);
      if (!lyric) throw new Error(`setLyricExtend: no verse ${verse} lyric on event "${eventId}"`);
      if (extend) lyric.extend = true;
      else delete lyric.extend;
    },
  };
}
