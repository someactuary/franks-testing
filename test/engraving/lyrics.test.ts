import { describe, expect, it } from "vitest";
import { LYRICS } from "@/engraving/lyrics";
import type { LinePrim, TextPrim } from "@/engraving/layout-types";
import { newId } from "@/model/ids";
import type { Lyric, NoteEvent, Score } from "@/model/score";
import { hymn } from "../fixtures/hymn";
import {
  allSystems,
  glyphs,
  makeScore,
  run,
  setStaff,
  staffTop,
  system,
  texts,
  withRole,
} from "./helpers";
import { note } from "@/model/factory";

/** Every text primitive whose ref says "lyric", across every system. */
function lyricTexts(score: Score): TextPrim[] {
  return allSystems(run(score)).flatMap((sys) =>
    texts(withRole(sys.primitives, "lyric") as TextPrim[]),
  );
}

function sing(ev: NoteEvent, ...lyrics: Lyric[]): NoteEvent {
  return { ...ev, lyrics };
}

/** Four quarters on the upper staff, with whatever lyrics the caller attaches. */
function melody(build: (events: NoteEvent[]) => void): Score {
  const score = makeScore({ measureCount: 1 });
  const events = [note("C5", 4), note("D5", 4), note("E5", 4), note("F5", 4)];
  build(events);
  setStaff(score, 0, 0, events);
  return score;
}

