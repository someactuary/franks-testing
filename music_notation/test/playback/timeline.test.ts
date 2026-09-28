import { describe, expect, it } from "vitest";
import {
  chord,
  newId,
  newPianoScore,
  note,
  notated,
  rest,
  type Attachment,
  type NoteEvent,
  type Score,
  type Spanner,
  type VoiceItem,
} from "@/model";
import { buildTimeline, fracToTick, PPQ, ticksToSeconds, type Timeline } from "@/playback/timeline";

const QUARTER = PPQ; // ticks
const WHOLE = PPQ * 4;

/** A 1-measure-per-arg score whose treble staff holds the given items, bass left as rests. */
function trebleScore(...measures: VoiceItem[][]): Score {
  const score = newPianoScore({ measureCount: measures.length });
  for (const [i, items] of measures.entries()) score.parts[0]!.measures[i]!.staves[0]!.voices[0]!.items = items;
  return score;
}

const at = (ev: { id: string }): { kind: "event"; eventId: string } => ({ kind: "event", eventId: ev.id });
const dyn = (text: string, ev: { id: string }, staffIndex = 0): Attachment => ({
  id: newId(),
  kind: "dynamic",
  text,
  partIndex: 0,
  staffIndex,
  anchor: at(ev),
});
const spanner = (s: Record<string, unknown>): Spanner =>
  ({ id: newId(), partIndex: 0, staffIndex: 0, ...s }) as unknown as Spanner;

const trebleNotes = (tl: Timeline) => tl.tracks[0]!.notes;
const literal = { interpretation: "literal" as const };

