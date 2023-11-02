/**
 * Which stream should be demuxed.
 */
export enum StreamType {
  AUDIO,
  VIDEO,
}

export interface PullDemuxer {
  /**
   * Starts fetching file. Resolves when enough of the file is fetched/parsed to populate getDecoderConfig().
   * @param streamType
   */
  initialize(streamType: StreamType): Promise<void>;

  /**
   * Returns either an AudioDecoderConfig or VideoDecoderConfig based on the streamType passed to initialize().
   */
  getDecoderConfig(): AudioDecoderConfig;

  /**
   * Returns either EncodedAudioChunks or EncodedVideoChunks based on the streamType passed to initialize().
   * Returns null after EOF.
   */
  getNextChunk(): Promise<EncodedVideoChunk>;
}
