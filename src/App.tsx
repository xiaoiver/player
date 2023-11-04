import { useState, useEffect, useRef } from "react";
import "./App.css";
import { WebAudioController } from "./WebAudioController";
import MediaWorker from "./MediaWorker?worker";
import Player from "./components/Player";
// import { Timeline } from "@xzdarcy/react-timeline-editor";
import { mockData, mockEffect } from "./assets/mock";

const videoCodec = "av1";

function App() {
  const currentRef = useRef<HTMLCanvasElement>(null);
  const [inited, setInited] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.2);
  const [duration, setDuration] = useState(0);
  const [mediaTime, setMediaTime] = useState(0);
  const [mediaWorker, setMediaWorker] = useState<Worker | null>(null);
  const [audioController, setAudioController] =
    useState<WebAudioController | null>(null);

  const handlePlay = () => {
    setPlaying(true);
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
    setPlaying(false);
    audioController!.pause().then(() => {
      // Wait to pause worker until context suspended to ensure we continue
      // filling audio buffer while audio is playing.
      mediaWorker!.postMessage({ command: "pause" });
    });

    sendMediaTimeUpdates(false);
  };

  const handleProgress = (progress: number) => {};

  const handleVolumeChange = (volume: number) => {
    setVolume(volume);
    audioController!.setVolume(volume);
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
        const t = audioController!.getMediaTimeInSeconds();
        mediaWorker!.postMessage({
          command: "update-media-time",
          mediaTimeSecs: t,
          mediaTimeCapturedAtHighResTimestamp:
            performance.now() + performance.timeOrigin,
        });
        setMediaTime(t);
      }, UPDATE_INTERVAL);
    } else {
      clearInterval(mediaTimeUpdateInterval);
      mediaTimeUpdateInterval = undefined;
    }
  }

  useEffect(() => {
    let mediaWorker: Worker;
    if (currentRef.current) {
      const offscreenCanvas = currentRef.current!.transferControlToOffscreen();
      const audioController = new WebAudioController();
      setAudioController(audioController);

      mediaWorker = new MediaWorker();
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
        setDuration(e.data.duration);
      });
      setMediaWorker(mediaWorker);
    }

    return () => {
      // @ts-ignore
      currentRef.current = null;
      // mediaWorker.terminate();
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-slate-800 text-slate-300">
      <canvas width={1280} height={720} ref={currentRef}></canvas>
      <div className="mt-auto">
        <Player
          isReady={inited}
          playing={playing}
          loop={false}
          playbackRate={1.0}
          volume={volume}
          muted={volume === 0}
          currentSong={{ title: "test", src: "" }}
          progress={mediaTime}
          duration={duration / 1000}
          onPlay={handlePlay}
          onPause={handlePause}
          onVolumeChange={handleVolumeChange}
          onProgress={handleProgress}
          onStart={() => {}}
          onEnded={() => {}}
          onPlaybackRateChange={() => {}}
          onSeek={() => {}}
        />
      </div>
      {/* <Timeline editorData={mockData} effects={mockEffect} /> */}
    </div>
  );
}

export default App;
