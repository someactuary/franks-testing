/**
 * `structuralDigest(score)`: an id-free, presentation-free serialization of the
 * music in a score, used to compare a score with import(export(score)).
 *
 * Normalizations (each one mirrors a documented MusicXML mapping decision):
 *  - anchors are compared as time positions (measure, offset), so an event anchor
 *    and a measure anchor at the same instant are equal; end anchors on events use
 *    the event's end, exactly as the exporter writes them.
 *  - accidentals: an explicit "courtesy"/"cautionary-parens" is kept literally;
 *    otherwise the digest records whether the accidental is shown under the
 *    exporter's rule (forced, or alter differs from the key signature).
 *  - Part.bracket undefined is read as its default ("brace" for 2+ staves).
 *  - spanners and attachments are sorted, since their order carries no meaning.
 */
import {
  add,
  fracToString,
  keyAlter,
  notatedToFraction,
  frac,
  type Fraction,
  type KeySignature,
  type NotatedDuration,
} from "@/model";
import type { Anchor, Note, NoteEvent, Score, Voice, VoiceItem } from "@/model";

interface Loc {
  measureIndex: number;
  offset: Fraction;
  length: Fraction;
}

function dur(d: NotatedDuration): string {
  return `${d.base}${".".repeat(d.dots)}`;
}

function pitchString(n: Note): string {
  const p = n.pitch;
  return `${p.step}${p.alter >= 0 ? "+".repeat(p.alter) : "-".repeat(-p.alter)}${p.octave}`;
}

function accidental(n: Note, key: KeySignature): string {
  if (n.accidental === "courtesy" || n.accidental === "cautionary-parens") return n.accidental;
  const shown = n.accidental === "force" || n.pitch.alter !== keyAlter(key, n.pitch.step);
  return shown ? "shown" : "hidden";
}

function noteString(n: Note, key: KeySignature): string {
  const parts = [pitchString(n), accidental(n, key)];
  if (n.tieStart) parts.push("tie");
  if (n.fingering !== undefined) parts.push(`f${n.fingering}`);
  if (n.notehead && n.notehead !== "normal") parts.push(`h:${n.notehead}`);
  return parts.join(" ");
}

function eventString(ev: NoteEvent, key: KeySignature): Record<string, unknown> {
  return {
    note: dur(ev.duration),
    pitches: ev.notes.map((n) => noteString(n, key)),
    ...(ev.lyrics?.length
      ? {
          lyrics: [...ev.lyrics]
            .sort((a, b) => a.verse - b.verse)
            .map((l) => `${l.verse}:${l.text}:${l.syllabic}${l.extend ? ":ext" : ""}`),
        }
      : {}),
    ...(ev.articulations?.length ? { artic: [...ev.articulations].sort() } : {}),
    ...(ev.ornaments?.length ? { orn: [...ev.ornaments].sort() } : {}),
    ...(ev.stem ? { stem: ev.stem } : {}),
    ...(ev.arpeggio ? { arp: ev.arpeggio } : {}),
    ...(ev.tremolo ? { trem: ev.tremolo } : {}),
    ...(ev.grace
      ? { grace: { slash: ev.grace.slash, events: ev.grace.events.map((g) => eventString(g, key)) } }
      : {}),
  };
}

function itemDigest(item: VoiceItem, key: KeySignature): unknown {
  if (item.kind === "tuplet") {
    return {
      tuplet: `${item.ratio.actual}:${item.ratio.normal}/${item.ratio.unit}`,
      bracket: item.bracket ?? "auto",
      showNumber: item.showNumber ?? "auto",
      items: item.items.map((i) => itemDigest(i, key)),
    };
  }
  if (item.kind === "rest") {
    if (item.measureRest) return { measureRest: true, ...(item.invisible ? { invisible: true } : {}) };
    return { rest: dur(item.duration), ...(item.invisible ? { invisible: true } : {}) };
  }
  return eventString(item, key);
}

