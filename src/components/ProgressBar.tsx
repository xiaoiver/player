interface ProgressCSSProps extends React.CSSProperties {
  "--progress-width": number;
}

interface ProgressBarProps extends React.ComponentPropsWithoutRef<"input"> {
  duration: number;
  currentProgress: number;
}

export default function ProgressBar(props: ProgressBarProps) {
  const { duration, currentProgress, ...rest } = props;

  const progressBarWidth = isNaN(currentProgress / duration)
    ? 0
    : currentProgress / duration;

  const progressStyles: ProgressCSSProps = {
    "--progress-width": progressBarWidth,
  };

  return (
    <div className="absolute h-1 -top-[4px] left-0 right-0 group">
      <input
        type="range"
        name="progress"
        className={`progress-bar absolute inset-0 w-full m-0 h-full bg-transparent appearance-none cursor-pointer dark:bg-gray-700 group-hover:h-2 transition-all accent-amber-600 hover:accent-amber-600 before:absolute before:inset-0 before:h-full before:w-full before:bg-amber-600 before:origin-left after:absolute after:h-full after:w-full after:bg-amber-600/50`}
        style={progressStyles}
        min={0}
        max={duration}
        value={currentProgress}
        {...rest}
      />
    </div>
  );
}
