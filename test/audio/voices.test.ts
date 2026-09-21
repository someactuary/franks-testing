import { describe, expect, it } from "vitest";
import { VoiceManager, type Voice, type VoiceSpawner } from "@/audio/voices";

interface Log {
  events: string[];
  finish: Map<string, () => void>;
}

function rig(maxVoices?: number): { manager: VoiceManager; log: Log } {
  const log: Log = { events: [], finish: new Map() };
  let n = 0;
  const spawner: VoiceSpawner = {
    start(pitch, velocity, t, onFinished) {
      const id = `${pitch}#${++n}`;
      log.events.push(`start ${id} v${velocity} @${t}`);
      log.finish.set(id, onFinished);
      const voice: Voice = {
        release: (at) => log.events.push(`release ${id} @${at}`),
        kill: (at) => log.events.push(`kill ${id} @${at}`),
      };
      return voice;
    },
  };
  return { manager: new VoiceManager(spawner, maxVoices), log };
}

describe("VoiceManager", () => {
  it("releases a note when its key comes up", () => {
    const { manager, log } = rig();
    manager.noteOn(60, 90, 1);
    manager.noteOff(60, 2);
    expect(log.events).toEqual(["start 60#1 v90 @1", "release 60#1 @2"]);
  });

  it("keeps notes ringing under the pedal and releases them when it lifts", () => {
    const { manager, log } = rig();
    manager.pedal(true, 0);
    manager.noteOn(60, 90, 1);
    manager.noteOff(60, 2);
    expect(log.events).toEqual(["start 60#1 v90 @1"]); // no release yet
    manager.pedal(false, 5);
    expect(log.events).toEqual(["start 60#1 v90 @1", "release 60#1 @5"]);
  });

  it("does not release a note that is still held when the pedal lifts", () => {
    const { manager, log } = rig();
    manager.pedal(true, 0);
    manager.noteOn(60, 90, 1);
    manager.pedal(false, 2);
    expect(log.events).toEqual(["start 60#1 v90 @1"]);
    manager.noteOff(60, 3);
    expect(log.events).toEqual(["start 60#1 v90 @1", "release 60#1 @3"]);
  });

  it("cuts the old sound when the same key is struck again, and only releases the new one", () => {
    const { manager, log } = rig();
    manager.pedal(true, 0);
    manager.noteOn(60, 90, 1);
    manager.noteOff(60, 2); // ringing under the pedal
    manager.noteOn(60, 80, 3); // struck again
    manager.pedal(false, 4);
    expect(log.events).toEqual(["start 60#1 v90 @1", "kill 60#1 @3", "start 60#2 v80 @3"]);
    manager.noteOff(60, 5);
    expect(log.events[log.events.length - 1]).toBe("release 60#2 @5");
  });

  it("steals the oldest voice past the polyphony limit", () => {
    const { manager, log } = rig(2);
    manager.noteOn(60, 90, 1);
    manager.noteOn(62, 90, 2);
    manager.noteOn(64, 90, 3);
    expect(log.events).toContain("kill 60#1 @3");
    expect(manager.activeCount).toBe(2);
  });

  it("forgets a voice once it reports it has finished", () => {
    const { manager, log } = rig();
    manager.noteOn(60, 90, 1);
    expect(manager.activeCount).toBe(1);
    log.finish.get("60#1")!();
    expect(manager.activeCount).toBe(0);
    manager.noteOff(60, 2); // nothing to release: harmless
    expect(log.events).toEqual(["start 60#1 v90 @1"]);
  });

  it("all-notes-off releases held keys but respects the pedal", () => {
    const a = rig();
    a.manager.noteOn(60, 90, 1);
    a.manager.noteOn(64, 90, 1);
    a.manager.allNotesOff(2);
    expect(a.log.events.filter((e) => e.startsWith("release"))).toHaveLength(2);

    const b = rig();
    b.manager.pedal(true, 0);
    b.manager.noteOn(60, 90, 1);
    b.manager.allNotesOff(2);
    expect(b.log.events.filter((e) => e.startsWith("release"))).toHaveLength(0);
    b.manager.pedal(false, 3);
    expect(b.log.events.filter((e) => e.startsWith("release"))).toHaveLength(1);
  });

  it("clear cuts everything and lifts the pedal", () => {
    const { manager, log } = rig();
    manager.pedal(true, 0);
    manager.noteOn(60, 90, 1);
    manager.noteOn(64, 90, 1);
    manager.clear(2);
    expect(log.events.filter((e) => e.startsWith("kill"))).toHaveLength(2);
    expect(manager.activeCount).toBe(0);
    // The pedal is up again: a new note releases normally.
    manager.noteOn(67, 90, 3);
    manager.noteOff(67, 4);
    expect(log.events[log.events.length - 1]).toBe("release 67#3 @4");
  });

  it("handles a voice that finishes before start() returns", () => {
    const events: string[] = [];
    const manager = new VoiceManager({
      start(pitch, _v, _t, onFinished) {
        onFinished();
        return { release: () => events.push("release"), kill: () => events.push("kill") };
      },
    });
    manager.noteOn(60, 90, 1);
    expect(manager.activeCount).toBe(0);
    manager.noteOff(60, 2);
    expect(events).toEqual([]);
  });
});