describe("notes and timing", () => {
  it("places notes at exact ticks with MIDI pitches and the part's program", () => {
    const [c, d, e, f] = [note("C4", 4), note("D4", 4), note("E4", 4), note("F4", 4)];
    const tl = buildTimeline(trebleScore([c!, d!, e!, f!]), literal);
    expect(trebleNotes(tl).map((n) => [n.pitch, n.onTick, n.offTick])).toEqual([
      [60, 0, QUARTER],
      [62, QUARTER, 2 * QUARTER],
      [64, 2 * QUARTER, 3 * QUARTER],
      [65, 3 * QUARTER, 4 * QUARTER],
    ]);
    expect(tl.tracks[0]!.program).toBe(0);
    expect(tl.totalTicks).toBe(WHOLE);
    expect(tl.ppq).toBe(960);
  });

  it("lifts slightly before the next note in expressive mode, never in literal mode", () => {
    const score = trebleScore([note("C4", 4), note("D4", 4), note("E4", 4), note("F4", 4)]);
    const expressive = trebleNotes(buildTimeline(score));
    // A 64th of a whole note (60 ticks) is lifted from each quarter.
    expect(expressive[0]!.offTick).toBe(QUARTER - 60);
    expect(expressive[1]!.onTick).toBe(QUARTER);
    expect(trebleNotes(buildTimeline(score, literal))[0]!.offTick).toBe(QUARTER);
  });

  it("keeps slurred notes joined", () => {
    const [a, b, c, d] = [note("C4", 4), note("D4", 4), note("E4", 4), note("F4", 4)];
    const score = trebleScore([a!, b!, c!, d!]);
    score.spanners.push(spanner({ kind: "slur", start: at(a!), end: at(c!) }));
    const notes = trebleNotes(buildTimeline(score));
    expect(notes[0]!.offTick).toBe(QUARTER); // slurred: no lift
    expect(notes[1]!.offTick).toBe(2 * QUARTER);
    expect(notes[2]!.offTick).toBe(3 * QUARTER - 60); // the slur's last note is released normally
  });

  it("merges tied notes into one sustained note, including across barlines", () => {
    const a = note("C4", 2);
    const b = note("C4", 2);
    const c = note("C4", 1);
    a.notes[0]!.tieStart = true;
    b.notes[0]!.tieStart = true;
    const tl = buildTimeline(trebleScore([a, b], [c]), literal);
    expect(trebleNotes(tl)).toHaveLength(1);
    expect(trebleNotes(tl)[0]).toMatchObject({ pitch: 60, onTick: 0, offTick: 2 * WHOLE });
  });

  it("re-strikes a repeated pitch that is not tied", () => {
    const tl = buildTimeline(trebleScore([note("C4", 2), note("C4", 2)]), literal);
    expect(trebleNotes(tl).map((n) => [n.onTick, n.offTick])).toEqual([
      [0, WHOLE / 2],
      [WHOLE / 2, WHOLE],
    ]);
  });

  it("times tuplets exactly", () => {
    const triplet: VoiceItem = {
      kind: "tuplet",
      id: newId(),
      ratio: { actual: 3, normal: 2, unit: 8 },
      items: [note("C4", 8), note("D4", 8), note("E4", 8)],
    };
    const tl = buildTimeline(trebleScore([triplet, note("F4", 2)]), literal);
    // Three eighths in the time of two: each is a third of a quarter.
    expect(trebleNotes(tl).map((n) => [n.onTick, n.offTick])).toEqual([
      [0, 320],
      [320, 640],
      [640, 960],
      [960, 960 + 1920],
    ]);
  });

  it("rounds each boundary once, so quintuplet notes tile the beat with no gap or overlap", () => {
    const quint: VoiceItem = {
      kind: "tuplet",
      id: newId(),
      ratio: { actual: 5, normal: 4, unit: 16 },
      items: ["C4", "D4", "E4", "F4", "G4"].map((p) => note(p, 16)),
    };
    const septuplet: VoiceItem = {
      kind: "tuplet",
      id: newId(),
      ratio: { actual: 7, normal: 4, unit: 16 },
      items: ["C4", "D4", "E4", "F4", "G4", "A4", "B4"].map((p) => note(p, 16)),
    };
    const tl = buildTimeline(trebleScore([quint, septuplet, rest(2)]), literal);
    const notes = trebleNotes(tl);
    for (let i = 1; i < notes.length; i++) expect(notes[i]!.onTick).toBe(notes[i - 1]!.offTick);
    expect(notes[4]!.offTick).toBe(QUARTER);
    expect(notes[11]!.offTick).toBe(2 * QUARTER);
  });

  it("sounds every note of a chord, on the same ticks", () => {
    const tl = buildTimeline(trebleScore([chord(["C4", "E4", "G4"], 1)]), literal);
    expect(trebleNotes(tl).map((n) => [n.pitch, n.onTick, n.offTick])).toEqual([
      [60, 0, WHOLE],
      [64, 0, WHOLE],
      [67, 0, WHOLE],
    ]);
  });

  it("keeps voices on one staff in one track and gives each staff its own track on the part's channel", () => {
    const score = newPianoScore({ measureCount: 1 });
    score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = [note("C5", 1)];
    score.parts[0]!.measures[0]!.staves[1]!.voices[0]!.items = [note("C3", 1)];
    const tl = buildTimeline(score, literal);
    expect(tl.tracks).toHaveLength(2);
    expect(tl.tracks[0]!.channel).toBe(tl.tracks[1]!.channel);
    expect(tl.tracks[0]!.notes[0]!.pitch).toBe(72);
    expect(tl.tracks[1]!.notes[0]!.pitch).toBe(48);
  });

  it("collapses the same key struck twice at once (a unison between staves) into one note", () => {
    const score = newPianoScore({ measureCount: 1 });
    score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = [note("C4", 1)];
    score.parts[0]!.measures[0]!.staves[1]!.voices[0]!.items = [note("C4", 1)];
    const tl = buildTimeline(score, literal);
    expect(tl.tracks.flatMap((t) => t.notes)).toHaveLength(1);
  });
});

