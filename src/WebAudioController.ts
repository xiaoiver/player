import { URLFromFiles } from "./utils/fetch";

const RINGBUF_PATH = "/ringbuf.js";
const AUDIOSINK_PATH = "/audiosink.js";

/**
 * Simple wrapper class for creating AudioWorklet,
 * connecting it to an AudioContext, and controlling audio playback.
 */
export class WebAudioController {
  private audioContext: AudioContext | undefined;
  private volumeGainNode: GainNode | undefined;
  private audioSink: AudioWorkletNode | undefined;

  async initialize(
    sampleRate: number,
    channelCount: number,
    sharedArrayBuffer: SharedArrayBuffer
  ) {
    // Set up AudioContext to house graph of AudioNodes and control rendering.
    this.audioContext = new AudioContext({
      /**
       * Decoded from MP4Source.
       * @see https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext#samplerate
       */
      sampleRate,
      /**
       * The browser selects a latency that will maximize playback time by minimizing power consumption at the expense of latency.
       * Useful for non-interactive playback, such as playing music.
       * @see https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext#latencyhint
       */
      latencyHint: "playback",
    });

    // @see https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/suspend
    this.audioContext.suspend();

    // Make script modules available for execution by AudioWorklet.
    const workletSource = await URLFromFiles([RINGBUF_PATH, AUDIOSINK_PATH]);
    /**
     * @see https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
     */
    await this.audioContext.audioWorklet.addModule(workletSource);

    // Get an instance of the AudioSink worklet, passing it the memory for a
    // ringbuffer, connect it to a GainNode for volume. This GainNode is in
    // turn connected to the destination.
    this.audioSink = new AudioWorkletNode(this.audioContext, "AudioSink", {
      processorOptions: {
        sab: sharedArrayBuffer,
        mediaChannelCount: channelCount,
      },
      outputChannelCount: [channelCount],
    });
    this.volumeGainNode = new GainNode(this.audioContext);
    this.audioSink
      .connect(this.volumeGainNode)
      .connect(this.audioContext.destination);
  }

  setVolume(volume: number) {
    if (volume < 0.0 && volume > 1.0) return;

    // Smooth exponential volume ramps on change
    this.volumeGainNode!.gain.setTargetAtTime(
      volume,
      this.audioContext!.currentTime,
      0.3
    );
  }

  async play() {
    return this.audioContext!.resume();
  }

  async pause() {
    return this.audioContext!.suspend();
  }

  getMediaTimeInSeconds() {
    // The currently rendered audio sample is the current time of the
    // AudioContext, offset by the total output latency, that is composed of
    // the internal buffering of the AudioContext (e.g., double buffering), and
    // the inherent latency of the audio playback system: OS buffering,
    // hardware buffering, etc. This starts out negative, because it takes some
    // time to buffer, and crosses zero as the first audio sample is produced
    // by the audio output device.
    const totalOutputLatency =
      this.audioContext!.outputLatency + this.audioContext!.baseLatency;

    return Math.max(this.audioContext!.currentTime - totalOutputLatency, 0.0);
  }
}
