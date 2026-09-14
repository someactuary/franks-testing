import { describe, expect, it } from "vitest";
import { EditorStore } from "@/ui/store";
import { stubKeyHandler } from "@/ui/stub-key-handler";
import { setTitle } from "@/commands/basic";
import { frac, newId, newPianoScore, note } from "@/model";
import type { Score } from "@/model";
import type { KeyHandler, KeyStroke } from "@/input/types";

function key(k: string, opts: Partial<Omit<KeyStroke, "key">> = {}): KeyStroke {
  return { key: k, shift: false, mod: false, alt: false, ...opts };
}

/** Two measures of four quarter notes each, staff 0 (treble) only. */
function makeTestScore(): Score {
  const score = newPianoScore({ measureCount: 2 });
  const part = score.parts[0]!;
  part.measures[0]!.staves[0]!.voices = [
    { id: newId(), index: 0, items: [note("C4", 4), note("D4", 4), note("E4", 4), note("F4", 4)] },
  ];
  part.measures[1]!.staves[0]!.voices = [
    { id: newId(), index: 0, items: [note("G4", 4), note("A4", 4), note("B4", 4), note("C5", 4)] },
  ];
  return score;
}

describe("EditorStore.applyKey with the navigation stub", () => {
  it("moves the cursor between onsets, including across a measure boundary", () => {
    const store = new EditorStore(makeTestScore(), stubKeyHandler);
    expect(store.getSnapshot().cursor).toEqual({
      partIndex: 0,
      measureIndex: 0,
      staffIndex: 0,
      voiceIndex: 0,
      offset: frac(0),
    });

    expect(store.applyKey(key("ArrowRight"))).toBe(true);
    expect(store.getSnapshot().cursor).toMatchObject({ measureIndex: 0, offset: frac(1, 4) });

    store.applyKey(key("ArrowRight"));
    store.applyKey(key("ArrowRight"));
    expect(store.getSnapshot().cursor).toMatchObject({ measureIndex: 0, offset: frac(3, 4) });

    // Fourth ArrowRight crosses into measure 1.
    store.applyKey(key("ArrowRight"));
    expect(store.getSnapshot().cursor).toMatchObject({ measureIndex: 1, offset: frac(0) });

    // And ArrowLeft steps back across the same boundary.
    expect(store.applyKey(key("ArrowLeft"))).toBe(true);
    expect(store.getSnapshot().cursor).toMatchObject({ measureIndex: 0, offset: frac(3, 4) });
  });

  it("toggles entry.active on 'n'", () => {
    const store = new EditorStore(makeTestScore(), stubKeyHandler);
    expect(store.getSnapshot().entry.active).toBe(false);
    store.applyKey(key("n"));
    expect(store.getSnapshot().entry.active).toBe(true);
    store.applyKey(key("n"));
    expect(store.getSnapshot().entry.active).toBe(false);
  });

  it("returns false and leaves the snapshot untouched for an unhandled key", () => {
    const store = new EditorStore(makeTestScore(), stubKeyHandler);
    const before = store.getSnapshot();
    expect(store.applyKey(key("q"))).toBe(false);
    expect(store.getSnapshot()).toBe(before); // same reference: no emit happened
  });
});

describe("EditorStore undo/redo through History", () => {
  // The navigation stub never issues commands, so exercising a real
  // execute -> undo -> redo round trip needs a handler that does — this one
  // wraps the existing setTitle command (src/commands/basic.ts).
  const titleHandler: KeyHandler = (_state, k) => {
    if (k.mod && k.key.toLowerCase() === "z") return { commands: [], history: k.shift ? "redo" : "undo" };
    if (k.key === "t") return { commands: [setTitle("Renamed")] };
    return null;
  };

  it("applyKey runs commands through History, and mod+z/mod+shift+z undo/redo", () => {
    const store = new EditorStore(newPianoScore({ measureCount: 1, title: "Original" }), titleHandler);
    expect(store.getSnapshot().score.meta.title).toBe("Original");
    expect(store.getSnapshot().canUndo).toBe(false);

    store.applyKey(key("t"));
    expect(store.getSnapshot().score.meta.title).toBe("Renamed");
    expect(store.getSnapshot().canUndo).toBe(true);
    expect(store.getSnapshot().canRedo).toBe(false);

    store.applyKey(key("z", { mod: true }));
    expect(store.getSnapshot().score.meta.title).toBe("Original");
    expect(store.getSnapshot().canUndo).toBe(false);
    expect(store.getSnapshot().canRedo).toBe(true);

    store.applyKey(key("z", { mod: true, shift: true }));
    expect(store.getSnapshot().score.meta.title).toBe("Renamed");
    expect(store.getSnapshot().canRedo).toBe(false);
  });

  it("the store's own undo()/redo() methods work the same way", () => {
    const store = new EditorStore(newPianoScore({ measureCount: 1, title: "Original" }), titleHandler);
    store.applyKey(key("t"));
    expect(store.getSnapshot().score.meta.title).toBe("Renamed");

    store.undo();
    expect(store.getSnapshot().score.meta.title).toBe("Original");

    store.redo();
    expect(store.getSnapshot().score.meta.title).toBe("Renamed");
  });
});

describe("EditorStore cursor clamping", () => {
  it("clamps setCursor to a valid measure index", () => {
    const store = new EditorStore(newPianoScore({ measureCount: 2 }), stubKeyHandler);
    store.setCursor({ partIndex: 0, measureIndex: 99, staffIndex: 0, voiceIndex: 0, offset: frac(0) });
    expect(store.getSnapshot().cursor.measureIndex).toBe(1);
  });

  it("re-clamps the cursor after loadScore shrinks the score", () => {
    const store = new EditorStore(newPianoScore({ measureCount: 8 }), stubKeyHandler);
    store.setCursor({ partIndex: 0, measureIndex: 7, staffIndex: 0, voiceIndex: 0, offset: frac(0) });
    expect(store.getSnapshot().cursor.measureIndex).toBe(7);

    store.loadScore(newPianoScore({ measureCount: 2 }));
    expect(store.getSnapshot().cursor.measureIndex).toBe(0); // loadScore resets to the start
    expect(store.getSnapshot().canUndo).toBe(false);
  });
});

describe("EditorStore autosave", () => {
  it("is guarded when localStorage is undefined (default node test environment)", () => {
    expect(typeof localStorage).toBe("undefined");
    const store = new EditorStore(makeTestScore(), stubKeyHandler);
    expect(() => store.applyKey(key("n"))).not.toThrow();
    expect(() =>
      store.setCursor({ partIndex: 0, measureIndex: 0, staffIndex: 0, voiceIndex: 0, offset: frac(0) }),
    ).not.toThrow();
    expect(() => store.newScore({ measureCount: 4 })).not.toThrow();
  });
});