describe("lyrics", () => {
  it("draws one text primitive per syllable with role 'lyric' and the event's id", () => {
    let ids: string[] = [];
    const score = melody((events) => {
      events[0]!.lyrics = [{ verse: 0, text: "one", syllabic: "single" }];
      events[2]!.lyrics = [{ verse: 0, text: "two", syllabic: "single" }];
      ids = [events[0]!.id, events[2]!.id];
    });

    const prims = lyricTexts(score);
    expect(prims.map((p) => p.text)).toEqual(["one", "two"]);
    expect(prims.map((p) => p.ref?.id)).toEqual(ids);
    expect(prims.every((p) => p.style === "lyric")).toBe(true);
    expect(prims.every((p) => p.anchor === "middle")).toBe(true);
    expect(prims.every((p) => p.size === LYRICS.sizeSp)).toBe(true);
  });

  it("centres each syllable on its notehead", () => {
    const score = melody((events) => {
      events[0]!.lyrics = [{ verse: 0, text: "la", syllabic: "single" }];
    });
    const result = run(score);
    const sys = system(result);
    const head = glyphs(sys.primitives, "noteheadBlack")[0]!;
    const [lyric] = texts(withRole(sys.primitives, "lyric") as TextPrim[]);
    // The notehead glyph is placed by its left edge; Bravura's black head is
    // about 1.18 sp wide, so the centre is roughly half a space to its right.
    expect(lyric!.x).toBeGreaterThan(head.x);
    expect(lyric!.x).toBeLessThan(head.x + 1.3);
  });

  it("puts every verse in its own lane, verse 1 below verse 0, below the staff", () => {
    const score = melody((events) => {
      events[0]!.lyrics = [
        { verse: 0, text: "one", syllabic: "single" },
        { verse: 1, text: "two", syllabic: "single" },
        { verse: 2, text: "three", syllabic: "single" },
      ];
    });
    const result = run(score);
    const sys = system(result);
    const byText = new Map(
      texts(withRole(sys.primitives, "lyric") as TextPrim[]).map((p) => [p.text, p.y]),
    );
    const top = staffTop(sys, 0);

    expect(byText.get("one")!).toBeGreaterThan(top + 4);
    expect(byText.get("two")! - byText.get("one")!).toBeCloseTo(LYRICS.versePitchSp, 6);
    expect(byText.get("three")! - byText.get("two")!).toBeCloseTo(LYRICS.versePitchSp, 6);
  });

  it("shares one flat baseline per verse across the whole system", () => {
    const score = melody((events) => {
      for (const [i, ev] of events.entries()) {
        // The third note is a high one, so its own column's skyline is deeper.
        ev.lyrics = [{ verse: 0, text: `s${i}`, syllabic: "single" }];
      }
      events[2]!.notes[0]!.pitch = { step: "C", alter: 0, octave: 6 };
    });
    const ys = new Set(lyricTexts(score).map((p) => p.y));
    expect(ys.size).toBe(1);
  });

  it("draws a hyphen between begin/middle syllables but not after end/single", () => {
    const score = melody((events) => {
      events[0]!.lyrics = [{ verse: 0, text: "hy", syllabic: "begin" }];
      events[1]!.lyrics = [{ verse: 0, text: "phen", syllabic: "end" }];
      events[2]!.lyrics = [{ verse: 0, text: "done", syllabic: "single" }];
    });
    const prims = lyricTexts(score);
    const hyphens = prims.filter((p) => p.text === "-");
    expect(hyphens).toHaveLength(1);

    const hy = prims.find((p) => p.text === "hy")!;
    const phen = prims.find((p) => p.text === "phen")!;
    expect(hyphens[0]!.x).toBeGreaterThan(hy.x);
    expect(hyphens[0]!.x).toBeLessThan(phen.x);
    expect(hyphens[0]!.y).toBe(hy.y);
  });

  it("repeats the hyphen over a long gap", () => {
    // Two syllables a whole measure apart: far more than one hyphen pitch.
    const score = makeScore({ measureCount: 2 });
    const a = sing(note("C5", 1), { verse: 0, text: "a", syllabic: "begin" });
    const b = sing(note("D5", 1), { verse: 0, text: "b", syllabic: "end" });
    setStaff(score, 0, 0, [a]);
    setStaff(score, 1, 0, [b]);

    const hyphens = lyricTexts(score).filter((p) => p.text === "-");
    expect(hyphens.length).toBeGreaterThan(1);
    const gaps = hyphens.slice(1).map((p, i) => p.x - hyphens[i]!.x);
    for (const gap of gaps) expect(gap).toBeLessThanOrEqual(LYRICS.hyphenPitchSp + 1e-6);
  });

  it("draws an extender line over a melisma and stops at its last note", () => {
    let id = "";
    const score = melody((events) => {
      events[0]!.lyrics = [{ verse: 0, text: "ah", syllabic: "single", extend: true }];
      events[3]!.lyrics = [{ verse: 0, text: "men", syllabic: "single" }];
      id = events[0]!.id;
    });
    const result = run(score);
    const sys = system(result);
    const extenders = (withRole(sys.primitives, "lyric") as LinePrim[]).filter(
      (p) => p.type === "line",
    );
    expect(extenders).toHaveLength(1);
    const line = extenders[0]!;
    expect(line.ref?.id).toBe(id);
    expect(line.thickness).toBeCloseTo(LYRICS.extenderThicknessSp, 6);
    expect(line.y1).toBe(line.y2);

    const heads = glyphs(sys.primitives, "noteheadBlack");
    // Starts after "ah" (note 0) and ends on the third note — the last one of the
    // melisma, since the fourth carries the next syllable.
    expect(line.x1).toBeGreaterThan(heads[0]!.x);
    expect(line.x2).toBeGreaterThan(heads[2]!.x);
    expect(line.x2).toBeLessThan(heads[3]!.x);
  });

  it("draws no extender when the next syllable is on the very next note", () => {
    const score = melody((events) => {
      events[0]!.lyrics = [{ verse: 0, text: "ah", syllabic: "single", extend: true }];
      events[1]!.lyrics = [{ verse: 0, text: "men", syllabic: "single" }];
    });
    const sys = system(run(score));
    const lines = withRole(sys.primitives, "lyric").filter((p) => p.type === "line");
    expect(lines).toHaveLength(0);
  });

  it("widens the column under a long syllable, pushing the next note right", () => {
    const build = (text: string): Score =>
      melody((events) => {
        events[1]!.lyrics = [{ verse: 0, text, syllabic: "single" }];
      });

    const plain = run(build(""));
    const long = run(build("extraordinarily"));
    const xs = (score: ReturnType<typeof run>) =>
      system(score).measures[0]!.columns.map((c) => c.x);

    const before = xs(plain);
    const after = xs(long);
    // Column 1 carries the long word; column 2 must move right to clear it.
    expect(after[2]! - after[1]!).toBeGreaterThan(before[2]! - before[1]! + 3);
  });

  it("moves dynamics and hairpins above a staff that carries words", () => {
    const score = makeScore({ measureCount: 1 });
    const events = [note("C5", 4), note("D5", 4), note("E5", 4), note("F5", 4)];
    events[0]!.lyrics = [{ verse: 0, text: "sing", syllabic: "single" }];
    setStaff(score, 0, 0, events);
    const upper = { partIndex: 0, staffIndex: 0 };
    score.attachments = [
      {
        id: newId(),
        ...upper,
        kind: "dynamic",
        text: "p",
        anchor: { kind: "event", eventId: events[0]!.id },
      },
    ];
    score.spanners = [
      {
        id: newId(),
        ...upper,
        kind: "hairpin",
        shape: "cresc",
        start: { kind: "event", eventId: events[1]!.id },
        end: { kind: "event", eventId: events[3]!.id },
      },
    ];

    const sys = system(run(score));
    const top = staffTop(sys, 0);
    const dynamic = texts(withRole(sys.primitives, "dynamic") as TextPrim[])[0]!;
    expect(dynamic.y).toBeLessThan(top);

    const hairpin = withRole(sys.primitives, "hairpin").filter((p) => p.type === "line");
    expect(hairpin.length).toBeGreaterThan(0);
    for (const line of hairpin) expect(line.y1).toBeLessThan(top);

    // ... and stays below when the staff has no words at all.
    const silent = makeScore({ measureCount: 1 });
    const plain = [note("C5", 4), note("D5", 4), note("E5", 4), note("F5", 4)];
    setStaff(silent, 0, 0, plain);
    silent.attachments = [
      {
        id: newId(),
        ...upper,
        kind: "dynamic",
        text: "p",
        anchor: { kind: "event", eventId: plain[0]!.id },
      },
    ];
    const quiet = system(run(silent));
    const below = texts(withRole(quiet.primitives, "dynamic") as TextPrim[])[0]!;
    expect(below.y).toBeGreaterThan(staffTop(quiet, 0) + 4);
  });

  it("engraves the hymn fixture: two verses, hyphens, extenders, dynamics above", () => {
    const result = run(hymn());
    const systems = allSystems(result);
    expect(systems.length).toBeGreaterThan(1);

    const all = systems.flatMap((sys) => texts(withRole(sys.primitives, "lyric") as TextPrim[]));
    expect(all.some((p) => p.text === "Praise")).toBe(true);
    expect(all.some((p) => p.text === "strength")).toBe(true);
    expect(all.filter((p) => p.text === "-").length).toBeGreaterThan(3);

    // Two verses on the soprano staff of system 0 => two distinct baselines
    // above the alto staff.
    const first = systems[0]!;
    const altoTop = staffTop(first, 1);
    const sopranoLanes = [
      ...new Set(
        texts(withRole(first.primitives, "lyric") as TextPrim[])
          .map((p) => p.y)
          .filter((y) => y < altoTop),
      ),
    ].sort((a, b) => a - b);
    expect(sopranoLanes).toHaveLength(2);
    expect(sopranoLanes[1]! - sopranoLanes[0]!).toBeCloseTo(LYRICS.versePitchSp, 6);

    // The bass staff sings one measure of its own, in its own lane.
    const bassTop = staffTop(first, 3);
    const bass = texts(withRole(first.primitives, "lyric") as TextPrim[]).filter(
      (p) => p.y > bassTop,
    );
    expect(bass.map((p) => p.text)).toEqual(["Sing", "praise"]);

    // Extenders: one per verse on the melisma.
    const extenders = systems.flatMap((sys) =>
      withRole(sys.primitives, "lyric").filter((p) => p.type === "line"),
    );
    expect(extenders).toHaveLength(2);

    // Dynamics sit above the soprano staff.
    for (const sys of systems) {
      for (const d of texts(withRole(sys.primitives, "dynamic") as TextPrim[])) {
        expect(d.y).toBeLessThan(staffTop(sys, 0));
      }
    }
  });
});
