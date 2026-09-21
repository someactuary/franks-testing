/**
 * Score -> Timeline: everything about *how the score sounds*, as plain data — which
 * MIDI notes start and stop on which tick, tempo changes, pedal, and so on. It is the
 * one place playback semantics live; the MIDI file writer (src/io/midi) and any future
 * in-app player both just consume the result. Pure: same score + options => same
 * timeline, and the score is never touched. Musical time stays exact (`Fraction`s of a
 * whole note) until the very last step, where it is rounded to integer ticks; because
 * every boundary is rounded the same way, a tied note's end and its successor's start
 * still land on the same tick.
 *
 * What's followed: repeats and endings, ties (merged into one sustained note), tuplets,
 * tempo marks/words/rit./accel./a tempo, dynamics and hairpins (as note velocity),
 * accents, articulations, slurs (legato), pedal, ottava, grace notes, and — in
 * "expressive" mode — ornaments, tremolo, arpeggiated chords and fermata holds.
 * Not modeled: D.C./D.S./coda (no model representation), glissando, half pedal.
 */
import { resolveTies } from "@/engraving/ties";
import {
  add,
  cmp,
  div,
  eq,
  frac,
  measureLength,
  mul,
  notatedToFraction,
  sub,
  toNumber,
  ZERO,
  type Fraction,
  type TimeSignature,
} from "@/model/duration";
import { diatonic, fromDiatonic, keyAlter, toMidi, type KeySignature } from "@/model/pitch";
import type { Anchor, Note, NoteEvent, Ornament, Score } from "@/model/score";
import { positionedEvents } from "@/model/traverse";
import { DynamicsCurve, type DynamicsInput } from "./dynamics";
import {
  ARTICULATION_VELOCITY,
  articulatedLength,
  DEFAULT_BPM,
  DEFAULT_VELOCITY,
  FERMATA_HOLD,
  metronomeFromText,
  parseDynamic,
  tempoChangeFromText,
  tempoFromText,
} from "./interpret";
import { buildTempoPoints, type TempoDirective } from "./tempo";
import { unfoldMeasures } from "./unfold";

/** Ticks per quarter note. Divisible by 3, 5 and 2^6, so common tuplets and 64ths are exact. */
export const PPQ = 960;
const WHOLE_TICKS = PPQ * 4;

/** Whole-note time -> integer ticks. */
export function fracToTick(f: Fraction): number {
  return Math.round((f.num * WHOLE_TICKS) / f.den);
}

export interface PlaybackOptions {
  /**
   * "expressive" (default) plays what a performer would: articulations shorten notes,
   * ornaments/tremolo/arpeggios are played out, fermatas are held, and rit./accel. change
   * the tempo. "literal" sounds every note for exactly its notated length with only
   * explicit tempo marks — the right choice for carrying the notation into another
   * notation program, where the extra realisation would just be noise to re-quantize.
   */
  interpretation?: "expressive" | "literal";
  /** Follow repeat signs and endings (default true); false plays the measures once, in order. */
  unfoldRepeats?: boolean;
  /** Emit the first verse's lyrics as lyric events (default true). */
  lyrics?: boolean;
  /** Tempo of music with no tempo mark anywhere (quarter-note bpm). */
  defaultBpm?: number;
  /** Velocity of music before any dynamic marking. */
  defaultVelocity?: number;
}

export interface TimelineNote {
  pitch: number;
  velocity: number;
  onTick: number;
  offTick: number;
  /** The event this note came from (for a tied note, the event that started it). */
  eventId: string;
  noteId: string;
  /** Score measure the note starts in. */
  measureIndex: number;
}

export interface TimelineTrack {
  name: string;
  partIndex: number;
  staffIndex: number;
  /** 0-based MIDI channel; shared by every staff of a part (one instrument, one pedal). */
  channel: number;
  /** 0-based General MIDI program. */
  program: number;
  notes: TimelineNote[];
  controllers: { tick: number; controller: number; value: number }[];
  lyrics: { tick: number; text: string }[];
}