describe("dynamics", () => {
  it("plays mf until told otherwise", () => {
    expect(trebleNotes(buildTimeline(trebleScore([note("C4", 1)])))[0]!.velocity).toBe(80);
  });

  it("maps dynamic markings to velocity, from the marked note onward", () => {
    const [a, b, c] = [note("C4", 4), note("D4", 4), note("E4", 4)];
    const score = trebleScore([a!, b!, c!, rest(4)]);
    score.attachments.push(dyn("p", a!), dyn("ff", c!));
    expect(trebleNotes(buildTimeline(score)).map((n) => n.velocity)).toEqual([49, 49, 112]);
  });

  it("applies a dynamic written on one staff to the whole part", () => {
    const score = newPianoScore({ measureCount: 1 });
    const treble = note("C5", 1);
    const bass = note("C3", 1);
    score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = [treble];
    score.parts[0]!.measures[0]!.staves[1]!.voices[0]!.items = [bass];
    score.attachments.push(dyn("f", bass, 1)); // between-the-staves dynamics land on either
    const tl = buildTimeline(score);
    expect(tl.tracks[0]!.notes[0]!.velocity).toBe(96);
    expect(tl.tracks[1]!.notes[0]!.velocity).toBe(96);
  });

  it("ramps a crescendo up to the marking that follows it", () => {
    const [a, b, c, d] = [note("C4", 4), note("D4", 4), note("E4", 4), note("F4", 4)];
    const next = note("G4", 1);
    const score = trebleScore([a!, b!, c!, d!], [next]);
    score.attachments.push(dyn("p", a!), dyn("f", next));
    score.spanners.push(spanner({ kind: "hairpin", shape: "cresc", start: at(a!), end: at(d!) }));
    expect(trebleNotes(buildTimeline(score)).map((n) => n.velocity)).toEqual([49, 61, 73, 84, 96]);
  });

  it("ramps a diminuendo down, and carries the reached level forward when nothing follows", () => {
    const [a, b, c, d] = [note("C4", 4), note("D4", 4), note("E4", 4), note("F4", 4)];
    const after = note("G4", 1);
    const score = trebleScore([a!, b!, c!, d!], [after]);
    score.attachments.push(dyn("f", a!));
    score.spanners.push(spanner({ kind: "hairpin", shape: "dim", start: at(a!), end: at(d!) }));
    const v = trebleNotes(buildTimeline(score)).map((n) => n.velocity);
    expect(v[0]).toBe(96);
    expect(v[1]).toBeLessThan(v[0]!);
    expect(v[3]).toBeLessThan(v[2]!);
    expect(v[4]).toBe(96 - 22); // no marking followed: the level it reached stays
  });

  it("accents sforzando notes without changing the level after them", () => {
    const [a, b] = [note("C4", 4), note("D4", 4)];
    const score = trebleScore([a!, b!, rest(2)]);
    score.attachments.push(dyn("p", a!), dyn("sfz", a!));
    const v = trebleNotes(buildTimeline(score)).map((n) => n.velocity);
    expect(v[0]).toBe(49 + 30);
    expect(v[1]).toBe(49);
  });

  it("adds attack velocity for accents and marcato", () => {
    const a = note("C4", 4);
    a.articulations = ["accent"];
    const b = note("D4", 4);
    b.articulations = ["marcato"];
    const v = trebleNotes(buildTimeline(trebleScore([a, b, rest(2)]))).map((n) => n.velocity);
    expect(v).toEqual([80 + 16, 80 + 26]);
  });
});

describe("articulation", () => {
  it("shortens staccato notes by an absolute amount, not a fixed fraction", () => {
    const q = note("C4", 4);
    q.articulations = ["staccato"];
    const h = note("D4", 2);
    h.articulations = ["staccato"];
    const tl = buildTimeline(trebleScore([q, h, rest(4)]));
    expect(trebleNotes(tl)[0]).toMatchObject({ onTick: 0, offTick: WHOLE / 8 }); // half a quarter
    expect(trebleNotes(tl)[1]).toMatchObject({ onTick: QUARTER, offTick: QUARTER + WHOLE / 8 }); // still an eighth
  });

  it("holds tenuto for the full value and ignores articulations in literal mode", () => {
    const a = note("C4", 4);
    a.articulations = ["tenuto"];
    const b = note("D4", 4);
    b.articulations = ["staccato"];
    const score = trebleScore([a, b, rest(2)]);
    expect(trebleNotes(buildTimeline(score))[0]!.offTick).toBe(QUARTER);
    expect(trebleNotes(buildTimeline(score, literal))[1]!.offTick).toBe(2 * QUARTER);
  });
});

