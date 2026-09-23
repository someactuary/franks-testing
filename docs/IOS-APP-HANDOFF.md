# Handoff: reusing Sheet Music Assistant's playback for an iOS rehearsal app

Written 2026-09-21 for a fresh Claude session working on a separate, native **iOS** app:
snap a photo of sheet music → OMR → a playback file for rehearsal, where the user picks
an instrument and changes tempo. Frank has already tested his OMR step on real photos
(Symphony No. 1 in F) and it worked well. Stems don't matter for playback.

Everything below is about this repo (`/Users/frankchang/AI Projects/personal_music_notation`,
TypeScript). Read `docs/ARCHITECTURE.md` ("Playback timeline and MIDI export", "Playback
through a MIDI device", "Built-in sounds") for the reasoning behind each piece.

## What's reusable, and where

| Piece | Path | Notes |
|---|---|---|
| Score → how it sounds | `src/playback/timeline.ts` (+ `interpret.ts`, `unfold.ts`, `dynamics.ts`, `tempo.ts`) | `buildTimeline(score, {interpretation: "expressive" \| "literal"})` → plain data: notes (tick, duration, pitch, velocity), pedal, tempo map. PPQ 960. Pure. Imports `@/engraving/ties` (`resolveTies`) and `@/model/*`. |
| Timeline → MIDI file | `src/io/midi/smf.ts`, `export.ts` | Format-1 SMF. `exportMidi(score, opts)`. One track per part, program change per track. |
| MusicXML → Score | `src/io/musicxml/import.ts` (~1500 lines) | Reads .musicxml/.xml/.mxl. Uses `DOMParser` in exactly one place (~line 158) and `fflate` for .mxl. |
| Tests as a spec | `test/playback/*.test.ts`, `test/io/midi-export.test.ts`, `test/fixtures/` | Exact expected behaviour for repeats, ties, tempo, dynamics, pedal, ornaments. |
| Piano samples | `public/samples/salamander/*.mp3` (30 files, 2.3 MB) | Salamander Grand Piano, CC BY 3.0 (needs attribution in a shipped app). See its README.txt. |
| macOS AVAudioSequencer example | `scripts/render-midi.swift` | Loads an SMF into `AVAudioSequencer`, renders offline with the macOS `gs_instruments.dls`. Confirms our exported files play correctly through Apple's sequencer. |

**Not reusable on iOS:** `src/audio/*` (Web Audio engine and presets), `src/playback/player.ts`
(look-ahead scheduler that exists to work around browser limits), and all of `src/ui`,
`src/engraving` (except `ties`), `src/render`.

## Behaviours worth keeping (learned the hard way)

- Ties merge into one sustained note **only when contiguous in played time** (matters with repeats/voltas).
- Repeats and first/second endings are unfolded into a linear sequence. D.C./D.S./coda are **not** modeled.
- Fermata = hold ×2, done as a tempo slowdown; rit./accel. are tempo ramps; "a tempo" restores.
- A first tempo mark deep in a piece must not apply backwards (only within 2 measures of the start).
- OCR gives garbled metronome marks like `J=110` (or `♩ = 110` variants): parse them from text (`metronomeFromText` in `interpret.ts`).
- No tempo marking at all → default 120 bpm (the user can change tempo anyway).
- Dynamics and hairpins become per-part velocity; sustain pedal is depth-counted, and a pedal release
  must sort *before* the next press at the same tick.
- 8va = +12, 15ma = +24 semitones; an ottava end anchored on an event ends at the end of that event.
- Musical time is exact (`Fraction`) until one rounding to ticks at the end.

## Suggested iOS pipeline

photo → OMR → MusicXML → **timeline → SMF** → `AVMIDIPlayer` or `AVAudioSequencer` + sampler with a SoundFont.

- **Tempo:** both `AVMIDIPlayer` and `AVAudioSequencer` have a `rate` multiplier — that's the tempo control.
- **Instrument:** it's the MIDI program number (per track) + a General MIDI bank. Rewriting the program
  numbers in the SMF, or loading a different patch into the track's sampler, changes the instrument.
- **Sound bank:** I believe iOS doesn't ship the Mac's built-in bank, so bundle a SoundFont (SF2) —
  `AVAudioUnitSampler.loadSoundBankInstrument(at:program:bankMSB:bankLSB:)` loads SF2/DLS. Candidates to
  check for licence and size: GeneralUser GS, FluidR3. **Unverified on device.**
- **Audio session:** use category `.playback` so the ring/silent switch doesn't mute it (and for background
  audio if wanted).
- **Per-part control** (mute/solo a voice for choir or ensemble rehearsal) falls out naturally: one MIDI
  track per part → mute a track.

## Two ways to get the timeline logic into Swift

1. **Embed the TypeScript with JavaScriptCore** (built into iOS). Bundle `import` + `buildTimeline` + `smf`
   with esbuild into one JS file, run it in a `JSContext`, pass MusicXML in, get SMF bytes out. Keeps all
   ~1067 existing tests meaningful. Needs a pure-JS `DOMParser` (e.g. xmldom) for the one call above.
   **Not tried** — plausible, but check the bundle size and that nothing else assumes a browser.
2. **Port to Swift.** ~1100 lines of timeline logic + a small SMF writer, using `test/playback` as the
   spec. Swift has no built-in rational type: use a small `Fraction` struct over `Int`.

If the OMR step already yields good **MIDI**, most of this isn't needed; what still helps is the list of
behaviours above (tempo defaults, repeats, ties) if that MIDI is naive about them.

## Open questions for Frank

- What does the OMR step output today — MusicXML, MIDI, something else?
- Personal use or an App Store release? (Salamander needs attribution; if OMR is Audiveris on a server,
  note it is AGPL-licensed.)
- Which rehearsal features first: instrument, tempo, per-part solo/mute, looping, count-in, metronome?
