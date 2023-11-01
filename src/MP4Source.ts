// @ts-ignore
import * as MP4Box from "mp4box";
import { debugLog } from "./utils/log";
import type {
  MP4Info,
  MP4File,
  Sample,
  MP4AudioTrack,
  MP4VideoTrack,
} from "./types/mp4box";

export class MP4Source {
  private file: MP4File;
  private info: MP4Info | null = null;
  private _info_resolver: any;
  private _onSamples!: (samples: Sample[]) => void;

  constructor(uri: string) {
    this.file = MP4Box.createFile();
    this.file.onError = console.error.bind(console);
    this.file.onReady = this.onReady.bind(this);
    this.file.onSamples = this.onSamples.bind(this);

    debugLog("fetching file");
    fetch(uri).then((response) => {
      debugLog("fetch responded");
      const reader = response.body!.getReader();
      let offset = 0;
      let mp4File = this.file;

      // @ts-ignore
      function appendBuffers({ done, value }) {
        if (done) {
          mp4File.flush();
          return;
        }
        let buf = value.buffer;
        buf.fileStart = offset;

        offset += buf.byteLength;

        mp4File.appendBuffer(buf);

        // @ts-ignore
        return reader.read().then(appendBuffers);
      }

      // @ts-ignore
      return reader.read().then(appendBuffers);
    });

    this.info = null;
    this._info_resolver = null;
  }

  onReady(info: MP4Info) {
    // TODO: Generate configuration changes.
    this.info = info;

    if (this._info_resolver) {
      this._info_resolver(info);
      this._info_resolver = null;
    }
  }

  getInfo(): Promise<MP4Info> {
    if (this.info) return Promise.resolve(this.info);

    return new Promise((resolver) => {
      this._info_resolver = resolver;
    });
  }

  getDescriptionBox() {
    // TODO: make sure this is coming from the right track.
    const entry = this.file.moov.traks[0].mdia.minf.stbl.stsd.entries[0];
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (!box) {
      throw new Error("avcC, hvcC, vpcC, or av1C box not found!");
    }
    return box;
  }

  getAudioSpecificConfig() {
    // TODO: make sure this is coming from the right track.

    // 0x04 is the DecoderConfigDescrTag. Assuming MP4Box always puts this at position 0.
    console.assert(
      this.file.moov.traks[0].mdia.minf.stbl.stsd.entries[0].esds.esd.descs[0]
        .tag == 0x04
    );
    // 0x40 is the Audio OTI, per table 5 of ISO 14496-1
    console.assert(
      this.file.moov.traks[0].mdia.minf.stbl.stsd.entries[0].esds.esd.descs[0]
        .oti == 0x40
    );
    // 0x05 is the DecSpecificInfoTag
    console.assert(
      this.file.moov.traks[0].mdia.minf.stbl.stsd.entries[0].esds.esd.descs[0]
        .descs[0].tag == 0x05
    );

    return this.file.moov.traks[0].mdia.minf.stbl.stsd.entries[0].esds.esd
      .descs[0].descs[0].data;
  }

  selectTrack(track: MP4AudioTrack | MP4VideoTrack) {
    debugLog("selecting track %d", track.id);
    this.file.setExtractionOptions(track.id, undefined, undefined);
  }

  start(onSamples: (samples: Sample[]) => void) {
    this._onSamples = onSamples;
    this.file.start();
  }

  stop() {
    this.file.stop();
  }

  onSamples(id: number, user: any, samples: Sample[]) {
    this._onSamples(samples);
  }
}
