/**
 * React state around the Web MIDI wrapper (./midi.ts): whether access was granted, the
 * visible input and output ports, and which of each is selected. Remembers each choice in
 * localStorage, and keeps the selection valid as devices come and go.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { MidiPorts, type MidiInputInfo, type MidiOutputInfo } from "./midi";

const INPUT_KEY = "pmn.midiInput";
const OUTPUT_KEY = "pmn.midiOutput";

/** Best-effort localStorage: private-mode/disabled storage never throws out of here. */
function read(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch {
    // best-effort only
  }
}

export interface MidiPortsState {
  midi: MidiPorts;
  supported: boolean;
  granted: boolean;
  inputs: MidiInputInfo[];
  outputs: MidiOutputInfo[];
  inputId: string | null;
  outputId: string | null;
  error: string | null;
  /** Asks the browser for MIDI access (needs a user gesture). Resolves whether it was granted. */
  connect: () => Promise<boolean>;
  selectInput: (id: string | null) => void;
  selectOutput: (id: string | null) => void;
}

export function useMidiPorts(): MidiPortsState {
  const [midi] = useState(() => new MidiPorts());
  const [supported] = useState(() => midi.isSupported());
  const [granted, setGranted] = useState(false);
  const [inputs, setInputs] = useState<MidiInputInfo[]>([]);
  const [outputs, setOutputs] = useState<MidiOutputInfo[]>([]);
  const [inputId, setInputId] = useState<string | null>(null);
  const [outputId, setOutputId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<string | null>(null);
  const outputRef = useRef<string | null>(null);

  const selectInput = useCallback(
    (id: string | null) => {
      midi.select(id);
      inputRef.current = id;
      setInputId(id);
      if (id) write(INPUT_KEY, id);
    },
    [midi],
  );

  const selectOutput = useCallback(
    (id: string | null) => {
      midi.selectOutput(id);
      outputRef.current = id;
      setOutputId(id);
      if (id) write(OUTPUT_KEY, id);
    },
    [midi],
  );

  /** Re-reads both port lists (initial grant, and every hot-plug) and keeps a valid selection in each. */
  const refresh = useCallback(() => {
    const ins = midi.inputs();
    const outs = midi.outputs();
    setInputs(ins);
    setOutputs(outs);

    if (!(inputRef.current && ins.some((i) => i.id === inputRef.current))) {
      const stored = read(INPUT_KEY);
      selectInput((stored && ins.some((i) => i.id === stored) ? stored : ins[0]?.id) ?? null);
    }

    if (!(outputRef.current && outs.some((o) => o.id === outputRef.current))) {
      const stored = read(OUTPUT_KEY);
      // A digital piano appears as an input *and* an output with the same name, so with
      // nothing remembered, play on the device the player is already typing notes in on.
      const inputName = ins.find((i) => i.id === inputRef.current)?.name;
      const sameDevice = outs.find((o) => o.name === inputName)?.id;
      selectOutput((stored && outs.some((o) => o.id === stored) ? stored : (sameDevice ?? outs[0]?.id)) ?? null);
    }
  }, [midi, selectInput, selectOutput]);

  const connect = useCallback(async (): Promise<boolean> => {
    setError(null);
    try {
      await midi.request();
      setGranted(true);
      refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, [midi, refresh]);

  useEffect(() => midi.onStateChange(refresh), [midi, refresh]);

  return { midi, supported, granted, inputs, outputs, inputId, outputId, error, connect, selectInput, selectOutput };
}
