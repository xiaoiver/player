// @ts-ignore
import { DataStream } from "mp4box";
import { MP4Source } from "./MP4Source";
import { PullDemuxer, StreamType } from "./PullDemuxer";
import { MP4AudioTrack, MP4VideoTrack, Sample } from "./types/mp4box";
import { debugLog } from "./utils/log";

// Wrapper around MP4Box.js that shims pull-based demuxing on top their
// push-based API.
export class MP4PullDemuxer implements PullDemuxer {
  private source!: MP4Source;
  private streamType!: StreamType;
  private videoTrack!: MP4VideoTrack;
  private audioTrack!: MP4AudioTrack;
  private selectedTrack!: MP4VideoTrack | MP4AudioTrack;
  private readySamples!: Sample[];
  private _pending_read_resolver: any;

  constructor(private fileUri: string) {}

  async initialize(streamType: StreamType) {
    this.source = new MP4Source(this.fileUri);
    this.readySamples = [];
    this._pending_read_resolver = null;
    this.streamType = streamType;

    await this._tracksReady();

    if (this.streamType == StreamType.AUDIO) {
      this._selectTrack(this.audioTrack);
    } else {
      this._selectTrack(this.videoTrack);
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
        description: this._getDescription(this.source.getDescriptionBox()),
      };
    }
  }

  async getNextChunk() {
    let sample = await this._readSample();
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

  _getDescription(descriptionBox: any) {
    const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
    descriptionBox.write(stream);
    return new Uint8Array(stream.buffer, 8); // Remove the box header.
  }

  async _tracksReady() {
    let info = await this.source.getInfo();
    this.videoTrack = info.videoTracks[0];
    this.audioTrack = info.audioTracks[0];
  }

  _selectTrack(track: MP4VideoTrack | MP4AudioTrack) {
    console.assert(!this.selectedTrack, "changing tracks is not implemented");
    this.selectedTrack = track;
    this.source.selectTrack(track);
  }

  async _readSample(): Promise<Sample> {
    console.assert(!!this.selectedTrack);
    console.assert(!this._pending_read_resolver);

    if (this.readySamples.length) {
      return Promise.resolve(this.readySamples.shift()!);
    }

    let promise = new Promise<Sample>((resolver) => {
      this._pending_read_resolver = resolver;
    });
    console.assert(this._pending_read_resolver);
    this.source.start(this._onSamples.bind(this));
    return promise;
  }

  _onSamples(samples: Sample[]) {
    const SAMPLE_BUFFER_TARGET_SIZE = 50;

    this.readySamples.push(...samples);
    if (this.readySamples.length >= SAMPLE_BUFFER_TARGET_SIZE)
      this.source.stop();

    let firstSampleTime = (samples[0].cts * 1000000) / samples[0].timescale;
    debugLog(
      `adding new ${samples.length} samples (first = ${firstSampleTime}). total = ${this.readySamples.length}`
    );

    if (this._pending_read_resolver) {
      this._pending_read_resolver(this.readySamples.shift());
      this._pending_read_resolver = null;
    }
  }
}