export interface Timeline {
  ppq: number;
  totalTicks: number;
  title?: string;
  copyright?: string;
  composer?: string;
  /** Always begins with tick 0. */
  tempos: { tick: number; usPerQuarter: number }[];
  timeSignatures: { tick: number; numerator: number; denominator: number }[];
  keySignatures: { tick: number; fifths: number; mode: "major" | "minor" }[];
  markers: { tick: number; text: string }[];
  tracks: TimelineTrack[];
  /** Each measure as played, in play order (a repeated measure appears once per pass). */
  playedMeasures: { measureIndex: number; startTick: number; endTick: number }[];
}

/** MIDI channels in the order parts are given them; channel 10 (index 9) is percussion. */
const CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

const CC_SUSTAIN = 64;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const clampMidi = (p: number): number => clamp(p, 0, 127);
const minF = (a: Fraction, b: Fraction): Fraction => (cmp(a, b) <= 0 ? a : b);

// ---------------------------------------------------------------------------
// Working types
// ---------------------------------------------------------------------------

interface EventSite {
  partIndex: number;
  staffIndex: number;
  measureIndex: number;
  offset: Fraction;
  length: Fraction;
}

interface ScorePos {
  measureIndex: number;
  offset: Fraction;
}

interface PlayedEvent {
  partIndex: number;
  staffIndex: number;
  voiceIndex: number;
  /** Which played measure (index into the play order) this instance is in. */
  k: number;
  measureIndex: number;
  t: Fraction;
  len: Fraction;
  event: NoteEvent;
}

/** One sounding note before ornaments: a tie chain's attack and its total length. */
interface Chain {
  partIndex: number;
  staffIndex: number;
  note: Note;
  /** Position of the note within its chord (0 = lowest). */
  noteIndex: number;
  first: PlayedEvent;
  last: PlayedEvent;
  onT: Fraction;
  endT: Fraction;
}

interface Seg {
  midi: number;
  on: Fraction;
  off: Fraction;
  velocity: number;
  eventId: string;
  noteId: string;
  measureIndex: number;
}

// ---------------------------------------------------------------------------

