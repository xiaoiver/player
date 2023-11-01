import { useState, useEffect, useRef } from "react";
import "./App.css";
import { Button, Spin } from "antd";
import { WebAudioController } from "./WebAudioController";
// @ts-ignore
import MediaWorker from "./MediaWorker?worker";

const videoCodec = "av1";

function App() {
  const currentRef = useRef<HTMLCanvasElement>(null);
  const [inited, setInited] = useState(false);
  const [mediaWorker, setMediaWorker] = useState<Worker | null>(null);
  const [audioController, setAudioController] =
    useState<WebAudioController | null>(null);

  const handlePlay = () => {
    audioController!.play().then(() => console.log("playback started"));
    mediaWorker!.postMessage({
      command: "play",
      mediaTimeSecs: audioController!.getMediaTimeInSeconds(),
      mediaTimeCapturedAtHighResTimestamp:
        performance.now() + performance.timeOrigin,
    });

    sendMediaTimeUpdates(true);
  };

  const handlePause = () => {
    audioController!.pause().then(() => {
      // Wait to pause worker until context suspended to ensure we continue
      // filling audio buffer while audio is playing.
      mediaWorker!.postMessage({ command: "pause" });
    });

    sendMediaTimeUpdates(false);
  };

  const handleDetect = () => {
    mediaWorker!.postMessage({ command: "detect" });
  };

  // Helper function to periodically send the current media time to the media
  // worker. Ideally we would instead compute the media time on the worker thread,
  // but this requires WebAudio interfaces to be exposed on the WorkerGlobalScope.
  // See https://github.com/WebAudio/web-audio-api/issues/2423
  let mediaTimeUpdateInterval: number | undefined;
  function sendMediaTimeUpdates(enabled: boolean) {
    if (enabled) {
      // Local testing shows this interval (1 second) is frequent enough that the
      // estimated media time between updates drifts by less than 20 msec. Lower
      // values didn't produce meaningfully lower drift and have the downside of
      // waking up the main thread more often. Higher values could make av sync
      // glitches more noticeable when changing the output device.
      const UPDATE_INTERVAL = 1000;
      mediaTimeUpdateInterval = setInterval(() => {
        mediaWorker!.postMessage({
          command: "update-media-time",
          mediaTimeSecs: audioController!.getMediaTimeInSeconds(),
          mediaTimeCapturedAtHighResTimestamp:
            performance.now() + performance.timeOrigin,
        });
      }, UPDATE_INTERVAL);
    } else {
      clearInterval(mediaTimeUpdateInterval);
      mediaTimeUpdateInterval = undefined;
    }
  }

  useEffect(() => {
    if (currentRef.current) {
      const offscreenCanvas = currentRef.current!.transferControlToOffscreen();
      const audioController = new WebAudioController();
      setAudioController(audioController);

      const mediaWorker = new MediaWorker();
      mediaWorker.postMessage(
        {
          command: "initialize",
          audioFile: "/data/bbb_audio_aac_frag.mp4",
          videoFile: `/data/bbb_video_${videoCodec}_frag.mp4`,
          canvas: offscreenCanvas,
        },
        { transfer: [offscreenCanvas] }
      );

      mediaWorker.addEventListener("message", (e) => {
        console.assert(e.data.command == "initialize-done");
        audioController.initialize(
          e.data.sampleRate,
          e.data.channelCount,
          e.data.sharedArrayBuffer
        );
        setInited(true);
      });
      setMediaWorker(mediaWorker);

      // @ts-ignore
      // @see https://github.com/facebook/react/issues/24502
      currentRef.current = null;
    }
  }, []);

  return (
    <>
      <Spin spinning={!inited} />
      <Button disabled={!inited} onClick={handlePlay}>
        Play
      </Button>
      <Button disabled={!inited} onClick={handlePause}>
        Pause
      </Button>
      <Button disabled={!inited} onClick={handleDetect}>
        Detect
      </Button>
      <canvas width={1280} height={720} ref={currentRef}></canvas>
    </>
  );
}

export default App;
