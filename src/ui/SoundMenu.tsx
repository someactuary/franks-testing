/**
 * The "Sound & MIDI" popover: everything about how the score is heard and how a MIDI
 * keyboard connects, in one place — where playback goes (built-in sounds or a MIDI
 * device), which built-in sound and how loud, the MIDI keyboard for entering notes, and
 * exporting a MIDI file.
 */
import { SOUND_PRESETS } from "@/audio/presets";
import { WEB_MIDI_UNSUPPORTED_MESSAGE } from "./midi";
import type { MidiPortsState } from "./useMidiPorts";
import type { PlaybackTarget, SoundState } from "./useSound";

interface SoundMenuProps {
  sound: SoundState;
  ports: MidiPortsState;
  /** Whether the score is playing right now (then picking a sound is heard live, not auditioned). */
  playing: boolean;
  onChangeTarget: (target: PlaybackTarget) => void;
  onExportMidi: (interpretation: "expressive" | "literal") => void;
}

function ConnectMidi({ ports, why }: { ports: MidiPortsState; why: string }) {
  if (!ports.supported) return <p className="menu-note">{WEB_MIDI_UNSUPPORTED_MESSAGE}</p>;
  return (
    <div className="menu-row">
      <button type="button" className="menu-button" onClick={() => void ports.connect()}>
        Connect MIDI
      </button>
      <span className="menu-note">{why}</span>
      {ports.error && <span className="menu-note menu-error">{ports.error}</span>}
    </div>
  );
}

export function SoundMenu({ sound, ports, playing, onChangeTarget, onExportMidi }: SoundMenuProps) {
  const { status } = sound;
  return (
    <div className="sound-menu">
      <section>
        <h4>Play through</h4>
        <div className="segmented" role="group" aria-label="Play through">
          <button
            type="button"
            aria-pressed={sound.target === "builtin"}
            onClick={() => onChangeTarget("builtin")}
          >
            Built-in sounds
          </button>
          <button
            type="button"
            aria-pressed={sound.target === "midi"}
            onClick={() => onChangeTarget("midi")}
          >
            MIDI device
          </button>
        </div>

        {sound.target === "builtin" ? (
          <>
            <div className="preset-grid" role="group" aria-label="Sound">
              {SOUND_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="preset"
                  aria-pressed={sound.instrumentId === p.id}
                  title={p.blurb}
                  onClick={() => sound.chooseInstrument(p.id, !playing)}
                >
                  <span className="preset-name">{p.name}</span>
                  <span className="preset-blurb">{p.blurb}</span>
                </button>
              ))}
            </div>
            <label className="menu-field">
              Volume
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={sound.volume}
                aria-label="Volume"
                onChange={(e) => sound.setVolume(Number(e.target.value))}
              />
            </label>
            {status.state === "loading" && (
              <p className="menu-note">{status.message ?? "Loading…"}</p>
            )}
            {status.state === "error" && <p className="menu-note menu-error">{status.message}</p>}
          </>
        ) : !ports.granted ? (
          <ConnectMidi ports={ports} why="Play the score on your digital piano or a MIDI synth." />
        ) : ports.outputs.length === 0 ? (
          <p className="menu-note">No MIDI output found — plug in your piano (or a MIDI synth).</p>
        ) : (
          <>
            <label className="menu-field">
              Output
              <select
                aria-label="MIDI output"
                value={ports.outputId ?? ""}
                onChange={(e) => ports.selectOutput(e.target.value || null)}
              >
                <option value="">(none)</option>
                {ports.outputs.map((output) => (
                  <option key={output.id} value={output.id}>
                    {output.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="menu-note">
              Notes and the sustain pedal are sent; the device keeps its own sound and volume.
            </p>
          </>
        )}
      </section>

      <section>
        <h4>MIDI keyboard</h4>
        {!ports.granted ? (
          <ConnectMidi ports={ports} why="Notes you play on it are entered into the score." />
        ) : ports.inputs.length === 0 ? (
          <p className="menu-note">No MIDI keyboard found.</p>
        ) : (
          <label
            className="menu-field"
            title="Notes you play on this device are entered into the score"
          >
            Input
            <select
              aria-label="MIDI input"
              value={ports.inputId ?? ""}
              onChange={(e) => ports.selectInput(e.target.value || null)}
            >
              <option value="">(none)</option>
              {ports.inputs.map((input) => (
                <option key={input.id} value={input.id}>
                  {input.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <section>
        <h4>Export MIDI file</h4>
        <div className="export-choices">
          <button type="button" className="menu-choice" onClick={() => onExportMidi("expressive")}>
            <strong>Performance</strong>
            <span>
              Articulations, ornaments, arpeggios, fermatas and ritardandos played out — for
              listening.
            </span>
          </button>
          <button type="button" className="menu-choice" onClick={() => onExportMidi("literal")}>
            <strong>Notation-exact</strong>
            <span>Every note exactly as written — for carrying into another notation program.</span>
          </button>
        </div>
      </section>

      <p className="menu-credit">
        Piano samples: Salamander Grand Piano by Alexander Holm (CC BY 3.0).
      </p>
    </div>
  );
}