describe("tempo", () => {
  const tempoAt = (ev: { id: string }, extra: object): Attachment =>
    ({ id: newId(), kind: "tempo", partIndex: 0, staffIndex: 0, anchor: at(ev), ...extra }) as Attachment;

  it("defaults to 120 when nothing is marked", () => {
    expect(buildTimeline(trebleScore([note("C4", 1)])).tempos).toEqual([{ tick: 0, usPerQuarter: 500000 }]);
  });

  it("reads a metronome mark, converting other beat units to quarter notes", () => {
    const a = note("C4", 1);
    const score = trebleScore([a]);
    score.attachments.push(tempoAt(a, { bpm: 60, beatUnit: notated(4, 1) })); // dotted quarter = 60 -> 90 quarters
    expect(buildTimeline(score).tempos[0]!.usPerQuarter).toBe(Math.round(60e6 / 90));
  });

  it("understands tempo words", () => {
    const a = note("C4", 1);
    const score = trebleScore([a]);
    score.attachments.push(tempoAt(a, { text: "Allegro" }));
    expect(buildTimeline(score).tempos[0]!.usPerQuarter).toBe(Math.round(60e6 / 132));
  });

  it("changes tempo mid-piece at the marked measure", () => {
    const a = note("C4", 1);
    const b = note("D4", 1);
    const score = trebleScore([a], [b]);
    score.attachments.push(tempoAt(a, { bpm: 100 }), tempoAt(b, { bpm: 60 }));
    expect(buildTimeline(score).tempos).toEqual([
      { tick: 0, usPerQuarter: 600000 },
      { tick: WHOLE, usPerQuarter: 1000000 },
    ]);
  });

  it("reads a metronome mark written as plain expression text, even with an OCR-garbled note symbol", () => {
    const a = note("C4", 1);
    const score = trebleScore([a]);
    score.attachments.push({ id: newId(), kind: "text", text: "J=110", style: "expression", partIndex: 0, staffIndex: 0, anchor: at(a) });
    expect(buildTimeline(score).tempos[0]!.usPerQuarter).toBe(Math.round(60e6 / 110));
  });

  it("does not let a first tempo mark far into the piece retroactively set how it began", () => {
    const events = Array.from({ length: 6 }, () => note("C4", 1));
    const score = trebleScore(...events.map((e) => [e]));
    score.attachments.push(tempoAt(events[4]!, { bpm: 80 }));
    expect(buildTimeline(score).tempos).toEqual([
      { tick: 0, usPerQuarter: 500000 },
      { tick: 4 * WHOLE, usPerQuarter: 750000 },
    ]);
  });

  it("uses the first tempo mark for music before it", () => {
    const a = note("C4", 1);
    const b = note("D4", 1);
    const score = trebleScore([a], [b]);
    score.attachments.push(tempoAt(b, { bpm: 80 }));
    expect(buildTimeline(score).tempos[0]).toEqual({ tick: 0, usPerQuarter: 750000 });
  });

  const text = (ev: { id: string }, t: string): Attachment =>
    ({ id: newId(), kind: "text", text: t, style: "expression", partIndex: 0, staffIndex: 0, anchor: at(ev) }) as Attachment;

  it("slows gradually for a ritardando and restores the tempo at 'a tempo'", () => {
    const events = Array.from({ length: 6 }, () => note("C4", 1));
    const score = trebleScore(...events.map((e) => [e]));
    score.attachments.push(text(events[1]!, "rit."), text(events[5]!, "a tempo"));
    const tempos = buildTimeline(score).tempos;
    const slowing = tempos.filter((t) => t.tick > WHOLE && t.tick <= 3 * WHOLE);
    expect(slowing.length).toBeGreaterThan(3);
    for (let i = 1; i < slowing.length; i++) expect(slowing[i]!.usPerQuarter).toBeGreaterThan(slowing[i - 1]!.usPerQuarter);
    expect(slowing[slowing.length - 1]!.usPerQuarter).toBe(Math.round(60e6 / (120 * 0.7)));
    expect(tempos[tempos.length - 1]).toEqual({ tick: 5 * WHOLE, usPerQuarter: 500000 });
  });

  it("holds a fermata by slowing everything under it, then resuming", () => {
    const a = note("C4", 4);
    const score = trebleScore([a, note("D4", 4), rest(2)]);
    score.attachments.push({ id: newId(), kind: "fermata", partIndex: 0, staffIndex: 0, anchor: at(a) });
    expect(buildTimeline(score).tempos).toEqual([
      { tick: 0, usPerQuarter: 1000000 },
      { tick: QUARTER, usPerQuarter: 500000 },
    ]);
    expect(buildTimeline(score, literal).tempos).toEqual([{ tick: 0, usPerQuarter: 500000 }]);
  });

  it("converts ticks to seconds through the tempo map", () => {
    const a = note("C4", 4);
    const score = trebleScore([a, note("D4", 4), rest(2)]);
    score.attachments.push({ id: newId(), kind: "fermata", partIndex: 0, staffIndex: 0, anchor: at(a) });
    const tl = buildTimeline(score);
    // The fermata quarter lasts 1s (at 120 it'd be 0.5s); the rest are 0.5s per quarter.
    expect(ticksToSeconds(tl, QUARTER)).toBeCloseTo(1, 6);
    expect(ticksToSeconds(tl, 2 * QUARTER)).toBeCloseTo(1.5, 6);
  });
});

