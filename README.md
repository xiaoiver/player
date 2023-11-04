# Video Analyzer

Inspired by [Tracking Football Players with YOLOv5 + ByteTrack](https://medium.com/@amritangshu.mukherjee/tracking-football-players-with-yolov5-bytetrack-efa317c9aaa4), we try to implement a video analyzer some with web-based techniques.

The following techniques are used for now:

- [WebCodecs](#WebCodecs) Decode and encode audio & video frames.
- [Web Audio API](#WebAudioAPI)
- [WebGPU](#WebGPU) Render [VideoFrame](https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame) and other HUDs on [OffscreenCanvas]() off main thread.
- [tensorflow.js](#tensorflow.js) Run pre-trained models with WebGPU backend in webworker.
- Some UIs come from:
  - [react-timeline-editor](https://github.com/xzdarcy/react-timeline-editor)
  - [Player](https://jeffsegovia.dev/blogs/building-an-audio-player-with-reactjs)

## Getting started

Start a vite dev server.

```bash
$ pnpm install
$ pnpm dev
```

## <a id='WebCodecs' />WebCodecs

With [WebCodecs](https://developer.chrome.com/articles/webcodecs/) it's possible to decode and encode videos frame & audios using hardware acceleration. It is preferable to move handling of individual frames and encoded chunks into a web worker.

[FFmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm) is used for muxing/demuxing videos and for some codecs that are not supported by WebCodecs.
Since we only plan to support `.mp4`, [MP4Box.js](https://gpac.github.io/mp4box.js/) is suitable to implement a pull-based demuxer.

For audio & video tracks in `.mp4`:

- [AudioDecoder](https://developer.mozilla.org/en-US/docs/Web/API/AudioDecoder) decodes chunks of audio from MP4AudioTrack and store these chunks in a [RingBuffer](https://github.com/padenot/ringbuf.js), which will be used for playing with Web Audio API later.
- [VideoDecoder](https://developer.mozilla.org/en-US/docs/Web/API/VideoDecoder) can output [VideoFrame](https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame), which is transferable and can be easily handled with Canvas2D / WebGL / WebGPU API later.

## <a id='WebAudioAPI' />Web Audio API

An [AudioContext](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext) controls both the creation of the nodes it contains and the execution of the audio processing, or decoding. It has a member [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet) which is used to supply custom audio processing scripts that execute in a separate thread to provide very low latency audio processing.

First, we need to define a custom [AudioWorkletProcessor](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor) named `AutoSink`.
Next, in our main script file we'll load the processor, create an instance of [AudioWorkletNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode) passing it the name of the processor, and connect the node to an audio graph. It will consume the RingBuffer stored in the previous step.

## <a id='WebGPU' />WebGPU

With `HTMLCanvasElement.transferControlToOffscreen` even rendering can be done off the main thread.

https://developer.chrome.com/blog/from-webgl-to-webgpu/#video-frame-processing

> Processing video frames using JavaScript and WebAssembly has some drawbacks: the cost of copying the data from GPU memory to CPU memory, and the limited parallelism that can be achieved with workers and CPU threads. WebGPU does not have those limitations, making it a great fit for processing video frames thanks to its tight integration with the WebCodecs API.

## <a id='tensorflow.js' />tensorflow.js

Since [Web Neural Network API (WebNN)](https://github.com/webmachinelearning/webnn-samples) is in development, tf.js is our only choice in browser for now. By the way, its [polyfill](https://github.com/webmachinelearning/webnn-polyfill) is based on tf.js either.

We use [WebGPU backend](https://github.com/tensorflow/tfjs/tree/master/tfjs-backend-webgpu) in WebWorker to run pre-trained models including:

- [YOLO](https://github.com/Hyuto/yolov8-tfjs/) for object detection.
- [ByteTrack](https://github.com/ifzhang/ByteTrack) for object tracking.

Inspired by:

- [Serving YOLOv8 in browser using tensorflow.js with webgl backend.](https://github.com/Hyuto/yolov8-tfjs)
- [Track an object as it moves in a video with no training.](https://github.com/cloud-annotations/object-tracking-js)
