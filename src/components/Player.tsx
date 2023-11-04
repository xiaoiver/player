import * as React from "react";
import {
  MdPlayArrow,
  MdPause,
  MdSkipNext,
  MdSkipPrevious,
  MdVolumeUp,
  MdVolumeOff,
} from "react-icons/md";
import { CgSpinner } from "react-icons/cg";
import IconButton from "./IconButton";
import ProgressBar from "./ProgressBar";
import VolumeInput from "./VolumeInput";

function formatDurationDisplay(duration: number) {
  const min = Math.floor(duration / 60);
  const sec = Math.floor(duration - min * 60);

  const formatted = [min, sec].map((n) => (n < 10 ? "0" + n : n)).join(":");

  return formatted;
}

interface PlayerProps {
  isReady: boolean;
  currentSong?: { title: string; src: string };
  progress: number;
  /**
   * In seconds.
   */
  duration: number;
  /**
   * Set to true or false to pause or play the media.
   */
  playing: boolean;
  /**
   * Set to true or false to loop the media.
   */
  loop: boolean;
  /**
   * Set the playback rate of the player.
   */
  playbackRate: number;
  /**
   * Set the volume of the player, between 0 and 1.
   */
  volume: number;
  /**
   * Mutes the player, Only works if @see{volume} is set.
   */
  muted: boolean;
  /**
   * Called when media starts or resumes playing after pausing or buffering
   */
  onPlay: () => void;
  /**
   * Called when media is paused
   */
  onPause: () => void;
  /**
   * Called when media starts playing.
   */
  onStart: () => void;
  /**
   * Called when media finishes playing.
   * Does not fire when @see{loop} is set to true
   */
  onEnded: () => void;
  /**
   *
   */
  onProgress: (progress: number) => void;
  /**
   * Called when playback rate of the player changed
   */
  onPlaybackRateChange: (playbackRate: number) => void;
  /**
   * Called when volume changed.
   */
  onVolumeChange: (volume: number) => void;
  /**
   * Called when media seeks with seconds parameter.
   */
  onSeek: (second: number) => void;
}

/**
 * @see https://www.npmjs.com/package/react-player
 */
export default function Player({
  playing,
  isReady,
  currentSong,
  progress,
  duration,
  volume,
  muted,
  onPlay,
  onPause,
  onProgress,
  onVolumeChange,
}: PlayerProps) {
  const durationDisplay = formatDurationDisplay(duration);
  const elapsedDisplay = formatDurationDisplay(progress);

  const togglePlayPause = () => {
    if (playing) {
      onPause();
    } else {
      onPlay();
    }
  };

  const handleMuteUnmute = () => {
    if (volume !== 0) {
      handleVolumeChange(0);
    } else {
      handleVolumeChange(1);
    }
  };

  const handleVolumeChange = (volumeValue: number) => {
    onVolumeChange(volumeValue);
  };

  return (
    <div className="bg-slate-900 text-slate-400 p-3 relative">
      <ProgressBar
        duration={duration}
        currentProgress={progress}
        onChange={(e) => {
          onProgress(e.currentTarget.valueAsNumber);
        }}
      />

      <div className="flex flex-col items-center justify-center">
        <div className="text-center mb-1">
          <p className="text-slate-300 font-bold">
            {currentSong?.title ?? "Select a song"}
          </p>
          <p className="text-xs">Singer Name</p>
        </div>
      </div>
      <div className="grid grid-cols-3 items-center mt-4">
        <span className="text-xs">
          {elapsedDisplay} / {durationDisplay}
        </span>
        <div className="flex items-center gap-4 justify-self-center">
          <IconButton
            onClick={() => {}}
            disabled={true}
            aria-label="go to previous"
            intent="secondary"
          >
            <MdSkipPrevious size={24} />
          </IconButton>
          <IconButton
            disabled={!isReady}
            onClick={togglePlayPause}
            aria-label={playing ? "Pause" : "Play"}
            size="lg"
          >
            {!isReady && currentSong ? (
              <CgSpinner size={24} className="animate-spin" />
            ) : playing ? (
              <MdPause size={30} />
            ) : (
              <MdPlayArrow size={30} />
            )}
          </IconButton>
          <IconButton
            onClick={() => {}}
            disabled={true}
            aria-label="go to next"
            intent="secondary"
          >
            <MdSkipNext size={24} />
          </IconButton>
        </div>

        <div className="flex gap-3 items-center justify-self-end">
          <IconButton
            intent="secondary"
            size="sm"
            onClick={handleMuteUnmute}
            aria-label={muted ? "unmute" : "mute"}
          >
            {muted ? <MdVolumeOff size={20} /> : <MdVolumeUp size={20} />}
          </IconButton>
          <VolumeInput volume={volume} onVolumeChange={handleVolumeChange} />
        </div>
      </div>
    </div>
  );
}