describe("pedal", () => {
  it("emits sustain down and up for a pedal spanner, on the part's first staff track", () => {
    const [a, b] = [note("C4", 2), note("D4", 2)];
    const score = trebleScore([a, b]);
    score.spanners.push(spanner({ kind: "pedal", style: "line", start: at(a), end: at(b) }));
    const tl = buildTimeline(score);
    expect(tl.tracks[0]!.controllers).toEqual([
      { tick: 0, controller: 64, value: 127 },
      { tick: WHOLE, controller: 64, value: 0 },
    ]);
    expect(tl.tracks[1]!.controllers).toEqual([]);
  });

  it("keeps a pedal change (release then press on one tick) as two events, in that order", () => {
    const [a, b, c, d] = [note("C4", 4), note("D4", 4), note("E4", 4), note("F4", 4)];
    const score = trebleScore([a!, b!, c!, d!]);
    score.spanners.push(
      spanner({ kind: "pedal", style: "line", start: at(a!), end: at(b!) }),
      spanner({ kind: "pedal", style: "line", start: at(c!), end: at(d!) }),
    );
    expect(buildTimeline(score).tracks[0]!.controllers.map((c) => [c.tick, c.value])).toEqual([
      [0, 127],
      [2 * QUARTER, 0],
      [2 * QUARTER, 127],
      [4 * QUARTER, 0],
    ]);
  });

  it("does not release an overlapping pedal early", () => {
    const [a, b, c, d] = [note("C4", 4), note("D4", 4), note("E4", 4), note("F4", 4)];
    const score = trebleScore([a!, b!, c!, d!]);
    score.spanners.push(
      spanner({ kind: "pedal", style: "line", start: at(a!), end: at(c!) }),
      spanner({ kind: "pedal", style: "line", start: at(b!), end: at(d!) }),
    );
    expect(buildTimeline(score).tracks[0]!.controllers.map((c) => [c.tick, c.value])).toEqual([
      [0, 127],
      [4 * QUARTER, 0],
    ]);
  });

  it("reads Ped./* pedal marks", () => {
    const [a, b] = [note("C4", 2), note("D4", 2)];
    const score = trebleScore([a, b]);
    score.attachments.push(
      { id: newId(), kind: "pedalMark", mark: "ped", partIndex: 0, staffIndex: 0, anchor: at(a) },
      { id: newId(), kind: "pedalMark", mark: "star", partIndex: 0, staffIndex: 0, anchor: at(b) },
    );
    expect(buildTimeline(score).tracks[0]!.controllers.map((c) => [c.tick, c.value])).toEqual([
      [0, 127],
      [WHOLE / 2, 0],
    ]);
  });

  it("releases a pedal left down at the end of the piece", () => {
    const a = note("C4", 1);
    const score = trebleScore([a]);
    score.attachments.push({ id: newId(), kind: "pedalMark", mark: "ped", partIndex: 0, staffIndex: 0, anchor: at(a) });
    const c = buildTimeline(score).tracks[0]!.controllers;
    expect(c[c.length - 1]).toEqual({ tick: WHOLE, controller: 64, value: 0 });
  });
});

