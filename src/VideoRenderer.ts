import { MP4PullDemuxer } from "./MP4PullDemuxer";
import { StreamType } from "./PullDemuxer";
import { debugLog } from "./utils/log";
import labels from "./labels.json";
import { getRandomColor, hexToRgba } from "./utils/color";

const FRAME_BUFFER_TARGET_SIZE = 3;

/**
 * Controls demuxing and decoding of the video track, as well as rendering VideoFrames to canvas.
 * Maintains a buffer of FRAME_BUFFER_TARGET_SIZE decoded frames for future rendering.
 */
export class VideoRenderer {
  private canvas!: HTMLCanvasElement;
  private canvasCtx!: CanvasRenderingContext2D;
  private decoder!: VideoDecoder;
  private demuxer!: MP4PullDemuxer;
  private frameBuffer: VideoFrame[] = [];
  private fillInProgress = false;
  private init_resolver: any;

  async initialize(demuxer: MP4PullDemuxer, canvas: HTMLCanvasElement) {
    this.frameBuffer = [];
    this.fillInProgress = false;

    this.demuxer = demuxer;
    await this.demuxer.initialize(StreamType.VIDEO);
    const config = this.demuxer.getDecoderConfig();

    this.canvas = canvas;
    // @ts-ignore
    this.canvas.width = config.displayWidth;
    // @ts-ignore
    this.canvas.height = config.displayHeight;
    this.canvasCtx = canvas.getContext("2d")!;

    this.decoder = new VideoDecoder({
      output: this.bufferFrame.bind(this),
      error: (e) => console.error(e),
    });

    let support = await VideoDecoder.isConfigSupported(config);
    console.assert(support.supported);
    this.decoder.configure(config);

    this.init_resolver = null;
    let promise = new Promise((resolver) => (this.init_resolver = resolver));

    this.fillFrameBuffer();
    return promise;
  }

  render(timestamp: number, paint = true) {
    debugLog("render(%d)", timestamp);
    let frame = this.chooseFrame(timestamp);
    this.fillFrameBuffer();

    if (frame == null) {
      console.warn("VideoRenderer.render(): no frame ");
      return;
    }

    if (paint) {
      this.paint(frame);
    }
  }

  chooseFrame(timestamp: number) {
    console.log("frameBuffer length", this.frameBuffer.length);

    if (this.frameBuffer.length == 0) return null;

    let minTimeDelta = Number.MAX_VALUE;
    let frameIndex = -1;

    for (let i = 0; i < this.frameBuffer.length; i++) {
      let time_delta = Math.abs(timestamp - this.frameBuffer[i].timestamp);
      if (time_delta < minTimeDelta) {
        minTimeDelta = time_delta;
        frameIndex = i;
      } else {
        break;
      }
    }

    console.assert(frameIndex != -1);

    if (frameIndex > 0) debugLog("dropping %d stale frames", frameIndex);

    for (let i = 0; i < frameIndex; i++) {
      const staleFrame = this.frameBuffer.shift();
      staleFrame && staleFrame.close();
    }

    let chosenFrame = this.frameBuffer[0];
    debugLog(
      "frame time delta = %dms (%d vs %d)",
      minTimeDelta / 1000,
      timestamp,
      chosenFrame.timestamp
    );
    return chosenFrame;
  }

  async fillFrameBuffer() {
    if (this.frameBufferFull()) {
      debugLog("frame buffer full");

      if (this.init_resolver) {
        this.init_resolver();
        this.init_resolver = null;
      }

      return;
    }

    // This method can be called from multiple places and we some may already
    // be awaiting a demuxer read (only one read allowed at a time).
    if (this.fillInProgress) {
      return false;
    }
    this.fillInProgress = true;

    while (
      this.frameBuffer.length < FRAME_BUFFER_TARGET_SIZE &&
      this.decoder.decodeQueueSize < FRAME_BUFFER_TARGET_SIZE
    ) {
      let chunk = await this.demuxer.getNextChunk();
      this.decoder.decode(chunk);
    }

    this.fillInProgress = false;

    // Give decoder a chance to work, see if we saturated the pipeline.
    setTimeout(this.fillFrameBuffer.bind(this), 0);
  }

  frameBufferFull() {
    return this.frameBuffer.length >= FRAME_BUFFER_TARGET_SIZE;
  }

  bufferFrame(frame: VideoFrame) {
    debugLog(`bufferFrame(${frame.timestamp})`);
    this.frameBuffer.push(frame);
  }

  paint(frame: VideoFrame) {
    this.canvasCtx.drawImage(
      frame,
      0,
      0,
      this.canvas.width,
      this.canvas.height
    );
  }

  drawLabel(
    frame: VideoFrame,
    boxes_data: Float32Array,
    scores_data: Float32Array,
    classes_data: Int32Array,
    ratios: [number, number]
  ) {
    console.log(boxes_data, scores_data, classes_data, ratios);

    const ctx = this.canvasCtx;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); // clean canvas

    ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);

    // font configs
    const font = `${Math.max(
      Math.round(Math.max(ctx.canvas.width, ctx.canvas.height) / 40),
      14
    )}px Arial`;
    ctx.font = font;
    ctx.textBaseline = "top";

    for (let i = 0; i < scores_data.length; ++i) {
      // filter based on class threshold
      const klass = labels[classes_data[i]];
      const color = getRandomColor(classes_data[i]);
      const score = (scores_data[i] * 100).toFixed(1);

      let [y1, x1, y2, x2] = boxes_data.slice(i * 4, (i + 1) * 4);
      x1 *= (ratios[0] * 1280) / 640;
      x2 *= (ratios[0] * 1280) / 640;
      y1 *= (ratios[1] * 720) / 640;
      y2 *= (ratios[1] * 720) / 640;
      const width = x2 - x1;
      const height = y2 - y1;

      // draw box.
      ctx.fillStyle = hexToRgba(color, 0.2)!;
      ctx.fillRect(x1, y1, width, height);

      // draw border box.
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(
        Math.min(ctx.canvas.width, ctx.canvas.height) / 200,
        2.5
      );
      ctx.strokeRect(x1, y1, width, height);

      // Draw the label background.
      ctx.fillStyle = color;
      const textWidth = ctx.measureText(klass + " - " + score + "%").width;
      const textHeight = parseInt(font, 10); // base 10
      const yText = y1 - (textHeight + ctx.lineWidth);
      ctx.fillRect(
        x1 - 1,
        yText < 0 ? 0 : yText, // handle overflow label box
        textWidth + ctx.lineWidth,
        textHeight + ctx.lineWidth
      );

      // Draw labels
      ctx.fillStyle = "#ffffff";
      ctx.fillText(klass + " - " + score + "%", x1 - 1, yText < 0 ? 0 : yText);
    }
  }
}
