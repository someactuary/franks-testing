// Renders a Standard MIDI File to a WAV file offline, using macOS's built-in General MIDI
// sound bank (one sampler per track, loaded with that track's first program change) through AVAudioEngine's manual rendering mode. About
// 180x faster than real time, no third-party software.
//
// This is a developer/validation tool, not part of the app: it is how the exported MIDI
// was checked against Apple's own MIDI parser (AVAudioSequencer), and the starting point
// if in-app playback ever wants a "render on the Mac" option. macOS only. `afconvert`
// cannot do this — it doesn't read MIDI files.
//
//   swiftc -O scripts/render-midi.swift -o /tmp/render_midi
//   /tmp/render_midi score.mid score.wav [soundbank.dls|sf2]
//
// Prints track count, sequence length, and the rendered peak/RMS level (a silent render
// has peak 0) so a bad file is obvious without listening.
import AVFoundation
import AudioToolbox

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: render in.mid out.wav [bank]"); exit(2) }
let midiURL = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])
let bankURL = URL(fileURLWithPath: args.count > 3 ? args[3] : "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls")

let sampleRate = 44100.0
let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2)!
let engine = AVAudioEngine()
try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)
let seq = AVAudioSequencer(audioEngine: engine)
try seq.load(from: midiURL, options: [])

// A sampler loaded from a sound bank plays one instrument and ignores program changes,
// so each track gets its own sampler loaded with the track's first program (default 0).
func firstProgram(_ track: AVMusicTrack) -> UInt8 {
    var program: UInt8 = 0
    track.enumerateEvents(in: AVMakeBeatRange(0, AVMusicTimeStampEndOfTrack)) { event, _, stop in
        if let pc = event as? AVMIDIProgramChangeEvent { program = UInt8(pc.programNumber & 0x7F); stop.pointee = true }
    }
    return program
}
var longest = 0.0
var programs: [UInt8] = []
for t in seq.tracks {
    let sampler = AVAudioUnitSampler()
    engine.attach(sampler)
    engine.connect(sampler, to: engine.mainMixerNode, format: format)
    let program = firstProgram(t)
    programs.append(program)
    try sampler.loadSoundBankInstrument(at: bankURL, program: program,
        bankMSB: UInt8(kAUSampler_DefaultMelodicBankMSB), bankLSB: UInt8(kAUSampler_DefaultBankLSB))
    t.destinationAudioUnit = sampler
    longest = max(longest, t.lengthInSeconds)
}
try engine.start()
seq.prepareToPlay()
try seq.start()

let total = AVAudioFramePosition((longest + 3.0) * sampleRate)
let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: engine.manualRenderingMaximumFrameCount)!
let out = try AVAudioFile(forWriting: outURL, settings: format.settings)
var peak: Float = 0
var sumSq: Double = 0
var count: Double = 0
while engine.manualRenderingSampleTime < total {
    let want = min(AVAudioFrameCount(total - engine.manualRenderingSampleTime), buffer.frameCapacity)
    let status = try engine.renderOffline(want, to: buffer)
    if status == .success {
        try out.write(from: buffer)
        for ch in 0..<Int(buffer.format.channelCount) {
            let p = buffer.floatChannelData![ch]
            for i in 0..<Int(buffer.frameLength) { let v = abs(p[i]); peak = max(peak, v); sumSq += Double(v*v); count += 1 }
        }
    } else if status == .error { print("render error"); break }
}
// Top-level objects are never deinitialized, so close explicitly: this is what writes the
// final RIFF/data chunk sizes. Without it the WAV header says 0 frames.
out.close()
print("programs=\(programs)")
print(String(format: "tracks=%d sequenceLength=%.1fs rendered=%.1fs peak=%.3f rms=%.4f", seq.tracks.count, longest, Double(total)/sampleRate, peak, (sumSq/max(count,1)).squareRoot()))