describe("ottava", () => {
  it("shifts the sounding pitch of notes under an 8va, including the last one", () => {
    const [a, b, c] = [note("C4", 4), note("D4", 4), note("E4", 4)];
    const score = trebleScore([a!, b!, c!, rest(4)]);
    score.spanners.push(spanner({ kind: "ottava", shift: 8, start: at(a!), end: at(b!) }));
    expect(trebleNotes(buildTimeline(score, literal)).map((n) => n.pitch)).toEqual([72, 74, 64]);
  });

  it("supports 8vb and 15ma", () => {
    const [a, b] = [note("C4", 2), note("C4", 2)];
    const score = trebleScore([a, b]);
    score.spanners.push(spanner({ kind: "ottava", shift: -8, start: at(a), end: at(a) }));
    score.spanners.push(spanner({ kind: "ottava", shift: 15, start: at(b), end: at(b) }));
    expect(trebleNotes(buildTimeline(score, literal)).map((n) => n.pitch)).toEqual([48, 84]);
  });
});

describe("grace notes", () => {
  it("plays an acciaccatura just before the beat", () => {
    const grace: NoteEvent = note("D4", 8);
    const principal = note("E4", 4);
    principal.grace = { id: newId(), events: [grace], slash: true };
    const tl = buildTimeline(trebleScore([note("C4", 4), principal, rest(2)]), literal);
    const notes = trebleNotes(tl);
    expect(notes.map((n) => n.pitch)).toEqual([60, 62, 64]);
    // A 32nd (120 ticks) before the second beat; the principal keeps its place.
    expect(notes[1]).toMatchObject({ onTick: QUARTER - 120, offTick: QUARTER });
    expect(notes[2]).toMatchObject({ onTick: QUARTER, offTick: 2 * QUARTER });
  });

  it("gives an appoggiatura its own value out of the principal note", () => {
    const grace: NoteEvent = note("D4", 8);
    const principal = note("E4", 2);
    principal.grace = { id: newId(), events: [grace], slash: false };
    const tl = buildTimeline(trebleScore([principal, rest(2)]), literal);
    const notes = trebleNotes(tl);
    expect(notes[0]).toMatchObject({ pitch: 62, onTick: 0, offTick: WHOLE / 8 });
    expect(notes[1]).toMatchObject({ pitch: 64, onTick: WHOLE / 8, offTick: WHOLE / 2 });
  });
});

