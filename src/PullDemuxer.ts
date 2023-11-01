// Constants passed to initialize() to indicate which stream should be demuxed.
export enum StreamType {
  AUDIO,
  VIDEO,
}

// Interface to be extended by concrete demuxer implementations.
export interface PullDemuxer {
  // Starts fetching file. Resolves when enough of the file is fetched/parsed to
  // populate getDecoderConfig().
  initialize(streamType: StreamType): Promise<void>;

  // Returns either an AudioDecoderConfig or VideoDecoderConfig based on the
  // streamType passed to initialize().
  getDecoderConfig(): AudioDecoderConfig;

  // Returns either EncodedAudioChunks or EncodedVideoChunks based on the
  // streamType passed to initialize(). Returns null after EOF.
  getNextChunk(): Promise<EncodedVideoChunk>;
}
