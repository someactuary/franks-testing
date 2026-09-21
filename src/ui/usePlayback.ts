/**
 * React glue for playback: builds the score's timeline when Play is pressed, drives the
 * `Player` (src/playback/player.ts) against the MIDI output, and exposes the playhead
 * (a measure + offset in the *score*, so repeats show the playhead jumping back).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Cursor } from "@/input/types";
import type { Score } from "@/model";
import { Player, type PlayerStatus } from "@/playback/player";
import { positionAt, tickAt, type PlayPosition } from "@/playback/position";
import { buildTimeline, type Timeline } from "@/playback/timeline";
import type { MidiPorts } from "./midi";

export interface PlaybackState {
  status: PlayerStatus;
  /** Where playback is on the page; null when stopped. */
  playhead: PlayPosition | null;
  speed: number;
  setSpeed: (speed: number) => void;
  /** Play from the cursor when stopped, pause when playing, resume when paused. */
  toggle: () => void;
  stop: () => void;
}

interface Args {
  score: Score;
  cursor: Cursor;
  midi: MidiPorts;
  /** Makes sure MIDI access is granted and an output is selected; false (after saying why) if it can't be. */
  ensureOutput: () => Promise<boolean>;
}

/** The playhead is redrawn at most this often. */
const FRAME_MS = 33;

export function usePlayback({ score, cursor, midi, ensureOutput }: Args): PlaybackState {
  const [player] = useState(
    () =>
      new Player(
        { send: (bytes, at) => midi.send(bytes, at) },
        {
          now: () => midi.now(),
          setInterval: (fn, ms) => window.setInterval(fn, ms),
          clearInterval: (h) => window.clearInterval(h as number),
          // A hidden tab's timers are throttled to about once a second, so look further ahead there.
          lookaheadMs: () => (document.hidden ? 1200 : 200),
        },
      ),
  );
  const timeline = useRef<Timeline | null>(null);
  const [status, setStatus] = useState<PlayerStatus>("stopped");
  const [playhead, setPlayhead] = useState<PlayPosition | null>(null);
  const [speed, setSpeedState] = useState(1);

  // Read at Play time, without making `toggle` change identity on every keystroke or edit.
  const latest = useRef({ score, cursor, speed });
  useEffect(() => {
    latest.current = { score, cursor, speed };
  });

  const stop = useCallback(() => player.stop(), [player]);

  const toggle = useCallback(() => {
    if (player.status === "playing") {
      player.pause();
      return;
    }
    if (player.status === "paused") {
      player.play();
      return;
    }
    void (async () => {
      if (!(await ensureOutput())) return;
      const { score: s, cursor: c, speed: v } = latest.current;
      const tl = buildTimeline(s, { interpretation: "expressive" });
      timeline.current = tl;
      player.load(tl);
      player.play({ fromTick: tickAt(tl, c.measureIndex, c.offset), speed: v });
    })();
  }, [player, ensureOutput]);

  const setSpeed = useCallback(
    (v: number) => {
      setSpeedState(v);
      player.setSpeed(v);
    },
    [player],
  );

  // Follow the player while it runs.
  useEffect(() => {
    if (status !== "playing") return;
    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      if (t - last >= FRAME_MS && timeline.current) {
        last = t;
        const next = positionAt(timeline.current, player.tick);
        setPlayhead((prev) =>
          prev && next && prev.measureIndex === next.measureIndex && prev.offset.num * next.offset.den === next.offset.num * prev.offset.den
            ? prev
            : (next ?? null),
        );
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [status, player]);

  // The player is the source of truth for status; the UI just mirrors it.
  useEffect(
    () =>
      player.subscribe((next) => {
        setStatus(next);
        if (next === "stopped") setPlayhead(null);
      }),
    [player],
  );

  // A different document (open/new/import) makes the running timeline meaningless.
  useEffect(() => {
    player.stop();
  }, [score.id, player]);
  useEffect(() => () => player.stop(), [player]);

  return { status, playhead, speed, setSpeed, toggle, stop };
}
