import { StreamType } from "./PullDemuxer";
import { RingBuffer } from "ringbuf.js";
import { ENABLE_DEBUG_LOGGING, debugLog } from "./utils/log";
import { MP4PullDemuxer } from "./MP4PullDemuxer";

const DATA_BUFFER_DECODE_TARGET_DURATION = 0.3;
const DATA_BUFFER_DURATION = 0.6;
const DECODER_QUEUE_SIZE_MAX = 5;

export class AudioRenderer {
  private playing = false;
  private fillInProgress = false;
  private decoder!: AudioDecoder;
  private demuxer!: MP4PullDemuxer;
  private interleavingBuffers: Float32Array[] = [];
  private init_resolver: ((value: unknown) => void) | null = null;

  sampleRate = 0;
  channelCount = 0;
  ringbuffer!: RingBuffer;

  async initialize(demuxer: MP4PullDemuxer) {
    this.fillInProgress = false;
    this.playing = false;

    this.demuxer = demuxer;
    await this.demuxer.initialize(StreamType.AUDIO);

    this.decoder = new AudioDecoder({
      output: this.bufferAudioData,
      error: (e: Error) => console.error(e),
    });
    const config = this.demuxer.getDecoderConfig();
    this.sampleRate = config.sampleRate;
    this.channelCount = config.numberOfChannels;

    debugLog(config);

    const support = await AudioDecoder.isConfigSupported(config);
    console.assert(support.supported);
    this.decoder.configure(config);

    // Initialize the ring buffer between the decoder and the real-time audio
    // rendering thread. The AudioRenderer has buffer space for approximately
    // 500ms of decoded audio ahead.
    const sampleCountIn500ms =
      DATA_BUFFER_DURATION * this.sampleRate * this.channelCount;
    const sab = RingBuffer.getStorageForCapacity(
      sampleCountIn500ms,
      Float32Array
    );
    this.ringbuffer = new RingBuffer(sab, Float32Array);
    this.interleavingBuffers = [];

    this.init_resolver = null;
    const promise = new Promise((resolver) => (this.init_resolver = resolver));

    this.fillDataBuffer();
    return promise;
  }

  play() {
    // resolves when audio has effectively started: this can take some time if using
    // bluetooth, for example.
    debugLog("playback start");
    this.playing = true;
    this.fillDataBuffer();
  }

  pause() {
    debugLog("playback stop");
    this.playing = false;
  }

  async fillDataBuffer() {
    // This method is called from multiple places to ensure the buffer stays
    // healthy. Sometimes these calls may overlap, but at any given point only
    // one call is desired.
    if (this.fillInProgress) return;

    this.fillInProgress = true;
    // This should be this file's ONLY call to the *Internal() variant of this method.
    await this.fillDataBufferInternal();
    this.fillInProgress = false;
  }

  async fillDataBufferInternal() {
    debugLog(`fillDataBufferInternal()`);

    if (this.decoder.decodeQueueSize >= DECODER_QUEUE_SIZE_MAX) {
      debugLog("\tdecoder saturated");
      // Some audio decoders are known to delay output until the next input.
      // Make sure the DECODER_QUEUE_SIZE is big enough to avoid stalling on the
      // return below. We're relying on decoder output callback to trigger
      // another call to fillDataBuffer().
      console.assert(DECODER_QUEUE_SIZE_MAX >= 2);
      return;
    }

    let usedBufferElements =
      this.ringbuffer.capacity() - this.ringbuffer.available_write();
    let usedBufferSecs =
      usedBufferElements / (this.channelCount * this.sampleRate);
    let pcntOfTarget =
      (100 * usedBufferSecs) / DATA_BUFFER_DECODE_TARGET_DURATION;
    if (usedBufferSecs >= DATA_BUFFER_DECODE_TARGET_DURATION) {
      debugLog(
        `\taudio buffer full usedBufferSecs: ${usedBufferSecs} pcntOfTarget: ${pcntOfTarget}`
      );

      // When playing, schedule timeout to periodically refill buffer. Don't
      // bother scheduling timeout if decoder already saturated. The output
      // callback will call us back to keep filling.
      if (this.playing)
        // Timeout to arrive when buffer is half empty.
        setTimeout(this.fillDataBuffer.bind(this), (1000 * usedBufferSecs) / 2);

      // Initialize() is done when the buffer fills for the first time.
      if (this.init_resolver) {
        this.init_resolver(null);
        this.init_resolver = null;
      }

      // Buffer full, so no further work to do now.
      return;
    }

    // Decode up to the buffering target or until decoder is saturated.
    while (
      usedBufferSecs < DATA_BUFFER_DECODE_TARGET_DURATION &&
      this.decoder.decodeQueueSize < DECODER_QUEUE_SIZE_MAX
    ) {
      debugLog(
        `\tMore samples. usedBufferSecs:${usedBufferSecs} < target:${DATA_BUFFER_DECODE_TARGET_DURATION}.`
      );
      const chunk = await this.demuxer.getNextChunk();
      this.decoder.decode(chunk);

      // NOTE: awaiting the demuxer.readSample() above will also give the
      // decoder output callbacks a chance to run, so we may see usedBufferSecs
      // increase.
      usedBufferElements =
        this.ringbuffer.capacity() - this.ringbuffer.availableWrite();
      usedBufferSecs =
        usedBufferElements / (this.channelCount * this.sampleRate);
    }

    if (ENABLE_DEBUG_LOGGING) {
      const logPrefix =
        usedBufferSecs >= DATA_BUFFER_DECODE_TARGET_DURATION
          ? "\tbuffered enough"
          : "\tdecoder saturated";
      pcntOfTarget =
        (100 * usedBufferSecs) / DATA_BUFFER_DECODE_TARGET_DURATION;
      debugLog(
        logPrefix +
          `; bufferedSecs:${usedBufferSecs} pcntOfTarget: ${pcntOfTarget}`
      );
    }
  }

