import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { newPianoScore } from "@/model";
import { setScoreMeta } from "@/commands/meta";

describe("setScoreMeta", () => {
  it("sets each field given in the patch", () => {
    const score = newPianoScore({ measureCount: 1, title: "Original" });
    const next = produce(score, (d) =>
      setScoreMeta({ title: "New Title", subtitle: "A subtitle", composer: "J. Doe", lyricist: "A. Poet" }).apply(d),
    );
    expect(next.meta.title).toBe("New Title");
    expect(next.meta.subtitle).toBe("A subtitle");
    expect(next.meta.composer).toBe("J. Doe");
    expect(next.meta.lyricist).toBe("A. Poet");
  });

  it("clears a field when given an empty string", () => {
    const score = produce(newPianoScore({ measureCount: 1, title: "Original" }), (d) => {
      d.meta.composer = "J. Doe";
    });
    const next = produce(score, (d) => setScoreMeta({ composer: "" }).apply(d));
    expect(next.meta.composer).toBeUndefined();
    expect(next.meta.title).toBe("Original"); // untouched fields are left alone
  });

  it("leaves fields not mentioned in the patch untouched", () => {
    const score = produce(newPianoScore({ measureCount: 1, title: "Original" }), (d) => {
      d.meta.composer = "J. Doe";
    });
    const next = produce(score, (d) => setScoreMeta({ title: "Renamed" }).apply(d));
    expect(next.meta.title).toBe("Renamed");
    expect(next.meta.composer).toBe("J. Doe");
  });
});
