/**
 * The "media worker" houses and drives the AudioRenderer and VideoRenderer
 * classes to perform demuxing and decoder I/O on a background worker thread.
 */
console.info(`Worker started`);

import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgl"; // set backend to webgl
import { MP4PullDemuxer } from "./MP4PullDemuxer";
import { AudioRenderer } from "./AudioRenderer";
import { VideoRenderer } from "./VideoRenderer";
import labels from "./labels.json";

const numClass = labels.length;

let playing = false;
let audioRenderer = new AudioRenderer();
let videoRenderer = new VideoRenderer();
let lastMediaTimeSecs = 0;
let lastMediaTimeCapturePoint = 0;

function updateMediaTime(
  mediaTimeSecs: number,
  capturedAtHighResTimestamp: number
) {
  lastMediaTimeSecs = mediaTimeSecs;
  // Translate into Worker's time origin
  lastMediaTimeCapturePoint =
    capturedAtHighResTimestamp - performance.timeOrigin;
}

// Estimate current media time using last given time + offset from now()
function getMediaTimeMicroSeconds() {
  let msecsSinceCapture = performance.now() - lastMediaTimeCapturePoint;
  return (lastMediaTimeSecs * 1000 + msecsSinceCapture) * 1000;
}

let yolov8: tf.GraphModel;
const modelName = "yolov8n";
const initializeModel = async () => {
  await tf.ready();
  yolov8 = await tf.loadGraphModel(`/${modelName}_web_model/model.json`); // load model

  // warming up model
  const dummyInput = tf.ones(yolov8.inputs[0].shape!);
  const warmupResults = yolov8.execute(dummyInput);

  tf.dispose([warmupResults, dummyInput]); // cleanup memory
};

const preprocess = async (
  source: VideoFrame,
  modelWidth: number,
  modelHeight: number
): Promise<[tf.Tensor, number, number]> => {
  // ratios for boxes
  let xRatio = 1;
  let yRatio = 1;

  // @see https://github.com/tensorflow/tfjs/issues/7786
  // const buffer = new Uint8Array(source.allocationSize());
  // await source.copyTo(buffer);
  // @see https://github.com/w3c/webcodecs/issues/500
  const imageBitmap = await createImageBitmap(source);

  const input = tf.tidy(() => {
    const img = tf.browser.fromPixels(imageBitmap);

    // padding image to square => [n, m] to [n, n], n > m
    const [h, w] = img.shape.slice(0, 2); // get source width and height
    const maxSize = Math.max(w, h); // get max size
    const imgPadded = img.pad([
      [0, maxSize - h], // padding y [bottom only]
      [0, maxSize - w], // padding x [right only]
      [0, 0],
    ]) as tf.Tensor3D;

    xRatio = maxSize / w; // update xRatio
    yRatio = maxSize / h; // update yRatio

    return tf.image
      .resizeBilinear(imgPadded, [modelWidth, modelHeight]) // resize frame
      .div(255.0) // normalize
      .expandDims(0); // add batch
  });

  return [input, xRatio, yRatio];
};