describe("ornaments and effects (expressive only)", () => {
  it("plays a trill as alternation with the upper neighbour, ending on the main note", () => {
    const t = note("C5", 4);
    t.ornaments = ["trill"];
    const notes = trebleNotes(buildTimeline(trebleScore([t, rest(2), rest(4)])));
    expect(notes.length).toBeGreaterThanOrEqual(5);
    expect(notes.length % 2).toBe(1);
    expect(notes.map((n) => n.pitch).filter((_, i) => i % 2 === 0)).toEqual(notes.filter((_, i) => i % 2 === 0).map(() => 72));
    expect(notes[1]!.pitch).toBe(74);
    expect(notes[0]!.onTick).toBe(0);
    for (let i = 1; i < notes.length; i++) expect(notes[i]!.onTick).toBe(notes[i - 1]!.offTick);
  });

  it("takes the trill's upper neighbour from the key signature", () => {
    const score = newPianoScore({ measureCount: 1, keySig: { fifths: -2, mode: "major" } }); // Bb Eb
    const t = note("D5", 4);
    t.ornaments = ["trill"];
    score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = [t, rest(2), rest(4)];
    expect(trebleNotes(buildTimeline(score))[1]!.pitch).toBe(75); // Eb5, not E5
  });

  it("plays a mordent as main, lower neighbour, main; an inverted mordent uses the upper", () => {
    const m = note("C5", 4);
    m.ornaments = ["mordent"];
    const im = note("C5", 4);
    im.ornaments = ["invertedMordent"];
    expect(trebleNotes(buildTimeline(trebleScore([m, rest(2), rest(4)]))).map((n) => n.pitch)).toEqual([72, 71, 72]);
    expect(trebleNotes(buildTimeline(trebleScore([im, rest(2), rest(4)]))).map((n) => n.pitch)).toEqual([72, 74, 72]);
  });

  it("plays a turn as upper, main, lower, main", () => {
    const t = note("C5", 4);
    t.ornaments = ["turn"];
    expect(trebleNotes(buildTimeline(trebleScore([t, rest(2), rest(4)]))).map((n) => n.pitch)).toEqual([74, 72, 71, 72]);
  });

  it("repeats a tremolo note at the marked subdivision", () => {
    const t = note("C4", 2);
    t.tremolo = 2; // sixteenths
    const notes = trebleNotes(buildTimeline(trebleScore([t, rest(2)])));
    expect(notes.length).toBeGreaterThanOrEqual(7);
    expect(new Set(notes.map((n) => n.pitch))).toEqual(new Set([60]));
    expect(notes[1]!.onTick - notes[0]!.onTick).toBe(WHOLE / 16);
  });

  it("rolls an arpeggiated chord from the bottom (or top, for a down arrow)", () => {
    const up = chord(["C4", "E4", "G4"], 2);
    up.arpeggio = "up";
    const down = chord(["C4", "E4", "G4"], 2);
    down.arpeggio = "down";
    const upNotes = trebleNotes(buildTimeline(trebleScore([up, rest(2)])));
    expect(upNotes.map((n) => [n.pitch, n.onTick])).toEqual([
      [60, 0],
      [64, 120],
      [67, 240],
    ]);
    const downNotes = trebleNotes(buildTimeline(trebleScore([down, rest(2)])));
    expect(downNotes.map((n) => [n.pitch, n.onTick])).toEqual([
      [67, 0],
      [64, 120],
      [60, 240],
    ]);
  });

  it("leaves ornaments, tremolo and arpeggios out of a literal export", () => {
    const t = note("C5", 4);
    t.ornaments = ["trill"];
    const tr = note("C4", 4);
    tr.tremolo = 1;
    const ar = chord(["C4", "E4"], 4);
    ar.arpeggio = "up";
    const notes = trebleNotes(buildTimeline(trebleScore([t, tr, ar]), literal));
    expect(notes).toHaveLength(4);
    expect(notes.filter((n) => n.onTick === 2 * QUARTER)).toHaveLength(2);
  });
});

