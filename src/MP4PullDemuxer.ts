import { DataStream, MP4AudioTrack, MP4VideoTrack, Sample } from "mp4box";
import { MP4Source } from "./MP4Source";
import { PullDemuxer, StreamType } from "./PullDemuxer";
import { debugLog } from "./utils/log";

const SAMPLE_BUFFER_TARGET_SIZE = 50;

/**
 * Wrapper around MP4Box.js that shims pull-based demuxing on top their push-based API.
 */
export class MP4PullDemuxer implements PullDemuxer {
  private source!: MP4Source;
  private streamType!: StreamType;
  private videoTrack!: MP4VideoTrack;
  private audioTrack!: MP4AudioTrack;
  private selectedTrack!: MP4VideoTrack | MP4AudioTrack;
  private readySamples!: Sample[];
  private pendingReadResolver:
    | ((value: Sample | PromiseLike<Sample>) => void)
    | null = null;

  constructor(private fileUri: string) {}

  async initialize(streamType: StreamType) {
    this.source = new MP4Source(this.fileUri);
    this.readySamples = [];
    this.pendingReadResolver = null;
    this.streamType = streamType;

    await this.tracksReady();

    if (this.streamType == StreamType.AUDIO) {
      this.selectTrack(this.audioTrack);
    } else {
      this.selectTrack(this.videoTrack);
    }
  }

  getDecoderConfig(): AudioDecoderConfig {
    if (this.streamType == StreamType.AUDIO) {
      return {
        codec: this.audioTrack.codec,
        sampleRate: this.audioTrack.audio.sample_rate,
        numberOfChannels: this.audioTrack.audio.channel_count,
        description: this.source.getAudioSpecificConfig(),
      };
    } else {
      return {
        // Browser doesn't support parsing full vp8 codec (eg: `vp08.00.41.08`),
        // they only support `vp8`.
        codec: this.videoTrack.codec.startsWith("vp08")
          ? "vp8"
          : this.videoTrack.codec,
        // @ts-ignore
        displayWidth: this.videoTrack.track_width,
        displayHeight: this.videoTrack.track_height,
        description: this.getDescription(this.source.getDescriptionBox()),
      };
    }
  }

  async getNextChunk() {
    const sample = await this.readSample();
    const type = sample.is_sync ? "key" : "delta";
    const pts_us = (sample.cts * 1000000) / sample.timescale;
    const duration_us = (sample.duration * 1000000) / sample.timescale;
    const ChunkType =
      this.streamType == StreamType.AUDIO
        ? EncodedAudioChunk
        : EncodedVideoChunk;
    return new ChunkType({
      type: type,
      timestamp: pts_us,
      duration: duration_us,
      data: sample.data,
    });
  }

  private getDescription(descriptionBox: any) {
    const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
    descriptionBox.write(stream);
    return new Uint8Array(stream.buffer, 8); // Remove the box header.
  }

  private async tracksReady() {
    const info = await this.source.getInfo();
    this.videoTrack = info.videoTracks[0];
    this.audioTrack = info.audioTracks[0];
  }

  private selectTrack(track: MP4VideoTrack | MP4AudioTrack) {
    console.assert(!this.selectedTrack, "changing tracks is not implemented");
    this.selectedTrack = track;
    this.source.selectTrack(track);
  }

  private async readSample() {
    console.assert(!!this.selectedTrack);
    console.assert(!this.pendingReadResolver);

    if (this.readySamples.length) {
      return Promise.resolve(this.readySamples.shift()!);
    }

    const promise = new Promise<Sample>((resolver) => {
      this.pendingReadResolver = resolver;
    });
    console.assert(!!this.pendingReadResolver);
    this.source.start(this.onSamples);
    return promise;
  }

  /**
   * @see https://github.com/gpac/mp4box.js/#onsamplesid-user-samples
   */
  private onSamples = (samples: Sample[]) => {
    this.readySamples.push(...samples);
    if (this.readySamples.length >= SAMPLE_BUFFER_TARGET_SIZE)
      this.source.stop();

    const firstSampleTime = (samples[0].cts * 1000000) / samples[0].timescale;
    debugLog(
      `adding new ${samples.length} samples (first = ${firstSampleTime}). total = ${this.readySamples.length}`
    );

    if (this.pendingReadResolver) {
      this.pendingReadResolver(this.readySamples.shift()!);
      this.pendingReadResolver = null;
    }
  };
}