const detect = async (
  frame: VideoFrame,
  callback: ([]: [
    Float32Array,
    Float32Array,
    Int32Array,
    [number, number]
  ]) => void
): Promise<void> => {
  const [modelWidth, modelHeight] = yolov8.inputs[0].shape!.slice(1, 3); // get model width and height
  tf.engine().startScope(); // start scoping tf engine

  console.log(modelWidth, modelHeight);

  const [input, xRatio, yRatio] = await preprocess(
    frame,
    modelWidth,
    modelHeight
  ); // preprocess image

  const res = yolov8.execute(input!) as tf.Tensor; // inference model
  const transRes = res.transpose([0, 2, 1]); // transpose result [b, det, n] => [b, n, det]
  const boxes = tf.tidy(() => {
    const w = transRes.slice([0, 0, 2], [-1, -1, 1]); // get width
    const h = transRes.slice([0, 0, 3], [-1, -1, 1]); // get height
    const x1 = tf.sub(transRes.slice([0, 0, 0], [-1, -1, 1]), tf.div(w, 2)); // x1
    const y1 = tf.sub(transRes.slice([0, 0, 1], [-1, -1, 1]), tf.div(h, 2)); // y1
    return tf
      .concat(
        [
          y1,
          x1,
          tf.add(y1, h), //y2
          tf.add(x1, w), //x2
        ],
        2
      )
      .squeeze();
  }); // process boxes [y1, x1, y2, x2]

  const [scores, classes] = tf.tidy<[tf.Tensor1D, tf.Tensor]>(() => {
    // class scores
    const rawScores = transRes
      .slice([0, 0, 4], [-1, -1, numClass])
      .squeeze([0]); // #6 only squeeze axis 0 to handle only 1 class models
    return [rawScores.max(1), rawScores.argMax(1)];
  }); // get max scores and classes index

  const nms = await tf.image.nonMaxSuppressionAsync(
    boxes as tf.Tensor2D,
    scores,
    500,
    0.45,
    0.2
  ); // NMS to filter boxes

  const boxes_data = boxes.gather(nms, 0).dataSync() as Float32Array; // indexing boxes by nms index
  const scores_data = scores.gather(nms, 0).dataSync() as Float32Array; // indexing scores by nms index
  const classes_data = classes.gather(nms, 0).dataSync() as Int32Array; // indexing classes by nms index

  console.log("ttt", boxes_data, scores_data, classes_data, [xRatio, yRatio]);

  callback([boxes_data, scores_data, classes_data, [xRatio, yRatio]]); // render boxes

  tf.dispose([res, transRes, boxes, scores, classes, nms]); // clear memory

  tf.engine().endScope(); // end of scoping
};

self.addEventListener("message", async function (e) {
  console.info(`Worker message: ${JSON.stringify(e.data)}`);

  switch (e.data.command) {
    case "initialize":
      let audioDemuxer = new MP4PullDemuxer(e.data.audioFile);
      let videoDemuxer = new MP4PullDemuxer(e.data.videoFile);
      await Promise.all([
        audioRenderer.initialize(audioDemuxer),
        videoRenderer.initialize(videoDemuxer, e.data.canvas),
        initializeModel(),
      ]);
      postMessage({
        command: "initialize-done",
        sampleRate: audioRenderer.sampleRate,
        channelCount: audioRenderer.channelCount,
        sharedArrayBuffer: audioRenderer.ringbuffer.buf,
      });
      break;
    case "play":
      playing = true;

      updateMediaTime(
        e.data.mediaTimeSecs,
        e.data.mediaTimeCapturedAtHighResTimestamp
      );

      audioRenderer.play();

      self.requestAnimationFrame(async function renderVideo() {
        if (!playing) return;
        videoRenderer.render(getMediaTimeMicroSeconds(), false);
        const currentFrame = videoRenderer.chooseFrame(lastMediaTimeSecs)!;
        await detect(
          currentFrame,
          ([boxes_data, scores_data, classes_data, [xRatio, yRatio]]) => {
            videoRenderer.drawLabel(
              currentFrame,
              boxes_data,
              scores_data,
              classes_data,
              [xRatio, yRatio]
            );
          }
        );
        self.requestAnimationFrame(renderVideo);
      });
      break;
    case "pause":
      playing = false;
      audioRenderer.pause();
      break;
    case "detect":
      const currentFrame = videoRenderer.chooseFrame(lastMediaTimeSecs)!;
      await detect(
        currentFrame,
        ([boxes_data, scores_data, classes_data, [xRatio, yRatio]]) => {
          videoRenderer.drawLabel(
            currentFrame,
            boxes_data,
            scores_data,
            classes_data,
            [xRatio, yRatio]
          );
        }
      );
      break;
    case "update-media-time":
      updateMediaTime(
        e.data.mediaTimeSecs,
        e.data.mediaTimeCapturedAtHighResTimestamp
      );
      break;
    default:
      console.error(`Worker bad message: ${e.data}`);
  }
});