export function buildTimeline(score: Score, opts: PlaybackOptions = {}): Timeline {
  const expressive = (opts.interpretation ?? "expressive") === "expressive";
  const defaultVelocity = opts.defaultVelocity ?? DEFAULT_VELOCITY;

  // --- measures: running time/key signature, length, and the order they are played in ---
  const measureCount = score.measures.length;
  const timeSigs: TimeSignature[] = [];
  const keys: KeySignature[] = [];
  const lengths: Fraction[] = [];
  let ts: TimeSignature = score.measures[0]?.timeSig ?? { numerator: 4, denominator: 4 };
  let key: KeySignature = score.measures[0]?.keySig ?? { fifths: 0, mode: "major" };
  for (const ma of score.measures) {
    if (ma.timeSig) ts = ma.timeSig;
    if (ma.keySig) key = ma.keySig;
    timeSigs.push(ts);
    keys.push(key);
    lengths.push(ma.actualLength ?? measureLength(ts));
  }

  const order = opts.unfoldRepeats === false ? Array.from({ length: measureCount }, (_, i) => i) : unfoldMeasures(score);
  const starts: Fraction[] = [];
  const instances = new Map<number, number[]>();
  let cursor = ZERO;
  for (const [k, m] of order.entries()) {
    starts.push(cursor);
    cursor = add(cursor, lengths[m]!);
    const list = instances.get(m);
    if (list) list.push(k);
    else instances.set(m, [k]);
  }
  const totalWhole = cursor;

  const measureLengthAt = (t: Fraction): Fraction => {
    for (let k = order.length - 1; k >= 0; k--) if (cmp(starts[k]!, t) <= 0) return lengths[order[k]!]!;
    return lengths[0] ?? frac(1);
  };

  // --- where every event is, in the score ---
  const sites = new Map<string, EventSite>();
  for (const [partIndex, part] of score.parts.entries()) {
    for (const [measureIndex, pm] of part.measures.entries()) {
      for (const [staffIndex, sm] of pm.staves.entries()) {
        for (const voice of sm.voices) {
          for (const pe of positionedEvents(voice)) {
            sites.set(pe.event.id, { partIndex, staffIndex, measureIndex, offset: pe.offset, length: pe.length });
          }
        }
      }
    }
  }

  /** An anchor's *start* position: an event's attack, or the stated measure position. */
  const startPos = (a: Anchor): ScorePos | undefined => {
    if (a.kind === "measure") return { measureIndex: a.measureIndex, offset: a.offset };
    const s = sites.get(a.eventId);
    return s && { measureIndex: s.measureIndex, offset: s.offset };
  };
  /** An anchor's *end* position: for an event, where it stops sounding (so a spanner ending on it includes it). */
  const endPos = (a: Anchor): ScorePos | undefined => {
    if (a.kind === "measure") return { measureIndex: a.measureIndex, offset: a.offset };
    const s = sites.get(a.eventId);
    return s && { measureIndex: s.measureIndex, offset: add(s.offset, s.length) };
  };

  /** Every played time a score position occurs at (once per pass through its measure). */
  const timesOf = (pos: ScorePos): { k: number; t: Fraction }[] =>
    (instances.get(pos.measureIndex) ?? []).map((k) => ({ k, t: add(starts[k]!, pos.offset) }));

  /** [from, to) in played time, for every pass through the start that reaches the end afterwards. */
  const spanIntervals = (start: ScorePos | undefined, end: ScorePos | undefined): { from: Fraction; to: Fraction }[] => {
    if (!start || !end) return [];
    const endInstances = instances.get(end.measureIndex) ?? [];
    const out: { from: Fraction; to: Fraction }[] = [];
    for (const { k, t } of timesOf(start)) {
      const k2 = endInstances.find((x) => x > k || (x === k && cmp(end.offset, start.offset) >= 0));
      if (k2 !== undefined) out.push({ from: t, to: add(starts[k2]!, end.offset) });
    }
    return out;
  };

  // --- tracks: one per staff; one channel per part ---
  const tracks: TimelineTrack[] = [];
  const trackOf = new Map<string, TimelineTrack>();
  for (const [partIndex, part] of score.parts.entries()) {
    const channel = CHANNELS[partIndex % CHANNELS.length]!;
    for (const [staffIndex, staff] of part.staves.entries()) {
      const label = staff.name ?? (part.staves.length > 1 ? `Staff ${staffIndex + 1}` : undefined);
      const track: TimelineTrack = {
        name: label && label !== part.name ? `${part.name} - ${label}` : part.name,
        partIndex,
        staffIndex,
        channel,
        program: clamp(part.midiProgram ?? 0, 0, 127),
        notes: [],
        controllers: [],
        lyrics: [],
      };
      tracks.push(track);
      trackOf.set(`${partIndex}/${staffIndex}`, track);
    }
  }

  // --- per-part loudness ---
  const dynamicsInputs: DynamicsInput[] = score.parts.map(() => ({ sets: [], accents: [], hairpins: [] }));
  for (const att of score.attachments) {
    if (att.kind !== "dynamic") continue;
    const input = dynamicsInputs[att.partIndex];
    const parsed = parseDynamic(att.text);
    const pos = startPos(att.anchor);
    if (!input || !parsed || !pos) continue;
    for (const { t } of timesOf(pos)) {
      if (parsed.level !== undefined) input.sets.push({ t, velocity: parsed.level });
      if (parsed.accent !== undefined) input.accents.push({ t, bump: parsed.accent });
      if (parsed.then) input.sets.push({ t: add(t, parsed.then.after), velocity: parsed.then.level });
    }
  }
  for (const sp of score.spanners) {
    if (sp.kind !== "hairpin") continue;
    const input = dynamicsInputs[sp.partIndex];
    if (!input) continue;
    for (const iv of spanIntervals(startPos(sp.start), endPos(sp.end))) {
      input.hairpins.push({ ...iv, shape: sp.shape });
    }
  }
  const curves = dynamicsInputs.map((input) => new DynamicsCurve(input, defaultVelocity));

  // --- per-staff spanners that change how notes sound ---
  const ottavas = new Map<string, { from: Fraction; to: Fraction; semitones: number }[]>();
  const slurs = new Map<string, { from: Fraction; to: Fraction }[]>();
  const trillEvents = new Set<string>();
  for (const sp of score.spanners) {
    const k = `${sp.partIndex}/${sp.staffIndex}`;
    if (sp.kind === "ottava") {
      // 8va/8vb is one octave, 15ma/15mb two ("15" counts the notes spanned, not octaves).
      const semitones = (sp.shift > 0 ? 1 : -1) * (Math.abs(sp.shift) >= 15 ? 24 : 12);
      const list = ottavas.get(k) ?? [];
      for (const iv of spanIntervals(startPos(sp.start), endPos(sp.end))) list.push({ ...iv, semitones });
      ottavas.set(k, list);
    } else if (sp.kind === "slur") {
      // A slur joins notes, so it runs from one attack to the last note's *attack*.
      const list = slurs.get(k) ?? [];
      for (const iv of spanIntervals(startPos(sp.start), startPos(sp.end))) list.push(iv);
      slurs.set(k, list);
    } else if (sp.kind === "trillLine" && sp.start.kind === "event") {
      trillEvents.add(sp.start.eventId);
    }
  }
  const within = (iv: { from: Fraction; to: Fraction }, t: Fraction): boolean => cmp(iv.from, t) <= 0 && cmp(t, iv.to) < 0;
  const ottavaShift = (p: number, s: number, t: Fraction): number =>
    ottavas.get(`${p}/${s}`)?.find((iv) => within(iv, t))?.semitones ?? 0;
  const isSlurred = (p: number, s: number, t: Fraction): boolean => !!slurs.get(`${p}/${s}`)?.some((iv) => within(iv, t));

  // --- tempo ---
  const tempoDirectives: TempoDirective[] = [];
  for (const att of score.attachments) {
    if (att.kind !== "tempo" && att.kind !== "text") continue;
    const pos = startPos(att.anchor);
    if (!pos) continue;
    let bpm: number | undefined;
    if (att.kind === "text") {
      // Expression text is only a tempo when it's an explicit metronome mark ("♩ = 72").
      bpm = metronomeFromText(att.text);
    } else {
      if (att.bpm !== undefined) {
        // bpm counts `beatUnit`s per minute; convert to quarter notes per minute.
        const unit = att.beatUnit ? toNumber(notatedToFraction(att.beatUnit)) : 0.25;
        bpm = (att.bpm * unit) / 0.25;
      } else if (att.text) {
        bpm = tempoFromText(att.text);
      }
    }
    const change = expressive && att.text ? tempoChangeFromText(att.text) : undefined;
    for (const { t } of timesOf(pos)) {
      if (bpm !== undefined) tempoDirectives.push({ t, kind: "set", bpm });
      else if (change) tempoDirectives.push(change.kind === "atempo" ? { t, kind: "atempo" } : { t, ...change });
    }
  }
  const tempoPoints = buildTempoPoints(tempoDirectives, {
    defaultBpm: opts.defaultBpm ?? DEFAULT_BPM,
    total: totalWhole,
    measureLengthAt,
  });

  // Fermatas hold everything sounding under them: modelled as slowing the tempo over
  // the anchored event, so every staff stretches together and note ticks stay notated.
  const fermatas: { from: Fraction; to: Fraction }[] = [];
  if (expressive) {
    for (const att of score.attachments) {
      if (att.kind !== "fermata") continue;
      const pos = startPos(att.anchor);
      if (!pos) continue;
      const len = att.anchor.kind === "event" ? (sites.get(att.anchor.eventId)?.length ?? frac(1, 4)) : frac(1, 4);
      for (const { t } of timesOf(pos)) fermatas.push({ from: t, to: add(t, len) });
    }
  }

  // --- the notes, in played order, grouped per voice so ties can be followed ---
  const voiceSeqs = new Map<string, PlayedEvent[]>();
  for (const [k, m] of order.entries()) {
    const base = starts[k]!;
    for (const [partIndex, part] of score.parts.entries()) {
      const pm = part.measures[m];
      if (!pm) continue;
      for (const [staffIndex, sm] of pm.staves.entries()) {
        for (const voice of sm.voices) {
          for (const pe of positionedEvents(voice)) {
            if (pe.event.kind !== "note") continue;
            const key2 = `${partIndex}/${staffIndex}/${voice.index}`;
            const list = voiceSeqs.get(key2) ?? [];
            list.push({
              partIndex,
              staffIndex,
              voiceIndex: voice.index,
              k,
              measureIndex: m,
              t: add(base, pe.offset),
              len: pe.length,
              event: pe.event,
            });
            voiceSeqs.set(key2, list);
          }
        }
      }
    }
  }

  // Tie chains: a tied note continues the chain only if it is exactly where the last one
  // ended in played time, so a repeat jump between them correctly restarts the note.
  const tieTarget = new Map<string, string>();
  for (const pair of resolveTies(score).pairs) tieTarget.set(pair.start.noteId, pair.end.noteId);
  const chains: Chain[] = [];
  for (const seq of voiceSeqs.values()) {
    const pending = new Map<string, Chain>();
    for (const pe of seq) {
      for (const [noteIndex, note] of pe.event.notes.entries()) {
        let chain = pending.get(note.id);
        if (chain && eq(chain.endT, pe.t)) {
          chain.last = pe;
          chain.endT = add(pe.t, pe.len);
          pending.delete(note.id);
        } else {
          chain = {
            partIndex: pe.partIndex,
            staffIndex: pe.staffIndex,
            note,
            noteIndex,
            first: pe,
            last: pe,
            onT: pe.t,
            endT: add(pe.t, pe.len),
          };
          chains.push(chain);
        }
        const target = note.tieStart ? tieTarget.get(note.id) : undefined;
        if (target) pending.set(target, chain);
      }
    }
  }

  // --- turn chains into sounding segments ---
  const segsByTrack = new Map<TimelineTrack, Seg[]>();
  const emit = (track: TimelineTrack, seg: Seg): void => {
    if (cmp(seg.off, seg.on) <= 0) return;
    const list = segsByTrack.get(track) ?? [];
    list.push(seg);
    segsByTrack.set(track, list);
  };
  const gracesDone = new Set<PlayedEvent>();

  for (const chain of chains) {
    const track = trackOf.get(`${chain.partIndex}/${chain.staffIndex}`);
    if (!track) continue;
    const ev = chain.first.event;
    const shift = ottavaShift(chain.partIndex, chain.staffIndex, chain.onT);
    const midi = clampMidi(toMidi(chain.note.pitch) + shift);
    const curve = curves[chain.partIndex]!;
    const articulationBump = (ev.articulations ?? []).reduce((sum, a) => sum + ARTICULATION_VELOCITY[a], 0);
    const velocity = clamp(
      Math.round(curve.velocityAt(chain.onT) + Math.min(30, articulationBump) + curve.accentAt(chain.onT)),
      1,
      127,
    );
    const seg = (m: number, on: Fraction, off: Fraction, v = velocity): Seg => ({
      midi: m,
      on,
      off,
      velocity: v,
      eventId: ev.id,
      noteId: chain.note.id,
      measureIndex: chain.first.measureIndex,
    });

    // Grace notes sound once per event, however many notes its chord has.
    let onT = chain.onT;
    const grace = graceTiming(chain.first);
    if (grace) {
      if (!gracesDone.has(chain.first)) {
        gracesDone.add(chain.first);
        let at = grace.slash ? maxF(sub(chain.onT, grace.total), ZERO) : chain.onT;
        for (const [gi, g] of (ev.grace?.events ?? []).entries()) {
          const dur = grace.durations[gi]!;
          for (const gn of g.notes) {
            const gm = clampMidi(toMidi(gn.pitch) + shift);
            emit(track, seg(gm, at, add(at, dur), Math.max(1, velocity - 10)));
          }
          at = add(at, dur);
        }
      }
      if (!grace.slash) onT = add(onT, grace.total); // an appoggiatura takes its time from the note
    }

    const full = sub(chain.endT, onT);
    if (cmp(full, ZERO) <= 0) continue;
    const isTop = chain.noteIndex === ev.notes.length - 1;
    const ornament: Ornament | undefined = expressive
      ? (ev.ornaments?.[0] ?? (trillEvents.has(ev.id) ? "trill" : undefined))
      : undefined;

    // How long the note (or its last chain link) actually sounds.
    let sound = full;
    if (expressive) {
      const lastArt = chain.last.event.articulations;
      if (lastArt && lastArt.length > 0) {
        sound = articulatedLength(lastArt, full);
      } else if (!isSlurred(chain.partIndex, chain.staffIndex, chain.onT)) {
        // A performer lifts a hair before the next non-slurred note; a slur keeps it joined.
        sound = sub(full, minF(div(full, frac(16)), frac(1, 64)));
      }
    }

    if (ornament && isTop) {
      for (const s of ornamentSegments(ornament, midi, onT, sound, keys[chain.first.measureIndex]!, chain.note, shift)) {
        emit(track, seg(s.midi, s.on, s.off));
      }
    } else if (expressive && ev.tremolo) {
      const unit = frac(1, 4 << ev.tremolo); // 1 slash = eighths, 2 = sixteenths, 3 = thirty-seconds
      let at = onT;
      const end = add(onT, sound);
      while (cmp(at, end) < 0) {
        const stop = minF(add(at, unit), end);
        emit(track, seg(midi, at, stop));
        at = stop;
      }
    } else if (expressive && ev.arpeggio && ev.notes.length > 1) {
      // Roll the chord: one note after another, all held to the chord's end.
      const n = ev.notes.length;
      const rank = ev.arpeggio === "down" ? n - 1 - chain.noteIndex : chain.noteIndex;
      const step = minF(frac(1, 32), div(sound, frac(4 * n)));
      emit(track, seg(midi, add(onT, mul(step, frac(rank))), add(onT, sound)));
    } else {
      emit(track, seg(midi, onT, add(onT, sound)));
    }
  }

  /** Grace-note timing for an event: durations, their total, and whether they sound before the beat. */
  function graceTiming(pe: PlayedEvent): { slash: boolean; durations: Fraction[]; total: Fraction } | undefined {
    const grace = pe.event.grace;
    if (!grace || grace.events.length === 0) return undefined;
    let durations = grace.events.map((g) => notatedToFraction(g.duration));
    if (grace.slash) durations = durations.map((d) => minF(d, frac(1, 32))); // acciaccatura: as quick as possible
    let total = durations.reduce((a, d) => add(a, d), ZERO);
    if (!grace.slash) {
      const cap = div(pe.len, frac(2)); // an appoggiatura never takes more than half the note
      if (cmp(total, cap) > 0) {
        const scale = div(cap, total);
        durations = durations.map((d) => mul(d, scale));
        total = cap;
      }
    }
    return { slash: grace.slash, durations, total };
  }

  // --- pedal, on the first staff's track of each part ---
  const pedalEvents = new Map<number, { t: Fraction; down: boolean }[]>();
  const addPedal = (partIndex: number, t: Fraction, down: boolean): void => {
    const list = pedalEvents.get(partIndex) ?? [];
    list.push({ t, down });
    pedalEvents.set(partIndex, list);
  };
  for (const sp of score.spanners) {
    if (sp.kind !== "pedal") continue;
    for (const iv of spanIntervals(startPos(sp.start), endPos(sp.end))) {
      addPedal(sp.partIndex, iv.from, true);
      addPedal(sp.partIndex, iv.to, false);
    }
  }
  for (const att of score.attachments) {
    if (att.kind !== "pedalMark") continue;
    const pos = startPos(att.anchor);
    if (pos) for (const { t } of timesOf(pos)) addPedal(att.partIndex, t, att.mark === "ped");
  }

  // --- lyrics (first verse) ---
  if (opts.lyrics !== false) {
    for (const seq of voiceSeqs.values()) {
      for (const pe of seq) {
        const lyric = pe.event.lyrics?.find((l) => l.verse === 0);
        const track = trackOf.get(`${pe.partIndex}/${pe.staffIndex}`);
        if (!lyric || !track) continue;
        // Karaoke convention: a syllable that continues into the next one has no trailing space.
        const continues = lyric.syllabic === "begin" || lyric.syllabic === "middle";
        track.lyrics.push({ tick: fracToTick(pe.t), text: continues ? lyric.text : `${lyric.text} ` });
      }
    }
  }

  // --- tempo map in ticks, with fermata holds folded in ---
  const times: Fraction[] = [...tempoPoints.map((p) => p.t), ...fermatas.flatMap((f) => [f.from, f.to])];
  times.sort(cmp);
  const tempos: Timeline["tempos"] = [];
  for (const t of times) {
    let bpm = tempoPoints[0]!.bpm;
    for (const p of tempoPoints) if (cmp(p.t, t) <= 0) bpm = p.bpm;
    const held = fermatas.some((f) => within(f, t));
    const us = Math.round(60_000_000 / (held ? bpm / FERMATA_HOLD : bpm));
    const tick = fracToTick(t);
    const last = tempos[tempos.length - 1];
    if (last && last.tick === tick) last.usPerQuarter = us;
    else if (!last || last.usPerQuarter !== us) tempos.push({ tick, usPerQuarter: us });
  }

  // --- signatures and markers at each played measure ---
  const timeSignatures: Timeline["timeSignatures"] = [];
  const keySignatures: Timeline["keySignatures"] = [];
  const markers: Timeline["markers"] = [];
  const playedMeasures: Timeline["playedMeasures"] = [];
  for (const [k, m] of order.entries()) {
    const tick = fracToTick(starts[k]!);
    const endTick = fracToTick(add(starts[k]!, lengths[m]!));
    playedMeasures.push({ measureIndex: m, startTick: tick, endTick });
    const tsm = timeSigs[m]!;
    const lastTs = timeSignatures[timeSignatures.length - 1];
    if (!lastTs || lastTs.numerator !== tsm.numerator || lastTs.denominator !== tsm.denominator) {
      timeSignatures.push({ tick, numerator: tsm.numerator, denominator: tsm.denominator });
    }
    const km = keys[m]!;
    const lastKey = keySignatures[keySignatures.length - 1];
    if (!lastKey || lastKey.fifths !== km.fifths || lastKey.mode !== km.mode) {
      keySignatures.push({ tick, fifths: clamp(km.fifths, -7, 7), mode: km.mode });
    }
    const mark = score.measures[m]!.rehearsalMark;
    if (mark) markers.push({ tick, text: mark });
  }

  // --- finalize: ticks, no same-pitch overlaps within a channel, sorted ---
  let totalTicks = fracToTick(totalWhole);
  for (const track of tracks) {
    for (const s of segsByTrack.get(track) ?? []) {
      const on = fracToTick(s.on);
      track.notes.push({
        pitch: s.midi,
        velocity: s.velocity,
        onTick: on,
        offTick: Math.max(on + 1, fracToTick(s.off)),
        eventId: s.eventId,
        noteId: s.noteId,
        measureIndex: s.measureIndex,
      });
    }
  }
  const byChannel = new Map<number, TimelineNote[]>();
  for (const track of tracks) {
    const list = byChannel.get(track.channel) ?? [];
    list.push(...track.notes);
    byChannel.set(track.channel, list);
  }
  const dropped = new Set<TimelineNote>();
  for (const notes of byChannel.values()) {
    notes.sort((a, b) => a.onTick - b.onTick || a.pitch - b.pitch);
    const lastByPitch = new Map<number, TimelineNote>();
    for (const n of notes) {
      const prev = lastByPitch.get(n.pitch);
      if (prev && n.onTick < prev.offTick) {
        if (n.onTick <= prev.onTick) {
          // The same key struck twice at once (a unison between staves): one note, the louder one.
          prev.velocity = Math.max(prev.velocity, n.velocity);
          prev.offTick = Math.max(prev.offTick, n.offTick);
          dropped.add(n);
          continue;
        }
        prev.offTick = n.onTick; // re-strike: the earlier note must end first
      }
      lastByPitch.set(n.pitch, n);
    }
  }
  for (const track of tracks) {
    track.notes = track.notes.filter((n) => !dropped.has(n)).sort((a, b) => a.onTick - b.onTick || a.pitch - b.pitch);
    for (const n of track.notes) totalTicks = Math.max(totalTicks, n.offTick);
  }

  // Pedal controllers (after totalTicks is known, so a pedal left down is released at the end).
  for (const [partIndex, events] of pedalEvents) {
    const track = trackOf.get(`${partIndex}/0`);
    if (!track) continue;
    // Releases sort before presses at the same tick, so an end and a start on one tick
    // stay a pedal *change*. A depth count keeps overlapping marks from releasing early.
    const sorted = events
      .map((e) => ({ tick: fracToTick(e.t), down: e.down }))
      .sort((a, b) => a.tick - b.tick || Number(a.down) - Number(b.down));
    let depth = 0;
    for (const e of sorted) {
      const wasDown = depth > 0;
      depth = e.down ? depth + 1 : Math.max(0, depth - 1);
      if (wasDown !== depth > 0) {
        track.controllers.push({ tick: e.tick, controller: CC_SUSTAIN, value: depth > 0 ? 127 : 0 });
      }
    }
    if (depth > 0) track.controllers.push({ tick: totalTicks, controller: CC_SUSTAIN, value: 0 });
  }

  return {
    ppq: PPQ,
    totalTicks,
    ...(score.meta.title ? { title: score.meta.title } : {}),
    ...(score.meta.copyright ? { copyright: score.meta.copyright } : {}),
    ...(score.meta.composer ? { composer: score.meta.composer } : {}),
    tempos: tempos.length > 0 ? tempos : [{ tick: 0, usPerQuarter: 500000 }],
    timeSignatures,
    keySignatures,
    markers,
    tracks,
    playedMeasures,
  };
}