describe("repeats", () => {
  it("plays a repeated section twice", () => {
    const score = trebleScore([note("C4", 1)], [note("D4", 1)], [note("E4", 1)]);
    score.measures[1]!.barline = "repeat-end";
    const tl = buildTimeline(score, literal);
    expect(trebleNotes(tl).map((n) => [n.pitch, n.onTick])).toEqual([
      [60, 0],
      [62, WHOLE],
      [60, 2 * WHOLE],
      [62, 3 * WHOLE],
      [64, 4 * WHOLE],
    ]);
    expect(tl.playedMeasures.map((m) => m.measureIndex)).toEqual([0, 1, 0, 1, 2]);
    expect(tl.totalTicks).toBe(5 * WHOLE);
  });

  it("can play the score straight through instead", () => {
    const score = trebleScore([note("C4", 1)], [note("D4", 1)]);
    score.measures[1]!.barline = "repeat-end";
    expect(trebleNotes(buildTimeline(score, { ...literal, unfoldRepeats: false }))).toHaveLength(2);
  });

  it("re-applies spanners on the second pass", () => {
    const [a, b] = [note("C4", 1), note("D4", 1)];
    const score = trebleScore([a], [b]);
    score.measures[1]!.barline = "repeat-end";
    score.spanners.push(spanner({ kind: "pedal", style: "line", start: at(a), end: at(b) }));
    expect(buildTimeline(score).tracks[0]!.controllers.map((c) => [c.tick, c.value])).toEqual([
      [0, 127],
      [2 * WHOLE, 0],
      [2 * WHOLE, 127],
      [4 * WHOLE, 0],
    ]);
  });

  it("does not carry a tie across a repeat jump", () => {
    const a = note("C4", 1);
    a.notes[0]!.tieStart = true;
    const b = note("C4", 1);
    const score = trebleScore([a], [b]);
    score.measures[0]!.barline = "repeat-end"; // 0, 0, 1: the tie into m1 is only real the second time
    const notes = trebleNotes(buildTimeline(score, literal));
    expect(notes.map((n) => [n.onTick, n.offTick])).toEqual([
      [0, WHOLE],
      [WHOLE, 3 * WHOLE], // second pass's tied note runs into the receiving note
    ]);
  });
});

describe("signatures, markers and lyrics", () => {
  it("reports the time and key signatures where they change", () => {
    const score = newPianoScore({ measureCount: 3, timeSig: { numerator: 3, denominator: 4 }, keySig: { fifths: 2, mode: "major" } });
    score.measures[2]!.timeSig = { numerator: 6, denominator: 8 };
    score.measures[2]!.keySig = { fifths: -1, mode: "minor" };
    const tl = buildTimeline(score);
    expect(tl.timeSignatures).toEqual([
      { tick: 0, numerator: 3, denominator: 4 },
      { tick: 2 * fracToTick({ num: 3, den: 4 }), numerator: 6, denominator: 8 },
    ]);
    expect(tl.keySignatures.map((k) => [k.fifths, k.mode])).toEqual([
      [2, "major"],
      [-1, "minor"],
    ]);
  });

  it("gives a pickup measure its real length", () => {
    const score = newPianoScore({ measureCount: 2 });
    score.measures[0]!.actualLength = { num: 1, den: 4 };
    score.parts[0]!.measures[0]!.staves[0]!.voices[0]!.items = [note("G4", 4)];
    score.parts[0]!.measures[1]!.staves[0]!.voices[0]!.items = [note("C5", 1)];
    const tl = buildTimeline(score, literal);
    expect(trebleNotes(tl)[1]!.onTick).toBe(QUARTER);
  });

  it("emits rehearsal marks and first-verse lyrics", () => {
    const a = note("C4", 4);
    a.lyrics = [{ verse: 0, text: "Hel", syllabic: "begin" }, { verse: 1, text: "nope", syllabic: "single" }];
    const b = note("D4", 4);
    b.lyrics = [{ verse: 0, text: "lo", syllabic: "end" }];
    const score = trebleScore([a, b, rest(2)]);
    score.measures[0]!.rehearsalMark = "A";
    const tl = buildTimeline(score);
    expect(tl.markers).toEqual([{ tick: 0, text: "A" }]);
    expect(tl.tracks[0]!.lyrics).toEqual([
      { tick: 0, text: "Hel" },
      { tick: QUARTER, text: "lo " },
    ]);
    expect(buildTimeline(score, { lyrics: false }).tracks[0]!.lyrics).toEqual([]);
  });
});