function locate(score: Score): Map<string, Loc> {
  const out = new Map<string, Loc>();
  const walk = (items: VoiceItem[], mi: number, start: Fraction, scale: Fraction): Fraction => {
    let t = start;
    for (const item of items) {
      if (item.kind === "tuplet") {
        t = walk(item.items, mi, t, frac(scale.num * item.ratio.normal, scale.den * item.ratio.actual));
        continue;
      }
      const plain = notatedToFraction(item.duration);
      const length = frac(plain.num * scale.num, plain.den * scale.den);
      out.set(item.id, { measureIndex: mi, offset: t, length });
      t = add(t, length);
    }
    return t;
  };
  for (const part of score.parts) {
    for (const [mi, pm] of part.measures.entries()) {
      for (const sm of pm.staves) for (const v of sm.voices) walk(v.items, mi, frac(0), frac(1));
    }
  }
  return out;
}

function anchorString(anchor: Anchor, locs: Map<string, Loc>, which: "start" | "end"): string {
  if (anchor.kind === "measure") return `${anchor.measureIndex}@${fracToString(anchor.offset)}`;
  const loc = locs.get(anchor.eventId);
  if (!loc) return `missing:${anchor.eventId}`;
  const at = which === "start" ? loc.offset : add(loc.offset, loc.length);
  return `${loc.measureIndex}@${fracToString(at)}`;
}

function voiceDigest(v: Voice, key: KeySignature): unknown {
  return { index: v.index, items: v.items.map((i) => itemDigest(i, key)) };
}

export function structuralDigest(score: Score): unknown {
  const locs = locate(score);
  const keys: KeySignature[] = [];
  let key: KeySignature = { fifths: 0, mode: "major" };
  for (const ma of score.measures) {
    if (ma.keySig) key = ma.keySig;
    keys.push(key);
  }

  const measures = score.measures.map((ma) => ({
    time: ma.timeSig ? `${ma.timeSig.numerator}/${ma.timeSig.denominator}` : null,
    key: ma.keySig ? `${ma.keySig.fifths} ${ma.keySig.mode}` : null,
    barline: ma.barline ?? "regular",
    startBarline: ma.startBarline ?? null,
    ending: ma.ending ? `${ma.ending.numbers.join(",")}:${ma.ending.type}` : null,
    rehearsal: ma.rehearsalMark ?? null,
    actualLength: ma.actualLength ? fracToString(ma.actualLength) : null,
    number: ma.numberOverride ?? null,
  }));

  const parts = score.parts.map((part) => ({
    name: part.name,
    abbreviation: part.abbreviation ?? null,
    bracket: part.bracket ?? (part.staves.length >= 2 ? "brace" : "none"),
    staves: part.staves.map((s) => ({
      clef: s.initialClef,
      name: s.name ?? null,
      abbreviation: s.abbreviation ?? null,
    })),
    measures: part.measures.map((pm, mi) =>
      pm.staves.map((sm) => ({
        clefs: (sm.clefChanges ?? []).map((c) => `${fracToString(c.at)}:${c.clef}`),
        voices: sm.voices.map((v) => voiceDigest(v, keys[mi] ?? key)),
      })),
    ),
  }));

  const spanners = score.spanners
    .map((sp) => {
      const extra =
        sp.kind === "hairpin" ? sp.shape : sp.kind === "pedal" ? sp.style : sp.kind === "ottava" ? String(sp.shift) : "";
      return [
        sp.kind,
        extra,
        `p${sp.partIndex}s${sp.staffIndex}`,
        anchorString(sp.start, locs, "start"),
        anchorString(sp.end, locs, "end"),
        sp.placement ?? "",
      ].join(" | ");
    })
    .sort();

  const attachments = score.attachments
    .map((a) => {
      const extra =
        a.kind === "dynamic"
          ? a.text
          : a.kind === "text"
            ? `${a.text} (${a.style ?? "plain"})`
            : a.kind === "tempo"
              ? `${a.text ?? ""} ${a.beatUnit ? dur(a.beatUnit) : ""}=${a.bpm ?? ""}`
              : a.kind === "pedalMark"
                ? a.mark
                : "";
      return [a.kind, extra, `p${a.partIndex}s${a.staffIndex}`, anchorString(a.anchor, locs, "start"), a.placement ?? ""].join(
        " | ",
      );
    })
    .sort();

  return {
    meta: {
      title: score.meta.title ?? null,
      composer: score.meta.composer ?? null,
      lyricist: score.meta.lyricist ?? null,
      copyright: score.meta.copyright ?? null,
    },
    measures,
    parts,
    spanners,
    attachments,
  };
}
