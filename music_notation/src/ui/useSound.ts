/**
 * Where playback is heard: the built-in sound engine (src/audio) or a connected MIDI
 * device. Owns the engine, remembers the choice, the instrument and the volume, and hands
 * the playback `Player` one stable sink that forwards to whichever is selected right now.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioEngine, type EngineStatus } from "@/audio/engine";
import { DEFAULT_PRESET_ID, presetById } from "@/audio/presets";
import type { MidiSink } from "@/playback/player";
import type { MidiPorts } from "./midi";
import { readSetting, writeSetting } from "./storage";

export type PlaybackTarget = "builtin" | "midi";

const TARGET_KEY = "pmn.playbackTarget";
const INSTRUMENT_KEY = "pmn.instrument";
const VOLUME_KEY = "pmn.volume";
const DEFAULT_VOLUME = 0.8;

export interface SoundState {
  engine: AudioEngine;
  status: EngineStatus;
  target: PlaybackTarget;
  setTarget: (target: PlaybackTarget) => void;
  instrumentId: string;
  /** Selects a built-in sound; with `audition`, plays a short arpeggio in it. */
  chooseInstrument: (id: string, audition: boolean) => void;
  volume: number;
  setVolume: (volume: number) => void;
  /** Feeds the playback `Player`; stable across renders. */
  sink: MidiSink;
  /** Starts the built-in engine (needs a user gesture) and loads what the sound needs; false if it couldn't. */
  ensureReady: () => Promise<boolean>;
}

export function useSound(midi: MidiPorts): SoundState {
  const [engine] = useState(() => new AudioEngine());
  const [status, setStatus] = useState<EngineStatus>(() => engine.status);
  const [target, setTargetState] = useState<PlaybackTarget>(() =>
    readSetting(TARGET_KEY) === "midi" ? "midi" : "builtin",
  );
  const [instrumentId, setInstrumentId] = useState(
    () => presetById(readSetting(INSTRUMENT_KEY) ?? DEFAULT_PRESET_ID).id,
  );
  const [volume, setVolumeState] = useState(() => {
    const stored = Number(readSetting(VOLUME_KEY));
    return readSetting(VOLUME_KEY) !== null && Number.isFinite(stored)
      ? Math.max(0, Math.min(1, stored))
      : DEFAULT_VOLUME;
  });

  // The sink outlives renders (the Player is built once), so it reads the current target
  // from a ref that the setter keeps up to date.
  const targetRef = useRef(target);
  const [sink] = useState<MidiSink>(() => ({
    send: (bytes, atMs) =>
      targetRef.current === "builtin" ? engine.send(bytes, atMs) : midi.send(bytes, atMs),
    clear: () => engine.clear(),
  }));

  useEffect(() => engine.subscribe(setStatus), [engine]);

  // Apply the remembered instrument and volume; the engine only acts on them once started.
  useEffect(() => {
    void engine.setInstrument(instrumentId);
  }, [engine, instrumentId]);
  useEffect(() => {
    engine.setVolume(volume);
  }, [engine, volume]);

  const setTarget = useCallback((next: PlaybackTarget) => {
    targetRef.current = next;
    setTargetState(next);
    writeSetting(TARGET_KEY, next);
  }, []);

  const setVolume = useCallback((next: number) => {
    setVolumeState(next);
    writeSetting(VOLUME_KEY, String(next));
  }, []);

  const ensureReady = useCallback(async (): Promise<boolean> => {
    try {
      await engine.ensureReady();
    } catch {
      return false;
    }
    return engine.status.state !== "error";
  }, [engine]);

  const chooseInstrument = useCallback(
    (id: string, audition: boolean) => {
      setInstrumentId(id);
      writeSetting(INSTRUMENT_KEY, id);
      void (async () => {
        await engine.setInstrument(id);
        if (!(await ensureReady())) return;
        // A quick second pick supersedes the first; only the latest one is auditioned.
        if (audition && engine.instrument === id) engine.preview();
      })();
    },
    [engine, ensureReady],
  );

  return {
    engine,
    status,
    target,
    setTarget,
    instrumentId,
    chooseInstrument,
    volume,
    setVolume,
    sink,
    ensureReady,
  };
}
