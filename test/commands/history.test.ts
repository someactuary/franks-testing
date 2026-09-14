import { describe, expect, it } from "vitest";
import { newPianoScore } from "@/model";
import { History } from "@/commands/history";
import { setTitle } from "@/commands/basic";

describe("History", () => {
  it("execute applies a command and produces a new snapshot", () => {
    const score = newPianoScore({ title: "A" });
    const history = new History(score);

    history.execute(setTitle("B"));

    expect(history.current.meta.title).toBe("B");
    expect(history.current).not.toBe(score);
  });

  it("undo/redo walk back and forward through a sequence of edits", () => {
    const score = newPianoScore({ title: "A" });
    const history = new History(score);
    history.execute(setTitle("B"));
    history.execute(setTitle("C"));
    expect(history.current.meta.title).toBe("C");

    expect(history.undo()).toBe(true);
    expect(history.current.meta.title).toBe("B");
    expect(history.undo()).toBe(true);
    expect(history.current.meta.title).toBe("A");
    expect(history.undo()).toBe(false); // nothing left
    expect(history.current.meta.title).toBe("A");

    expect(history.redo()).toBe(true);
    expect(history.current.meta.title).toBe("B");
    expect(history.redo()).toBe(true);
    expect(history.current.meta.title).toBe("C");
    expect(history.redo()).toBe(false); // nothing left
  });

  it("executing a new command after undo discards the redo branch", () => {
    const score = newPianoScore({ title: "A" });
    const history = new History(score);
    history.execute(setTitle("B"));
    history.execute(setTitle("C"));

    history.undo(); // back to "B"; "C" is sitting on the redo stack
    expect(history.canRedo).toBe(true);

    history.execute(setTitle("D")); // new branch from "B"
    expect(history.current.meta.title).toBe("D");
    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBe(false); // "C" is gone for good

    expect(history.undo()).toBe(true);
    expect(history.current.meta.title).toBe("B");
  });

  it("canUndo/canRedo reflect the stacks", () => {
    const history = new History(newPianoScore());
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);

    history.execute(setTitle("X"));
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);

    history.undo();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it("subscribe notifies listeners on execute/undo/redo, and unsubscribe stops notifications", () => {
    const history = new History(newPianoScore());
    let calls = 0;
    const unsubscribe = history.subscribe(() => calls++);

    history.execute(setTitle("X"));
    expect(calls).toBe(1);
    history.undo();
    expect(calls).toBe(2);
    history.redo();
    expect(calls).toBe(3);

    unsubscribe();
    history.execute(setTitle("Y"));
    expect(calls).toBe(3);
  });

  it("a command that changes nothing does not push a history entry", () => {
    // immer's produce leaves the base object untouched (same reference) when an assignment
    // sets a property to the value it already has; History.execute skips history for that case.
    const history = new History(newPianoScore({ title: "A" }));
    history.execute(setTitle("A"));
    expect(history.canUndo).toBe(false);
  });

  it("caps the undo stack at 500 entries", () => {
    const history = new History(newPianoScore());
    for (let i = 0; i < 510; i++) {
      history.execute(setTitle(`t${i}`));
    }

    let undone = 0;
    while (history.undo()) undone++;

    expect(undone).toBe(500);
    expect(history.current.meta.title).toBe("t9"); // the oldest 10 snapshots were evicted
  });
});