const maxF = (a: Fraction, b: Fraction): Fraction => (cmp(a, b) >= 0 ? a : b);

// ---------------------------------------------------------------------------
// Ornaments
// ---------------------------------------------------------------------------

/** The pitch a scale step above/below a written note (steps honour the key signature, not accidentals). */
function neighbor(note: Note, dir: 1 | -1, key: KeySignature, shift: number): number {
  const p = fromDiatonic(diatonic(note.pitch) + dir);
  return clampMidi(toMidi({ ...p, alter: keyAlter(key, p.step) }) + shift);
}

/**
 * Realises an ornament on a note as a run of short notes. Trills alternate with the
 * upper neighbour in equal steps ending on the main note; mordents/turns are a few quick
 * notes followed by the main note held for the rest of its length.
 */
function ornamentSegments(
  ornament: Ornament,
  main: number,
  on: Fraction,
  len: Fraction,
  key: KeySignature,
  note: Note,
  shift: number,
): { midi: number; on: Fraction; off: Fraction }[] {
  const off = add(on, len);
  const upper = neighbor(note, 1, key, shift);
  const lower = neighbor(note, -1, key, shift);

  if (ornament === "trill") {
    const unit = cmp(len, frac(1, 8)) >= 0 ? frac(1, 32) : frac(1, 64);
    let count = Math.floor(toNumber(div(len, unit)));
    if (count % 2 === 0) count -= 1; // an odd count starts and ends on the main note
    if (count < 3) return [{ midi: main, on, off }];
    const step = div(len, frac(count));
    return Array.from({ length: count }, (_, i) => ({
      midi: i % 2 === 0 ? main : upper,
      on: add(on, mul(step, frac(i))),
      off: add(on, mul(step, frac(i + 1))),
    }));
  }

  const quick = minF(frac(1, 32), div(len, frac(8)));
  const lead: number[] =
    ornament === "mordent"
      ? [main, lower]
      : ornament === "invertedMordent"
        ? [main, upper]
        : ornament === "turn"
          ? [upper, main, lower]
          : [lower, main, upper]; // invertedTurn
  const out: { midi: number; on: Fraction; off: Fraction }[] = [];
  let at = on;
  for (const m of lead) {
    out.push({ midi: m, on: at, off: add(at, quick) });
    at = add(at, quick);
  }
  out.push({ midi: main, on: at, off });
  return out;
}

/** Ticks -> seconds through the tempo map (for players and duration readouts). */
export function ticksToSeconds(timeline: Pick<Timeline, "ppq" | "tempos">, tick: number): number {
  let seconds = 0;
  let prevTick = 0;
  let us = timeline.tempos[0]?.usPerQuarter ?? 500000;
  for (const t of timeline.tempos) {
    if (t.tick >= tick) break;
    seconds += ((t.tick - prevTick) * us) / timeline.ppq / 1e6;
    prevTick = t.tick;
    us = t.usPerQuarter;
  }
  return seconds + ((tick - prevTick) * us) / timeline.ppq / 1e6;
}