  bufferHealth() {
    return (
      (1 - this.ringbuffer.availableWrite() / this.ringbuffer.capacity()) * 100
    );
  }

  // From a array of Float32Array containing planar audio data `input`, writes
  // interleaved audio data to `output`. Start the copy at sample
  // `inputOffset`: index of the sample to start the copy from
  // `inputSamplesToCopy`: number of input samples to copy
  // `output`: a Float32Array to write the samples to
  // `outputSampleOffset`: an offset in `output` to start writing
  interleave(
    inputs: Float32Array[],
    inputOffset: number,
    inputSamplesToCopy: number,
    output: Float32Array,
    outputSampleOffset: number
  ) {
    if (inputs.length * inputs[0].length < output.length) {
      throw `not enough space in destination (${
        inputs.length * inputs[0].length
      } < ${output.length}})`;
    }
    const channelCount = inputs.length;
    let outIdx = outputSampleOffset;
    let inputIdx = Math.floor(inputOffset / channelCount);
    let channel = inputOffset % channelCount;
    for (let i = 0; i < inputSamplesToCopy; i++) {
      output[outIdx++] = inputs[channel][inputIdx];
      if (++channel == inputs.length) {
        channel = 0;
        inputIdx++;
      }
    }
  }

  private bufferAudioData = (data: AudioData) => {
    if (this.interleavingBuffers.length != data.numberOfChannels) {
      this.interleavingBuffers = new Array(this.channelCount);
      for (let i = 0; i < this.interleavingBuffers.length; i++) {
        this.interleavingBuffers[i] = new Float32Array(data.numberOfFrames);
      }
    }

    debugLog(
      `bufferAudioData() ts:${data.timestamp} durationSec:${
        data.duration / 1000000
      }`
    );
    // Write to temporary planar arrays, and interleave into the ring buffer.
    for (let i = 0; i < this.channelCount; i++) {
      data.copyTo(this.interleavingBuffers[i], { planeIndex: i });
    }
    // Write the data to the ring buffer. Because it wraps around, there is
    // potentially two copyTo to do.
    const wrote = this.ringbuffer.writeCallback(
      data.numberOfFrames * data.numberOfChannels,
      (first_part, second_part) => {
        this.interleave(
          this.interleavingBuffers,
          0,
          first_part.length,
          first_part as Float32Array,
          0
        );
        this.interleave(
          this.interleavingBuffers,
          first_part.length,
          second_part.length,
          second_part as Float32Array,
          0
        );
      }
    );

    // FIXME - this could theoretically happen since we're pretty agressive
    // about saturating the decoder without knowing the size of the
    // AudioData.duration vs ring buffer capacity.
    console.assert(
      wrote == data.numberOfChannels * data.numberOfFrames,
      "Buffer full, dropping data!"
    );

    // Logging maxBufferHealth below shows we currently max around 73%, so we're
    // safe from the assert above *for now*. We should add an overflow buffer
    // just to be safe.
    // let bufferHealth = this.bufferHealth();
    // if (!('maxBufferHealth' in this))
    //   this.maxBufferHealth = 0;
    // if (bufferHealth > this.maxBufferHealth) {
    //   this.maxBufferHealth = bufferHealth;
    //   console.log(`new maxBufferHealth:${this.maxBufferHealth}`);
    // }

    // fillDataBuffer() gives up if too much decode work is queued. Keep trying
    // now that we've finished some.
    this.fillDataBuffer();
  };
}
