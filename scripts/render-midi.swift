// Renders a Standard MIDI File to a WAV file offline, using macOS's built-in sound bank
// (Apple's General MIDI DLS piano) through AVAudioEngine's manual rendering mode. About
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
let sampler = AVAudioUnitSampler()
engine.attach(sampler)
engine.connect(sampler, to: engine.mainMixerNode, format: format)
try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)
try sampler.loadSoundBankInstrument(at: bankURL, program: 0,
    bankMSB: UInt8(kAUSampler_DefaultMelodicBankMSB), bankLSB: UInt8(kAUSampler_DefaultBankLSB))
try engine.start()

let seq = AVAudioSequencer(audioEngine: engine)
try seq.load(from: midiURL, options: [])
var longest = 0.0
for t in seq.tracks { t.destinationAudioUnit = sampler; longest = max(longest, t.lengthInSeconds) }
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
print(String(format: "tracks=%d sequenceLength=%.1fs rendered=%.1fs peak=%.3f rms=%.4f", seq.tracks.count, longest, Double(total)/sampleRate, peak, (sumSq/max(count,1)).squareRoot()))
